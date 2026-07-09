/**
 * qc-lots-gap.ts -- audit which served munis lack an up-to-date qc-lots product.
 *
 * A muni is "servi" when it has a zones layer (normalized/ca-qc-zonage/) and/or a
 * norms grille (registry/qc-zonage-norms/). The served-ready enriched product is
 * normalized/qc-lots/qc-lots-<slug>.geojson, built by:
 *   lot-zone-join-run.ts  -> normalized/qc-lot-zonage/<slug>.parquet
 *   lots-enriched-run.ts  -> normalized/qc-lots/qc-lots-<slug>.geojson
 *
 * This is a PURE READ audit (no mutation). It lists the four prefixes with their
 * S3 LastModified, then flags a served muni as needing a rebuild when its
 * qc-lots geojson is MISSING or OLDER than its freshest source (zones or norms).
 * It emits paste-ready batches sorted newest-source-first, so freshly served
 * MRCs (e.g. Antoine-Labelle) surface at the top.
 *
 *   npx tsx acquisition/src/qc-lots-gap.ts [--batch 18] [--limit N] [--json]
 */
import { pathToFileURL } from "node:url";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";

const ZONES_PREFIX = "normalized/ca-qc-zonage/";
const NORMS_PREFIX = "registry/qc-zonage-norms/";
const ZONAGE_PREFIX = "normalized/qc-lot-zonage/";
const LOTS_PREFIX = "normalized/qc-lots/";
const CAD_PREFIX = "normalized/qc-cadastre-lots/";

type SlugTime = Map<string, number>;

interface Args {
  batch: number;
  limit: number | null;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  let batch = 18;
  let limit: number | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--batch") batch = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || 18);
    else if (a === "--limit") limit = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || 0) || null;
    else if (a === "--json") json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return { batch, limit, json };
}

/** List every key under `prefix`, keeping the newest LastModified per slug that
 *  `extract` derives from a key. */
