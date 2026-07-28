/**
 * Shared deposit + cross-validation library for the `qc-zonage-norms-<slug>`
 * product — the SECOND+ production run of the proven règlement→grille→ZoneNorms
 * chain (after the Sherbrooke pilot, `registry/qc-zonage-norms/sherbrooke.parquet`).
 *
 * This module performs ZERO parsing/normalisation of its own. The ZoneNorms it
 * deposits come ONLY from the FROZEN extractors in `@geo/qc-sources`:
 *   - native-text HORIZONTAL grille → `extractGrilleDocument` (frozen parser),
 *   - VERTICAL / image grille        → `extractZonePageFromPdf` (Mistral 2-pass).
 * Anti-invention is inherited WHOLE from those extractors: every field is either
 * a verbatim-derived `value` at/above the publish threshold, or `value:null`
 * + `raw` + `flag`. `null` always beats a fabricated norm.
 *
 * What this module adds:
 *   1. `flattenZoneNorms` — flatten ZoneNorms[] into the EXACT 40-column parquet
 *      schema already deployed for Sherbrooke (cross-validated byte-for-byte
 *      against `registry/qc-zonage-norms/sherbrooke.parquet`).
 *   2. `crossValidateZoneCodes` — confirm the extracted zone_code set recoups the
 *      municipality's SIG grille (`normalized/ca-qc-zonage/qc-zonage-<slug>.geojson`).
 *      A high recoupment is a reliability signal; it NEVER alters a value.
 *   3. `depositZonageNorms` — write the parquet, upload to
 *      `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet`, refresh the
 *      manifest. Idempotent: skips when the product already exists.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

import {
  ZoneNorms,
  type ZoneNormsT,
  type NormFieldT,
  type FieldProvenanceT,
} from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { BUCKET, exists, getBytes, putBytes } from "./s3.js";

/** S3 prefix that holds every `qc-zonage-norms-<slug>.parquet` product. */
export const ZONAGE_NORMS_PREFIX = "registry/qc-zonage-norms/";
/** S3 prefix of the cross-validation SIG grilles (one geojson per muni). */
export const ZONAGE_GRIDS_PREFIX = "normalized/ca-qc-zonage/";
/** The manifest object listing every deposited norms product. */
export const ZONAGE_NORMS_MANIFEST_KEY = `${ZONAGE_NORMS_PREFIX}manifest.json`;

/** Product key for a municipality's norms parquet. */
export function normsKey(slug: string): string {
  return `${ZONAGE_NORMS_PREFIX}qc-zonage-norms-${slug}.parquet`;
}

/** SIG grille (cross-val) key for a municipality. */
export function gridKey(slug: string): string {
  return `${ZONAGE_GRIDS_PREFIX}qc-zonage-${slug}.geojson`;
}

// ───────────────────────────────────────────────────────────────────────────
//  1. Flatten ZoneNorms → the deployed Sherbrooke parquet schema.
//     Base columns: zone_code, zone_page, usages, then for each of
//     {densite, hauteur_min, hauteur_max, frontage_min, superficie_min,
//      marge_avant_min, marge_laterale_min, marge_arriere_min}:
//     <field>_value (DOUBLE), <field>_raw / _unit (UTF8), <field>_confidence
//     (DOUBLE); then _source_url, _reglement, _methode, _snapshot. Four optional
//     density-specific provenance columns preserve the exact NEW source when a
//     density-only document enriches a pre-existing row without falsely
//     re-attributing that row's other norms.
// ───────────────────────────────────────────────────────────────────────────

export const NORM_FIELDS = [
  "densite",
  "hauteur_min",
  "hauteur_max",
  "frontage_min",
  "superficie_min",
  "marge_avant_min",
  "marge_laterale_min",
  "marge_arriere_min",
] as const;

export const DENSITY_PROVENANCE_COLUMNS = [
  "densite_source_url",
  "densite_methode",
  "densite_snapshot",
  "densite_page_source",
  "densite_proof",
  "densite_legal_date",
  "densite_legal_date_evidence",
] as const;

/** Build the parquet schema (matches the deployed Sherbrooke product exactly). */
export function buildNormsSchema(): { schema: ParquetSchema; columns: string[] } {
  const fields: Record<string, { type: string; optional: true; compression: "SNAPPY" }> = {
    zone_code: { type: "UTF8", optional: true, compression: "SNAPPY" },
    zone_page: { type: "UTF8", optional: true, compression: "SNAPPY" },
    usages: { type: "UTF8", optional: true, compression: "SNAPPY" },
  };
  for (const f of NORM_FIELDS) {
    fields[`${f}_value`] = { type: "DOUBLE", optional: true, compression: "SNAPPY" };
    fields[`${f}_raw`] = { type: "UTF8", optional: true, compression: "SNAPPY" };
    fields[`${f}_unit`] = { type: "UTF8", optional: true, compression: "SNAPPY" };
    fields[`${f}_confidence`] = { type: "DOUBLE", optional: true, compression: "SNAPPY" };
  }
  fields["_source_url"] = { type: "UTF8", optional: true, compression: "SNAPPY" };
  fields["_reglement"] = { type: "UTF8", optional: true, compression: "SNAPPY" };
  fields["_methode"] = { type: "UTF8", optional: true, compression: "SNAPPY" };
  fields["_snapshot"] = { type: "UTF8", optional: true, compression: "SNAPPY" };
  for (const column of DENSITY_PROVENANCE_COLUMNS) {
    fields[column] = { type: "UTF8", optional: true, compression: "SNAPPY" };
  }
  const columns = Object.keys(fields);
  return { schema: new ParquetSchema(fields as never), columns };
}

type NormFieldLike =
  | { value: number | null; raw: string; unit: string | null; confidence: number }
  | null;

/**
 * Map one ZoneNorms field group into its 4 flat columns, mirroring the deployed
 * Sherbrooke product exactly: an empty/absent cell stores `undefined` (absent
 * column) for value/raw/unit, but ALWAYS records the honest confidence so an
 * explicit `value:null` field is distinguishable from a missing column.
 */
