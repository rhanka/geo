/**
 * immo-bprime-normes-fold-diagnose — classify, from S3 facts, why the B' cities
 * that have no folded density cannot advance the shared norms-folded upstream
 * lever. It never writes S3; its JSON progress is written after every city so
 * an interrupted S3 read resumes without reclassifying completed rows.
 *
 * One process is the sole writer of a given --out file. Parallelism is bounded
 * inside that process; two runners must use distinct progress files.
 *
 * The norms manifest is the authority for whether a grid exists. The parquet is
 * read only to detect a stale manifest entry (manifest-merge adds but does not
 * refresh an overwritten product). The served norms grid and served zonage are
 * then compared with the exact keying used by fold-norms-to-zonage.ts.
 *
 * Usage (repository root):
 * NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   node --import tsx acquisition/src/immo-bprime-normes-fold-diagnose.ts \
 *   --effect-diagnosis /tmp/effet-densifiant-bprime.json \
 *   --out work/coverage/immo-bprime-normes-fold-diagnose.json --max 15
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { exists, getBytes, s3Client } from "./lib/s3.js";
import { normsKey, readManifest, type ManifestEntry } from "./lib/zonage-norms.js";
import type { S3Client } from "@aws-sdk/client-s3";

const ROOT = resolve(import.meta.dirname, "..", "..");
const VIVIER_PATH = resolve(ROOT, "acquisition/config/immo-vivier-b-20260725.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const SERVED_NORMS_PREFIX = "normalized/qc-zonage-norms/";
const NORM_VALUE_FIELDS = [
  "densite_value", "hauteur_min_value", "hauteur_max_value", "frontage_min_value",
  "superficie_min_value", "marge_avant_min_value", "marge_laterale_min_value", "marge_arriere_min_value",
] as const;
const FOLD_FIELDS = [
  "hauteur_min_value", "hauteur_min_unit", "hauteur_max_value", "hauteur_max_unit",
  "densite_value", "densite_unit",
  "marge_avant_min_value", "marge_avant_min_unit",
  "marge_laterale_min_value", "marge_laterale_min_unit",
  "marge_arriere_min_value", "marge_arriere_min_unit",
  "facade_min_value", "facade_min_unit",
  "superficie_min_value", "superficie_min_unit",
] as const;

type Cause =
  | "a_fold_never_ran"
  | "b_manifest_stale"
  | "c_zone_code_no_overlap"
  | "d_no_exploitable_grid"
  | "e_other";
type Detail =
  | "manifest_absent"
  | "manifest_points_to_missing_parquet"
  | "parquet_outside_manifest"
  | "parquet_without_rows"
  | "grid_without_published_values"
  | "served_zonage_absent"
  | "served_norms_grid_absent"
  | "served_norms_grid_without_values"
  | "zone_code_no_exact_overlap"
  | "manifest_metadata_differs_from_parquet"
  | "fold_would_change_served_zonage"
  | "fold_already_matches_grid_without_density"
  | "fold_already_matches_grid_with_density_absent";

interface Feature {
  properties?: Record<string, unknown> | null;
}
interface FeatureCollection {
  type?: unknown;
  features?: Feature[];
}
interface EffectRow {
  slug: string;
  primary_cause?: unknown;
}
interface EffectDiagnosis {
  rows?: EffectRow[];
}
interface CandidateSnapshot {
  rows: Array<{ slug: string; primary_cause: Cause; detail: Detail }>;
}
interface ParquetFacts {
  rows: number;
  unique_zone_codes: number;
  published_field_pct: number;
  source_url: string | null;
  methode: string | null;
  snapshot: string | null;
  has_published_values: boolean;
}
interface DiagnosisRow {
  slug: string;
  primary_cause: Cause;
  detail: Detail;
  manifest_present: boolean;
  parquet_present: boolean;
  served_zonage_key: string | null;
  served_norms_key: string | null;
  zonage_polygones: number;
  norms_rows: number | null;
  norms_unique_zone_codes: number | null;
  norms_published_field_pct: number | null;
  manifest_stale: boolean | null;
  manifest_differences: string[];
  served_norms_rows: number | null;
  served_norms_value_rows: number | null;
  fold_matched_polygones: number | null;
  fold_matched_pct: number | null;
  fold_cells_changed: number | null;
  served_density_features_before: number;
}

function arg(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmpty(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

/** Exact key used by fold-norms-to-zonage.ts; do not substitute the broader lot join canon. */
function foldKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function anyNormValue(properties: Record<string, unknown>): boolean {
  return NORM_VALUE_FIELDS.some((field) => finite(properties[field]));
}

