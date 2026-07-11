/**
 * Pure label parsing from the T1 GeoPDF pipeline.
 *
 * The acquisition runner owns pdftotext and file access. This module accepts
 * already-positioned words and returns georeferenced zone-code points.
 */
import type { GeoRef } from "./affine.js";

export interface CodePoint {
  code: string;
  prefix?: string;
  kind?: string;
  lon: number;
  lat: number;
}

/** Street/legend/annotation words never treated as a zone code. */
export const STOPWORDS = new Set([
  "rue", "rte", "route", "chemin", "boulevard", "ave", "avenue", "ch", "blvd",
  "rang", "montee", "montée", "côte", "cote", "nord", "sud", "est", "ouest",
  "n", "s", "e", "o", "km", "m", "ha", "ft", "plan", "de", "du", "des", "le",
  "la", "les", "zonage", "zone", "zones", "affectation", "règlement",
  "reglement", "echelle", "légende", "legende", "annexe", "titre", "date",
  "source", "projection", "datum", "note", "page", "cmm", "mrc",
]);

export const ZONE_CODE_RE =
  /^(?:[A-Z]{1,4}\d{0,3}(?:-[A-Z])?[-.]?\d{1,4}[A-Z]?(?:-[A-Z0-9]{1,4})?|[A-Z]{1,4}\d{1,3}s\.?\d+|\d{2,4}-[A-Z]{1,5})$/i;

export function normalizeZoneCodeText(text: string): string {
  return text.trim().replace(/\s+/g, "-");
}

export interface ZoneCodeOptions {
  numericDict?: Set<string>;
}

export function looksLikeZoneCode(text: string, opts: ZoneCodeOptions = {}): boolean {
  const t = normalizeZoneCodeText(text);
  if (!t || t.length > 16) return false;
  if (STOPWORDS.has(t.toLowerCase())) return false;
  if (opts.numericDict && /^\d{1,4}$/.test(t) && opts.numericDict.has(t)) return true;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false;
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
  /** Horizontal centre in pdftotext page units, with a top-left origin. */
  pageX: number;
  /** Vertical centre in pdftotext page units, with a top-left origin. */
  pageY: number;
  /** Optional pdftotext bbox edges, in the same page units as pageX/pageY. */
  xMin?: number;
  yMin?: number;
  xMax?: number;
  yMax?: number;
  blockId?: number;
  lineId?: number;
  sourceWordCount?: number;
}

export interface LabelRegionFrac {
  /** Fraction of page width, 0 = left. */
  fx0: number;
  /** Fraction of page height, 0 = top. */
  fy0: number;
  /** Fraction of page width, 1 = right. */
  fx1: number;
  /** Fraction of page height, 1 = bottom. */
  fy1: number;
}

export interface LabelComputeOptions {
  /** Page-fraction regions to mask before emitting labels, for example title boxes. */
  excludeRegions?: LabelRegionFrac[];
  /** Accept pure-numeric codes only when they occur in this authoritative dictionary. */
  numericDict?: Set<string>;
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
      ...(parts[0]!.blockId !== undefined ? { blockId: parts[0]!.blockId } : {}),
      ...(parts[0]!.lineId !== undefined ? { lineId: parts[0]!.lineId } : {}),
      sourceWordCount: wordIndexes.length,
      wordIndexes,
    };
  }
  return {
    text,
    pageX: parts.reduce((sum, p) => sum + p.pageX, 0) / parts.length,
    pageY: parts.reduce((sum, p) => sum + p.pageY, 0) / parts.length,
    ...(parts[0]!.blockId !== undefined ? { blockId: parts[0]!.blockId } : {}),
    ...(parts[0]!.lineId !== undefined ? { lineId: parts[0]!.lineId } : {}),
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

export function filterExtractedLabelsByDict(
  labels: ExtractLabelsResult,
  dictCodes: string[],
): ExtractLabelsResult & { dictRejected: number } {
  const canonical = new Map(
    dictCodes.map((code) => [normalizeZoneCodeText(code).toUpperCase(), normalizeZoneCodeText(code)]),
  );
  const codePoints = labels.codePoints.flatMap((point) => {
    const code = canonical.get(normalizeZoneCodeText(point.code).toUpperCase());
    if (!code) return [];
    const { prefix } = splitCode(code);
    return [{ ...point, code, prefix, kind: kindForPrefix(prefix) }];
  });
  const dictRejected = labels.codePoints.length - codePoints.length;
  return {
    ...labels,
    codePoints,
    // Preserve the acquisition T1/T2 post-filter counter contract: these
    // counters describe the labels still eligible for serving, while
    // dictRejected records the non-spatial rejection cause separately.
    nCodeLike: codePoints.length,
    nInsideFrame: codePoints.length,
    rejectedOutsideFrame: labels.rejectedOutsideFrame + dictRejected,
    dictRejected,
  };
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

/**
 * Convert positioned pdftotext words into georeferenced zone-code points.
 *
 * textPageW/textPageH and every RawLabel coordinate must share pdftotext's
 * top-left-origin page units. They are scaled to the GeoRef MediaBox before
 * the bottom-up page-to-ground transform is evaluated.
 */
export function extractLabelsFromWords(
  words: RawLabel[],
  textPageW: number,
  textPageH: number,
  geo: GeoRef,
  opts: LabelComputeOptions = {},
): ExtractLabelsResult {
  const zoneCodeOptions = opts.numericDict !== undefined ? { numericDict: opts.numericDict } : {};
  const candidates = zoneLabelCandidatesFromWords(words, zoneCodeOptions);
  const hasSplitPrefixCompounds = candidates.some(
    (c) => (c.sourceWordCount ?? 1) > 1 && /^[A-Z]{1,4}\d{0,3}(?:-[A-Z])?-\d{2,4}(?:-[A-Z0-9]{1,4})?$/i.test(c.text),
  );
  const sx = textPageW > 0 ? geo.pageW / textPageW : 1;
  const sy = textPageH > 0 ? geo.pageH / textPageH : 1;
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
  for (const w of candidates) {
    if (!looksLikeZoneCode(w.text, zoneCodeOptions)) continue;
    if (isTinyCandidate(w)) continue;
    if (hasSplitPrefixCompounds && (w.sourceWordCount ?? 1) === 1 && isDigitLeadingSingleLetter(w.text)) continue;
    nCodeLike++;
    const px = w.pageX * sx;
    const pyTop = w.pageY * sy;
    const pyUser = geo.pageH - pyTop;
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