function flattenField(prefix: string, f: NormFieldLike, row: Record<string, unknown>): void {
  row[`${prefix}_value`] = f && f.value !== null ? f.value : undefined;
  row[`${prefix}_raw`] = f && f.raw ? f.raw : undefined;
  row[`${prefix}_unit`] = f && f.unit ? f.unit : undefined;
  row[`${prefix}_confidence`] = f ? f.confidence : undefined;
}

export interface FlattenMeta {
  source_url: string;
  reglement?: string;
  methode: string;
  snapshot: string;
}

/** Flatten ZoneNorms[] into parquet rows matching the deployed schema. */
export function flattenZoneNorms(
  zones: ZoneNormsT[],
  meta: FlattenMeta,
): Record<string, unknown>[] {
  return zones.map((z) => {
    const row: Record<string, unknown> = {
      zone_code: z.zone_code,
      zone_page: z.zone_page,
      usages: z.usages && z.usages.length > 0 ? z.usages.join("; ") : undefined,
    };
    flattenField("densite", z.densite as NormFieldLike, row);
    flattenField("hauteur_min", z.hauteur_min as NormFieldLike, row);
    flattenField("hauteur_max", z.hauteur_max as NormFieldLike, row);
    flattenField("frontage_min", z.frontage_min as NormFieldLike, row);
    flattenField("superficie_min", z.superficie_min as NormFieldLike, row);
    flattenField("marge_avant_min", z.marges.avant_min as NormFieldLike, row);
    flattenField("marge_laterale_min", z.marges.laterale_min as NormFieldLike, row);
    flattenField("marge_arriere_min", z.marges.arriere_min as NormFieldLike, row);
    row["_source_url"] = meta.source_url;
    row["_reglement"] = meta.reglement ?? undefined;
    row["_methode"] = meta.methode;
    row["_snapshot"] = meta.snapshot;
    return row;
  });
}

