/**
 * t1-labels.ts — extract georeferenced zone-code labels from a T1 GeoPDF.
 *
 * The zone codes are positioned TEXT in the PDF (Esri ArcGIS Pro plans). We use
 * poppler `pdftotext -bbox-layout` (a pure system binary, like the pilot probe;
 * NOT GDAL) to read each word with its page bbox, keep the ones that look like a
 * QC zone code and sit INSIDE the map neatline (the GeoRef BBox), and map each
 * to WGS84 via the embedded transform → a `CodePoint` for the cadastre
 * aggregation. Zero codes are invented: every code is verbatim PDF text.
 */
import { execSync } from "node:child_process";

import type { CodePoint } from "./t1-zones.js";
import type { GeoRef } from "./t1-georef.js";

/** Street/legend/annotation words never treated as a zone code. */
export const STOPWORDS = new Set([
  "rue", "rte", "route", "chemin", "boulevard", "ave", "avenue", "ch", "blvd",
  "rang", "montee", "montée", "côte", "cote", "nord", "sud", "est", "ouest",
  "n", "s", "e", "o", "km", "m", "ha", "ft", "plan", "de", "du", "des", "le",
  "la", "les", "zonage", "zone", "zones", "affectation", "règlement",
  "reglement", "echelle", "légende", "legende", "annexe", "titre", "date",
  "source", "projection", "datum", "note", "page", "cmm", "mrc",
]);

/**
 * QC zone code formats covered:
 *   LETTERS [digits] [-.] DIGITS [letter]  → A-1, H-71, H2, RB-300, RU-100a,
 *                                            A1-10, A2-85, A3-109 (saint-amable)
 *                                            N1 s.1 / N1s.1 (Pointe-Claire sectors)
 *   LETTERS [digits] - LETTERS - DIGITS     → MN2-A-153 (carignan)
 *   LETTERS - DIGITS - SUFFIX               → H-511-E, Mc-662-S4
 *   DIGITS - LETTERS                        → 605-Cb, 314-P (val-dor/saint-tite)
 * Requires both a letter and a digit (the anti-#74 rule: a pure sequential
 * integer is NOT a regulatory zone code).
 */
export const ZONE_CODE_RE =
  /^(?:[A-Z]{1,4}\d{0,3}(?:-[A-Z])?[-.]?\d{1,4}[A-Z]?(?:-[A-Z0-9]{1,4})?|[A-Z]{1,4}\d{1,3}s\.?\d+|\d{2,4}-[A-Z]{1,5})$/i;

export function normalizeZoneCodeText(text: string): string {
  return text.trim().replace(/\s+/g, "-");
}

export interface ZoneCodeOptions {
  /**
   * SAFE numeric relaxation (default OFF). When provided, a PURE-NUMERIC token
   * (1–4 digits) is accepted as a zone code IFF it is a verbatim member of this
   * authoritative dictionary. Absent → default lettered-only behaviour (the
   * anti-#74 rule). See lib/numeric-codes.ts for the full guard.
   */
  numericDict?: Set<string>;
}

export function looksLikeZoneCode(text: string, opts: ZoneCodeOptions = {}): boolean {
  const t = normalizeZoneCodeText(text);
  if (!t || t.length > 16) return false;
  if (STOPWORDS.has(t.toLowerCase())) return false;
  // Numeric relaxation: a dict-backed pure-numeric code is a real zone code.
  if (opts.numericDict && /^\d{1,4}$/.test(t) && opts.numericDict.has(t)) return true;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false; // anti-#74
  if (/^REG(?:[-.]|\d)/i.test(t)) return false;
  return ZONE_CODE_RE.test(t);
}

const PREFIX_KIND: Record<string, string> = {
  H: "residential", R: "residential", RA: "residential", RB: "residential",
  RU: "residential", V: "residential",
  C: "commercial", CB: "commercial", CO: "commercial",
  I: "industrial", IA: "industrial", IB: "industrial", ZI: "industrial",
  P: "institutional", PA: "park", PB: "park",
  M: "mixed-use",
  A: "agricultural", AF: "agroforestry", AD: "agricultural",
  N: "conservation", CN: "conservation", CONS: "conservation", EC: "conservation",
  REC: "recreation", F: "forestry", AERO: "airport",
};
export function kindForPrefix(prefix: string): string {
  return PREFIX_KIND[prefix.toUpperCase()] ?? "unknown";
}

export function splitCode(code: string): { prefix: string } {
  const m = normalizeZoneCodeText(code).match(/^([A-Za-z]+)/);
  return { prefix: m ? m[1]!.toUpperCase() : "" };
}

export interface RawLabel {
  text: string;
  pageX: number; // pdftotext top-left origin, page units
  pageY: number;
  xMin?: number;
  yMin?: number;
  xMax?: number;
  yMax?: number;
  blockId?: number;
  lineId?: number;
  sourceWordCount?: number;
}

