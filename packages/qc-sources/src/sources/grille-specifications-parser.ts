import { z } from "zod";

/**
 * Pure parser for the Québec "grille des usages et des normes" — the zoning
 * specification table that lives in the consolidated BASE zoning bylaw (or its
 * Annexe A grille), NOT in the amendment PDFs (per the FROZEN design,
 * `docs/spec/normes-extraction-retenu.md` §6).
 *
 * PILOT = Ville de Sherbrooke, Règlement 1200 grille annex (Excel-generated,
 * NATIVE-TEXT PDF). Layout: one "No zone" page per grille; zones are ROWS, norms
 * are COLUMNS. The committed golden fixtures (`grille-specifications.fixture.ts`)
 * are the verbatim `pdftotext -layout` output of real pages.
 *
 * ANTI-INVENTION IS ABSOLUTE (design §6, MVP metric "0 norme fausse servie comme
 * certaine"): a field's `value` is published ONLY if the extracted cell passes
 * every structural guard AND its `confidence >= PUBLISH_THRESHOLD`. Otherwise
 * `value: null` + a flag + the verbatim `raw` is kept. `null` always beats a
 * fabricated number. No interpolation, no defaulting to 0, no "best guess".
 *
 * The four building blocks (each independently testable):
 *   1. `normalizeUnit`     — QC unit normaliser (FR decimal comma; m/m²/étages;
 *                            s.o./—/n/a → null, NEVER 0; unknown → value:null+raw).
 *   2. `isGrillePage`      — header-anchored page classifier (canonical headers).
 *   3. column clustering   — per-page anchors DERIVED FROM the detected header
 *                            band (NOT absolute positions — pages are indented
 *                            differently), each value token assigned to its
 *                            nearest anchor within a tolerance window.
 *   4. anti-décalage guards— (a) detected-column-count == recognised-header-count
 *                            else REJECT the whole grille; (b) round-trip: rebuild
 *                            the row from the cells and re-match the raw band;
 *                            (c) semantic type-check: a "marge"/"hauteur" cell
 *                            carrying an `m²` unit (or a "superficie" carrying a
 *                            bare `m`) trips the décalage and is rejected.
 */

// ───────────────────────────────────────────────────────────────────────────
//  Output schema — ZoneNorms (zod), per-field {value|null, raw, unit,
//  confidence, _provenance}.
// ───────────────────────────────────────────────────────────────────────────

/** Sentinel used wherever a value cannot be safely extracted (anti-invention). */
export const GRILLE_NON_DISPONIBLE = "non-disponible";

/** A field is published only at/above this per-field confidence (design §5). */
export const PUBLISH_THRESHOLD = 0.85;

/** Recognised physical units on a QC grille. `null` = unitless / not applicable. */
export const NormUnit = z.enum(["m", "m2", "etages", "pct", "ratio"]).nullable();
export type NormUnitT = z.infer<typeof NormUnit>;

/** Why/where a field's value came from — provenance is PER FIELD (design §8). */
export const FieldProvenance = z.object({
  /** Source document URL (the grille PDF). */
  source_url: z.string().min(1),
  /** Extraction method tag (e.g. "native-text/header-anchored-cluster"). */
  methode: z.string().min(1),
  /** Snapshot label of the fetched document. */
  snapshot: z.string().min(1),
  /** Zone-page header label ("No zone H0001"), when known. */
  page: z.string().optional(),
});
export type FieldProvenanceT = z.infer<typeof FieldProvenance>;

/**
 * One extracted norm field. `value` is published ONLY when confidence is high
 * enough; otherwise it is `null` and `flag` explains the refusal. `raw` is the
 * VERBATIM cell text (kept even when value is refused — never thrown away).
 */
