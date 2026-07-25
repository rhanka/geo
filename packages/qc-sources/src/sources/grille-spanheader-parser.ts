/**
 * grille-spanheader-parser — VARIANT (fallback) field-mapper for the ONE-PAGE-PER-
 * ZONE-FAMILY grille whose zone codes are ALPHA-ONLY (no digit) and whose norms are
 * laid out in a SPAN header ("Zones EA/A") covering N un-headed value columns.
 *
 * WHY THIS EXISTS — the two residual failure modes the frozen readers cannot latch.
 *   (1) ALPHA-ONLY zone codes. The frozen `readZoneHeaderCode`
 *       (`grille-zoneheader-locator.ts`) requires a DASH+digits code body
 *       (`Ha-102`, `M-1`, `1-HA`); a code that is purely alphabetic — `EA`, `RU`,
 *       `M`, `C` — never matches, so the whole native zoneheader path returns 0 and
 *       the page is misrouted to OCR/vision (which then read the usages column and
 *       publish 0% norm fields).
 *   (2) SPAN header over N un-headed columns. The page banner names SEVERAL zones at
 *       once ("Zones EA/A") and the "Normes d'implantation" rows carry one value PER
 *       zone in position-order ("Superficie minimale au sol (m²)   45   40"). There
 *       is no per-column zone-code header, so the frozen single-zone label:value
 *       reader (`parseLabelValueGrillePage`, leftmost value only) would attribute
 *       EVERY column's value to one zone, and the transposed-columns OCR reader has
 *       no code row to anchor on.
 * Concrete pilot: saint-louis-du-ha-ha (MRC Témiscouata) — banner "Zones EA/A",
 * rows "Superficie …  45  40", "Hauteur maximale (m)  6,5  4", "Avant minimale (m)
 * 9 9 9 9 9".
 *
 * SCOPE / ANTI-REGRESSION. This is a strictly-additive VARIANT in its OWN file. It
 * changes NOTHING in the frozen parsers; the runner applies it ONLY as a FALLBACK,
 * after the standard native readers (`parseLabelValueGrillePage`,
 * `parseNumeroDominanceGrillePage`) have returned 0 on a page. It REUSES the frozen
 * building blocks verbatim: the label→field resolver (`resolveField`), the section
 * tracker (`detectSection`), the per-cell guard (`buildVisionField`) and the field
 * plausibility table (`FIELD_SPECS`).
 *
 * ANTI-INVENTION IS ABSOLUTE.
 *   - CODES are read VERBATIM from an explicit "Zone(s) <codes>" banner (never
 *     synthesised). The banner must carry the plural "Zones" keyword OR a ≥2-letter
 *     lead code, so a bare "Zone A" in prose cannot masquerade as a header.
 *   - VALUES are the VERBATIM per-column cell text, each run through the frozen
 *     `buildVisionField` guard (parse → semantic unit check → plausibility window).
 *   - COLUMN→CODE mapping is applied ONLY when it is UNAMBIGUOUS: either the row's
 *     value-column count equals the code count (position mapping), or every column
 *     carries the SAME value (a shared norm). Any other shape (e.g. 5 margin columns
 *     under a 2-code banner with differing values) is AMBIGUOUS → the field is left
 *     null for every zone. null always beats a guessed attribution.
 *   - The runner's deposit gates (≥3 real codes, overlap≠0 vs SIG, fieldPct≠0) are
 *     the final arbiters; a category-organised grille whose alpha codes do not match
 *     the SIG individual codes is correctly REJECTED at overlap=0 — never deposited.
 *
 * PURE + unit-testable (no PDF/poppler/network): operates on one page's layout text.
 */
import {
  FIELD_SPECS,
  buildVisionField,
  type FieldId,
  type FieldSpec,
} from "./grille-vision-extractor.js";
import {
  ZoneNorms,
  type FieldProvenanceT,
  type NormFieldT,
  type ZoneNormsT,
} from "./grille-specifications-parser.js";
import { resolveField, detectSection } from "./grille-zoneheader-parser.js";

