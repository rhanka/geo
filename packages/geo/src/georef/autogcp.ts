/**
 * georef/autogcp.ts - pure autonomous GCP discovery from page linework points
 * and an already-loaded WGS84 cadastre FeatureCollection.
 *
 * This is the compute core of the acquisition T2 autogcp path. The library
 * surface deliberately does not render PDFs, read files, OCR ticks, or fetch S3.
 * Callers provide page vector points and cadastre
 * geometry in memory; this module matches candidate parcel vertices, prunes by
 * residuals and holdout, then emits independent GCPs.
 *
 * Ported from acquisition/src/lib/t2-autogcp.ts.
 */
import type { FeatureCollection, Geometry, Position } from "@sentropic/geo-core";

import { fitAffine, type GeoRef } from "./affine.js";
import {
  buildGeoRefFromGcps,
  buildGeoRefFromGcpsCrs,
  type Gcp,
  type GcpFile,
  type NeatlineFrac,
} from "./gcp.js";
import {
  decomposeGcpAffine,
  decomposeGcpSimilarity,
  evaluateAffineGate,
  type AffineGateOptions,
} from "./gate.js";

const M_PER_DEG_LAT = 111320;

export type FitMode = "affine" | "similarity";

export interface PagePoint {
  x: number;
  y: number;
}

export interface AutoGcpMatch {
  pageX: number;
  pageY: number;
  lon: number;
  lat: number;
  distM: number;
  residualM?: number;
}

export interface AutoGcpCoreOptions {
  slug: string;
  pageW: number;
  pageH: number;
  seed: GcpFile;
  cadastre: FeatureCollection<Geometry | null>;
  pagePoints: PagePoint[];
  maxCandidateDistanceM?: number;
  maxResidualM?: number;
  minGcps?: number;
  maxGcps?: number;
  fit?: FitMode;
  /** Safe by default; false is reserved for callers performing their own geometry arbitration. */
  affineGate?: AffineGateOptions | false;
}

export interface AutoGcpCoreReport {
  slug: string;
  method: "cadastre-parcel-corner-vector-match";
  pass: boolean;
  reason?: string;
  page_points: number;
  cadastre_vertices: number;
  seed_candidate_matches: number;
  selected_gcps: number;
  residual_max_m: number | null;
  residual_rms_m: number | null;
  holdout_max_m: number | null;
  holdout_rms_m: number | null;
  affine_gate_pass: boolean | null;
  affine_gate_reasons: string[];
  max_candidate_distance_m: number;
  max_residual_gate_m: number;
  gcp_file?: GcpFile;
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface CadVertex {
  lon: number;
  lat: number;
  xm: number;
  ym: number;
}

interface Similarity2D {
  s: number;
  cos: number;
  sin: number;
  tx: number;
  ty: number;
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(name + "=\"([^\"]*)\""));
  return m ? m[1] : undefined;
}

function svgNumber(v: string | undefined): number {
  if (!v) return 0;
  return Number(v.replace(/pt$/, ""));
}

function parseMatrix(raw: string | undefined): Matrix {
  if (!raw) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const m = raw.match(/matrix\(([^)]+)\)/);
  if (!m) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const n = (m[1]?.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  if (n.length !== 6) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  return { a: n[0]!, b: n[1]!, c: n[2]!, d: n[3]!, e: n[4]!, f: n[5]! };
}

