/**
 * grille-pdf-classifier — decide, from a DOWNLOADED PDF's extracted text, whether
 * the document is a real "grille des spécifications / des normes / des usages"
 * (a tabular zones×normes sheet we WANT to ingest), or one of the two recurring
 * impostors the keyword discovery (`classifyGrilleLink`) lets through on title/url
 * alone:
 *
 *   - a PLAN / CARTE de zonage — an image-only scan (a map). Its `pdftotext` layer
 *     is essentially empty; there is no table at all. Routing it as a grille yields
 *     0 zone (correctly) but it should never have been kept as a normes source.
 *   - a RÈGLEMENT / AMENDEMENT — a legal text ("Règlement N° … modifiant le
 *     règlement de zonage", "Avis de motion", "Attendu que", "Article 1") that
 *     mentions zones in PROSE but carries no tabular header of zone codes.
 *
 * WHY A SEPARATE CONTENT GATE. `classifyGrilleLink` scores the LINK (anchor text +
 * url); it cannot see the PDF body, so a link titled "Règlement de zonage" or
 * "Plan de zonage" clears the threshold and the wrong PDF lands as grille.pdf. This
 * module looks at the BODY and is the anti-invention gate: it ACCEPTS only when a
 * positive grille SIGNATURE is present, and otherwise REJECTS with a precise reason
 * (plan-image / reglement / unknown) so the runner drops the candidate instead of
 * depositing a false grille.
 *
 * POSITIVE SIGNATURE of a real grille — ANY of:
 *   (A) a TITLE-anchored table page (`isGrilleTablePage`: the "grille des
 *       spécifications / usages et normes" title + ≥3 grille-row-shaped lines) —
 *       the transposed MRC/avis-public gabarit (portneuf, saint-constant).
 *   (B) a NATIVE horizontal grille page (`isGrillePage`: the Sherbrooke header band)
 *       — zones-as-rows, norms-as-columns.
 *   (C) a ZONE-CODE HEADER page: a line that is a column header of ≥3 distinct zone
 *       codes (H1 H2 H3 …, AG-1 AG-2 …, C1 C2 …) AND a grille context on the page
 *       (a grille/zones/usages/normes word, or a norm row, or a second header line).
 *       This catches the canonical multi-zone sheets whose title is NOT one of the
 *       frozen anchors (compton "Grille des normes relatives à l'implantation…",
 *       saint-claude "Grille des usages et des constructions…").
 *
 * The (C) zone-code header is the discriminator that separates these grilles from a
 * règlement that merely names "la zone H-1, H-2 et H-3" in a sentence: a prose line
 * (commas + sentence terminator, or zone codes a minority of the line's tokens) is
 * NOT a header. Verified on the discovered corpus (11 known non-grilles score 0
 * zone-header pages; saint-claude/compton score many).
 *
 * PURE over an already-extracted per-page text array (`pdftotext -layout` split on
 * the form-feed), so it is unit-testable with no PDF/poppler.
 */
import {
  countGrilleRows,
  hasGrilleTitle,
  isGrilleTablePage,
} from "./grille-page-locator.js";
import { isGrillePage } from "./grille-specifications-parser.js";

// ───────────────────────────────────────────────────────────────────────────
//  Zone-code header detection (signal C).
// ───────────────────────────────────────────────────────────────────────────

/** Fold accents + lowercase so "spécifications" === "specifications". */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * A zone-code TOKEN: 1–3 UPPERCASE letters, an optional single separator, then
 * 1–3 digits, with an optional trailing lowercase letter (H1, H-10, AG-1, RA-2,
 * C306, P104a). Uppercase-led on purpose — a real grille's zone codes are
 * uppercase, and requiring the digits keeps ordinary prose words out. A code
 * WITHOUT digits (rare "Ca"/"Cb" families) is not matched; documented trade-off
 * favouring precision (no false positive over the discovered corpus).
 */
const ZONE_CODE_TOKEN = /^[A-Z]{1,3}-?\d{1,3}[a-z]?$/;

/** Prose sentence / enumeration terminator (a header line never ends a sentence). */
const PROSE_TERMINATOR = /[;.]\s*$/;

/** Grille context words that must accompany a header line on the SAME page. */
const GRILLE_CONTEXT =
  /(grille|\bzones?\b|\busages?\b|\bnormes?\b|specification|implantation|dimension)/;

/**
 * Distinct zone codes found among a line's whitespace-separated tokens.
 * A token counts only if it matches `ZONE_CODE_TOKEN` exactly (after stripping a
 * trailing column separator such as a lone comma the layout may keep).
 */
