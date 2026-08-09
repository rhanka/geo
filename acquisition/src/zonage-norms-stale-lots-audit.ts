/**
 * zonage-norms-stale-lots-audit.ts — READ-ONLY discovery.
 *
 * Identify municipalities that were crossval-FIXED by the numeric-vintage bridge
 * (commit 24552e9): their recorded manifest `crossval.overlap` is now > 0 (the
 * extracted grille DOES recoup the SIG grille), yet their already-SERVED
 * `qc-lots` product carries NO norms (`pct_with_norms == 0`) — a stale join that
 * predates the bridge and must be re-deposited (lot-zone-join + lots-enriched).
 *
 * It writes NOTHING. It only reads the norms manifest and the per-muni served
 * stats to bucket every overlap>0 slug into:
 *   - REFRESH   : served qc-lots exists but pct_with_norms == 0  → OUR set
 *   - ALREADY   : served qc-lots exists and pct_with_norms  > 0  → done
 *   - NO_SERVED : no served qc-lots at all                       → lots-immo-sweep set
 *
 * Usage:
 *   npx tsx acquisition/src/zonage-norms-stale-lots-audit.ts
 *   npx tsx acquisition/src/zonage-norms-stale-lots-audit.ts --exclude longueuil,vaudreuil-dorion
 *   npx tsx acquisition/src/zonage-norms-stale-lots-audit.ts --min-overlap 1 --report /tmp/audit.json
 */
import { writeFileSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";

import { s3Client, exists, getBytes, getJson } from "./lib/s3.js";
import { ZONAGE_NORMS_MANIFEST_KEY, type Manifest } from "./lib/zonage-norms.js";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const SERVED_STATS = (slug: string): string => `normalized/qc-lots/qc-lots-${slug}.stats.json`;
const SERVED_GEO = (slug: string): string => `normalized/qc-lots/qc-lots-${slug}.geojson`;
const ZONAGE_STATS = (slug: string): string => `normalized/qc-lot-zonage/${slug}.stats.json`;
const ZONAGE_PARQUET = (slug: string): string => `normalized/qc-lot-zonage/${slug}.parquet`;

interface Row {
  slug: string;
  overlap: number;
  field_pct: number;
  servedExists: boolean;
  served_pct_with_norms: number | null;
  served_num_lots: number | null;
  zonageParquetExists: boolean;
  zonage_match_rate: number | null;
  zonage_distinct_with_norms: number | null;
  bucket: "REFRESH" | "ALREADY" | "NO_SERVED";
}

async function readManifest(s3: S3Client): Promise<Manifest> {
  const j = JSON.parse((await getBytes(s3, ZONAGE_NORMS_MANIFEST_KEY)).toString("utf8"));
  return j as Manifest;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function probe(s3: S3Client, slug: string, overlap: number, fieldPct: number): Promise<Row> {
  const servedStatsExists = await exists(s3, SERVED_STATS(slug));
  let served_pct_with_norms: number | null = null;
  let served_num_lots: number | null = null;
  let servedExists = servedStatsExists;
  if (servedStatsExists) {
    const st = (await getJson(s3, SERVED_STATS(slug))) as Record<string, unknown>;
    served_pct_with_norms = typeof st["pct_with_norms"] === "number" ? (st["pct_with_norms"] as number) : null;
    served_num_lots = typeof st["num_lots"] === "number" ? (st["num_lots"] as number) : null;
  } else {
    servedExists = await exists(s3, SERVED_GEO(slug));
  }

  const zonageParquetExists = await exists(s3, ZONAGE_PARQUET(slug));
  let zonage_match_rate: number | null = null;
  let zonage_distinct_with_norms: number | null = null;
  if (await exists(s3, ZONAGE_STATS(slug))) {
    const zs = (await getJson(s3, ZONAGE_STATS(slug))) as Record<string, unknown>;
    zonage_match_rate = typeof zs["zone_code_match_rate"] === "number" ? (zs["zone_code_match_rate"] as number) : null;
    zonage_distinct_with_norms =
      typeof zs["distinct_zone_codes_with_norms"] === "number" ? (zs["distinct_zone_codes_with_norms"] as number) : null;
  }

  // Classify on the qc-lot-zonage PARQUET (the "AVEC qc-lots" product) + staleness,
  // which is the disjoint boundary vs lots-immo-sweep (it owns "SANS qc-lots" =
  // no qc-lot-zonage parquet). A parquet built BEFORE the numeric-vintage bridge
  // shows zone_code_match_rate == 0 (no norms joined) even though the manifest
  // overlap is now > 0 — that is our stale REFRESH set.
  //   REFRESH   : has qc-lot-zonage parquet AND norms NOT joined (match==0/unknown)
  //   ALREADY   : has qc-lot-zonage parquet AND norms joined (match>0)
  //   NO_SERVED : no qc-lot-zonage parquet at all → lots-immo-sweep set
  let bucket: Row["bucket"];
  if (!zonageParquetExists) bucket = "NO_SERVED";
  else if (zonage_match_rate !== null && zonage_match_rate > 0) bucket = "ALREADY";
  else bucket = "REFRESH";

  return {
    slug,
    overlap,
    field_pct: fieldPct,
    servedExists,
    served_pct_with_norms,
    served_num_lots,
    zonageParquetExists,
    zonage_match_rate,
    zonage_distinct_with_norms,
    bucket,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const minOverlap = Number(arg(argv, "min-overlap") ?? "1");
  const reportPath = arg(argv, "report");
  const excl = arg(argv, "exclude");
  const exclude = new Set((excl ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  const s3 = s3Client();
  const man = await readManifest(s3);
  const candidates = man.entries.filter((e) => (e.crossval?.overlap ?? 0) >= minOverlap && !exclude.has(e.slug));
  console.error(
    `[audit] manifest entries=${man.entries.length} overlap>=${minOverlap}=${candidates.length}` +
      (exclude.size ? ` (excluded ${exclude.size})` : ``),
  );

  const rows = await pool(candidates, 10, (e) => probe(s3, e.slug, e.crossval?.overlap ?? 0, e.published_field_pct ?? 0));
  rows.sort((a, b) => b.overlap - a.overlap);

  const refresh = rows.filter((r) => r.bucket === "REFRESH");
  const already = rows.filter((r) => r.bucket === "ALREADY");
  const noServed = rows.filter((r) => r.bucket === "NO_SERVED");

  for (const r of refresh) {
    console.error(
      `[REFRESH] ${r.slug}: overlap=${r.overlap} field%=${r.field_pct} ` +
        `served_norms%=${r.served_pct_with_norms} lots=${r.served_num_lots} ` +
        `zonage_parquet=${r.zonageParquetExists ? "Y" : "N"} match=${r.zonage_match_rate}`,
    );
  }

  // Serving gap: parquet has norms joined (match>0) but the SERVED qc-lots geojson
  // is missing or carries no norms — immo would not serve norms until lots-enriched
  // is re-run. Surfaced for coordination (not necessarily ours to run).
  const servingGap = rows.filter(
    (r) => r.zonageParquetExists && (r.zonage_match_rate ?? 0) > 0 && (!r.servedExists || r.served_pct_with_norms === 0),
  );

  const report = {
    manifestEntries: man.entries.length,
    minOverlap,
    excluded: [...exclude],
    counts: {
      refresh: refresh.length,
      already: already.length,
      noServed: noServed.length,
      servingGap: servingGap.length,
    },
    refreshSlugs: refresh.map((r) => r.slug),
    alreadySlugs: already.map((r) => r.slug),
    noServedSlugs: noServed.map((r) => r.slug),
    servingGapSlugs: servingGap.map((r) => r.slug),
    refreshDetail: refresh,
    servingGapDetail: servingGap,
  };
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