export const NormField = z.object({
  /** Parsed numeric value, or null when refused/absent (anti-invention). */
  value: z.number().nullable(),
  /** Verbatim cell text from the grille, exactly as `pdftotext -layout` emitted it. */
  raw: z.string(),
  /** Physical unit of the value (null = unitless / not applicable). */
  unit: NormUnit,
  /** min(extraction quality, structural integrity, plausibility) ∈ [0,1]. */
  confidence: z.number().min(0).max(1),
  /** Set when value is null despite a present cell ("a-verifier", "absent", ...). */
  flag: z.string().optional(),
  _provenance: FieldProvenance,
});
export type NormFieldT = z.infer<typeof NormField>;

/** A min/max paired field (margins/heights are often published as a range). */
export const NormRange = z.object({
  min: NormField.nullable(),
  max: NormField.nullable(),
});
export type NormRangeT = z.infer<typeof NormRange>;

/** The structured norms of one zone, keyed by `zone_code`. */
export const ZoneNorms = z.object({
  /** Verbatim zone code (e.g. "H-1", "C-306", "P-104"). */
  zone_code: z.string().min(1),
  /** "No zone" page label this row was read from (e.g. "H0001"). */
  zone_page: z.string().min(1),
  /** Usage categories named on the row (verbatim), if any are explicit. */
  usages: z.array(z.string()).default([]),
  /** Density proxy: % occupation au sol min (the grille's land-coverage norm). */
  densite: NormField.nullable(),
  /** Building height min/max (in étages and/or metres, per the grille columns). */
  hauteur_min: NormField.nullable(),
  hauteur_max: NormField.nullable(),
  /** Setback margins (front/side/rear) min, in metres. */
  marges: z.object({
    avant_min: NormField.nullable(),
    laterale_min: NormField.nullable(),
    arriere_min: NormField.nullable(),
  }),
  /** Minimum lot frontage / width (m). */
  frontage_min: NormField.nullable(),
  /** Minimum lot area (m²). */
  superficie_min: NormField.nullable(),
});
export type ZoneNormsT = z.infer<typeof ZoneNorms>;

// ───────────────────────────────────────────────────────────────────────────
//  1. Unit normaliser — separate, independently testable (design §4).
// ───────────────────────────────────────────────────────────────────────────

/** Cell texts that explicitly mean "no value" → null (NEVER 0). */
const ABSENT_TOKENS = new Set([
  "s.o.",
  "s/o",
  "so",
  "n/a",
  "na",
  "—",
  "–",
  "-",
  "",
  ".",
  "...",
]);

export interface NormalizedUnit {
  /** Numeric value, or null when the cell means "absent" or is unparseable. */
  value: number | null;
  /** Physical unit, or null. */
  unit: NormUnitT;
  /** Verbatim cell text. */
  raw: string;
  /** True when the cell was a recognised "absent" marker (vs an unknown pattern). */
  absent: boolean;
}

/**
 * Normalise ONE verbatim grille cell into {value, unit, raw}. Anti-invention:
 *   - FR decimal comma is honoured ("12,5" → 12.5); a thousands separator space
 *     ("1 200") is collapsed.
 *   - units are read from the cell suffix when present ("12,5 m", "415 m²",
 *     "2 étages"); a bare number takes `fallbackUnit` (the column's known unit).
 *   - "s.o."/"—"/"n/a"/"" → {value:null, absent:true} — NEVER 0.
 *   - any pattern that is not a recognised number → {value:null} + raw kept.
 *
 * `fallbackUnit` is the unit DECLARED BY THE COLUMN HEADER (e.g. a "Largeur min.
 * lot (m)" column passes "m"); it is only applied to an otherwise-unitless number.
 */
