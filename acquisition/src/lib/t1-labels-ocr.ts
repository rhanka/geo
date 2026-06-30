/**
 * t1-labels-ocr.ts — OCR-VALIDATED zone-code labels for a GEOREFERENCED GeoPDF
 * whose zone-code labels are drawn as GLYPHS (vector outlines), not selectable
 * text. This is the companion of `t1-labels.ts` (the `pdftotext` text path) for
 * the harder case where `pdffonts` is empty and `pdftotext` returns nothing.
 *
 * THE PROBLEM (anti-invention): on a glyph map both raster OCR engines corrupt
 * the codes (tesseract: `Re3y`, `Rez3`, `Res2`; Mistral Document-AI: misreads
 * the legend prefixes and hallucinates table cells). A raw OCR token is NOT a
 * trustworthy zone_code. But the POSITION an OCR engine reports is reliable, and
 * the georeferencing is embedded and exact.
 *
 * THE RECIPE — position (OCR) ⊕ code (validated):
 *   1. Rasterize the map region in overlapping TILES (`pdftoppm` crop) at a
 *      DPI where the callout labels are legible, and OCR each tile with
 *      tesseract.js in SPARSE-TEXT mode (PSM 11) → positioned word boxes.
 *   2. Each code-like word is SNAPPED to the nearest code in an AUTHORITATIVE
 *      dictionary (`validCodes`, e.g. the municipality's own zoning by-law text)
 *      by Levenshtein distance — and ACCEPTED ONLY when the match is exact, or
 *      unambiguous within edit-distance 1 (a single nearest candidate, the next
 *      candidate strictly farther). Ambiguous / no-match tokens are REJECTED
 *      (e.g. `C3` ⇄ `G3` ⇄ `N3` → dropped). No code is ever invented: every
 *      emitted code is verbatim from the authoritative dictionary, and only
 *      where the OCR token maps to it unambiguously.
 *   3. The accepted token's tile pixel → page point → embedded georef → WGS84.
 *
 * The output is the same `CodePoint[]` the cadastre nearest-label aggregation
 * (`t1-zones.buildZones`) consumes, so the rest of the T1 pipeline is unchanged.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CodePoint } from "./t1-zones.js";
import type { GeoRef } from "./t1-georef.js";
import { looksLikeZoneCode, splitCode, kindForPrefix } from "./t1-labels.js";

export interface OcrLabelOptions {
  /** Render DPI for the tiles (default 250 — callout labels legible). */
  dpi?: number;
  /** Tile size / step in pixels (overlap = tile − step, default 1300 / 1100). */
  tile?: number;
  step?: number;
  /**
   * Map region in PAGE POINTS (top-left origin) to tile, [x0, y0, x1, y1].
   * Used to EXCLUDE the legend / revision-table band (whose codes would be
   * georeferenced to the wrong place). Default = whole page.
   */
  region?: [number, number, number, number];
  /**
   * Authoritative prefix → kind override (lower-case prefix keys), from the
   * map's own legend, used in preference to the generic `kindForPrefix` map
   * (municipal zoning prefixes are NOT standardized — e.g. Pointe-Claire's
   * `N` = industrial, `Pb` = institutional, `G` = golf).
   */
  kindByPrefix?: Record<string, string>;
  /** Scratch dir for tiles (default a tmp dir keyed on the pdf). */
  workDir?: string;
}

export interface OcrLabelStats {
  nTiles: number;
  nReads: number;
  nCodeLike: number;
  nExact: number;
  nDistance1: number;
  nRejected: number;
  /** % of in-region code-like tokens that snapped to a valid code. */
  snapRatePct: number;
  nKept: number;
  nDistinct: number;
  rejectSamples: string[];
}

export interface OcrLabelResult extends OcrLabelStats {
  codePoints: CodePoint[];
}

/** Levenshtein edit distance (iterative, O(mn) row buffer). */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n]!;
}

export type SnapConf = "exact" | "distance1" | "reject";
export interface SnapResult {
  token: string;
  code: string | null;
  d1: number;
  conf: SnapConf;
  reason?: string;
}

function normalizeForSnap(text: string): string {
  return text.replace(/[^A-Za-z0-9.]/g, "").toLowerCase();
}

/**
 * Snap an OCR token to the authoritative dictionary.
 * Accept iff: exact (d=0); or unambiguous distance-1 (token length ≥ 4, a
 * single nearest candidate, next-best ≥ 2). Otherwise REJECT (anti-invention).
 */
export function snapToDictionary(tokenRaw: string, dict: string[], dictLow: string[]): SnapResult {
  const token = tokenRaw.replace(/[^A-Za-z0-9.]/g, "");
  const t = normalizeForSnap(token);
  let d1 = Infinity;
  let d2 = Infinity;
  const cands: string[] = [];
  for (let i = 0; i < dictLow.length; i++) {
    const d = levenshtein(t, dictLow[i]!);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      cands.length = 0;
      cands.push(dict[i]!);
    } else if (d === d1) {
      cands.push(dict[i]!);
    } else if (d < d2) {
      d2 = d;
    }
  }
  if (d1 === 0) return { token, code: cands[0]!, d1, conf: "exact" };
  if (d1 === 1 && token.length >= 4 && cands.length === 1 && d2 >= 2)
    return { token, code: cands[0]!, d1, conf: "distance1" };
  return {
    token,
    code: null,
    d1,
    conf: "reject",
    reason: cands.length > 1 ? `ambiguous(${cands.slice(0, 3).join("/")})` : `nomatch(d1=${d1}->${cands[0]})`,
  };
}