export function zoneCodesOnLine(line: string): string[] {
  const seen = new Set<string>();
  for (const rawTok of line.trim().split(/\s+/)) {
    const tok = rawTok.replace(/[,;]+$/, "");
    if (ZONE_CODE_TOKEN.test(tok)) seen.add(tok);
  }
  return [...seen];
}

/**
 * An EXPLICIT numeric-zone column header: the label "numéro(s) de zone(s)" (some
 * municipalities number zones 101, 103, 104… with no letter prefix, so the bare
 * digits are indistinguishable from any table) immediately followed by ≥3 numbers.
 * The label anchor keeps this precise (clarenceville "Numéros de zones 101 103 104
 * 105 106"); a bare run of numbers never qualifies.
 */
const NUMERIC_ZONE_HEADER = /num[eé]ros?\s+de\s+zones?\s+(?:\d{1,4}\s+){2,}\d{1,4}/;

/** True iff a line is an explicit "Numéros de zones 101 103 104 …" header. */
export function isNumericZoneHeaderLine(line: string): boolean {
  return NUMERIC_ZONE_HEADER.test(fold(line).replace(/\s+/g, " "));
}

/**
 * True iff a line is a ZONE-CODE COLUMN HEADER: ≥3 distinct zone codes that make
 * up at least half of the line's tokens (so a column band "H1 H2 H3 …" or
 * "Réf. classe d'usages AG-1 … AG-5" qualifies, while a prose sentence
 * "les zones H-1, H-2 et H-3 sont autorisées." — codes a minority + terminator —
 * does not). Anti-prose: a comma-bearing line that terminates like a sentence is
 * rejected outright.
 */
export function isZoneCodeHeaderLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const codes = zoneCodesOnLine(line);
  if (codes.length < 3) return false;
  if (PROSE_TERMINATOR.test(line) && /,/.test(line)) return false;
  // Zone codes must dominate the line (column band), not be sprinkled in prose.
  return codes.length / tokens.length >= 0.5;
}

/**
 * A page is a zone-code-header grille page when it carries a zone-code header line
 * AND a grille context (so an incidental code list on an unrelated page is not
 * mistaken for a grille). Two or more header lines on the page also satisfy the
 * context (a multi-band sheet like compton's H/C blocks).
 */
export function isZoneHeaderGrillePage(pageText: string): boolean {
  const lines = pageText.split("\n");
  let headerLines = 0;
  let numericHeader = false;
  for (const ln of lines) {
    if (isZoneCodeHeaderLine(ln)) headerLines++;
    if (isNumericZoneHeaderLine(ln)) numericHeader = true;
  }
  // An explicit "Numéros de zones …" header already carries its own grille label.
  if (numericHeader) return true;
  if (headerLines === 0) return false;
  if (headerLines >= 2) return true;
  return GRILLE_CONTEXT.test(fold(pageText)) || countGrilleRows(pageText) >= 1;
}

// ───────────────────────────────────────────────────────────────────────────
//  Signal D — a BROAD grille title gated by tabular structure.
//
//  The frozen `hasGrilleTitle` anchors require "grille DES …"; real grilles also
//  spell it "grille DE spécifications" (saint-paul's per-page running header) and
//  "grille des usages et des constructions" (saint-claude). A broad title alone is
//  NOT enough — a règlement amendment prose-mentions "ajouter dans la grille des
//  spécifications H-14" (bois-des-filion) — so signal D requires the broad title
//  AND a tabular structure on the SAME page: a zone-code header, a one-zone-per-
//  page "Zone X" banner, or ≥3 grille-row-shaped lines. This is what rescues the
//  one-zone-per-page vertical grilles whose title omits "des" and whose norms use
//  grouped sub-labels (Marge → Avant/Latérale/Arrière) the row counter under-reads.
// ───────────────────────────────────────────────────────────────────────────

/** Broad grille title: "grille(s) de|des (spécifications|normes|usages)". */
const TITLE_BROAD: ReadonlyArray<RegExp> = [
  /grilles?\s+des?\s+specifications?/,
  /grilles?\s+des?\s+normes?/,
  /grilles?\s+des?\s+usages?/,
];

/**
 * A one-zone-per-page page banner — a line that STARTS with the zone label of a
 * single-zone grille ("Zone A1", "Zone: R-1 102", "No zone H0001"). Optional
 * colon so the space-separated "Zone A1" gabarit (saint-paul) is caught too.
 */
const ZONE_BANNER = /^\s*(?:no\s+)?zone\s*[:°]?\s*[a-z]{1,3}-?\s?\d/i;

