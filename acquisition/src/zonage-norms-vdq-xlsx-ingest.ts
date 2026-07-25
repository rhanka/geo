/**
 * $0 native-XLSX ingestion of the Ville de Québec "Grille de spécifications du
 * zonage" — the OFFICIAL open-data export (Données Québec, CC-BY):
 *   https://carte.ville.quebec.qc.ca/DonneesOuvertes/vdq-zonage-grille.xlsx
 *
 * WHY this beats every OCR route: the XLSX CELL TEXT *is* the by-law text, so
 * "verbatim-or-null" holds BY CONSTRUCTION and extraction costs $0 (no Mistral,
 * no vision, no recalage). It is the largest single norms deposit in the corpus
 * (~4788 zones / ~39k lots) and it carries a PER-ZONE règlement number, which the
 * deployed schema's `_reglement` column can finally serve for real (immo P0).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HARD PART — anti-column-shift (docs/spec/normes-extraction-retenu.md §6).
 *
 * The sheet repeats each norm in SEVERAL column BANDS: "Hauteur max. (m)" exists
 * at column 214 AND 223; "Marge avant (m)" at 228 AND 236; "Sup. min. (m2)" at
 * 199 AND 205. Reading row 4 alone CANNOT tell them apart (the naive
 * carry-forward of a header label bleeds rightwards across unmerged gaps), and
 * picking one arbitrarily is exactly the §6 failure mode: a plausible but FALSE
 * value. So we do NOT read row 4 alone.
 *
 * RESOLUTION — the band names are recovered from `xl/worksheets/sheet1.xml`'s
 * `<mergeCells>`, which is the sheet's own declaration of its header hierarchy.
 * A merged span states, in the file itself, exactly which columns a label owns:
 *
 *   r1 (section):  cols 199-210 = "NORMES DE LOTISSEMENT"
 *                  cols 211-257 = "BÂTIMENT PRINCIPAL"
 *   r2 (band):     cols 199-203 = "Dimensions générales"
 *                  cols 204-209 = "Dimensions particulières"
 *                  cols 211-218 = "Dimension du bâtiment principal – Dimensions générales"
 *                  cols 219-227 = "Dimension du bâtiment principal – Dimensions particulières"
 *                  cols 228-234 = "Normes d'implantation générales"
 *                  cols 235-242 = "Normes d'implantation particulières"
 *
 * So 214 vs 223 is NOT a coin-flip: 214 is the GÉNÉRALE band, 223 the
 * PARTICULIÈRE one. The `<mergeCells>` prove it; nothing is guessed. The same
 * spans also disambiguate the two different "Largeur min." columns — the LOT's
 * frontage (section "NORMES DE LOTISSEMENT", col 201) from the BUILDING's width
 * (section "BÂTIMENT PRINCIPAL", col 211) — a shift that would silently publish a
 * building width as a lot frontage.
 *
 * WHICH BAND IS THE ZONE'S NORM — measured on the real 4788 rows:
 *   • the GÉNÉRALE band is the zone's UNCONDITIONAL norm;
 *   • the PARTICULIÈRE band is CONDITIONAL — it is qualified by a selector column
 *     ("Groupe + Type + Log.", col 219/235: "H1 Isolé 1 à 2 logements", "A1 Culture
 *     sans élevage") and its cell is frequently MULTI-LINE ("10.5\r\n10.5" — one
 *     line per sub-group). It is a norm for a SUB-GROUP OF USES, not for the zone.
 * Publishing a particulière value as "the zone's norm" would therefore be an
 * INVENTION (it holds only for that use sub-group), and folding the two bands
 * together would be worse still: generale≠particuliere on 1095 rows for the
 * lateral margin alone — a "divergence → null" fold would destroy thousands of
 * perfectly valid général values to describe a disagreement that is not one.
 *
 * PUBLICATION RULE (anti-invention, verbatim-or-null):
 *   1. Collect EVERY band that carries the field (section + header match).
 *   2. Among the bands whose merged label names them GÉNÉRALE:
 *        - exactly one non-empty        → publish it VERBATIM;
 *        - several, all the same value   → publish that value;
 *        - several, DIVERGENT values     → value:null + flag "bandes-divergentes"
 *                                          (never choose);
 *        - none non-empty, but a PARTICULIÈRE band has one
 *                                        → value:null + flag "conditionnel-particulier",
 *                                          the conditional text kept VERBATIM in `raw`
 *                                          (transparent, never served as the zone's norm);
 *        - none at all                   → value:null + flag "absent" (NEVER 0).
 *   3. If NO band is named "générale" (VDQ changes its template), fall back to the
 *      same multi-band rule over ALL bands carrying the field — honest by default.
 *   4. Inside ONE cell, a multi-line value follows the same rule: identical lines
 *      collapse to the value; divergent lines → value:null + flag "multi-valeur".
 *
 * Every published number still goes through the FROZEN `normalizeUnit` (FR comma,
 * unit suffix, "s.o."→null NEVER 0), and `raw` always keeps the verbatim cell.
 *
 * ZONE CODE — the XLSX serves a digit-first "11001Ra" (`<digits><Dominante>`), which
 * `canonZoneCodeServe` reorders to the canonical LETTER-NUMBER served form
 * "Ra-11001"; the canonical overlap with the SIG is 4785/4785 SIG codes
 * (recoupSig=1.0, `extractedNotInSig=["Mb-52122"]`).
 * ⚠️ MEASURED, and contrary to a natural assumption: the SIG layer does NOT already
 * serve the letter-first form — it serves the SAME digit-first form as the XLSX
 * ("21703Mc"). So the EXACT-surface overlap between the two SERVED collections is
 * 0/4786 today. It folds through `canonZone` (so the lot⋈norms join and this
 * deposit's gate are unaffected), but immo joins the served strings EXACTLY, so the
 * SIG layer still needs `zonage-canon-serve-run.ts --slugs quebec` after the OGC
 * publish. Because this ingester derives its code from the SAME shared canon that
 * tool uses, the two will then match byte-for-byte.
 * `usages` is deliberately left EMPTY: the "Dominante" column carries the code
 * letter ("Ra", "Ib"), not a use label — inferring a use from a zone letter is a
 * known, twice-falsified trap.
 *
 * Usage (from the repo root):
 *   npx tsx acquisition/src/zonage-norms-vdq-xlsx-ingest.ts --slug quebec \
 *     --xlsx work/zonage-norms/quebec/vdq-zonage-grille.xlsx \
 *     --source-url https://carte.ville.quebec.qc.ca/DonneesOuvertes/vdq-zonage-grille.xlsx \
 *     --snapshot 2026-07-17 [--dry-run | --deposit [--no-manifest]]
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  normalizeUnit,
  type FieldProvenanceT,
  type NormFieldT,
  type NormUnitT,
  type ZoneNormsT,
} from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { putBytes, s3Client } from "./lib/s3.js";
import { columnIndex, parseSharedStrings, parseSheetRows, unzipEntries } from "./lib/xlsx.js";
import {
  canonZoneCodeServe,
  crossValidateZoneCodes,
  flattenZoneNorms,
  normsKey,
  publishedFieldPct,
  shouldRejectForZeroNormFields,
  shouldRejectForZeroOverlap,
  upsertManifest,
  writeNormsParquet,
  type ManifestEntry,
} from "./lib/zonage-norms.js";

/** Deposit gate: a real grille names at least this many distinct zone codes. */
const MIN_DEPOSIT_ZONE_CODES = 3;