/** Default provenance tag for the span-header variant. */
export const SPANHEADER_METHODE = "native-text/spanheader";

/** Reuse the frozen resolver's Section + CanonUnit parameter types (not exported). */
type Section = Parameters<typeof resolveField>[1];
type CanonUnit = Parameters<typeof resolveField>[2];

// ───────────────────────────────────────────────────────────────────────────
//  Span-header zone-code reader (VERBATIM, alpha-only).
// ───────────────────────────────────────────────────────────────────────────

/** Top lines scanned for the "Zone(s) <codes>" banner (it sits at the page head). */
const HEADER_SCAN_LINES = 6;

/**
 * The banner: the word "Zone"/"Zones" then a "/"- or ","-joined run of ALPHA-ONLY,
 * UPPERCASE code tokens ("EA", "EA/A", "RU", "M"). Anchored on the keyword; the code
 * group is purely UPPERCASE `[A-Z]` (1–4 chars) so a normal dash+digit code (handled
 * by the frozen path) never routes here, a lowercase prose tail ("Zone de
 * villégiature") is not read as a code, and a numeric/prose tail on the same line is
 * not swept in (the group only continues across an explicit "/" or ",").
 */
const SPAN_BANNER = /\bZones?\b[ \t]+([A-Z]{1,4}(?:[ \t]*[/,][ \t]*[A-Z]{1,4})*)\b/;

/** Fold a code to its canonical VERBATIM-uppercase form (no dash/space rewriting). */
function normCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Read the VERBATIM alpha-only zone codes named by a span header, in banner order.
 * Returns [] when there is no unambiguous alpha-only "Zone(s) <codes>" banner in the
 * page's head (anti-invention: no banner, no codes). Anti-noise gate: the banner must
 * either use the PLURAL "Zones" keyword or lead with a ≥2-letter code, so a stray
 * singular "Zone A …" line in prose does not qualify.
 */
