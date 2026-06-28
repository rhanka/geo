/**
 * grille-page-locator — locate the PAGE RANGE that carries the "grille des
 * usages et des normes" (a.k.a. "grille des spécifications") inside an arbitrary
 * Québec zoning PDF, so the per-muni runner can BOUND its (cost-tracked) vision
 * pass to those pages instead of scanning from page 1.
 *
 * WHY THIS EXISTS. The discovered grille PDFs are heterogeneous: a tiny avis-
 * public with ONE grille on the last page (saint-constant p8), a 55-page annex
 * where EVERY page is a one-zone grille (boisbriand), a 360/594-page consolidated
 * bylaw whose body merely MENTIONS the grille in prose dozens of times but carries
 * no table at all (mascouche, la-prairie), and image-only scans whose grille text
 * is invisible to `pdftotext` (hemmingford). A naive "page 1..N" vision scan wastes
 * budget on the first; a naive keyword match fires on the prose mentions of the
 * last. This locator separates a REAL grille TABLE page from a prose reference.
 *
 * ANTI-INVENTION IS ABSOLUTE. A page is a grille page ONLY when it carries BOTH a
 * grille TITLE anchor AND a minimum number of grille-ROW-shaped lines (a norm word
 * + a min/max qualifier + a numeric/unit cell, EXCLUDING prose enumerations). We
 * never GUESS a range: if zero grille pages are detected (e.g. an image-only scan
 * whose text layer is empty, or a bylaw that does not embed the table), we return
 * `null`. `null` always beats a fabricated page range.
 *
 * The locator is PURE over an already-extracted per-page text array (so it is unit-
 * testable with no PDF/poppler), with a thin `locateGrillePagesInPdf` wrapper that
 * shells out to `pdftotext -layout` and splits on the form-feed (`\f`) page break.
 */
import { spawnSync } from "node:child_process";

// ───────────────────────────────────────────────────────────────────────────
//  Signal model — title anchors + grille-row shape (anti-prose).
// ───────────────────────────────────────────────────────────────────────────

/** Fold accents + lowercase so "spécifications" === "specifications". */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Grille TITLE anchors. Two real-world spellings (both observed in the
 * discovered corpus):
 *   - "grille des spécifications"            (transposed/MRC + avis-public grilles)
 *   - "grille(s) des usages et (des) normes" (the canonical refondu grille)
 * Matched on a whitespace-COLLAPSED, accent-FOLDED projection so the OCR variant
 * "GRI LLES DES USAGES ET DES NORM ES" (intra-word spaces) still hits.
 */
const TITLE_ANCHORS: ReadonlyArray<RegExp> = [
  // "grille(s) de(s) spécification(s)" — `des?` + `s?` so the codified-bylaw
  // running header "ANNEXE J GRILLES DE SPÉCIFICATION" (de, singular — la-durantaye,
  // saint-neree) is located, not just the canonical "grille des spécifications".
  /grilles?\s*des?\s*specifications?/,
  /grilles?\s*des\s*usages\s*et\s*(?:des\s*)?normes/,
];

/** Whitespace-stripped fallbacks (catch OCR'd intra-word spaces fully). */
const TITLE_ANCHORS_NOSPACE: ReadonlyArray<RegExp> = [
  /grilles?des?specifications?/,
  /grilles?desusageset(?:des)?normes/,
];

/** A grille NORM dimension word (the row's left-hand label). */
const NORM_WORD =
  /(marge|hauteur|largeur|superficie|profondeur|frontage|implantation|rapport|occupation|densit|coefficient|emprise|dominance)/;

/** A min/max/unit qualifier — present on a grille row, rare on a prose line. */
const ROW_QUALIFIER =
  /(\bmin\.?\b|\bmax\.?\b|minimale|maximale|\(m\)|\(m2\)|\(m²\)|\(%\)|etage|étage)/;

