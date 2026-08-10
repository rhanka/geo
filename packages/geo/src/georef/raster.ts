/**
 * Pure raster primitives from the T2 raster-registration pipeline.
 *
 * The acquisition runner owns PDF rendering and cadastre orchestration. This
 * module accepts an in-memory PGM or gray image and returns deterministic edge
 * and corner evidence; it has no filesystem, subprocess, network, or S3
 * dependency.
 */
import type { NeatlineFrac } from "./gcp.js";

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

/** Parse an 8-bit P2/P5 PGM already held in memory. */
export function parsePgm(buf: Buffer): GrayImage {
  const state = { i: 0 };
  const magic = readToken(buf, state);
  if (magic !== "P5" && magic !== "P2") throw new Error("unsupported PGM magic " + magic);
  const width = Number(readToken(buf, state));
  const height = Number(readToken(buf, state));
  const maxVal = Number(readToken(buf, state));
  if (!(width > 0) || !(height > 0) || !(maxVal > 0) || maxVal > 255) {
    throw new Error("invalid PGM header " + width + "x" + height + " max=" + maxVal);
  }

  if (magic === "P2") {
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) {
      const token = readToken(buf, state);
      if (!token) throw new Error("truncated P2 PGM");
      data[i] = Math.round((Number(token) / maxVal) * 255);
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

/** Build a binary edge mask using Sobel magnitude plus dark-pixel evidence. */
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

/** Detect spatially separated Harris-like corners in an edge-bearing image. */
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
  const bounds = neatlinePixelBounds(opts.neatline, opts.pageW, opts.pageH, opts.scale, img.width, img.height);
  const [bx0, by0, bx1, by1] = bounds;
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
      const key = String(Math.floor(x / cell)) + "," + String(Math.floor(y / cell));
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

function edgeAtDilated(edges: EdgeImage, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= edges.width || yy >= edges.height) continue;
      if (edges.data[yy * edges.width + xx] !== 0) return true;
    }
  }
  return false;
}

/** Compare two local edge patches, allowing a small integer pixel shift. */
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