/** Write parquet rows to a local file and return its bytes. */
export async function writeNormsParquet(
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  const { schema, columns } = buildNormsSchema();
  const dir = await mkdtemp(join(tmpdir(), "qc-zonage-norms-"));
  const path = join(dir, "out.parquet");
  try {
    const writer = await ParquetWriter.openFile(schema, path);
    for (const r of rows) {
      const out: Record<string, unknown> = {};
      for (const c of columns) {
        const v = r[c];
        out[c] = v === null || v === undefined ? undefined : v;
      }
      await writer.appendRow(out);
    }
    await writer.close();
    return await readFile(path);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  2. Cross-validation against the municipality's SIG grille (read-only).
// ───────────────────────────────────────────────────────────────────────────

export interface CrossValResult {
  /** SIG grille was found on S3. */
  gridFound: boolean;
  /** Distinct zone codes the SIG grille declares. */
  sigZoneCodes: number;
  /** Distinct zone codes the extraction produced. */
  extractedZoneCodes: number;
  /** Codes present in BOTH — exact canonical match PLUS numeric-identifier bridge. */
  overlap: number;
  /** Extracted codes confirmed by the SIG grille via the numeric-identifier bridge
   *  ALONE (letter prefix differs, same unique zone NUMBER). Subset of `overlap`,
   *  disjoint from the exact-canonical matches (which are `overlap − numericBridged`). */
  numericBridged: number;
  /** overlap / extractedZoneCodes ∈ [0,1] — share of extracted codes the SIG confirms. */
  recoupExtracted: number;
  /** overlap / sigZoneCodes ∈ [0,1] — SIG coverage achieved. */
  recoupSig: number;
  /** A few extracted codes the SIG grille does NOT know (diagnostic). */
  extractedNotInSig: string[];
}

/**
 * Canonical zone-code key used by the deposit OVERLAP GATE (cross-validation of the
 * extracted grille codes against the SIG grille).
 *
 * SINGLE SOURCE OF TRUTH — this delegates verbatim to the runtime join lib's
 * `canonicalizeZoneCodeForJoin` (`packages/geo/src/zonage/lotZoneJoin.ts`), so the
 * overlap the gate REPORTS is, by construction, exactly the overlap the lot⋈norms
 * JOIN REALIZES — the two can never drift. All the format folds (and their
 * anti-fusion guarantees) are documented there; in brief:
 *   • letter-first `HA-020`/`HA20`/`H 1` and digit-first `20HA`/`"20 Ha"` collapse
 *     order-invariantly to one `HA-20`/`H-1` key (the Matapédia/Mitis famille);
 *   • a trailing presentational `(…)` arrondissement label is dropped (Longueuil
 *     `A12-024 (STH)` ≡ `A12-024`);
 *   • two codes collapse IFF same letters AND same numeric value, so distinct codes
 *     never fuse: `H-1` ≠ `H-10`, `20HA` ≠ `20HB`, `A12-024` ≠ `A12-025 (STH)`,
 *     `H-531-F` ≠ `H-531-G`.
 * The vintage/millésime reconciliation of a code whose NUMBER is preserved but whose
 * LETTER prefix changed is deliberately NOT folded here (it would need the
 * cross-corpus double-uniqueness guarantee); it lives in `reconcileZoneNumbers` /
 * `overlapWithNumericBridge` below, which the gate composes on top of this canon.
 */
export function canonZone(code: string): string {
  // SINGLE SOURCE OF TRUTH — delegate verbatim to the join lib's
  // `canonicalizeZoneCodeForJoin` so the deposit OVERLAP GATE and the runtime
  // lot⋈norms JOIN can NEVER drift apart (same folds, same anti-fusion, same
  // unicode-dash/annotation handling). Any format-reconciliation change is made
  // ONCE, in `canonicalizeZoneCodeForJoin`, and both sides inherit it in lockstep.
  return canonicalizeZoneCodeForJoin(code);
}

/**
 * SERVED display form of a zone code — the ONE canonical ORDER (LETTER-NUMBER,
 * e.g. `R-103`, `ZR-102`, `M-1`, `A-10`) that BOTH served OGC collections
 * (`qc-zonage-<slug>` AND `qc-zonage-norms-<slug>`) must carry so immo's EXACT
 * (passthrough) zone_code join folds the norm onto the lot.
 *
 * MOTIVE — the SIG zonage layer and the norms grille frequently serve the SAME
 * code in DIFFERENT surface forms: digit-first `103-R` vs letter-first `R-103`
 * (champlain), `1M` vs `1-M` (plaisance), letter-SPACE `A 10` vs letter-DASH
 * `A-10` (saint-frederic). The lot⋈norms JOIN reconciles these through the
 * order-INVARIANT `canonZone`, so it matched INTERNALLY — but immo joins the two
 * SERVED strings EXACTLY, so a surface mismatch scored 0% and the norm NEVER
 * folded. This returns ONE deterministic LETTER-NUMBER surface form so the served
 * exact match equals the join's realized match.
 *
 * SCOPE — deliberately MINIMAL and NON-DESTRUCTIVE (unlike `canonZone`, which for
 * JOIN keying also strips leading zeros and rewrites multi-segment boundaries):
 *   • digit-first single code → reordered LETTER-NUMBER (`103-R`→`R-103`, `1M`→`M-1`,
 *     `1-M`→`M-1`) — the digits are kept VERBATIM (a code is reordered, never
 *     renumbered: `020-R`→`R-020`, not `R-20`);
 *   • letter-first SPACE code → single dash (`A 10`→`A-10`, `P 38`→`P-38`,
 *     `CO 22`→`CO-22`), order already correct;
 *   • everything ELSE is returned VERBATIM (only unicode dashes normalised): an
 *     already letter-first code (`R-103`, `HDB-924`, `IDC-32-2`, `C88b`), a
 *     letterless numeric code (`74`), a purely alphabetic code (`URB`) — never
 *     reordered, never zero-stripped, never re-cased, never given a new boundary.
 *
 * GUARANTEES — idempotent (`f(f(x)) === f(x)`), deterministic, and it NEVER blanks
 * a real value (null/blank → `""`). Its ORDER agrees with `canonZone`
 * (`canonZone(canonZoneCodeServe(x)) === canonZone(x)`), so a geojson rewritten to
 * this form still folds through the join unchanged — the serve form and the join
 * key cannot disagree on which zone a code is.
 */
export function canonZoneCodeServe(code: string | null | undefined): string {
  if (code === null || code === undefined) return "";
  const s = String(code).trim();
  if (!s) return "";
  // Normalise unicode dashes so the surface separator is uniform ASCII
  // (same range as `normalizeZoneCode`).
  const t = s.replace(/[‐-―−]/g, "-");
  // Digit-first single code (one digit run, then one letter run, optional single
  // separator): 103-R → R-103, 1M → M-1, "1 M" → M-1. Digits kept verbatim.
  const digitFirst = /^(\d+)[-\s]?([A-Za-z]+)$/.exec(t);
  if (digitFirst) return `${digitFirst[2]}-${digitFirst[1]}`;
  // Letter-first with a SPACE separator: A 10 → A-10, CO 22 → CO-22. Order already
  // LETTER-NUMBER; only the space collapses to the canonical single dash. The tail
  // after the space is kept verbatim (`A 10-2` → `A-10-2`).
  const letterSpace = /^([A-Za-z]+)\s+(\d.*)$/.exec(t);
  if (letterSpace) return `${letterSpace[1]}-${letterSpace[2]}`;
  // Already letter-first (with/without dash), multi-segment, letterless, or alpha —
  // return VERBATIM (unicode-dash-normalised). Idempotent; never invents a boundary.
  return t;
}

/**
 * Curated whitelist of SIG property names that carry a real ZONE CODE.
 *
 * ANTI-INVENTION GUARANTEE — this list holds ONLY genuine zone-code fields. It
 * deliberately EXCLUDES every affectation / usage / vocation / catégorie /
 * description field (`Affectation`, `Usages`, `Vocation`, `Categorie`,
 * `Description`, `milieu`, `usage`…). Matching those would let an MRC
 * schéma-d'aménagement AFFECTATION layer — or a garbage OCR run — masquerade as a
 * municipal grille and pass the overlap gate. The generic bare `CODE` is also
 * excluded on purpose (too ambiguous: permit/affectation codes share the name).
 *
 * Mirrors the runtime join fallback list (`lot-zone-join-run.zoneCodeOf`) and the
 * report list (`zone-codes-report.ZONE_CODE_KEYS`), plus the `Zonage`/`ZONAGE`
 * municipal-grille variants the previous streaming regex silently MISSED — the
 * cause of legitimate zoneheader extractions being false-rejected at overlap=0
 * when their SIG grille stored codes under `Zonage` rather than `zone_code`.
 */
export const SIG_ZONE_CODE_FIELDS = [
  "zone_code",
  "code_zone",
  "ZONE_CODE",
  "CODE_ZONE",
  "Code_Zone",
  "Zonage",
  "ZONAGE",
  "zonage",
  "NO_ZONAGE",
  "no_zonage",
  "no_zone",
  "NO_ZONE",
  "NOZONE",
  "NOZONAGE",
  "ZONE",
  "Zone",
  "zone",
  "NUM_ZONE",
  "num_zone",
  "NumZone",
  "zone_no",
  "ZONE_NO",
  "zone_num",
  "ZONE_NUM",
  "ZONE_ID",
  "zone_id",
  "Zonage_ID",
  "ID_ZONE",
  "NUMZONE",
  "ZONAGEMUNICIPALID",
] as const;

/**
 * Is a value plausibly a zone code (vs a GUID / a prose description)? DELIBERATELY
 * LENIENT — it must accept the full diversity of real codes (`H-4`, `RA-415-1`,
 * `A12-024 (STH)` with a secteur annotation, `20 Ha`, `URB`) and reject ONLY the
 * obvious non-codes so a whitelisted `zone_id` GUID column or a stray description
 * column is not folded into the SIG code set. It is NEVER used to drop a value
 * from a column that is otherwise a real code column.
 */
function plausibleCode(value: string): boolean {
  const s = value.trim();
  if (s.length === 0 || s.length > 24) return false; // long string ⇒ description / GUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false; // GUID
  const core = s.replace(/\s*\([^)]*\)\s*$/, "").trim(); // drop a trailing "(STH)" annotation
  if (core.split(/\s+/).length > 3) return false; // a phrase ⇒ prose, never a code
  return /[A-Za-z0-9]/.test(core);
}

/**
 * Structured extraction: JSON-parse the geojson and UNION the canonical codes of
 * every WHITELISTED field that is a genuine CODE COLUMN (majority of its distinct
 * values are plausible codes). Unioning code columns — rather than picking one —
 * never zeroes a real column (an annotated `A12-024 (STH)` grille reads fine) and
 * never drops the real codes when a sequential-index column coexists, while the
 * majority-code test keeps a GUID/description column out. The field-NAME whitelist
 * (no affectation/usage/vocation field) remains the anti-invention guard. Returns
 * null when the input is not parseable geojson so the caller can fall back to the
 * streaming regex.
 */
function zoneCodesByCodeColumns(geojson: string, canon: (v: string) => string): Set<string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return null;
  }
  const features = (parsed as { features?: unknown })?.features;
  if (!Array.isArray(features)) return null;
  const byField = new Map<string, Set<string>>();
  for (const f of features) {
    const props = (f as { properties?: Record<string, unknown> | null })?.properties ?? {};
    for (const name of SIG_ZONE_CODE_FIELDS) {
      const v = props[name];
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s) continue;
      let vals = byField.get(name);
      if (!vals) {
        vals = new Set<string>();
        byField.set(name, vals);
      }
      vals.add(s);
    }
  }
  const out = new Set<string>();
  for (const values of byField.values()) {
    let plausible = 0;
    for (const v of values) if (plausibleCode(v)) plausible++;
    // Only a CODE column contributes — a GUID/description column (majority not
    // plausible) is skipped so it cannot pollute the SIG code set.
    if (plausible * 2 < values.size) continue;
    for (const v of values) {
      const c = canon(v);
      if (c) out.add(c);
    }
  }
  return out;
}