function applyMatrix(p: PagePoint, m: Matrix): PagePoint {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

function pathTokens(d: string): string[] {
  return d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
}

function isCmd(t: string | undefined): boolean {
  return !!t && /^[A-Za-z]$/.test(t);
}

function readNum(tokens: string[], state: { i: number }): number | null {
  const t = tokens[state.i];
  if (t === undefined || isCmd(t)) return null;
  state.i++;
  return Number(t);
}

function parsePathPoints(d: string, matrix: Matrix): PagePoint[] {
  const tokens = pathTokens(d);
  const out: PagePoint[] = [];
  const state = { i: 0 };
  let cmd = "";
  let cur: PagePoint = { x: 0, y: 0 };
  let start: PagePoint = { x: 0, y: 0 };

  const push = (p: PagePoint): void => {
    cur = p;
    out.push(applyMatrix(p, matrix));
  };

  while (state.i < tokens.length) {
    if (isCmd(tokens[state.i])) cmd = tokens[state.i++]!;
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      push(start);
      continue;
    }
    if (C === "M" || C === "L") {
      let firstMove = C === "M";
      while (state.i < tokens.length && !isCmd(tokens[state.i])) {
        const x = readNum(tokens, state);
        const y = readNum(tokens, state);
        if (x === null || y === null) break;
        const p = { x: rel ? cur.x + x : x, y: rel ? cur.y + y : y };
        push(p);
        if (firstMove) {
          start = p;
          firstMove = false;
        }
      }
      if (C === "M") cmd = rel ? "l" : "L";
    } else if (C === "H") {
      while (state.i < tokens.length && !isCmd(tokens[state.i])) {
        const x = readNum(tokens, state);
        if (x === null) break;
        push({ x: rel ? cur.x + x : x, y: cur.y });
      }
    } else if (C === "V") {
      while (state.i < tokens.length && !isCmd(tokens[state.i])) {
        const y = readNum(tokens, state);
        if (y === null) break;
        push({ x: cur.x, y: rel ? cur.y + y : y });
      }
    } else if (C === "C") {
      while (state.i < tokens.length && !isCmd(tokens[state.i])) {
        const x1 = readNum(tokens, state);
        const y1 = readNum(tokens, state);
        const x2 = readNum(tokens, state);
        const y2 = readNum(tokens, state);
        const x = readNum(tokens, state);
        const y = readNum(tokens, state);
        if (x1 === null || y1 === null || x2 === null || y2 === null || x === null || y === null) break;
        const p0 = cur;
        const p1 = { x: rel ? cur.x + x1 : x1, y: rel ? cur.y + y1 : y1 };
        const p2 = { x: rel ? cur.x + x2 : x2, y: rel ? cur.y + y2 : y2 };
        const p3 = { x: rel ? cur.x + x : x, y: rel ? cur.y + y : y };
        for (const t of [0.25, 0.5, 0.75, 1]) {
          const mt = 1 - t;
          push({
            x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
            y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
          });
        }
      }
    } else if (C === "Q") {
      while (state.i < tokens.length && !isCmd(tokens[state.i])) {
        const x1 = readNum(tokens, state);
        const y1 = readNum(tokens, state);
        const x = readNum(tokens, state);
        const y = readNum(tokens, state);
        if (x1 === null || y1 === null || x === null || y === null) break;
        const p0 = cur;
        const p1 = { x: rel ? cur.x + x1 : x1, y: rel ? cur.y + y1 : y1 };
        const p2 = { x: rel ? cur.x + x : x, y: rel ? cur.y + y : y };
        for (const t of [0.33, 0.66, 1]) {
          const mt = 1 - t;
          push({
            x: mt ** 2 * p0.x + 2 * mt * t * p1.x + t ** 2 * p2.x,
            y: mt ** 2 * p0.y + 2 * mt * t * p1.y + t ** 2 * p2.y,
          });
        }
      }
    } else {
      while (state.i < tokens.length && !isCmd(tokens[state.i])) state.i++;
    }
  }
  return out;
}

