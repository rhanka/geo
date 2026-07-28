/**
 * Read-only anatomy probe for the current B' `unknown_only` collections.
 *
 * It re-lists and re-reads served S3 collections, selects the nested layout
 * when both layouts exist, and writes only a local checkpoint requested by
 * --out. It never writes S3 and has no normalized/ write path.
 *
 * Usage (repo root, in short batches):
 * NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   node --import tsx acquisition/src/_effet-unknown-only-38-anatomie.ts \
 *   --out work/coverage/unknown-only-38-anatomie-<UTC>.json --max 10
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  SERVED_ZONAGE_PREFIX,
  selectServedCollections,
  s3Immo4aStore,
  type VivierB,
} from "./lib/immo-4a-delta-grille.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const VIVIER_PATH = resolve(ROOT, "acquisition/config/immo-vivier-b-20260725.json");
const NORMS_MANIFEST_KEY = "registry/qc-zonage-norms/manifest.json";
const LOCAL_NORMS_ROOT = resolve(ROOT, "work/zonage-norms");

interface Feature {
  properties?: Record<string, unknown> | null;
}

interface FeatureCollection {
  type?: unknown;
  features?: Feature[];
}

interface NormsManifestEntry {
  slug?: unknown;
  key?: unknown;
  source_url?: unknown;
  snapshot?: unknown;
  methode?: unknown;
  zone_rows?: unknown;
  published_field_pct?: unknown;
}

interface NormsManifest {
  updated_at?: unknown;
  entries?: NormsManifestEntry[];
}

interface FieldSummary {
  present_features: number;
  non_empty_values: string[];
  finite_number_features: number;
}

interface SourceSummary {
  url: string | null;
  date_verbatim: string | null;
  field: string;
  feature_count: number;
}

interface Row {
  slug: string;
  key: string;
  object_sha256: string;
  feature_count: number;
  effect_unknown_features: number;
  effect_known_features: number;
  effect_absent_features: number;
  zone_codes: string[];
  fields: Record<string, FieldSummary>;
  source_summaries: SourceSummary[];
  norms_manifest: {
    present: boolean;
    key: string | null;
    source_url: string | null;
    snapshot: string | null;
    methode: string | null;
    zone_rows: number | null;
    published_field_pct: number | null;
  };
  local_files: string[];
}

interface Progress {
  schema_version: 1;
  generated_at: string;
  source: {
    vivier_path: string;
    vivier_as_of: string;
    vivier_count: number;
    served_prefix: string;
    norms_manifest_key: string;
    read_only: true;
  };
  measurement: {
    served_collections: number;
    b_prime_served_collections: number;
    b_prime_known_effect: number;
    b_prime_unknown_only: number;
    b_prime_absent: number;
    b_prime_invalid_only: number;
  };
  rows: Row[];
}

function arg(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string" && !finite(value)) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function emptyFieldSummary(): FieldSummary {
  return { present_features: 0, non_empty_values: [], finite_number_features: 0 };
}

const INTERESTING_FIELDS = [
  "zone_code",
  "effet_densifiant",
  "densite_value",
  "densite_avant",
  "densite_apres",
  "densite_avant_millesime",
  "densite_apres_millesime",
  "densite_avant_reglement",
  "densite_apres_reglement",
  "reglement_numero",
  "reglement_millesime",
  "reglement_url",
  "zone_source_url",
  "zone_source_level",
] as const;

function summarizeFields(features: readonly Feature[]): {
  fields: Record<string, FieldSummary>;
  zoneCodes: string[];
  sourceSummaries: SourceSummary[];
  unknown: number;
  known: number;
  absent: number;
} {
  const fields = Object.fromEntries(INTERESTING_FIELDS.map((field) => [field, emptyFieldSummary()])) as Record<string, FieldSummary>;
  const zoneCodes = new Set<string>();
  const sourceCounts = new Map<string, SourceSummary>();
  let unknown = 0;
  let known = 0;
  let absent = 0;

  for (const feature of features) {
    const props = feature.properties;
    if (!props) {
      absent++;
      continue;
    }
    for (const field of INTERESTING_FIELDS) {
      if (!Object.hasOwn(props, field)) continue;
      const summary = fields[field]!;
      summary.present_features++;
      if (finite(props[field])) summary.finite_number_features++;
      const value = nonEmpty(props[field]);
      if (value !== null) summary.non_empty_values.push(value);
    }
    const zone = nonEmpty(props["zone_code"]);
    if (zone !== null) zoneCodes.add(zone);
    const effect = props["effet_densifiant"];
    if (effect === "inconnu") unknown++;
    else if (effect === "densifie" || effect === "reduit" || effect === "stable") known++;
    else absent++;

    for (const field of ["reglement_url", "zone_source_url"] as const) {
      const url = nonEmpty(props[field]);
      if (url === null) continue;
      const date = nonEmpty(props["reglement_millesime"]);
      const key = `${field}|${url}|${date ?? ""}`;
      const previous = sourceCounts.get(key);
      sourceCounts.set(key, {
        field,
        url,
        date_verbatim: date,
        feature_count: (previous?.feature_count ?? 0) + 1,
      });
    }
  }

  for (const summary of Object.values(fields)) {
    summary.non_empty_values = uniqueSorted(summary.non_empty_values);
  }
  return {
    fields,
    zoneCodes: uniqueSorted(zoneCodes),
    sourceSummaries: [...sourceCounts.values()].sort((a, b) =>
      `${a.field}|${a.url}|${a.date_verbatim ?? ""}`.localeCompare(`${b.field}|${b.url}|${b.date_verbatim ?? ""}`)),
    unknown,
    known,
    absent,
  };
}

function localFiles(slug: string): string[] {
  const root = resolve(LOCAL_NORMS_ROOT, slug);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort((a, b) => a.localeCompare(b))) {
      const path = resolve(directory, name);
      const relative = path.slice(root.length + 1);
      if (statSync(path).isDirectory()) visit(path);
      else out.push(relative);
    }
  };
  visit(root);
  return out;
}

function manifestBySlug(value: unknown): Map<string, NormsManifestEntry> {
  const manifest = value as NormsManifest;
  const map = new Map<string, NormsManifestEntry>();
  for (const entry of manifest.entries ?? []) {
    const slug = nonEmpty(entry.slug);
    if (slug !== null) map.set(slug, entry);
  }
  return map;
}

function manifestSummary(entry: NormsManifestEntry | undefined): Row["norms_manifest"] {
  return {
    present: entry !== undefined,
    key: nonEmpty(entry?.key),
    source_url: nonEmpty(entry?.source_url),
    snapshot: nonEmpty(entry?.snapshot),
    methode: nonEmpty(entry?.methode),
    zone_rows: finite(entry?.zone_rows) ? entry.zone_rows : null,
    published_field_pct: finite(entry?.published_field_pct) ? entry.published_field_pct : null,
  };
}

function progressPath(value: string): string {
  return value.startsWith("/") ? value : resolve(ROOT, value);
}

function readProgress(path: string): Progress | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Progress;
  if (parsed.schema_version !== 1 || !Array.isArray(parsed.rows)) throw new Error(`checkpoint invalide: ${path}`);
  return parsed;
}

function writeProgress(path: string, progress: Progress): void {
  progress.rows.sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(path, `${JSON.stringify(progress, null, 2)}\n`);
}

async function readCollection(store: ReturnType<typeof s3Immo4aStore>, key: string): Promise<Buffer> {
  const body = await store.get(key);
  if (body === null) throw new Error(`collection S3 disparue après listing: ${key}`);
  return body;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outArg = arg(argv, "--out");
  if (!outArg) throw new Error("usage: --out <checkpoint.json> [--max 10]");
  const out = progressPath(outArg);
  const maxRaw = arg(argv, "--max");
  const max = maxRaw === undefined ? 10 : Number(maxRaw);
  if (!Number.isInteger(max) || max < 1 || max > 38) throw new Error(`--max invalide: ${maxRaw}`);

  const vivier = JSON.parse(readFileSync(VIVIER_PATH, "utf8")) as VivierB;
  if (vivier.count !== vivier.slugs.length) throw new Error("vivier B' incohérent");
  const store = s3Immo4aStore();
  const selected = selectServedCollections(await store.list(SERVED_ZONAGE_PREFIX));
  const bPrime = new Set(vivier.slugs);
  const bPrimeSelected = selected.filter((entry) => bPrime.has(entry.citySlug));
  const allBodies = new Map<string, Buffer>();
  const states = new Map<string, "known" | "unknown_only" | "absent" | "invalid_only">();
  // The global 871-collection re-measurement is performed by the 4a dry-run.
  // This anatomy pass only needs bodies for the 141 B' collections; the list
  // itself remains S3-derived and the measurement retains the global count.
  for (const [index, entry] of bPrimeSelected.entries()) {
    const body = await readCollection(store, entry.key);
    allBodies.set(entry.citySlug, body);
    const parsed = JSON.parse(body.toString("utf8")) as FeatureCollection;
    if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) throw new Error(`FeatureCollection invalide: ${entry.key}`);
    const summary = summarizeFields(parsed.features);
    const invalid = parsed.features.length - summary.unknown - summary.known - summary.absent;
    const state = summary.known > 0 ? "known" : summary.unknown > 0 ? "unknown_only" : invalid > 0 ? "invalid_only" : "absent";
    states.set(entry.citySlug, state);
    if ((index + 1) % 10 === 0 || index + 1 === bPrimeSelected.length) console.error(`[unknown-only-38] inventaire B' S3 ${index + 1}/${bPrimeSelected.length}`);
  }

  const unknownSlugs = bPrimeSelected.filter((entry) => states.get(entry.citySlug) === "unknown_only").map((entry) => entry.citySlug).sort((a, b) => a.localeCompare(b));
  if (unknownSlugs.length !== 38) throw new Error(`partition B' inattendue: unknown_only=${unknownSlugs.length}, attendu=38`);
  const existing = readProgress(out);
  const rowsBySlug = new Map((existing?.rows ?? []).map((row) => [row.slug, row]));
  const manifestBody = await store.get(NORMS_MANIFEST_KEY);
  if (manifestBody === null) throw new Error(`manifeste S3 absent: ${NORMS_MANIFEST_KEY}`);
  const manifest = JSON.parse(manifestBody.toString("utf8")) as NormsManifest;
  const manifestMap = manifestBySlug(manifest);
  const pending = unknownSlugs.filter((slug) => !rowsBySlug.has(slug));
  const batch = pending.slice(0, max);
  const bySlug = new Map(selected.map((entry) => [entry.citySlug, entry]));
  for (const [index, slug] of batch.entries()) {
    const selectedEntry = bySlug.get(slug);
    const body = allBodies.get(slug);
    if (!selectedEntry || !body) throw new Error(`collection B' introuvable dans le snapshot: ${slug}`);
    const parsed = JSON.parse(body.toString("utf8")) as FeatureCollection;
    if (!Array.isArray(parsed.features)) throw new Error(`features absentes: ${selectedEntry.key}`);
    const summary = summarizeFields(parsed.features);
    rowsBySlug.set(slug, {
      slug,
      key: selectedEntry.key,
      object_sha256: sha256(body),
      feature_count: parsed.features.length,
      effect_unknown_features: summary.unknown,
      effect_known_features: summary.known,
      effect_absent_features: summary.absent,
      zone_codes: summary.zoneCodes,
      fields: summary.fields,
      source_summaries: summary.sourceSummaries,
      norms_manifest: manifestSummary(manifestMap.get(slug)),
      local_files: localFiles(slug),
    });
    const progress: Progress = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      source: {
        vivier_path: "acquisition/config/immo-vivier-b-20260725.json",
        vivier_as_of: vivier.as_of,
        vivier_count: vivier.count,
        served_prefix: `s3://sentropic-geo/${SERVED_ZONAGE_PREFIX}`,
        norms_manifest_key: `s3://sentropic-geo/${NORMS_MANIFEST_KEY}`,
        read_only: true,
      },
      measurement: {
        served_collections: selected.length,
        b_prime_served_collections: bPrimeSelected.length,
        b_prime_known_effect: bPrimeSelected.filter((entry) => states.get(entry.citySlug) === "known").length,
        b_prime_unknown_only: unknownSlugs.length,
        b_prime_absent: bPrimeSelected.filter((entry) => states.get(entry.citySlug) === "absent").length,
        b_prime_invalid_only: bPrimeSelected.filter((entry) => states.get(entry.citySlug) === "invalid_only").length,
      },
      rows: [...rowsBySlug.values()],
    };
    writeProgress(out, progress);
    console.error(`[unknown-only-38] lot ${index + 1}/${batch.length} ${slug}`);
  }
  console.log(JSON.stringify({ out, s3_served_collections: selected.length, unknown_only: unknownSlugs.length, read_this_batch: batch.length, rows_written: rowsBySlug.size, remaining: pending.length - batch.length }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
