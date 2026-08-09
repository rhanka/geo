/**
 * Read the effective served qc-zonage collections for the fixed immo B' vivier.
 *
 * This is deliberately an audit, never a writer: its snapshot is the common
 * before/after measurement used around a proof-v2 replacement.  It honours the
 * geo-api layout rule (nested wins) and deliberately has no S3 read timeout:
 * a timed-out object is not evidence of absent provenance.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/zones-bprime-proof-audit.ts --out /tmp/bprime-before.json
 *
 * To measure only a replacement batch, pass a comma-separated subset of the
 * B' config with --slugs.  Add --with-lots only for the before/after batch
 * table: inventory does not download irrelevant lot collections.  Use
 * --lots-only to re-read just the compact lot counters after a replacement;
 * this deliberately does not list or read a zone collection.  A slug outside
 * that config is refused.  `--offset`/`--limit` slice the sorted B' config for
 * resumable, short inventory batches; every slice remains strictly B'.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { SERVED_ZONE_PREFIX, selectServedZoneCollections } from "./lib/zone-provenance-quality.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const BPRIME_CONFIG = resolve(ROOT, "acquisition/config/immo-vivier-b-20260725.json");
const LOTS_PREFIX = "normalized/qc-lots/";

interface FeatureLike { properties?: unknown }
interface CollectionLike { type?: unknown; features?: unknown }
interface BPrimeConfig { count?: unknown; slugs?: unknown }

export interface ServedCollectionSummary {
  feature_count: number;
  zone_code_count: number;
  property_key_count: number;
  property_keys: string[];
  property_value_count: number;
  source_levels: string[];
  http_source_urls: string[];
  invalid_source_url_values: string[];
  stamped_null: boolean;
  provenance: "orphan" | "stamped-null" | "orphan+stamped-null" | "source-http" | "other";
  needs_reacquisition: boolean;
}

interface LotSummary { lot_count: number; assigned_lot_count: number }
interface LogicalLot { key: string; alternatives: string[]; layout: "flat" | "nested" }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch { return null; }
}

function zoneCode(properties: Record<string, unknown>): string | null {
  for (const key of ["zone_code", "code_zone", "ZONE_CODE", "CODE_ZONE"]) {
    const value = properties[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return null;
}

/** Pure: classifies only literal values present in the selected served object. */
export function summarizeServedCollection(value: unknown): ServedCollectionSummary {
  const collection = record(value) as CollectionLike | null;
  const features = Array.isArray(collection?.features) ? collection.features : [];
  const keys = new Set<string>();
  const levels = new Set<string>();
  const urls = new Set<string>();
  const invalidUrls = new Set<string>();
  const zoneCodes = new Set<string>();
  let propertyValueCount = 0;
  let explicitNulls = 0;

  for (const feature of features as FeatureLike[]) {
    const properties = record(feature)?.properties;
    const props = record(properties);
    if (!props) continue;
    const propKeys = Object.keys(props);
    propertyValueCount += propKeys.length;
    for (const key of propKeys) keys.add(key);
    const code = zoneCode(props);
    if (code) zoneCodes.add(code);
    if (typeof props.zone_source_level === "string") levels.add(props.zone_source_level);
    if (Object.prototype.hasOwnProperty.call(props, "zone_source_url") && props.zone_source_url === null) explicitNulls++;
    const sourceValue = props.zone_source_url;
    if (sourceValue !== null && sourceValue !== undefined) {
      const parsed = httpUrl(sourceValue);
      if (parsed) urls.add(parsed);
      else invalidUrls.add(String(sourceValue));
    }
  }

  const stampedNull = features.length > 0 && explicitNulls === features.length;
  const orphan = levels.size === 1 && levels.has("orphan");
  const httpSourceUrls = [...urls].sort();
  const noRealSource = httpSourceUrls.length === 0;
  const needsReacquisition = noRealSource && (orphan || stampedNull);
  const provenance = orphan && stampedNull ? "orphan+stamped-null"
    : orphan ? "orphan"
      : stampedNull ? "stamped-null"
        : httpSourceUrls.length > 0 ? "source-http" : "other";

  return {
    feature_count: features.length,
    zone_code_count: zoneCodes.size,
    property_key_count: keys.size,
    property_keys: [...keys].sort(),
    property_value_count: propertyValueCount,
    source_levels: [...levels].sort(),
    http_source_urls: httpSourceUrls,
    invalid_source_url_values: [...invalidUrls].sort(),
    stamped_null: stampedNull,
    provenance,
    needs_reacquisition: needsReacquisition,
  };
}