export function normalizeUnit(
  raw: string,
  fallbackUnit: NormUnitT = null,
): NormalizedUnit {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (ABSENT_TOKENS.has(lower)) {
    return { value: null, unit: null, raw, absent: true };
  }

  // Detect an explicit unit suffix on the cell itself.
  let unit: NormUnitT = fallbackUnit;
  let cellUnit: NormUnitT = null;
  if (/m²|m2|\bm\.?\s*c(?:arré|arres)?/i.test(lower) || /\bm²/.test(lower)) {
    cellUnit = "m2";
  } else if (/(?:^|\s)étages?(?:\s|$)|(?:^|\s)etages?(?:\s|$)/i.test(lower)) {
    cellUnit = "etages";
  } else if (/%/.test(lower)) {
    cellUnit = "pct";
  } else if (/\bm\b/.test(lower) && !/m²|m2/.test(lower)) {
    cellUnit = "m";
  }
  if (cellUnit !== null) unit = cellUnit;

  // A cell carrying alphabetic PROSE (other than a recognised unit word) is a
  // cross-reference / note, not a measured value ("voir art. 73", "Note 5").
  // Strip recognised unit words, then if any letters remain, refuse the number
  // (anti-invention: never lift a digit out of prose). Keep raw.
  const deUnit = lower
    .replace(/m²|m2|étages?|etages?|\bm\b|%/gi, " ")
    .replace(/[\d.,/()-]/g, " ")
    .trim();
  if (/[a-zà-ÿ]/i.test(deUnit)) {
    return { value: null, unit, raw, absent: false };
  }

  // Pull the FIRST number out of the cell. FR decimal comma; collapse a single
  // space used as a thousands separator only when it sits between digit groups.
  const numMatch = lower
    .replace(/(\d)\s+(\d{3}\b)/g, "$1$2") // "1 200" → "1200"
    .match(/-?\d+(?:[.,]\d+)?/);
  if (!numMatch) {
    // No number at all → unknown pattern. Keep raw, refuse value (anti-invention).
    return { value: null, unit, raw, absent: false };
  }
  const value = Number.parseFloat(numMatch[0].replace(",", "."));
  if (!Number.isFinite(value)) {
    return { value: null, unit, raw, absent: false };
  }
  return { value, unit, raw, absent: false };
}

// ───────────────────────────────────────────────────────────────────────────
//  2. Page classifier — canonical headers present? (design §2).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Canonical header tokens that a real grille page carries. We require a strong
 * majority so an arbitrary règlement text page (which may mention "marge" once)
 * is not misclassified as a grille. Matching is accent/case-insensitive.
 */
const CANONICAL_HEADERS: ReadonlyArray<{ key: string; re: RegExp }> = [
  { key: "title", re: /grille des usages et (?:des )?normes/i },
  { key: "usage", re: /\busage\b/i },
  { key: "lotissement", re: /\blotissement\b/i },
  { key: "largeur", re: /\blargeur\b/i },
  { key: "superficie", re: /\bsuperficie\b/i },
  { key: "hauteur", re: /\bhauteur\b/i },
  { key: "marge", re: /\bmarge\b/i },
  { key: "implantation", re: /\bimplantation\b/i },
];

/** How many canonical headers a page must carry to count as a grille. */
export const MIN_CANONICAL_HEADERS = 6;

export interface GrilleClassification {
  isGrille: boolean;
  matchedHeaders: string[];
  /** Header score ∈ [0,1] = matched / total canonical headers. */
  headerScore: number;
}

/**
 * Classify a page's `pdftotext -layout` text: is it a "grille des usages et
 * normes"? True only when at least `MIN_CANONICAL_HEADERS` canonical headers are
 * present. A title/TOC/prose page fails (anti-invention: we never try to read
 * norms off a non-grille page).
 */
