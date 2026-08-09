/**
 * Measure the `code_zone` gap for the owner-approved Immo vivier B' only.
 *
 * This is deliberately a linear read of the served qc-lots snapshot and of
 * its lot-zone parquet.  It does not run a spatial consistency audit: that
 * audit is useful for mismatch, but its point-in-polygon work is neither
 * necessary nor safe to use as a proxy for a missing `code_zone`.
 *
 * Causes are a closed partition of lots whose served `code_zone` is null:
 * - no_zonage_collection: no served qc-zonage collection;
 * - zonage_without_usable_code: collection exists but exposes no code;
 * - materialization_stale: the same lot has a code in qc-lot-zonage parquet;
 * - fold_computed_null_geometry_coverage: parquet row exists but its code is null;
 * - lot_zone_fold_not_materialized: no matching parquet row, kept explicit
 *   rather than claiming a geometry null without evidence.
 *
 * Writes an atomic, resume-safe progress report after every city.  It never
 * writes S3 and refuses a slug outside the committed vivier B' configuration.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx src/lots-sans-codezone-vivier-b.ts \
 *       --out work/coverage/lots-sans-codezone-vivierB-20260726-remeasured.json
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";

import { getBytes, getGeoJsonFeatureCollection, objectHead, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const VIVIER_PATH = resolve(ROOT, "acquisition/config/immo-vivier-b-20260725.json");
const LOTS_PREFIX = "normalized/qc-lots/";
const ZONES_PREFIX = "normalized/ca-qc-zonage/";
const LOT_ZONE_PREFIX = "normalized/qc-lot-zonage/";
const CONTRACT = "lots-sans-codezone-vivier-b/2";

type Cause =
  | "no_zonage_collection"
  | "zonage_without_usable_code"
  | "materialization_stale"
  | "fold_computed_null_geometry_coverage"
  | "lot_zone_fold_not_materialized";

const CAUSES: readonly Cause[] = [
  "no_zonage_collection",
  "zonage_without_usable_code",
  "materialization_stale",
  "fold_computed_null_geometry_coverage",
  "lot_zone_fold_not_materialized",
] as const;

interface Feature {
  properties?: Record<string, unknown> | null;
}

interface VivierB {
  count: number;
  slugs: string[];
}

interface CityMeasurement {
  slug: string;
  lots_key: string | null;
  zonage_key: string | null;
  lot_zone_parquet_key: string | null;
  lots: number;
  with_code_zone: number;
  without_code_zone: number;
  zonage_features: number | null;
  zonage_features_with_usable_code: number | null;
  parquet_rows: number | null;
  parquet_rows_with_zone_code: number | null;
  duplicate_lot_ids: number;
  causes: Record<Cause, number>;
  coverage_state: "complete" | "partial" | "unknown";
}

interface Report {
  contract: typeof CONTRACT;
  generated_at: string;
  scope: {
    config_path: string;
    config_sha256: string;
    slugs_requested: number;
    excluded: string[];
  };
  cities: CityMeasurement[];
  totals: {
    lots: number;
    with_code_zone: number;
    without_code_zone: number;
    without_code_zone_pct: number;
    causes: Record<Cause, number>;
    unclassified: number;
  };
}

interface Args {
  out: string;
  slugs: string[] | null;
}

function nonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function codeZoneOf(properties: Record<string, unknown> | null | undefined): string | null {
  return nonBlankString(properties?.["code_zone"]);
}

function zoneCodeOf(properties: Record<string, unknown> | null | undefined): string | null {
  for (const key of ["code_zone", "zone_code", "ZONE", "zone"]) {
    const value = nonBlankString(properties?.[key]);
    if (value) return value;
  }
  return null;
}

/** Match the key priority used by lot-zone-join and lots-enriched. */
function lotIdOf(properties: Record<string, unknown> | null | undefined, index: number): string {
  for (const key of ["lot_id", "LOT_ID", "NO_LOT", "no_lot", "noLot", "geoId", "id"]) {
    const value = properties?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return String(index);
}

function emptyCauses(): Record<Cause, number> {
  return Object.fromEntries(CAUSES.map((cause) => [cause, 0])) as Record<Cause, number>;
}

export function causeForMissingLot(input: {
  zonageExists: boolean;
  zonageHasUsableCode: boolean;
  parquetRowExists: boolean;
  parquetZoneCode: string | null;
}): Cause {
  if (!input.zonageExists) return "no_zonage_collection";
  if (!input.zonageHasUsableCode) return "zonage_without_usable_code";
  if (!input.parquetRowExists) return "lot_zone_fold_not_materialized";
  return input.parquetZoneCode ? "materialization_stale" : "fold_computed_null_geometry_coverage";
}

function parseArgs(argv: string[]): Args {
  let out = "";
  let slugs: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out") out = String(argv[++i] ?? "");
    else if (arg === "--slugs") slugs = String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out) throw new Error("--out <path> is required so progress can resume safely");
  return { out: resolve(ROOT, out), slugs: slugs ? [...new Set(slugs)] : null };
}