/** Streaming-regex fallback over the SAME whitelist (malformed / non-standard JSON). */
function zoneCodesByRegex(geojson: string, canon: (v: string) => string): Set<string> {
  const set = new Set<string>();
  const names = SIG_ZONE_CODE_FIELDS.join("|");
  const re = new RegExp(`"(?:${names})"\\s*:\\s*"([^"]+)"`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(geojson)) !== null) {
    const v = m[1]?.trim();
    if (v) {
      const c = canon(v);
      if (c) set.add(c);
    }
  }
  return set;
}

/**
 * Pull the distinct CANONICAL zone codes a SIG grille geojson declares.
 *
 * Reads the code from a CURATED whitelist of real zone-code property names
 * (`SIG_ZONE_CODE_FIELDS`) — widened from the previous `zone_code|code_zone|
 * ZONE|zone|no_zone|NOZONE` regex, which silently missed the very common
 * `Zonage`/`ZONAGE` (and `CODE_ZONE`/`NO_ZONAGE`) municipal-grille field names and
 * so returned an empty set, false-rejecting legitimate extractions at overlap=0.
 * Unions the whitelisted CODE columns (skipping a GUID/description column) — the
 * field-NAME whitelist (no affectation/usage/vocation field) is the anti-invention
 * guard, and a union of real zone-code columns cannot false-reject a legit grille.
 */
export function sigZoneCodesFromGeojson(geojson: string): Set<string> {
  const structured = zoneCodesByCodeColumns(geojson, canonZone);
  if (structured !== null) return structured;
  return zoneCodesByRegex(geojson, canonZone);
}

/**
 * RAW served surface forms of the zone codes a geojson declares — the EXACT
 * strings a passthrough OGC consumer (immo) joins on, with NO order/separator
 * reconciliation (only trim). Same whitelisted CODE columns as
 * `sigZoneCodesFromGeojson`, so a raw-vs-canonical overlap comparison is
 * apples-to-apples: the ONLY difference between the two sets is the canonical
 * fold. The order-aware gate uses this to detect a served/fold ORDER-MISMATCH
 * (canonical overlap high but the served strings never match exactly) that the
 * canonical overlap alone would MASK.
 */
export function sigZoneCodesFromGeojsonRaw(geojson: string): Set<string> {
  const identity = (v: string): string => v.trim();
  const structured = zoneCodesByCodeColumns(geojson, identity);
  if (structured !== null) return structured;
  return zoneCodesByRegex(geojson, identity);
}

// ───────────────────────────────────────────────────────────────────────────
//  2b. Numeric-identifier reconciliation (the millésime/vintage bridge).
//
//  MOTIVE — several munis have a fully-extracted, high-field grille whose codes
//  and the SIG grille's codes are the SAME zoning at a DIFFERENT by-law vintage:
//  the numeric zone identifier is identical, only the letter prefix changed
//  (Mont-Tremblant SIG `CV-RF-106` ⇄ grille `RA-106` ⇄ a bare `106`; repentigny
//  vintage prefixes). Exact-canonical overlap is 0 there — a FALSE reject.
//
//  A zone NUMBER identifies exactly one polygon-group per corpus. So when a
//  number is UNIQUE on BOTH sides, its two spellings denote the same zone and we
//  bridge them. When a number is NOT unique on a side (shefford `AF-1`/`M-1`/`R-1`
//  all number 1), the number does NOT identify one zone → we REFUSE to bridge.
//
//  ⚠️ ANTI-FUSION — this operates on the *numeric identifier only*, never the
//  letters, and NEVER collapses two distinct numbers:
//    • different numbers never bridge:  `106` ≠ `1060`, `H-1` ≠ `H-10`.
//    • a multi-number code (`A12-024`, two digit runs) is NEVER eligible — its
//      zone identifier is ambiguous, so it falls to exact/annotation matching.
//    • a number that is non-unique on either side is skipped (never guessed).
//  It only ADDS confirmations the exact match missed; it can never merge two
//  codes that the exact pass kept distinct.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The numeric zone identifier of a code, or null when it has no ONE unambiguous
 * number. Eligible iff the canonical code contains EXACTLY ONE contiguous digit
 * run (any surrounding alpha/dash segments allowed): `RA-106`→"106",
 * `CV-RF-106`→"106", `106`→"106", `H-1`→"1". Ineligible (→null): no digits
 * (`URB`), or ≥2 digit runs (`A12-024`, `H-1-2`) whose zone number is ambiguous.
 * Leading zeros are dropped so `H-01` and `H-1` share the identifier "1", while
 * `H-1` ("1") and `H-10` ("10") stay distinct.
 */
