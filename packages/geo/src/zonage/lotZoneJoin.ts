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

/**
 * Canonical key used ONLY to join a zones layer against a norms grille.
 *
 * On top of `normalizeZoneCode` (case, unicode dashes, dash/space collapse) it
 * folds together the FORMAT variants of one letter+number code so the SIG layer
 * and the norms table meet on ONE key. This is the SINGLE SOURCE OF TRUTH for that
 * canonicalisation: `acquisition/src/lib/zonage-norms.ts` `canonZone` (the deposit
 * overlap gate) delegates to THIS function, so the gate's reported norms\u2229zones
 * overlap is, by construction, exactly the join's realized match \u2014 no drift.
 *
 * Three folds, applied to the whole (spaceless, annotation-stripped) code:
 *   1. letter-first single code \u2014 `H01`, `H-01`, `H 1`, `H1`, `HA-020` fold to
 *      `H-1` / `HA-20` (leading zeros after the prefix drop, one canonical dash).
 *   2. digit-first single code \u2014 `20HA`, `20-HA`, `020-HA`, `"20 Ha"` fold to the
 *      SAME `HA-20` key (order-invariant: the Matap\u00e9dia/Mitis famille whose SIG
 *      grille emits `"20 Ha"` while the norms grille emits `"Ha-20"`). Without this
 *      reorder the join had to fall back to the uniqueness-gated numeric bridge and
 *      MISSED a digit-first code whose number is non-unique \u2014 the gate/join gap this
 *      closes.
 *   3. a single KNOWN trailing presentational parenthetical annotation is dropped first \u2014
 *      the redundant arrondissement/secteur label a SIG grille appends to an
 *      otherwise-identical code (Longueuil `A12-024 (STH)` \u2261 the bare `A12-024`;
 *      STH/VLO/GP/GPK = the arrondissement, already encoded by the `12`/`34` district
 *      prefix).
 *
 * ANTI-FUSION: each fold is ANCHORED to the WHOLE code (one alpha run + one digit
 * run, either order) or only rewrites the leading letter\u2192digit boundary; it drops
 * leading zeros but never significant digits, and never touches the code core. Two
 * codes collapse IFF they share the same letters AND the same numeric value. So it
 * NEVER merges distinct codes: `H-1` \u2260 `H-10`, `C-408` \u2260 `C-40`, `20HA` \u2260 `21HA`,
 * `20HA` \u2260 `20HB`, `A12-024` \u2260 `A12-025 (STH)`, and a multi-segment / DASH secteur
 * suffix (`H-531-F` \u2260 `H-531-G`, `20-A-1` untouched) is left intact.
 */
export function canonicalizeZoneCodeForJoin(value: unknown): string {
  const up = normalizeZoneCode(value)
    .replace(/\s*\((?:STH|VLO|GP|GPK)\)\s*$/, "")
    .replace(/\s+/g, "");
  // 1. letter-first single code: HA20 / HA-20 / HA-020 \u2192 HA-20 (0* eats leading zeros).
  const letterFirst = /^([A-Z]+)-?0*(\d+)$/.exec(up);
  if (letterFirst) return `${letterFirst[1]}-${letterFirst[2]}`;
  // 2. digit-first single code: 20HA / 20-HA / 020-HA \u2192 the SAME canonical LETTERS-DIGITS.
  const digitFirst = /^0*(\d+)-?([A-Z]+)$/.exec(up);
  if (digitFirst) return `${digitFirst[2]}-${digitFirst[1]}`;
  // 3. multi-segment / unusual \u2014 strict leading-zero boundary rewrite only, never reordered.
  return up.replace(/^([A-Z]+)-?0*(\d)/, "$1-$2");
}

/**
 * The numeric zone identifier of a code, or null when it has no ONE unambiguous
 * number. A code is eligible for the numeric-vintage bridge iff its canonical form
 * carries EXACTLY ONE contiguous digit run (surrounding alpha/dash segments are
 * fine): `RA-106`→"106", `CV-RF-106`→"106", `106`→"106", `H-1`→"1". Ineligible
 * (→null): no digits (`URB`) or ≥2 digit runs (`A12-024`) whose zone number is
 * ambiguous. Leading zeros drop, so `H-1`("1") and `H-10`("10") stay distinct.
 *
 * LOCKSTEP with `acquisition/src/lib/zonage-norms.ts` `zoneNumberKey`, so the
 * deposit gate's numeric-bridged overlap equals the realized lot⋈norms match.
 */
export function zoneNumberOf(value: unknown): string | null {
  const runs = canonicalizeZoneCodeForJoin(value).match(/\d+/g);
  if (!runs || runs.length !== 1) return null;
  return String(Number(runs[0]));
}

