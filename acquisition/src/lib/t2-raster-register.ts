/**
 * Local-only raster image registration for T2 zoning plans.
 *
 * This is the raster sibling of t2-autogcp: it starts from a coarse seed GCP
 * only as a search prior, detects raster corner/edge candidates in the rendered
 * plan, renders real cadastre lot edges into the same page space, and emits
 * independent controls only when raster features match nearby real cadastre
 * vertices and survive residual plus holdout gates.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection, Geometry, Position } from "geojson";

import { fitAffine } from "./t1-georef.js";
import { buildGeoRefFromGcpsCrs, type Gcp, type GcpFile, type NeatlineFrac } from "./t2-georef.js";

const M_PER_DEG_LAT = 111320;

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface EdgeImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RasterCorner {
  x: number;
  y: number;
  response: number;
}

export interface RasterRegisterOptions {
  slug: string;
  pdfPath: string;
  page: number;
  pageW: number;
  pageH: number;
  seed: GcpFile;
  cadastre: FeatureCollection;
  dpi?: number;
  maxCandidateDistanceM?: number;
  maxResidualM?: number;
  minGcps?: number;
  maxGcps?: number;
  maxPlanCorners?: number;
  minPatchScore?: number;
}

export interface RasterRegisterReport {
  slug: string;
  method: "cadastre-raster-corner-image-registration";
  pass: boolean;
  reason?: string;
  dpi: number;
  plan_raster_corners: number;
  reference_raster_corners: number;
  cadastre_vertices: number;
  seed_candidate_matches: number;
  patch_verified_matches: number;
  selected_gcps: number;
  residual_max_m: number | null;
  residual_rms_m: number | null;
  holdout_max_m: number | null;
  holdout_rms_m: number | null;
  max_candidate_distance_m: number;
  min_patch_score: number;
  max_residual_gate_m: number;
  gcp_file?: GcpFile;
}

interface Pt {
  x: number;
  y: number;
}

interface CadVertex {
  lon: number;
  lat: number;
  xm: number;
  ym: number;
}

interface ProjectedVertex extends CadVertex {
  pageX: number;
  pageY: number;
  px: number;
  py: number;
}

interface RasterMatch {
  pageX: number;
  pageY: number;
  lon: number;
  lat: number;
  distM: number;
  patchScore: number;
  residualM?: number;
}

function readToken(buf: Buffer, state: { i: number }): string {
  while (state.i < buf.length) {
    const c = buf[state.i]!;
    if (c === 0x23) {
      while (state.i < buf.length && buf[state.i] !== 0x0a) state.i++;
    } else if (c <= 0x20) {
      state.i++;
    } else {
      break;
    }
  }
  const start = state.i;
  while (state.i < buf.length && buf[state.i]! > 0x20 && buf[state.i] !== 0x23) state.i++;
  return buf.subarray(start, state.i).toString("ascii");
}

export function parsePgm(buf: Buffer): GrayImage {
  const state = { i: 0 };
  const magic = readToken(buf, state);
  if (magic !== "P5" && magic !== "P2") throw new Error(`unsupported PGM magic ${magic}`);
  const width = Number(readToken(buf, state));
  const height = Number(readToken(buf, state));
  const maxVal = Number(readToken(buf, state));
  if (!(width > 0) || !(height > 0) || !(maxVal > 0) || maxVal > 255) {
    throw new Error(`invalid PGM header ${width}x${height} max=${maxVal}`);
  }

  if (magic === "P2") {
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) {
      const t = readToken(buf, state);
      if (!t) throw new Error("truncated P2 PGM");
      data[i] = Math.round((Number(t) / maxVal) * 255);
    }
    return { width, height, data };
  }

  if (state.i < buf.length && buf[state.i]! <= 0x20) state.i++;
  const raw = buf.subarray(state.i, state.i + width * height);
  if (raw.length !== width * height) throw new Error("truncated P5 PGM");
  const data = new Uint8Array(raw.length);
  if (maxVal === 255) data.set(raw);
  else {
    for (let i = 0; i < raw.length; i++) data[i] = Math.round((raw[i]! / maxVal) * 255);
  }
  return { width, height, data };
}

export function renderPdfPagePgm(pdfPath: string, page: number, dpi: number): GrayImage {
  const dir = mkdtempSync(join(tmpdir(), "t2-raster-register-"));
  const base = join(dir, "page");
  const ret = spawnSync("pdftoppm", [
    "-f",
    String(page),
    "-l",
    String(page),
    "-singlefile",
    "-r",
    String(dpi),
    "-gray",
    pdfPath,
    base,
  ]);
  if (ret.status !== 0) {
    const err = ret.stderr.toString("utf8").trim();
    throw new Error(`pdftoppm failed: ${err || `exit ${ret.status}`}`);
  }
  const pgm = `${base}.pgm`;
  if (!existsSync(pgm)) throw new Error(`pdftoppm did not write ${pgm}`);
  return parsePgm(readFileSync(pgm));
}

export function edgeMaskFromGray(img: GrayImage, gradientThreshold = 55, darkThreshold = 150): EdgeImage {
  const out = new Uint8Array(img.width * img.height);
  const w = img.width;
  const h = img.height;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -img.data[i - w - 1]! - 2 * img.data[i - 1]! - img.data[i + w - 1]! +
        img.data[i - w + 1]! + 2 * img.data[i + 1]! + img.data[i + w + 1]!;
      const gy =
        -img.data[i - w - 1]! - 2 * img.data[i - w]! - img.data[i - w + 1]! +
        img.data[i + w - 1]! + 2 * img.data[i + w]! + img.data[i + w + 1]!;
      if (Math.abs(gx) + Math.abs(gy) >= gradientThreshold || img.data[i]! <= darkThreshold) out[i] = 1;
    }
  }
  return { width: w, height: h, data: out };
}

function neatlinePixelBounds(
  neatline: NeatlineFrac | undefined,
  pageW: number,
  pageH: number,
  scale: number,
  width: number,
  height: number,
): [number, number, number, number] {
  if (!neatline) return [0, 0, width - 1, height - 1];
  const x0 = Math.max(0, Math.floor(Math.min(neatline.fx0, neatline.fx1) * pageW * scale));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(neatline.fx0, neatline.fx1) * pageW * scale));
  const y0 = Math.max(0, Math.floor(Math.min(neatline.fy0, neatline.fy1) * pageH * scale));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(neatline.fy0, neatline.fy1) * pageH * scale));
  return [x0, y0, x1, y1];
}

export function detectRasterCorners(
  img: GrayImage,
  edges: EdgeImage,
  opts: {
    maxPoints: number;
    pageW: number;
    pageH: number;
    scale: number;
    neatline?: NeatlineFrac;
    cellPx?: number;
    minDistancePx?: number;
  },
): RasterCorner[] {
  const cell = opts.cellPx ?? 14;
  const minDistance = opts.minDistancePx ?? 10;
  const [bx0, by0, bx1, by1] = neatlinePixelBounds(opts.neatline, opts.pageW, opts.pageH, opts.scale, img.width, img.height);
  const best = new Map<string, RasterCorner>();
  const w = img.width;
  const h = img.height;
  for (let y = Math.max(3, by0); y <= Math.min(h - 4, by1); y += 2) {
    for (let x = Math.max(3, bx0); x <= Math.min(w - 4, bx1); x += 2) {
      if (edges.data[y * w + x] === 0) continue;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let yy = y - 2; yy <= y + 2; yy++) {
        for (let xx = x - 2; xx <= x + 2; xx++) {
          const i = yy * w + xx;
          const gx = img.data[i + 1]! - img.data[i - 1]!;
          const gy = img.data[i + w]! - img.data[i - w]!;
          sxx += gx * gx;
          syy += gy * gy;
          sxy += gx * gy;
        }
      }
      const det = sxx * syy - sxy * sxy;
      const trace = sxx + syy;
      const response = det - 0.04 * trace * trace;
      if (response <= 0) continue;
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      const prev = best.get(key);
      if (!prev || response > prev.response) best.set(key, { x, y, response });
    }
  }

  const sorted = [...best.values()].sort((a, b) => b.response - a.response);
  const out: RasterCorner[] = [];
  const minD2 = minDistance * minDistance;
  for (const p of sorted) {
    let keep = true;
    for (const q of out) {
      if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < minD2) {
        keep = false;
        break;
      }
    }
    if (!keep) continue;
    out.push(p);
    if (out.length >= opts.maxPoints) break;
  }
  return out;
}

function scanCoords(geom: Geometry | null | undefined, cb: (p: Position) => void): void {
  if (!geom) return;
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) for (const p of ring) cb(p);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) for (const ring of poly) for (const p of ring) cb(p);
  }
}

function scanRings(geom: Geometry | null | undefined, cb: (ring: Position[]) => void): void {
  if (!geom) return;
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) cb(ring);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) for (const ring of poly) cb(ring);
  }
}

function cadastreVertices(cadastre: FeatureCollection): { vertices: CadVertex[]; lat0: number } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const f of cadastre.features) {
    scanCoords(f.geometry, (p) => {
      const lat = p[1]!;
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
      const lon = p[0]!;
      const lat = p[1]!;
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

function seedInverse(seed: GcpFile, pageW: number, pageH: number): { toPage: (lon: number, lat: number) => Pt } {
  const pts = seed.gcps.map((g) => [g.lon, g.lat] as [number, number]);
  const xs = seed.gcps.map((g) => g.fx * pageW);
  const ys = seed.gcps.map((g) => g.fy * pageH);
  const cx = fitAffine(pts, xs);
  const cy = fitAffine(pts, ys);
  return {
    toPage: (lon, lat) => ({
      x: cx[0] * lon + cx[1] * lat + cx[2],
      y: cy[0] * lon + cy[1] * lat + cy[2],
    }),
  };
}

function drawLine(img: GrayImage, x0: number, y0: number, x1: number, y1: number): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const sx = x < tx ? 1 : -1;
  const dy = -Math.abs(ty - y);
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < img.width + img.height + Math.abs(tx - x0) + Math.abs(ty - y0) + 10; guard++) {
    if (x >= 0 && x < img.width && y >= 0 && y < img.height) {
      const i = y * img.width + x;
      img.data[i] = 0;
      if (x + 1 < img.width) img.data[i + 1] = 0;
      if (y + 1 < img.height) img.data[i + img.width] = 0;
    }
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function renderCadastreReference(
  cadastre: FeatureCollection,
  seed: GcpFile,
  pageW: number,
  pageH: number,
  width: number,
  height: number,
  scale: number,
  vertices: CadVertex[],
): { image: GrayImage; projectedVertices: ProjectedVertex[] } {
  const inv = seedInverse(seed, pageW, pageH);
  const image: GrayImage = { width, height, data: new Uint8Array(width * height).fill(255) };
  const projectedVertices = vertices.map((v) => {
    const page = inv.toPage(v.lon, v.lat);
    return { ...v, pageX: page.x, pageY: page.y, px: page.x * scale, py: page.y * scale };
  });

  for (const f of cadastre.features) {
    scanRings(f.geometry, (ring) => {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!;
        const b = ring[i]!;
        const pa = inv.toPage(a[0]!, a[1]!);
        const pb = inv.toPage(b[0]!, b[1]!);
        const ax = pa.x * scale;
        const ay = pa.y * scale;
        const bx = pb.x * scale;
        const by = pb.y * scale;
        if (
          Math.max(ax, bx) < -20 ||
          Math.min(ax, bx) > width + 20 ||
          Math.max(ay, by) < -20 ||
          Math.min(ay, by) > height + 20
        ) {
          continue;
        }
        drawLine(image, ax, ay, bx, by);
      }
    });
  }
  return { image, projectedVertices };
}

function edgeAtDilated(edges: EdgeImage, x: number, y: number): boolean {
  const ix = Math.round(x);
  const iy = Math.round(y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = ix + dx;
      const yy = iy + dy;
      if (xx < 0 || yy < 0 || xx >= edges.width || yy >= edges.height) continue;
      if (edges.data[yy * edges.width + xx] !== 0) return true;
    }
  }
  return false;
}

export function patchEdgeScore(
  plan: EdgeImage,
  ref: EdgeImage,
  planX: number,
  planY: number,
  refX: number,
  refY: number,
  radius = 12,
  maxShift = 3,
): number {
  let best = 0;
  for (let sy = -maxShift; sy <= maxShift; sy++) {
    for (let sx = -maxShift; sx <= maxShift; sx++) {
      let planCount = 0;
      let refCount = 0;
      let overlap = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const pe = edgeAtDilated(plan, planX + dx, planY + dy);
          const re = edgeAtDilated(ref, refX + dx + sx, refY + dy + sy);
          if (pe) planCount++;
          if (re) refCount++;
          if (pe && re) overlap++;
        }
      }
      if (planCount < 8 || refCount < 8) continue;
      const score = (2 * overlap) / (planCount + refCount);
      if (score > best) best = score;
    }
  }
  return best;
}

function affineResiduals(matches: RasterMatch[], pageW: number, pageH: number): { residuals: number[]; max: number; rms: number } {
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

function maxTriangleArea2(matches: RasterMatch[]): number {
  let maxArea2 = 0;
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      for (let k = j + 1; k < matches.length; k++) {
        const a = matches[i]!;
        const b = matches[j]!;
        const c = matches[k]!;
        const area2 = Math.abs((b.pageX - a.pageX) * (c.pageY - a.pageY) - (c.pageX - a.pageX) * (b.pageY - a.pageY));
        if (area2 > maxArea2) maxArea2 = area2;
      }
    }
  }
  return maxArea2;
}

function spreadMatches(matches: RasterMatch[], pageW: number, pageH: number, maxGcps: number): RasterMatch[] {
  const bestByCell = new Map<string, RasterMatch>();
  for (const m of matches) {
    const key = `${Math.floor((m.pageX / Math.max(pageW, 1)) * 12)},${Math.floor((m.pageY / Math.max(pageH, 1)) * 12)}`;
    const prev = bestByCell.get(key);
    if (!prev || m.patchScore > prev.patchScore || (m.patchScore === prev.patchScore && m.distM < prev.distM)) {
      bestByCell.set(key, m);
    }
  }
  const pool = [...bestByCell.values()]
    .sort((a, b) => b.patchScore - a.patchScore || a.distM - b.distM)
    .slice(0, Math.max(80, maxGcps * 8));
  if (pool.length <= maxGcps) return pool;
  const out: RasterMatch[] = [pool[0]!];
  while (out.length < maxGcps && out.length < pool.length) {
    let best: RasterMatch | null = null;
    let bestScore = -Infinity;
    for (const m of pool) {
      if (out.includes(m)) continue;
      let minD = Infinity;
      for (const s of out) minD = Math.min(minD, Math.hypot(m.pageX - s.pageX, m.pageY - s.pageY));
      const score = minD + m.patchScore * 80 - m.distM * 2;
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

function tryFitMatches(matches: RasterMatch[], pageW: number, pageH: number, maxResidualM: number, minGcps: number): RasterMatch[] {
  let selected = matches;
  for (let iter = 0; iter < 6; iter++) {
    if (selected.length < minGcps) return selected;
    if (maxTriangleArea2(selected) < 1e-6 * pageW * pageH) return [];
    const { residuals } = affineResiduals(selected, pageW, pageH);
    selected = selected
      .map((m, i) => ({ ...m, residualM: residuals[i]! }))
      .filter((m) => m.residualM! <= maxResidualM)
      .sort((a, b) => a.residualM! - b.residualM! || b.patchScore - a.patchScore || a.distM - b.distM);
  }
  return selected;
}

function holdoutStats(matches: RasterMatch[], pageW: number, pageH: number): { max: number; rms: number } | null {
  if (matches.length < 8) return null;
  const train = matches.filter((_, i) => i % 5 !== 0);
  const holdout = matches.filter((_, i) => i % 5 === 0);
  if (train.length < 3 || holdout.length === 0) return null;
  const pagePts = train.map((m) => [m.pageX, pageH - m.pageY] as [number, number]);
  const cLon = fitAffine(pagePts, train.map((m) => m.lon));
  const cLat = fitAffine(pagePts, train.map((m) => m.lat));
  const meanLat = train.reduce((a, b) => a + b.lat, 0) / train.length;
  const mPerLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
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

function buildGcpFileFromMatches(opts: RasterRegisterOptions, matches: RasterMatch[]): GcpFile {
  const gcps: Gcp[] = matches.map((m, i) => ({
    fx: m.pageX / opts.pageW,
    fy: m.pageY / opts.pageH,
    lon: m.lon,
    lat: m.lat,
    source: "cadastre-raster-corner-match",
    independent: true,
    note:
      `autonomous raster/cadastre corner match #${i + 1}; ` +
      `seed_nearest=${m.distM.toFixed(2)}m; patch_score=${m.patchScore.toFixed(3)}; ` +
      `fit_residual=${(m.residualM ?? 0).toFixed(2)}m`,
  }));
  return {
    slug: opts.slug,
    pdf: opts.pdfPath,
    page: opts.page,
    pageW: opts.pageW,
    pageH: opts.pageH,
    gcps,
    ...(opts.seed.neatline ? { neatline: opts.seed.neatline } : {}),
    ...(opts.seed.excludeRegions ? { excludeRegions: opts.seed.excludeRegions } : {}),
  };
}

export async function deriveRasterRegistration(opts: RasterRegisterOptions): Promise<RasterRegisterReport> {
  const dpi = opts.dpi ?? 72;
  const maxCandidateDistanceM = opts.maxCandidateDistanceM ?? 18;
  const maxResidualM = opts.maxResidualM ?? 30;
  const minGcps = opts.minGcps ?? 12;
  const maxGcps = opts.maxGcps ?? 48;
  const minPatchScore = opts.minPatchScore ?? 0.18;
  const maxPlanCorners = opts.maxPlanCorners ?? 4000;
  const scale = dpi / 72;

  const plan = renderPdfPagePgm(opts.pdfPath, opts.page, dpi);
  const planEdges = edgeMaskFromGray(plan);
  const planCorners = detectRasterCorners(plan, planEdges, {
    maxPoints: maxPlanCorners,
    pageW: opts.pageW,
    pageH: opts.pageH,
    scale,
    neatline: opts.seed.neatline,
  });

  const { vertices, lat0 } = cadastreVertices(opts.cadastre);
  const grid = new VertexGrid(vertices, Math.max(20, maxCandidateDistanceM * 2));
  const ref = renderCadastreReference(opts.cadastre, opts.seed, opts.pageW, opts.pageH, plan.width, plan.height, scale, vertices);
  const refEdges = edgeMaskFromGray(ref.image, 20, 200);
  const refCorners = detectRasterCorners(ref.image, refEdges, {
    maxPoints: Math.min(8000, Math.max(1000, maxPlanCorners * 2)),
    pageW: opts.pageW,
    pageH: opts.pageH,
    scale,
    neatline: opts.seed.neatline,
  });

  const seedGeo = buildGeoRefFromGcpsCrs(opts.seed.gcps, opts.pageW, opts.pageH, opts.seed.crs, opts.seed.neatline).geo;
  const byKey = new Map<string, ProjectedVertex>();
  for (const v of ref.projectedVertices) byKey.set(`${Math.round(v.lon * 1e7)},${Math.round(v.lat * 1e7)}`, v);

  const candidateMatches: RasterMatch[] = [];
  let seedCandidateMatches = 0;
  for (const p of planCorners) {
    const pageX = p.x / scale;
    const pageY = p.y / scale;
    const [lon, lat] = seedGeo.topLeftToLonLat(pageX, pageY);
    const [xm, ym] = project(lon, lat, lat0);
    const near = grid.nearest(xm, ym, maxCandidateDistanceM);
    if (!near) continue;
    seedCandidateMatches++;
    const projected = byKey.get(`${Math.round(near.v.lon * 1e7)},${Math.round(near.v.lat * 1e7)}`);
    if (!projected) continue;
    const score = patchEdgeScore(planEdges, refEdges, p.x, p.y, projected.px, projected.py);
    if (score < minPatchScore) continue;
    candidateMatches.push({
      pageX,
      pageY,
      lon: near.v.lon,
      lat: near.v.lat,
      distM: near.d,
      patchScore: score,
    });
  }

  let selected = spreadMatches(
    candidateMatches.sort((a, b) => b.patchScore - a.patchScore || a.distM - b.distM),
    opts.pageW,
    opts.pageH,
    maxGcps,
  );
  selected = tryFitMatches(selected, opts.pageW, opts.pageH, maxResidualM, minGcps);
  selected = spreadMatches(selected, opts.pageW, opts.pageH, maxGcps);

  let residualMax: number | null = null;
  let residualRms: number | null = null;
  let holdoutMax: number | null = null;
  let holdoutRms: number | null = null;
  let pass = false;
  let reason: string | undefined;
  if (selected.length < minGcps) {
    reason =
      `only ${selected.length} raster/cadastre matches after patch and residual pruning (< ${minGcps}); ` +
      `${seedCandidateMatches} seed-near candidates, ${candidateMatches.length} patch-verified`;
  } else if (maxTriangleArea2(selected) < 1e-6 * opts.pageW * opts.pageH) {
    reason = "raster/cadastre matches are near-collinear";
    selected = [];
  } else {
    const res = affineResiduals(selected, opts.pageW, opts.pageH);
    selected = selected.map((m, i) => ({ ...m, residualM: res.residuals[i]! }));
    residualMax = Number(res.max.toFixed(3));
    residualRms = Number(res.rms.toFixed(3));
    const h = holdoutStats(selected, opts.pageW, opts.pageH);
    holdoutMax = h ? Number(h.max.toFixed(3)) : null;
    holdoutRms = h ? Number(h.rms.toFixed(3)) : null;
    pass = res.max <= maxResidualM && (!h || h.max <= maxResidualM);
    if (!pass) {
      reason = `raster/cadastre residual ${res.max.toFixed(2)}m or holdout ${(h?.max ?? NaN).toFixed(2)}m > ${maxResidualM}m`;
    }
  }

  return {
    slug: opts.slug,
    method: "cadastre-raster-corner-image-registration",
    pass,
    ...(reason ? { reason } : {}),
    dpi,
    plan_raster_corners: planCorners.length,
    reference_raster_corners: refCorners.length,
    cadastre_vertices: vertices.length,
    seed_candidate_matches: seedCandidateMatches,
    patch_verified_matches: candidateMatches.length,
    selected_gcps: selected.length,
    residual_max_m: residualMax,
    residual_rms_m: residualRms,
    holdout_max_m: holdoutMax,
    holdout_rms_m: holdoutRms,
    max_candidate_distance_m: maxCandidateDistanceM,
    min_patch_score: minPatchScore,
    max_residual_gate_m: maxResidualM,
    ...(pass ? { gcp_file: buildGcpFileFromMatches(opts, selected) } : {}),
  };
}
