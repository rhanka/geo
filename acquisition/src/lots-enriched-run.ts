/**
 * lots-enriched-run.ts -- per-municipality ENRICHED LOTS GeoJSON product.
 *
 * Pure attribute JOIN (no spatial compute): reads the clipped cadastre GeoJSON
 * (geometry + lot_id) and left-joins, by `lot_id`, the already-computed
 * per-lot columns from two parquet products:
 *   - normalized/qc-lot-zonage/<slug>.parquet  (zone_code, dominant_fraction,
 *     multi_zone, zone_codes, assignment_method, norms=JSON)
 *   - normalized/qc-lot-tod/<slug>.parquet     (in_tod, tod_id, tod_nom, …)
 * and emits ONE served-ready FeatureCollection per municipality:
 *   normalized/qc-lots/qc-lots-<slug>.geojson  (OGC collection id qc-lots-<slug>).
 *
 * The output is STRICTLY ADDITIVE over the cadastre: every original lot property
 * (NO_LOT, noLot, geoId=feature_id, name, code…) is preserved so immo's existing
 * lot identity keys keep working; zonage + norms + TOD are merged on top. The
 * flat immo alias `code_zone` is set alongside `zone_code` (same real value).
 *
 * Anti-invention: only real joined values are written. A lot absent from a
 * product, or whose product value is null, yields `null` (never a guess). When
 * a muni has no qc-lot-tod parquet at all, `in_tod` is `null` (unknown), not
 * `false`.
 *
 * SINGLE process by design (province cadastres are large — parallelism OOMs).
 * Output is streamed feature-by-feature to a temp file to bound peak memory.
 *
 * Pilot:
 *   tsx src/lots-enriched-run.ts --slugs salaberry-de-valleyfield,delson,sainte-catherine,saint-constant,candiac
 * Whole province (single process, sharding optional):
 *   tsx src/lots-enriched-run.ts --all
 * Verify existing deposits:
 *   tsx src/lots-enriched-run.ts --slugs delson --verify-only
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { S3Client } from "@aws-sdk/client-s3";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import type { Feature, FeatureCollection, Geometry } from "geojson";

import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { norm as normCadastreSlug } from "./cadastre-clip-sda.js";
import { BUCKET, exists, getBytes, getJson, listSlugs, putBytes, s3Client } from "./lib/s3.js";

const CAD_PREFIX = "normalized/qc-cadastre-lots/";
const ZONAGE_PREFIX = "normalized/qc-lot-zonage/";
const TOD_PREFIX = "normalized/qc-lot-tod/";
const OUT_PREFIX = "normalized/qc-lots/";

/** Default per-muni wall-clock budget (skip a muni if it would exceed it). */
const DEFAULT_TIME_BOX_SEC = 1800;
/** Skip a cadastre larger than this (single-process OOM guard); override with --max-mb. */
const DEFAULT_MAX_MB = 1200;

type GeoFeature = Feature<Geometry, Record<string, unknown> | null>;
type GeoFc = FeatureCollection<Geometry, Record<string, unknown> | null>;

interface Args {
  slugs: string[];
  all: boolean;
  noUpload: boolean;
  verifyOnly: boolean;
  timeBoxSec: number;
  maxMb: number;
  shard: { index: number; total: number } | null;
}

