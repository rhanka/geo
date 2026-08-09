/**
 * grille-zoneheader-parser — DETERMINISTIC ($0, no LLM) FIELD-MAPPER for the
 * ONE-ZONE-PER-PAGE "label : value" grille gabarit (voie B core).
 *
 * WHY THIS IS THE UNBLOCKER (finding normes-f1). The per-page VISION path already
 * recovers the zone_code on this layout (durham-sud: 62 codes, 60/62 overlap vs SIG,
 * 97%) but published 0% norm fields → REJECTED. The cause is NOT bornage: it is the
 * FIELD-MAPPING. On these pages each norm is a self-labelled row
 *   "Marge de recul avant minimale        10 mètres"
 *   "Hauteur maximale                       9 mètres"
 *   "Superficie minimale                 1500 mètres carrés"
 * and the LEFT column is the USAGES class list (H1, C1, I3, …). The single-zone
 * vision prompt ("lis la colonne de gauche des valeurs") reads that usages column,
 * so every norm cell comes back null. This mapper reads the norms STRAIGHT from the
 * native text layer — a French label → FieldId regex + a value+unit extractor —
 * which unblocks the small rural munis whose dedicated "grilles d'usage" / "cahier
 * des spécifications" PDFs are native text.
 *
 * MAPPER, not extractor of values. Every published number is the VERBATIM cell value
 * run through the FROZEN `buildVisionField` guard (parse → semantic unit type-check →
 * plausibility window); the OCR concordance is trivially satisfied (single native
 * read fed as both passes). ANTI-INVENTION: a label that maps to no field, a "somme
 * des marges", a dwelling-density "log/ha" (≠ emprise %), an empty/"N/A" cell → null,
 * never a fabrication. The zone_code is the VERBATIM native-text header code.
 *
 * PURE + unit-testable (no PDF/poppler/network): operates on one page's layout text.
 */
import {
  FIELD_SPECS,
  buildVisionField,
  type FieldId,
} from "./grille-vision-extractor.js";
import {
  ZoneNorms,
  type FieldProvenanceT,
  type NormFieldT,
  type ZoneNormsT,
} from "./grille-specifications-parser.js";
import { labelToFieldId } from "./grille-ocr-extractor.js";
import { readZoneHeaderCode } from "./grille-zoneheader-locator.js";

/** Default provenance tag when none supplied. */
export const ZONEHEADER_METHODE = "native-text/zoneheader";

/** Fold a label for keyword matching: lowercase, strip accents + markdown emphasis. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ───────────────────────────────────────────────────────────────────────────
//  Value + unit extraction from a "label … value [unit]" line.
// ───────────────────────────────────────────────────────────────────────────

/** A norm value's canonical unit token — the exact form `normalizeUnit` parses. */
type CanonUnit = "m" | "m2" | "%" | "etages" | "LOGHA" | "";

/** Map a raw unit spelling to a canonical token `normalizeUnit` understands. Note
 *  `normalizeUnit` does NOT recognise the spelled-out "mètres carrés", so we fold it
 *  to "m2" here (else a superficie is misread as metres and the area guard rejects). */
function canonUnit(raw: string | undefined | null): CanonUnit {
  if (!raw) return "";
  const s = fold(raw);
  if (/\blog\b|log\s*\/\s*ha|\/\s*ha/.test(s)) return "LOGHA";
  if (/carr/.test(s) || /m²|m2/.test(raw)) return "m2";
  if (/etages?/.test(s)) return "etages";
  if (/%/.test(raw) || /pourcent/.test(s)) return "%";
  if (/metres?|\bm\b/.test(s)) return "m";
  return "";
}

