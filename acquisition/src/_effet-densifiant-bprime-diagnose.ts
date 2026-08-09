/**
 * Read-only, B'-scoped census of the served preconditions for a 4a density
 * delta.  It deliberately classifies facts; it never synthesises an effect or
 * writes a served collection.
 *
 * Usage (repo root):
 * NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   node --import tsx acquisition/src/_effet-densifiant-bprime-diagnose.ts \
 *   --out /tmp/effet-densifiant-bprime.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

import { exists, getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const VIVIER_PATH = resolve(ROOT, "acquisition/config/immo-vivier-b-20260725.json");
const EFFECT_DIR = resolve(ROOT, "work/effet-densifiant");
const PREFIX = "normalized/ca-qc-zonage/";
const IMMO_4A_LATEST = "exports/immo/artefact-4a-delta-grille/v1/latest.json";

type PrimaryCause =
  | "local_two_sided_delta_unfolded"
  | "two_densities_without_millesime"
  | "norms_present_one_density"
  | "no_norms_folded";

interface Feature {
  properties?: Record<string, unknown>;
}

interface Collection {
  type?: unknown;
  features?: Feature[];
}

interface LocalEntry {
  zone_code?: unknown;
  densite_avant?: unknown;
  densite_apres?: unknown;
  effet_densifiant?: unknown;
}

interface Row {
  slug: string;
  key: string | null;
  state: "unserved" | "known" | "unknown_only" | "absent" | "invalid_only";
  primary_cause: PrimaryCause | null;
  features: number;
  norm_density_features: number;
  paired_density_features: number;
  paired_density_without_millesime_features: number;
  local_two_sided_delta: boolean;
  reglement_absent_features: number;
  reglement_ambiguous_features: number;
}

function arg(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function knownEffect(value: unknown): boolean {
  return value === "densifie" || value === "reduit" || value === "stable";
}

function expectedEffect(before: number, after: number): "densifie" | "reduit" | "stable" {
  return after > before ? "densifie" : after < before ? "reduit" : "stable";
}

function localTwoSidedZones(slug: string): Set<string> {
  const path = resolve(EFFECT_DIR, `${slug}.json`);
  if (!existsSync(path)) return new Set();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as LocalEntry[];
  const zones = new Set<string>();
  for (const entry of parsed) {
    if (!nonEmptyString(entry.zone_code) || !finite(entry.densite_avant) || !finite(entry.densite_apres)) continue;
    if (entry.effet_densifiant !== expectedEffect(entry.densite_avant, entry.densite_apres)) continue;
    zones.add(entry.zone_code);
  }
  return zones;
}

function selectedKeys(slug: string): { flat: string; nested: string } {
  const flat = `${PREFIX}qc-zonage-${slug}.geojson`;
  return { flat, nested: `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` };
}

async function readSelected(slug: string): Promise<{ key: string; features: Feature[] } | null> {
  const s3 = s3Client();
  const keys = selectedKeys(slug);
  const key = await exists(s3, keys.nested)
    ? keys.nested
    : await exists(s3, keys.flat)
      ? keys.flat
      : null;
  if (!key) return null;
  const collection = JSON.parse((await getBytes(s3, key)).toString("utf8")) as Collection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error(`${slug}: FeatureCollection attendu (${key})`);
  }
  return { key, features: collection.features };
}

/** Emit liveness only; this never retries or polls S3. */
async function readSelectedWithLiveness(slug: string): Promise<{ key: string; features: Feature[] } | null> {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    console.error(`[4a-bprime-diagnose] ${slug}: lecture S3 en cours (${ticks * 10}s)`);
  }, 10_000);
  try {
    return await readSelected(slug);
  } finally {
    clearInterval(timer);
  }
}

