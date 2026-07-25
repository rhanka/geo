/**
 * t2-labels-ocr.ts — EXPERIMENTAL positioned-OCR label extraction for T2 plans
 * whose zone codes are GLYPHS (vector outlines), not selectable text.
 *
 * pdftotext yields nothing for these (brossard, varennes, mont-royal, ...). We
 * rasterise the selected page with poppler `pdftoppm` and run tesseract.js (a pure-JS
 * engine — no GDAL, no Python) to recover each word with a pixel bbox, then map
 * pixel → page-fraction → WGS84 via the manual GeoRef's `topLeftToLonLat`.
 *
 * IMPORTANT (anti-invention): tesseract glyph fidelity on dense municipal plans
 * is imperfect (the T1 rollout saw `Re3y`, `Rez3`, `C0` …). This path therefore
 * exists to ASSIST a human review in the gcp3 UI, NOT to auto-serve. The CLI
 * `--labels ocr` prints a loud review warning, and the operator must confirm the
 * codes are real before serving. Text-label T2 cities should always use the
 * default `--labels text` (pdftotext) path, which is exact.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWorker } from "tesseract.js";

import type { CodePoint } from "./t1-zones.js";
import type { GeoRef } from "./t1-georef.js";
import type { ExtractLabelsResult } from "./t1-labels.js";
import { looksLikeZoneCode, splitCode, kindForPrefix } from "./t1-labels.js";

export interface OcrOptions {
  /** Rasterisation DPI (default 200). Higher = sharper glyphs, slower. */
  dpi?: number;
  /** 1-based PDF page to OCR (default 1). */
  page?: number;
  /** tesseract language (default "eng"). */
  lang?: string;
}

/** Read a PNG's pixel width/height from its IHDR chunk (no image lib needed). */
function pngSize(buf: Buffer): { w: number; h: number } {
  // PNG: 8-byte sig, then 4-byte len, 4-byte "IHDR", then width(4) height(4).
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a PNG / missing IHDR");
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

interface OcrWord {
  text: string;
  cx: number; // pixel centre
  cy: number;
}

/** Flatten tesseract result to word centres, across API shapes (words | blocks). */
function wordsFromResult(data: unknown): OcrWord[] {
  const out: OcrWord[] = [];
  const push = (text: string, b: { x0: number; y0: number; x1: number; y1: number }): void => {
    const t = (text ?? "").trim();
    if (!t) return;
    out.push({ text: t, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 });
  };
  const d = data as Record<string, unknown>;
  const words = d["words"] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(words) && words.length) {
    for (const w of words) push(String(w["text"] ?? ""), w["bbox"] as never);
    return out;
  }
  // newer tesseract.js: blocks → paragraphs → lines → words
  const blocks = d["blocks"] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(blocks)) {
    for (const blk of blocks) {
      for (const par of (blk["paragraphs"] as Array<Record<string, unknown>>) ?? []) {
        for (const ln of (par["lines"] as Array<Record<string, unknown>>) ?? []) {
          for (const w of (ln["words"] as Array<Record<string, unknown>>) ?? []) {
            push(String(w["text"] ?? ""), w["bbox"] as never);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Extract georeferenced zone-code labels from a GLYPH T2 PDF via OCR.
 * Returns the same `ExtractLabelsResult` shape as the text path, so the build
 * pipeline is identical downstream.
 */
export async function extractLabelsOcr(
  pdfPath: string,
  geo: GeoRef,
  opts: OcrOptions = {},
): Promise<ExtractLabelsResult> {
  const dpi = opts.dpi ?? 200;
  const page = opts.page ?? 1;
  const lang = opts.lang ?? "eng";
  const prefix = join(tmpdir(), `t2ocr-${Date.now()}`);
  execSync(
    `pdftoppm -singlefile -r ${dpi} -png -f ${page} -l ${page} ${JSON.stringify(pdfPath)} ${JSON.stringify(prefix)}`,
    { timeout: 180_000 },
  );
  const png = `${prefix}.png`;
  if (!existsSync(png)) throw new Error(`pdftoppm produced no page-${page} PNG`);
  const pngBuf = readFileSync(png);
  const { w: imgW, h: imgH } = pngSize(pngBuf);

  const worker = await createWorker(lang);
  let words: OcrWord[];
  try {
    // ask for word/block output explicitly (v5+ needs the output flag).
    const res = (await worker.recognize(png, {}, { blocks: true } as never)) as { data: unknown };
    words = wordsFromResult(res.data);
  } finally {
    await worker.terminate();
  }

  // in-frame neatline (user-space), normalised like t1-labels.
  const [rx0, ry0, rx1, ry1] = geo.bbox;
  const bx0 = Math.min(rx0, rx1);
  const bx1 = Math.max(rx0, rx1);
  const by0 = Math.min(ry0, ry1);
  const by1 = Math.max(ry0, ry1);
  const padX = (bx1 - bx0) * 0.05;
  const padY = (by1 - by0) * 0.05;

  const codePoints: CodePoint[] = [];
  let nCodeLike = 0;
  let nInside = 0;
  let rejectedOutside = 0;
  for (const w of words) {
    if (!looksLikeZoneCode(w.text)) continue;
    nCodeLike++;
    const fx = w.cx / imgW;
    const fy = w.cy / imgH; // top-down
    const px = fx * geo.pageW; // user-space x
    const pyUser = (1 - fy) * geo.pageH; // user-space bottom-up
    if (px < bx0 - padX || px > bx1 + padX || pyUser < by0 - padY || pyUser > by1 + padY) {
      rejectedOutside++;
      continue;
    }
    nInside++;
    const [lon, lat] = geo.topLeftToLonLat(px, fy * geo.pageH);
    const { prefix: pfx } = splitCode(w.text);
    codePoints.push({ code: w.text, prefix: pfx, kind: kindForPrefix(pfx), lon, lat });
  }
  return {
    codePoints,
    nWords: words.length,
    nCodeLike,
    nInsideFrame: nInside,
    rejectedOutsideFrame: rejectedOutside,
  };
}
