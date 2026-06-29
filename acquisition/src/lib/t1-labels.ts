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
 *   DIGITS - LETTERS                        → 605-Cb, 314-P (val-dor/saint-tite)
 * Requires both a letter and a digit (the anti-#74 rule: a pure sequential
 * integer is NOT a regulatory zone code).
 */
export const ZONE_CODE_RE =
  /^(?:[A-Z]{1,4}\d{0,3}[-.]?\d{0,4}[A-Za-z]?|\d{1,4}-[A-Za-z]{1,5})$/i;

export function looksLikeZoneCode(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 12) return false;
  if (STOPWORDS.has(t.toLowerCase())) return false;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false; // anti-#74
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
  const m = code.match(/^([A-Za-z]+)/);
  return { prefix: m ? m[1]!.toUpperCase() : "" };
}

export interface RawLabel {
  text: string;
  pageX: number; // pdftotext top-left origin, page units
  pageY: number;
}

/** Run pdftotext -bbox-layout and return all words with their center. */
export function pdftotextWords(pdfPath: string): { words: RawLabel[]; pageW: number; pageH: number } {
  let xml: string;
  try {
    xml = execSync(`pdftotext -bbox-layout ${JSON.stringify(pdfPath)} - 2>/dev/null`, {
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
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(xml)) !== null) {
    const text = (m[5] ?? "").trim();
    if (!text) continue;
    words.push({
      text,
      pageX: (parseFloat(m[1]!) + parseFloat(m[3]!)) / 2,
      pageY: (parseFloat(m[2]!) + parseFloat(m[4]!)) / 2,
    });
  }
  return { words, pageW, pageH };
}

export interface ExtractLabelsResult {
  codePoints: CodePoint[];
  nWords: number;
  nCodeLike: number;
  nInsideFrame: number;
  rejectedOutsideFrame: number;
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
export function extractLabels(pdfPath: string, geo: GeoRef): ExtractLabelsResult {
  const { words, pageW, pageH } = pdftotextWords(pdfPath);
  // pdftotext page units vs PDF user-space (MediaBox) — usually 1:1.
  const sx = pageW > 0 ? geo.pageW / pageW : 1;
  const sy = pageH > 0 ? geo.pageH / pageH : 1;
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
  for (const w of words) {
    if (!looksLikeZoneCode(w.text)) continue;
    nCodeLike++;
    const px = w.pageX * sx; // PDF user-space x
    const pyUser = geo.pageH - w.pageY * sy; // bottom-up y
    if (
      px < bx0 - padX ||
      px > bx1 + padX ||
      pyUser < by0 - padY ||
      pyUser > by1 + padY
    ) {
      rejectedOutside++;
      continue;
    }
    nInside++;
    const [lon, lat] = geo.pageToLonLat(px, pyUser);
    const { prefix } = splitCode(w.text);
    codePoints.push({ code: w.text, prefix, kind: kindForPrefix(prefix), lon, lat });
  }
  return {
    codePoints,
    nWords: words.length,
    nCodeLike,
    nInsideFrame: nInside,
    rejectedOutsideFrame: rejectedOutside,
  };
}