export function isGrillePage(text: string): GrilleClassification {
  const matched: string[] = [];
  for (const { key, re } of CANONICAL_HEADERS) {
    if (re.test(text)) matched.push(key);
  }
  const headerScore = matched.length / CANONICAL_HEADERS.length;
  return {
    isGrille: matched.length >= MIN_CANONICAL_HEADERS,
    matchedHeaders: matched,
    headerScore,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  3. Column model + per-page anchored clustering (design §3).
// ───────────────────────────────────────────────────────────────────────────

/** One logical norm column the parser extracts, with its semantic constraints. */
interface ColumnSpec {
  /** Stable id used in the row→ZoneNorms mapping. */
  id:
    | "nombre_max_chambres"
    | "nombre_max_batiments"
    | "frontage_min"
    | "profondeur_min"
    | "superficie_min"
    | "densite"
    | "hauteur_max_etage"
    | "marge_avant_min"
    | "marge_laterale_min"
    | "total_marges_laterales"
    | "marge_arriere_min"
    | "espace_libre_min";
  /** Whether this column feeds a ZoneNorms field, or is modelled only to absorb
   * its tokens so they are not mistaken for strays by the round-trip guard. */
  inOutput: boolean;
  /** Phrase in the header SUB-LABEL line that marks this column's center. */
  headerMatch: RegExp;
  /** Unit the column declares (used as the cell's fallback unit). */
  unit: NormUnitT;
  /** Plausibility window [min,max] for a published value (design §5). */
  plausible: [number, number];
  /**
   * The semantic dimension the cell MUST carry. If a cell's detected unit
   * contradicts this (e.g. a length column getting an `m²` cell), it is a
   * column-décalage and the value is rejected (design §6c).
   */
  semantic: "length" | "area" | "count" | "pct";
}

/**
 * The Sherbrooke 1200 grille columns, in header order. Anchors are derived from
 * the header SUB-LABEL line ("lot (m) / min. lot (m²) / sol min. / sol max. /
 * min. étage / min. (m) / max. étage / max. (m) / avant min. / avant max. /
 * latérale min. / marges / arrière min. / libre min."). Each phrase is UNIQUE on
 * that line, so the anchor is unambiguous.
 *
 * We model EVERY value-bearing column on the row — even the ones we don't surface
 * in ZoneNorms (`total marges latérales`, `% espace libre`) — so that no real
 * value token is left stray. A stray NUMERIC token is the round-trip signal that
 * the row mis-clustered (design §6b); modelling the full row keeps that signal
 * meaningful (it fires on a TRUE décalage, not on an unmodelled column).
 *
 * NOTE on density: `sol min.` is empty for these zones; the populated land-coverage
 * norm is `sol max.` (% d'occupation au sol maximum), which is the density proxy.
 */
const COLUMN_SPECS: ReadonlyArray<ColumnSpec> = [
  {
    id: "nombre_max_chambres",
    inOutput: false, // "Nombre max. de chambres en maison de chambres" — absorbed
    headerMatch: /de chambres/i,
    unit: null,
    plausible: [0, 100],
    semantic: "count",
  },
  {
    id: "nombre_max_batiments",
    inOutput: false, // "Nombre max. de bâtiments en rangée" — absorbed
    headerMatch: /de bâtiments/i,
    unit: null,
    plausible: [0, 100],
    semantic: "count",
  },
  {
    id: "frontage_min",
    inOutput: true,
    // "lot (m)" of "Largeur min. lot (m)" — the ONLY "lot (m)" NOT preceded by
    // "min. " (profondeur is "min. lot (m)"; superficie is "min. lot (m²)").
    headerMatch: /(?<!min\. )lot \(m\)(?!²)/i,
    unit: "m",
    plausible: [3, 200],
    semantic: "length",
  },
  {
    id: "profondeur_min",
    inOutput: false, // "Profondeur min. lot (m)" — absorbed (keeps round-trip honest)
    headerMatch: /min\. lot \(m\)(?!²)/i,
    unit: "m",
    plausible: [3, 500],
    semantic: "length",
  },
  {
    id: "superficie_min",
    inOutput: true,
    headerMatch: /min\. lot \(m²\)/i, // "min. lot (m²)"
    unit: "m2",
    plausible: [100, 1_000_000],
    semantic: "area",
  },
  {
    id: "densite",
    inOutput: true,
    headerMatch: /sol max\./i, // "% d'occ. au sol max." (land coverage)
    unit: "pct",
    plausible: [0, 100],
    semantic: "pct",
  },
  {
    id: "hauteur_max_etage",
    inOutput: true,
    headerMatch: /max\. étage/i, // "Hauteur max. étage"
    unit: "etages",
    plausible: [1, 60],
    semantic: "count",
  },
  {
    id: "marge_avant_min",
    inOutput: true,
    headerMatch: /avant min\./i, // "Marge avant min. (m)"
    unit: "m",
    plausible: [0, 30],
    semantic: "length",
  },
  {
    id: "marge_laterale_min",
    inOutput: true,
    headerMatch: /latérale min\./i, // "Marge latérale min. (m)"
    unit: "m",
    plausible: [0, 30],
    semantic: "length",
  },
  {
    id: "total_marges_laterales",
    inOutput: false, // absorbed (not surfaced), keeps round-trip honest
    headerMatch: /\bmarges\b/i, // "Total marges latérales min. (m)"
    unit: "m",
    plausible: [0, 60],
    semantic: "length",
  },
  {
    id: "marge_arriere_min",
    inOutput: true,
    headerMatch: /arrière min\./i, // "Marge arrière min. (m)"
    unit: "m",
    plausible: [0, 30],
    semantic: "length",
  },
  {
    id: "espace_libre_min",
    inOutput: false, // absorbed (not surfaced)
    headerMatch: /libre min\./i, // "% espace libre min."
    unit: "pct",
    plausible: [0, 100],
    semantic: "pct",
  },
];

/** A whitespace-delimited token with its center character column. */
interface Token {
  center: number;
  start: number;
  end: number;
  text: string;
}

/** Split a layout line into single tokens with their character centers. */
function tokenize(line: string): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push({
      center: Math.round((m.index + m.index + m[0].length) / 2),
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
    });
  }
  return out;
}

