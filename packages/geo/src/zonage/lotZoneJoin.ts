import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import buffer from "@turf/buffer";
import { featureCollection } from "@turf/helpers";
import intersect from "@turf/intersect";
import proj4 from "proj4";

export type PolygonalGeometry = Polygon | MultiPolygon;
export type PolygonalFeature<P extends Record<string, unknown> = Record<string, unknown>> = Feature<
  PolygonalGeometry,
  P
>;

export type LotZoneAssignmentMethod = "area-majority" | "centroid-fallback" | "unassigned";

export interface LotZoneAssignment {
  lotId: string;
  zoneCode: string | null;
  dominantFraction: number;
  multiZone: boolean;
  zoneCodes: string[];
  method: LotZoneAssignmentMethod;
}

export type NormsRecord = Record<string, unknown>;

export type LotZoneNormAssignment = LotZoneAssignment & {
  norms: NormsRecord | null;
};

export interface LotZoneJoinOptions {
  dominantThreshold?: number;
  nearTieThreshold?: number;
  sliverAreaEps?: number;
  targetCrs?: string;
  sourceCrs?: string;
  lotIdOf?: (lot: PolygonalFeature, index: number) => string;
}

interface IndexedZone {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  index: number;
  rawCode: string;
  normalizedCode: string;
  geometry: PolygonalGeometry;
  feature: PolygonalFeature;
}

interface BBoxItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface AreaByZone {
  rawCode: string;
  normalizedCode: string;
  area: number;
}

const DEFAULT_DOMINANT_THRESHOLD = 0.6;
const DEFAULT_NEAR_TIE_THRESHOLD = 0.1;
const DEFAULT_SLIVER_AREA_EPS = 1e-6;
const WGS84 = "EPSG:4326";

export function normalizeZoneCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]+/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/-+/g, "-")
    .replace(/\s+/g, " ");
}

export function enrichWithNorms(
  assignments: LotZoneAssignment[],
  normsByZoneCode: Map<string, NormsRecord>,
): LotZoneNormAssignment[] {
  const normalizedNorms = new Map<string, NormsRecord>();
  for (const [code, norms] of normsByZoneCode) {
    const normalized = normalizeZoneCode(code);
    if (normalized && !normalizedNorms.has(normalized)) normalizedNorms.set(normalized, norms);
  }

  return assignments.map((assignment) => {
    const norms =
      assignment.zoneCode === null
        ? null
        : normalizedNorms.get(normalizeZoneCode(assignment.zoneCode)) ?? null;
    return { ...assignment, norms };
  });
}

export function assignLotZones(
  lots: PolygonalFeature[],
  zones: PolygonalFeature[],
  zoneCodeOf: (zone: PolygonalFeature) => string,
  opts: LotZoneJoinOptions = {},
): LotZoneAssignment[] {
  const dominantThreshold = opts.dominantThreshold ?? DEFAULT_DOMINANT_THRESHOLD;
  const nearTieThreshold = opts.nearTieThreshold ?? DEFAULT_NEAR_TIE_THRESHOLD;
  const sliverAreaEps = opts.sliverAreaEps ?? DEFAULT_SLIVER_AREA_EPS;
  assertUnitInterval("dominantThreshold", dominantThreshold);
  assertUnitInterval("nearTieThreshold", nearTieThreshold);
  if (!(sliverAreaEps >= 0)) throw new Error("sliverAreaEps must be >= 0");

  const prepared = prepareInputs(lots, zones, opts);
  const indexedZones = buildZoneIndex(prepared.zones, zoneCodeOf);
  const tree = new GridSpatialIndex(indexedZones);

  const assignmentOptions = {
    dominantThreshold,
    nearTieThreshold,
    sliverAreaEps,
    ...(opts.lotIdOf ? { lotIdOf: opts.lotIdOf } : {}),
  };

  return prepared.lots.map((lot, lotIndex) =>
    assignOneLot(lot, lotIndex, tree, indexedZones, assignmentOptions),
  );
}

