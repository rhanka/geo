/**
 * Autonomous T2 control-point discovery from owned cadastre.
 *
 * This path deliberately does NOT accept the four map-frame/cadastre-bbox
 * corners as control points. It may use an existing coarse calibration only as
 * a search seed, then derives many candidate controls by matching visible PDF
 * vector linework vertices to real cadastre lot vertices. The residual gate is
 * measured on those matched parcel/linework points.
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection, Geometry, Position } from "geojson";

import { fitAffine } from "./t1-georef.js";
import { pdftotextWords } from "./t1-labels.js";
import { buildGeoRefFromGcpsCrs, type Gcp, type GcpFile, type NeatlineFrac } from "./t2-georef.js";

const M_PER_DEG_LAT = 111320;

export interface AutoGcpOptions {
  slug: string;
  pdfPath: string;
  page: number;
  pageW: number;
  pageH: number;
  seed: GcpFile;
  cadastre: FeatureCollection;
  maxCandidateDistanceM?: number;
  maxResidualM?: number;
  minGcps?: number;
  maxGcps?: number;
  /** Reuse a pre-rendered page SVG (avoids re-running pdftocairo in a loop). */
  svgPath?: string;
  /**
   * Reuse already-extracted full-page linework points (they are re-filtered by
   * `seed.neatline` here). Lets a multi-candidate driver render/parse once.
   */
  pagePoints?: Pt[];
  /**
   * Skip the informational coordinate-tick OCR (tesseract + pdftotext). The
   * ticks are never used by the matcher or the residual gate, so an auto-seed
   * sweep that calls this many times should skip them for speed.
   */
  skipVisualOcr?: boolean;
}