/**
 * Merge a `Note` token with the immediately-following single number token
 * ("Note" + "5" → "Note 5"), recomputing the span/center. `pdftotext -layout`
 * splits a "Note 5" reference cell into two tokens; merging keeps the cell whole
 * so it clusters as ONE ambiguous reference (→ null) instead of leaking the bare
 * "5" into a neighbouring value column (anti-décalage / anti-invention).
 */
function mergeNoteTokens(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if (
      /^note$/i.test(t.text) &&
      next &&
      /^\d{1,3}$/.test(next.text) &&
      next.start - t.end <= 2
    ) {
      out.push({
        start: t.start,
        end: next.end,
        center: Math.round((t.start + next.end) / 2),
        text: `${t.text} ${next.text}`,
      });
      i++; // consume the number
    } else {
      out.push(t);
    }
  }
  return out;
}

/** A resolved column anchor: a spec bound to a character center on THIS page. */
interface ColumnAnchor {
  spec: ColumnSpec;
  center: number;
}

/**
 * Locate the header SUB-LABEL line — the per-column unit/qualifier line carrying
 * "lot (m)", "min. lot (m²)", "sol max.", "max. étage", "avant min.", … This is
 * the line whose phrase centers align with the value cells. Returns its index or
 * -1. Identified by carrying several of the unique sub-label phrases at once
 * (anti-misfire: a prose line never has all of these).
 */
function findSubLabelLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    const hits =
      (/lot \(m²\)/i.test(l) ? 1 : 0) +
      (/sol max\./i.test(l) ? 1 : 0) +
      (/max\. étage/i.test(l) ? 1 : 0) +
      (/avant min\./i.test(l) ? 1 : 0) +
      (/arrière min\./i.test(l) ? 1 : 0);
    if (hits >= 4) return i;
  }
  return -1;
}

/**
 * Derive per-page column anchors by locating each COLUMN_SPEC's header phrase on
 * THIS page's sub-label line. Anchors are page-LOCAL (the fixture proves pages
 * are indented differently): we never trust an absolute column from another
 * page. Returns anchors in header order; a spec whose phrase is not found is
 * dropped (and the count guard then rejects the grille).
 */
export function deriveColumnAnchors(lines: string[]): ColumnAnchor[] {
  const unitIdx = findSubLabelLine(lines);
  if (unitIdx < 0) return [];
  const unitLine = lines[unitIdx] ?? "";

  const anchors: ColumnAnchor[] = [];
  for (const spec of COLUMN_SPECS) {
    const center = matchPhraseCenter(unitLine, spec.headerMatch);
    if (center !== null) anchors.push({ spec, center });
  }
  return anchors;
}