/**
 * Attach a norms record to each lot assignment.
 *
 * Primary match: exact canonical zone code (`canonicalizeZoneCodeForJoin`).
 *
 * NUMERIC-VINTAGE FALLBACK — when the SIG grille and the norms grille are the same
 * zoning at a different by-law vintage (letters changed, zone NUMBER preserved:
 * Mont-Tremblant lot `CV-RF-106` ⋈ norms `RA-106`), the exact match misses. We
 * then bridge by the zone NUMBER, but ONLY when that number is UNIQUE among the
 * distinct lot codes AND UNIQUE among the norms codes — the same double-uniqueness
 * anti-fusion guarantee as the deposit gate. A number carried by ≥2 codes on either
 * side (or a multi-number code) is never bridged, so distinct zones never fuse.
 */
export function enrichWithNorms(
  assignments: LotZoneAssignment[],
  normsByZoneCode: Map<string, NormsRecord>,
): LotZoneNormAssignment[] {
  const normalizedNorms = new Map<string, NormsRecord>();
  for (const [code, norms] of normsByZoneCode) {
    const normalized = canonicalizeZoneCodeForJoin(code);
    if (normalized && !normalizedNorms.has(normalized)) normalizedNorms.set(normalized, norms);
  }

  // Norms (grille) side: zone number → its unique canonical code (ambiguous numbers omitted).
  const normsUniqueByNumber = uniqueByNumber(normalizedNorms.keys());
  // SIG (lot) side: zone number → distinct canonical lot codes (for uniqueness).
  const lotCodesByNumber = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (assignment.zoneCode === null) continue;
    const n = zoneNumberOf(assignment.zoneCode);
    if (n === null) continue;
    const canon = canonicalizeZoneCodeForJoin(assignment.zoneCode);
    let set = lotCodesByNumber.get(n);
    if (!set) {
      set = new Set<string>();
      lotCodesByNumber.set(n, set);
    }
    set.add(canon);
  }

  return assignments.map((assignment) => {
    if (assignment.zoneCode === null) return { ...assignment, norms: null };
    const canon = canonicalizeZoneCodeForJoin(assignment.zoneCode);
    let norms = normalizedNorms.get(canon) ?? null;
    if (norms === null) {
      const n = zoneNumberOf(assignment.zoneCode);
      if (n !== null) {
        const grilleCode = normsUniqueByNumber.get(n); // undefined ⇒ absent or ambiguous
        const lotCodes = lotCodesByNumber.get(n);
        // Bridge only when the number is unique on BOTH sides and points elsewhere.
        if (grilleCode !== undefined && grilleCode !== canon && lotCodes && lotCodes.size === 1) {
          norms = normalizedNorms.get(grilleCode) ?? null;
        }
      }
    }
    return { ...assignment, norms };
  });
}

/** number → its single canonical code; a number carried by ≥2 distinct codes is
 *  dropped (ambiguous, never bridged). */
function uniqueByNumber(codes: Iterable<string>): Map<string, string> {
  const seen = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const code of codes) {
    const n = zoneNumberOf(code);
    if (n === null) continue;
    const existing = seen.get(n);
    if (existing === undefined) seen.set(n, code);
    else if (existing !== code) ambiguous.add(n);
  }
  for (const n of ambiguous) seen.delete(n);
  return seen;
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
  const lotForIntersection = lot;
  const lotArea = planarArea(lot.geometry);
  const lotBox = bboxOf(lotForIntersection.geometry);
  const candidates = tree.search(toSearchBox(lotBox));
  if (!(lotArea > 0)) {
    return unassigned(lotId);
  }

  const areas = new Map<string, AreaByZone>();
  let exactFailed = false;

  for (const zone of candidates) {
    let overlapArea = 0;
    try {
      overlapArea = intersectionArea(lotForIntersection, zone.feature);
    } catch {
      exactFailed = true;
      continue;
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

  if (exactFailed) {
    return areas.size === 0
      ? centroidFallback(lotId, lotForIntersection.geometry, candidates.length ? candidates : allZones)
      : unassigned(lotId);
  }
  if (areas.size === 0) {
    return unassigned(lotId);
  }

  const ranked = [...areas.values()].sort((a, b) => b.area - a.area || compareCodePoint(a.rawCode, b.rawCode));
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

  if (isGeographicCrs(opts.sourceCrs) || (!opts.sourceCrs && (looksGeographic(lots) || looksGeographic(zones)))) {
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
  hits.sort((a, b) => compareCodePoint(a.rawCode, b.rawCode));
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
        if ((y1 <= scanY) === (y2 <= scanY)) continue;
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
  const projection = new proj4.Proj(crs) as ReturnType<typeof proj4.Proj> & { projName?: string };
  return projection.projName === "longlat";
}

function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
  representativePoint,
};