export function zoneNumberKey(code: string): string | null {
  const runs = canonZone(code).match(/\d+/g);
  if (!runs || runs.length !== 1) return null;
  return String(Number(runs[0]));
}

export interface NumericBridge {
  /** Extracted (grille) canonical code that the SIG confirms via its number. */
  extracted: string;
  /** SIG canonical code carrying the same unique zone number. */
  sig: string;
  /** The shared zone number (leading zeros stripped). */
  number: string;
}

/** number → the distinct canonical codes on one side that carry it. */
function indexByNumber(codes: Iterable<string>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const c of codes) {
    const n = zoneNumberKey(c);
    if (n === null) continue;
    let s = m.get(n);
    if (!s) {
      s = new Set<string>();
      m.set(n, s);
    }
    s.add(c);
  }
  return m;
}

/**
 * Bridge extracted↔SIG codes by UNIQUE numeric identifier (pure, unit-testable).
 *
 * Emits one bridge per zone number that is carried by EXACTLY ONE extracted code
 * AND EXACTLY ONE SIG code, when those two codes are not already an exact match.
 * The double-uniqueness is the anti-fusion guarantee: a number shared by ≥2 codes
 * on either side is never bridged (we never pick a winner), and two different
 * numbers can never be brought together.
 */
export function reconcileZoneNumbers(
  extractedCanon: Iterable<string>,
  sigCanon: Iterable<string>,
): NumericBridge[] {
  const sigSet = new Set(sigCanon);
  const eIdx = indexByNumber(extractedCanon);
  const sIdx = indexByNumber(sigSet);
  const bridges: NumericBridge[] = [];
  for (const [num, eCodes] of eIdx) {
    if (eCodes.size !== 1) continue; // number not unique among extracted codes
    const sCodes = sIdx.get(num);
    if (!sCodes || sCodes.size !== 1) continue; // absent / not unique on SIG side
    const e = [...eCodes][0]!;
    const s = [...sCodes][0]!;
    if (e === s || sigSet.has(e)) continue; // already an exact-canonical match
    bridges.push({ extracted: e, sig: s, number: num });
  }
  return bridges;
}

export interface OverlapResult {
  /** exact-canonical matches + numeric bridges. */
  overlap: number;
  /** exact-canonical matches only. */
  exactOverlap: number;
  /** numeric-identifier bridges only (disjoint from exact). */
  numericBridged: number;
  /** the numeric bridges (diagnostic). */
  bridges: NumericBridge[];
  /** extracted codes confirmed by NEITHER exact match NOR numeric bridge. */
  notMatched: string[];
}

/**
 * Combine exact-canonical overlap with the numeric-identifier bridge (pure).
 * A bridged extracted code counts ONCE toward overlap and is disjoint from the
 * exact matches (a bridge is only emitted for a code NOT in the SIG set).
 */
export function overlapWithNumericBridge(
  extractedCanon: Set<string>,
  sigCanon: Set<string>,
): OverlapResult {
  const bridges = reconcileZoneNumbers(extractedCanon, sigCanon);
  const bridged = new Set(bridges.map((b) => b.extracted));
  let exactOverlap = 0;
  const notMatched: string[] = [];
  for (const c of extractedCanon) {
    if (sigCanon.has(c)) exactOverlap++;
    else if (!bridged.has(c)) notMatched.push(c);
  }
  return {
    overlap: exactOverlap + bridged.size,
    exactOverlap,
    numericBridged: bridged.size,
    bridges,
    notMatched,
  };
}

/** Resolve the SIG grille key for a slug, tolerating BOTH layouts the corpus
 *  uses: the flat `qc-zonage-<slug>.geojson` and the subfolder
 *  `qc-zonage-<slug>/qc-zonage-<slug>.geojson` (mirrors coverage-reconcile). */
