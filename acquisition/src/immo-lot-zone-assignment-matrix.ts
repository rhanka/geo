/**
 * Build the dated, closed city partition for the Immo lot-to-zone assignment
 * KPI.  The only S3 reads are the small qc-lots stats sidecars; it never reads
 * lot or zone geometry.  The served geo-api layout is authoritative: when the
 * nested and flat layouts coexist, the nested sidecar is used exclusively.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/immo-lot-zone-assignment-matrix.ts --date 20260802 --max-seconds 55
 *   ... --resume                    # continue the local .cache checkpoint
 *   ... --checkpoint <path>          # choose a different local checkpoint
 *   ... --help
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { getBytes, objectHead, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COVERAGE = resolve(ROOT, "work/coverage/coverage-matrix.json");
const IMMO_FIELDS = resolve(ROOT, "work/immo-field-completion-matrices/immo-field-completion-matrix.json");
const IMMO_LOTS = resolve(ROOT, "work/coverage/immo-lots.json");
const OUT_DIR = resolve(ROOT, "work/coverage");
const CACHE_DIR = resolve(ROOT, ".cache");
const UNIVERSE = 1106;
const BATCH_SIZE = 16;

type State = "complete" | "incomplete" | "unknown" | "N/A";
type MeasuredState = Exclude<State, "N/A">;

interface LotStats {
  slug?: unknown;
  num_lots?: unknown;
  num_with_zone_code?: unknown;
}

interface CityMeasurement {
  slug: string;
  state: State;
  reason: string;
  served_layout: "subdirectory" | "flat" | null;
  served_geojson_key: string | null;
  stats_key: string | null;
  stats_etag: string | null;
  observed_lots: number | null;
  lots_with_code_zone: number | null;
  lots_without_code_zone: number | null;
  code_zone_pct: number | null;
}

interface Progress {
  contract: "immo-lot-zone-assignment-progress/v1";
  as_of_date: string;
  source_sha256: Record<string, string>;
  cities: CityMeasurement[];
}

interface Args {
  date: string;
  maxSeconds: number;
  resume: boolean;
  checkpoint: string;
}

function fail(message: string): never {
  throw new Error(`immo-lot-zone-assignment-matrix: ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readJson(path: string): { text: string; value: unknown } {
  const text = readFileSync(path, "utf8");
  return { text, value: JSON.parse(text) as unknown };
}

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function ascending(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nonNegativeInteger(value: unknown, label: string): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function pct(numerator: number, denominator: number): number {
  return Math.round((10000 * numerator) / denominator) / 100;
}

function dateToday(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function usage(): string {
  return [
    "Usage: npx tsx acquisition/src/immo-lot-zone-assignment-matrix.ts [options]",
    "  --date YYYYMMDD       Date embedded in the immutable output (default: today)",
    "  --max-seconds N       Wall-time cap for this invocation (default: 55)",
    "  --resume              Resume the compatible local checkpoint",
    "  --checkpoint PATH     Local checkpoint path (default: .cache/...)",
    "  --help                Show this help",
    "",
    "Reads only qc-lots stats sidecars, selecting the nested served layout before flat.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Args | null {
  let date = dateToday();
  let maxSeconds = 55;
  let resume = false;
  let checkpoint: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--help") return null;
    if (token === "--resume") {
      resume = true;
      continue;
    }
    const inline = token.match(/^--(date|max-seconds|checkpoint)=(.+)$/u);
    const key = inline?.[1] ?? (token.startsWith("--") ? token.slice(2) : "");
    const value = inline?.[2] ?? argv[++index];
    if (!value || !["date", "max-seconds", "checkpoint"].includes(key)) fail(`unknown or incomplete option ${token}`);
    if (key === "date") date = value;
    else if (key === "max-seconds") maxSeconds = Number(value);
    else checkpoint = value;
  }
  invariant(/^\d{8}$/u.test(date), "--date must be YYYYMMDD");
  invariant(Number.isFinite(maxSeconds) && maxSeconds > 0, "--max-seconds must be a positive number");
  return {
    date,
    maxSeconds,
    resume,
    checkpoint: checkpoint ? resolve(ROOT, checkpoint) : resolve(CACHE_DIR, `immo-lot-zone-assignment-${date}.progress.json`),
  };
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, path);
}

function sources(): {
  universe: string[];
  naSlugs: Set<string>;
  sourceSha256: Record<string, string>;
  sourceMeta: Array<Record<string, unknown>>;
} {
  const coverage = readJson(COVERAGE);
  const fields = readJson(IMMO_FIELDS);
  const lots = readJson(IMMO_LOTS);
  const coverageValue = record(coverage.value, "coverage matrix");
  const cities = record(coverageValue["cities"], "coverage matrix.cities");
  invariant(coverageValue["municipalityCount"] === UNIVERSE, `coverage municipalityCount must be ${UNIVERSE}`);
  const universe = Object.keys(cities).sort(ascending);
  invariant(universe.length === UNIVERSE, `coverage matrix has ${universe.length} cities, expected ${UNIVERSE}`);

  const fieldsValue = record(fields.value, "immo field matrix");
  const fieldCities = fieldsValue["cities"];
  invariant(Array.isArray(fieldCities), "immo field matrix.cities must be an array");
  const naSlugs = new Set<string>();
  for (const raw of fieldCities) {
    const city = record(raw, "immo field city");
    const surface = record(city["surface_m2"], "immo field city.surface_m2");
    if (surface["status"] === "N/A") {
      invariant(typeof city["slug"] === "string", "N/A immo field city has no slug");
      naSlugs.add(city["slug"]);
    }
  }
  invariant(naSlugs.size === 6, `expected exactly six explicit portfolio N/A cities, got ${naSlugs.size}`);
  for (const slug of naSlugs) invariant(universe.includes(slug), `N/A city ${slug} is outside the canonical universe`);

  const lotsValue = record(lots.value, "immo lots snapshot");
  const perMuni = lotsValue["perMuni"];
  invariant(Array.isArray(perMuni), "immo lots perMuni must be an array");
  const zeroSlugs = new Set<string>();
  for (const raw of perMuni) {
    const row = record(raw, "immo lots row");
    if (row["numLots"] === 0 && typeof row["slug"] === "string") zeroSlugs.add(row["slug"]);
  }
  invariant(JSON.stringify([...zeroSlugs].sort(ascending)) === JSON.stringify([...naSlugs].sort(ascending)), "explicit N/A list drifted from zero-lot Immo snapshot");

  const sourceSha256 = {
    "work/coverage/coverage-matrix.json": sha256(coverage.text),
    "work/immo-field-completion-matrices/immo-field-completion-matrix.json": sha256(fields.text),
    "work/coverage/immo-lots.json": sha256(lots.text),
  };
  return {
    universe,
    naSlugs,
    sourceSha256,
    sourceMeta: [
      { role: "canonical_city_universe", path: "work/coverage/coverage-matrix.json", sha256: sourceSha256["work/coverage/coverage-matrix.json"], declaredAsOf: coverageValue["generatedAt"] ?? null },
      { role: "explicit_portfolio_NA_list", path: "work/immo-field-completion-matrices/immo-field-completion-matrix.json", sha256: sourceSha256["work/immo-field-completion-matrices/immo-field-completion-matrix.json"], declaredAsOf: null },
      { role: "zero_lot_NA_crosscheck", path: "work/coverage/immo-lots.json", sha256: sourceSha256["work/coverage/immo-lots.json"], declaredAsOf: lotsValue["generatedAt"] ?? null },
    ],
  };
}

function checkpointFor(path: string, date: string, sourceSha256: Record<string, string>, cities: Map<string, CityMeasurement>): Progress {
  return {
    contract: "immo-lot-zone-assignment-progress/v1",
    as_of_date: date,
    source_sha256: sourceSha256,
    cities: [...cities.values()].sort((left, right) => ascending(left.slug, right.slug)),
  };
}

function loadProgress(args: Args, sourceSha256: Record<string, string>, universe: readonly string[]): Map<string, CityMeasurement> {
  if (!args.resume) return new Map();
  invariant(existsSync(args.checkpoint), `--resume requested but checkpoint is absent: ${relative(ROOT, args.checkpoint)}`);
  const progress = JSON.parse(readFileSync(args.checkpoint, "utf8")) as Progress;
  invariant(progress.contract === "immo-lot-zone-assignment-progress/v1", "checkpoint contract is incompatible");
  invariant(progress.as_of_date === args.date, "checkpoint date is incompatible");
  invariant(JSON.stringify(progress.source_sha256) === JSON.stringify(sourceSha256), "checkpoint source hashes are incompatible; restart without --resume");
  const allowed = new Set(universe);
  const map = new Map<string, CityMeasurement>();
  for (const city of progress.cities) {
    invariant(allowed.has(city.slug), `checkpoint has out-of-universe city ${city.slug}`);
    invariant(!map.has(city.slug), `checkpoint has duplicate city ${city.slug}`);
    map.set(city.slug, city);
  }
  return map;
}

function outputPath(date: string): string {
  return resolve(OUT_DIR, `immo-lot-zone-assignment-matrix-${date}.json`);
}

function classifyStats(slug: string, layout: "subdirectory" | "flat", geojsonKey: string, statsKey: string, etag: string | undefined, raw: unknown): CityMeasurement {
  const stats = record(raw, `${slug} stats`);
  const statsSlug = stats["slug"];
  const lots = nonNegativeInteger(stats["num_lots"], `${slug}.num_lots`);
  const assigned = nonNegativeInteger(stats["num_with_zone_code"], `${slug}.num_with_zone_code`);
  const base = {
    slug,
    served_layout: layout,
    served_geojson_key: geojsonKey,
    stats_key: statsKey,
    stats_etag: etag ?? null,
  } as const;
  if (statsSlug !== undefined && statsSlug !== slug) {
    return { ...base, state: "unknown", reason: `Served stats slug ${String(statsSlug)} does not match ${slug}.`, observed_lots: null, lots_with_code_zone: null, lots_without_code_zone: null, code_zone_pct: null };
  }
  if (lots === null || assigned === null || assigned > lots || lots === 0) {
    return { ...base, state: "unknown", reason: "Served stats do not expose a usable positive num_lots/num_with_zone_code pair.", observed_lots: null, lots_with_code_zone: null, lots_without_code_zone: null, code_zone_pct: null };
  }
  const missing = lots - assigned;
  return {
    ...base,
    state: assigned === lots ? "complete" : "incomplete",
    reason: `Served ${layout} sidecar reports ${assigned}/${lots} lots with non-null code_zone.`,
    observed_lots: lots,
    lots_with_code_zone: assigned,
    lots_without_code_zone: missing,
    code_zone_pct: pct(assigned, lots),
  };
}

async function readCity(s3: S3Client, slug: string): Promise<CityMeasurement> {
  const collection = `qc-lots-${slug}`;
  const nestedGeojson = `normalized/qc-lots/${collection}/${collection}.geojson`;
  const flatGeojson = `normalized/qc-lots/${collection}.geojson`;
  const nested = await objectHead(s3, nestedGeojson);
  const layout: "subdirectory" | "flat" | null = nested.exists
    ? "subdirectory"
    : (await objectHead(s3, flatGeojson)).exists ? "flat" : null;
  const geojsonKey = layout === "subdirectory" ? nestedGeojson : layout === "flat" ? flatGeojson : null;
  if (!layout || !geojsonKey) {
    return { slug, state: "unknown", reason: "No qc-lots geometry is served in either supported layout.", served_layout: null, served_geojson_key: null, stats_key: null, stats_etag: null, observed_lots: null, lots_with_code_zone: null, lots_without_code_zone: null, code_zone_pct: null };
  }
  const statsKey = layout === "subdirectory"
    ? `normalized/qc-lots/${collection}/${collection}.stats.json`
    : `normalized/qc-lots/${collection}.stats.json`;
  const statsHead = await objectHead(s3, statsKey);
  if (!statsHead.exists) {
    return { slug, state: "unknown", reason: `The served ${layout} qc-lots geometry has no stats sidecar.`, served_layout: layout, served_geojson_key: geojsonKey, stats_key: null, stats_etag: null, observed_lots: null, lots_with_code_zone: null, lots_without_code_zone: null, code_zone_pct: null };
  }
  const raw = JSON.parse((await getBytes(s3, statsKey)).toString("utf8")) as LotStats;
  return classifyStats(slug, layout, geojsonKey, statsKey, statsHead.etag, raw);
}

async function mapBatch(s3: S3Client, slugs: readonly string[]): Promise<CityMeasurement[]> {
  return Promise.all(slugs.map((slug) => readCity(s3, slug)));
}

function partition(cities: readonly CityMeasurement[]): Record<State, string[]> {
  const buckets: Record<State, string[]> = { complete: [], incomplete: [], unknown: [], "N/A": [] };
  for (const city of cities) buckets[city.state].push(city.slug);
  for (const bucket of Object.values(buckets)) bucket.sort(ascending);
  const all = Object.values(buckets).flat();
  invariant(all.length === UNIVERSE, `partition covers ${all.length}, expected ${UNIVERSE}`);
  invariant(new Set(all).size === UNIVERSE, "partition has a duplicate city");
  return buckets;
}

function buildMatrix(date: string, sourceMeta: readonly Record<string, unknown>[], cities: readonly CityMeasurement[]): string {
  const buckets = partition(cities);
  const measured = cities.filter((city) => city.observed_lots !== null && city.lots_with_code_zone !== null && city.lots_without_code_zone !== null);
  const measuredLots = measured.reduce((sum, city) => sum + city.observed_lots!, 0);
  const assigned = measured.reduce((sum, city) => sum + city.lots_with_code_zone!, 0);
  const missing = measured.reduce((sum, city) => sum + city.lots_without_code_zone!, 0);
  const matrix = {
    $schema: "immo-lot-zone-assignment-matrix/v1",
    as_of: date,
    _rule: {
      classifier: "complete iff every served lot has a non-null code_zone; incomplete iff a served positive denominator has any missing code_zone; unknown iff served data or usable stats are absent; N/A is inherited only from the explicit six-city Immo field portfolio list.",
      completion_threshold_percent: 100,
      convention_mirrored_from: "work/immo-field-completion-matrices/immo-field-completion-matrix.json (surface_m2 and postal_code: complete iff completed_lots === observed_lots)",
      served_layout_policy: "geo-api serves qc-lots-<slug>/qc-lots-<slug>.geojson before qc-lots-<slug>.geojson; only the matching stats sidecar is read, never the flat shadow when nested is served.",
      anti_invention: "No missing stat, malformed stat, absent served collection, or zero denominator outside the explicit six-city N/A list is credited complete.",
    },
    inputs: sourceMeta,
    summary: {
      city_states: { complete: buckets.complete.length, incomplete: buckets.incomplete.length, unknown: buckets.unknown.length, "N/A": buckets["N/A"].length },
      partition_total: UNIVERSE,
      applicable_denominator: UNIVERSE - buckets["N/A"].length,
    },
    city_buckets: buckets,
    city_measurements: cities.slice().sort((left, right) => ascending(left.slug, right.slug)),
    lot_totals: {
      measured_lots: measuredLots,
      lots_with_code_zone: assigned,
      lots_without_code_zone: missing,
      code_zone_pct: measuredLots ? pct(assigned, measuredLots) : null,
      cities_with_measured_stats: measured.length,
    },
  };
  return `${JSON.stringify(matrix, null, 2)}\n`;
}

function writeImmutable(path: string, text: string): void {
  if (existsSync(path)) {
    invariant(readFileSync(path, "utf8") === text, `dated output already exists with different bytes: ${relative(ROOT, path)}`);
    return;
  }
  writeAtomic(path, text);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(usage());
    return;
  }
  const input = sources();
  const out = outputPath(args.date);
  if (existsSync(out) && !args.resume) {
    const existing = JSON.parse(readFileSync(out, "utf8")) as { summary?: { city_states?: unknown } };
    console.log(JSON.stringify({ complete: true, output: relative(ROOT, out), city_states: existing.summary?.city_states ?? null, reused_existing_output: true }));
    return;
  }
  const cities = loadProgress(args, input.sourceSha256, input.universe);
  for (const slug of input.naSlugs) {
    cities.set(slug, { slug, state: "N/A", reason: "Explicit portfolio N/A: canonical Immo field matrix reports a zero per-lot denominator.", served_layout: null, served_geojson_key: null, stats_key: null, stats_etag: null, observed_lots: 0, lots_with_code_zone: null, lots_without_code_zone: null, code_zone_pct: null });
  }
  const deadline = Date.now() + args.maxSeconds * 1000;
  const pending = input.universe.filter((slug) => !cities.has(slug));
  const s3 = s3Client();
  for (let start = 0; start < pending.length && Date.now() < deadline; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    const results = await mapBatch(s3, batch);
    for (const city of results) cities.set(city.slug, city);
    writeAtomic(args.checkpoint, `${JSON.stringify(checkpointFor(args.checkpoint, args.date, input.sourceSha256, cities), null, 2)}\n`);
    console.error(`[immo-lot-zone] progress ${cities.size}/${UNIVERSE} checkpoint=${relative(ROOT, args.checkpoint)}`);
  }
  if (cities.size !== UNIVERSE) {
    console.log(JSON.stringify({ complete: false, checkpoint: relative(ROOT, args.checkpoint), measured_cities: cities.size, remaining_cities: UNIVERSE - cities.size, resume: `--date ${args.date} --resume --max-seconds ${args.maxSeconds}` }));
    return;
  }
  const text = buildMatrix(args.date, input.sourceMeta, [...cities.values()]);
  writeImmutable(out, text);
  const summary = JSON.parse(text) as { summary: { city_states: unknown }; lot_totals: unknown };
  console.log(JSON.stringify({ complete: true, output: relative(ROOT, out), city_states: summary.summary.city_states, lot_totals: summary.lot_totals, checkpoint: relative(ROOT, args.checkpoint) }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