/**
 * Find the character center of the header PHRASE matching `re` on `line`.
 * Returns the midpoint of the matched substring, or null. Anchoring on the
 * matched substring (not a single token) makes multi-word labels stable.
 */
function matchPhraseCenter(line: string, re: RegExp): number | null {
  const m = line.match(re);
  if (!m || m.index === undefined) return null;
  return Math.round(m.index + m[0].length / 2);
}

/** Largest center distance (chars) a value token may sit from its anchor. */
export const ANCHOR_TOLERANCE = 8;

/**
 * Assign each value token on a zone row to its nearest column anchor within
 * `ANCHOR_TOLERANCE`. Returns a map anchorIndex → token. A token that is not
 * within tolerance of ANY anchor is recorded as `unmatched` (used by the
 * round-trip guard: stray tokens mean the row did not cluster cleanly).
 */
function assignTokensToAnchors(
  rowTokens: Token[],
  anchors: ColumnAnchor[],
): { byAnchor: Map<number, Token>; unmatched: Token[] } {
  const byAnchor = new Map<number, Token>();
  const unmatched: Token[] = [];
  for (const tok of rowTokens) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(tok.center - anchors[i]!.center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0 && bestDist <= ANCHOR_TOLERANCE) {
      // If two tokens claim one anchor, keep the closer one; the other is stray.
      const existing = byAnchor.get(best);
      if (existing) {
        const dExisting = Math.abs(existing.center - anchors[best]!.center);
        if (bestDist < dExisting) {
          unmatched.push(existing);
          byAnchor.set(best, tok);
        } else {
          unmatched.push(tok);
        }
      } else {
        byAnchor.set(best, tok);
      }
    } else {
      unmatched.push(tok);
    }
  }
  return { byAnchor, unmatched };
}

// ───────────────────────────────────────────────────────────────────────────
//  4. Anti-décalage guards + row extraction (design §6).
// ───────────────────────────────────────────────────────────────────────────

/** Zone code at the row's left edge, e.g. "H-1", "C-306", "P-104". */
const ROW_ZONE_RE = /^\s*([A-Z]{1,3}-\d{1,4}(?:-\d{1,3})?)\b/;

/** A cell that is a soft note/cross-reference, not a value (→ ambiguous null). */
const NOTE_CELL_RE = /^note\b|^\(\d+\)$|^art\.?\s*\d+/i;

export interface GrilleRejection {
  rejected: true;
  reason: string;
}

export interface GrilleExtraction {
  rejected: false;
  zonePage: string;
  anchors: ColumnAnchor[];
  zones: ZoneNormsT[];
}

export type GrilleResult = GrilleRejection | GrilleExtraction;

/** Read the "No zone XXXX" page label (verbatim id), or "non-disponible". */
export function extractZonePage(text: string): string {
  const m = text.match(/No zone\s+([A-Za-z]?\d{2,6})\b/);
  return m?.[1] ?? GRILLE_NON_DISPONIBLE;
}

interface ExtractOptions {
  source_url: string;
  snapshot: string;
  methode?: string;
}

/**
 * Build a NormField for one (anchor, token) pair, running the per-field guards
 * and confidence. When `token` is undefined the cell was EMPTY → null/absent.
 */