interface EnrichStats {
  slug: string;
  input_keys: { cadastre: string; zonage: string | null; tod: string | null };
  output_key: string;
  num_lots: number;
  num_joined_zonage: number;
  num_with_zone_code: number;
  num_with_norms: number;
  pct_with_zone_code: number;
  pct_with_norms: number;
  zonage_join_rate: number;
  tod_present: boolean;
  num_joined_tod: number;
  num_in_tod: number;
  property_keys: string[];
  warnings: string[];
  examples: Array<Record<string, unknown>>;
  verified_deposit?: { exists: boolean; bytes: number };
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let all = false;
  let noUpload = false;
  let verifyOnly = false;
  let timeBoxSec = DEFAULT_TIME_BOX_SEC;
  let maxMb = DEFAULT_MAX_MB;
  let shard: { index: number; total: number } | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") all = true;
    else if (arg === "--slug") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--slugs") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--no-upload") noUpload = true;
    else if (arg === "--verify-only") verifyOnly = true;
    else if (arg === "--time-box") timeBoxSec = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || DEFAULT_TIME_BOX_SEC);
    else if (arg === "--max-mb") maxMb = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || DEFAULT_MAX_MB);
    else if (arg === "--shard") {
      const spec = String(argv[++i] ?? "");
      const [idx, total] = spec.split("/").map((v) => parseInt(v, 10));
      if (!Number.isInteger(idx) || !Number.isInteger(total) || total <= 0 || idx < 0 || idx >= total) {
        throw new Error(`--shard expects i/n with 0<=i<n, got "${spec}"`);
      }
      shard = { index: idx, total };
    } else throw new Error(`unknown argument: ${arg}`);
  }

  const uniqueSlugs = [...new Set(slugs)];
  if (uniqueSlugs.length === 0 && !all) {
    throw new Error("pass --all, --slug <slug>, or --slugs <a,b>");
  }
  return { slugs: uniqueSlugs, all, noUpload, verifyOnly, timeBoxSec, maxMb, shard };
}

function outKey(slug: string): string {
  return `${OUT_PREFIX}qc-lots-${slug}.geojson`;
}

function statsKey(slug: string): string {
  return `${OUT_PREFIX}qc-lots-${slug}.stats.json`;
}

/** Same lot-id extraction priority as lot-zone-join / tod-ingest, so the join
 *  key matches the value the parquet products stored. */
function lotIdOf(feature: GeoFeature, index: number): string {
  const props = feature.properties ?? {};
  for (const key of ["lot_id", "LOT_ID", "NO_LOT", "no_lot", "noLot", "geoId", "id"]) {
    const value = props[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return String(index);
}

async function resolveCadastreKey(s3: S3Client, slug: string): Promise<string> {
  const key = `${CAD_PREFIX}${slug}.geojson`;
  if (await exists(s3, key)) return key;
  const slugs = await listSlugs(s3, CAD_PREFIX, ".geojson", true);
  const normalizedTarget = normCadastreSlug(slug);
  const normalizedMatches = slugs.filter((c) => normCadastreSlug(c) === normalizedTarget);
  if (normalizedMatches.length === 1) return `${CAD_PREFIX}${normalizedMatches[0]}.geojson`;
  const containsMatches = slugs.filter((c) => normCadastreSlug(c).includes(normalizedTarget));
  if (containsMatches.length === 1) return `${CAD_PREFIX}${containsMatches[0]}.geojson`;
  const candidates = containsMatches.length > 0 ? containsMatches : normalizedMatches;
  throw new Error(
    `cadastre not found for ${slug}: ${key}` +
      (candidates.length > 0 ? `; ambiguous candidates: ${candidates.slice(0, 12).join(", ")}` : ""),
  );
}

/** HEAD to learn the cadastre object size without downloading it. */
async function objectSizeBytes(s3: S3Client, key: string): Promise<number> {
  const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return typeof r.ContentLength === "number" ? r.ContentLength : 0;
}

interface ZonageRow {
  zone_code: string | null;
  dominant_fraction: number | null;
  multi_zone: boolean | null;
  zone_codes: string[] | null;
  assignment_method: string | null;
  norms: Record<string, unknown> | null;
}

async function loadZonage(s3: S3Client, key: string | null): Promise<Map<string, ZonageRow>> {
  const map = new Map<string, ZonageRow>();
  if (!key) return map;
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, key));
  for (const row of rows) {
    const lotId = row["lot_id"];
    if (lotId === null || lotId === undefined || !String(lotId).trim()) continue;
    let norms: Record<string, unknown> | null = null;
    const rawNorms = row["norms"];
    if (typeof rawNorms === "string" && rawNorms.trim()) {
      try {
        norms = JSON.parse(rawNorms) as Record<string, unknown>;
      } catch {
        norms = null;
      }
    }
    map.set(String(lotId), {
      zone_code: strOrNull(row["zone_code"]),
      dominant_fraction: numOrNull(row["dominant_fraction"]),
      multi_zone: typeof row["multi_zone"] === "boolean" ? (row["multi_zone"] as boolean) : null,
      zone_codes: Array.isArray(row["zone_codes"]) ? (row["zone_codes"] as unknown[]).map((v) => String(v)) : null,
      assignment_method: strOrNull(row["assignment_method"]),
      norms,
    });
  }
  return map;
}