export async function resolveGridKey(s3: S3Client, slug: string): Promise<string | null> {
  const flat = gridKey(slug);
  if (await headExistsStrict(s3, flat)) return flat;
  const sub = `${ZONAGE_GRIDS_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  if (await headExistsStrict(s3, sub)) return sub;
  return null;
}

async function headExistsStrict(s3: S3Client, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (e) {
    const err = e as {
      name?: string;
      Code?: string;
      code?: string;
      $metadata?: { httpStatusCode?: number };
    };
    const status = err.$metadata?.httpStatusCode;
    if (status === 404 || err.name === "NotFound" || err.Code === "NoSuchKey") return false;
    throw e;
  }
}

/** Cross-validate the extracted zone codes against the muni's SIG grille. */
export async function crossValidateZoneCodes(
  s3: S3Client,
  slug: string,
  extracted: ZoneNormsT[],
): Promise<CrossValResult> {
  const extractedSet = new Set(extracted.map((z) => canonZone(z.zone_code)));
  let gridFound = false;
  let sigSet = new Set<string>();
  try {
    const k = await resolveGridKey(s3, slug);
    if (k) {
      gridFound = true;
      const geojson = (await getBytes(s3, k)).toString("utf8");
      sigSet = sigZoneCodesFromGeojson(geojson);
    }
  } catch (e) {
    if (process.env["ZONAGE_NORMS_DEBUG_CROSSVAL"]) {
      console.error(
        `[crossval] SIG grid read failed for ${slug}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    throw e;
  }
  const { overlap, numericBridged, notMatched } = overlapWithNumericBridge(extractedSet, sigSet);
  return {
    gridFound,
    sigZoneCodes: sigSet.size,
    extractedZoneCodes: extractedSet.size,
    overlap,
    numericBridged,
    recoupExtracted: extractedSet.size ? overlap / extractedSet.size : 0,
    recoupSig: sigSet.size ? overlap / sigSet.size : 0,
    extractedNotInSig: notMatched.slice(0, 12),
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  2c. Category → individual PREFIX-STRICT expansion (gated, non-ambiguous).
//
//  MOTIVE — a category-organised MRC grille (the span-header ALPHA-ONLY family:
//  degelis, saint-louis-du-ha-ha) documents its norms per USAGE CATEGORY
//  (`EAF`, `M`, `RU`), while the SIG/lot layer stores the INDIVIDUAL zone codes
//  (`EAF-15`, `M-1`). The overlap gate therefore sees the category codes match
//  NO SIG individual code → overlap=0 → REJECT, even though the norms are real.
//  This expansion propagates each category's VERBATIM norms onto the individual
//  SIG codes it covers, so every deposited code JOINS a lot and the gate passes.
//
//  ⚠️ STRICT, NON-AMBIGUOUS, NEVER-FABRICATING. A category C covers a SIG code X
//  iff C is EXACTLY the leading alpha family of canon(X) (so `EAF` covers
//  `EAF-15`/`EAF15` but NOT `EAFX-1`, and `M` covers `M-1` but NOT `MD-1`). When
//  C is not the exact family but IS a strict alpha-prefix of it (`M` vs family
//  `MD`, `EA` vs `EAF`), attribution is AMBIGUOUS across families → the SIG code
//  is SKIPPED (never guessed). No value is ever invented: a propagated field is
//  the category field verbatim, its provenance tagged `+category-expanded`.
// ───────────────────────────────────────────────────────────────────────────

/** Provenance marker stamped on every field a category expansion propagated. */
export const CATEGORY_EXPANDED_TAG = "category-expanded";

/** Leading maximal A–Z run of a canonical code ("EAF-15"→"EAF", "104"→""). */
function alphaFamily(canon: string): string {
  const m = /^[A-Z]+/.exec(canon);
  return m ? m[0] : "";
}

/** Tag one field's provenance as category-expanded (verbatim value/raw/unit kept). */
function tagExpandedField(f: NormFieldT | null, page: string): NormFieldT | null {
  if (f === null) return null;
  const provenance: FieldProvenanceT = {
    ...f._provenance,
    methode: f._provenance.methode.includes(CATEGORY_EXPANDED_TAG)
      ? f._provenance.methode
      : `${f._provenance.methode}+${CATEGORY_EXPANDED_TAG}`,
    page,
  };
  return { ...f, _provenance: provenance };
}

/** Relabel a category ZoneNorms onto an individual SIG code (norms copied verbatim). */
function relabelToSigCode(cat: ZoneNormsT, sigCanon: string): ZoneNormsT {
  const page = `${sigCanon} (${CATEGORY_EXPANDED_TAG} from ${cat.zone_code})`;
  return ZoneNorms.parse({
    zone_code: sigCanon,
    zone_page: page,
    usages: [...cat.usages],
    densite: tagExpandedField(cat.densite, page),
    hauteur_min: tagExpandedField(cat.hauteur_min, page),
    hauteur_max: tagExpandedField(cat.hauteur_max, page),
    marges: {
      avant_min: tagExpandedField(cat.marges.avant_min, page),
      laterale_min: tagExpandedField(cat.marges.laterale_min, page),
      arriere_min: tagExpandedField(cat.marges.arriere_min, page),
    },
    frontage_min: tagExpandedField(cat.frontage_min, page),
    superficie_min: tagExpandedField(cat.superficie_min, page),
  });
}

export interface CategoryExpansion {
  /** Individual-code ZoneNorms emitted (one per unambiguously-covered SIG code). */
  expanded: ZoneNormsT[];
  /** SIG codes SKIPPED because a category is only a strict (non-exact) prefix of
   *  their family — ambiguous across families, never guessed. */
  skippedAmbiguous: string[];
  /** Canonical category families that covered ≥1 SIG code. */
  matchedCategories: string[];
  /** Canonical category families that covered NO SIG code (their norms dropped). */
  unmatchedCategories: string[];
}

/**
 * Expand category-level ZoneNorms onto the individual SIG codes each category
 * UNAMBIGUOUSLY covers (pure, unit-testable).
 *
 * Rule (per SIG code X, on canonical forms):
 *   • family = leading alpha run of canon(X); X must carry a dash+digit tail (a
 *     bare alpha code is itself a category, not an individual).
 *   • EXACT match — a grille category equals `family` → propagate its norms to X.
 *   • else if any grille category is a STRICT alpha-prefix of `family` (`M`⊏`MD`,
 *     `EA`⊏`EAF`) → AMBIGUOUS across families → skip X (never guessed).
 *   • else (no category is even a prefix) → X's family is undocumented → ignored.
 * A category is the EXACT family of at most one X-family, so an exact match is
 * unique; the strict-prefix case is the sole ambiguity and is always skipped. No
 * value is fabricated — a propagated field is the category field verbatim.
 */
export function expandCategoryZonesToSig(
  categoryZones: ReadonlyArray<ZoneNormsT>,
  sigCanonCodes: Iterable<string>,
): CategoryExpansion {
  // Index the alpha-ONLY category codes by canonical family (dedupe, first wins).
  // A dash+digit code is an INDIVIDUAL, never a category → excluded from the index.
  const byFamily = new Map<string, ZoneNormsT>();
  const families: string[] = [];
  for (const z of categoryZones) {
    const canon = canonZone(z.zone_code);
    if (!/^[A-Z]+$/.test(canon)) continue;
    if (!byFamily.has(canon)) {
      byFamily.set(canon, z);
      families.push(canon);
    }
  }

  const matched = new Set<string>();
  const expanded: ZoneNormsT[] = [];
  const skippedAmbiguous: string[] = [];
  const seen = new Set<string>();
  for (const raw of sigCanonCodes) {
    const canon = canonZone(raw);
    if (seen.has(canon)) continue;
    seen.add(canon);
    const family = alphaFamily(canon);
    if (!family) continue; // no alpha family → cannot be a category individual
    if (canon.length === family.length) {
      // Bare alpha SIG code: a DIRECT category match (not an expansion) if the
      // grille documents that exact category — deposit it verbatim (no tag).
      const direct = byFamily.get(canon);
      if (direct) {
        expanded.push(direct);
        matched.add(canon);
      }
      continue;
    }
    const exact = byFamily.get(family);
    if (exact) {
      expanded.push(relabelToSigCode(exact, canon));
      matched.add(family);
      continue;
    }
    // No category is the EXACT family. Is any a STRICT alpha-prefix of it? Then
    // attribution is ambiguous across families (M⊏MD, R⊏RA) → skip, never guess.
    if (families.some((c) => family.startsWith(c))) skippedAmbiguous.push(canon);
    // else: undocumented family → silently ignored.
  }

  return {
    expanded,
    skippedAmbiguous,
    matchedCategories: [...matched],
    unmatchedCategories: families.filter((c) => !matched.has(c)),
  };
}

/** Load the CANONICAL zone codes the muni's SIG grille declares (empty when none). */
export async function loadSigCanonCodes(s3: S3Client, slug: string): Promise<Set<string>> {
  const k = await resolveGridKey(s3, slug);
  if (!k) return new Set<string>();
  const geojson = (await getBytes(s3, k)).toString("utf8");
  return sigZoneCodesFromGeojson(geojson);
}

/**
 * Anti-invention rejection rule (pure, unit-testable).
 *
 * REJECT a deposit when a SIG/reglement grille WAS found (`gridFound === true`)
 * yet NONE of the extracted codes match a real grille code (`overlap === 0`).
 * That signature is mis-routed OCR garbage — e.g. the OCR read row LABELS as
 * zone codes (kirkland). There can be ≥3 distinct strings, so the count gate
 * lets them through; only the grille cross-check catches them.
 *
 * It does NOT fire when `gridFound === false`: with no reference grille we cannot
 * cross-validate, so the count gate (`MIN_DEPOSIT_ZONE_CODES`) remains the sole
 * guard and the legitimate "no grille on S3" path is untouched.
 */
export function shouldRejectForZeroOverlap(
  crossval: Pick<CrossValResult, "gridFound" | "sigZoneCodes" | "overlap">,
): boolean {
  // A grid object can exist but expose no usable zone-code field (sigZoneCodes=0).
  // With no reference codes, overlap=0 is non-informative; keep the count/norm-field
  // gates as the guard instead of false-rejecting a native-readable grille.
  return crossval.gridFound === true && crossval.sigZoneCodes > 0 && crossval.overlap === 0;
}

/**
 * Anti-invention rejection rule #2 (pure, unit-testable).
 *
 * REJECT a deposit when NOT A SINGLE norm field carries a value
 * (`publishedFieldPct === 0`). A product with codes but 0% published norms is
 * not a grille — it is OCR of body text / a table-of-contents misread as zone
 * codes (carignan 483-39-U: --auto-grid-page locked onto the ToC, OCR'd the
 * article body, deposited 125 bogus codes with 0% norm fields). A real grille
 * always publishes some hauteur/marges/densité value, so `publishedFieldPct > 0`.
 * General net, independent of `shouldRejectForZeroOverlap` (which needs a
 * reference grille on S3); this one fires even when no grille is on S3.
 */
export function shouldRejectForZeroNormFields(publishedFieldPct: number): boolean {
  return publishedFieldPct === 0;
}

/**
 * Heuristic table-of-contents / sommaire detector (pure, unit-testable).
 *
 * A codified by-law's ToC page is dense with code-shaped tokens (article refs)
 * and page numbers, so `--auto-grid-page` can mistake it for the grille header
 * band and OCR the wrong window (carignan 483-39-U: ToC on p.12 → OCR'd the body
 * → 125 bogus codes, 0% norm fields). This excludes a candidate page when it
 * carries (a) a ToC/sommaire title, (b) ≥2 dotted-leader lines ("Article 3 .... 12"),
 * or (c) a high density of page-renvoi lines (heading text + gap + a trailing page
 * number, with FEW numbers on the line). A real grille page carries VALUES in
 * numeric columns (hauteur/marges/densité) — many numbers per row, no renvois —
 * so it is never excluded.
 */
export function looksLikeTableOfContents(pageText: string): boolean {
  const text = pageText ?? "";
  // (a) Explicit table-of-contents / sommaire title.
  if (/\bTABLE\s+DES\s+MATI[ÈE]RES\b|\bSOMMAIRE\b|\bTABLE\s+OF\s+CONTENTS\b/i.test(text)) {
    return true;
  }
  const lines = text.split(/\r?\n/);
  const dottedLeader = /\.{3,}\s*\d{1,4}\s*$/; // "Hauteur des bâtiments .......... 12"
  // A page-renvoi line: heading text, a gap (≥2 spaces) or dotted leader, then a
  // trailing page number. Guard on FEW numbers (≤3) so a grille VALUE row — which
  // carries many numeric columns — is never counted as a renvoi.
  const renvoi = /[A-Za-zÀ-ÿ].*?(?:\s{2,}|\.{2,})\s*\d{1,4}\s*$/;
  let dotted = 0;
  let renvois = 0;
  let nonEmpty = 0;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    nonEmpty++;
    if (dottedLeader.test(line)) dotted++;
    const nums = (line.match(/\d{1,4}/g) ?? []).length;
    if (nums <= 3 && renvoi.test(line)) renvois++;
  }
  // (b) Several dotted-leader lines.
  if (dotted >= 2) return true;
  // (c) High density of page-renvoi lines.
  if (nonEmpty >= 6 && renvois / nonEmpty >= 0.5) return true;
  return false;
}

