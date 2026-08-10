/**
 * georef/autogcp.ts - pure vector/cadastre control-point discovery for T2 plans.
 *
 * This is the reusable compute from the acquisition auto-GCP path: SVG path
 * geometry parsing, cadastre vertex matching, residual pruning, holdout gating,
 * and coarse auto-seed rotation search. It deliberately has no PDF rendering,
 * OCR, filesystem, S3, network, or subprocess dependency. Callers pass a SVG
 * string or already extracted page points, plus an in-memory WGS84 cadastre.
 *
 * Ported from acquisition/src/lib/t2-autogcp.ts. The acquisition app remains
 * responsible for pdftocairo/pdftoppm/tesseract, file IO, and non-WGS84 seed
 * reprojection before calling this module.
 */
import type { FeatureCollection, Geometry, Position } from "@sentropic/geo-core";

import { fitAffine, type GeoRef } from "./affine.js";
import { buildGeoRefFromGcps, type Gcp, type GcpFile, type NeatlineFrac } from "./gcp.js";
import {
  DEFAULT_AFFINE_GATE,
  DEFAULT_ANISO_ARBITRATE_MAX_ANISOTROPY,
  decomposeGcpAffine,
  decomposeGcpSimilarity,
  evaluateAffineGate,
  type AffineDecomposition,
  type AffineGateOptions,
  type AffineGateResult,
} from "./gate.js";

const M_PER_DEG_LAT = 111320;

/** Page-to-ground fit model used for pruning and holdout residuals. */
export type AutoGcpFitMode = "affine" | "similarity";