async function listSlugTimes(
  s3: ReturnType<typeof s3Client>,
  prefix: string,
  extract: (key: string) => string | null,
): Promise<SlugTime> {
  const out: SlugTime = new Map();
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of r.Contents ?? []) {
      const key = o.Key ?? "";
      const slug = extract(key);
      if (!slug) continue;
      const t = o.LastModified ? o.LastModified.getTime() : 0;
      const prev = out.get(slug);
      if (prev === undefined || t > prev) out.set(slug, t);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

function iso(t: number): string {
  return t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "-";
}

export interface GapRow {
  slug: string;
  srcTime: number; // freshest source (zones|norms)
  hasZones: boolean;
  hasNorms: boolean;
  hasCad: boolean;
  lotsTime: number | undefined;
  reason: "missing" | "stale";
}

export interface GapResult {
  served: number;
  zones: number;
  norms: number;
  qc_lots_deposited: number;
  qc_lot_zonage_deposited: number;
  up_to_date: number;
  rows: GapRow[]; // ordered newest-source-first
  norms_only: string[];
}

/**
 * PURE S3 read: compute which served munis need a qc-lots (re)build. Reusable by
 * qc-lots-backfill.ts so a backfill can build its own plan directly from the gap
 * (no hand-authored plan file per wave).
 */
export async function computeGap(s3: ReturnType<typeof s3Client>): Promise<GapResult> {
  // Match both the flat qc-zonage-<slug>.geojson and the subdir variant
  // qc-zonage-<slug>/qc-zonage-<slug>.geojson; ignore .stats.json etc.
  const zones = await listSlugTimes(s3, ZONES_PREFIX, (k) => k.match(/qc-zonage-([^/]+)\.geojson$/)?.[1] ?? null);
  const norms = await listSlugTimes(s3, NORMS_PREFIX, (k) => k.match(/qc-zonage-norms-([^/]+)\.parquet$/)?.[1] ?? null);
  const zonage = await listSlugTimes(s3, ZONAGE_PREFIX, (k) => k.match(/qc-lot-zonage\/([^/]+)\.parquet$/)?.[1] ?? null);
  const lots = await listSlugTimes(s3, LOTS_PREFIX, (k) => k.match(/qc-lots-([^/]+)\.geojson$/)?.[1] ?? null);
  const cad = await listSlugTimes(s3, CAD_PREFIX, (k) => {
    const rest = k.slice(CAD_PREFIX.length);
    if (rest.includes("/") || !rest.endsWith(".geojson")) return null;
    return rest.slice(0, -".geojson".length);
  });

  const served = new Set<string>([...zones.keys(), ...norms.keys()]);
  const gap: GapRow[] = [];
  const normsOnly: string[] = []; // served by norms but no zones -> not producible
  let upToDate = 0;

  for (const slug of served) {
    const hasZones = zones.has(slug);
    const hasNorms = norms.has(slug);
    const srcTime = Math.max(zones.get(slug) ?? 0, norms.get(slug) ?? 0);
    const lotsTime = lots.get(slug);
    const needs = lotsTime === undefined || lotsTime < srcTime;
    if (!needs) {
      upToDate += 1;
      continue;
    }
    if (!hasZones) {
      // norms grille with no zones layer -> lot-zone join has no geometry to
      // assign zone_code from, so qc-lots enrichment is not producible here.
      normsOnly.push(slug);
      continue;
    }
    gap.push({
      slug,
      srcTime,
      hasZones,
      hasNorms,
      hasCad: cad.has(slug),
      lotsTime,
      reason: lotsTime === undefined ? "missing" : "stale",
    });
  }

  // Newest served source first -> freshly deposited MRCs bubble up.
  gap.sort((a, b) => b.srcTime - a.srcTime);
  return {
    served: served.size,
    zones: zones.size,
    norms: norms.size,
    qc_lots_deposited: lots.size,
    qc_lot_zonage_deposited: zonage.size,
    up_to_date: upToDate,
    rows: gap,
    norms_only: normsOnly.sort(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  const r = await computeGap(s3);
  const chosen = args.limit ? r.rows.slice(0, args.limit) : r.rows;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          served: r.served,
          zones: r.zones,
          norms: r.norms,
          qc_lots_deposited: r.qc_lots_deposited,
          qc_lot_zonage_deposited: r.qc_lot_zonage_deposited,
          up_to_date: r.up_to_date,
          gap: r.rows.length,
          norms_only_not_producible: r.norms_only.length,
          gap_slugs: r.rows.map((x) => x.slug),
          norms_only: r.norms_only,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `SERVED zones=${r.zones} norms=${r.norms} union=${r.served} | ` +
      `qc-lot-zonage=${r.qc_lot_zonage_deposited} qc-lots=${r.qc_lots_deposited} | ` +
      `up_to_date=${r.up_to_date} GAP=${r.rows.length} norms_only_not_producible=${r.norms_only.length}`,
  );
  const missing = r.rows.filter((x) => x.reason === "missing").length;
  const noCad = r.rows.filter((x) => !x.hasCad).length;
  console.log(`GAP breakdown: missing=${missing} stale=${r.rows.length - missing} | gap_without_exact_cadastre=${noCad}`);

  for (const x of chosen) {
    console.log(
      `NEED ${x.slug} reason=${x.reason} src=${iso(x.srcTime)} lots=${iso(x.lotsTime ?? 0)} ` +
        `norms=${x.hasNorms ? "Y" : "N"} cad=${x.hasCad ? "Y" : "N"}`,
    );
  }

  const batchSlugs = chosen.map((x) => x.slug);
  const nBatches = Math.ceil(batchSlugs.length / args.batch);
  for (let b = 0; b < nBatches; b++) {
    const part = batchSlugs.slice(b * args.batch, (b + 1) * args.batch);
    console.log(`BATCH ${b + 1}/${nBatches} (${part.length}) ${part.join(",")}`);
  }
  if (r.norms_only.length > 0) {
    console.log(`NORMS_ONLY (no zones, skipped) ${r.norms_only.join(",")}`);
  }
}

// Only run the audit when invoked directly (not when imported for computeGap).
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