function assignOneLot(
  lot: PolygonalFeature,
  lotIndex: number,
  tree: GridSpatialIndex<IndexedZone>,
  allZones: IndexedZone[],
  opts: Required<Pick<LotZoneJoinOptions, "dominantThreshold" | "nearTieThreshold" | "sliverAreaEps">> & {
    lotIdOf?: (lot: PolygonalFeature, index: number) => string;
  },
): LotZoneAssignment {
  const lotId = opts.lotIdOf?.(lot, lotIndex) ?? defaultLotId(lot, lotIndex);
  let lotForIntersection = lot;
  let lotArea = planarArea(lot.geometry);
  if (!(lotArea > 0)) {
    lotForIntersection = repairFeature(lot);
    lotArea = planarArea(lotForIntersection.geometry);
  }
  if (!(lotArea > 0)) {
    return unassigned(lotId);
  }

  const lotBox = bboxOf(lotForIntersection.geometry);
  const candidates = tree.search(toSearchBox(lotBox));
  const areas = new Map<string, AreaByZone>();
  let exactFailed = false;

  for (const zone of candidates) {
    let overlapArea = 0;
    try {
      overlapArea = intersectionArea(lotForIntersection, zone.feature);
    } catch {
      try {
        overlapArea = intersectionArea(repairFeature(lotForIntersection), repairFeature(zone.feature));
      } catch {
        exactFailed = true;
        continue;
      }
    }
    if (overlapArea < opts.sliverAreaEps) continue;
    const prev = areas.get(zone.normalizedCode);
    if (prev) prev.area += overlapArea;
    else {
      areas.set(zone.normalizedCode, {
        rawCode: zone.rawCode,
        normalizedCode: zone.normalizedCode,
        area: overlapArea,
      });
    }
  }

  if (areas.size === 0) {
    if (exactFailed) return centroidFallback(lotId, lotForIntersection.geometry, candidates.length ? candidates : allZones);
    return unassigned(lotId);
  }

  const ranked = [...areas.values()].sort((a, b) => b.area - a.area || a.rawCode.localeCompare(b.rawCode));
  const top = ranked[0]!;
  const second = ranked[1];
  const dominantFraction = clamp01(top.area / lotArea);
  const secondFraction = second ? clamp01(second.area / lotArea) : 0;
  const multiZone =
    ranked.length > 1 &&
    (dominantFraction < opts.dominantThreshold ||
      dominantFraction - secondFraction < opts.nearTieThreshold);

  return {
    lotId,
    zoneCode: top.rawCode,
    dominantFraction,
    multiZone,
    zoneCodes: ranked.map((z) => z.rawCode),
    method: "area-majority",
  };
}

function buildZoneIndex(
  zones: PolygonalFeature[],
  zoneCodeOf: (zone: PolygonalFeature) => string,
): IndexedZone[] {
  const out: IndexedZone[] = [];
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i]!;
    const rawCode = String(zoneCodeOf(zone) ?? "").trim();
    const normalizedCode = normalizeZoneCode(rawCode);
    if (!rawCode || !normalizedCode) continue;
    const [minX, minY, maxX, maxY] = bboxOf(zone.geometry);
    out.push({
      minX,
      minY,
      maxX,
      maxY,
      index: i,
      rawCode,
      normalizedCode,
      geometry: zone.geometry,
      feature: zone,
    });
  }
  return out;
}

function prepareInputs(
  lots: PolygonalFeature[],
  zones: PolygonalFeature[],
  opts: LotZoneJoinOptions,
): { lots: PolygonalFeature[]; zones: PolygonalFeature[] } {
  if (opts.targetCrs) {
    if (isGeographicCrs(opts.targetCrs)) {
      throw new Error(`targetCrs must be metric, got ${opts.targetCrs}`);
    }
    const source = opts.sourceCrs ?? WGS84;
    return {
      lots: lots.map((lot) => reprojectFeature(lot, source, opts.targetCrs!)),
      zones: zones.map((zone) => reprojectFeature(zone, source, opts.targetCrs!)),
    };
  }

  if (looksGeographic(lots) || looksGeographic(zones) || isGeographicCrs(opts.sourceCrs)) {
    throw new Error(
      "assignLotZones requires metric coordinates for area; reproject before calling or pass targetCrs",
    );
  }
  return { lots, zones };
}

function intersectionArea(a: PolygonalFeature, b: PolygonalFeature): number {
  const fc: FeatureCollection<PolygonalGeometry> = featureCollection([a, b]);
  const hit = intersect(fc);
  return hit ? planarArea(hit.geometry) : 0;
}

function repairFeature<P extends Record<string, unknown>>(feature: PolygonalFeature<P>): PolygonalFeature<P> {
  return { ...feature, geometry: repairGeometry(feature.geometry) };
}