function summarizeLots(value: unknown): LotSummary {
  const collection = record(value) as CollectionLike | null;
  const features = Array.isArray(collection?.features) ? collection.features : [];
  let assigned = 0;
  for (const feature of features as FeatureLike[]) {
    const props = record(record(feature)?.properties);
    if (props && zoneCode(props)) assigned++;
  }
  return { lot_count: features.length, assigned_lot_count: assigned };
}

function missingObject(error: unknown): boolean {
  const detail = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return detail?.name === "NotFound" || detail?.name === "NoSuchKey" || detail?.$metadata?.httpStatusCode === 404;
}

export function lotSummaryFromStats(value: unknown): LotSummary {
  const stats = record(value);
  const lots = stats?.num_lots;
  const assigned = stats?.num_with_zone_code;
  if (typeof lots !== "number" || !Number.isInteger(lots) || lots < 0
    || typeof assigned !== "number" || !Number.isInteger(assigned) || assigned < 0 || assigned > lots) {
    throw new Error("stats qc-lots invalides");
  }
  return { lot_count: lots, assigned_lot_count: assigned };
}

async function readLotStats(s3: ReturnType<typeof s3Client>, slug: string): Promise<LotSummary | null> {
  const key = `${LOTS_PREFIX}qc-lots-${slug}.stats.json`;
  try {
    return lotSummaryFromStats(await readJson(s3, key));
  } catch (error) {
    if (missingObject(error)) return null;
    throw error;
  }
}

function readBPrimeSlugs(): string[] {
  const config = JSON.parse(readFileSync(BPRIME_CONFIG, "utf8")) as BPrimeConfig;
  if (!Array.isArray(config.slugs) || !config.slugs.every((slug) => typeof slug === "string")) throw new Error("B' config: slugs invalide");
  if (config.count !== config.slugs.length || config.slugs.length !== 170) throw new Error(`B' config: count ${String(config.count)} ≠ ${config.slugs.length} (attendu 170)`);
  if (new Set(config.slugs).size !== config.slugs.length) throw new Error("B' config: slugs dupliqués");
  return [...config.slugs].sort();
}

function parseArgs(argv: string[]): { slugs: string[]; out: string; withLots: boolean; lotsOnly: boolean; offset: number; limit: number | null; resume: boolean } {
  const option = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const all = readBPrimeSlugs();
  const explicitSlugs = option("slugs");
  const requested = explicitSlugs?.split(",").map((slug) => slug.trim()).filter(Boolean) ?? all;
  if (requested.length === 0) throw new Error("--slugs vide");
  const outside = requested.filter((slug) => !all.includes(slug));
  if (outside.length) throw new Error(`hors vivier B': ${outside.sort().join(", ")}`);
  if (new Set(requested).size !== requested.length) throw new Error("--slugs contient un doublon");
  const lotsOnly = argv.includes("--lots-only");
  if (lotsOnly && argv.includes("--with-lots")) throw new Error("--lots-only et --with-lots sont exclusifs");
  const numberOption = (name: string, fallback: number | null): number | null => {
    const raw = option(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`--${name} doit être un entier positif ou nul`);
    return Number(raw);
  };
  const offset = numberOption("offset", 0)!;
  const limit = numberOption("limit", null);
  if (explicitSlugs !== undefined && (offset !== 0 || limit !== null)) throw new Error("--offset/--limit ne s'emploient pas avec --slugs");
  const selected = [...requested].sort().slice(offset, limit === null ? undefined : offset + limit);
  if (selected.length === 0) throw new Error("sélection B' vide après --offset/--limit");
  const outRaw = option("out");
  const resume = argv.includes("--resume");
  if (resume && !outRaw) throw new Error("--resume exige --out <snapshot>");
  return {
    slugs: selected,
    out: resolve(outRaw ?? join(tmpdir(), "zones-bprime-proof-audit.json")),
    withLots: argv.includes("--with-lots"),
    lotsOnly,
    offset,
    limit,
    resume,
  };
}