function pathLength(pts: PagePoint[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return total;
}

function bboxOfPts(pts: PagePoint[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return [minX, minY, maxX, maxY];
}

function inNeatline(p: PagePoint, neatline: NeatlineFrac | undefined, pageW: number, pageH: number): boolean {
  if (!neatline) return true;
  const x0 = Math.min(neatline.fx0, neatline.fx1) * pageW;
  const x1 = Math.max(neatline.fx0, neatline.fx1) * pageW;
  const y0 = Math.min(neatline.fy0, neatline.fy1) * pageH;
  const y1 = Math.max(neatline.fy0, neatline.fy1) * pageH;
  const padX = (x1 - x0) * 0.01;
  const padY = (y1 - y0) * 0.01;
  return p.x >= x0 - padX && p.x <= x1 + padX && p.y >= y0 - padY && p.y <= y1 + padY;
}

/**
 * Extract linework from the direct `<path>` elements emitted by
 * `pdftocairo -svg` (double-quoted presentation attributes and an optional
 * path-level `matrix(...)` transform). This deliberately is not a general SVG
 * parser: callers using another renderer must normalize its output first.
 */
export function extractSvgVectorPointsFromString(
  svg: string,
  pageW: number,
  pageH: number,
  neatline?: NeatlineFrac,
): PagePoint[] {
  const body = svg.includes("</defs>") ? svg.slice(svg.indexOf("</defs>") + "</defs>".length) : svg;
  const root = svg.match(/<svg\b([^>]*)>/);
  const svgW = svgNumber(root ? attr(root[1]!, "width") : undefined);
  const svgH = svgNumber(root ? attr(root[1]!, "height") : undefined);
  const pts: PagePoint[] = [];
  const seen = new Set<string>();
  const re = /<path\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tag = m[1]!;
    const d = attr(tag, "d");
    if (!d) continue;
    if (!/stroke="/.test(tag)) continue;
    if (/stroke="none"/.test(tag)) continue;
    if (/fill="rgb\(100%, 100%, 100%\)"/.test(tag)) continue;
    const fill = attr(tag, "fill");
    if (fill && fill !== "none") continue;
    const rawPts = parsePathPoints(d, parseMatrix(attr(tag, "transform")));
    if (rawPts.length < 2) continue;
    const len = pathLength(rawPts);
    const [x0, y0, x1, y1] = bboxOfPts(rawPts);
    if (len < 8 || Math.max(x1 - x0, y1 - y0) < 2) continue;
    for (const p of rawPts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (svgW > 0 && (p.x < -5 || p.x > svgW + 5)) continue;
      if (svgH > 0 && (p.y < -5 || p.y > svgH + 5)) continue;
      if (!inNeatline(p, neatline, pageW, pageH)) continue;
      const key = Math.round(p.x / 3) + "," + Math.round(p.y / 3);
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push(p);
    }
  }
  return pts;
}

function scanCoords(geom: Geometry | null | undefined, cb: (p: Position) => void): void {
  if (!geom) return;
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) for (const p of ring) cb(p);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) for (const ring of poly) for (const p of ring) cb(p);
  } else if (geom.type === "GeometryCollection") {
    for (const g of geom.geometries) scanCoords(g, cb);
  }
}

function cadastreVertices(cadastre: FeatureCollection<Geometry | null>): { vertices: CadVertex[]; lat0: number } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const f of cadastre.features) {
    scanCoords(f.geometry, (p) => {
      const lat = p[1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  }
  const lat0 = (minLat + maxLat) / 2;
  const mlon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const seen = new Set<string>();
  const vertices: CadVertex[] = [];
  for (const f of cadastre.features) {
    scanCoords(f.geometry, (p) => {
      const lon = p[0];
      const lat = p[1];
      const key = Math.round(lon * 1e7) + "," + Math.round(lat * 1e7);
      if (seen.has(key)) return;
      seen.add(key);
      vertices.push({ lon, lat, xm: lon * mlon, ym: lat * M_PER_DEG_LAT });
    });
  }
  return { vertices, lat0 };
}

class VertexGrid {
  private readonly cells = new Map<string, CadVertex[]>();

  constructor(
    vertices: CadVertex[],
    private readonly cellM: number,
  ) {
    for (const v of vertices) {
      const key = this.key(Math.floor(v.xm / cellM), Math.floor(v.ym / cellM));
      const a = this.cells.get(key) ?? [];
      a.push(v);
      this.cells.set(key, a);
    }
  }

  private key(ix: number, iy: number): string {
    return ix + "," + iy;
  }

  nearest(xm: number, ym: number, radiusM: number): { v: CadVertex; d: number } | null {
    let best: CadVertex | null = null;
    let bestD = Infinity;
    const ix = Math.floor(xm / this.cellM);
    const iy = Math.floor(ym / this.cellM);
    const r = Math.ceil(radiusM / this.cellM) + 1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (const v of this.cells.get(this.key(ix + dx, iy + dy)) ?? []) {
          const d = Math.hypot(v.xm - xm, v.ym - ym);
          if (d < bestD) {
            bestD = d;
            best = v;
          }
        }
      }
    }
    return best && bestD <= radiusM ? { v: best, d: bestD } : null;
  }
}

function project(lon: number, lat: number, lat0: number): [number, number] {
  return [lon * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180), lat * M_PER_DEG_LAT];
}