/** Does this page carry the broad grille title? */
export function hasGrilleTitleBroad(pageText: string): boolean {
  const collapsed = fold(pageText).replace(/\s+/g, " ");
  return TITLE_BROAD.some((re) => re.test(collapsed));
}

/** Does any line start with a one-zone-per-page "Zone X" banner? */
function hasZoneBanner(pageText: string): boolean {
  return pageText.split("\n").some((ln) => ZONE_BANNER.test(ln));
}

/**
 * Signal D: a broad-title grille page with a confirming tabular structure. The
 * structure gate (zone-code header / zone banner / ≥3 grille rows) keeps a
 * prose-only "…dans la grille des spécifications…" amendment line out.
 */
export function isTitleGatedGrillePage(pageText: string): boolean {
  if (!hasGrilleTitleBroad(pageText)) return false;
  if (pageText.split("\n").some((ln) => isZoneCodeHeaderLine(ln))) return true;
  if (hasZoneBanner(pageText)) return true;
  return countGrilleRows(pageText) >= 3;
}

// ───────────────────────────────────────────────────────────────────────────
//  Legal-amendment markers (the règlement/amendement impostor).
// ───────────────────────────────────────────────────────────────────────────

const AMENDMENT_MARKERS: ReadonlyArray<RegExp> = [
  /(?:modifiant|amendant|amender|amendement)\s+(?:le\s+)?reglement/,
  /\bavis\s+de\s+motion\b/,
  /\battendu\s+que\b/,
  /\bconsiderant\s+que\b/,
  /il\s+est\s+resolu/,
  /projet\s+de\s+reglement/,
  /entree\s+en\s+vigueur/,
  /certificat\s+de\s+conformite/,
  /assemblee\s+publique\s+de\s+consultation/,
  /seance\s+(?:ordinaire|extraordinaire|du\s+conseil)/,
];

/** Count pages that carry ≥1 legal-amendment marker. */
function countAmendmentPages(pages: ReadonlyArray<string>): number {
  let n = 0;
  for (const p of pages) {
    const folded = fold(p).replace(/\s+/g, " ");
    if (AMENDMENT_MARKERS.some((re) => re.test(folded))) n++;
  }
  return n;
}

// ───────────────────────────────────────────────────────────────────────────
//  PDF-level classification.
// ───────────────────────────────────────────────────────────────────────────

export type GrillePdfKind = "grille" | "plan-image" | "reglement" | "unknown";

export interface GrillePdfSignals {
  /** Number of PDF pages. */
  readonly pageCount: number;
  /** Total characters in the extracted text layer. */
  readonly textChars: number;
  /** textChars / pageCount (an image-only scan is ~0). */
  readonly avgCharsPerPage: number;
  /** Pages matched by signal A (title-anchored table). */
  readonly titleTablePages: number;
  /** Pages matched by signal B (native horizontal grille header band). */
  readonly nativeGrillePages: number;
  /** Pages matched by signal C (zone-code column header + context). */
  readonly zoneHeaderPages: number;
  /** Union page count over A∪B∪C — the strength of the grille evidence. */
  readonly grillePages: number;
  /** 1-based first grille page (any signal), or 0 when none. */
  readonly firstGrillePage: number;
  /** 1-based last grille page (any signal), or 0 when none. */
  readonly lastGrillePage: number;
  /** 1-based first zone-code-header page (signal C), or 0 when none. */
  readonly firstZoneHeaderPage: number;
  /** 1-based last zone-code-header page (signal C), or 0 when none. */
  readonly lastZoneHeaderPage: number;
  /** Pages carrying a legal-amendment marker. */
  readonly amendmentPages: number;
}

export interface GrillePdfClass {
  readonly kind: GrillePdfKind;
  readonly reason: string;
  readonly signals: GrillePdfSignals;
}

/**
 * Below this average text density a multi-page PDF is treated as an image-only
 * scan (a plan/carte) when it shows NO grille signal. A real grille page carries
 * hundreds of characters; a scanned map's text layer is a handful per page.
 */
export const IMAGE_ONLY_AVG_CHARS = 60;

/**
 * Classify a downloaded grille candidate from its per-page texts.
 *
 * Decision order (anti-invention — a positive grille signature wins; absent one,
 * we never KEEP, we explain why we reject):
 *   1. grillePages ≥ 1                     → "grille"      (KEEP)
 *   2. avgCharsPerPage < IMAGE_ONLY_AVG    → "plan-image"  (reject: map/scan)
 *   3. amendmentPages ≥ 1                  → "reglement"   (reject: legal text)
 *   4. otherwise                           → "unknown"     (reject: no table found)
 */
