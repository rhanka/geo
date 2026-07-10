/**
 * publish-norms-grilles.ts -- expose each deposited norms GRILLE as a SERVED OGC
 * collection under `normalized/qc-zonage-norms/`.
 *
 * PROBLEM this fixes: the norms products are deposited as parquet under
 * `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet`. geo-api only serves
 * objects under `normalized/` (env GEO_DATA_URI=s3://sentropic-geo/normalized),
 * mapping each `normalized/<coll>/<basename>.geojson` file to the OGC collection
 * `<basename>` (exactly like `normalized/qc-lots/qc-lots-<slug>.geojson`
 * → collection `qc-lots-<slug>`). So the norms grilles were NEVER served
 * (`/collections/qc-zonage-norms-<slug>/items` = 404 on all ~520 munis) and immo's
 * "Normes (grilles)" indicator was red everywhere despite the norms being present
 * (and correctly folded per-lot in qc-lots).
 *
 * WHAT this does: for each deposited `registry/qc-zonage-norms/<slug>.parquet`,
 * emit a served-ready FeatureCollection at
 *   normalized/qc-zonage-norms/qc-zonage-norms-<slug>.geojson  (collection id
 *   qc-zonage-norms-<slug>).
 * ONE Feature per zone_code. `properties` carry EVERY deposited norm column
 * verbatim (zone_page, usages, and for each of the 8 norm fields
 * {densite, hauteur_min, hauteur_max, frontage_min, superficie_min,
 *  marge_avant_min, marge_laterale_min, marge_arriere_min} the _value/_raw/_unit/
 * _confidence quad, plus _source_url/_reglement/_methode/_snapshot). `zone_code`
 * is kept and an immo alias `code_zone` (same real value) is added.
 *
 * GEOMETRY (best-effort, immo-approved): each zone's polygon is joined from the
 * muni's SIG grille `normalized/ca-qc-zonage/qc-zonage-<slug>.geojson` on the
 * CANONICAL zone_code (same `canonicalizeZoneCodeForJoin` the lot⋈norms join uses,
 * so the geometry a zone gets is exactly the geometry its lots got). A zone with
 * no SIG match — or a muni with no/oversized SIG grille — gets `geometry:null`
 * (a valid non-spatial GeoJSON feature; immo re-joins to qc-zonage on zone_code).
 * `--no-geom` skips the join entirely (fastest, geometry:null everywhere) to
 * unblock serving; re-run without it later to enrich the geometry.
 *
 * ANTI-INVENTION: every value is a verbatim passthrough of the deposited parquet
 * and the deposited SIG polygon. Nothing is fabricated; an absent cell is `null`.
 *
 * SINGLE process by design (geometry join parses one SIG grille per muni).
 *
 * Usage (npx tsx, from acquisition/):
 *   tsx src/publish-norms-grilles.ts --slugs mont-royal,saint-lambert
 *   tsx src/publish-norms-grilles.ts --all            # every deposited grille
 *   tsx src/publish-norms-grilles.ts --all --no-geom  # fast, geometry:null
 *   tsx src/publish-norms-grilles.ts --slugs delson --verify-only
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { S3Client } from "@aws-sdk/client-s3";
import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";

import { BUCKET, exists, getBytes, putBytes, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  ZONAGE_NORMS_PREFIX,
  canonZone,
  normsKey,
  resolveGridKey,
  SIG_ZONE_CODE_FIELDS,
} from "./lib/zonage-norms.js";

const OUT_PREFIX = "normalized/qc-zonage-norms/";

/** The 8 norm *_value columns — used to rank duplicate rows for a zone_code. */
const NORM_VALUE_COLS = [
  "densite_value",
  "hauteur_min_value",
  "hauteur_max_value",
  "frontage_min_value",
  "superficie_min_value",
  "marge_avant_min_value",
  "marge_laterale_min_value",
  "marge_arriere_min_value",
] as const;

/** Skip the geometry join when the SIG grille object exceeds this (single-process
 *  memory guard); such a muni is published NON-SPATIAL (geometry:null) + a note. */