function fitSimilarity2D(src: Array<[number, number]>, dst: Array<[number, number]>): Similarity2D | null {
  const n = src.length;
  if (n < 2 || dst.length !== n) return null;
  let mux = 0;
  let muy = 0;
  let mvx = 0;
  let mvy = 0;
  for (let i = 0; i < n; i++) {
    mux += src[i]![0];
    muy += src[i]![1];
    mvx += dst[i]![0];
    mvy += dst[i]![1];
  }
  mux /= n;
  muy /= n;
  mvx /= n;
  mvy /= n;
  let A = 0;
  let B = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[i]![0] - mux;
    const ay = src[i]![1] - muy;
    const bx = dst[i]![0] - mvx;
    const by = dst[i]![1] - mvy;
    A += bx * ax + by * ay;
    B += by * ax - bx * ay;
    sxx += ax * ax + ay * ay;
  }
  if (sxx === 0) return null;
  const norm = Math.hypot(A, B);
  if (norm === 0) return null;
  const cos = A / norm;
  const sin = B / norm;
  const s = norm / sxx;
  const tx = mvx - s * (cos * mux - sin * muy);
  const ty = mvy - s * (sin * mux + cos * muy);
  if (![s, cos, sin, tx, ty].every(Number.isFinite)) return null;
  return { s, cos, sin, tx, ty };
}

function applySimilarity(sim: Similarity2D, x: number, y: number): [number, number] {
  return [sim.s * (sim.cos * x - sim.sin * y) + sim.tx, sim.s * (sim.sin * x + sim.cos * y) + sim.ty];
}

function affineResiduals(
  matches: AutoGcpMatch[],
  pageW: number,
  pageH: number,
): { residuals: number[]; max: number; rms: number } {
  void pageW;
  const pagePts = matches.map((m) => [m.pageX, pageH - m.pageY] as [number, number]);
  const lons = matches.map((m) => m.lon);
  const lats = matches.map((m) => m.lat);
  const cLon = fitAffine(pagePts, lons);
  const cLat = fitAffine(pagePts, lats);
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const mPerLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  const residuals: number[] = [];
  let max = 0;
  let sumSq = 0;
  for (let i = 0; i < matches.length; i++) {
    const p = pagePts[i]!;
    const lon = cLon[0] * p[0] + cLon[1] * p[1] + cLon[2];
    const lat = cLat[0] * p[0] + cLat[1] * p[1] + cLat[2];
    const r = Math.hypot((lon - lons[i]!) * mPerLon, (lat - lats[i]!) * M_PER_DEG_LAT);
    residuals.push(r);
    sumSq += r * r;
    if (r > max) max = r;
  }
  return { residuals, max, rms: Math.sqrt(sumSq / matches.length) };
}

function similarityResiduals(matches: AutoGcpMatch[], pageH: number): { residuals: number[]; max: number; rms: number } {
  const meanLat = matches.reduce((a, m) => a + m.lat, 0) / matches.length;
  const mPerLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  const src = matches.map((m) => [m.pageX, pageH - m.pageY] as [number, number]);
  const dst = matches.map((m) => [m.lon * mPerLon, m.lat * M_PER_DEG_LAT] as [number, number]);
  const sim = fitSimilarity2D(src, dst);
  if (!sim) return { residuals: matches.map(() => Infinity), max: Infinity, rms: Infinity };
  const residuals: number[] = [];
  let max = 0;
  let sumSq = 0;
  for (let i = 0; i < matches.length; i++) {
    const [ex, ey] = applySimilarity(sim, src[i]![0], src[i]![1]);
    const r = Math.hypot(ex - dst[i]![0], ey - dst[i]![1]);
    residuals.push(r);
    sumSq += r * r;
    if (r > max) max = r;
  }
  return { residuals, max, rms: Math.sqrt(sumSq / matches.length) };
}

function fitResiduals(
  matches: AutoGcpMatch[],
  pageW: number,
  pageH: number,
  fit: FitMode,
): { residuals: number[]; max: number; rms: number } {
  return fit === "similarity" ? similarityResiduals(matches, pageH) : affineResiduals(matches, pageW, pageH);
}