/** A page point in top-left SVG/raster coordinates. */
export interface Pt {
  x: number;
  y: number;
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

/** One matched visible page vertex to one cadastre vertex. */
export interface AutoGcpMatch {
  pageX: number;
  pageY: number;
  lon: number;
  lat: number;
  distM: number;
  residualM?: number;
}

interface Similarity2D {
  s: number;
  cos: number;
  sin: number;
  tx: number;
  ty: number;
}

export interface ParseSvgVectorPointOptions {
  pageW: number;
  pageH: number;
  neatline?: NeatlineFrac | undefined;
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
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
  const n = (m[1]!.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  if (n.length !== 6) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  return { a: n[0]!, b: n[1]!, c: n[2]!, d: n[3]!, e: n[4]!, f: n[5]! };
}

function applyMatrix(p: Pt, m: Matrix): Pt {
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

function parsePathPoints(d: string, matrix: Matrix): Pt[] {
  const tokens = pathTokens(d);
  const out: Pt[] = [];
  const state = { i: 0 };
  let cmd = "";
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };

  const push = (p: Pt): void => {
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

function pathLength(pts: Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return total;
}

function bboxOfPts(pts: Pt[]): [number, number, number, number] {
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

function inNeatline(p: Pt, neatline: NeatlineFrac | undefined, pageW: number, pageH: number): boolean {
  if (!neatline) return true;
  const x0 = Math.min(neatline.fx0, neatline.fx1) * pageW;
  const x1 = Math.max(neatline.fx0, neatline.fx1) * pageW;
  const y0 = Math.min(neatline.fy0, neatline.fy1) * pageH;
  const y1 = Math.max(neatline.fy0, neatline.fy1) * pageH;
  const padX = (x1 - x0) * 0.01;
  const padY = (y1 - y0) * 0.01;
  return p.x >= x0 - padX && p.x <= x1 + padX && p.y >= y0 - padY && p.y <= y1 + padY;
}

/** Extract visible vector path vertices from a Poppler-like SVG string. */
export function parseSvgVectorPoints(svg: string, options: ParseSvgVectorPointOptions): Pt[] {
  const body = svg.includes("</defs>") ? svg.slice(svg.indexOf("</defs>") + "</defs>".length) : svg;
  const root = svg.match(/<svg\b([^>]*)>/);
  const svgW = svgNumber(root ? attr(root[1]!, "width") : undefined);
  const svgH = svgNumber(root ? attr(root[1]!, "height") : undefined);
  const pts: Pt[] = [];
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
      if (!inNeatline(p, options.neatline, options.pageW, options.pageH)) continue;
      const key = `${Math.round(p.x / 3)},${Math.round(p.y / 3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push(p);
    }
  }
  return pts;
}

function scanPositions(positions: Position[], cb: (p: Position) => void): void {
  for (const p of positions) cb(p);
}

function scanCoords(geom: Geometry | null | undefined, cb: (p: Position) => void): void {
  if (!geom) return;
  if (geom.type === "Point") cb(geom.coordinates);
  else if (geom.type === "MultiPoint" || geom.type === "LineString") scanPositions(geom.coordinates, cb);
  else if (geom.type === "MultiLineString" || geom.type === "Polygon") {
    for (const ring of geom.coordinates) scanPositions(ring, cb);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) for (const ring of poly) scanPositions(ring, cb);
  } else {
    for (const child of geom.geometries) scanCoords(child, cb);
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
      const key = `${Math.round(lon * 1e7)},${Math.round(lat * 1e7)}`;
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
    private readonly vertices: CadVertex[],
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
    return `${ix},${iy}`;
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

function affineResiduals(matches: AutoGcpMatch[], pageW: number, pageH: number): { residuals: number[]; max: number; rms: number } {
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
  fit: AutoGcpFitMode,
): { residuals: number[]; max: number; rms: number } {
  return fit === "similarity" ? similarityResiduals(matches, pageH) : affineResiduals(matches, pageW, pageH);
}

function spreadMatches(matches: AutoGcpMatch[], pageW: number, pageH: number, maxGcps: number): AutoGcpMatch[] {
  const bestByCell = new Map<string, AutoGcpMatch>();
  for (const m of matches) {
    const key = `${Math.floor((m.pageX / Math.max(pageW, 1)) * 12)},${Math.floor((m.pageY / Math.max(pageH, 1)) * 12)}`;
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
  fit: AutoGcpFitMode,
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

function holdoutStats(matches: AutoGcpMatch[], pageW: number, pageH: number, fit: AutoGcpFitMode): { max: number; rms: number } | null {
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
  const cLon = fitAffine(pagePts, train.map((m) => m.lon));
  const cLat = fitAffine(pagePts, train.map((m) => m.lat));
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
  return { max, rms: Math.sqrt(sumSq / holdout.length) };
}

function isWgs84Crs(crs: string | undefined): boolean {
  if (!crs) return true;
  const normalized = crs.toLowerCase().replace(/[\s_-]+/g, "");
  return normalized === "epsg:4326" || normalized === "epsg4326" || normalized === "wgs84" || normalized === "crs84";
}

function seedGeoRef(opts: AutoGcpVectorOptions): GeoRef {
  if (opts.seedGeoRef) return opts.seedGeoRef;
  if (!isWgs84Crs(opts.seed.crs)) {
    throw new Error("autogcp: non-WGS84 seed CRS must be reprojected by the acquisition layer before calling @sentropic/geo/georef");
  }
  return buildGeoRefFromGcps(opts.seed.gcps, opts.pageW, opts.pageH, opts.seed.neatline).geo;
}

function resolvePagePoints(opts: {
  pageW: number;
  pageH: number;
  neatline?: NeatlineFrac | undefined;
  pagePoints?: Pt[] | undefined;
  svg?: string | undefined;
}): Pt[] {
  if (opts.pagePoints) return opts.pagePoints.filter((p) => inNeatline(p, opts.neatline, opts.pageW, opts.pageH));
  if (opts.svg) return parseSvgVectorPoints(opts.svg, { pageW: opts.pageW, pageH: opts.pageH, neatline: opts.neatline });
  throw new Error("autogcp: provide either pagePoints or svg");
}

export interface AutoGcpVectorOptions {
  slug: string;
  pageW: number;
  pageH: number;
  seed: GcpFile;
  cadastre: FeatureCollection<Geometry | null>;
  /** Pre-extracted visible page vector vertices, in top-left page coordinates. */
  pagePoints?: Pt[];
  /** Poppler-like SVG string; parsed only when pagePoints are not supplied. */
  svg?: string;
  /** Optional already-built seed georef, for callers that reprojected CRS upstream. */
  seedGeoRef?: GeoRef;
  maxCandidateDistanceM?: number;
  maxResidualM?: number;
  minGcps?: number;
  maxGcps?: number;
  fit?: AutoGcpFitMode;
}

export interface AutoGcpVectorReport {
  slug: string;
  method: "cadastre-parcel-corner-vector-match";
  pass: boolean;
  reason?: string;
  svg_points: number;
  cadastre_vertices: number;
  seed_candidate_matches: number;
  selected_gcps: number;
  residual_max_m: number | null;
  residual_rms_m: number | null;
  holdout_max_m: number | null;
  holdout_rms_m: number | null;
  max_candidate_distance_m: number;
  max_residual_gate_m: number;
  gcp_file?: GcpFile;
}

export function buildGcpFileFromMatches(opts: AutoGcpVectorOptions, matches: AutoGcpMatch[]): GcpFile {
  const gcps: Gcp[] = matches.map((m, i) => ({
    fx: m.pageX / opts.pageW,
    fy: m.pageY / opts.pageH,
    lon: m.lon,
    lat: m.lat,
    source: "cadastre-parcel-corner-match",
    independent: true,
    note:
      `autonomous cadastre parcel/linework corner match #${i + 1}; ` +
      `seed_nearest=${m.distM.toFixed(2)}m; fit_residual=${(m.residualM ?? 0).toFixed(2)}m`,
  }));
  return {
    slug: opts.slug,
    pdf: opts.seed.pdf,
    ...(opts.seed.page !== undefined ? { page: opts.seed.page } : {}),
    pageW: opts.pageW,
    pageH: opts.pageH,
    gcps,
    ...(opts.seed.neatline ? { neatline: opts.seed.neatline } : {}),
  };
}

/** Match visible page vector vertices to cadastre vertices and gate the fit. */
export function deriveAutonomousGcpsFromVectors(opts: AutoGcpVectorOptions): AutoGcpVectorReport {
  const maxCandidateDistanceM = opts.maxCandidateDistanceM ?? 12;
  const maxResidualM = opts.maxResidualM ?? 30;
  const minGcps = opts.minGcps ?? 12;
  const maxGcps = opts.maxGcps ?? 48;
  const fit: AutoGcpFitMode = opts.fit ?? "affine";
  const pagePoints = resolvePagePoints({ pageW: opts.pageW, pageH: opts.pageH, neatline: opts.seed.neatline, pagePoints: opts.pagePoints, svg: opts.svg });
  const { vertices, lat0 } = cadastreVertices(opts.cadastre);

  if (vertices.length === 0 || !Number.isFinite(lat0)) {
    return {
      slug: opts.slug,
      method: "cadastre-parcel-corner-vector-match",
      pass: false,
      reason: "cadastre has no usable WGS84 vertices",
      svg_points: pagePoints.length,
      cadastre_vertices: vertices.length,
      seed_candidate_matches: 0,
      selected_gcps: 0,
      residual_max_m: null,
      residual_rms_m: null,
      holdout_max_m: null,
      holdout_rms_m: null,
      max_candidate_distance_m: maxCandidateDistanceM,
      max_residual_gate_m: maxResidualM,
    };
  }

  const grid = new VertexGrid(vertices, Math.max(20, maxCandidateDistanceM * 2));
  const geo = seedGeoRef(opts);
  const matches: AutoGcpMatch[] = [];
  for (const p of pagePoints) {
    const [lon, lat] = geo.topLeftToLonLat(p.x, p.y);
    const [xm, ym] = project(lon, lat, lat0);
    const near = grid.nearest(xm, ym, maxCandidateDistanceM);
    if (!near) continue;
    matches.push({ pageX: p.x, pageY: p.y, lon: near.v.lon, lat: near.v.lat, distM: near.d });
  }

  let selected = spreadMatches(matches.sort((a, b) => a.distM - b.distM), opts.pageW, opts.pageH, maxGcps);
  selected = tryFitMatches(selected, opts.pageW, opts.pageH, maxResidualM, minGcps, fit);
  selected = spreadMatches(selected, opts.pageW, opts.pageH, maxGcps);

  let residualMax: number | null = null;
  let residualRms: number | null = null;
  let holdoutMax: number | null = null;
  let holdoutRms: number | null = null;
  let pass = false;
  let reason: string | undefined;
  if (selected.length < minGcps) {
    reason = `only ${selected.length} independent parcel/linework matches after residual pruning (< ${minGcps})`;
  } else {
    const res = fitResiduals(selected, opts.pageW, opts.pageH, fit);
    selected = selected.map((m, i) => ({ ...m, residualM: res.residuals[i]! }));
    residualMax = Number(res.max.toFixed(3));
    residualRms = Number(res.rms.toFixed(3));
    const h = holdoutStats(selected, opts.pageW, opts.pageH, fit);
    holdoutMax = h ? Number(h.max.toFixed(3)) : null;
    holdoutRms = h ? Number(h.rms.toFixed(3)) : null;
    pass = res.max <= maxResidualM && (!h || h.max <= maxResidualM);
    if (!pass) reason = `matched parcel/linework residual ${res.max.toFixed(2)}m > ${maxResidualM}m`;
  }

  return {
    slug: opts.slug,
    method: "cadastre-parcel-corner-vector-match",
    pass,
    ...(reason ? { reason } : {}),
    svg_points: pagePoints.length,
    cadastre_vertices: vertices.length,
    seed_candidate_matches: matches.length,
    selected_gcps: selected.length,
    residual_max_m: residualMax,
    residual_rms_m: residualRms,
    holdout_max_m: holdoutMax,
    holdout_rms_m: holdoutRms,
    max_candidate_distance_m: maxCandidateDistanceM,
    max_residual_gate_m: maxResidualM,
    ...(pass ? { gcp_file: buildGcpFileFromMatches(opts, selected) } : {}),
  };
}

export interface AutoSeedVectorOptions {
  slug: string;
  pdf: string;
  page?: number;
  pageW: number;
  pageH: number;
  cadastre: FeatureCollection<Geometry | null>;
  pagePoints?: Pt[];
  svg?: string;
  maxCandidateDistanceM?: number;
  maxResidualM?: number;
  minGcps?: number;
  maxGcps?: number;
  fit?: AutoGcpFitMode;
  maxAnisotropy?: number;
  orientationToleranceDeg?: number;
  maxShearDeg?: number;
  convergenceToleranceDeg?: number;
  ambiguityMinGcps?: number;
  anisoLotArbitrate?: boolean;
  anisoArbitrateMaxAnisotropy?: number;
}

export interface AutoSeedAttempt {
  extent: string;
  rotation: number;
  extent_frac: NeatlineFrac;
  pass: boolean;
  reason?: string;
  selected_gcps: number;
  residual_max_m: number | null;
  residual_rms_m: number | null;
  holdout_max_m: number | null;
  holdout_rms_m: number | null;
  seed_candidate_matches: number;
  anisotropy?: number;
  singular_ratio?: number;
  bearing_right_deg?: number;
  bearing_down_deg?: number;
  mirror?: boolean;
  shear_deg?: number;
  affine_gate_pass?: boolean;
  affine_gate_reason?: string;
}

export interface AutoSeedOrientationCandidate {
  extent: string;
  rotation: number;
  bearing_right_deg: number;
  selected_gcps: number;
  residual_max_m: number | null;
  holdout_max_m: number | null;
  gcp_file: GcpFile;
}

export interface AutoSeedVectorReport {
  slug: string;
  method: "auto-seed-cadastre-bbox-rotations";
  fit: AutoGcpFitMode;
  pass: boolean;
  reason?: string;
  cadastre_features: number;
  cadastre_bbox_wgs84: [number, number, number, number];
  svg_points: number;
  extents: Record<string, NeatlineFrac | null>;
  attempts: AutoSeedAttempt[];
  best?: { extent: string; rotation: number };
  residual_max_m: number | null;
  holdout_max_m: number | null;
  selected_gcps: number | null;
  max_candidate_distance_m: number;
  max_residual_gate_m: number;
  affine_gate?: AffineGateResult;
  gcp_file?: GcpFile;
  orientation_candidates?: AutoSeedOrientationCandidate[];
  aniso_arbitrate_candidates?: AutoSeedOrientationCandidate[];
}

function cadastreLonLatBbox(cadastre: FeatureCollection<Geometry | null>): [number, number, number, number] {
  let lonMin = Infinity;
  let latMin = Infinity;
  let lonMax = -Infinity;
  let latMax = -Infinity;
  for (const f of cadastre.features) {
    scanCoords(f.geometry, (p) => {
      const lon = p[0];
      const lat = p[1];
      if (lon < lonMin) lonMin = lon;
      if (lon > lonMax) lonMax = lon;
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
    });
  }
  return [lonMin, latMin, lonMax, latMax];
}

function fracBox(x0: number, y0: number, x1: number, y1: number, pageW: number, pageH: number): NeatlineFrac {
  return {
    fx0: Math.max(0, Math.min(1, x0 / pageW)),
    fy0: Math.max(0, Math.min(1, y0 / pageH)),
    fx1: Math.max(0, Math.min(1, x1 / pageW)),
    fy1: Math.max(0, Math.min(1, y1 / pageH)),
  };
}

function drawnExtentFull(points: Pt[], pageW: number, pageH: number): NeatlineFrac | null {
  if (points.length < 8) return null;
  const [x0, y0, x1, y1] = bboxOfPts(points);
  return fracBox(x0, y0, x1, y1, pageW, pageH);
}

function drawnExtentPercentile(points: Pt[], pageW: number, pageH: number, f = 0.02): NeatlineFrac | null {
  if (points.length < 50) return null;
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const q = (a: number[], t: number): number => a[Math.max(0, Math.min(a.length - 1, Math.floor((a.length - 1) * t)))]!;
  return fracBox(q(xs, f), q(ys, f), q(xs, 1 - f), q(ys, 1 - f), pageW, pageH);
}

function drawnExtentDensity(points: Pt[], pageW: number, pageH: number): NeatlineFrac | null {
  if (points.length < 200) return null;
  const cell = Math.max(pageW, pageH) / 120;
  const nx = Math.max(4, Math.ceil(pageW / cell));
  const ny = Math.max(4, Math.ceil(pageH / cell));
  const counts = new Int32Array(nx * ny);
  for (const p of points) {
    const ix = Math.min(nx - 1, Math.max(0, Math.floor(p.x / cell)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor(p.y / cell)));
    counts[iy * nx + ix]!++;
  }
  const nz = [...counts].filter((c) => c > 0).sort((a, b) => a - b);
  if (nz.length < 10) return null;
  const p85 = nz[Math.floor(nz.length * 0.85)]!;
  const thMain = Math.max(3, p85 * 0.15);
  const thLow = Math.max(2, p85 * 0.08);
  const at = (ix: number, iy: number): number => (ix < 0 || iy < 0 || ix >= nx || iy >= ny ? 0 : counts[iy * nx + ix]!);
  let minix = nx;
  let miniy = ny;
  let maxix = -1;
  let maxiy = -1;
  let kept = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (at(ix, iy) < thMain) continue;
      const hor = at(ix - 1, iy) >= thLow || at(ix + 1, iy) >= thLow;
      const ver = at(ix, iy - 1) >= thLow || at(ix, iy + 1) >= thLow;
      if (!hor || !ver) continue;
      kept++;
      if (ix < minix) minix = ix;
      if (ix > maxix) maxix = ix;
      if (iy < miniy) miniy = iy;
      if (iy > maxiy) maxiy = iy;
    }
  }
  if (kept < 4 || maxix < 0) return null;
  return fracBox(minix * cell, miniy * cell, (maxix + 1) * cell, (maxiy + 1) * cell, pageW, pageH);
}