export interface AutoGcpReport {
  slug: string;
  method: "cadastre-parcel-corner-vector-match";
  pass: boolean;
  reason?: string;
  text_coordinate_tick_candidates: number;
  visual_ocr_coordinate_tick_candidates?: number;
  visual_ocr_error?: string;
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

interface Match {
  pageX: number;
  pageY: number;
  lon: number;
  lat: number;
  distM: number;
  residualM?: number;
}

interface MarginCrop {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface OcrWorker {
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (...args: unknown[]) => Promise<unknown>;
  terminate: () => Promise<unknown>;
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
          push({ x: mt ** 2 * p0.x + 2 * mt * t * p1.x + t ** 2 * p2.x, y: mt ** 2 * p0.y + 2 * mt * t * p1.y + t ** 2 * p2.y });
        }
      }
    } else {
      // Unsupported SVG commands (A/S/T) are uncommon in Poppler linework here;
      // skip their numeric payload instead of inventing geometry.
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

export function extractSvgVectorPoints(svgPath: string, pageW: number, pageH: number, neatline?: NeatlineFrac): Pt[] {
  const svg = readFileSync(svgPath, "utf8");
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
      if (!inNeatline(p, neatline, pageW, pageH)) continue;
      const key = `${Math.round(p.x / 3)},${Math.round(p.y / 3)}`;
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

function affineResiduals(matches: Match[], pageW: number, pageH: number): { residuals: number[]; max: number; rms: number } {
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

function spreadMatches(matches: Match[], pageW: number, pageH: number, maxGcps: number): Match[] {
  const bestByCell = new Map<string, Match>();
  for (const m of matches) {
    const key = `${Math.floor((m.pageX / Math.max(pageW, 1)) * 12)},${Math.floor((m.pageY / Math.max(pageH, 1)) * 12)}`;
    const prev = bestByCell.get(key);
    if (!prev || m.distM < prev.distM) bestByCell.set(key, m);
  }
  const pool = [...bestByCell.values()].sort((a, b) => a.distM - b.distM).slice(0, Math.max(80, maxGcps * 8));
  if (pool.length <= maxGcps) return pool;
  const out: Match[] = [pool[0]!];
  while (out.length < maxGcps && out.length < pool.length) {
    let best: Match | null = null;
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

function tryFitMatches(matches: Match[], pageW: number, pageH: number, maxResidualM: number, minGcps: number): Match[] {
  let selected = matches;
  for (let iter = 0; iter < 6; iter++) {
    if (selected.length < minGcps) return selected;
    const { residuals } = affineResiduals(selected, pageW, pageH);
    selected = selected
      .map((m, i) => ({ ...m, residualM: residuals[i]! }))
      .filter((m) => m.residualM! <= maxResidualM)
      .sort((a, b) => a.residualM! - b.residualM! || a.distM - b.distM);
  }
  return selected;
}

function holdoutStats(matches: Match[], pageW: number, pageH: number): { max: number; rms: number } | null {
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

export function textCoordinateTickCandidates(pdfPath: string, page: number): string[] {
  const words = pdftotextWords(pdfPath, { page }).words.map((w) => w.text.trim());
  return words.filter((w) => /^\d{5,8}$/.test(w) || /^\d{3,4}\s?\d{3,4}$/.test(w));
}

function objectValue(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function arrayValue(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function coordinateLikeNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!/^\d{6,8}$/.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  // Quebec plan ticks are normally full projected eastings/northings, not
  // scale-denominator numbers like 25000.
  if (digits.length === 6 && n >= 100_000 && n <= 900_000) return digits;
  if (digits.length >= 7 && n >= 4_000_000 && n <= 7_000_000) return digits;
  return null;
}

function marginCrops(pageW: number, pageH: number, neatline?: NeatlineFrac): MarginCrop[] {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  if (neatline) {
    const x0 = Math.min(neatline.fx0, neatline.fx1) * pageW;
    const x1 = Math.max(neatline.fx0, neatline.fx1) * pageW;
    const y0 = Math.min(neatline.fy0, neatline.fy1) * pageH;
    const y1 = Math.max(neatline.fy0, neatline.fy1) * pageH;
    const pad = Math.max(80, Math.min(pageW, pageH) * 0.06);
    return [
      { name: "top", x0: clamp(x0 - pad, 0, pageW), y0: clamp(y0 - pad, 0, pageH), x1: clamp(x1 + pad, 0, pageW), y1: clamp(y0 + pad, 0, pageH) },
      { name: "bottom", x0: clamp(x0 - pad, 0, pageW), y0: clamp(y1 - pad, 0, pageH), x1: clamp(x1 + pad, 0, pageW), y1: clamp(y1 + pad, 0, pageH) },
      { name: "left", x0: clamp(x0 - pad, 0, pageW), y0: clamp(y0 - pad, 0, pageH), x1: clamp(x0 + pad, 0, pageW), y1: clamp(y1 + pad, 0, pageH) },
      { name: "right", x0: clamp(x1 - pad, 0, pageW), y0: clamp(y0 - pad, 0, pageH), x1: clamp(x1 + pad, 0, pageW), y1: clamp(y1 + pad, 0, pageH) },
    ].filter((c) => c.x1 - c.x0 >= 20 && c.y1 - c.y0 >= 20);
  }
  const band = Math.max(90, Math.min(pageW, pageH) * 0.12);
  return [
    { name: "top", x0: 0, y0: 0, x1: pageW, y1: band },
    { name: "bottom", x0: 0, y0: pageH - band, x1: pageW, y1: pageH },
    { name: "left", x0: 0, y0: 0, x1: band, y1: pageH },
    { name: "right", x0: pageW - band, y0: 0, x1: pageW, y1: pageH },
  ];
}

function collectOcrCoordinateTicks(data: unknown, out: Set<string>): void {
  const root = objectValue(data);
  for (const block of arrayValue(root["blocks"])) {
    for (const para of arrayValue(objectValue(block)["paragraphs"])) {
      for (const line of arrayValue(objectValue(para)["lines"])) {
        for (const word of arrayValue(objectValue(line)["words"])) {
          const w = objectValue(word);
          const text = typeof w["text"] === "string" ? w["text"].trim() : "";
          const confidence = typeof w["confidence"] === "number" ? w["confidence"] : 0;
          if (!text || confidence < 30) continue;
          const tick = coordinateLikeNumber(text);
          if (tick) out.add(tick);
        }
      }
    }
  }
}

export async function visualOcrCoordinateTickCandidates(
  pdfPath: string,
  page: number,
  pageW: number,
  pageH: number,
  neatline?: NeatlineFrac,
): Promise<{ ticks: string[]; error?: string }> {
  const dpi = 160;
  const scale = dpi / 72;
  const dir = mkdtempSync(join(tmpdir(), "t2-autogcp-ocr-"));
  const ticks = new Set<string>();
  let worker: OcrWorker | null = null;
  try {
    const tjs = (await import("tesseract.js") as unknown) as {
      createWorker?: (lang: string, oem?: number, opts?: { logger?: () => void }) => Promise<OcrWorker>;
      default?: { createWorker?: (lang: string, oem?: number, opts?: { logger?: () => void }) => Promise<OcrWorker> };
    };
    const createWorker = tjs.createWorker ?? tjs.default?.createWorker;
    if (!createWorker) return { ticks: [], error: "tesseract.js createWorker unavailable" };
    worker = await createWorker("eng", 1, { logger: () => {} });
    if (!worker) return { ticks: [], error: "tesseract.js worker unavailable" };
    await worker.setParameters({ tessedit_pageseg_mode: "11" });

    for (const crop of marginCrops(pageW, pageH, neatline)) {
      const base = join(dir, crop.name);
      const png = `${base}.png`;
      const ret = spawnSync("pdftoppm", [
        "-f",
        String(page),
        "-l",
        String(page),
        "-singlefile",
        "-r",
        String(dpi),
        "-x",
        String(Math.max(0, Math.round(crop.x0 * scale))),
        "-y",
        String(Math.max(0, Math.round(crop.y0 * scale))),
        "-W",
        String(Math.max(1, Math.round((crop.x1 - crop.x0) * scale))),
        "-H",
        String(Math.max(1, Math.round((crop.y1 - crop.y0) * scale))),
        "-png",
        pdfPath,
        base,
      ]);
      if (ret.status !== 0) continue;
      const result = await worker.recognize(png, {}, { blocks: true });
      collectOcrCoordinateTicks(objectValue(result)["data"], ticks);
    }
  } catch (e) {
    return { ticks: [...ticks].sort(), error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (worker) await worker.terminate();
  }
  return { ticks: [...ticks].sort() };
}

export function runPdftocairoSvg(pdfPath: string, page: number): string {
  const dir = mkdtempSync(join(tmpdir(), "t2-autogcp-"));
  const out = join(dir, "page.svg");
  execSync(`pdftocairo -svg -f ${page} -l ${page} ${JSON.stringify(pdfPath)} ${JSON.stringify(out)}`, { timeout: 180_000 });
  return out;
}

export function buildGcpFileFromMatches(opts: AutoGcpOptions, matches: Match[]): GcpFile {
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
    page: opts.page,
    pageW: opts.pageW,
    pageH: opts.pageH,
    gcps,
    ...(opts.seed.neatline ? { neatline: opts.seed.neatline } : {}),
  };
}

export async function deriveAutonomousGcps(opts: AutoGcpOptions): Promise<AutoGcpReport> {
  const maxCandidateDistanceM = opts.maxCandidateDistanceM ?? 12;
  const maxResidualM = opts.maxResidualM ?? 30;
  const minGcps = opts.minGcps ?? 12;
  const maxGcps = opts.maxGcps ?? 48;
  const ticks = opts.skipVisualOcr ? [] : textCoordinateTickCandidates(opts.pdfPath, opts.page);
  const visualTicks = opts.skipVisualOcr
    ? { ticks: [] as string[] }
    : await visualOcrCoordinateTickCandidates(opts.pdfPath, opts.page, opts.pageW, opts.pageH, opts.seed.neatline);

  const svgPath = opts.svgPath ?? runPdftocairoSvg(opts.pdfPath, opts.page);
  const pagePoints = opts.pagePoints
    ? opts.pagePoints.filter((p) => inNeatline(p, opts.seed.neatline, opts.pageW, opts.pageH))
    : extractSvgVectorPoints(svgPath, opts.pageW, opts.pageH, opts.seed.neatline);
  const { vertices, lat0 } = cadastreVertices(opts.cadastre);
  const grid = new VertexGrid(vertices, Math.max(20, maxCandidateDistanceM * 2));

  const seedGeo = buildGeoRefFromGcpsCrs(opts.seed.gcps, opts.pageW, opts.pageH, opts.seed.crs, opts.seed.neatline).geo;
  const matches: Match[] = [];
  for (const p of pagePoints) {
    const [lon, lat] = seedGeo.topLeftToLonLat(p.x, p.y);
    const [xm, ym] = project(lon, lat, lat0);
    const near = grid.nearest(xm, ym, maxCandidateDistanceM);
    if (!near) continue;
    matches.push({ pageX: p.x, pageY: p.y, lon: near.v.lon, lat: near.v.lat, distM: near.d });
  }

  let selected = spreadMatches(matches.sort((a, b) => a.distM - b.distM), opts.pageW, opts.pageH, maxGcps);
  selected = tryFitMatches(selected, opts.pageW, opts.pageH, maxResidualM, minGcps);
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
    const res = affineResiduals(selected, opts.pageW, opts.pageH);
    selected = selected.map((m, i) => ({ ...m, residualM: res.residuals[i]! }));
    residualMax = Number(res.max.toFixed(3));
    residualRms = Number(res.rms.toFixed(3));
    const h = holdoutStats(selected, opts.pageW, opts.pageH);
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
    text_coordinate_tick_candidates: ticks.length,
    visual_ocr_coordinate_tick_candidates: visualTicks.ticks.length,
    ...(visualTicks.error ? { visual_ocr_error: visualTicks.error } : {}),
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

/* ------------------------------------------------------------------------- *
 * Auto-seed: synthesise the coarse 4-corner seed instead of requiring a hand
 * placed one, then let the EXISTING residual+holdout gate pick the winner.
 *
 * The seed maps the four corners of the plan's drawn map body (in page
 * fractions) to the four corners of the municipality cadastre bbox (WGS84),
 * over four candidate page rotations (0/90/180/270). Each (extent × rotation)
 * seed is fed to `deriveAutonomousGcps`, which re-derives INDEPENDENT parcel-
 * corner control points and gates them at ≤maxResidualM + holdout. A synthetic
 * seed is ONLY a search hint — no bbox corner ever becomes a served control
 * point, and a run that never clears the gate aborts (pass:false) instead of
 * fabricating one. This is the exact anti-invention contract of the manual
 * path, with the coarse human step removed.
 * ------------------------------------------------------------------------- */

export interface AutoSeedOptions {
  slug: string;
  pdfPath: string;
  page: number;
  pageW: number;
  pageH: number;
  cadastre: FeatureCollection;
  /** Candidate-match search radius (m). Wider than the manual path because the
   * synthetic seed is coarser; the residual gate stays strict. */
  maxCandidateDistanceM?: number;
  maxResidualM?: number;
  minGcps?: number;
  maxGcps?: number;
  /** Orientation/isotropy gate thresholds (see DEFAULT_AFFINE_GATE). */
  maxAnisotropy?: number;
  orientationToleranceDeg?: number;
  maxShearDeg?: number;
  /** Max page-right bearing spread across plausible fits before ambiguity reject. */
  convergenceToleranceDeg?: number;
  /**
   * GCP floor used ONLY to surface competing orientations for the ambiguity
   * probe (a sparse flipped/rotated fit that still matches isometrically must
   * be seen to be judged). Lower than `minGcps`; a candidate must still reach
   * `minGcps` to be SERVED. Default min(6, minGcps).
   */
  ambiguityMinGcps?: number;
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
  /** Present when the attempt cleared the residual gate and yielded GCPs. */
  anisotropy?: number;
  singular_ratio?: number;
  bearing_right_deg?: number;
  bearing_down_deg?: number;
  mirror?: boolean;
  shear_deg?: number;
  /** true only when the derived affine also cleared the orientation/isotropy gate. */
  affine_gate_pass?: boolean;
  affine_gate_reason?: string;
}

/**
 * One servable GCP file per DISTINCT candidate orientation, emitted ONLY when a
 * run is rejected for orientation ambiguity alone (several non-mirror, isometric
 * fits pass residual+holdout but disagree on page-right bearing). A downstream
 * lot-assignment disambiguator (lib/t2-rotation-disambig) uses these to pick the
 * data-correct rotation. Never emitted on a clean pass or a hard mirror/
 * anisotropy/shear reject.
 */
export interface OrientationCandidate {
  extent: string;
  rotation: number;
  bearing_right_deg: number;
  selected_gcps: number;
  residual_max_m: number | null;
  holdout_max_m: number | null;
  gcp_file: GcpFile;
}

export interface AutoSeedReport {
  slug: string;
  method: "auto-seed-cadastre-bbox-rotations";
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
  /** Decomposition + gate verdict of the served (winning) affine. */
  affine_gate?: AffineGateResult;
  gcp_file?: GcpFile;
  /** Present only on an orientation-ambiguity reject: candidates to disambiguate. */
  orientation_candidates?: OrientationCandidate[];
}

/** WGS84 bbox [lonMin, latMin, lonMax, latMax] of the cadastre lots. */
function cadastreLonLatBbox(cadastre: FeatureCollection): [number, number, number, number] {
  let lonMin = Infinity;
  let latMin = Infinity;
  let lonMax = -Infinity;
  let latMax = -Infinity;
  for (const f of cadastre.features) {
    scanCoords(f.geometry, (p) => {
      const lon = p[0]!;
      const lat = p[1]!;
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

/** Full page-point bbox — correct when the drawn cadastre fills the map frame. */
function drawnExtentFull(points: Pt[], pageW: number, pageH: number): NeatlineFrac | null {
  if (points.length < 8) return null;
  const [x0, y0, x1, y1] = bboxOfPts(points);
  return fracBox(x0, y0, x1, y1, pageW, pageH);
}

/** Percentile-trimmed bbox — drops a few sparse legend/title outliers. */
function drawnExtentPercentile(points: Pt[], pageW: number, pageH: number, f = 0.02): NeatlineFrac | null {
  if (points.length < 50) return null;
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const q = (a: number[], t: number): number => a[Math.max(0, Math.min(a.length - 1, Math.floor((a.length - 1) * t)))]!;
  return fracBox(q(xs, f), q(ys, f), q(xs, 1 - f), q(ys, 1 - f), pageW, pageH);
}

/**
 * 2D-density bbox with a thin-line erosion: keeps only cells that are dense AND
 * have dense neighbours in BOTH axes, which discards the 1-cell-wide map frame,
 * scale bar and north arrow while retaining the parcel mesh. Best when the map
 * body is a sub-region of the sheet (title block / legend inside the frame).
 */
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

/** Grow a frac bbox by `pad` fraction of its own size on every side (clamped). */
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

/**
 * Four coarse corner GCPs mapping the extent's page corners to the cadastre
 * bbox corners, rotated by `rot` × 90° (page corners taken clockwise from
 * top-left, cadastre corners clockwise from NW).
 */
function buildRotationSeedGcps(
  extent: NeatlineFrac,
  bbox: [number, number, number, number],
  rot: number,
): Gcp[] {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  const x0 = Math.min(extent.fx0, extent.fx1);
  const x1 = Math.max(extent.fx0, extent.fx1);
  const y0 = Math.min(extent.fy0, extent.fy1);
  const y1 = Math.max(extent.fy0, extent.fy1);
  // Page corners clockwise from top-left (fy top-down).
  const pageCorners: Array<[number, number]> = [
    [x0, y0], // TL
    [x1, y0], // TR
    [x1, y1], // BR
    [x0, y1], // BL
  ];
  // Cadastre corners clockwise from NW.
  const cadCorners: Array<[number, number]> = [
    [lonMin, latMax], // NW
    [lonMax, latMax], // NE
    [lonMax, latMin], // SE
    [lonMin, latMin], // SW
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

/* ------------------------------------------------------------------------- *
 * Hard orientation / isotropy gate on the auto-seed's winning affine.
 *
 * The residual+holdout gate proves the derived control points are MUTUALLY
 * consistent, but on partial-extent (urban-perimeter, cropped sheet) or sparse
 * plans the parcel matcher can lock onto a self-consistent yet GLOBALLY WRONG
 * fit: anisotropically stretched (bbox forced to fill a mismatched extent),
 * mirrored, or rotated/flipped 90°/180°. Those pass residual but serve false
 * geometry. This gate decomposes the fitted affine and refuses to serve unless
 * the geometry is a near-isometric, non-mirrored, north-up map — matching the
 * PROVEN-correct reference (coteau-du-lac: page-right≈East, page-down≈South,
 * anisotropy≈1.01, non-mirror). It is a SELECTION+REJECT gate on --auto-seed
 * only; the manual-GCP path (t2-build) is untouched.
 * ------------------------------------------------------------------------- */

export interface AffineDecomposition {
  /** QR scale of the page +x (right) axis, in metres per page unit. */
  sx: number;
  /** QR signed scale of the page +y axis (= det/sx); negative ⇒ reflection. */
  sy: number;
  /** Euclidean length of the page-right column vector (m/page-unit). */
  scaleRightM: number;
  /** Euclidean length of the page-up column vector (m/page-unit). */
  scaleUpM: number;
  /** max(|sx|,|sy|)/min(|sx|,|sy|) — the mission's scale-anisotropy metric. */
  anisotropy: number;
  /** Ratio of singular values (condition number): catches stretch AND shear. */
  singularRatio: number;
  /** Signed determinant of the page→ground linear map. */
  determinant: number;
  /** true when det < 0 ⇒ the map is mirrored/reflected. */
  mirror: boolean;
  /** Compass-math bearing of page +x (right); East=0°, North=+90°, CCW. */
  bearingRightDeg: number;
  /** Compass-math bearing of page +y-down; South is −90° for a north-up map. */
  bearingDownDeg: number;
  /** Signed angle page-right→page-up; +90° north-up, −90° mirrored. */
  axisAngleDeg: number;
  /** |90 − |axisAngle||: deviation from orthogonal axes (shear/skew), degrees. */
  shearDeg: number;
}

export interface AffineGateOptions {
  /** Reject when the scale/singular anisotropy exceeds this ratio. */
  maxAnisotropy?: number;
  /** Reject when page-right/page-down deviate from East/South by more (deg). */
  orientationToleranceDeg?: number;
  /** Reject when the page axes are non-orthogonal by more than this (deg). */
  maxShearDeg?: number;
}

export interface AffineGateResult {
  pass: boolean;
  reasons: string[];
  decomposition: AffineDecomposition;
}

export const DEFAULT_AFFINE_GATE: Required<AffineGateOptions> = {
  maxAnisotropy: 1.1,
  orientationToleranceDeg: 15,
  maxShearDeg: 10,
};

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Shortest absolute angular distance (deg) between two bearings. */
function angularDistDeg(a: number, b: number): number {
  return Math.abs(normalizeDeg(a - b));
}

/**
 * Decompose the least-squares page→ground affine implied by a set of control
 * points into interpretable scale / orientation / shear / mirror terms.
 *
 * Page space uses PDF units with y pointing UP (fy is top-down, so we flip it),
 * exactly like `affineResiduals`. Ground space is local metres (East = +x via
 * lon·m/deg at the mean latitude, North = +y via lat·m/deg). Returns null when
 * there are too few points or the fit is degenerate (no usable geometry).
 */
export function decomposeGcpAffine(gcps: Gcp[], pageW: number, pageH: number): AffineDecomposition | null {
  if (gcps.length < 3) return null;
  const pagePts = gcps.map((g) => [g.fx * pageW, (1 - g.fy) * pageH] as [number, number]);
  const lons = gcps.map((g) => g.lon);
  const lats = gcps.map((g) => g.lat);
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const mPerLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  const cLon = fitAffine(pagePts, lons);
  const cLat = fitAffine(pagePts, lats);
  // Linear map (page +x, page +y-up) → (East m, North m); matrix columns are
  // the images of the page basis vectors: right=(a,b), up=(c,d).
  const a = cLon[0] * mPerLon; // ∂East/∂px
  const c = cLon[1] * mPerLon; // ∂East/∂py_up
  const b = cLat[0] * M_PER_DEG_LAT; // ∂North/∂px
  const d = cLat[1] * M_PER_DEG_LAT; // ∂North/∂py_up
  if (![a, b, c, d].every(Number.isFinite)) return null;
  const determinant = a * d - b * c;
  const sx = Math.hypot(a, b);
  if (sx === 0) return null;
  const sy = determinant / sx;
  const scaleRightM = Math.hypot(a, b);
  const scaleUpM = Math.hypot(c, d);
  const absSx = Math.abs(sx);
  const absSy = Math.abs(sy);
  const anisotropy = Math.min(absSx, absSy) === 0 ? Infinity : Math.max(absSx, absSy) / Math.min(absSx, absSy);
  // Singular values of [[a,c],[b,d]] (condition number = stretch incl. shear).
  const eAvg = (a * a + b * b + c * c + d * d) / 2;
  const fRad = Math.hypot((a * a + b * b - c * c - d * d) / 2, a * c + b * d);
  const s1 = Math.sqrt(Math.max(0, eAvg + fRad));
  const s2 = Math.sqrt(Math.max(0, eAvg - fRad));
  const singularRatio = s2 === 0 ? Infinity : s1 / s2;
  const bearingRightDeg = (Math.atan2(b, a) * 180) / Math.PI; // page +x
  const bearingDownDeg = (Math.atan2(-d, -c) * 180) / Math.PI; // page +y-down = −(up)
  const angRight = Math.atan2(b, a);
  const angUp = Math.atan2(d, c);
  const axisAngleDeg = normalizeDeg(((angUp - angRight) * 180) / Math.PI);
  const shearDeg = Math.abs(Math.abs(axisAngleDeg) - 90);
  return {
    sx,
    sy,
    scaleRightM,
    scaleUpM,
    anisotropy,
    singularRatio,
    determinant,
    mirror: determinant < 0,
    bearingRightDeg,
    bearingDownDeg,
    axisAngleDeg,
    shearDeg,
  };
}

/**
 * Hard gate on a decomposed affine. Fails (with explicit reasons) on:
 *  - reflection/mirror (det < 0),
 *  - anisotropy — scale ratio OR singular-value ratio — above `maxAnisotropy`,
 *  - non-orthogonal (sheared) page axes above `maxShearDeg`,
 *  - orientation that is not coherent north-up: page-right must be East±tol and
 *    page-down must be South±tol. A merely-rotated (e.g. 90°/180°-flipped)
 *    affine is NOT trusted here even when isometric, because a single affine
 *    cannot distinguish a genuinely rotated sheet from a wrong-orientation lock;
 *    the auto-seed's cross-candidate convergence check is what would clear a
 *    truly rotated plan. This keeps the served geometry provably north-up.
 */
export function evaluateAffineGate(decomp: AffineDecomposition, options: AffineGateOptions = {}): AffineGateResult {
  const o = { ...DEFAULT_AFFINE_GATE, ...options };
  const reasons: string[] = [];
  if (decomp.mirror) reasons.push(`mirror/reflection (det=${decomp.determinant.toFixed(2)} < 0)`);
  if (decomp.anisotropy > o.maxAnisotropy) {
    reasons.push(`scale anisotropy ${decomp.anisotropy.toFixed(3)} > ${o.maxAnisotropy}`);
  }
  if (decomp.singularRatio > o.maxAnisotropy) {
    reasons.push(`singular-value anisotropy ${decomp.singularRatio.toFixed(3)} > ${o.maxAnisotropy}`);
  }
  if (decomp.shearDeg > o.maxShearDeg) {
    reasons.push(`sheared axes ${decomp.shearDeg.toFixed(1)}° from orthogonal > ${o.maxShearDeg}°`);
  }
  const rightOff = angularDistDeg(decomp.bearingRightDeg, 0); // East
  const downOff = angularDistDeg(decomp.bearingDownDeg, -90); // South
  if (rightOff > o.orientationToleranceDeg || downOff > o.orientationToleranceDeg) {
    reasons.push(
      `orientation not north-up: page-right ${decomp.bearingRightDeg.toFixed(1)}° (Δ${rightOff.toFixed(1)}° from East), ` +
        `page-down ${decomp.bearingDownDeg.toFixed(1)}° (Δ${downOff.toFixed(1)}° from South), tol ${o.orientationToleranceDeg}°`,
    );
  }
  return { pass: reasons.length === 0, reasons, decomposition: decomp };
}

export async function deriveAutoSeedGcps(opts: AutoSeedOptions): Promise<AutoSeedReport> {
  const maxCandidateDistanceM = opts.maxCandidateDistanceM ?? 450;
  const maxResidualM = opts.maxResidualM ?? 30;
  const minGcps = opts.minGcps ?? 12;
  const maxGcps = opts.maxGcps ?? 48;
  // Probe floor: derive at a lower GCP count so a sparse flipped/rotated fit is
  // visible to the orientation-ambiguity check; SERVING still requires minGcps.
  const ambiguityMinGcps = Math.max(3, Math.min(opts.ambiguityMinGcps ?? Math.min(6, minGcps), minGcps));

  const bbox = cadastreLonLatBbox(opts.cadastre);
  if (!Number.isFinite(bbox[0]) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    throw new Error(`cadastre has no usable WGS84 bbox for ${opts.slug}`);
  }

  const svgPath = runPdftocairoSvg(opts.pdfPath, opts.page);
  const allPoints = extractSvgVectorPoints(svgPath, opts.pageW, opts.pageH);

  const density = drawnExtentDensity(allPoints, opts.pageW, opts.pageH);
  const extents: Record<string, NeatlineFrac | null> = {
    density,
    "density+10%": density ? inflateFrac(density, 0.1) : null,
    "density+20%": density ? inflateFrac(density, 0.2) : null,
    percentile: drawnExtentPercentile(allPoints, opts.pageW, opts.pageH, 0.02),
    full: drawnExtentFull(allPoints, opts.pageW, opts.pageH),
  };

  const affineGateOpts: AffineGateOptions = {
    ...(opts.maxAnisotropy !== undefined ? { maxAnisotropy: opts.maxAnisotropy } : {}),
    ...(opts.orientationToleranceDeg !== undefined ? { orientationToleranceDeg: opts.orientationToleranceDeg } : {}),
    ...(opts.maxShearDeg !== undefined ? { maxShearDeg: opts.maxShearDeg } : {}),
  };

  const maxAniso = affineGateOpts.maxAnisotropy ?? DEFAULT_AFFINE_GATE.maxAnisotropy;
  const attempts: AutoSeedAttempt[] = [];
  const gateClean: Array<{ attempt: AutoSeedAttempt; report: AutoGcpReport; gate: AffineGateResult }> = [];
  const plausible: AffineDecomposition[] = []; // residual-pass, non-mirror, isometric
  // Servable (≥minGcps), non-mirror, isometric fits — one per candidate rotation.
  // These are the disambiguation set surfaced on an orientation-only reject; a
  // wrong bearing here is exactly what lot-assignment resolves. NOT constrained
  // to north-up (that is what makes a genuinely rotated true plan recoverable).
  const servable: OrientationCandidate[] = [];

  for (const [extentName, extent] of Object.entries(extents)) {
    if (!extent) continue;
    for (const rot of [0, 1, 2, 3]) {
      const seed: GcpFile = {
        slug: opts.slug,
        pdf: opts.pdfPath,
        page: opts.page,
        pageW: opts.pageW,
        pageH: opts.pageH,
        gcps: buildRotationSeedGcps(extent, bbox, rot),
        neatline: extent,
      };
      const report = await deriveAutonomousGcps({
        slug: opts.slug,
        pdfPath: opts.pdfPath,
        page: opts.page,
        pageW: opts.pageW,
        pageH: opts.pageH,
        seed,
        cadastre: opts.cadastre,
        maxCandidateDistanceM,
        maxResidualM,
        minGcps: ambiguityMinGcps,
        maxGcps,
        svgPath,
        pagePoints: allPoints,
        skipVisualOcr: true,
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
      // Only residual-passing attempts produce servable GCPs; decompose & gate.
      if (report.pass && report.gcp_file) {
        const decomp = decomposeGcpAffine(report.gcp_file.gcps, opts.pageW, opts.pageH);
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
          // SERVING eligibility: cleared the affine gate AND has enough GCPs.
          if (gate.pass && report.selected_gcps >= minGcps) gateClean.push({ attempt, report, gate });
          // AMBIGUITY probe set: any non-mirror, isometric fit (incl. sparse
          // ones below the serving floor) — a flipped isometric competitor here
          // is the tell-tale of an unresolvable orientation.
          const isometric = !decomp.mirror && decomp.anisotropy <= maxAniso && decomp.singularRatio <= maxAniso;
          if (isometric) plausible.push(decomp);
          // Disambiguation candidate: isometric AND servable (≥minGcps), keeping
          // its refined GCP file. Distinct rotations here are what lot-assignment
          // arbitrates when the orientation gate cannot.
          if (isometric && report.selected_gcps >= minGcps && report.gcp_file) {
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
        }
      }
      attempts.push(attempt);
    }
  }

  // Winner = lowest-residual attempt that ALSO cleared the orientation/isotropy
  // gate. A residual-only "best" (possibly flipped/stretched) never wins.
  let best: { attempt: AutoSeedAttempt; report: AutoGcpReport; gate: AffineGateResult } | null = null;
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

  // Cross-candidate convergence (anti-invention): if geometrically plausible
  // (non-mirror, isometric) fits disagree on page-right bearing by more than
  // `convergenceToleranceDeg`, the parcel matcher is not confidently resolving
  // orientation (e.g. prevost: some fits East, some flipped West/South) → the
  // north-up winner is not trustworthy, so REJECT the whole slug.
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
        `disagree on page-right bearing by ${maxSpread.toFixed(1)}° (e.g. ${a0.toFixed(1)}° vs ${a1.toFixed(1)}°) > ${convTol}°`;
    }
  }
  if (ambiguityReason) best = null;

  // Whenever no clean winner emerged (the ambiguity reject NULLED a north-up
  // best, OR no fit was north-up at all — a genuinely rotated landscape plan
  // like lacolle) yet ≥2 DISTINCT isotropic orientations passed residual+holdout,
  // surface one servable candidate per distinct orientation (best-residual
  // representative per 90° bearing bucket) so the lot-assignment disambiguator
  // can pick the data-correct rotation. `servable` already excludes the hard
  // errors (mirror/anisotropy/shear), so this only re-opens pure orientation.
  let orientationCandidates: OrientationCandidate[] | undefined;
  if (!best && servable.length >= 2) {
    const byBucket = new Map<number, OrientationCandidate>();
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

  const anyResidualPass = attempts.some((a) => a.pass);
  let reason: string | undefined;
  if (!best) {
    if (ambiguityReason) reason = ambiguityReason;
    else if (!anyResidualPass) reason = "no (extent × rotation) seed cleared the residual+holdout gate";
    else if (gateClean.length === 0) {
      reason =
        `${attempts.filter((a) => a.pass).length} seed(s) cleared the residual+holdout gate but none cleared ` +
        `the orientation/isotropy gate (anisotropy/mirror/north-up)`;
    } else reason = "auto-seed rejected by orientation/isotropy gate";
  }

  return {
    slug: opts.slug,
    method: "auto-seed-cadastre-bbox-rotations",
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
  };
}