function buildField(
  anchor: ColumnAnchor,
  token: Token | undefined,
  ctx: { source_url: string; snapshot: string; methode: string; page: string },
): NormFieldT {
  const provenance: FieldProvenanceT = {
    source_url: ctx.source_url,
    methode: ctx.methode,
    snapshot: ctx.snapshot,
    page: ctx.page,
  };

  // Empty cell → null, low-but-honest: the absence is itself a fact, but we
  // never publish a number for it.
  if (token === undefined) {
    return {
      value: null,
      raw: "",
      unit: null,
      confidence: 0,
      flag: "absent",
      _provenance: provenance,
    };
  }

  const raw = token.text;

  // Ambiguous note/cross-reference cell ("Note 5", "(1)", "art. 73") → never a
  // value. Keep raw, refuse the number.
  if (NOTE_CELL_RE.test(raw.trim())) {
    return {
      value: null,
      raw,
      unit: null,
      confidence: 0.2,
      flag: "a-verifier",
      _provenance: provenance,
    };
  }

  const norm = normalizeUnit(raw, anchor.spec.unit);

  // Recognised "absent" marker → null (NEVER 0).
  if (norm.absent) {
    return {
      value: null,
      raw,
      unit: null,
      confidence: 0,
      flag: "absent",
      _provenance: provenance,
    };
  }

  // Unknown pattern (no number) → refuse, keep raw.
  if (norm.value === null) {
    return {
      value: null,
      raw,
      unit: norm.unit,
      confidence: 0.2,
      flag: "a-verifier",
      _provenance: provenance,
    };
  }

  // ── confidence = min(extraction, structural integrity, plausibility) ──
  // (i) extraction quality: a clean single-token native-text cell is high.
  const extractionQ = 0.97;
  // (ii) structural integrity: a token comfortably inside the tolerance window
  // is fully trusted; integrity only decays in the OUTER half of the window
  // (where the assignment becomes genuinely doubtful). A small header/value
  // center offset (a few chars, from header wrapping) is normal and not penalised.
  const offset = Math.abs(token.center - anchor.center);
  const half = ANCHOR_TOLERANCE / 2;
  const structuralQ =
    offset <= half
      ? 1
      : Math.max(0, 1 - (offset - half) / (ANCHOR_TOLERANCE - half + 1));
  // (iii) plausibility window for the field.
  const [lo, hi] = anchor.spec.plausible;
  const plausibleQ = norm.value >= lo && norm.value <= hi ? 1 : 0.1;
  // (iv) semantic type-check (anti-décalage §6c): the cell's detected unit must
  // not contradict the column's semantic dimension.
  const semanticOk = semanticUnitMatches(anchor.spec.semantic, norm.unit);
  const semanticQ = semanticOk ? 1 : 0;

  const confidence = Math.min(
    extractionQ,
    structuralQ,
    plausibleQ,
    semanticQ,
  );

  const publish = confidence >= PUBLISH_THRESHOLD;
  return {
    value: publish ? norm.value : null,
    raw,
    unit: norm.unit,
    confidence: Number(confidence.toFixed(3)),
    ...(publish ? {} : { flag: "a-verifier" }),
    _provenance: provenance,
  };
}

/**
 * Semantic type-check: does a cell's detected unit fit the column's dimension?
 * A length column accepting an `m²` cell (or vice-versa) is the signature of a
 * column décalage even when the number is plausible (design §6c). A bare number
 * (unit inherited from the column) is allowed — the trap is an EXPLICIT
 * contradicting unit on the cell.
 */
function semanticUnitMatches(
  semantic: ColumnSpec["semantic"],
  unit: NormUnitT,
): boolean {
  switch (semantic) {
    // A length (marge/largeur/frontage) must be in metres or unitless — an
    // explicit m²/étages/% cell here is a column décalage.
    case "length":
      return unit === "m" || unit === null;
    // An area (superficie) must be m² or unitless — a bare-metre cell here means
    // the m² column was read off the metre column to its left (the §6c trap).
    case "area":
      return unit === "m2" || unit === null;
    case "count":
      return unit === "etages" || unit === null;
    case "pct":
      return unit === "pct" || unit === null;
    default:
      return true;
  }
}

/**
 * Parse ONE grille page's `pdftotext -layout` text into ZoneNorms per zone.
 *
 * Pipeline: classify → derive page-local anchors → GUARD column count → for each
 * zone row, tokenize, cluster to anchors, round-trip check, build guarded fields.
 *
 * The whole grille is REJECTED (no partial publication) when the structural
 * guard fails (design §6a): if the number of anchors we could resolve from this
 * page's header band is not the full expected set, the column model is unsafe.
 */