interface TodRow {
  in_tod: boolean | null;
  tod_id: string | null;
  tod_nom: string | null;
  tod_statut: string | null;
  tod_ligne: string | null;
  tod_type: string | null;
  tod_seuil_pmad: number | null;
}

async function loadTod(s3: S3Client, key: string | null): Promise<Map<string, TodRow> | null> {
  if (!key) return null;
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, key));
  const map = new Map<string, TodRow>();
  for (const row of rows) {
    const lotId = row["lot_id"];
    if (lotId === null || lotId === undefined || !String(lotId).trim()) continue;
    map.set(String(lotId), {
      in_tod: typeof row["in_tod"] === "boolean" ? (row["in_tod"] as boolean) : null,
      tod_id: strOrNull(row["tod_id"]),
      tod_nom: strOrNull(row["tod_nom"]),
      tod_statut: strOrNull(row["tod_statut"]),
      tod_ligne: strOrNull(row["tod_ligne"]),
      tod_type: strOrNull(row["tod_type"]),
      tod_seuil_pmad: numOrNull(row["tod_seuil_pmad"]),
    });
  }
  return map;
}

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined || !String(v).trim() ? null : String(v);
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Merge cadastre props + zonage + norms + TOD into one flat property bag.
 *  Strictly additive; real values only (null when absent). */
function enrichProperties(
  base: Record<string, unknown> | null,
  lotId: string,
  zonage: ZonageRow | undefined,
  tod: Map<string, TodRow> | null,
): Record<string, unknown> {
  const props: Record<string, unknown> = { ...(base ?? {}) };
  props["lot_id"] = lotId;

  // ── zonage + flattened norms ──────────────────────────────────────────────
  if (zonage) {
    props["zone_code"] = zonage.zone_code;
    props["code_zone"] = zonage.zone_code; // immo contract alias (same real value)
    props["dominant_fraction"] = zonage.dominant_fraction;
    props["multi_zone"] = zonage.multi_zone;
    props["zone_codes"] = zonage.zone_codes;
    props["assignment_method"] = zonage.assignment_method;
    if (zonage.norms) {
      for (const [k, v] of Object.entries(zonage.norms)) {
        if (k === "zone_code") continue; // authoritative one already set above
        props[k] = v ?? null;
      }
    }
  } else {
    props["zone_code"] = null;
    props["code_zone"] = null;
    props["dominant_fraction"] = null;
    props["multi_zone"] = null;
  }

  // ── TOD ───────────────────────────────────────────────────────────────────
  if (tod) {
    const t = tod.get(lotId);
    props["in_tod"] = t ? t.in_tod : null; // lot absent from a present product = unknown
    props["tod_id"] = t && t.in_tod ? t.tod_id : null;
    props["tod_nom"] = t && t.in_tod ? t.tod_nom : null;
    props["tod_statut"] = t && t.in_tod ? t.tod_statut : null;
    props["tod_ligne"] = t && t.in_tod ? t.tod_ligne : null;
    props["tod_type"] = t && t.in_tod ? t.tod_type : null;
    props["tod_seuil_pmad"] = t && t.in_tod ? t.tod_seuil_pmad : null;
  } else {
    props["in_tod"] = null; // muni has no TOD product at all
  }
  return props;
}