/** Extraction method tag stamped on every field's provenance. */
export const VDQ_METHODE = "native-xlsx/vdq-open-data";

/** 1-based worksheet rows: 1-3 = header hierarchy, 4 = header labels, 5+ = data. */
const HEADER_ROW = 4;
const SECTION_ROW = 1;
const BAND_ROW = 2;

/** Identity columns (0-based), proven by `_probe-vdq-cols.ts`. */
const COL_ZONE = 0;
const COL_REGLEMENT = 1;
const COL_DOMINANTE = 3;

// ───────────────────────────────────────────────────────────────────────────
//  Merged-header resolution — the sheet's own declaration of its hierarchy.
// ───────────────────────────────────────────────────────────────────────────

/** One `<mergeCell ref="A1:B2"/>` span, as 0-based cols and 1-based rows. */
export interface MergeSpan {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

/** Parse `<mergeCells>` out of a worksheet XML (verbatim, no interpretation). */
export function parseMergeSpans(sheetXml: string): MergeSpan[] {
  const out: MergeSpan[] = [];
  for (const m of sheetXml.matchAll(/<mergeCell\s+ref="([A-Z]+\d+):([A-Z]+\d+)"\s*\/>/g)) {
    const c1 = columnIndex(m[1]);
    const c2 = columnIndex(m[2]);
    const r1 = Number((/(\d+)$/.exec(m[1]) ?? [])[1]);
    const r2 = Number((/(\d+)$/.exec(m[2]) ?? [])[1]);
    if (c1 === null || c2 === null || !Number.isFinite(r1) || !Number.isFinite(r2)) continue;
    out.push({ c1, r1, c2, r2 });
  }
  return out;
}

/**
 * Project header row `rowNumber` (1-based) with every MERGED label expanded across
 * the columns its span owns — and NOTHING else. Unlike a carry-forward, a label
 * never bleeds past its declared span, so a column outside any span stays empty
 * rather than inheriting a neighbour's band (the §6 anti-shift guarantee).
 */
export function resolveMergedRow(
  rows: string[][],
  merges: MergeSpan[],
  rowNumber: number,
  width: number,
): string[] {
  const base = rows[rowNumber - 1] ?? [];
  const out: string[] = [];
  for (let i = 0; i < width; i++) out[i] = base[i] ?? "";
  for (const m of merges) {
    if (m.r1 > rowNumber || m.r2 < rowNumber) continue;
    const label = (rows[m.r1 - 1] ?? [])[m.c1] ?? "";
    if (!label) continue;
    for (let i = m.c1; i <= m.c2 && i < width; i++) out[i] = label;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
//  Band roles + the target field map.
// ───────────────────────────────────────────────────────────────────────────

export type BandRole = "generale" | "particuliere" | "inconnu";

/**
 * Classify a merged BAND label into its role. "générale" = the zone's
 * unconditional norm; "particulière" = a norm qualified by a use sub-group
 * selector. Accent/case-insensitive; anything else is honestly "inconnu".
 */
export function bandRole(bandLabel: string): BandRole {
  const s = (bandLabel ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\bgenerale?s?\b/.test(s)) return "generale";
  if (/\bparticuliere?s?\b/.test(s)) return "particuliere";
  return "inconnu";
}

/** A target norm field, located by its SECTION (r1) and its HEADER (r4). */
interface Target {
  field: string;
  section: RegExp;
  header: RegExp;
  unit: NormUnitT;
}

/**
 * The 8 deployed norm fields → their VDQ columns.
 *
 * `section` is what keeps the two homonymous "Largeur min." columns apart (the
 * lot's frontage under "NORMES DE LOTISSEMENT" vs the building's width under
 * "BÂTIMENT PRINCIPAL"). `densite` maps to "POS min. (%)" — the pourcentage
 * d'occupation du sol, which is the land-coverage norm the deployed schema
 * documents as its density proxy (same choice as the Sherbrooke pilot).
 */
const TARGETS: readonly Target[] = [
  { field: "superficie_min", section: /LOTISSEMENT/i, header: /^Sup\.\s*min\.\s*\(m2\)$/i, unit: "m2" },
  { field: "frontage_min", section: /LOTISSEMENT/i, header: /^Largeur\s*min\.\s*\(m\)$/i, unit: "m" },
  { field: "hauteur_min", section: /B[ÂA]TIMENT PRINCIPAL/i, header: /^Hauteur\s*min\.\s*\(m\)$/i, unit: "m" },
  { field: "hauteur_max", section: /B[ÂA]TIMENT PRINCIPAL/i, header: /^Hauteur\s*max\.\s*\(m\)$/i, unit: "m" },
  { field: "marge_avant_min", section: /B[ÂA]TIMENT PRINCIPAL/i, header: /^Marge\s*avant\s*\(m\)$/i, unit: "m" },
  { field: "marge_laterale_min", section: /B[ÂA]TIMENT PRINCIPAL/i, header: /^Marge\s*lat[ée]rale\s*\(m\)$/i, unit: "m" },
  { field: "marge_arriere_min", section: /B[ÂA]TIMENT PRINCIPAL/i, header: /^Marge\s*arri[èe]re\s*\(m\)$/i, unit: "m" },
  { field: "densite", section: /B[ÂA]TIMENT PRINCIPAL/i, header: /^POS\s*min\.\s*\(%\)$/i, unit: "pct" },
] as const;

/** One column that carries a target field, with the band it provably belongs to. */
export interface BandColumn {
  col: number;
  band: string;
  role: BandRole;
}

/** Normalise a header cell for matching (the sheet wraps labels with newlines). */
function headerText(s: string): string {
  return (s ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Locate EVERY column carrying each target field, tagged with its merged band.
 * Returns a map field → columns (in sheet order). A field with no column at all
 * is simply absent from the map — the caller then publishes null/"absent" rather
 * than reaching for a neighbouring column.
 */
export function locateFieldColumns(
  sectionRow: string[],
  bandRow: string[],
  headerRow: string[],
  width: number,
): Map<string, BandColumn[]> {
  const out = new Map<string, BandColumn[]>();
  for (const t of TARGETS) {
    const cols: BandColumn[] = [];
    for (let i = 0; i < width; i++) {
      const h = headerText(headerRow[i] ?? "");
      if (!h || !t.header.test(h)) continue;
      if (!t.section.test(sectionRow[i] ?? "")) continue;
      const band = bandRow[i] ?? "";
      cols.push({ col: i, band, role: bandRole(band) });
    }
    if (cols.length > 0) out.set(t.field, cols);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
//  The publication rule (pure, unit-tested).
// ───────────────────────────────────────────────────────────────────────────

/** One band's verbatim cell for one zone. */
export interface BandCell {
  band: string;
  role: BandRole;
  /** Verbatim cell text (may be empty, may be multi-line). */
  value: string;
  col: number;
}

/** Build a NormField, keeping `raw` verbatim and refusing rather than guessing. */
function refuse(raw: string, unit: NormUnitT, flag: string, prov: FieldProvenanceT): NormFieldT {
  return { value: null, raw, unit, confidence: 0, flag, _provenance: prov };
}

/**
 * Normalise ONE verbatim cell. A cell may hold several LINES (VDQ stacks one line
 * per sub-case); identical lines collapse to the value, divergent lines are a
 * refusal ("multi-valeur") — we never lift the first of several disagreeing norms.
 */
function cellField(raw: string, unit: NormUnitT, prov: FieldProvenanceT): NormFieldT {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const distinct = new Set(lines);
  if (distinct.size > 1) return refuse(raw, unit, "multi-valeur", prov);
  const n = normalizeUnit(lines[0] ?? raw, unit);
  if (n.value === null) {
    return refuse(raw, n.unit, n.absent ? "absent" : "non-numerique", prov);
  }
  return { value: n.value, raw, unit: n.unit, confidence: 1, _provenance: prov };
}

/**
 * Apply the multi-band rule to a set of NON-EMPTY cells that all carry the same
 * field at the same role: one → publish; several identical → publish; several
 * divergent → refuse (never choose a column).
 */
function multiBandRule(nonEmpty: BandCell[], unit: NormUnitT, prov: FieldProvenanceT): NormFieldT {
  const distinct = new Set(nonEmpty.map((c) => c.value.trim()));
  if (distinct.size > 1) {
    const raw = nonEmpty.map((c) => `[${c.band}] ${c.value.trim()}`).join(" | ");
    return refuse(raw, unit, "bandes-divergentes", prov);
  }
  return cellField(nonEmpty[0].value, unit, prov);
}

/**
 * Decide ONE field's value from EVERY band that carries it (pure, unit-tested).
 * See the file header for the full rule. Never returns a fabricated value: the
 * result is either a verbatim-derived number or null + a flag + the raw text.
 */
export function pickFieldValue(
  cells: BandCell[],
  unit: NormUnitT,
  prov: FieldProvenanceT,
): NormFieldT {
  const nonEmpty = cells.filter((c) => c.value.trim().length > 0);
  const generales = cells.filter((c) => c.role === "generale");

  // The band names were resolved → the zone's norm is the UNCONDITIONAL one.
  if (generales.length > 0) {
    const gNonEmpty = generales.filter((c) => c.value.trim().length > 0);
    if (gNonEmpty.length > 0) return multiBandRule(gNonEmpty, unit, prov);
    // No général value. A particulière value exists but is qualified by a use
    // sub-group selector → it is NOT this zone's norm. Keep it verbatim in `raw`
    // for transparency, publish null (anti-invention).
    const pNonEmpty = cells.filter((c) => c.role === "particuliere" && c.value.trim().length > 0);
    if (pNonEmpty.length > 0) {
      const raw = pNonEmpty.map((c) => c.value.replace(/\r?\n/g, " / ").trim()).join(" | ");
      return refuse(raw, unit, "conditionnel-particulier", prov);
    }
    return refuse("", unit, "absent", prov);
  }

  // No band is named "générale" (template changed) → honest multi-band fallback.
  if (nonEmpty.length === 0) return refuse("", unit, "absent", prov);
  return multiBandRule(nonEmpty, unit, prov);
}

// ───────────────────────────────────────────────────────────────────────────
//  Zone code bridge (proven by _probe-vdq-overlap.ts).
// ───────────────────────────────────────────────────────────────────────────

/**
 * "11001Ra" → "Ra-11001" — the XLSX's digit-first `<digits><Dominante>` code in the
 * canonical LETTER-NUMBER SERVED form. Returns null when the cell is not a zone code
 * (header/blank/footer), so a non-code row is skipped rather than invented.
 *
 * ⚠️ The SURFACE FORM is delegated to the shared `canonZoneCodeServe` — the single
 * source of truth — and NOT hand-rolled. MEASURED: the SIG layer currently serves the
 * SAME digit-first form as the XLSX ("21703Mc"), so the exact-surface overlap between
 * the two served collections is 0 until `zonage-canon-serve-run.ts` canonicalises the
 * SIG. That tool uses `canonZoneCodeServe`, which is explicitly NON-re-casing
 * ("11001Ra" → "Ra-11001"). A hand-rolled `.toUpperCase()` ("RA-11001") would look
 * right, pass the canonical overlap gate (canonZone folds case), and STILL fold to 0%
 * at immo — which joins the served strings EXACTLY. Using the shared canon guarantees
 * the deposited code is byte-identical to what the SIG canonicalisation will write.
 */
export function bridgeZoneCode(code: string): string | null {
  const s = (code ?? "").trim();
  if (!/^\d+\s*[A-Za-z]+$/.test(s)) return null;
  return canonZoneCodeServe(s);
}

// ───────────────────────────────────────────────────────────────────────────
//  Build ZoneNorms from the sheet.
// ───────────────────────────────────────────────────────────────────────────

export interface BuildMeta {
  source_url: string;
  snapshot: string;
  methode?: string;
}

export interface BuildResult {
  zones: ZoneNormsT[];
  /** zone_code → the "Dernier règlement ayant modifié la zone" cell (verbatim). */
  reglementByZone: Map<string, string>;
  /** Diagnostics: which columns each field resolved to, with their bands. */
  located: Map<string, BandColumn[]>;
  /** Rows whose first cell is not a zone code (skipped, never invented). */
  skippedRows: number;
}

/**
 * Project the worksheet into ZoneNorms — the deployed 8-field schema — applying
 * the merged-band publication rule to every field of every zone.
 */
export function buildZoneNorms(
  rows: string[][],
  merges: MergeSpan[],
  meta: BuildMeta,
): BuildResult {
  const width = Math.max(0, ...rows.slice(0, HEADER_ROW + 1).map((r) => r.length));
  const sectionRow = resolveMergedRow(rows, merges, SECTION_ROW, width);
  const bandRow = resolveMergedRow(rows, merges, BAND_ROW, width);
  const headerRow = resolveMergedRow(rows, merges, HEADER_ROW, width);
  const located = locateFieldColumns(sectionRow, bandRow, headerRow, width);
  const methode = meta.methode ?? VDQ_METHODE;

  const zones: ZoneNormsT[] = [];
  const reglementByZone = new Map<string, string>();
  let skippedRows = 0;

  for (const row of rows.slice(HEADER_ROW)) {
    const verbatim = (row[COL_ZONE] ?? "").trim();
    const zoneCode = bridgeZoneCode(verbatim);
    if (!zoneCode) {
      if (verbatim) skippedRows++;
      continue;
    }
    // `zone_page` keeps the VERBATIM sheet code (pre-bridge), so a served row can
    // always be traced back to its source cell.
    const prov: FieldProvenanceT = {
      source_url: meta.source_url,
      methode,
      snapshot: meta.snapshot,
      page: verbatim,
    };
    const fieldOf = (name: string): NormFieldT => {
      const target = TARGETS.find((t) => t.field === name)!;
      const cols = located.get(name) ?? [];
      const cells: BandCell[] = cols.map((c) => ({
        band: c.band,
        role: c.role,
        value: row[c.col] ?? "",
        col: c.col,
      }));
      return pickFieldValue(cells, target.unit, prov);
    };

    zones.push({
      zone_code: zoneCode,
      zone_page: verbatim,
      // The "Dominante" column carries the code LETTER ("Ra"), not a use label —
      // inferring a use from a zone letter is a falsified trap, so: no usages.
      usages: [],
      densite: fieldOf("densite"),
      hauteur_min: fieldOf("hauteur_min"),
      hauteur_max: fieldOf("hauteur_max"),
      marges: {
        avant_min: fieldOf("marge_avant_min"),
        laterale_min: fieldOf("marge_laterale_min"),
        arriere_min: fieldOf("marge_arriere_min"),
      },
      frontage_min: fieldOf("frontage_min"),
      superficie_min: fieldOf("superficie_min"),
    });
    const reg = (row[COL_REGLEMENT] ?? "").trim();
    if (reg) reglementByZone.set(zoneCode, reg);
  }

  return { zones, reglementByZone, located, skippedRows };
}

/** Read the workbook's first worksheet as rows + its merge spans. */
export function readVdqSheet(buf: Buffer): { rows: string[][]; merges: MergeSpan[] } {
  const entries = unzipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const ss = byName.get("xl/sharedStrings.xml");
  const shared = ss ? parseSharedStrings(ss.toString("utf8")) : [];
  const sheet = byName.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("xlsx: xl/worksheets/sheet1.xml absent");
  const xml = sheet.toString("utf8");
  return { rows: parseSheetRows(xml, shared), merges: parseMergeSpans(xml) };
}

// ───────────────────────────────────────────────────────────────────────────
//  CLI.
// ───────────────────────────────────────────────────────────────────────────

interface Args {
  slug: string;
  xlsx: string;
  sourceUrl: string;
  snapshot: string;
  dryRun: boolean;
  deposit: boolean;
  noManifest: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const xlsx = get("xlsx");
  if (!xlsx) throw new Error("required: --xlsx <path> [--slug quebec] [--source-url <url>]");
  return {
    slug: get("slug") ?? "quebec",
    xlsx,
    sourceUrl:
      get("source-url") ?? "https://carte.ville.quebec.qc.ca/DonneesOuvertes/vdq-zonage-grille.xlsx",
    snapshot: get("snapshot") ?? new Date().toISOString().slice(0, 10),
    dryRun: argv.includes("--dry-run"),
    deposit: argv.includes("--deposit"),
    noManifest: argv.includes("--no-manifest"),
  };
}

/** Per-field flag census — proves WHY a field is null (a bug vs a real blank). */
function flagCensus(zones: ZoneNormsT[]): Record<string, Record<string, number>> {
  const pick: Record<string, (z: ZoneNormsT) => NormFieldT | null> = {
    densite: (z) => z.densite,
    hauteur_min: (z) => z.hauteur_min,
    hauteur_max: (z) => z.hauteur_max,
    frontage_min: (z) => z.frontage_min,
    superficie_min: (z) => z.superficie_min,
    marge_avant_min: (z) => z.marges.avant_min,
    marge_laterale_min: (z) => z.marges.laterale_min,
    marge_arriere_min: (z) => z.marges.arriere_min,
  };
  const out: Record<string, Record<string, number>> = {};
  for (const [name, get] of Object.entries(pick)) {
    const tally: Record<string, number> = {};
    for (const z of zones) {
      const f = get(z);
      const key = f === null ? "no-field" : f.value !== null ? "published" : (f.flag ?? "null");
      tally[key] = (tally[key] ?? 0) + 1;
    }
    out[name] = tally;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { rows, merges } = readVdqSheet(readFileSync(args.xlsx));
  const { zones, reglementByZone, located, skippedRows } = buildZoneNorms(rows, merges, {
    source_url: args.sourceUrl,
    snapshot: args.snapshot,
  });

  const uniqueZoneCodes = new Set(zones.map((z) => z.zone_code)).size;
  const fieldPct = publishedFieldPct(zones);
  const bands: Record<string, string[]> = {};
  for (const [field, cols] of located) {
    bands[field] = cols.map((c) => `${c.col}:${c.role}`);
  }
  console.error(
    `[vdq] rows=${rows.length} zones=${zones.length} uniqueZoneCodes=${uniqueZoneCodes} ` +
      `skippedRows=${skippedRows} publishedFieldPct=${fieldPct}% reglementByZone=${reglementByZone.size}`,
  );
  console.error(`[vdq] bands: ${JSON.stringify(bands)}`);

  // ── GATES (abort rather than force) ─────────────────────────────────────
  if (uniqueZoneCodes < MIN_DEPOSIT_ZONE_CODES) {
    console.log(
      JSON.stringify({ deposited: false, reason: `below gate: ${uniqueZoneCodes} < ${MIN_DEPOSIT_ZONE_CODES}` }),
    );
    process.exitCode = 1;
    return;
  }
  if (shouldRejectForZeroNormFields(fieldPct)) {
    console.log(
      JSON.stringify({
        deposited: false,
        reason: "0% published norm fields (anti-invention)",
        flags: flagCensus(zones),
      }, null, 2),
    );
    process.exitCode = 1;
    return;
  }

  const s3 = s3Client();
  const crossval = await crossValidateZoneCodes(s3, args.slug, zones);
  console.error(
    `[vdq] crossval gridFound=${crossval.gridFound} sigZoneCodes=${crossval.sigZoneCodes} ` +
      `overlap=${crossval.overlap} recoupExtracted=${crossval.recoupExtracted.toFixed(4)} ` +
      `recoupSig=${crossval.recoupSig.toFixed(4)}`,
  );
  if (shouldRejectForZeroOverlap(crossval)) {
    console.log(
      JSON.stringify({ deposited: false, reason: "overlap=0 vs SIG grille (anti-invention)", crossval }, null, 2),
    );
    process.exitCode = 1;
    return;
  }

  if (args.dryRun || !args.deposit) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          slug: args.slug,
          zones: zones.length,
          uniqueZoneCodes,
          publishedFieldPct: fieldPct,
          crossval,
          bands,
          flags: flagCensus(zones),
          sample: zones.slice(0, 2),
          sampleReglement: [...reglementByZone.entries()].slice(0, 3),
        },
        null,
        2,
      ),
    );
    return;
  }

  // ── DEPOSIT ─────────────────────────────────────────────────────────────
  // Composed from the SHARED helpers so the parquet is byte-compatible with the
  // deployed schema, with ONE difference the schema already allows: `_reglement`
  // is filled PER ZONE (VDQ publishes "Dernier règlement ayant modifié la zone"
  // per row) instead of a single global value — the column is per-row, and immo's
  // P0 asks for exactly this provenance.
  const rowsOut = flattenZoneNorms(zones, {
    source_url: args.sourceUrl,
    methode: VDQ_METHODE,
    snapshot: args.snapshot,
  });
  rowsOut.forEach((r, i) => {
    const reg = reglementByZone.get(zones[i].zone_code);
    r["_reglement"] = reg && reg.length > 0 ? reg : undefined;
  });
  const parquet = await writeNormsParquet(rowsOut);
  const key = normsKey(args.slug);
  await putBytes(s3, key, parquet, "application/octet-stream");

  const entry: ManifestEntry = {
    slug: args.slug,
    key,
    source_url: args.sourceUrl,
    methode: VDQ_METHODE,
    snapshot: args.snapshot,
    zone_rows: zones.length,
    unique_zone_codes: uniqueZoneCodes,
    published_field_pct: fieldPct,
    crossval: {
      gridFound: crossval.gridFound,
      sigZoneCodes: crossval.sigZoneCodes,
      overlap: crossval.overlap,
      recoupExtracted: Math.round(crossval.recoupExtracted * 1000) / 1000,
      recoupSig: Math.round(crossval.recoupSig * 1000) / 1000,
    },
    deposited_at: new Date().toISOString(),
  };
  if (!args.noManifest) await upsertManifest(s3, entry);

  console.log(
    JSON.stringify(
      {
        deposited: true,
        key,
        rows: zones.length,
        uniqueZoneCodes,
        publishedFieldPct: fieldPct,
        bytes: parquet.length,
        reglementRows: rowsOut.filter((r) => r["_reglement"] !== undefined).length,
        manifest: args.noManifest ? "untouched (parquet-only)" : "upserted",
        crossval,
      },
      null,
      2,
    ),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
}