function resumableRows(path: string, slugs: readonly string[]): Map<string, Record<string, unknown>> {
  if (!existsSync(path)) return new Map();
  const prior = record(JSON.parse(readFileSync(path, "utf8")));
  if (prior?.contract !== "zones-bprime-proof-audit/v1") throw new Error(`--resume: contrat inattendu dans ${path}`);
  const rows = Array.isArray(prior.rows) ? prior.rows : [];
  const allowed = new Set(slugs);
  const out = new Map<string, Record<string, unknown>>();
  for (const value of rows) {
    const row = record(value);
    const slug = typeof row?.slug === "string" ? row.slug : null;
    // Errors are deliberately re-read: only a successful observed object is a
    // resumable fact.  A stale/foreign slug is never imported into this scope.
    if (slug && allowed.has(slug) && row?.read_error === null) out.set(slug, row);
  }
  return out;
}

function selectLotCollections(keys: readonly string[]): Map<string, LogicalLot> {
  const grouped = new Map<string, Partial<Record<"flat" | "nested", string>>>();
  for (const key of keys) {
    const rest = key.startsWith(LOTS_PREFIX) ? key.slice(LOTS_PREFIX.length) : "";
    const flat = /^qc-lots-([a-z0-9-]+)\.geojson$/.exec(rest);
    const nested = /^qc-lots-([a-z0-9-]+)\/qc-lots-\1\.geojson$/.exec(rest);
    const parsed = flat ? { slug: flat[1]!, layout: "flat" as const } : nested ? { slug: nested[1]!, layout: "nested" as const } : null;
    if (!parsed) continue;
    const entry = grouped.get(parsed.slug) ?? {};
    entry[parsed.layout] = key;
    grouped.set(parsed.slug, entry);
  }
  return new Map([...grouped.entries()].map(([slug, layouts]) => {
    const layout = layouts.nested ? "nested" as const : "flat" as const;
    const key = layouts[layout]!;
    const alternatives = [layouts.flat, layouts.nested].filter((candidate): candidate is string => !!candidate && candidate !== key).sort();
    return [slug, { key, alternatives, layout }];
  }));
}