export interface LabelRegionFrac {
  /** Fraction of page width, 0=left. */
  fx0: number;
  /** Fraction of page height, 0=top. */
  fy0: number;
  /** Fraction of page width, 1=right. */
  fx1: number;
  /** Fraction of page height, 1=bottom. */
  fy1: number;
}

export interface PdfTextOptions {
  /** 1-based page to read. When omitted, preserves the historical all-page scan. */
  page?: number;
  /** Page-fraction regions to mask out before emitting labels, e.g. title boxes. */
  excludeRegions?: LabelRegionFrac[];
  /** SAFE numeric relaxation (default OFF): dict-backed pure-numeric zone codes. */
  numericDict?: Set<string>;
}

/** Run pdftotext -bbox-layout and return all words with their center. */
export function pdftotextWords(pdfPath: string, opts: PdfTextOptions = {}): { words: RawLabel[]; pageW: number; pageH: number } {
  let xml: string;
  const pageArgs = opts.page && opts.page > 0 ? ` -f ${opts.page} -l ${opts.page}` : "";
  try {
    xml = execSync(`pdftotext${pageArgs} -bbox-layout ${JSON.stringify(pdfPath)} - 2>/dev/null`, {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 200 * 1024 * 1024,
    });
  } catch {
    return { words: [], pageW: 0, pageH: 0 };
  }
  const pageMatch = xml.match(/page width="([\d.]+)"\s+height="([\d.]+)"/);
  if (!pageMatch) return { words: [], pageW: 0, pageH: 0 };
  const pageW = parseFloat(pageMatch[1]!);
  const pageH = parseFloat(pageMatch[2]!);
  const words: RawLabel[] = [];
  const wordRe =
    /xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)">([^<]+)<\/word>/g;
  const pushWord = (m: RegExpExecArray, blockId?: number, lineId?: number): void => {
    const text = (m[5] ?? "").trim();
    if (!text) return;
    const xMin = parseFloat(m[1]!);
    const yMin = parseFloat(m[2]!);
    const xMax = parseFloat(m[3]!);
    const yMax = parseFloat(m[4]!);
    words.push({
      text,
      pageX: (xMin + xMax) / 2,
      pageY: (yMin + yMax) / 2,
      xMin,
      yMin,
      xMax,
      yMax,
      blockId,
      lineId,
    });
  };

  const blockRe = /<block\b[^>]*>([\s\S]*?)<\/block>/g;
  const lineRe = /<line\b[^>]*>([\s\S]*?)<\/line>/g;
  let blockMatch: RegExpExecArray | null;
  let blockId = 0;
  let lineId = 0;
  while ((blockMatch = blockRe.exec(xml)) !== null) {
    const blockXml = blockMatch[1]!;
    lineRe.lastIndex = 0;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRe.exec(blockXml)) !== null) {
      const lineXml = lineMatch[1]!;
      wordRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = wordRe.exec(lineXml)) !== null) pushWord(m, blockId, lineId);
      lineId++;
    }
    blockId++;
  }
  if (words.length === 0) {
    let m: RegExpExecArray | null;
    while ((m = wordRe.exec(xml)) !== null) {
      pushWord(m);
    }
  }
  return { words, pageW, pageH };
}

interface LabelCandidate extends RawLabel {
  wordIndexes: number[];
}

const CODE_PART_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

function isCodePart(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 16 && CODE_PART_RE.test(t) && /[A-Za-z0-9]/.test(t);
}

function hasBox(w: RawLabel): w is RawLabel & Required<Pick<RawLabel, "xMin" | "yMin" | "xMax" | "yMax">> {
  return w.xMin !== undefined && w.yMin !== undefined && w.xMax !== undefined && w.yMax !== undefined;
}

function rangeGap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
}

function rangeOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function canJoinCodeParts(a: RawLabel, b: RawLabel): boolean {
  if (a.blockId !== undefined && b.blockId !== undefined && a.blockId !== b.blockId) return false;
  if (!hasBox(a) || !hasBox(b)) return a.lineId !== undefined && a.lineId === b.lineId;

  const ah = Math.max(1, a.yMax - a.yMin);
  const bh = Math.max(1, b.yMax - b.yMin);
  const avgH = (ah + bh) / 2;
  const hGap = rangeGap(a.xMin, a.xMax, b.xMin, b.xMax);
  const vGap = rangeGap(a.yMin, a.yMax, b.yMin, b.yMax);
  const xOverlap = rangeOverlap(a.xMin, a.xMax, b.xMin, b.xMax);
  const yOverlap = rangeOverlap(a.yMin, a.yMax, b.yMin, b.yMax);
  const minW = Math.max(1, Math.min(a.xMax - a.xMin, b.xMax - b.xMin));

  const sameLine = yOverlap > 0 && hGap <= avgH * 1.5;
  const stackedOrRotated = xOverlap >= minW * 0.25 && vGap <= avgH * 0.75;
  return sameLine || stackedOrRotated;
}