function classify(slug: string, key: string | null, features: readonly Feature[]): Row {
  if (key === null) {
    return {
      slug, key, state: "unserved", primary_cause: null, features: 0,
      norm_density_features: 0, paired_density_features: 0, paired_density_without_millesime_features: 0,
      local_two_sided_delta: false, reglement_absent_features: 0, reglement_ambiguous_features: 0,
    };
  }

  const localZones = localTwoSidedZones(slug);
  const servedZones = new Set<string>();
  let known = 0;
  let unknown = 0;
  let absent = 0;
  let invalid = 0;
  let normDensity = 0;
  let paired = 0;
  let pairedWithoutMillesime = 0;
  let reglementAbsent = 0;
  let reglementAmbiguous = 0;
  for (const feature of features) {
    const p = feature.properties;
    if (!p) { absent++; continue; }
    const zone = nonEmptyString(p["zone_code"]) ? p["zone_code"] : null;
    if (zone) servedZones.add(zone);
    const effect = p["effet_densifiant"];
    if (knownEffect(effect)) known++;
    else if (effect === "inconnu") unknown++;
    else if (Object.hasOwn(p, "effet_densifiant")) invalid++;
    else absent++;

    if (finite(p["densite_value"])) normDensity++;
    const before = p["densite_avant"];
    const after = p["densite_apres"];
    if (finite(before) && finite(after)) {
      paired++;
      if (!nonEmptyString(p["densite_avant_millesime"]) || !nonEmptyString(p["densite_apres_millesime"])) {
        pairedWithoutMillesime++;
      }
    }

    const regulation = p["densite_apres_reglement"] ?? p["reglement_numero"];
    if (!nonEmptyString(regulation)) reglementAbsent++;
    else if (zone && canonicalizeZoneCodeForJoin(regulation) === canonicalizeZoneCodeForJoin(zone)) reglementAmbiguous++;
  }
  const state = known > 0 ? "known"
    : unknown > 0 ? "unknown_only"
      : invalid > 0 ? "invalid_only"
        : "absent";
  const localDelta = [...localZones].some((zone) => servedZones.has(zone));
  const primaryCause: PrimaryCause | null = state === "absent"
    ? localDelta ? "local_two_sided_delta_unfolded"
      : pairedWithoutMillesime > 0 ? "two_densities_without_millesime"
        : normDensity > 0 ? "norms_present_one_density"
          : "no_norms_folded"
    : null;
  return {
    slug, key, state, primary_cause: primaryCause, features: features.length,
    norm_density_features: normDensity, paired_density_features: paired,
    paired_density_without_millesime_features: pairedWithoutMillesime,
    local_two_sided_delta: localDelta, reglement_absent_features: reglementAbsent,
    reglement_ambiguous_features: reglementAmbiguous,
  };
}

function writeProgress(path: string, rows: readonly Row[]): void {
  const states: Record<string, number> = {};
  const causes: Record<string, number> = {};
  for (const row of rows) {
    states[row.state] = (states[row.state] ?? 0) + 1;
    if (row.primary_cause) causes[row.primary_cause] = (causes[row.primary_cause] ?? 0) + 1;
  }
  const acquisitionUniverse = rows
    .filter((row) =>
      row.key !== null &&
      row.state !== "known" &&
      row.norm_density_features === 0
    )
    .map((row) => ({
      slug: row.slug,
      key: row.key,
      features: row.features,
      effect_state: row.state,
    }));
  writeFileSync(path, `${JSON.stringify({
    universe_rule: "B' served, no known effect, zero finite densite_value features",
    acquisition_universe_count: acquisitionUniverse.length,
    acquisition_universe: acquisitionUniverse,
    rows,
    states,
    causes,
  }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--latest-4a")) {
    const artifact = JSON.parse((await getBytes(s3Client(), IMMO_4A_LATEST)).toString("utf8")) as {
      snapshot_id?: unknown;
      generated_at?: unknown;
      coverage?: unknown;
    };
    console.log(JSON.stringify({
      key: IMMO_4A_LATEST,
      snapshot_id: artifact.snapshot_id ?? null,
      generated_at: artifact.generated_at ?? null,
      coverage: artifact.coverage ?? null,
    }, null, 2));
    return;
  }
  const out = arg(argv, "--out");
  if (!out) throw new Error("--out <path> requis (écrit l'avancement après chaque ville)");
  const vivier = JSON.parse(readFileSync(VIVIER_PATH, "utf8")) as { count: number; slugs: string[] };
  if (vivier.count !== vivier.slugs.length) throw new Error("vivier B' incohérent");
  const requested = (arg(argv, "--slugs") ?? "").split(",").map((slug) => slug.trim()).filter(Boolean);
  const skipped = new Set((arg(argv, "--skip") ?? "").split(",").map((slug) => slug.trim()).filter(Boolean));
  const scope = (requested.length === 0 ? vivier.slugs : requested).filter((slug) => !skipped.has(slug));
  for (const slug of scope) if (!vivier.slugs.includes(slug)) throw new Error(`slug hors vivier B': ${slug}`);
  const existing = existsSync(out)
    ? (JSON.parse(readFileSync(out, "utf8")) as { rows?: Row[] }).rows ?? []
    : [];
  const bySlug = new Map(existing.map((row) => [row.slug, row]));
  const pending = scope.filter((slug) => !bySlug.has(slug));
  const maxRaw = arg(argv, "--max");
  const max = maxRaw === undefined ? pending.length : Number(maxRaw);
  if (!Number.isInteger(max) || max < 1) throw new Error(`--max invalide: ${maxRaw}`);
  const batch = pending.slice(0, max);
  for (const [index, slug] of batch.entries()) {
    console.error(`[4a-bprime-diagnose] ${index + 1}/${batch.length} ${slug}`);
    const selected = await readSelectedWithLiveness(slug);
    bySlug.set(slug, classify(slug, selected?.key ?? null, selected?.features ?? []));
    writeProgress(out, [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug)));
  }
  // Re-emit a completed checkpoint as well, so a new report field can be
  // materialised without forcing any S3 object to be read a second time.
  writeProgress(out, [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug)));
  console.log(JSON.stringify({ out, read_this_batch: batch.length, rows_written: bySlug.size, remaining_in_scope: pending.length - batch.length }));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