const DEFAULT_MAX_GRID_MB = 150;

interface Args {
  slugs: string[];
  all: boolean;
  noUpload: boolean;
  verifyOnly: boolean;
  /** Skip the SIG geometry join entirely (fastest; geometry:null everywhere). */
  noGeom: boolean;
  maxGridMb: number;
  timeBoxSec: number;
  limit: number;
  shard: { index: number; total: number } | null;
}

interface PublishStats {
  slug: string;
  parquet_key: string;
  output_key: string;
  grid_key: string | null;
  num_zones: number;
  num_with_geometry: number;
  pct_with_geometry: number;
  num_with_norms: number;
  pct_with_norms: number;
  sig_codes: number;
  geom_skipped_reason: string | null;
  warnings: string[];
  example: Record<string, unknown> | null;
  verified_deposit?: { exists: boolean; bytes: number };
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let all = false;
  let noUpload = false;
  let verifyOnly = false;
  let noGeom = false;
  let maxGridMb = DEFAULT_MAX_GRID_MB;
  let timeBoxSec = 0; // 0 = unlimited (whole batch in one process)
  let limit = 0; // 0 = no limit
  let shard: { index: number; total: number } | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") all = true;
    else if (arg === "--slug") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--slugs") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--no-upload") noUpload = true;
    else if (arg === "--verify-only") verifyOnly = true;
    else if (arg === "--no-geom") noGeom = true;
    else if (arg === "--max-grid-mb") maxGridMb = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || DEFAULT_MAX_GRID_MB);
    else if (arg === "--time-box") timeBoxSec = Math.max(0, parseInt(String(argv[++i] ?? ""), 10) || 0);
    else if (arg === "--limit") limit = Math.max(0, parseInt(String(argv[++i] ?? ""), 10) || 0);
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
  return { slugs: uniqueSlugs, all, noUpload, verifyOnly, noGeom, maxGridMb, timeBoxSec, limit, shard };
}

function outKey(slug: string): string {
  return `${OUT_PREFIX}qc-zonage-norms-${slug}.geojson`;
}

function statsKey(slug: string): string {
  return `${OUT_PREFIX}qc-zonage-norms-${slug}.stats.json`;
}

/** Enumerate every deposited norms parquet slug (mirrors zonage-norms-manifest-merge). */
async function enumerateParquetSlugs(s3: S3Client): Promise<string[]> {
  const out = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ZONAGE_NORMS_PREFIX, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of r.Contents ?? []) {
      const k = o.Key ?? "";
      if (!k.endsWith(".parquet")) continue;
      const s = k
        .replace(`${ZONAGE_NORMS_PREFIX}qc-zonage-norms-`, "")
        .replace(/\.parquet$/, "")
        .replace(/\/.*/, "");
      if (s && !s.startsWith("manifest")) out.add(s);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return [...out].sort();
}

async function objectSizeBytes(s3: S3Client, key: string): Promise<number> {
  const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return typeof r.ContentLength === "number" ? r.ContentLength : 0;
}

/** Polygon rings of a geometry (Polygon or MultiPolygon); [] otherwise. */
function polygonsOf(geom: Geometry | null | undefined): Polygon["coordinates"][] {
  if (!geom) return [];
  if (geom.type === "Polygon") return [(geom as Polygon).coordinates];
  if (geom.type === "MultiPolygon") return (geom as MultiPolygon).coordinates;
  return [];
}

interface GeomIndex {
  /** canonical zone_code -> merged zone geometry (MultiPolygon) or null. */
  byCanon: Map<string, Geometry>;
  sigCodes: number;
}

/**
 * Build canonical-zone_code -> geometry from a muni's SIG grille geojson. A zone
 * may span several SIG features; their Polygon/MultiPolygon rings are merged into
 * one MultiPolygon. Only WHITELISTED code columns that are majority-plausible
 * codes contribute (mirrors the deposit cross-validation), so an affectation /
 * description column can never masquerade as the zone code.
 */