function selectedZonageKeys(slug: string): { flat: string; nested: string } {
  const flat = `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`;
  return { flat, nested: `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` };
}

/** geo-api chooses the nested layout when both exist; diagnose that exact surface. */
async function readServedZonage(s3: S3Client, slug: string): Promise<{ key: string; features: Feature[] } | null> {
  const keys = selectedZonageKeys(slug);
  const key = await exists(s3, keys.nested)
    ? keys.nested
    : await exists(s3, keys.flat)
      ? keys.flat
      : null;
  if (!key) return null;
  const parsed = JSON.parse((await getBytes(s3, key)).toString("utf8")) as FeatureCollection;
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error(`${slug}: FeatureCollection zonage attendu (${key})`);
  }
  return { key, features: parsed.features };
}

async function readServedNorms(s3: S3Client, slug: string): Promise<{ key: string; features: Feature[] } | null> {
  const key = `${SERVED_NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
  if (!(await exists(s3, key))) return null;
  const parsed = JSON.parse((await getBytes(s3, key)).toString("utf8")) as FeatureCollection;
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error(`${slug}: FeatureCollection normes attendu (${key})`);
  }
  return { key, features: parsed.features };
}

function parquetFacts(rows: Record<string, unknown>[]): ParquetFacts {
  const codes = new Set<string>();
  let cells = 0;
  let hasValues = false;
  for (const row of rows) {
    const code = nonEmpty(row["zone_code"]);
    if (code) codes.add(code);
    for (const field of NORM_VALUE_FIELDS) {
      if (!finite(row[field])) continue;
      cells++;
      hasValues = true;
    }
  }
  const first = rows[0] ?? {};
  return {
    rows: rows.length,
    unique_zone_codes: codes.size,
    published_field_pct: rows.length ? Math.round((cells / (rows.length * NORM_VALUE_FIELDS.length)) * 1000) / 10 : 0,
    source_url: nonEmpty(first["_source_url"]),
    methode: nonEmpty(first["_methode"]),
    snapshot: nonEmpty(first["_snapshot"]),
    has_published_values: hasValues,
  };
}

/** The subset that norms-manifest-refresh reconstructs from the live parquet. */
function manifestDifferences(entry: ManifestEntry, facts: ParquetFacts): string[] {
  const differences: string[] = [];
  if (entry.zone_rows !== facts.rows) differences.push("zone_rows");
  if (entry.unique_zone_codes !== facts.unique_zone_codes) differences.push("unique_zone_codes");
  if (entry.published_field_pct !== facts.published_field_pct) differences.push("published_field_pct");
  if ((entry.source_url || null) !== facts.source_url) differences.push("source_url");
  if ((entry.methode || null) !== facts.methode) differences.push("methode");
  if ((entry.snapshot || null) !== facts.snapshot) differences.push("snapshot");
  return differences;
}

function emptyRow(slug: string, primary_cause: Cause, detail: Detail): DiagnosisRow {
  return {
    slug,
    primary_cause,
    detail,
    manifest_present: false,
    parquet_present: false,
    served_zonage_key: null,
    served_norms_key: null,
    zonage_polygones: 0,
    norms_rows: null,
    norms_unique_zone_codes: null,
    norms_published_field_pct: null,
    manifest_stale: null,
    manifest_differences: [],
    served_norms_rows: null,
    served_norms_value_rows: null,
    fold_matched_polygones: null,
    fold_matched_pct: null,
    fold_cells_changed: null,
    served_density_features_before: 0,
  };
}

async function diagnoseOne(s3: S3Client, slug: string, manifest: Map<string, ManifestEntry>): Promise<DiagnosisRow> {
  const entry = manifest.get(slug);
  const parquetKey = normsKey(slug);
  const parquetPresent = await exists(s3, parquetKey);
  if (!entry) {
    const row = emptyRow(slug, parquetPresent ? "e_other" : "d_no_exploitable_grid", parquetPresent ? "parquet_outside_manifest" : "manifest_absent");
    return { ...row, parquet_present: parquetPresent };
  }
  if (!parquetPresent) {
    const row = emptyRow(slug, "e_other", "manifest_points_to_missing_parquet");
    return { ...row, manifest_present: true };
  }

  const facts = parquetFacts(await readParquetRowsFromBuffer(await getBytes(s3, parquetKey)));
  const differences = manifestDifferences(entry, facts);
  const base = {
    manifest_present: true,
    parquet_present: true,
    norms_rows: facts.rows,
    norms_unique_zone_codes: facts.unique_zone_codes,
    norms_published_field_pct: facts.published_field_pct,
    manifest_stale: differences.length > 0,
    manifest_differences: differences,
  };
  if (facts.rows === 0) return { ...emptyRow(slug, "d_no_exploitable_grid", "parquet_without_rows"), ...base };
  if (!facts.has_published_values) return { ...emptyRow(slug, "d_no_exploitable_grid", "grid_without_published_values"), ...base };

  const servedNorms = await readServedNorms(s3, slug);
  if (!servedNorms) return { ...emptyRow(slug, "e_other", "served_norms_grid_absent"), ...base };
  const byCode = new Map<string, Record<string, unknown>>();
  let servedValueRows = 0;
  for (const feature of servedNorms.features) {
    const properties = feature.properties ?? {};
    const key = foldKey(properties["zone_code"]);
    if (!key) continue;
    if (anyNormValue(properties)) servedValueRows++;
    byCode.set(key, properties);
  }
  const servedBase = {
    ...base,
    served_norms_key: servedNorms.key,
    served_norms_rows: servedNorms.features.length,
    served_norms_value_rows: servedValueRows,
  };
  if (servedValueRows === 0) return { ...emptyRow(slug, "e_other", "served_norms_grid_without_values"), ...servedBase };

  // The earlier exits do not need the often-large served zonage body. This keeps
  // diagnosis batches short while retaining the exact served surface for folds.
  const zonage = await readServedZonage(s3, slug);
  if (!zonage) return { ...emptyRow(slug, "e_other", "served_zonage_absent"), ...servedBase };
  const densityBefore = zonage.features.filter((feature) => finite(feature.properties?.["densite_value"])).length;

  let matched = 0;
  let cellsChanged = 0;
  for (const feature of zonage.features) {
    const properties = feature.properties ?? {};
    const norms = byCode.get(foldKey(properties["zone_code"]));
    if (!norms) continue;
    matched++;
    for (const field of FOLD_FIELDS) if (properties[field] !== (norms[field] ?? null)) cellsChanged++;
  }
  const foldBase = {
    ...servedBase,
    served_zonage_key: zonage.key,
    zonage_polygones: zonage.features.length,
    served_density_features_before: densityBefore,
    fold_matched_polygones: matched,
    fold_matched_pct: zonage.features.length ? Math.round((matched / zonage.features.length) * 1000) / 10 : 0,
    fold_cells_changed: cellsChanged,
  };
  if (matched === 0) return { ...emptyRow(slug, "c_zone_code_no_overlap", "zone_code_no_exact_overlap"), ...foldBase };
  if (differences.length > 0) return { ...emptyRow(slug, "b_manifest_stale", "manifest_metadata_differs_from_parquet"), ...foldBase };
  if (cellsChanged > 0) return { ...emptyRow(slug, "a_fold_never_ran", "fold_would_change_served_zonage"), ...foldBase };
  return {
    ...emptyRow(
      slug,
      "e_other",
      densityBefore === 0 ? "fold_already_matches_grid_without_density" : "fold_already_matches_grid_with_density_absent",
    ),
    ...foldBase,
  };
}

function summary(rows: readonly DiagnosisRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.primary_cause] = (counts[row.primary_cause] ?? 0) + 1;
  return counts;
}

function writeProgress(path: string, candidates: number, rows: DiagnosisRow[]): void {
  const sorted = [...rows].sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(path, `${JSON.stringify({ candidates, classified: sorted.length, counts: summary(sorted), rows: sorted }, null, 2)}\n`);
}

function candidateSlugs(path: string, vivier: Set<string>): string[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as EffectDiagnosis | CandidateSnapshot;
  const rows = parsed.rows ?? [];
  const candidates = rows
    .filter((row) => row.primary_cause === "no_norms_folded")
    .map((row) => row.slug)
    .filter((slug): slug is string => typeof slug === "string" && slug.length > 0);
  if (candidates.length === 0) throw new Error(`${path}: aucune ligne primary_cause=no_norms_folded`);
  for (const slug of candidates) if (!vivier.has(slug)) throw new Error(`${slug}: hors vivier B'`);
  return [...new Set(candidates)].sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const out = arg(argv, "--out");
  const effectDiagnosis = arg(argv, "--effect-diagnosis");
  if (!out || !effectDiagnosis) throw new Error("required: --effect-diagnosis <json> --out <json>");
  // Le rétrécissement de `out` ne traverse pas la frontière du worker plus bas :
  // on le fige ici plutôt que de l'assurer à l'appel.
  const outPath: string = out;
  const maxRaw = arg(argv, "--max");
  const concurrencyRaw = arg(argv, "--concurrency") ?? "3";
  const requestedRaw = arg(argv, "--slugs");
  const vivier = JSON.parse(readFileSync(VIVIER_PATH, "utf8")) as { count: number; slugs: string[] };
  if (vivier.count !== vivier.slugs.length) throw new Error("vivier B' incohérent");
  const candidates = candidateSlugs(effectDiagnosis, new Set(vivier.slugs));
  const requested = (requestedRaw ?? "").split(",").map((slug) => slug.trim()).filter(Boolean);
  const scope = requested.length > 0 ? [...new Set(requested)].sort((a, b) => a.localeCompare(b)) : candidates;
  const candidateSet = new Set(candidates);
  for (const slug of scope) if (!candidateSet.has(slug)) throw new Error(`${slug}: absent des 117 sans norme pliée`);
  const existing = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as { rows?: DiagnosisRow[] }).rows ?? [] : [];
  const bySlug = new Map(existing.map((row) => [row.slug, row]));
  const pending = scope.filter((slug) => !bySlug.has(slug));
  const max = maxRaw === undefined ? pending.length : Number(maxRaw);
  if (!Number.isInteger(max) || max < 1) throw new Error(`--max invalide: ${maxRaw}`);
  const concurrency = Number(concurrencyRaw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    throw new Error(`--concurrency invalide (1..12): ${concurrencyRaw}`);
  }
  const batch = pending.slice(0, max);
  const s3 = s3Client();
  const manifest = new Map((await readManifest(s3)).entries.map((entry) => [entry.slug, entry]));
  console.error(`[bprime-normes-fold] manifest=${manifest.size} candidates=${candidates.length} scope=${scope.length} pending=${pending.length} batch=${batch.length}`);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      const slug = batch[index];
      if (!slug) return;
      console.error(`[bprime-normes-fold] ${index + 1}/${batch.length} ${slug}`);
      const row = await diagnoseOne(s3, slug, manifest);
      bySlug.set(slug, row);
      writeProgress(outPath, candidates.length, [...bySlug.values()]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
  console.log(JSON.stringify({ out, candidates: candidates.length, read_this_batch: batch.length, rows_written: bySlug.size, remaining: pending.length - batch.length, counts: summary([...bySlug.values()]) }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