interface RawRead {
  token: string;
  gx: number;
  gy: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function collectWords(data: any, tx: number, ty: number, out: RawRead[]): void {
  const push = (wd: any): void => {
    const bb = wd?.bbox;
    if (!bb) return;
    out.push({ token: String(wd.text ?? ""), gx: tx + (bb.x0 + bb.x1) / 2, gy: ty + (bb.y0 + bb.y1) / 2 });
  };
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? []) for (const wd of l.words ?? []) push(wd);
  for (const wd of data.words ?? []) push(wd);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Extract OCR-validated, georeferenced zone-code labels from a glyph GeoPDF.
 *
 * - `pdfPath`    : the local GeoPDF.
 * - `geo`        : its embedded georeferencing (`extractGeoRef`).
 * - `validCodes` : the AUTHORITATIVE list of regulatory zone codes (verbatim).
 */
export async function extractLabelsOcr(
  pdfPath: string,
  geo: GeoRef,
  validCodes: string[],
  opts: OcrLabelOptions = {},
): Promise<OcrLabelResult> {
  const dpi = opts.dpi ?? 250;
  const scale = dpi / 72;
  const tile = opts.tile ?? 1300;
  const step = opts.step ?? 1100;
  const [rx0, ry0, rx1, ry1] = opts.region ?? [0, 0, geo.pageW, geo.pageH];
  const workDir =
    opts.workDir ?? join(tmpdir(), `t1ocr-${createHash("md5").update(pdfPath).digest("hex").slice(0, 8)}`);
  mkdirSync(workDir, { recursive: true });

  const dict = [...validCodes];
  const dictLow = dict.map(normalizeForSnap);

  const pxX0 = Math.round(rx0 * scale);
  const pxY0 = Math.round(ry0 * scale);
  const pxX1 = Math.round(rx1 * scale);
  const pxY1 = Math.round(ry1 * scale);

  const { createWorker } = (await import("tesseract.js")) as typeof import("tesseract.js");
  const worker = await createWorker("eng", 1, { logger: () => {} });
  // PSM 11 = SPARSE_TEXT: find as much text as possible, no layout assumptions.
  await worker.setParameters({ tessedit_pageseg_mode: "11" as never });

  const reads: RawRead[] = [];
  let nTiles = 0;
  for (let ty = pxY0; ty < pxY1; ty += step) {
    for (let tx = pxX0; tx < pxX1; tx += step) {
      const w = Math.min(tile, pxX1 - tx);
      const h = Math.min(tile, pxY1 - ty);
      if (w < 50 || h < 50) continue;
      const base = join(workDir, `t_${dpi}_${tx}_${ty}`);
      const png = `${base}.png`;
      if (!existsSync(png)) {
        const ret = spawnSync("pdftoppm", [
          "-singlefile",
          "-r",
          String(dpi),
          "-x",
          String(tx),
          "-y",
          String(ty),
          "-W",
          String(w),
          "-H",
          String(h),
          "-png",
          pdfPath,
          base,
        ]);
        if (ret.status !== 0 || !existsSync(png)) {
          const err = ret.error ? ` (${ret.error.message})` : "";
          throw new Error(`pdftoppm failed for tile ${tx},${ty} ${w}x${h}${err}`);
        }
      }
      const ret = await worker.recognize(png, {}, { blocks: true } as never);
      collectWords(ret.data, tx, ty, reads);
      nTiles++;
    }
  }
  await worker.terminate();

  // code-like filter + dictionary snap + georeference
  let nCodeLike = 0;
  let nExact = 0;
  let nD1 = 0;
  let nReject = 0;
  const rejectSamples = new Map<string, number>();
  const raw: Array<{ code: string; lon: number; lat: number }> = [];
  for (const r of reads) {
    const cleaned = r.token.replace(/[^A-Za-z0-9.\-]/g, "").trim();
    if (!looksLikeZoneCode(cleaned)) continue;
    nCodeLike++;
    const s = snapToDictionary(cleaned, dict, dictLow);
    if (s.conf === "reject") {
      nReject++;
      rejectSamples.set(s.reason!, (rejectSamples.get(s.reason!) ?? 0) + 1);
      continue;
    }
    if (s.conf === "exact") nExact++;
    else nD1++;
    const [lon, lat] = geo.topLeftToLonLat(r.gx / scale, r.gy / scale);
    raw.push({ code: s.code!, lon, lat });
  }

  // dedup the same code within ~35 m (overlapping tiles re-read a label)
  const M = 111320;
  const kept: typeof raw = [];
  for (const p of raw) {
    const dup = kept.find(
      (q) =>
        q.code === p.code &&
        Math.hypot((q.lon - p.lon) * M * Math.cos((p.lat * Math.PI) / 180), (q.lat - p.lat) * M) < 35,
    );
    if (!dup) kept.push(p);
  }

  const kindMap = opts.kindByPrefix;
  const codePoints: CodePoint[] = kept.map((p) => {
    const { prefix } = splitCode(p.code);
    const kind = kindMap?.[prefix.toLowerCase()] ?? kindForPrefix(prefix);
    return { code: p.code, prefix, kind, lon: p.lon, lat: p.lat };
  });
  const distinct = new Set(codePoints.map((c) => c.code));
  const snapRatePct = nCodeLike > 0 ? (100 * (nExact + nD1)) / nCodeLike : 0;

  return {
    nTiles,
    nReads: reads.length,
    nCodeLike,
    nExact,
    nDistance1: nD1,
    nRejected: nReject,
    snapRatePct: Number(snapRatePct.toFixed(1)),
    nKept: codePoints.length,
    nDistinct: distinct.size,
    rejectSamples: [...rejectSamples.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k}:${v}`),
    codePoints,
  };
}