function repairGeometry(geometry: PolygonalGeometry): PolygonalGeometry {
  try {
    const repaired = buffer(
      {
        type: "Feature",
        properties: {},
        geometry,
      },
      0,
      { units: "meters" },
    );
    if (repaired?.geometry?.type === "Polygon" || repaired?.geometry?.type === "MultiPolygon") {
      return repaired.geometry;
    }
  } catch {
    return geometry;
  }
  return geometry;
}

function centroidFallback(
  lotId: string,
  lotGeometry: PolygonalGeometry,
  zones: IndexedZone[],
): LotZoneAssignment {
  const point = representativePoint(lotGeometry);
  if (!point) return unassigned(lotId);

  const hits: IndexedZone[] = [];
  for (const zone of zones) {
    try {
      if (booleanPointInPolygon(pointFeature(point), zone.geometry, { ignoreBoundary: true })) {
        hits.push(zone);
      }
    } catch {
      continue;
    }
  }
  if (hits.length === 0) return unassigned(lotId);
  hits.sort((a, b) => a.rawCode.localeCompare(b.rawCode));
  return {
    lotId,
    zoneCode: hits[0]!.rawCode,
    dominantFraction: 1,
    multiZone: hits.length > 1,
    zoneCodes: hits.map((z) => z.rawCode),
    method: "centroid-fallback",
  };
}

function unassigned(lotId: string): LotZoneAssignment {
  return {
    lotId,
    zoneCode: null,
    dominantFraction: 0,
    multiZone: false,
    zoneCodes: [],
    method: "unassigned",
  };
}

function planarArea(geometry: PolygonalGeometry): number {
  const polyArea = (poly: Position[][]): number => {
    if (poly.length === 0) return 0;
    let area = Math.abs(ringArea(poly[0]!));
    for (let i = 1; i < poly.length; i++) area -= Math.abs(ringArea(poly[i]!));
    return Math.max(0, area);
  };
  if (geometry.type === "Polygon") return polyArea(geometry.coordinates);
  return geometry.coordinates.reduce((sum, poly) => sum + polyArea(poly), 0);
}

function ringArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    sum += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return sum / 2;
}

function bboxOf(geometry: PolygonalGeometry): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const scanRing = (ring: Position[]): void => {
    for (const p of ring) {
      const x = p[0]!;
      const y = p[1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  const scanPoly = (poly: Position[][]): void => {
    for (const ring of poly) scanRing(ring);
  };
  if (geometry.type === "Polygon") scanPoly(geometry.coordinates);
  else for (const poly of geometry.coordinates) scanPoly(poly);
  return [minX, minY, maxX, maxY];
}

function toSearchBox([minX, minY, maxX, maxY]: [number, number, number, number]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return { minX, minY, maxX, maxY };
}

class GridSpatialIndex<T extends BBoxItem> {
  private readonly items: T[];
  private readonly minX: number;
  private readonly minY: number;
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  private readonly gridSize: number;
  private readonly cells = new Map<string, T[]>();

  constructor(items: T[]) {
    this.items = items;
    const extent = items.reduce(
      (box, item) => ({
        minX: Math.min(box.minX, item.minX),
        minY: Math.min(box.minY, item.minY),
        maxX: Math.max(box.maxX, item.maxX),
        maxY: Math.max(box.maxY, item.maxY),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    this.minX = Number.isFinite(extent.minX) ? extent.minX : 0;
    this.minY = Number.isFinite(extent.minY) ? extent.minY : 0;
    this.gridSize = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, items.length))));
    const width = Math.max(1, extent.maxX - this.minX);
    const height = Math.max(1, extent.maxY - this.minY);
    this.cellWidth = width / this.gridSize;
    this.cellHeight = height / this.gridSize;

    for (const item of items) {
      const [minCellX, minCellY, maxCellX, maxCellY] = this.cellRange(item);
      for (let x = minCellX; x <= maxCellX; x++) {
        for (let y = minCellY; y <= maxCellY; y++) {
          const key = `${x}:${y}`;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(item);
          else this.cells.set(key, [item]);
        }
      }
    }
  }

  search(box: BBoxItem): T[] {
    if (this.items.length === 0) return [];
    const [minCellX, minCellY, maxCellX, maxCellY] = this.cellRange(box);
    const seen = new Set<T>();
    const out: T[] = [];
    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        for (const item of this.cells.get(`${x}:${y}`) ?? []) {
          if (seen.has(item)) continue;
          seen.add(item);
          if (boxesIntersect(box, item)) out.push(item);
        }
      }
    }
    return out;
  }

  private cellRange(box: BBoxItem): [number, number, number, number] {
    return [
      clampInt(Math.floor((box.minX - this.minX) / this.cellWidth), 0, this.gridSize - 1),
      clampInt(Math.floor((box.minY - this.minY) / this.cellHeight), 0, this.gridSize - 1),
      clampInt(Math.floor((box.maxX - this.minX) / this.cellWidth), 0, this.gridSize - 1),
      clampInt(Math.floor((box.maxY - this.minY) / this.cellHeight), 0, this.gridSize - 1),
    ];
  }
}