function buildGeomIndex(geojson: string): GeomIndex {
  const parsed = JSON.parse(geojson) as {
    features?: Array<{ geometry?: Geometry | null; properties?: Record<string, unknown> | null }>;
  };
  const features = parsed.features ?? [];

  // 1. Determine which whitelisted fields are genuine CODE columns (majority of
  //    their distinct values look like a plausible zone code).
  const byField = new Map<string, Set<string>>();
  for (const f of features) {
    const props = f.properties ?? {};
    for (const name of SIG_ZONE_CODE_FIELDS) {
      const v = props[name];
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s) continue;
      let set = byField.get(name);
      if (!set) byField.set(name, (set = new Set()));
      set.add(s);
    }
  }
  const codeCols = new Set<string>();
  for (const [name, values] of byField) {
    let plausible = 0;
    for (const v of values) if (plausibleCode(v)) plausible++;
    if (plausible * 2 >= values.size) codeCols.add(name);
  }

  // 2. Accumulate polygons per canonical code, then merge into one MultiPolygon.
  const polysByCanon = new Map<string, Polygon["coordinates"][]>();
  const rawCodes = new Set<string>();
  for (const f of features) {
    const polys = polygonsOf(f.geometry);
    if (polys.length === 0) continue;
    const props = f.properties ?? {};
    const canons = new Set<string>();
    for (const name of codeCols) {
      const v = props[name];
      if (v === null || v === undefined || !String(v).trim()) continue;
      rawCodes.add(String(v).trim());
      canons.add(canonZone(String(v)));
    }
    for (const canon of canons) {
      let arr = polysByCanon.get(canon);
      if (!arr) polysByCanon.set(canon, (arr = []));
      for (const p of polys) arr.push(p);
    }
  }
  const byCanon = new Map<string, Geometry>();
  for (const [canon, polys] of polysByCanon) {
    byCanon.set(canon, { type: "MultiPolygon", coordinates: polys } as MultiPolygon);
  }
  // Distinct canonical SIG codes actually observed on real code columns.
  const sigCanon = new Set<string>();
  for (const r of rawCodes) sigCanon.add(canonZone(r));
  return { byCanon, sigCodes: sigCanon.size };
}

/** Lenient "is this plausibly a zone code" test (local copy of the deposit lib's,
 *  kept private there). Rejects GUIDs and prose; accepts H-4, RA-415-1, "20 Ha". */
function plausibleCode(value: string): boolean {
  const s = value.trim();
  if (s.length === 0 || s.length > 24) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false;
  const core = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (core.split(/\s+/).length > 3) return false;
  return /[A-Za-z0-9]/.test(core);
}

/** Non-null count among the 8 norm *_value columns of a flat parquet row. */
function publishedCountRow(row: Record<string, unknown>): number {
  let n = 0;
  for (const c of NORM_VALUE_COLS) if (row[c] !== null && row[c] !== undefined) n++;
  return n;
}

/** Dedupe parquet rows by zone_code, keeping the row with more published norms. */
function dedupeByZone(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byZone = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  for (const row of rows) {
    const zc = row["zone_code"];
    if (zc === null || zc === undefined || !String(zc).trim()) continue;
    const key = String(zc);
    const prev = byZone.get(key);
    if (!prev) {
      byZone.set(key, row);
      order.push(key);
    } else if (publishedCountRow(row) > publishedCountRow(prev)) {
      byZone.set(key, row);
    }
  }
  return order.map((k) => byZone.get(k)!);
}

/** Build the served properties bag: every parquet column (undefined→null) + the
 *  immo `code_zone` alias. Verbatim passthrough — no fabrication. */
function normProperties(row: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) props[k] = v === undefined ? null : v;
  props["zone_code"] = row["zone_code"] ?? null;
  props["code_zone"] = row["zone_code"] ?? null; // immo contract alias (same real value)
  return props;
}