function appendCodePart(acc: string, part: string): string {
  const p = part.trim();
  if (acc.endsWith("-") || acc.endsWith(".")) return acc + p.replace(/^[-.]/, "");
  if (/^[-.]/.test(p)) return acc + p;
  return `${acc}-${p}`;
}

function joinCodeParts(parts: string[]): string {
  return parts.slice(1).reduce((acc, p) => appendCodePart(acc, p), parts[0]!.trim());
}

function safeMultiWordCode(parts: string[], code: string): boolean {
  if (parts.length === 1) return true;
  if (/^\d/.test(code)) return false;
  const digitCount = (code.match(/\d/g) ?? []).length;
  if (digitCount < 2) return false;
  if (/^[A-Z]-\d$/i.test(code)) return false;

  const first = parts[0]!;
  const second = parts[1];
  const hasExplicitSeparatorAtEveryJoin = parts.slice(1).every((p, i) => /[-.]$/.test(parts[i]!) || /^[-.]/.test(p));
  if (hasExplicitSeparatorAtEveryJoin) return true;
  if (/^H$/i.test(first) && second && /^\d{2,4}-[A-Z0-9]{1,4}$/i.test(second)) return true;
  if (/^H$/i.test(first) && second && /^\d{3,4}$/.test(second)) return true;
  if (
    parts.length === 3 &&
    /^H$/i.test(first) &&
    /^\d{2,4}$/i.test(parts[1]!) &&
    /^[A-Z0-9]{1,4}$/i.test(parts[2]!)
  ) {
    return true;
  }
  return false;
}

function makeCandidate(words: RawLabel[], wordIndexes: number[], text: string): LabelCandidate {
  const parts = wordIndexes.map((i) => words[i]!);
  const boxed = parts.every(hasBox);
  if (boxed) {
    const xMin = Math.min(...parts.map((p) => p.xMin!));
    const yMin = Math.min(...parts.map((p) => p.yMin!));
    const xMax = Math.max(...parts.map((p) => p.xMax!));
    const yMax = Math.max(...parts.map((p) => p.yMax!));
    return {
      text,
      pageX: (xMin + xMax) / 2,
      pageY: (yMin + yMax) / 2,
      xMin,
      yMin,
      xMax,
      yMax,
      blockId: parts[0]!.blockId,
      lineId: parts[0]!.lineId,
      sourceWordCount: wordIndexes.length,
      wordIndexes,
    };
  }
  return {
    text,
    pageX: parts.reduce((sum, p) => sum + p.pageX, 0) / parts.length,
    pageY: parts.reduce((sum, p) => sum + p.pageY, 0) / parts.length,
    blockId: parts[0]!.blockId,
    lineId: parts[0]!.lineId,
    sourceWordCount: wordIndexes.length,
    wordIndexes,
  };
}

function isDigitLeadingSingleLetter(code: string): boolean {
  return /^\d{2,4}-[A-Z]$/i.test(code);
}

function isTinyCandidate(w: RawLabel): boolean {
  if (!hasBox(w)) return false;
  return w.xMax - w.xMin < 8 && w.yMax - w.yMin < 8;
}

export function zoneLabelCandidatesFromWords(words: RawLabel[], opts: ZoneCodeOptions = {}): RawLabel[] {
  const candidates: LabelCandidate[] = [];
  for (let i = 0; i < words.length; i++) {
    const first = words[i]!;
    const single = normalizeZoneCodeText(first.text);
    if (looksLikeZoneCode(single, opts)) candidates.push(makeCandidate(words, [i], single));
    if (!isCodePart(first.text)) continue;

    const parts = [first.text.trim()];
    const indexes = [i];
    let prev = first;
    for (let j = i + 1; j < Math.min(words.length, i + 3); j++) {
      const next = words[j]!;
      if (!isCodePart(next.text) || !canJoinCodeParts(prev, next)) break;
      parts.push(next.text.trim());
      indexes.push(j);
      const code = joinCodeParts(parts);
      // Multi-word joins stay lettered-only (safeMultiWordCode already refuses a
      // digit-leading join), so the numericDict never fabricates a joined code.
      if (looksLikeZoneCode(code) && safeMultiWordCode(parts, code)) {
        candidates.push(makeCandidate(words, [...indexes], code));
      }
      prev = next;
    }
  }

  const used = new Set<number>();
  const selected: LabelCandidate[] = [];
  for (const c of candidates.sort((a, b) => b.wordIndexes.length - a.wordIndexes.length || b.text.length - a.text.length)) {
    if (c.wordIndexes.some((i) => used.has(i))) continue;
    selected.push(c);
    c.wordIndexes.forEach((i) => used.add(i));
  }
  return selected.sort((a, b) => a.wordIndexes[0]! - b.wordIndexes[0]!);
}