let atomicWriteSerial = 0;
function writeAtomic(path: string, value: unknown): void {
  // Workers checkpoint concurrently; a per-write temporary path prevents one
  // completed city from renaming another city's staged snapshot.
  const temp = `${path}.${process.pid}.${atomicWriteSerial++}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, path);
}

async function readJson(s3: ReturnType<typeof s3Client>, key: string): Promise<unknown> {
  // Intentionally no AbortController/read timeout: a timeout would measure an
  // absence that was never observed. AWS_MAX_ATTEMPTS handles request retries.
  return JSON.parse((await getBytes(s3, key)).toString("utf8")) as unknown;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  if (args.lotsOnly) {
    const prior = args.resume ? resumableRows(args.out, args.slugs) : new Map();
    const rows: Array<Record<string, unknown> | undefined> = args.slugs.map((slug) => prior.get(slug));
    const snapshot = (complete: boolean) => {
      const observed = rows.filter((row): row is Record<string, unknown> => row !== undefined);
      const readErrors = observed.filter((row) => row.read_error !== null);
      return {
        contract: "zones-bprime-proof-audit/v1",
        generated_at: new Date().toISOString(),
        scope: { config: "acquisition/config/immo-vivier-b-20260725.json", requested_slugs: args.slugs.length, declared_vivier_count: 170, lots_only: true, offset: args.offset, limit: args.limit, resume: args.resume },
        s3_read_timeout: "none (intentional; absence is never inferred from a timeout)",
        progress: { observed_slugs: observed.length, complete },
        summary: { read_errors: readErrors.length, exact: complete && readErrors.length === 0 },
        rows: observed,
      };
    };
    let next = 0;
    let completed = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        while (next < args.slugs.length && rows[next] !== undefined) next++;
        const index = next++;
        if (index >= args.slugs.length) return;
        const slug = args.slugs[index]!;
        const lotStatsKey = `${LOTS_PREFIX}qc-lots-${slug}.stats.json`;
        try {
          const lots = await readLotStats(s3, slug);
          rows[index] = { slug, lot_stats_key: lots === null ? null : lotStatsKey, ...(lots ?? { lot_count: null, assigned_lot_count: null }), read_error: null };
        } catch (error) {
          rows[index] = { slug, lot_stats_key: null, read_error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
        }
        completed++;
        writeAtomic(args.out, snapshot(false));
        console.error(`[zones-bprime-proof-audit] lots ${completed}/${args.slugs.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, args.slugs.length) }, worker));
    const report = snapshot(true);
    writeAtomic(args.out, report);
    console.log(JSON.stringify({ out: args.out, ...report.summary }, null, 2));
    if (report.summary.read_errors > 0) process.exitCode = 1;
    return;
  }
  const zoneObjects = await listObjectEntries(s3, SERVED_ZONE_PREFIX);
  const zones = new Map(selectServedZoneCollections(zoneObjects.map((entry) => entry.key)).map((entry) => [entry.slug, entry]));
  const prior = args.resume ? resumableRows(args.out, args.slugs) : new Map();
  const rows: Array<Record<string, unknown> | undefined> = args.slugs.map((slug) => prior.get(slug));
  const snapshot = (complete: boolean) => {
    const observed = rows.filter((row): row is Record<string, unknown> => row !== undefined);
    const selected = observed.filter((row) => row.needs_reacquisition === true);
    const readErrors = observed.filter((row) => row.read_error !== null);
    return {
      contract: "zones-bprime-proof-audit/v1",
      generated_at: new Date().toISOString(),
      scope: { config: "acquisition/config/immo-vivier-b-20260725.json", requested_slugs: args.slugs.length, declared_vivier_count: 170, with_lots: args.withLots, offset: args.offset, limit: args.limit, resume: args.resume },
      serving_precedence: "nested_when_present_else_flat",
      s3_read_timeout: "none (intentional; absence is never inferred from a timeout)",
      progress: { observed_slugs: observed.length, complete },
      summary: {
        served_collections: observed.filter((row) => row.zone_key !== null).length,
        no_real_source_orphan_or_stamped_null: selected.length,
        read_errors: readErrors.length,
        exact: complete && readErrors.length === 0,
      },
      no_real_source_collections: selected,
      rows: observed,
    };
  };

  const inspect = async (slug: string): Promise<Record<string, unknown>> => {
    const zone = zones.get(slug);
    const lotStatsKey = `${LOTS_PREFIX}qc-lots-${slug}.stats.json`;
    try {
      const [zoneJson, lotJson] = await Promise.all([
        zone ? readJson(s3, zone.key) : Promise.resolve(null),
        args.withLots ? readLotStats(s3, slug) : Promise.resolve(null),
      ]);
      const summary = zoneJson === null ? null : summarizeServedCollection(zoneJson);
      return {
        slug,
        zone_key: zone?.key ?? null,
        zone_layout: zone?.layout ?? null,
        zone_shadow_keys: zone?.alternatives ?? [],
        lot_stats_key: args.withLots && lotJson !== null ? lotStatsKey : null,
        ...(summary ?? { feature_count: null, zone_code_count: null, property_key_count: null, property_keys: [], property_value_count: null, source_levels: [], http_source_urls: [], invalid_source_url_values: [], stamped_null: false, provenance: "not-served", needs_reacquisition: false }),
        ...(lotJson === null ? { lot_count: null, assigned_lot_count: null } : lotJson),
        read_error: null,
      };
    } catch (error) {
      return { slug, zone_key: zone?.key ?? null, zone_layout: zone?.layout ?? null, zone_shadow_keys: zone?.alternatives ?? [], lot_stats_key: null, read_error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
  };

  let next = 0;
  let completed = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      while (next < args.slugs.length && rows[next] !== undefined) next++;
      const index = next++;
      if (index >= args.slugs.length) return;
      rows[index] = await inspect(args.slugs[index]!);
      completed++;
      // A killed process leaves an explicitly partial snapshot; it never
      // presents an interrupted read as an exact inventory.
      writeAtomic(args.out, snapshot(false));
      console.error(`[zones-bprime-proof-audit] ${completed}/${args.slugs.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, args.slugs.length) }, worker));
  const report = snapshot(true);
  writeAtomic(args.out, report);
  console.log(JSON.stringify({ out: args.out, ...report.summary }, null, 2));
  if (report.summary.read_errors > 0) process.exitCode = 1;
}

// The tsx loader does not preserve import.meta.main when NODE_OPTIONS injects
// the mandated IPv4 preference.  argv[1] remains the actual entry module.
const isCliEntrypoint = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCliEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