async function runCity(s3: S3Client, slug: string, args: Args): Promise<PublishStats> {
  const pKey = normsKey(slug);
  if (!(await exists(s3, pKey))) throw new Error(`no norms parquet: ${pKey}`);
  const rows = dedupeByZone(await readParquetRowsFromBuffer(await getBytes(s3, pKey)));
  if (rows.length === 0) throw new Error(`parquet has 0 zone_code rows`);

  // ── geometry index (best-effort) ────────────────────────────────────────────
  let geom: GeomIndex = { byCanon: new Map(), sigCodes: 0 };
  let gridKeyResolved: string | null = null;
  let geomSkippedReason: string | null = null;
  if (args.noGeom) {
    geomSkippedReason = "geometry join disabled (--no-geom)";
  } else {
    gridKeyResolved = await resolveGridKey(s3, slug);
    if (!gridKeyResolved) {
      geomSkippedReason = "no SIG grille on S3 (ca-qc-zonage) — non-spatial";
    } else {
      const gridMb = (await objectSizeBytes(s3, gridKeyResolved)) / 1e6;
      if (gridMb > args.maxGridMb) {
        geomSkippedReason = `SIG grille ${gridMb.toFixed(0)}MB > --max-grid-mb ${args.maxGridMb} — non-spatial`;
      } else {
        geom = buildGeomIndex((await getBytes(s3, gridKeyResolved)).toString("utf8"));
      }
    }
  }

  // Stream the FeatureCollection to a temp file (bounds peak memory on big grilles).
  const dir = await mkdtemp(join(tmpdir(), `qc-norms-${slug}-`));
  const path = join(dir, "out.geojson");
  const stream = createWriteStream(path, { encoding: "utf8" });
  const write = (chunk: string): Promise<void> =>
    new Promise((resolve, reject) => stream.write(chunk, (err) => (err ? reject(err) : resolve())));

  let numWithGeometry = 0;
  let numWithNorms = 0;
  let example: Record<string, unknown> | null = null;

  try {
    await write('{"type":"FeatureCollection","features":[');
    let first = true;
    for (const row of rows) {
      const zoneCode = String(row["zone_code"]);
      const g = geom.byCanon.get(canonZone(zoneCode)) ?? null;
      if (g) numWithGeometry++;
      if (publishedCountRow(row) > 0) numWithNorms++;
      const props = normProperties(row);
      const feature: Feature = { type: "Feature", id: zoneCode, geometry: g, properties: props };
      await write((first ? "" : ",") + JSON.stringify(feature));
      first = false;
      if (!example && publishedCountRow(row) > 0) {
        example = {
          zone_code: props["zone_code"],
          has_geometry: g !== null,
          usages: props["usages"],
          hauteur_max_value: props["hauteur_max_value"],
          densite_value: props["densite_value"],
          marge_avant_min_value: props["marge_avant_min_value"],
          frontage_min_value: props["frontage_min_value"],
          superficie_min_value: props["superficie_min_value"],
        };
      }
    }
    await write("]}");
    await new Promise<void>((resolve, reject) => stream.end((err?: Error | null) => (err ? reject(err) : resolve())));

    const numZones = rows.length;
    const pctGeom = numZones ? round2((100 * numWithGeometry) / numZones) : 0;
    const pctNorms = numZones ? round2((100 * numWithNorms) / numZones) : 0;
    const warnings: string[] = [];
    if (geomSkippedReason && !args.noGeom) warnings.push(geomSkippedReason);
    if (!geomSkippedReason && !args.noGeom && pctGeom === 0) {
      warnings.push(`0% geometry join (SIG has ${geom.sigCodes} codes, none matched) — non-spatial`);
    }
    if (pctNorms === 0) warnings.push(`0% zones carry a published norm value`);

    const stats: PublishStats = {
      slug,
      parquet_key: pKey,
      output_key: outKey(slug),
      grid_key: gridKeyResolved,
      num_zones: numZones,
      num_with_geometry: numWithGeometry,
      pct_with_geometry: pctGeom,
      num_with_norms: numWithNorms,
      pct_with_norms: pctNorms,
      sig_codes: geom.sigCodes,
      geom_skipped_reason: geomSkippedReason,
      warnings,
      example,
    };

    if (!args.noUpload) {
      const body = await readFile(path);
      await putBytes(s3, outKey(slug), body, "application/geo+json");
      await putBytes(s3, statsKey(slug), Buffer.from(JSON.stringify(stats, null, 2), "utf8"), "application/json");
      stats.verified_deposit = await verifyDeposit(s3, slug);
    } else {
      const st = await stat(path);
      stats.verified_deposit = { exists: true, bytes: st.size };
    }
    return stats;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function verifyDeposit(s3: S3Client, slug: string): Promise<{ exists: boolean; bytes: number }> {
  const key = outKey(slug);
  if (!(await exists(s3, key))) return { exists: false, bytes: 0 };
  return { exists: true, bytes: await objectSizeBytes(s3, key) };
}

async function verifyOnly(s3: S3Client, slug: string): Promise<PublishStats> {
  const sKey = statsKey(slug);
  if (!(await exists(s3, sKey))) throw new Error(`stats not found: ${sKey}`);
  const stats = JSON.parse((await getBytes(s3, sKey)).toString("utf8")) as PublishStats;
  stats.verified_deposit = await verifyDeposit(s3, slug);
  return stats;
}

function printSummary(stats: PublishStats): void {
  const v = stats.verified_deposit;
  console.log(
    [
      `OK ${stats.slug}`,
      `zones=${stats.num_zones}`,
      `geometry=${stats.pct_with_geometry}%(${stats.num_with_geometry})`,
      `norms=${stats.pct_with_norms}%`,
      `sig=${stats.sig_codes}`,
      v ? `deposit=${v.exists ? "Y" : "N"} bytes=${v.bytes}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (stats.warnings.length > 0) console.log(`WARN ${stats.slug} ${stats.warnings.join("; ")}`);
  if (stats.example) console.log(`EXAMPLE ${stats.slug} ${JSON.stringify(stats.example)}`);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  const allSlugs = args.all ? await enumerateParquetSlugs(s3) : args.slugs;
  let slugs = args.shard ? allSlugs.filter((_, i) => i % args.shard!.total === args.shard!.index) : allSlugs;
  if (args.limit > 0) slugs = slugs.slice(0, args.limit);
  if (args.all) {
    console.log(
      `ALL deposited norms slugs: ${allSlugs.length}` +
        (args.shard ? ` | shard ${args.shard.index}/${args.shard.total} -> ${slugs.length}` : "") +
        (args.limit > 0 ? ` | limit ${args.limit}` : "") +
        (args.noGeom ? " | --no-geom (geometry:null)" : ` | geom join (max-grid ${args.maxGridMb}MB)`),
    );
  }

  const started = Date.now();
  const summaries: PublishStats[] = [];
  const skipped: Array<{ slug: string; reason: string }> = [];
  let withGeom = 0;
  for (const slug of slugs) {
    const elapsedSec = (Date.now() - started) / 1000;
    if (!args.verifyOnly && args.timeBoxSec > 0 && elapsedSec > args.timeBoxSec) {
      skipped.push({ slug, reason: `time-box ${args.timeBoxSec}s exceeded` });
      console.log(`SKIP ${slug} time-box exceeded`);
      continue;
    }
    try {
      const stats = args.verifyOnly ? await verifyOnly(s3, slug) : await runCity(s3, slug, args);
      summaries.push(stats);
      if (stats.num_with_geometry > 0) withGeom++;
      printSummary(stats);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      skipped.push({ slug, reason });
      console.log(`SKIP ${slug} ${reason}`);
    }
  }
  const failed = summaries.filter((s) => !s.verified_deposit?.exists);
  const totalZones = summaries.reduce((a, s) => a + s.num_zones, 0);
  console.log(
    `DONE ok=${summaries.length} withGeometry=${withGeom} skipped=${skipped.length} ` +
      `failed_deposit=${failed.length} totalZones=${totalZones}`,
  );
  for (const s of skipped) console.log(`  SKIP ${s.slug}: ${s.reason}`);
  if (!args.all && failed.length > 0) {
    throw new Error(`deposit verification failed for ${failed.map((s) => s.slug).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