export function classifyGrillePdf(pages: ReadonlyArray<string>): GrillePdfClass {
  const pageCount = pages.length;
  let textChars = 0;
  let titleTablePages = 0;
  let nativeGrillePages = 0;
  let zoneHeaderPages = 0;
  let grillePages = 0;
  let firstGrillePage = 0;
  let lastGrillePage = 0;
  let firstZoneHeaderPage = 0;
  let lastZoneHeaderPage = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] ?? "";
    textChars += page.length;
    const isTitleTable = isGrilleTablePage(page);
    const isNative = isGrillePage(page).isGrille;
    const isZoneHeader = isZoneHeaderGrillePage(page);
    const isTitleGated = isTitleGatedGrillePage(page);
    if (isTitleTable) titleTablePages++;
    if (isNative) nativeGrillePages++;
    if (isZoneHeader) {
      zoneHeaderPages++;
      if (firstZoneHeaderPage === 0) firstZoneHeaderPage = i + 1;
      lastZoneHeaderPage = i + 1;
    }
    if (isTitleTable || isNative || isZoneHeader || isTitleGated) {
      grillePages++; // union (a page counts once even if multiple signals fire)
      if (firstGrillePage === 0) firstGrillePage = i + 1;
      lastGrillePage = i + 1;
    }
  }

  const amendmentPages = countAmendmentPages(pages);
  const avgCharsPerPage = pageCount > 0 ? textChars / pageCount : 0;

  const signals: GrillePdfSignals = {
    pageCount,
    textChars,
    avgCharsPerPage: Number(avgCharsPerPage.toFixed(1)),
    titleTablePages,
    nativeGrillePages,
    zoneHeaderPages,
    grillePages,
    firstGrillePage,
    lastGrillePage,
    firstZoneHeaderPage,
    lastZoneHeaderPage,
    amendmentPages,
  };

  if (grillePages >= 1) {
    return {
      kind: "grille",
      reason: `grille: ${grillePages} grille page(s) (title=${titleTablePages} native=${nativeGrillePages} zoneHeader=${zoneHeaderPages}, span ${firstGrillePage}..${lastGrillePage})`,
      signals,
    };
  }
  if (avgCharsPerPage < IMAGE_ONLY_AVG_CHARS) {
    return {
      kind: "plan-image",
      reason: `plan/carte: image-only scan (avg ${signals.avgCharsPerPage} chars/page over ${pageCount} pages, no grille table)`,
      signals,
    };
  }
  if (amendmentPages >= 1) {
    return {
      kind: "reglement",
      reason: `règlement/amendement: ${amendmentPages} page(s) with legal markers, no zone-code header`,
      signals,
    };
  }
  return {
    kind: "unknown",
    reason: `unknown: text present (avg ${signals.avgCharsPerPage} chars/page) but no grille table, no amendment markers`,
    signals,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Discovery gate — turn a classification into a keep/reject + ranking priority.
// ───────────────────────────────────────────────────────────────────────────

export interface GrilleGateDecision {
  /** Keep this candidate in the manifest (true) or drop it (false)? */
  readonly keep: boolean;
  /**
   * Ranking priority among KEPT candidates of one municipality (higher wins):
   *   3 — a real grille the route logic could BOUND (directly extractable);
   *   2 — a doc with a bounded route but no positive grille signature (rare);
   *   1 — a real grille whose route stayed "auto" (rescue/whole-pdf vision);
   *   0 — an "unknown" doc kept only as a last-resort fallback.
   */
  readonly priority: number;
  /** Human-readable reason (logged for traceability). */
  readonly reason: string;
}

/**
 * Decide whether a confirmed PDF candidate should be KEPT as a grille and how to
 * rank it against the muni's other candidates. ANTI-INVENTION: the two named
 * impostor classes are hard-rejected so they can never land as grille.pdf —
 *   - "plan-image"  → a plan/carte de zonage (a ZONES source, not a normes one);
 *   - "reglement"   → a règlement/amendement (legal text, no grille table).
 * A "grille" is always kept; an "unknown" is kept only as a low-priority fallback
 * (it may be a tricky-layout grille — letter/numeric-only zone codes — that vision
 * can still read; the batch's budget gate bounds the cost). `routeBounded` is true
 * when the route probe produced a concrete native/multizone/vision range.
 */
export function gateGrilleCandidate(
  cls: GrillePdfClass,
  routeBounded: boolean,
): GrilleGateDecision {
  if (cls.kind === "plan-image" || cls.kind === "reglement") {
    return { keep: false, priority: 0, reason: `reject ${cls.reason}` };
  }
  const priority = (routeBounded ? 2 : 0) + (cls.kind === "grille" ? 1 : 0);
  return { keep: true, priority, reason: `keep ${cls.reason}` };
}