function inflateFrac(b: NeatlineFrac, pad: number): NeatlineFrac {
  const w = b.fx1 - b.fx0;
  const h = b.fy1 - b.fy0;
  return {
    fx0: Math.max(0, b.fx0 - w * pad),
    fy0: Math.max(0, b.fy0 - h * pad),
    fx1: Math.min(1, b.fx1 + w * pad),
    fy1: Math.min(1, b.fy1 + h * pad),
  };
}

function buildRotationSeedGcps(extent: NeatlineFrac, bbox: [number, number, number, number], rot: number): Gcp[] {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  const x0 = Math.min(extent.fx0, extent.fx1);
  const x1 = Math.max(extent.fx0, extent.fx1);
  const y0 = Math.min(extent.fy0, extent.fy1);
  const y1 = Math.max(extent.fy0, extent.fy1);
  const pageCorners: Array<[number, number]> = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const cadCorners: Array<[number, number]> = [
    [lonMin, latMax],
    [lonMax, latMax],
    [lonMax, latMin],
    [lonMin, latMin],
  ];
  const shift = ((rot % 4) + 4) % 4;
  return pageCorners.map(([fx, fy], i) => {
    const [lon, lat] = cadCorners[(i + shift) % 4]!;
    return {
      fx,
      fy,
      lon,
      lat,
      source: "auto-seed-cadastre-bbox-corner",
      note: `auto-seed coarse corner (rot${shift * 90}); COARSE SEED ONLY`,
    };
  });
}

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function angularDistDeg(a: number, b: number): number {
  return Math.abs(normalizeDeg(a - b));
}