/** A unit spelled inside the label parens: "(m)", "(m²)", "(mètre)", "(%)", "(étage)". */
const PAREN_UNIT = /\((\s*(?:m²|m2|m(?:è|e)tres?|m|%|(?:é|e)tages?)\s*)\)/i;
/**
 * A trailing "<number> <unit-word>" (durham) or a bare trailing number.
 *
 * NUMBER: a FR thousands-grouped run ("7 500", "12 000" — regular/thin/non-breaking
 * space every 3 digits) OR a plain integer/decimal. The grouped alt is FIRST so
 * "7 500 m²" captures 7500, not the last "500" group (a truncation that silently
 * publishes a WRONG superficie). Grouping requires exact \d{3} runs, so multi-column
 * "45 45" (2-digit) never mis-merges. The captured spaces are stripped before the
 * value guard.
 *
 * UNIT: the spelled-out "mètres carrés"/"mètres", "m²"/"m2", "%", "étages", "log/ha",
 * and — added last (lowest priority, after m²/m2/mètres so those still win) — a BARE
 * "m" (beaupré/weblex grilles abbreviate metres as "9m"/"10 m"; `canonUnit` already
 * folds a bare "m" → metres, so the value was recoverable but the capture regex
 * dropped it → 100% null marges/hauteur).
 */