function spreadMatches(matches: AutoGcpMatch[], pageW: number, pageH: number, maxGcps: number): AutoGcpMatch[] {
  const bestByCell = new Map<string, AutoGcpMatch>();
  for (const m of matches) {
    const key =
      Math.floor((m.pageX / Math.max(pageW, 1)) * 12) + "," + Math.floor((m.pageY / Math.max(pageH, 1)) * 12);
    const prev = bestByCell.get(key);
    if (!prev || m.distM < prev.distM) bestByCell.set(key, m);
  }
  const pool = [...bestByCell.values()].sort((a, b) => a.distM - b.distM).slice(0, Math.max(80, maxGcps * 8));
  if (pool.length <= maxGcps) return pool;
  const out: AutoGcpMatch[] = [pool[0]!];
  while (out.length < maxGcps && out.length < pool.length) {
    let best: AutoGcpMatch | null = null;
    let bestScore = -Infinity;
    for (const m of pool) {
      if (out.includes(m)) continue;
      let minD = Infinity;
      for (const s of out) minD = Math.min(minD, Math.hypot(m.pageX - s.pageX, m.pageY - s.pageY));
      const score = minD - m.distM * 2;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    if (!best) break;
    out.push(best);
  }
  return out.sort((a, b) => a.pageX - b.pageX || a.pageY - b.pageY);
}

function tryFitMatches(
  matches: AutoGcpMatch[],
  pageW: number,
  pageH: number,
  maxResidualM: number,
  minGcps: number,
  fit: FitMode,
): AutoGcpMatch[] {
  let selected = matches;
  for (let iter = 0; iter < 6; iter++) {
    if (selected.length < minGcps) return selected;
    const { residuals } = fitResiduals(selected, pageW, pageH, fit);
    selected = selected
      .map((m, i) => ({ ...m, residualM: residuals[i]! }))
      .filter((m) => m.residualM! <= maxResidualM)
      .sort((a, b) => a.residualM! - b.residualM! || a.distM - b.distM);
  }
  return selected;
}

function holdoutStats(matches: AutoGcpMatch[], pageW: number, pageH: number, fit: FitMode): { max: number; rms: number } | null {
  if (matches.length < 8) return null;
  const train = matches.filter((_, i) => i % 5 !== 0);
  const holdout = matches.filter((_, i) => i % 5 === 0);
  if (train.length < 3 || holdout.length === 0) return null;
  const meanLat = train.reduce((a, b) => a + b.lat, 0) / train.length;
  const mPerLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  if (fit === "similarity") {
    const src = train.map((m) => [m.pageX, pageH - m.pageY] as [number, number]);
    const dst = train.map((m) => [m.lon * mPerLon, m.lat * M_PER_DEG_LAT] as [number, number]);
    const sim = fitSimilarity2D(src, dst);
    if (!sim) return null;
    let max = 0;
    let sumSq = 0;
    for (const m of holdout) {
      const [ex, ey] = applySimilarity(sim, m.pageX, pageH - m.pageY);
      const r = Math.hypot(ex - m.lon * mPerLon, ey - m.lat * M_PER_DEG_LAT);
      sumSq += r * r;
      if (r > max) max = r;
    }
    return { max, rms: Math.sqrt(sumSq / holdout.length) };
  }
  const pagePts = train.map((m) => [m.pageX, pageH - m.pageY] as [number, number]);
  const cLon = fitAffine(
    pagePts,
    train.map((m) => m.lon),
  );
  const cLat = fitAffine(
    pagePts,
    train.map((m) => m.lat),
  );
  let max = 0;
  let sumSq = 0;
  for (const m of holdout) {
    const x = m.pageX;
    const y = pageH - m.pageY;
    const lon = cLon[0] * x + cLon[1] * y + cLon[2];
    const lat = cLat[0] * x + cLat[1] * y + cLat[2];
    const r = Math.hypot((lon - m.lon) * mPerLon, (lat - m.lat) * M_PER_DEG_LAT);
    sumSq += r * r;
    if (r > max) max = r;
  }
  void pageW;
  return { max, rms: Math.sqrt(sumSq / holdout.length) };
}

function seedGeoRef(seed: GcpFile, pageW: number, pageH: number): GeoRef {
  return buildGeoRefFromGcpsCrs(seed.gcps, pageW, pageH, seed.crs, seed.neatline).geo;
}

export function matchPagePointsToCadastre(opts: {
  pagePoints: PagePoint[];
  pageW: number;
  pageH: number;
  neatline?: NeatlineFrac;
  seedGeo: Pick<GeoRef, "topLeftToLonLat">;
  cadastre: FeatureCollection<Geometry | null>;
  maxCandidateDistanceM: number;
}): { matches: AutoGcpMatch[]; cadastreVertices: number } {
  const pagePoints = opts.neatline
    ? opts.pagePoints.filter((p) => inNeatline(p, opts.neatline, opts.pageW, opts.pageH))
    : opts.pagePoints;
  const { vertices, lat0 } = cadastreVertices(opts.cadastre);
  const grid = new VertexGrid(vertices, Math.max(20, opts.maxCandidateDistanceM * 2));
  const bestMatchByVertex = new Map<CadVertex, AutoGcpMatch>();
  for (const p of pagePoints) {
    const [lon, lat] = opts.seedGeo.topLeftToLonLat(p.x, p.y);
    const [xm, ym] = project(lon, lat, lat0);
    const near = grid.nearest(xm, ym, opts.maxCandidateDistanceM);
    if (!near) continue;
    const match = { pageX: p.x, pageY: p.y, lon: near.v.lon, lat: near.v.lat, distM: near.d };
    const previous = bestMatchByVertex.get(near.v);
    if (!previous || match.distM < previous.distM) bestMatchByVertex.set(near.v, match);
  }
  return { matches: [...bestMatchByVertex.values()], cadastreVertices: vertices.length };
}

export function buildGcpFileFromAutoMatches(opts: {
  slug: string;
  pdf: string;
  page?: number;
  pageW: number;
  pageH: number;
  matches: AutoGcpMatch[];
  neatline?: NeatlineFrac;
}): GcpFile {
  const gcps: Gcp[] = opts.matches.map((m, i) => ({
    fx: m.pageX / opts.pageW,
    fy: m.pageY / opts.pageH,
    lon: m.lon,
    lat: m.lat,
    source: "cadastre-parcel-corner-match",
    independent: true,
    note:
      "autonomous cadastre parcel/linework corner match #" +
      (i + 1) +
      "; seed_nearest=" +
      m.distM.toFixed(2) +
      "m; fit_residual=" +
      (m.residualM ?? 0).toFixed(2) +
      "m",
  }));
  return {
    slug: opts.slug,
    pdf: opts.pdf,
    ...(opts.page !== undefined ? { page: opts.page } : {}),
    pageW: opts.pageW,
    pageH: opts.pageH,
    gcps,
    ...(opts.neatline ? { neatline: opts.neatline } : {}),
  };
}

export function deriveAutonomousGcpsFromPoints(opts: AutoGcpCoreOptions): AutoGcpCoreReport {
  const maxCandidateDistanceM = opts.maxCandidateDistanceM ?? 12;
  const maxResidualM = opts.maxResidualM ?? 30;
  const minGcps = opts.minGcps ?? 12;
  const maxGcps = opts.maxGcps ?? 48;
  const fit = opts.fit ?? "affine";
  if (!Number.isInteger(minGcps) || minGcps < 3) {
    throw new Error("minGcps must be an integer of at least 3 for a reusable GCP affine");
  }
  const seedGeo = seedGeoRef(opts.seed, opts.pageW, opts.pageH);

  const pagePoints = opts.pagePoints.filter((p) => inNeatline(p, opts.seed.neatline, opts.pageW, opts.pageH));
  const matched = matchPagePointsToCadastre({
    pagePoints,
    pageW: opts.pageW,
    pageH: opts.pageH,
    seedGeo,
    cadastre: opts.cadastre,
    maxCandidateDistanceM,
    ...(opts.seed.neatline ? { neatline: opts.seed.neatline } : {}),
  });

  let selected = spreadMatches(
    matched.matches.sort((a, b) => a.distM - b.distM),
    opts.pageW,
    opts.pageH,
    maxGcps,
  );
  selected = tryFitMatches(selected, opts.pageW, opts.pageH, maxResidualM, minGcps, fit);
  selected = spreadMatches(selected, opts.pageW, opts.pageH, maxGcps);

  let residualMax: number | null = null;
  let residualRms: number | null = null;
  let holdoutMax: number | null = null;
  let holdoutRms: number | null = null;
  let affineGatePass: boolean | null = null;
  let affineGateReasons: string[] = [];
  let pass = false;
  let reason: string | undefined;
  let candidate: GcpFile | undefined;
  let reusableByPublicAffine = true;
  if (selected.length >= minGcps) {
    const validationCandidate = buildGcpFileFromAutoMatches({
      slug: opts.slug,
      pdf: opts.seed.pdf,
      pageW: opts.pageW,
      pageH: opts.pageH,
      matches: selected,
      ...(opts.seed.page !== undefined ? { page: opts.seed.page } : {}),
      ...(opts.seed.neatline ? { neatline: opts.seed.neatline } : {}),
    });
    try {
      buildGeoRefFromGcps(validationCandidate.gcps, opts.pageW, opts.pageH, validationCandidate.neatline);
    } catch {
      reusableByPublicAffine = false;
      affineGatePass = false;
      affineGateReasons = ["derived GCP geometry is degenerate for the public affine"];
    }
  }
  if (selected.length < minGcps) {
    reason = "only " + selected.length + " independent parcel/linework matches after residual pruning (< " + minGcps + ")";
  } else if (!reusableByPublicAffine) {
    reason = "derived GCP geometry is degenerate for the public affine";
  } else {
    const res = fitResiduals(selected, opts.pageW, opts.pageH, fit);
    selected = selected.map((m, i) => ({ ...m, residualM: res.residuals[i]! }));
    candidate = buildGcpFileFromAutoMatches({
      slug: opts.slug,
      pdf: opts.seed.pdf,
      pageW: opts.pageW,
      pageH: opts.pageH,
      matches: selected,
      ...(opts.seed.page !== undefined ? { page: opts.seed.page } : {}),
      ...(opts.seed.neatline ? { neatline: opts.seed.neatline } : {}),
    });
    residualMax = Number(res.max.toFixed(3));
    residualRms = Number(res.rms.toFixed(3));
    const h = holdoutStats(selected, opts.pageW, opts.pageH, fit);
    holdoutMax = h ? Number(h.max.toFixed(3)) : null;
    holdoutRms = h ? Number(h.rms.toFixed(3)) : null;
    pass = res.max <= maxResidualM && (!h || h.max <= maxResidualM);
    if (!pass) {
      reason = h && h.max > maxResidualM
        ? "matched parcel/linework holdout " + h.max.toFixed(2) + "m > " + maxResidualM + "m"
        : "matched parcel/linework residual " + res.max.toFixed(2) + "m > " + maxResidualM + "m";
    }

    if (pass && opts.affineGate !== false) {
      const decomposition = fit === "similarity"
        ? decomposeGcpSimilarity(candidate.gcps, opts.pageW, opts.pageH)
        : decomposeGcpAffine(candidate.gcps, opts.pageW, opts.pageH);
      if (!decomposition) {
        affineGatePass = false;
        affineGateReasons = ["derived GCP geometry is degenerate"];
      } else {
        const gate = evaluateAffineGate(decomposition, opts.affineGate);
        affineGatePass = gate.pass;
        affineGateReasons = gate.reasons;
      }
      if (!affineGatePass) {
        pass = false;
        reason = "affine geometry gate failed: " + affineGateReasons.join("; ");
      }
    }
  }

  return {
    slug: opts.slug,
    method: "cadastre-parcel-corner-vector-match",
    pass,
    ...(reason ? { reason } : {}),
    page_points: pagePoints.length,
    cadastre_vertices: matched.cadastreVertices,
    seed_candidate_matches: matched.matches.length,
    selected_gcps: selected.length,
    residual_max_m: residualMax,
    residual_rms_m: residualRms,
    holdout_max_m: holdoutMax,
    holdout_rms_m: holdoutRms,
    affine_gate_pass: affineGatePass,
    affine_gate_reasons: affineGateReasons,
    max_candidate_distance_m: maxCandidateDistanceM,
    max_residual_gate_m: maxResidualM,
    ...(pass && candidate ? { gcp_file: candidate } : {}),
  };
}
