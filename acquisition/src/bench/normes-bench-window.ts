/**
 * normes-bench-window — shared grille-page WINDOWING for the vision/OCR benchmark
 * runners (Claude-4.8, agy/Gemini, …). Extracted VERBATIM from the Claude-4.8 runner
 * so every engine reads the EXACT same per-slug page window (fair comparison).
 *
 * Priority: verified per-slug override (work/bench/windows.json) → zone-code column
 * header (transposed grid) → grille-title span → raw zone-code density band →
 * grille-title locator → head-of-doc (pure image scan). Text-signal helpers reuse the
 * production classifiers so a prose/ToC page never trips the grille heuristic.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { locateGrillePages } from "../../../packages/qc-sources/src/sources/grille-page-locator.js";
import { classifyGrillePdf } from "../../../packages/qc-sources/src/sources/grille-pdf-classifier.js";
import { looksLikeTableOfContents } from "../lib/zonage-norms.js";

export interface Window {
  first: number;
  last: number;
  pageCount: number;
  textChars: number;
  layout: string;
  grillePages: number;
}

export function pdfPageCount(pdf: string): number {
  const r = spawnSync("pdfinfo", [pdf], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m?.[1] ? Number(m[1]) : 0;
}

export function pageTexts(pdf: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Verified per-slug grille windows (work/bench/windows.json): { "<slug>": {first,last} }. */
export function loadWindows(benchDir: string): Record<string, { first?: number; last?: number }> {
  const p = join(benchDir, "windows.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, { first?: number; last?: number }>;
  } catch {
    return {};
  }
}

const AUTO_GRID_MIN_CODES = 6;
const ZONE_CODE_TOKEN = /\b[A-Z]{1,4}-?\d{1,3}\b/g;
const GRID_HEADER_EXCLUDE = /\b(?:ARTICLES?|R[ÈE]GLEMENTS?|REGLEMENTS?)\b|\b(?:19|20)\d{2}\b/i;

function detectGridWindow(texts: string[]): { first: number; last: number; hits: number } | null {
  const lineHits: number[] = [];
  const perPage: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const pageCodes = new Set<string>();
    let lineHit = false;
    if (looksLikeTableOfContents(texts[i] ?? "")) {
      perPage[i] = 0;
      continue;
    }
    for (const line of (texts[i] ?? "").split(/\r?\n/)) {
      if (GRID_HEADER_EXCLUDE.test(line)) continue;
      const codes = new Set<string>();
      for (const m of line.matchAll(ZONE_CODE_TOKEN)) {
        codes.add(m[0].toUpperCase());
        pageCodes.add(m[0].toUpperCase());
      }
      if (codes.size >= AUTO_GRID_MIN_CODES) lineHit = true;
    }
    if (lineHit) lineHits.push(i + 1);
    perPage[i] = pageCodes.size;
  }
  if (lineHits.length > 0) return { first: Math.min(...lineHits), last: Math.max(...lineHits), hits: lineHits.length };
  let peak = 0;
  let peakIdx = -1;
  for (let i = 0; i < perPage.length; i++) if ((perPage[i] ?? 0) > peak) { peak = perPage[i]!; peakIdx = i; }
  if (peakIdx < 0 || peak < 10) return null;
  const thr = Math.max(8, Math.floor(peak * 0.5));
  let lo = peakIdx;
  let hi = peakIdx;
  while (lo - 1 >= 0 && (perPage[lo - 1] ?? 0) >= thr) lo--;
  while (hi + 1 < perPage.length && (perPage[hi + 1] ?? 0) >= thr) hi++;
  const dense = perPage.filter((c) => (c ?? 0) >= thr).length;
  return { first: lo + 1, last: hi + 1, hits: dense };
}

/** Pick the grille page window (identical logic to the Claude-4.8 runner). */
export function pickWindow(
  pdf: string,
  maxPages: number,
  override?: { first?: number; last?: number },
): Window {
  const pageCount = pdfPageCount(pdf);
  const texts = pageTexts(pdf);
  const textChars = texts.reduce((n, t) => n + t.trim().length, 0);
  if (override && override.first) {
    const first = override.first;
    const last = Math.min(override.last ?? first - 1 + maxPages, first - 1 + maxPages, pageCount || (override.last ?? first));
    return { first, last, pageCount, textChars, layout: "override", grillePages: 0 };
  }
  if (textChars > 2000) {
    const cls = classifyGrillePdf(texts);
    const s = cls.signals;
    if (s.zoneHeaderPages > 0 && s.firstZoneHeaderPage > 0) {
      const first = s.firstZoneHeaderPage;
      const last = Math.min(s.lastZoneHeaderPage, first - 1 + maxPages, pageCount || s.lastZoneHeaderPage);
      return { first, last, pageCount, textChars, layout: "zone-header", grillePages: s.zoneHeaderPages };
    }
    if (s.grillePages > 0 && s.firstGrillePage > 0) {
      const first = s.firstGrillePage;
      const last = Math.min(s.lastGrillePage, first - 1 + maxPages, pageCount || s.lastGrillePage);
      return { first, last, pageCount, textChars, layout: `grille-${cls.kind}`, grillePages: s.grillePages };
    }
    const dg = detectGridWindow(texts);
    if (dg) {
      const first = dg.first;
      const last = Math.min(dg.last, first - 1 + maxPages, pageCount || dg.last);
      return { first, last, pageCount, textChars, layout: "grid-density", grillePages: dg.hits };
    }
  }
  const loc = texts.length ? locateGrillePages(texts) : null;
  if (loc) {
    const first = loc.firstPage;
    const last = Math.min(loc.lastPage, first - 1 + maxPages, pageCount || loc.lastPage);
    return { first, last, pageCount, textChars, layout: loc.layout, grillePages: loc.grillePageCount };
  }
  const last = Math.min(maxPages, pageCount || maxPages);
  return { first: 1, last, pageCount, textChars, layout: "image-scan", grillePages: 0 };
}

/** Locate the staged grille.pdf for a slug under work/zonage-norms/<slug>/. */
export function localGrille(workDir: string, slug: string): string | null {
  const dir = join(workDir, slug);
  if (!existsSync(dir)) return null;
  try {
    const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return null;
    const pref = pdfs.find((f) => /grille/i.test(f)) ?? pdfs[0]!;
    return join(dir, pref);
  } catch {
    return null;
  }
}