export function parseGrillePage(
  text: string,
  opts: ExtractOptions,
): GrilleResult {
  const cls = isGrillePage(text);
  if (!cls.isGrille) {
    return { rejected: true, reason: `not a grille page (headers: ${cls.matchedHeaders.join(",")})` };
  }

  const lines = text.split("\n");
  const anchors = deriveColumnAnchors(lines);

  // GUARD §6a — detected columns must equal the recognised header set, else
  // reject the WHOLE grille (no silent correction).
  if (anchors.length !== COLUMN_SPECS.length) {
    return {
      rejected: true,
      reason: `column-count mismatch: resolved ${anchors.length} anchors, expected ${COLUMN_SPECS.length} (anti-décalage rejection)`,
    };
  }

  const zonePage = extractZonePage(text);
  const methode = opts.methode ?? "native-text/header-anchored-cluster";
  const ctxBase = {
    source_url: opts.source_url,
    snapshot: opts.snapshot,
    methode,
    page: zonePage,
  };

  const zones: ZoneNormsT[] = [];
  for (const line of lines) {
    const zm = line.match(ROW_ZONE_RE);
    if (!zm) continue;
    const zoneCode = zm[1]!;
    const rowTokens = mergeNoteTokens(tokenize(line));
    // Drop the leading zone-code token; the rest are value cells.
    const valueTokens = rowTokens.filter((t) => t.text !== zoneCode);

    const { byAnchor, unmatched } = assignTokensToAnchors(valueTokens, anchors);

    // GUARD §6b — round-trip: rebuild the row from clustered cells and re-check
    // that no value token was left stray (a stray value = unmodelled column =
    // possible décalage). Note/empty cells are fine; stray NUMERIC tokens are
    // the danger signal.
    const strayNumeric = unmatched.filter((t) =>
      /\d/.test(t.text) && !NOTE_CELL_RE.test(t.text),
    );
    const roundTripOk = strayNumeric.length === 0;

    const fieldOf = (idx: number): NormFieldT =>
      buildField(anchors[idx]!, byAnchor.get(idx), ctxBase);

    // If round-trip failed, downgrade every published field on the row to null
    // (we do not trust the alignment of a row with stray numeric cells).
    const guard = (f: NormFieldT): NormFieldT =>
      roundTripOk
        ? f
        : {
            ...f,
            value: null,
            confidence: Math.min(f.confidence, 0.4),
            flag: "decalage-suspecte",
          };

    const byId = (id: ColumnSpec["id"]): NormFieldT => {
      const idx = anchors.findIndex((a) => a.spec.id === id);
      return guard(fieldOf(idx));
    };

    const zn: ZoneNormsT = {
      zone_code: zoneCode,
      zone_page: zonePage,
      usages: [],
      densite: byId("densite"),
      hauteur_min: null,
      hauteur_max: byId("hauteur_max_etage"),
      marges: {
        avant_min: byId("marge_avant_min"),
        laterale_min: byId("marge_laterale_min"),
        arriere_min: byId("marge_arriere_min"),
      },
      frontage_min: byId("frontage_min"),
      superficie_min: byId("superficie_min"),
    };
    zones.push(ZoneNorms.parse(zn));
  }

  return { rejected: false, zonePage, anchors, zones };
}

/**
 * Parse a multi-page grille document's text (pages separated however poppler
 * emits them — here we accept already-split page texts). Convenience for the
 * adapter, which fetches the whole annex and splits per "No zone" page.
 */
export function parseGrilleDocument(
  pageTexts: ReadonlyArray<string>,
  opts: ExtractOptions,
): { zones: ZoneNormsT[]; rejectedPages: GrilleRejection[] } {
  const zones: ZoneNormsT[] = [];
  const rejectedPages: GrilleRejection[] = [];
  for (const pt of pageTexts) {
    const res = parseGrillePage(pt, opts);
    if (res.rejected) rejectedPages.push(res);
    else zones.push(...res.zones);
  }
  return { zones, rejectedPages };
}
