/**
 * grille-zoneheader-locator — BORNAGE (page-range detection) + VERBATIM header-code
 * reader for the ONE-ZONE-PER-PAGE "grille des spécifications" gabarit, where EVERY
 * page documents a SINGLE zone named in a per-page header and the norm matrix runs
 * down the page (several use-case value columns per zone).
 *
 * WHY THIS EXISTS (voie B). The committed native ZONE-header path
 * (`parseNumberedGrilleNativePage`) only fires on the Nicolet family — a page that
 * carries BOTH a "ZONE: <code>" header AND a "NORMES PRESCRITES" band. The bulk of
 * the residual `zones-done / normes-non-done` queue publishes the SAME one-zone-per-
 * page shape under DIFFERENT headers that the Nicolet gate misses:
 *   - lachute:    "GRILLE DES SPÉCIFICATIONS   ZONE: Ha-102" (code after "ZONE:",
 *                 on the SAME layout line as the title; NO "NORMES PRESCRITES" band)
 *   - blainville: an ISOLATED corner code "M-1" as the first non-blank line, with a
 *                 numbered "B- Normes prescrites" matrix below — NO "ZONE" word.
 * Those are routed to the OCR path, whose native-first skips them (no NORMES
 * PRESCRITES) and whose ONE bounded OCR call over a 200–600-page bylaw both blows the
 * page cap and 400s / misreads. This module gives the runner (a) a BORNAGE that finds
 * the contiguous window of one-zone-per-page grille pages via the recurring per-page
 * header + norm-row signature, and (b) the reliable native-text header code per page
 * (the anchor the per-page VISION extractor pins as `expectedZone`).
 *
 * PURE + unit-testable (no PDF/poppler/network): every function operates on already-
 * extracted per-page `pdftotext -layout` text. It reuses `countGrilleRows` from the
 * existing locator as the anti-prose table discriminator.
 *
 * ANTI-INVENTION. A header code is read VERBATIM or not at all; a page counts as a
 * one-zone grille page ONLY with a real header code AND enough grille-row-shaped
 * lines; and a window is declared ONLY with ≥ MIN_ZH_PAGES such pages — otherwise
 * `null`. `null` always beats a fabricated code or a guessed range.
 */
import { countGrilleRows } from "./grille-page-locator.js";

// ───────────────────────────────────────────────────────────────────────────
//  VERBATIM per-page header-code reader.
// ───────────────────────────────────────────────────────────────────────────

/** How many top lines the reader scans for an explicit "ZONE …" header. */
const HEADER_SCAN_LINES = 40;

/**
 * A grille zone CODE token: 0–4 letters + 0–4 digits, a dash, then 1–4 alnum, with an
 * optional second dash-group + trailing suffix letter. Covers letter-first ("Ha-102",
 * "M-1", "ID-1", "AD-54") AND digit-first ("1-HA", "122-AF-1") shapes. Anchored where
 * used so a bare number never matches alone.
 */
const CODE_BODY = "[A-Za-zÉÈ]{0,4}\\d{0,4}[ \\t]*[-–—][ \\t]*[A-Za-z0-9]{1,4}(?:[ \\t]*[-–—][ \\t]*\\d{1,3})?[A-Za-z]?";
/** "ZONE : <code>" — COLON present, code on the SAME line (lachute "ZONE: Ha-102"). The
 *  colon is a strong header signal, so the code may sit anywhere after it. */
const ZONE_COLON_INLINE = new RegExp(`\\bZONE\\b\\s*[:°]\\s*(${CODE_BODY})`, "i");
/** "ZONE : 101" numeric-only page headers. Keep the bare number verbatim; any
 * SIG prefix/suffix reconciliation must come from the numeric bridge, never here. */
const ZONE_COLON_NUMERIC_INLINE = /\bZONE\b\s*[:°]\s*(\d{1,4})(?=$|[^0-9])/i;
/** "ZONE <code>" — NO colon, code at END of line (la-durantaye "… ZONE 1- HA", saint-
 *  augustin "ZONE ID-1"). Anchoring to the line END is what keeps a PROSE "…de la zone
 *  H-3 demeure inchangée" (code followed by more words) from matching. */
const ZONE_NOCOLON_EOL = new RegExp(`\\bZONE\\b\\s+(${CODE_BODY})\\s*$`, "i");
/** A bare "ZONE :" at the END of a line — the code sits on the FOLLOWING non-blank line
 *  (durham-sud "Dispositions applicables à la zone :\n\n H-11"). */