async function runCity(s3: S3Client, slug: string, args: Args): Promise<EnrichStats> {
  const cadastreKey = await resolveCadastreKey(s3, slug);
  const sizeBytes = await objectSizeBytes(s3, cadastreKey);
  const sizeMb = sizeBytes / 1e6;
  if (sizeMb > args.maxMb) {
    throw new Error(`cadastre ${sizeMb.toFixed(0)}MB > --max-mb ${args.maxMb} (single-process OOM guard)`);
  }

  const zonageKey = (await exists(s3, `${ZONAGE_PREFIX}${slug}.parquet`)) ? `${ZONAGE_PREFIX}${slug}.parquet` : null;
  const todKey = (await exists(s3, `${TOD_PREFIX}${slug}.parquet`)) ? `${TOD_PREFIX}${slug}.parquet` : null;

  const [zonage, tod] = await Promise.all([loadZonage(s3, zonageKey), loadTod(s3, todKey)]);
  const cadastre = (await getJson(s3, cadastreKey)) as GeoFc;
  const features = cadastre.features ?? [];

  // Stream the FeatureCollection to a temp file, one feature at a time.
  const dir = await mkdtemp(join(tmpdir(), `qc-lots-${slug}-`));
  const path = join(dir, "out.geojson");
  const stream = createWriteStream(path, { encoding: "utf8" });
  const write = (chunk: string): Promise<void> =>
    new Promise((resolve, reject) => {
      stream.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

  let numLots = 0;
  let numJoinedZonage = 0;
  let numWithZoneCode = 0;
  let numWithNorms = 0;
  let numJoinedTod = 0;
  let numInTod = 0;
  const propertyKeys = new Set<string>();
  const examples: Array<Record<string, unknown>> = [];

  try {
    await write('{"type":"FeatureCollection","features":[');
    let first = true;
    let index = -1;
    for (const feature of features) {
      index += 1;
      if (!feature || !feature.geometry) continue;
      const lotId = lotIdOf(feature, index);
      const zRow = zonage.get(lotId);
      const props = enrichProperties(feature.properties ?? null, lotId, zRow, tod);

      numLots += 1;
      if (zRow) numJoinedZonage += 1;
      if (props["zone_code"] !== null && props["zone_code"] !== undefined) numWithZoneCode += 1;
      if (zRow?.norms) numWithNorms += 1;
      if (tod && tod.has(lotId)) numJoinedTod += 1;
      if (props["in_tod"] === true) numInTod += 1;
      for (const k of Object.keys(props)) propertyKeys.add(k);

      if (examples.length < 3 && props["zone_code"] !== null && zRow?.norms) {
        examples.push(exampleOf(props));
      }

      const out = { type: "Feature", geometry: feature.geometry, properties: props };
      await write((first ? "" : ",") + JSON.stringify(out));
      first = false;
    }
    await write("]}");
    await new Promise<void>((resolve, reject) => stream.end((err?: Error | null) => (err ? reject(err) : resolve())));

    const warnings: string[] = [];
    const zonageJoinRate = numLots ? round2((100 * numJoinedZonage) / numLots) : 0;
    const pctWithZoneCode = numLots ? round2((100 * numWithZoneCode) / numLots) : 0;
    const pctWithNorms = numLots ? round2((100 * numWithNorms) / numLots) : 0;
    if (zonageKey && zonageJoinRate < 90) warnings.push(`zonage join rate ${zonageJoinRate}% < 90% (lot_id mismatch?)`);
    if (!zonageKey) warnings.push(`no zonage parquet — zone_code/norms all null`);

    const stats: EnrichStats = {
      slug,
      input_keys: { cadastre: cadastreKey, zonage: zonageKey, tod: todKey },
      output_key: outKey(slug),
      num_lots: numLots,
      num_joined_zonage: numJoinedZonage,
      num_with_zone_code: numWithZoneCode,
      num_with_norms: numWithNorms,
      pct_with_zone_code: pctWithZoneCode,
      pct_with_norms: pctWithNorms,
      zonage_join_rate: zonageJoinRate,
      tod_present: tod !== null,
      num_joined_tod: numJoinedTod,
      num_in_tod: numInTod,
      property_keys: [...propertyKeys].sort(),
      warnings,
      examples,
    };

    if (!args.noUpload) {
      const body = await readFile(path);
      await putBytes(s3, outKey(slug), body, "application/geo+json");
      await putBytes(s3, statsKey(slug), Buffer.from(JSON.stringify(stats, null, 2), "utf8"), "application/json");
      const dep = await verifyDeposit(s3, slug);
      stats.verified_deposit = dep;
    } else {
      const st = await stat(path);
      stats.verified_deposit = { exists: true, bytes: st.size };
    }
    return stats;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function exampleOf(props: Record<string, unknown>): Record<string, unknown> {
  const pick = (k: string): unknown => (props[k] === undefined ? null : props[k]);
  return {
    lot_id: pick("lot_id"),
    geoId: pick("geoId"),
    zone_code: pick("zone_code"),
    dominant_fraction: pick("dominant_fraction"),
    multi_zone: pick("multi_zone"),
    hauteur_max_value: pick("hauteur_max_value"),
    densite_value: pick("densite_value"),
    marge_avant_min_value: pick("marge_avant_min_value"),
    in_tod: pick("in_tod"),
    tod_nom: pick("tod_nom"),
  };
}

async function verifyDeposit(s3: S3Client, slug: string): Promise<EnrichStats["verified_deposit"]> {
  const key = outKey(slug);
  if (!(await exists(s3, key))) return { exists: false, bytes: 0 };
  const bytes = await objectSizeBytes(s3, key);
  return { exists: true, bytes };
}

async function verifyOnly(s3: S3Client, slug: string): Promise<EnrichStats> {
  const sKey = statsKey(slug);
  if (!(await exists(s3, sKey))) throw new Error(`stats not found: ${sKey}`);
  const stats = JSON.parse((await getBytes(s3, sKey)).toString("utf8")) as EnrichStats;
  stats.verified_deposit = await verifyDeposit(s3, slug);
  return stats;
}

function printSummary(stats: EnrichStats): void {
  const v = stats.verified_deposit;
  console.log(
    [
      `OK ${stats.slug}`,
      `lots=${stats.num_lots}`,
      `zone_code=${stats.pct_with_zone_code}%`,
      `norms=${stats.pct_with_norms}%`,
      `tod=${stats.tod_present ? `${stats.num_in_tod}/${stats.num_lots}` : "n/a"}`,
      v ? `deposit=${v.exists ? "Y" : "N"} bytes=${v.bytes}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (stats.warnings.length > 0) console.log(`WARN ${stats.slug} ${stats.warnings.join("; ")}`);
  for (const ex of stats.examples) {
    console.log(`EXAMPLE ${stats.slug} ${JSON.stringify(ex)}`);
  }
}

async function enumerateCadastreSlugs(s3: S3Client): Promise<string[]> {
  return (await listSlugs(s3, CAD_PREFIX, ".geojson", true)).sort();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  const allSlugs = args.all ? await enumerateCadastreSlugs(s3) : args.slugs;
  const slugs = args.shard ? allSlugs.filter((_, i) => i % args.shard!.total === args.shard!.index) : allSlugs;
  if (args.all) {
    console.log(
      `ALL cadastre slugs: ${allSlugs.length}` +
        (args.shard ? ` | shard ${args.shard.index}/${args.shard.total} -> ${slugs.length}` : ""),
    );
  }

  const started = Date.now();
  const summaries: EnrichStats[] = [];
  const skipped: Array<{ slug: string; reason: string }> = [];
  for (const slug of slugs) {
    const elapsedSec = (Date.now() - started) / 1000;
    if (!args.verifyOnly && elapsedSec > args.timeBoxSec) {
      skipped.push({ slug, reason: `time-box ${args.timeBoxSec}s exceeded (elapsed ${elapsedSec.toFixed(0)}s)` });
      console.log(`SKIP ${slug} time-box exceeded`);
      continue;
    }
    try {
      const stats = args.verifyOnly ? await verifyOnly(s3, slug) : await runCity(s3, slug, args);
      summaries.push(stats);
      printSummary(stats);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      skipped.push({ slug, reason });
      console.log(`SKIP ${slug} ${reason}`);
    }
  }
  const failed = summaries.filter((s) => !s.verified_deposit?.exists);
  console.log(`DONE ok=${summaries.length} skipped=${skipped.length} failed_deposit=${failed.length}`);
  if (!args.all && failed.length > 0) {
    throw new Error(`deposit verification failed for ${failed.map((s) => s.slug).join(", ")}`);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