export interface ExtractLabelsResult {
  codePoints: CodePoint[];
  nWords: number;
  nCodeLike: number;
  nInsideFrame: number;
  rejectedOutsideFrame: number;
}

function inExcludedRegion(px: number, pyTop: number, geo: GeoRef, regions: LabelRegionFrac[] | undefined): boolean {
  if (!regions?.length) return false;
  return regions.some((r) => {
    const x0 = Math.min(r.fx0, r.fx1) * geo.pageW;
    const x1 = Math.max(r.fx0, r.fx1) * geo.pageW;
    const y0 = Math.min(r.fy0, r.fy1) * geo.pageH;
    const y1 = Math.max(r.fy0, r.fy1) * geo.pageH;
    return px >= x0 && px <= x1 && pyTop >= y0 && pyTop <= y1;
  });
}

export function extractLabelsFromWords(
  words: RawLabel[],
  textPageW: number,
  textPageH: number,
  geo: GeoRef,
  opts: PdfTextOptions = {},
): ExtractLabelsResult {
  const candidates = zoneLabelCandidatesFromWords(words, { numericDict: opts.numericDict });
  const hasSplitPrefixCompounds = candidates.some(
    (c) => (c.sourceWordCount ?? 1) > 1 && /^[A-Z]{1,4}\d{0,3}(?:-[A-Z])?-\d{2,4}(?:-[A-Z0-9]{1,4})?$/i.test(c.text),
  );
  // pdftotext page units vs PDF user-space (MediaBox) — usually 1:1.
  const sx = textPageW > 0 ? geo.pageW / textPageW : 1;
  const sy = textPageH > 0 ? geo.pageH / textPageH : 1;
  // Normalize the neatline corners: some viewport BBoxes store y inverted
  // (top-left origin, by0 > by1 — ESRI ArcMap candiac/saint-mathieu), which
  // would make the pad negative and reject every label.
  const [rx0, ry0, rx1, ry1] = geo.bbox;
  const bx0 = Math.min(rx0, rx1);
  const bx1 = Math.max(rx0, rx1);
  const by0 = Math.min(ry0, ry1);
  const by1 = Math.max(ry0, ry1);
  // small outward margin so a label glued to the neatline still counts (5% pad)
  const padX = (bx1 - bx0) * 0.05;
  const padY = (by1 - by0) * 0.05;

  const codePoints: CodePoint[] = [];
  let nCodeLike = 0;
  let nInside = 0;
  let rejectedOutside = 0;
  for (const w of candidates) {
    if (!looksLikeZoneCode(w.text, { numericDict: opts.numericDict })) continue;
    if (isTinyCandidate(w)) continue;
    if (hasSplitPrefixCompounds && (w.sourceWordCount ?? 1) === 1 && isDigitLeadingSingleLetter(w.text)) continue;
    nCodeLike++;
    const px = w.pageX * sx; // PDF user-space x
    const pyTop = w.pageY * sy; // top-down y
    const pyUser = geo.pageH - pyTop; // bottom-up y
    if (
      px < bx0 - padX ||
      px > bx1 + padX ||
      pyUser < by0 - padY ||
      pyUser > by1 + padY ||
      inExcludedRegion(px, pyTop, geo, opts.excludeRegions)
    ) {
      rejectedOutside++;
      continue;
    }
    nInside++;
    const [lon, lat] = geo.pageToLonLat(px, pyUser);
    const code = normalizeZoneCodeText(w.text);
    const { prefix } = splitCode(code);
    codePoints.push({ code, prefix, kind: kindForPrefix(prefix), lon, lat });
  }
  return {
    codePoints,
    nWords: words.length,
    nCodeLike,
    nInsideFrame: nInside,
    rejectedOutsideFrame: rejectedOutside,
  };
}

/**
 * Extract georeferenced zone-code labels from a GeoPDF.
 *
 * - `geo`     : the embedded georeferencing (page→WGS84).
 * - keeps only words matching a QC zone code that fall INSIDE the map neatline
 *   (GeoRef BBox, with a small margin), excluding the title block / legend.
 * - converts pdftotext's page units to PDF user-space (origin top-left → the
 *   GeoRef expects top-left via `topLeftToLonLat`, scaled to the MediaBox).
 */
export function extractLabels(pdfPath: string, geo: GeoRef, opts: PdfTextOptions = {}): ExtractLabelsResult {
  const { words, pageW, pageH } = pdftotextWords(pdfPath, opts);
  return extractLabelsFromWords(words, pageW, pageH, geo, opts);
}