const ZONE_COLON_EOL = /\bZONE\b\s*[:°]\s*$/i;
/** A leading code at the START of a trimmed token (used for the next-line lookahead). */
const CODE_AT_START = new RegExp(`^(${CODE_BODY})`);
/** A whole-line code token (used for "Numéro de zone" one-zone pages). */
const CODE_WHOLE_LINE = new RegExp(`^(${CODE_BODY})$`, "i");
/** A code token embedded in a header line, bounded away from letters/digits. */
const CODE_IN_TEXT = new RegExp(`(^|[^A-Za-z0-9])(${CODE_BODY})(?=$|[^A-Za-z0-9])`, "gi");
/**
 * Gabarit B — an ISOLATED corner code as the FIRST non-blank line (the whole trimmed
 * line is just the token), with NO "ZONE" word: "                M-1" → "M-1". The
 * whole-line anchor is what keeps a body token (a usage row "H-1  x") from matching.
 */
const ISOLATED_CODE_LINE = /^([A-Za-z]{1,3}[ \t]*[-–—][ \t]*\d{1,3}(?:[ \t]*[-–—]?\d{1,2})?[A-Za-z]?)$/;
/** The TRANSPOSED-grille family header ("Numéro de zone: MS-324") — NOT a one-zone
 *  banner (it names a zone FAMILY whose members are columns). Excluded from gabarit A. */
const NUMERO_DE_ZONE = /num[ée]ro\s+de\s+zone/i;
const NUMERO_DE_ZONE_CAPTURE = /num[ée]ro\s+de\s+zone\b(.*)$/i;

/**
 * Normalise a captured code: long dashes → "-", drop inner spaces, uppercase.
 *
 * ⚠️ SERIF "I" vs "1". Some grilles print a serif capital "I" prefix (e.g. "I01-132")
 * that OCR — but NOT the native text layer — misreads as the digit "1". Reading from
 * the NATIVE text layer sidesteps that; we NEVER rewrite an "I"↔"1" (that is invention).
 */
export function normalizeHeaderCode(raw: string): string {
  return raw
    .replace(/[–—]/g, "-")
    .replace(/[ \t]*-[ \t]*/g, "-")
    .replace(/[ \t]+/g, "")
    .toUpperCase()
    .trim();
}

/**
 * Read the VERBATIM zone code of a one-zone-per-page grille from its native-text
 * header. Strategy, in order:
 *   A1. an explicit "ZONE :" (colon) whose code sits on the SAME line OR on the next
 *       non-blank line (durham-sud "…à la zone :\n H-11"; lachute "ZONE: Ha-102").
 *   A2. an explicit "ZONE <code>" with NO colon on a header line (la-durantaye
 *       "ZONE 1- HA"; saint-augustin "ZONE ID-1").
 *   B.  an ISOLATED corner code as the first non-blank line (blainville "M-1").
 * Returns the normalised code or `null` when none yields an unambiguous code
 * (anti-invention: no header, no code). The "Numéro de zone:" transposed-family
 * banner is excluded (it is multi-zone, not one-zone-per-page).
 */
export function readZoneHeaderCode(pageText: string): string | null {
  const lines = pageText.split(/\r?\n/);
  const scan = Math.min(lines.length, HEADER_SCAN_LINES);

  // A1 / A2 — an explicit "ZONE" header (colon-inline, no-colon-at-EOL, colon-next-line).
  for (let i = 0; i < scan; i++) {
    const line = lines[i]!;
    if (NUMERO_DE_ZONE.test(line)) continue; // transposed family → not one-zone
    // A2a — "ZONE : <code>" on one line (colon is a strong header signal).
    const colonInline = line.match(ZONE_COLON_INLINE);
    if (colonInline?.[1]) return normalizeHeaderCode(colonInline[1]);
    const colonNumeric = line.match(ZONE_COLON_NUMERIC_INLINE);
    if (colonNumeric?.[1]) return colonNumeric[1];
    // A2b — "ZONE <code>" (no colon) at the END of the line (never mid-prose).
    const eol = line.match(ZONE_NOCOLON_EOL);
    if (eol?.[1]) return normalizeHeaderCode(eol[1]);
    // A1 — a bare "ZONE :" at line end; the code is on the next non-blank line.
    if (ZONE_COLON_EOL.test(line)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        const t = lines[j]!.trim();
        if (!t) continue;
        const m = t.match(CODE_AT_START);
        if (m?.[1]) return normalizeHeaderCode(m[1]);
        break; // first non-blank line after the colon decides (else fall through)
      }
    }
  }

  // B — the first NON-BLANK line is JUST an isolated code token.
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const b = t.match(ISOLATED_CODE_LINE);
    return b?.[1] ? normalizeHeaderCode(b[1]) : null; // first non-blank line only
  }
  return null;
}