function firstPresentKey(
  heads: ReadonlyArray<{ key: string; exists: boolean }>,
): string | null {
  return heads.find((entry) => entry.exists)?.key ?? null;
}

async function resolveLotsKey(s3: S3Client, slug: string): Promise<string | null> {
  // geo-api serves the nested layout when both layouts exist.
  const keys = [
    `${LOTS_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`,
    `${LOTS_PREFIX}qc-lots-${slug}.geojson`,
  ];
  return firstPresentKey(await Promise.all(keys.map(async (key) => ({ key, exists: (await objectHead(s3, key)).exists }))));
}

async function resolveZonageKey(s3: S3Client, slug: string): Promise<string | null> {
  const keys = [
    `${ZONES_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    `${ZONES_PREFIX}qc-zonage-${slug}.geojson`,
  ];
  return firstPresentKey(await Promise.all(keys.map(async (key) => ({ key, exists: (await objectHead(s3, key)).exists }))));
}

async function measureCity(slug: string): Promise<CityMeasurement> {
  const s3 = s3Client();
  const [lotsKey, zonageKey] = await Promise.all([resolveLotsKey(s3, slug), resolveZonageKey(s3, slug)]);
  const parquetKey = `${LOT_ZONE_PREFIX}${slug}.parquet`;
  const parquetExists = (await objectHead(s3, parquetKey)).exists;
  const lotZoneParquetKey = parquetExists ? parquetKey : null;
  if (!lotsKey) {
    return {
      slug, lots_key: null, zonage_key: zonageKey, lot_zone_parquet_key: lotZoneParquetKey,
      lots: 0, with_code_zone: 0, without_code_zone: 0,
      zonage_features: null, zonage_features_with_usable_code: null,
      parquet_rows: null, parquet_rows_with_zone_code: null, duplicate_lot_ids: 0,
      causes: emptyCauses(), coverage_state: "unknown",
    };
  }

  const [lotsFc, zonesFc, parquetRows] = await Promise.all([
    getGeoJsonFeatureCollection<Feature>(s3, lotsKey),
    zonageKey ? getGeoJsonFeatureCollection<Feature>(s3, zonageKey) : Promise.resolve(null),
    lotZoneParquetKey ? getBytes(s3, lotZoneParquetKey).then((bytes) => readParquetRowsFromBuffer(bytes, ["lot_id", "zone_code"])) : Promise.resolve(null),
  ]);

  const parquetByLotId = new Map<string, string | null>();
  for (const row of parquetRows ?? []) {
    const lotId = nonBlankString(row["lot_id"]);
    if (lotId) parquetByLotId.set(lotId, nonBlankString(row["zone_code"]));
  }
  const zones = zonesFc?.features ?? [];
  const zonageHasUsableCode = zones.some((feature) => !!zoneCodeOf(feature.properties));
  const causes = emptyCauses();
  let withCodeZone = 0;
  let duplicateLotIds = 0;
  const seenLotIds = new Set<string>();
  for (let index = 0; index < lotsFc.features.length; index++) {
    const feature = lotsFc.features[index]!;
    if (codeZoneOf(feature.properties)) {
      withCodeZone++;
      continue;
    }
    const lotId = lotIdOf(feature.properties, index);
    if (seenLotIds.has(lotId)) duplicateLotIds++;
    seenLotIds.add(lotId);
    const parquetRowExists = parquetByLotId.has(lotId);
    const cause = causeForMissingLot({
      zonageExists: !!zonageKey,
      zonageHasUsableCode,
      parquetRowExists,
      parquetZoneCode: parquetByLotId.get(lotId) ?? null,
    });
    causes[cause]++;
  }
  const lots = lotsFc.features.length;
  const withoutCodeZone = lots - withCodeZone;
  return {
    slug,
    lots_key: lotsKey,
    zonage_key: zonageKey,
    lot_zone_parquet_key: lotZoneParquetKey,
    lots,
    with_code_zone: withCodeZone,
    without_code_zone: withoutCodeZone,
    zonage_features: zonageKey ? zones.length : null,
    zonage_features_with_usable_code: zonageKey ? zones.filter((feature) => !!zoneCodeOf(feature.properties)).length : null,
    parquet_rows: parquetRows?.length ?? null,
    parquet_rows_with_zone_code: parquetRows?.filter((row) => !!nonBlankString(row["zone_code"])).length ?? null,
    duplicate_lot_ids: duplicateLotIds,
    causes,
    coverage_state: withCodeZone === 0 ? "unknown" : withoutCodeZone === 0 ? "complete" : "partial",
  };
}

function totalsFor(cities: readonly CityMeasurement[]): Report["totals"] {
  const causes = emptyCauses();
  let lots = 0;
  let withCodeZone = 0;
  let withoutCodeZone = 0;
  for (const city of cities) {
    lots += city.lots;
    withCodeZone += city.with_code_zone;
    withoutCodeZone += city.without_code_zone;
    for (const cause of CAUSES) causes[cause] += city.causes[cause];
  }
  return {
    lots,
    with_code_zone: withCodeZone,
    without_code_zone: withoutCodeZone,
    without_code_zone_pct: lots ? Math.round((withoutCodeZone * 10000) / lots) / 100 : 0,
    causes,
    unclassified: withoutCodeZone - Object.values(causes).reduce((sum, count) => sum + count, 0),
  };
}

function readReport(path: string): Report | null {
  if (!existsSync(path)) return null;
  const report = JSON.parse(readFileSync(path, "utf8")) as Report;
  return report.contract === CONTRACT ? report : null;
}

function writeReport(path: string, report: Report): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp.${process.pid}`;
  writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n", "utf8");
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configBytes = readFileSync(VIVIER_PATH);
  const vivier = JSON.parse(configBytes.toString("utf8")) as VivierB;
  if (!Array.isArray(vivier.slugs) || vivier.slugs.length !== vivier.count) {
    throw new Error(`invalid vivier B config: expected ${vivier.count} unique slugs`);
  }
  const approved = new Set(vivier.slugs);
  const slugs = args.slugs ?? vivier.slugs;
  const outside = slugs.filter((slug) => !approved.has(slug));
  if (outside.length) throw new Error(`refusing out-of-scope slug(s): ${outside.join(", ")}`);

  const previous = readReport(args.out);
  const bySlug = new Map(previous?.cities.map((city) => [city.slug, city]));
  const scope = {
    config_path: "acquisition/config/immo-vivier-b-20260725.json",
    config_sha256: createHash("sha256").update(configBytes).digest("hex"),
    slugs_requested: slugs.length,
    excluded: ["montreal"],
  };
  for (const [index, slug] of slugs.entries()) {
    if (bySlug.has(slug)) {
      console.log(`RESUME ${index + 1}/${slugs.length} ${slug}`);
      continue;
    }
    const city = await measureCity(slug);
    bySlug.set(slug, city);
    const cities = slugs.map((current) => bySlug.get(current)).filter((entry): entry is CityMeasurement => !!entry);
    const report: Report = { contract: CONTRACT, generated_at: new Date().toISOString(), scope, cities, totals: totalsFor(cities) };
    writeReport(args.out, report);
    console.log(
      `MEASURED ${index + 1}/${slugs.length} ${slug} lots=${city.lots} ` +
      `with_code_zone=${city.with_code_zone} without=${city.without_code_zone} ` +
      `stale=${city.causes.materialization_stale} geometry_null=${city.causes.fold_computed_null_geometry_coverage}`,
    );
  }
  const cities = slugs.map((slug) => bySlug.get(slug)).filter((entry): entry is CityMeasurement => !!entry);
  const report: Report = { contract: CONTRACT, generated_at: new Date().toISOString(), scope, cities, totals: totalsFor(cities) };
  writeReport(args.out, report);
  console.log(`DONE cities=${cities.length} lots=${report.totals.lots} without_code_zone=${report.totals.without_code_zone}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