// ───────────────────────────────────────────────────────────────────────────
//  3. Deposit (idempotent) + manifest refresh.
// ───────────────────────────────────────────────────────────────────────────

export interface ManifestEntry {
  slug: string;
  key: string;
  reglement?: string;
  source_url: string;
  methode: string;
  snapshot: string;
  zone_rows: number;
  unique_zone_codes: number;
  published_field_pct: number;
  crossval?: {
    gridFound: boolean;
    sigZoneCodes: number;
    overlap: number;
    recoupExtracted: number;
    recoupSig: number;
  };
  deposited_at: string;
}

export interface Manifest {
  product: "qc-zonage-norms";
  updated_at: string;
  entries: ManifestEntry[];
}

/** Share of NON-structural fields that publish a non-null value (8 norm fields). */
export function publishedFieldPct(zones: ZoneNormsT[]): number {
  if (zones.length === 0) return 0;
  let total = 0;
  let published = 0;
  const pick = (z: ZoneNormsT): (NormFieldLike)[] => [
    z.densite as NormFieldLike,
    z.hauteur_min as NormFieldLike,
    z.hauteur_max as NormFieldLike,
    z.frontage_min as NormFieldLike,
    z.superficie_min as NormFieldLike,
    z.marges.avant_min as NormFieldLike,
    z.marges.laterale_min as NormFieldLike,
    z.marges.arriere_min as NormFieldLike,
  ];
  for (const z of zones) {
    for (const f of pick(z)) {
      total++;
      if (f && f.value !== null) published++;
    }
  }
  return total ? Math.round((published / total) * 1000) / 10 : 0;
}