/** A measured CELL on the row: a number or a bare unit token. */
const ROW_CELL = /([0-9]|\(m\)|\(m2\)|\(m²\)|\(%\))/;

/** Prose sentence / enumeration terminator (a grille cell never ends a sentence). */
const PROSE_TERMINATOR = /[;.]\s*$/;

/** Enumeration prefix ("a)", "1°", "3.", bullet) — legend prose, not a grille row. */
const ENUM_PREFIX = /^\s*(?:[a-z]\)|\d+[°.)]|[•–-])\s/i;

/**
 * "ZONE: X 101" page BANNER — the per-page header of a ONE-ZONE-PER-PAGE vertical
 * grille (boisbriand gabarit), where a LINE is essentially just the zone label.
 * Its presence on most grille pages routes the doc to the SINGLE-zone vision
 * extractor; its absence (the transposed grille names its family with "Numéro de
 * zone:" and lists many zone codes as columns) routes to the MULTI-zone extractor.
 *
 * Anchored at the START of a trimmed line and EXCLUDING "numéro de zone" (the
 * transposed-grille family header), so a "Numéro de zone: MS-324" line on a
 * multi-zone page is NOT mistaken for a one-zone banner.
 */
const ONE_ZONE_BANNER = /^\s*zone\s*[:°]\s*[a-z]{1,3}\s?-?\s?\d/i;

/**
 * The DIGIT-FIRST one-zone-per-page banner of the codified-bylaw gabarit
 * ("ANNEXE J GRILLES DE SPÉCIFICATION … ZONE 1- HA" — la-durantaye, saint-neree):
 * the page's own zone is named at the END of the running-header line as
 * "<digits>-<letters>", which the letter-first `ONE_ZONE_BANNER` cannot see.
 * Anchored to the SAME line as the grille-spécification title and requiring the
 * digit-dash-LETTERS shape, so it can only match this one-zone title (not a
 * multi-zone column band, where the codes are a separate header row, nor prose).
 * Applied to the accent-folded line, so "ZONE 1- HA" → "zone 1- ha".
 */
const TITLE_ONE_ZONE_BANNER =
  /grilles?\s+des?\s+specifications?\b.*\bzone\s+\d{1,3}\s*-\s*[a-z]/;

/** How many grille-row-shaped lines a page must carry to count as a grille TABLE. */
export const MIN_GRILLE_ROWS = 3;

/** Does this page carry a grille title anchor? (OCR-/accent-tolerant.) */
export function hasGrilleTitle(pageText: string): boolean {
  const folded = fold(pageText);
  const collapsed = folded.replace(/\s+/g, " ");
  if (TITLE_ANCHORS.some((re) => re.test(collapsed))) return true;
  const noSpace = folded.replace(/\s+/g, "");
  return TITLE_ANCHORS_NOSPACE.some((re) => re.test(noSpace));
}

/**
 * Count grille-ROW-shaped lines on a page: a norm word + a min/max/unit qualifier
 * + a numeric/unit cell. Prose enumerations that mimic the shape (the bylaw's
 * "Comment lire la grille" legend — "a) La marge avant minimale;") are EXCLUDED:
 * a line that starts with an enumeration prefix AND ends like a sentence, or that
 * ends like a sentence and contains a prose comma, is not a table row. This is the
 * single discriminator that separates a real table from the dozens of prose
 * references in a 594-page consolidated bylaw (verified on the discovered corpus).
 */
export function countGrilleRows(pageText: string): number {
  let rows = 0;
  for (const raw of pageText.split("\n")) {
    const ln = fold(raw);
    if (!NORM_WORD.test(ln) || !ROW_QUALIFIER.test(ln) || !ROW_CELL.test(ln)) {
      continue;
    }
    // Legend prose: an enumerated item that reads like a sentence.
    if (ENUM_PREFIX.test(raw) && PROSE_TERMINATOR.test(raw)) continue;
    // A comma-bearing sentence that terminates in ; or . is descriptive prose.
    if (PROSE_TERMINATOR.test(raw) && /,/.test(raw)) continue;
    rows++;
  }
  return rows;
}

