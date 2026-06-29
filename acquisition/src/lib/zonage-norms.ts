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
import type { S3Client } from "@aws-sdk/client-s3";

import type { ZoneNormsT } from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

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
//  1. Flatten ZoneNorms → the EXACT deployed Sherbrooke parquet schema.
//     40 columns: zone_code, zone_page, usages, then for each of
//     {densite, hauteur_min, hauteur_max, frontage_min, superficie_min,
//      marge_avant_min, marge_laterale_min, marge_arriere_min}:
//     <field>_value (DOUBLE), <field>_raw / _unit (UTF8), <field>_confidence
//     (DOUBLE); then _source_url, _reglement, _methode, _snapshot.
// ───────────────────────────────────────────────────────────────────────────

const NORM_FIELDS = [
  "densite",
  "hauteur_min",
  "hauteur_max",
  "frontage_min",
  "superficie_min",
  "marge_avant_min",
  "marge_laterale_min",
  "marge_arriere_min",
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
  /** Codes present in BOTH (verbatim, after light normalisation). */
  overlap: number;
  /** overlap / extractedZoneCodes ∈ [0,1] — share of extracted codes the SIG confirms. */
  recoupExtracted: number;
  /** overlap / sigZoneCodes ∈ [0,1] — SIG coverage achieved. */
  recoupSig: number;
  /** A few extracted codes the SIG grille does NOT know (diagnostic). */
  extractedNotInSig: string[];
}

/** Light normalisation for code comparison (uppercase, strip spaces/zero-pad). */
function canonZone(code: string): string {
  return code.toUpperCase().replace(/\s+/g, "").replace(/^([A-Z]+)-?0*(\d)/, "$1-$2");
}

/** Pull zone codes from a SIG grille geojson (zone_code / code_zone properties). */
export function sigZoneCodesFromGeojson(geojson: string): Set<string> {
  const set = new Set<string>();
  const re = /"(?:zone_code|code_zone|ZONE|zone|no_zone|NOZONE)"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(geojson)) !== null) {
    const v = m[1]?.trim();
    if (v) set.add(canonZone(v));
  }
  return set;
}

/** Resolve the SIG grille key for a slug, tolerating BOTH layouts the corpus
 *  uses: the flat `qc-zonage-<slug>.geojson` and the subfolder
 *  `qc-zonage-<slug>/qc-zonage-<slug>.geojson` (mirrors coverage-reconcile). */
export async function resolveGridKey(s3: S3Client, slug: string): Promise<string | null> {
  const flat = gridKey(slug);
  if (await exists(s3, flat)) return flat;
  const sub = `${ZONAGE_GRIDS_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  if (await exists(s3, sub)) return sub;
  return null;
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
  } catch {
    gridFound = false;
  }
  let overlap = 0;
  const notInSig: string[] = [];
  for (const c of extractedSet) {
    if (sigSet.has(c)) overlap++;
    else notInSig.push(c);
  }
  return {
    gridFound,
    sigZoneCodes: sigSet.size,
    extractedZoneCodes: extractedSet.size,
    overlap,
    recoupExtracted: extractedSet.size ? overlap / extractedSet.size : 0,
    recoupSig: sigSet.size ? overlap / sigSet.size : 0,
    extractedNotInSig: notInSig.slice(0, 12),
  };
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