export interface DepositOptions {
  s3: S3Client;
  slug: string;
  zones: ZoneNormsT[];
  meta: FlattenMeta;
  crossval?: CrossValResult;
  /** When false, re-deposit even if the product exists. Default true. */
  idempotent?: boolean;
  now?: () => Date;
}

export interface DepositResult {
  skipped: boolean;
  key: string;
  rows: number;
  uniqueZoneCodes: number;
  publishedFieldPct: number;
  bytes: number;
}

/** Read the current manifest (or an empty one). */
export async function readManifest(s3: S3Client): Promise<Manifest> {
  try {
    if (await exists(s3, ZONAGE_NORMS_MANIFEST_KEY)) {
      const j = JSON.parse((await getBytes(s3, ZONAGE_NORMS_MANIFEST_KEY)).toString("utf8"));
      if (j && Array.isArray(j.entries)) return j as Manifest;
    }
  } catch {
    /* fall through to empty */
  }
  return { product: "qc-zonage-norms", updated_at: new Date().toISOString(), entries: [] };
}

/** Upsert one entry into the manifest and write it back to S3. */
export async function upsertManifest(
  s3: S3Client,
  entry: ManifestEntry,
  now: () => Date = () => new Date(),
): Promise<void> {
  const m = await readManifest(s3);
  const others = m.entries.filter((e) => e.slug !== entry.slug);
  others.push(entry);
  others.sort((a, b) => a.slug.localeCompare(b.slug));
  const updated: Manifest = {
    product: "qc-zonage-norms",
    updated_at: now().toISOString(),
    entries: others,
  };
  await putBytes(
    s3,
    ZONAGE_NORMS_MANIFEST_KEY,
    JSON.stringify(updated, null, 2),
    "application/json",
  );
}

/**
 * MANIFEST-SAFE deposit: write ONLY the `qc-zonage-norms-<slug>.parquet` product
 * to S3 and DO NOT touch the shared manifest. Used by concurrent residue/mass
 * runs that must not race the stock run's manifest writer (read-modify-write
 * without a lock → lost updates). `coverage-reconcile.ts` counts norms from
 * parquet existence, so the coverage counter rises immediately; the manifest is
 * reconciled afterwards from the S3 parquet truth (see zonage-norms-manifest-merge.ts).
 * Returns the entry that a later merge would upsert (also derivable from the parquet).
 */
export async function depositParquetOnly(
  opts: Omit<DepositOptions, "idempotent" | "now"> & { now?: () => Date },
): Promise<{ result: DepositResult; entry: ManifestEntry }> {
  const { s3, slug, zones, meta } = opts;
  const now = opts.now ?? (() => new Date());
  const key = normsKey(slug);
  const rows = flattenZoneNorms(zones, meta);
  const parquet = await writeNormsParquet(rows);
  await putBytes(s3, key, parquet, "application/octet-stream");
  const uniqueZoneCodes = new Set(zones.map((z) => z.zone_code)).size;
  const fieldPct = publishedFieldPct(zones);
  const entry: ManifestEntry = {
    slug,
    key,
    ...(meta.reglement ? { reglement: meta.reglement } : {}),
    source_url: meta.source_url,
    methode: meta.methode,
    snapshot: meta.snapshot,
    zone_rows: zones.length,
    unique_zone_codes: uniqueZoneCodes,
    published_field_pct: fieldPct,
    ...(opts.crossval
      ? {
          crossval: {
            gridFound: opts.crossval.gridFound,
            sigZoneCodes: opts.crossval.sigZoneCodes,
            overlap: opts.crossval.overlap,
            recoupExtracted: Math.round(opts.crossval.recoupExtracted * 1000) / 1000,
            recoupSig: Math.round(opts.crossval.recoupSig * 1000) / 1000,
          },
        }
      : {}),
    deposited_at: now().toISOString(),
  };
  return {
    result: { skipped: false, key, rows: zones.length, uniqueZoneCodes, publishedFieldPct: fieldPct, bytes: parquet.length },
    entry,
  };
}

/**
 * Deposit a municipality's ZoneNorms as `qc-zonage-norms-<slug>.parquet` and
 * refresh the manifest. Idempotent by default (HEAD probe → skip).
 */
export async function depositZonageNorms(opts: DepositOptions): Promise<DepositResult> {
  const { s3, slug, zones, meta } = opts;
  const now = opts.now ?? (() => new Date());
  const key = normsKey(slug);
  const idempotent = opts.idempotent ?? true;

  if (idempotent && (await exists(s3, key))) {
    return {
      skipped: true,
      key,
      rows: 0,
      uniqueZoneCodes: 0,
      publishedFieldPct: 0,
      bytes: 0,
    };
  }

  const rows = flattenZoneNorms(zones, meta);
  const parquet = await writeNormsParquet(rows);
  await putBytes(s3, key, parquet, "application/octet-stream");

  const uniqueZoneCodes = new Set(zones.map((z) => z.zone_code)).size;
  const fieldPct = publishedFieldPct(zones);

  const entry: ManifestEntry = {
    slug,
    key,
    ...(meta.reglement ? { reglement: meta.reglement } : {}),
    source_url: meta.source_url,
    methode: meta.methode,
    snapshot: meta.snapshot,
    zone_rows: zones.length,
    unique_zone_codes: uniqueZoneCodes,
    published_field_pct: fieldPct,
    ...(opts.crossval
      ? {
          crossval: {
            gridFound: opts.crossval.gridFound,
            sigZoneCodes: opts.crossval.sigZoneCodes,
            overlap: opts.crossval.overlap,
            recoupExtracted: Math.round(opts.crossval.recoupExtracted * 1000) / 1000,
            recoupSig: Math.round(opts.crossval.recoupSig * 1000) / 1000,
          },
        }
      : {}),
    deposited_at: now().toISOString(),
  };
  await upsertManifest(s3, entry, now);

  return {
    skipped: false,
    key,
    rows: zones.length,
    uniqueZoneCodes,
    publishedFieldPct: fieldPct,
    bytes: parquet.length,
  };
}