export function readSpanHeaderCodes(pageText: string): string[] {
  const lines = pageText.split(/\r?\n/);
  const scan = Math.min(lines.length, HEADER_SCAN_LINES);
  for (let i = 0; i < scan; i++) {
    const line = lines[i] ?? "";
    const m = line.match(SPAN_BANNER);
    if (!m?.[1]) continue;
    const plural = /\bZones\b/i.test(line.slice(0, (m.index ?? 0) + 5));
    const codes = m[1]
      .split(/[/,]/)
      .map((c) => normCode(c))
      .filter((c) => c.length > 0);
    if (codes.length === 0) continue;
    // Anti-noise: require the plural keyword OR a ≥2-letter lead code.
    if (!plural && codes[0]!.length < 2) continue;
    // Dedupe, preserve banner order.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of codes) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }
  return [];
}

// ───────────────────────────────────────────────────────────────────────────
//  Row → label + per-column value cells.
// ───────────────────────────────────────────────────────────────────────────

/** A pure number cell (FR decimal comma), e.g. "45", "6,5", "2,75", "1000". */
const NUMBER_CELL = /^-?\d+(?:[.,]\d+)?$/;
/** An "absent" single-dash marker cell ("—" / "–" / "-"). */
const ABSENT_CELL = /^[-—–]$/;

interface RowCells {
  /** The label prefix (everything left of the trailing value run). */
  label: string;
  /** Verbatim value cells, left-to-right (a number or an absent marker). */
  cells: string[];
}

/**
 * Split ONE grille row into its label prefix + the TRAILING run of value cells.
 * A value cell is a bare number (FR comma) or an absent marker; the run is the
 * maximal suffix of such tokens. A row with no trailing value cell → null. This
 * keeps prose/usage rows (no numeric tail, or a non-numeric tail) out.
 */
export function splitRowCells(line: string): RowCells | null {
  const toks = line.split(/[ \t]+/).filter((t) => t.length > 0);
  if (toks.length === 0) return null;
  let i = toks.length;
  while (i > 0 && (NUMBER_CELL.test(toks[i - 1]!) || ABSENT_CELL.test(toks[i - 1]!))) i--;
  const cells = toks.slice(i);
  if (cells.length === 0) return null;
  const label = toks.slice(0, i).join(" ").trim();
  if (!label) return null; // a lone number run with no label is not a norm row
  return { label, cells };
}

/** Unit hint for `resolveField`'s hauteur métres/étages split, read off the label. */
function unitHint(label: string): CanonUnit {
  const s = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/etages?/.test(s)) return "etages";
  if (/\(m|metres?|\bm\b/.test(s)) return "m";
  return "";
}

/** Canonical numeric key of a value cell (for the "all columns equal" shortcut). */
function numKey(cell: string): string {
  if (ABSENT_CELL.test(cell)) return "∅";
  return cell.replace(/\s/g, "").replace(",", ".");
}

// ───────────────────────────────────────────────────────────────────────────
//  Bound preference (min/max) — mirror the frozen zoneheader parser's discipline.
// ───────────────────────────────────────────────────────────────────────────

const PREFERRED_MAX: ReadonlySet<FieldId> = new Set(["hauteur_etages", "hauteur_metres"]);

/** 2 = the field's preferred bound row, 1 = neutral/unlabelled, 0 = opposite bound. */
function boundRank(field: FieldId, label: string): number {
  const s = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hasMax = /\bmax/.test(s);
  const hasMin = /\bmin/.test(s);
  if (PREFERRED_MAX.has(field)) return hasMax ? 2 : hasMin ? 0 : 1;
  return hasMin ? 2 : hasMax ? 0 : 1;
}

/**
 * A *_min field must NOT be fed from an explicit "…maximale/max" row (the opposite
 * bound), and a hauteur (max) field must NOT be fed from a "…minimale/min" row.
 * resolveField maps "Avant maximale" → marge_avant_min (it keys on the direction
 * word only), so without this a stray populated max row could publish into a min
 * field. Anti-invention: reject the opposite-bound row outright.
 */
function boundCompatible(field: FieldId, label: string): boolean {
  const s = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hasMax = /\bmax/.test(s);
  const hasMin = /\bmin/.test(s);
  if (PREFERRED_MAX.has(field)) return !(hasMin && !hasMax); // reject a pure-min row
  return !(hasMax && !hasMin); // reject a pure-max row for a *_min field
}

// ───────────────────────────────────────────────────────────────────────────
//  Column → code attribution (UNAMBIGUOUS only).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Attribute a row's value cells to the N banner codes, VERBATIM, only when the
 * mapping is unambiguous. Returns one raw cell (or null) per code:
 *   - cells.length === N          → position mapping (column i → code i);
 *   - cells.length ≥ 2, all equal → the shared value applies to every code;
 *   - cells.length === 1, N === 1 → the single zone's value;
 *   - anything else               → AMBIGUOUS → null for every code.
 */
export function attributeCells(cells: string[], n: number): (string | null)[] {
  if (n <= 0) return [];
  if (cells.length === n) return cells.map((c) => (ABSENT_CELL.test(c) ? null : c));
  if (cells.length >= 2) {
    const keys = new Set(cells.map(numKey));
    if (keys.size === 1) {
      const v = ABSENT_CELL.test(cells[0]!) ? null : cells[0]!;
      return Array.from({ length: n }, () => v);
    }
  }
  if (cells.length === 1 && n === 1) {
    return [ABSENT_CELL.test(cells[0]!) ? null : cells[0]!];
  }
  return Array.from({ length: n }, () => null);
}

// ───────────────────────────────────────────────────────────────────────────
//  Top-level: one span-header page → ZoneNorms[] (one per banner code).
// ───────────────────────────────────────────────────────────────────────────

export interface SpanHeaderParseOptions {
  source_url: string;
  snapshot: string;
  /** Provenance method tag. Default "native-text/spanheader". */
  methode?: string;
}

const specOf = (id: FieldId): FieldSpec => FIELD_SPECS.find((s) => s.id === id)!;

/**
 * Map ONE span-header grille page → ZoneNorms[] (one row per banner code). Reads the
 * verbatim alpha-only codes from the "Zone(s) <codes>" banner, then walks the norm
 * rows attributing each column's VERBATIM cell to its code (unambiguous mappings
 * only). Emits nothing when there is no banner (anti-invention: no header, no zone).
 */
export function parseSpanHeaderGrillePage(
  pageText: string,
  page: number,
  opts: SpanHeaderParseOptions,
): ZoneNormsT[] {
  const codes = readSpanHeaderCodes(pageText);
  if (codes.length === 0) return [];
  const methode = opts.methode ?? SPANHEADER_METHODE;
  const n = codes.length;

  // Per-code accumulator: fieldId → { raw, rank } (higher-rank bound row wins).
  const acc: Array<Partial<Record<FieldId, { raw: string; rank: number }>>> = codes.map(
    () => ({}),
  );

  let section: Section = "other";
  for (const line of pageText.split(/\r?\n/)) {
    const rc = splitRowCells(line);
    if (!rc) {
      section = detectSection(line, section);
      continue;
    }
    const field = resolveField(rc.label, section, unitHint(rc.label));
    if (!field) continue;
    if (!boundCompatible(field, rc.label)) continue;
    const rank = boundRank(field, rc.label);
    const attributed = attributeCells(rc.cells, n);
    for (let i = 0; i < n; i++) {
      const raw = attributed[i];
      if (raw === null || raw === undefined) continue;
      const prev = acc[i]![field];
      if (prev === undefined || rank > prev.rank) acc[i]![field] = { raw, rank };
    }
  }

  const zones: ZoneNormsT[] = [];
  for (let i = 0; i < n; i++) {
    const code = codes[i]!;
    const provenance = (): FieldProvenanceT => ({
      source_url: opts.source_url,
      methode,
      snapshot: opts.snapshot,
      page: `PAGE ${page} ZONE ${code}`,
    });
    const field = (id: FieldId): NormFieldT => {
      const raw = acc[i]![id]?.raw ?? null;
      // Single native read → feed as both passes (concordance auto-holds).
      return buildVisionField(specOf(id), raw, raw, provenance());
    };
    const hauteurMetres = field("hauteur_metres");
    const hauteurEtages = field("hauteur_etages");
    const hauteurMax = hauteurMetres.value !== null ? hauteurMetres : hauteurEtages;
    const zn: ZoneNormsT = {
      zone_code: code,
      zone_page: `PAGE ${page} ZONE ${code}`,
      usages: [],
      densite: field("densite"),
      hauteur_min: null,
      hauteur_max: hauteurMax,
      marges: {
        avant_min: field("marge_avant_min"),
        laterale_min: field("marge_laterale_min"),
        arriere_min: field("marge_arriere_min"),
      },
      frontage_min: field("frontage_min"),
      superficie_min: field("superficie_min"),
    };
    zones.push(ZoneNorms.parse(zn));
  }
  return zones;
}

/**
 * Map a whole document's per-page layout texts → ZoneNorms[] (one row per banner
 * code, merged across pages preferring the row with more published values). A zone
 * family whose banner recurs on several pages (a usages feuillet + a normes feuillet)
 * is merged so the norms feuillet's values win.
 */
export function parseSpanHeaderGrilleDocument(
  pageTexts: ReadonlyArray<string>,
  opts: SpanHeaderParseOptions,
  pages?: ReadonlyArray<number>,
): ZoneNormsT[] {
  const byZone = new Map<string, ZoneNormsT>();
  const published = (z: ZoneNormsT): number =>
    [
      z.densite,
      z.hauteur_max,
      z.frontage_min,
      z.superficie_min,
      z.marges.avant_min,
      z.marges.laterale_min,
      z.marges.arriere_min,
    ].filter((f) => f && f.value !== null).length;
  for (let i = 0; i < pageTexts.length; i++) {
    const pageNo = pages?.[i] ?? i + 1;
    for (const z of parseSpanHeaderGrillePage(pageTexts[i] ?? "", pageNo, opts)) {
      const key = z.zone_code.toUpperCase().replace(/\s+/g, "");
      const prev = byZone.get(key);
      if (!prev || published(z) > published(prev)) byZone.set(key, z);
    }
  }
  return [...byZone.values()];
}