const TRAILING_VALUE =
  /(\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(m(?:è|e)tres?\s+carr\S*|m(?:è|e)tres?|m²|m2|%|(?:é|e)tages?|log\s*\/\s*ha|m)?\.?\s*$/i;
/** The leftmost value cell in a values region: a number OR an "absent" marker. */
const LEFT_VALUE = /(-|—|–|\d+(?:[.,]\d+)?)/;

interface ExtractedValue {
  /** The row's label text (everything left of the value/unit region). */
  label: string;
  /** Canonical "value unit" string to feed `buildVisionField` (or an absent marker). */
  raw: string;
  /** Canonical unit token (for hauteur métres-vs-étages disambiguation). */
  unit: CanonUnit;
}

/**
 * Extract the label + LEFTMOST value + unit from one grille row. Two sub-layouts:
 *   (P) unit in the label parens, then value column(s): "Frontage minimum (m) 45 45"
 *   (W) value then a unit WORD (or bare) at the line end: "…minimale 10 mètres"
 * Returns null when the line carries no value cell (a usages / prose / title line).
 */
export function extractNormValue(line: string): ExtractedValue | null {
  const paren = line.match(PAREN_UNIT);
  if (paren && paren.index !== undefined) {
    const label = line.slice(0, paren.index).trim();
    const region = line.slice(paren.index + paren[0].length);
    const v = region.match(LEFT_VALUE);
    if (!v) return null;
    const unit = canonUnit(paren[1]);
    const bound = region.match(/^\s*(min(?:\.|imum)?|max(?:\.|imum)?)/i)?.[1];
    const labelWithBound = bound ? `${label} ${bound}` : label;
    const raw = /^[-—–]$/.test(v[1]!) ? v[1]! : `${v[1]}${unit && unit !== "LOGHA" ? ` ${unit}` : ""}`;
    return { label: labelWithBound, raw, unit };
  }
  const m = line.match(TRAILING_VALUE);
  if (!m || m[1] === undefined) return null;
  // A pure title/usages line has no numeric tail → TRAILING_VALUE's number group is
  // required, so we only reach here with a real number.
  const label = line.slice(0, m.index).trim();
  if (!label) return null; // a lone number with no label is not a norm row
  const unit = canonUnit(m[2]);
  // Strip FR thousands-separator whitespace from the captured number ("7 500" →
  // "7500") so the value guard parses the real magnitude, not the last group.
  const num = m[1].replace(/\s/g, "");
  const raw = `${num}${unit && unit !== "LOGHA" ? ` ${unit}` : ""}`;
  return { label, raw, unit };
}

// ───────────────────────────────────────────────────────────────────────────
//  Label → FieldId (self-describing labels + section-disambiguated terse labels).
// ───────────────────────────────────────────────────────────────────────────

type Section = "marges" | "terrain" | "batiment" | "rapports" | "other";

/** Update the section context from a NON-value (title/label) row's text. Handles the
 *  rotated left-band labels (lachute "MARGE"/"TERRAIN"/"BÂTIMENT") and the numbered-
 *  grid section titles (blainville "Marges"/"Hauteur"/"Dimensions"/"Superficies"). */
export function detectSection(line: string, prev: Section): Section {
  const s = fold(line);
  if (/\bmarges?\b/.test(s)) return "marges";
  if (/\bhauteur\b|\bbatiment\b|\bvolumetrie\b/.test(s)) return "batiment";
  if (/\bterrain\b|\bdimensions?\b|\bsuperficies?\b|\blotissement\b/.test(s)) return "terrain";
  if (/\brapports?\b|\bdensite\b/.test(s)) return "rapports";
  return prev;
}

/** Terse-label → FieldId GIVEN the section (mirrors the OCR mapper's discipline;
 *  anti-over-mapping: "somme"/"totale", "sur rue", "profondeur", building "superficie
 *  d'implantation" all stay unmapped — a wrong fold is worse than a null). */
function sectionedField(label: string, section: Section, unit: CanonUnit): FieldId | null {
  const s = fold(label);
  if (/\bsomme\b|\btotales?\b/.test(s)) return null;
  switch (section) {
    case "marges":
      if (/avant/.test(s)) return "marge_avant_min";
      if (/arriere/.test(s)) return "marge_arriere_min";
      if (/lateral/.test(s) && !/sur\s+rue/.test(s)) return "marge_laterale_min";
      return null;
    case "terrain":
      if (/superficie/.test(s) && !/plancher|implantation/.test(s)) return "superficie_min";
      if (/(largeur|frontage|facade)/.test(s)) return "frontage_min";
      return null; // profondeur → unmapped
    case "batiment":
      if (/hauteur/.test(s) && !/minim/.test(s)) {
        if (unit === "etages") return "hauteur_etages";
        if (unit === "m") return "hauteur_metres";
      }
      return null;
    default:
      return null;
  }
}

/**
 * Resolve a row's FieldId: self-describing label first (`labelToFieldId`, which nails
 * durham's "Marge de recul avant minimale" / "Largeur minimale" / "Superficie
 * minimale"), then the section-disambiguated terse label (lachute/blainville rotated
 * or numbered rows), then a hauteur-by-unit fallback for a bare "Hauteur maximale"
 * whose unit sits only in the value ("9 mètres"). Returns null (skip) for a dwelling-
 * density "log/ha" value (≠ emprise-au-sol %).
 */
export function resolveField(label: string, section: Section, unit: CanonUnit): FieldId | null {
  if (unit === "LOGHA") return null;
  const direct = labelToFieldId(label);
  if (direct) {
    // The captured VALUE's unit is authoritative for the hauteur métres/étages split.
    // A combined cap "Hauteur maximale  3 étages et 11 m" leaves "…3 étages et" in the
    // label, so `labelToFieldId` keys on "étages" → hauteur_etages; but the value we
    // captured is the metric bound ("11 m"). Publishing it as hauteur_etages makes the
    // étages spec reject "11 m" as unite-incoherente and null a REAL height. Flip to the
    // field the value's unit actually carries (and symmetrically for a metres-label with
    // an étages value).
    if (direct === "hauteur_etages" && unit === "m") return "hauteur_metres";
    if (direct === "hauteur_metres" && unit === "etages") return "hauteur_etages";
    return direct;
  }
  const sectioned = sectionedField(label, section, unit);
  if (sectioned) return sectioned;
  const s = fold(label);
  if (/\bhauteur\b/.test(s) && !/minim/.test(s)) {
    if (unit === "etages") return "hauteur_etages";
    if (unit === "m") return "hauteur_metres";
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
//  Bound preference — for a field split across "minimum"/"maximum" rows, keep the
//  right bound (hauteur → max, every dimensional minimum → min).
// ───────────────────────────────────────────────────────────────────────────

const PREFERRED_MAX: ReadonlySet<FieldId> = new Set(["hauteur_etages", "hauteur_metres"]);

function boundRank(field: FieldId, label: string): number {
  const s = fold(label);
  const hasMax = /\bmax/.test(s);
  const hasMin = /\bmin/.test(s);
  if (PREFERRED_MAX.has(field)) return hasMax ? 2 : hasMin ? 0 : 1;
  return hasMin ? 2 : hasMax ? 0 : 1;
}

// ───────────────────────────────────────────────────────────────────────────
//  Top-level: one page's layout text → [ZoneNorms] (0 or 1).
// ───────────────────────────────────────────────────────────────────────────

export interface ZoneHeaderParseOptions {
  source_url: string;
  snapshot: string;
  /** Provenance method tag. Default "native-text/zoneheader". */
  methode?: string;
  /** VERBATIM zone code override (else read from the page's native-text header). */
  zoneCode?: string;
}

/**
 * Map ONE one-zone-per-page "label : value" grille page → [ZoneNorms] (0 or 1). The
 * zone is `opts.zoneCode` or the page's native-text header code; with neither, nothing
 * is emitted (anti-invention: no header, no zone). Each norm's value is the LEFTMOST
 * value cell of its labelled row, run through the frozen per-cell guard.
 */
export function parseLabelValueGrillePage(
  pageText: string,
  page: number,
  opts: ZoneHeaderParseOptions,
): ZoneNormsT[] {
  const methode = opts.methode ?? ZONEHEADER_METHODE;
  const zoneCode = opts.zoneCode ?? readZoneHeaderCode(pageText);
  if (!zoneCode) return [];

  const fields: Partial<Record<FieldId, string | null>> = {};
  const ranks: Partial<Record<FieldId, number>> = {};
  let section: Section = "other";

  for (const line of pageText.split(/\r?\n/)) {
    const ev = extractNormValue(line);
    if (!ev) {
      // A non-value row may set the section context (MARGES / TERRAIN / BÂTIMENT / …).
      section = detectSection(line, section);
      continue;
    }
    const field = resolveField(ev.label, section, ev.unit);
    if (!field) continue;
    const val = /^[-—–]$/.test(ev.raw.trim()) ? null : ev.raw;
    const rank = boundRank(field, ev.label);
    const prev = ranks[field];
    if (prev === undefined) {
      fields[field] = val;
      ranks[field] = rank;
    } else if (rank > prev && val !== null) {
      fields[field] = val;
      ranks[field] = rank;
    }
  }

  const provenance = (): FieldProvenanceT => ({
    source_url: opts.source_url,
    methode,
    snapshot: opts.snapshot,
    page: `PAGE ${page} ZONE ${zoneCode}`,
  });
  const field = (id: FieldId): NormFieldT => {
    const spec = FIELD_SPECS.find((s) => s.id === id)!;
    const raw = fields[id] ?? null;
    // Single native read → feed as both passes (concordance auto-holds).
    return buildVisionField(spec, raw, raw, provenance());
  };
  const hauteurMetres = field("hauteur_metres");
  const hauteurEtages = field("hauteur_etages");
  const hauteurMax = hauteurMetres.value !== null ? hauteurMetres : hauteurEtages;
  const zn: ZoneNormsT = {
    zone_code: zoneCode,
    zone_page: `PAGE ${page} ZONE ${zoneCode}`,
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
  return [ZoneNorms.parse(zn)];
}

/**
 * Map a whole document's per-page layout texts → guarded ZoneNorms[] (one per page
 * that carries a header code + at least one mapped norm). Merges by zone_code,
 * preferring the row with more published values (a zone may span 2 pages).
 */
export function parseLabelValueGrilleDocument(
  pageTexts: ReadonlyArray<string>,
  opts: ZoneHeaderParseOptions,
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
    const zs = parseLabelValueGrillePage(pageTexts[i] ?? "", pageNo, opts);
    for (const z of zs) {
      const key = z.zone_code.toUpperCase().replace(/\s+/g, "");
      const prev = byZone.get(key);
      if (!prev || published(z) > published(prev)) byZone.set(key, z);
    }
  }
  return [...byZone.values()];
}
