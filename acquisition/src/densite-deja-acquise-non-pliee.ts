/**
 * Read-only audit of density already acquired but not folded on served B'
 * collections.  The served object is the authority for the work universe;
 * the norms manifest is the authority for deposited norms.
 *
 * The script deliberately counts semantic density gains on the served
 * polygons.  It never uses the historical `undefined !== null` diagnostic.
 * It never writes S3.
 *
 * Usage (repo root, in short batches):
 * NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   node --import tsx acquisition/src/densite-deja-acquise-non-pliee.ts \
 *   --out work/coverage/densite-deja-acquise-non-pliee-<UTC>.json \
 *   --report work/coverage/densite-deja-acquise-non-pliee-<UTC>.md --max 15
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { normsKey, ZONAGE_NORMS_MANIFEST_KEY } from "./lib/zonage-norms.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const VIVIER_PATH = resolve(ROOT, "acquisition/config/immo-vivier-b-20260725.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const SERVED_NORMS_PREFIX = "normalized/qc-zonage-norms/";
const LATEST_4A_KEY = "exports/immo/artefact-4a-delta-grille/v1/latest.json";
const LOCAL_EVIDENCE_ROOTS = [
  resolve(ROOT, "work/zonage-norms"),
  resolve(ROOT, "work/zonage-norms-focus"),
  resolve(ROOT, "work/zonage-dicts"),
  resolve(ROOT, "work/dict"),
] as const;
const CACHE_PATHS = [
  resolve(ROOT, "work/coverage/zonage-enrichment.json"),
] as const;

const DENSITY_FIELD = "densite_value";

type EffectState = "known" | "unknown_only" | "absent" | "invalid_only";
type Category = "pliable_maintenant" | "acquise_sans_densite" | "rien_chez_nous";

interface Feature {
  properties?: Record<string, unknown> | null;
}

interface FeatureCollection {
  type?: unknown;
  features?: Feature[];
}

interface ManifestEntry {
  slug: string;
  key: string;
  source_url?: string;
  methode?: string;
  snapshot?: string;
  zone_rows?: number;
  unique_zone_codes?: number;
  published_field_pct?: number;
}

interface Manifest {
  product?: unknown;
  updated_at?: unknown;
  entries: ManifestEntry[];
}

interface LocalEvidence {
  density_values: number;
  files: Array<{ path: string; source_url: string | null; dated: string | null }>;
}

interface CensusRow {
  slug: string;
  served: boolean;
  served_key: string | null;
  served_features: number;
  effect_state: EffectState | null;
  known_effect_features: number;
  explicit_unknown_features: number;
  effect_absent_features: number;
  invalid_effect_features: number;
  folded_density_features: number;
  universe_member: boolean;
  manifest_present: boolean | null;
  manifest_source_url: string | null;
  manifest_snapshot: string | null;
  manifest_methode: string | null;
  manifest_zone_rows: number | null;
  manifest_published_field_pct: number | null;
  parquet_present: boolean | null;
  parquet_rows: number | null;
  parquet_density_rows: number | null;
  served_norms_key: string | null;
  served_norms_rows: number | null;
  served_norms_density_rows: number | null;
  exact_matched_polygons: number | null;
  density_source_polygons: number | null;
  density_gain_polygons: number | null;
  local_density_values: number | null;
  local_density_files: Array<{ path: string; source_url: string | null; dated: string | null }>;
  category: Category | null;
  category_reason: string | null;
}

interface Progress {
  classification_version: 2;
  generated_at: string;
  manifest: { key: string; sha256: string; updated_at: string | null; entries: number };
  artifact_4a: { key: string; sha256: string; generated_at: string | null; coverage: unknown };
  rows: CensusRow[];
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i < 0 ? undefined : argv[i + 1];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmpty(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function canon(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function selectedZonageKeys(slug: string): { flat: string; nested: string } {
  return {
    flat: `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    nested: `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  };
}

function servedNormsKey(slug: string): string {
  return `${SERVED_NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
}

async function readFeatureCollection(
  s3: ReturnType<typeof s3Client>,
  key: string,
): Promise<Feature[]> {
  const parsed = JSON.parse((await getBytes(s3, key)).toString("utf8")) as FeatureCollection;
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error(`${key}: FeatureCollection attendu`);
  }
  return parsed.features;
}

async function readSelectedZonage(
  s3: ReturnType<typeof s3Client>,
  slug: string,
): Promise<{ key: string; features: Feature[] } | null> {
  const keys = selectedZonageKeys(slug);
  const key = await exists(s3, keys.nested)
    ? keys.nested
    : await exists(s3, keys.flat)
      ? keys.flat
      : null;
  return key ? { key, features: await readFeatureCollection(s3, key) } : null;
}

function readManifest(bytes: Buffer): Manifest {
  const parsed = JSON.parse(bytes.toString("utf8")) as Manifest;
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`${ZONAGE_NORMS_MANIFEST_KEY}: manifeste invalide`);
  }
  return parsed;
}

function emptyRow(slug: string): CensusRow {
  return {
    slug,
    served: false,
    served_key: null,
    served_features: 0,
    effect_state: null,
    known_effect_features: 0,
    explicit_unknown_features: 0,
    effect_absent_features: 0,
    invalid_effect_features: 0,
    folded_density_features: 0,
    universe_member: false,
    manifest_present: null,
    manifest_source_url: null,
    manifest_snapshot: null,
    manifest_methode: null,
    manifest_zone_rows: null,
    manifest_published_field_pct: null,
    parquet_present: null,
    parquet_rows: null,
    parquet_density_rows: null,
    served_norms_key: null,
    served_norms_rows: null,
    served_norms_density_rows: null,
    exact_matched_polygons: null,
    density_source_polygons: null,
    density_gain_polygons: null,
    local_density_values: null,
    local_density_files: [],
    category: null,
    category_reason: null,
  };
}

function localSourceUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["_source_url", "source_url", "sourceUrl", "url"]) {
    const candidate = nonEmpty(record[key]);
    if (candidate?.startsWith("http://") || candidate?.startsWith("https://")) return candidate;
  }
  return null;
}

function localDate(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["_snapshot", "snapshot", "retrieved_at", "retrievedAt", "date", "dated"]) {
    const candidate = nonEmpty(record[key]);
    if (candidate) return candidate;
  }
  return null;
}

function hasDensityValue(value: unknown): boolean {
  if (finite(value)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return finite((value as Record<string, unknown>)["value"]);
}

function scanDensityValues(value: unknown, state: { count: number; sourceUrl: string | null; dated: string | null }): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) scanDensityValues(item, state);
    return;
  }
  const record = value as Record<string, unknown>;
  state.sourceUrl ??= localSourceUrl(record);
  state.dated ??= localDate(record);
  if (hasDensityValue(record[DENSITY_FIELD]) || hasDensityValue(record["densite"])) state.count++;
  for (const child of Object.values(record)) scanDensityValues(child, state);
}

function localFilesForSlug(slug: string): string[] {
  const files: string[] = [];
  const addTree = (root: string): void => {
    if (!existsSync(root)) return;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = resolve(current, entry.name);
        if (entry.isDirectory()) {
          if (current === root && root.endsWith("work/zonage-norms") && entry.name !== slug) continue;
          stack.push(path);
          continue;
        }
        if (!/\.json(?:l)?$/i.test(entry.name)) continue;
        if (statSync(path).size > 8_000_000) continue;
        if (path.includes(`/${slug}/`) || path.toLowerCase().includes(`/${slug.toLowerCase()}`)) files.push(path);
      }
    }
  };
  for (const root of LOCAL_EVIDENCE_ROOTS) addTree(root);
  return [...new Set(files)].sort();
}

function localEvidence(slug: string): LocalEvidence {
  const files: LocalEvidence["files"] = [];
  let densityValues = 0;
  for (const path of localFilesForSlug(slug)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    const state = { count: 0, sourceUrl: null as string | null, dated: null as string | null };
    scanDensityValues(parsed, state);
    if (state.count === 0) continue;
    densityValues += state.count;
    files.push({ path: path.slice(ROOT.length + 1), source_url: state.sourceUrl, dated: state.dated });
    if (files.length >= 8) break;
  }
  return { density_values: densityValues, files };
}

function classify(row: CensusRow): void {
  if (!row.universe_member) return;
  const densitySource = (row.served_norms_density_rows ?? 0) > 0 || (row.parquet_density_rows ?? 0) > 0;
  const usableDensity = (row.density_gain_polygons ?? 0) > 0 && row.served_norms_key !== null;
  const acquiredNormsWithoutDensity = row.manifest_present === true && (
    (row.parquet_rows ?? 0) > 0 || row.served_norms_rows !== null
  ) && !densitySource;
  if (usableDensity) {
    row.category = "pliable_maintenant";
    row.category_reason = "densite_finie_sourcee_et_gain_de_polygones_reel";
  } else if (acquiredNormsWithoutDensity) {
    row.category = "acquise_sans_densite";
    row.category_reason = "grille_ou_normes_presentes_sans_colonne_densite_finie";
  } else {
    row.category = "rien_chez_nous";
    row.category_reason = densitySource
      ? "densite_trouvee_mais_aucun_polygone_servi_raccordable_ou_grille_servie_absente"
      : row.local_density_values && row.local_density_values > 0
        ? "trace_locale_non_manifestee_non_pliable_sans_depot"
        : "aucune_norme_ou_grille_deposee_identifiee";
  }
}

async function inspectOne(
  s3: ReturnType<typeof s3Client>,
  slug: string,
  manifest: Map<string, ManifestEntry>,
): Promise<CensusRow> {
  const selected = await readSelectedZonage(s3, slug);
  const row = emptyRow(slug);
  if (!selected) return row;
  row.served = true;
  row.served_key = selected.key;
  row.served_features = selected.features.length;
  for (const feature of selected.features) {
    const props = feature.properties ?? {};
    const effect = props["effet_densifiant"];
    if (effect === "densifie" || effect === "reduit" || effect === "stable") row.known_effect_features++;
    else if (effect === "inconnu") row.explicit_unknown_features++;
    else if (Object.hasOwn(props, "effet_densifiant")) row.invalid_effect_features++;
    else row.effect_absent_features++;
    if (finite(props[DENSITY_FIELD])) row.folded_density_features++;
  }
  row.effect_state = row.known_effect_features > 0
    ? "known"
    : row.explicit_unknown_features > 0
      ? "unknown_only"
      : row.invalid_effect_features > 0
        ? "invalid_only"
        : "absent";
  row.universe_member = row.known_effect_features === 0 && row.folded_density_features === 0;
  if (!row.universe_member) return row;

  const entry = manifest.get(slug);
  row.manifest_present = entry !== undefined;
  row.manifest_source_url = entry?.source_url ?? null;
  row.manifest_snapshot = entry?.snapshot ?? null;
  row.manifest_methode = entry?.methode ?? null;
  row.manifest_zone_rows = entry?.zone_rows ?? null;
  row.manifest_published_field_pct = entry?.published_field_pct ?? null;

  const parquet = normsKey(slug);
  row.parquet_present = await exists(s3, parquet);
  if (row.parquet_present) {
    const rows = await readParquetRowsFromBuffer(await getBytes(s3, parquet));
    row.parquet_rows = rows.length;
    row.parquet_density_rows = rows.filter((r) => finite(r[DENSITY_FIELD])).length;
  } else {
    row.parquet_rows = null;
    row.parquet_density_rows = null;
  }

  const normsKeyServed = servedNormsKey(slug);
  if (await exists(s3, normsKeyServed)) {
    const normsFeatures = await readFeatureCollection(s3, normsKeyServed);
    row.served_norms_key = normsKeyServed;
    row.served_norms_rows = normsFeatures.length;
    row.served_norms_density_rows = normsFeatures.filter((feature) => finite(feature.properties?.[DENSITY_FIELD])).length;
    const byCode = new Map<string, Record<string, unknown>>();
    for (const feature of normsFeatures) {
      const props = feature.properties ?? {};
      const code = canon(props["zone_code"]);
      if (code) byCode.set(code, props);
    }
    let matched = 0;
    let sourceDensity = 0;
    let gain = 0;
    for (const feature of selected.features) {
      const props = feature.properties ?? {};
      const norm = byCode.get(canon(props["zone_code"]));
      if (!norm) continue;
      matched++;
      if (!finite(norm[DENSITY_FIELD])) continue;
      sourceDensity++;
      if (!finite(props[DENSITY_FIELD])) gain++;
    }
    row.exact_matched_polygons = matched;
    row.density_source_polygons = sourceDensity;
    row.density_gain_polygons = gain;
  } else {
    row.served_norms_rows = null;
    row.served_norms_density_rows = null;
    row.exact_matched_polygons = null;
    row.density_source_polygons = null;
    row.density_gain_polygons = null;
  }

  const local = localEvidence(slug);
  row.local_density_values = local.density_values;
  row.local_density_files = local.files;
  classify(row);
  return row;
}

function readVivier(): string[] {
  const vivier = JSON.parse(readFileSync(VIVIER_PATH, "utf8")) as { count: number; slugs: string[] };
  if (vivier.count !== vivier.slugs.length) throw new Error("vivier B' incohérent");
  return [...vivier.slugs].sort((a, b) => a.localeCompare(b));
}

function readProgress(path: string): Progress | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Progress>;
  return parsed.classification_version === 2 ? parsed as Progress : null;
}

function writeProgress(path: string, progress: Progress): void {
  progress.rows.sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(path, `${JSON.stringify(progress, null, 2)}\n`);
}

function countCategories(rows: readonly CensusRow[]): Record<Category, number> {
  const counts: Record<Category, number> = { pliable_maintenant: 0, acquise_sans_densite: 0, rien_chez_nous: 0 };
  for (const row of rows) if (row.universe_member && row.category) counts[row.category]++;
  return counts;
}

function renderReport(progress: Progress, vivierCount: number): string {
  const served = progress.rows.filter((row) => row.served);
  const universe = served.filter((row) => row.universe_member).sort((a, b) => a.slug.localeCompare(b.slug));
  const categories = countCategories(progress.rows);
  const lines = [
    "# Densité déjà acquise, non pliée — audit B'",
    "",
    `Mesure S3: ${progress.generated_at}. Vivier B': ${vivierCount}; servies mesurées: ${served.length}; univers sans norme pliée: ${universe.length}.`,
    `Manifeste autoritaire: \`${ZONAGE_NORMS_MANIFEST_KEY}\` (${progress.manifest.entries} entrées, sha256 ${progress.manifest.sha256}, updated_at ${progress.manifest.updated_at ?? "inconnu"}).`,
    `Artefact 4a lu: \`${LATEST_4A_KEY}\` (sha256 ${progress.artifact_4a.sha256}, generated_at ${progress.artifact_4a.generated_at ?? "inconnu"}).`,
    "",
    "## Partition fermée",
    "",
    `- PLIABLE MAINTENANT: ${categories.pliable_maintenant}`,
    `- ACQUISE SANS DENSITE: ${categories.acquise_sans_densite}`,
    `- RIEN CHEZ NOUS: ${categories.rien_chez_nous}`,
    `- Total: ${universe.length}`,
    "",
    "## Univers de travail",
    "",
    ...universe.map((row) => `- \`${row.slug}\` — ${row.category}; servi \`${row.served_key}\`; polygones ${row.served_features}; densité pliée ${row.folded_density_features}; source densité ${row.density_source_polygons ?? 0}; gain réel ${row.density_gain_polygons ?? 0}.`),
    "",
    "## Contrôle",
    "",
    "Le gain réel compte uniquement les polygones servis dont la grille de normes porte une `densite_value` finie et dont l'objet servi n'en porte pas. Les champs absents des deux côtés ne comptent pas.",
    "",
    "Les lignes `rien_chez_nous` regroupent soit l'absence de source, soit une densité attestée dans le parquet/manifeste mais sans grille servie ou sans code servi raccordable; elles ne rendent donc pas le pli immédiat. Aucune norme ni collection servie n'a été écrite par cette sonde.",
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const out = arg(argv, "--out");
  const report = arg(argv, "--report");
  if (!out || !report) throw new Error("required: --out <json> --report <md>");
  const maxRaw = arg(argv, "--max");
  const max = maxRaw === undefined ? Number.POSITIVE_INFINITY : Number(maxRaw);
  if (!Number.isInteger(max) || max < 1) throw new Error(`--max invalide: ${maxRaw}`);

  const s3 = s3Client();
  const manifestBytes = await getBytes(s3, ZONAGE_NORMS_MANIFEST_KEY);
  const manifest = readManifest(manifestBytes);
  const artifactBytes = await getBytes(s3, LATEST_4A_KEY);
  const artifact = JSON.parse(artifactBytes.toString("utf8")) as Record<string, unknown>;
  const progress = readProgress(out) ?? {
    classification_version: 2,
    generated_at: new Date().toISOString(),
    manifest: {
      key: `s3://sentropic-geo/${ZONAGE_NORMS_MANIFEST_KEY}`,
      sha256: sha256(manifestBytes),
      updated_at: nonEmpty(manifest.updated_at),
      entries: manifest.entries.length,
    },
    artifact_4a: {
      key: `s3://sentropic-geo/${LATEST_4A_KEY}`,
      sha256: sha256(artifactBytes),
      generated_at: nonEmpty(artifact["generated_at"]),
      coverage: artifact["coverage"] ?? null,
    },
    rows: [],
  } satisfies Progress;
  const slugs = readVivier();
  const existing = new Map(progress.rows.map((row) => [row.slug, row]));
  const pending = slugs.filter((slug) => !existing.has(slug));
  const batch = pending.slice(0, max);
  const manifestBySlug = new Map(manifest.entries.map((entry) => [entry.slug, entry]));
  for (const [index, slug] of batch.entries()) {
    console.error(`[densite-audit] ${index + 1}/${batch.length} ${slug}`);
    existing.set(slug, await inspectOne(s3, slug, manifestBySlug));
    progress.rows = [...existing.values()];
    writeProgress(out, progress);
  }
  progress.rows = [...existing.values()];
  if (progress.rows.length === slugs.length) {
    const universe = progress.rows.filter((row) => row.universe_member);
    const categories = countCategories(progress.rows);
    if (categories.pliable_maintenant + categories.acquise_sans_densite + categories.rien_chez_nous !== universe.length) {
      throw new Error("partition B' non fermée");
    }
    writeFileSync(report, renderReport(progress, slugs.length));
  }
  writeProgress(out, progress);
  console.log(JSON.stringify({
    out,
    report: progress.rows.length === slugs.length ? report : null,
    read_this_batch: batch.length,
    rows_written: progress.rows.length,
    remaining: pending.length - batch.length,
    served: progress.rows.filter((row) => row.served).length,
    universe: progress.rows.filter((row) => row.universe_member).length,
    categories: countCategories(progress.rows),
  }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