/**
 * Read the VERBATIM code from a standalone "Numéro de zone" banner whose code is
 * on the following line or, less commonly, as the only token after the banner.
 *
 * This is narrower than `readZoneHeaderCode` on purpose: the known transposed
 * family uses "Numéro de zone: MS-324" on one line to name a column-family, not a
 * one-zone page. A colon form is therefore rejected here too; callers still need
 * to prove the page maps real label:value norm rows before depositing anything.
 */
export function readNumeroZoneHeaderCode(pageText: string): string | null {
  const lines = pageText.split(/\r?\n/);
  const scan = Math.min(lines.length, HEADER_SCAN_LINES);
  const accept = (raw: string): string | null => {
    const t = raw.trim();
    const whole = t.match(CODE_WHOLE_LINE)?.[1];
    const embedded = whole ? [whole] : [...t.matchAll(CODE_IN_TEXT)].map((m) => m[2]).filter(Boolean);
    if (embedded.length !== 1 || !embedded[0]) return null;
    const code = normalizeHeaderCode(embedded[0]);
    if (!/[A-ZÉÈ]/i.test(code) || !/\d/.test(code)) return null;
    return code;
  };

  for (let i = 0; i < scan; i++) {
    const line = lines[i]!;
    const banner = line.match(NUMERO_DE_ZONE_CAPTURE);
    if (!banner) continue;
    const tail = banner[1]?.trim() ?? "";
    if (/^[:°]/.test(tail)) return null;
    if (tail) return accept(tail);
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const t = lines[j]!.trim();
      if (!t) continue;
      return accept(t);
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
//  Page classification + BORNAGE (contiguous one-zone-per-page window).
// ───────────────────────────────────────────────────────────────────────────

/** Min grille-row-shaped lines a one-zone page must carry (anti false-positive). */
export const MIN_ZH_GRILLE_ROWS = 2;
/** Min one-zone grille pages to declare a window (a lone page is not this layout). */
export const MIN_ZH_PAGES = 3;

/** True iff a page is a one-zone-per-page grille page: a header code + norm rows. */
export function isZoneHeaderGrillePage(pageText: string): boolean {
  return readZoneHeaderCode(pageText) !== null && countGrilleRows(pageText) >= MIN_ZH_GRILLE_ROWS;
}

export interface ZoneHeaderGrilleWindow {
  /** 1-based first one-zone grille page. */
  firstPage: number;
  /** 1-based last one-zone grille page. */
  lastPage: number;
  /** 1-based page numbers that are one-zone grille pages (header code + rows). */
  pages: number[];
  /** Verbatim header code for each `pages[i]` (never null — page qualified on it). */
  zoneCodes: string[];
  /** Distinct header codes seen (the anti-invention deposit floor cross-checks this). */
  uniqueZoneCodes: number;
  /** pages.length / span ∈ (0,1] — 1.0 when every page in the span qualifies. */
  confidence: number;
}

/**
 * BORNAGE — locate the contiguous window of one-zone-per-page grille pages from an
 * ALREADY-EXTRACTED per-page text array (pages[i] = layout text of 1-based page i+1).
 * Returns the first/last qualifying page, the qualifying page list + their verbatim
 * header codes, the distinct-code count, and a density confidence — or `null` when
 * fewer than MIN_ZH_PAGES pages qualify (anti-invention: no run, no window).
 *
 * This bounds the (per-page vision) pass to exactly the grille annex, overriding the
 * ~80-page cap that silently slices a DEEP annex off a 200–600-page bylaw.
 */
export function locateZoneHeaderGrille(
  pages: ReadonlyArray<string>,
): ZoneHeaderGrilleWindow | null {
  const hitPages: number[] = [];
  const hitCodes: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i] ?? "";
    const code = readZoneHeaderCode(text);
    if (code !== null && countGrilleRows(text) >= MIN_ZH_GRILLE_ROWS) {
      hitPages.push(i + 1);
      hitCodes.push(code);
    }
  }
  if (hitPages.length < MIN_ZH_PAGES) return null;
  const firstPage = hitPages[0]!;
  const lastPage = hitPages[hitPages.length - 1]!;
  const span = lastPage - firstPage + 1;
  return {
    firstPage,
    lastPage,
    pages: hitPages,
    zoneCodes: hitCodes,
    uniqueZoneCodes: new Set(hitCodes).size,
    confidence: Number((hitPages.length / span).toFixed(3)),
  };
}