/** True iff a page is a real grille TABLE page (title anchor + enough rows). */
export function isGrilleTablePage(pageText: string): boolean {
  return hasGrilleTitle(pageText) && countGrilleRows(pageText) >= MIN_GRILLE_ROWS;
}

// ───────────────────────────────────────────────────────────────────────────
//  Range location — contiguous-ish span of grille pages.
// ───────────────────────────────────────────────────────────────────────────

export interface GrilleLocation {
  /** 1-based first page that is a grille table page. */
  firstPage: number;
  /** 1-based last page that is a grille table page. */
  lastPage: number;
  /** How many pages within [firstPage,lastPage] are grille pages. */
  grillePageCount: number;
  /** Heuristic layout signal for routing (NOT a guess of values):
   *  - "one-zone-per-page": each grille page carries a single "ZONE: X" banner
   *    (boisbriand) → single-zone vision.
   *  - "multi-zone-per-page": several zone codes side-by-side on a page
   *    (saint-constant transposed grille) → multi-zone vision. */
  layout: "one-zone-per-page" | "multi-zone-per-page";
  /** grillePageCount / span — 1.0 when every page in the span is a grille page. */
  confidence: number;
}

/**
 * Locate the grille page RANGE from an ALREADY-EXTRACTED per-page text array
 * (pages[i] is the `pdftotext -layout` text of 1-based page i+1). Returns the
 * first/last grille page, the count inside that span, a layout hint for routing,
 * and a density confidence. Returns `null` when NO grille page is detected — we
 * never invent a range (anti-invention).
 */
export function locateGrillePages(pages: ReadonlyArray<string>): GrilleLocation | null {
  const grilleIdx: number[] = [];
  let oneZoneBannerPages = 0;
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i] ?? "";
    if (!isGrilleTablePage(text)) continue;
    grilleIdx.push(i + 1); // 1-based
    const hasBanner = text
      .split("\n")
      .some((ln) => {
        const f = fold(ln);
        return ONE_ZONE_BANNER.test(f) || TITLE_ONE_ZONE_BANNER.test(f);
      });
    if (hasBanner) oneZoneBannerPages++;
  }
  if (grilleIdx.length === 0) return null;

  const firstPage = grilleIdx[0]!;
  const lastPage = grilleIdx[grilleIdx.length - 1]!;
  const span = lastPage - firstPage + 1;
  const grillePageCount = grilleIdx.length;
  // A clear MAJORITY of grille pages showing a single "ZONE: X" banner → the
  // one-zone-per-page gabarit (boisbriand). Otherwise treat it as multi-zone.
  const layout =
    oneZoneBannerPages >= Math.ceil(grillePageCount / 2)
      ? "one-zone-per-page"
      : "multi-zone-per-page";

  return {
    firstPage,
    lastPage,
    grillePageCount,
    layout,
    confidence: Number((grillePageCount / span).toFixed(3)),
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Thin PDF wrapper (poppler) — split per-page on the form-feed.
// ───────────────────────────────────────────────────────────────────────────

/** Run `pdftotext -layout` and return the page texts split on the form-feed. */
export function pdfToPageTexts(pdfPath: string): string[] {
  const r = spawnSync(
    "pdftotext",
    ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    throw new Error(`pdftotext failed (${r.status}): ${(r.stderr ?? "").slice(0, 200)}`);
  }
  // poppler ends EACH page (including the last) with a form-feed; trailing split
  // yields an empty element we drop, while keeping interior empty pages (image-
  // only scans) so the 1-based page index stays aligned with the PDF.
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Locate the grille page range directly from a PDF path (poppler-backed). */
export function locateGrillePagesInPdf(pdfPath: string): GrilleLocation | null {
  return locateGrillePages(pdfToPageTexts(pdfPath));
}