export function deriveAutoSeedGcpsFromVectors(opts: AutoSeedVectorOptions): AutoSeedVectorReport {
  const maxCandidateDistanceM = opts.maxCandidateDistanceM ?? 450;
  const maxResidualM = opts.maxResidualM ?? 30;
  const minGcps = opts.minGcps ?? 12;
  const maxGcps = opts.maxGcps ?? 48;
  const fit: AutoGcpFitMode = opts.fit ?? "affine";
  const decompose = fit === "similarity" ? decomposeGcpSimilarity : decomposeGcpAffine;
  const ambiguityMinGcps = Math.max(3, Math.min(opts.ambiguityMinGcps ?? Math.min(6, minGcps), minGcps));

  const bbox = cadastreLonLatBbox(opts.cadastre);
  if (!Number.isFinite(bbox[0]) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    throw new Error(`cadastre has no usable WGS84 bbox for ${opts.slug}`);
  }

  const allPoints = resolvePagePoints({ pageW: opts.pageW, pageH: opts.pageH, pagePoints: opts.pagePoints, svg: opts.svg });
  const density = drawnExtentDensity(allPoints, opts.pageW, opts.pageH);
  const extents: Record<string, NeatlineFrac | null> = {
    density,
    "density+10%": density ? inflateFrac(density, 0.1) : null,
    "density+20%": density ? inflateFrac(density, 0.2) : null,
    percentile: drawnExtentPercentile(allPoints, opts.pageW, opts.pageH, 0.02),
    full: drawnExtentFull(allPoints, opts.pageW, opts.pageH),
  };

  const anisoArbitrateMax = opts.anisoArbitrateMaxAnisotropy ?? DEFAULT_ANISO_ARBITRATE_MAX_ANISOTROPY;
  const affineGateOpts: AffineGateOptions = {
    ...(opts.maxAnisotropy !== undefined ? { maxAnisotropy: opts.maxAnisotropy } : {}),
    ...(opts.orientationToleranceDeg !== undefined ? { orientationToleranceDeg: opts.orientationToleranceDeg } : {}),
    ...(opts.maxShearDeg !== undefined ? { maxShearDeg: opts.maxShearDeg } : {}),
    ...(opts.anisoLotArbitrate ? { hardAnisotropy: anisoArbitrateMax } : {}),
  };

  const maxAniso = affineGateOpts.maxAnisotropy ?? DEFAULT_AFFINE_GATE.maxAnisotropy;
  const attempts: AutoSeedAttempt[] = [];
  const gateClean: Array<{ attempt: AutoSeedAttempt; report: AutoGcpVectorReport; gate: AffineGateResult }> = [];
  const plausible: AffineDecomposition[] = [];
  const servable: AutoSeedOrientationCandidate[] = [];
  const anisoArbitrable: AutoSeedOrientationCandidate[] = [];

  for (const [extentName, extent] of Object.entries(extents)) {
    if (!extent) continue;
    for (const rot of [0, 1, 2, 3]) {
      const seed: GcpFile = {
        slug: opts.slug,
        pdf: opts.pdf,
        ...(opts.page !== undefined ? { page: opts.page } : {}),
        pageW: opts.pageW,
        pageH: opts.pageH,
        gcps: buildRotationSeedGcps(extent, bbox, rot),
        neatline: extent,
      };
      const report = deriveAutonomousGcpsFromVectors({
        slug: opts.slug,
        pageW: opts.pageW,
        pageH: opts.pageH,
        seed,
        cadastre: opts.cadastre,
        maxCandidateDistanceM,
        maxResidualM,
        minGcps: ambiguityMinGcps,
        maxGcps,
        fit,
        pagePoints: allPoints,
      });
      const attempt: AutoSeedAttempt = {
        extent: extentName,
        rotation: rot * 90,
        extent_frac: extent,
        pass: report.pass,
        ...(report.reason ? { reason: report.reason } : {}),
        selected_gcps: report.selected_gcps,
        residual_max_m: report.residual_max_m,
        residual_rms_m: report.residual_rms_m,
        holdout_max_m: report.holdout_max_m,
        holdout_rms_m: report.holdout_rms_m,
        seed_candidate_matches: report.seed_candidate_matches,
      };
      if (report.pass && report.gcp_file) {
        const decomp = decompose(report.gcp_file.gcps, opts.pageW, opts.pageH);
        if (decomp) {
          const gate = evaluateAffineGate(decomp, affineGateOpts);
          attempt.anisotropy = Number(decomp.anisotropy.toFixed(3));
          attempt.singular_ratio = Number(decomp.singularRatio.toFixed(3));
          attempt.bearing_right_deg = Number(decomp.bearingRightDeg.toFixed(1));
          attempt.bearing_down_deg = Number(decomp.bearingDownDeg.toFixed(1));
          attempt.mirror = decomp.mirror;
          attempt.shear_deg = Number(decomp.shearDeg.toFixed(1));
          attempt.affine_gate_pass = gate.pass;
          if (!gate.pass) attempt.affine_gate_reason = gate.reasons.join("; ");
          if (gate.pass && report.selected_gcps >= minGcps) gateClean.push({ attempt, report, gate });
          const isometric = !decomp.mirror && decomp.anisotropy <= maxAniso && decomp.singularRatio <= maxAniso;
          if (isometric) plausible.push(decomp);
          if (isometric && report.selected_gcps >= minGcps) {
            servable.push({
              extent: extentName,
              rotation: rot * 90,
              bearing_right_deg: Number(decomp.bearingRightDeg.toFixed(1)),
              selected_gcps: report.selected_gcps,
              residual_max_m: report.residual_max_m,
              holdout_max_m: report.holdout_max_m,
              gcp_file: report.gcp_file,
            });
          }
          if (opts.anisoLotArbitrate && gate.anisoArbitrate && report.selected_gcps >= minGcps) {
            anisoArbitrable.push({
              extent: extentName,
              rotation: rot * 90,
              bearing_right_deg: Number(decomp.bearingRightDeg.toFixed(1)),
              selected_gcps: report.selected_gcps,
              residual_max_m: report.residual_max_m,
              holdout_max_m: report.holdout_max_m,
              gcp_file: report.gcp_file,
            });
          }
        }
      }
      attempts.push(attempt);
    }
  }

  let best: { attempt: AutoSeedAttempt; report: AutoGcpVectorReport; gate: AffineGateResult } | null = null;
  for (const c of gateClean) {
    if (
      !best ||
      (c.report.residual_max_m ?? Infinity) < (best.report.residual_max_m ?? Infinity) ||
      ((c.report.residual_max_m ?? Infinity) === (best.report.residual_max_m ?? Infinity) &&
        c.report.selected_gcps > best.report.selected_gcps)
    ) {
      best = c;
    }
  }

  const convTol = opts.convergenceToleranceDeg ?? 10;
  let ambiguityReason: string | undefined;
  if (best && plausible.length >= 2) {
    let maxSpread = 0;
    let a0 = 0;
    let a1 = 0;
    for (let i = 0; i < plausible.length; i++) {
      for (let j = i + 1; j < plausible.length; j++) {
        const s = angularDistDeg(plausible[i]!.bearingRightDeg, plausible[j]!.bearingRightDeg);
        if (s > maxSpread) {
          maxSpread = s;
          a0 = plausible[i]!.bearingRightDeg;
          a1 = plausible[j]!.bearingRightDeg;
        }
      }
    }
    if (maxSpread > convTol) {
      ambiguityReason =
        `orientation ambiguity: ${plausible.length} plausible (non-mirror, isometric) fits ` +
        `disagree on page-right bearing by ${maxSpread.toFixed(1)} deg (e.g. ${a0.toFixed(1)} deg vs ${a1.toFixed(1)} deg) > ${convTol} deg`;
    }
  }
  if (ambiguityReason) best = null;

  let orientationCandidates: AutoSeedOrientationCandidate[] | undefined;
  if (!best && servable.length >= 2) {
    const byBucket = new Map<number, AutoSeedOrientationCandidate>();
    for (const c of servable) {
      const bucket = ((Math.round(c.bearing_right_deg / 90) * 90) % 360 + 360) % 360;
      const prev = byBucket.get(bucket);
      if (
        !prev ||
        (c.residual_max_m ?? Infinity) < (prev.residual_max_m ?? Infinity) ||
        ((c.residual_max_m ?? Infinity) === (prev.residual_max_m ?? Infinity) && c.selected_gcps > prev.selected_gcps)
      ) {
        byBucket.set(bucket, c);
      }
    }
    if (byBucket.size >= 2) {
      orientationCandidates = [...byBucket.values()].sort((a, b) => a.bearing_right_deg - b.bearing_right_deg);
    }
  }

  let anisoArbitrateCandidates: AutoSeedOrientationCandidate[] | undefined;
  if (!best && opts.anisoLotArbitrate && anisoArbitrable.length >= 1) {
    anisoArbitrateCandidates = [...anisoArbitrable].sort(
      (a, b) => (a.residual_max_m ?? Infinity) - (b.residual_max_m ?? Infinity),
    );
  }

  const anyResidualPass = attempts.some((a) => a.pass);
  let reason: string | undefined;
  if (!best) {
    if (ambiguityReason) reason = ambiguityReason;
    else if (!anyResidualPass) reason = "no (extent x rotation) seed cleared the residual+holdout gate";
    else if (gateClean.length === 0) {
      reason =
        `${attempts.filter((a) => a.pass).length} seed(s) cleared the residual+holdout gate but none cleared ` +
        "the orientation/isotropy gate (anisotropy/mirror/north-up)";
    } else reason = "auto-seed rejected by orientation/isotropy gate";
  }

  return {
    slug: opts.slug,
    method: "auto-seed-cadastre-bbox-rotations",
    fit,
    pass: !!best,
    ...(reason ? { reason } : {}),
    cadastre_features: opts.cadastre.features.length,
    cadastre_bbox_wgs84: bbox,
    svg_points: allPoints.length,
    extents,
    attempts,
    ...(best ? { best: { extent: best.attempt.extent, rotation: best.attempt.rotation } } : {}),
    residual_max_m: best ? best.report.residual_max_m : null,
    holdout_max_m: best ? best.report.holdout_max_m : null,
    selected_gcps: best ? best.report.selected_gcps : null,
    max_candidate_distance_m: maxCandidateDistanceM,
    max_residual_gate_m: maxResidualM,
    ...(best ? { affine_gate: best.gate } : {}),
    ...(best && best.report.gcp_file ? { gcp_file: best.report.gcp_file } : {}),
    ...(orientationCandidates ? { orientation_candidates: orientationCandidates } : {}),
    ...(anisoArbitrateCandidates ? { aniso_arbitrate_candidates: anisoArbitrateCandidates } : {}),
  };
}