function boxesIntersect(a: BBoxItem, b: BBoxItem): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function representativePoint(geometry: PolygonalGeometry): Position | null {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best: { point: Position; width: number } | null = null;
  for (const poly of polys) {
    const candidate = representativePointForPoly(poly);
    if (candidate && (!best || candidate.width > best.width)) best = candidate;
  }
  return best?.point ?? null;
}

function representativePointForPoly(poly: Position[][]): { point: Position; width: number } | null {
  const ext = poly[0];
  if (!ext || ext.length < 4) return null;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ext) {
    const y = p[1]!;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;

  const tryScan = (scanY: number): { point: Position; width: number } | null => {
    const xs: number[] = [];
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const y1 = ring[i]![1]!;
        const y2 = ring[i + 1]![1]!;
        if (y1 <= scanY === y2 <= scanY) continue;
        const x1 = ring[i]![0]!;
        const x2 = ring[i + 1]![0]!;
        const t = (scanY - y1) / (y2 - y1);
        xs.push(x1 + t * (x2 - x1));
      }
    }
    if (xs.length < 2) return null;
    xs.sort((a, b) => a - b);
    let bestWidth = -1;
    let bestMid = NaN;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1]! - xs[i]!;
      if (width > bestWidth) {
        bestWidth = width;
        bestMid = (xs[i]! + xs[i + 1]!) / 2;
      }
    }
    if (!Number.isFinite(bestMid) || bestWidth <= 0) return null;
    return { point: [bestMid, scanY], width: bestWidth };
  };

  const height = maxY - minY || 1;
  for (const frac of [0.5, 0.5001, 0.4999, 0.5003, 0.4997, 0.501, 0.499]) {
    const point = tryScan(minY + frac * height);
    if (point) return point;
  }
  return null;
}

function pointFeature(coordinates: Position): Feature<Point> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates },
  };
}

function reprojectFeature<P extends Record<string, unknown>>(
  feature: PolygonalFeature<P>,
  sourceCrs: string,
  targetCrs: string,
): PolygonalFeature<P> {
  return {
    ...feature,
    geometry: reprojectGeometry(feature.geometry, sourceCrs, targetCrs),
  };
}

function reprojectGeometry(
  geometry: PolygonalGeometry,
  sourceCrs: string,
  targetCrs: string,
): PolygonalGeometry {
  const projectPosition = (p: Position): Position => {
    const [x, y] = proj4(sourceCrs, targetCrs, [p[0]!, p[1]!]);
    return [x, y, ...p.slice(2)];
  };
  const projectRing = (ring: Position[]): Position[] => ring.map(projectPosition);
  const projectPoly = (poly: Position[][]): Position[][] => poly.map(projectRing);
  if (geometry.type === "Polygon") return { type: "Polygon", coordinates: projectPoly(geometry.coordinates) };
  return { type: "MultiPolygon", coordinates: geometry.coordinates.map(projectPoly) };
}

function looksGeographic(features: PolygonalFeature[]): boolean {
  if (features.length === 0) return false;
  let sawCoord = false;
  for (const feature of features) {
    const [minX, minY, maxX, maxY] = bboxOf(feature.geometry);
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue;
    sawCoord = true;
    if (minX < -180 || maxX > 180 || minY < -90 || maxY > 90) return false;
  }
  return sawCoord;
}

function isGeographicCrs(crs: string | undefined): boolean {
  if (!crs) return false;
  return /4326|CRS84|WGS\s*84/i.test(crs);
}

function defaultLotId(lot: PolygonalFeature, index: number): string {
  const props = lot.properties ?? {};
  for (const key of ["lot_id", "LOT_ID", "NO_LOT", "no_lot", "noLot", "geoId", "id"]) {
    const value = props[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return String(index);
}

function assertUnitInterval(name: string, value: number): void {
  if (!(value >= 0 && value <= 1)) throw new Error(`${name} must be between 0 and 1`);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export const __test = {
  planarArea,
};
