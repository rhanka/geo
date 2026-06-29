/**
 * MANIFEST MERGE — reconcile the `qc-zonage-norms` manifest with the S3 parquet
 * truth, WITHOUT losing any concurrently-written stock entry.
 *
 * A concurrent residue/mass run deposits parquet products ONLY (via
 * `depositParquetOnly`), never touching the shared manifest, so it can never race
 * the stock run's read-modify-write. This tool runs AFTER the stock run is done
 * and folds every NEW parquet slug (not yet in the manifest) into the manifest,
 * reconstructing each entry from the parquet's own columns (zone_code rows +
 * _source_url/_reglement/_methode/_snapshot) and re-running SIG cross-validation.
 *
 * Anti-loss: it re-reads the manifest immediately before writing and merges into
 * THAT snapshot, only ADDING slugs that are absent — existing (stock) entries are
 * always preserved verbatim. Prints a verification (before/after, added, dropped=0).
 *
 * Usage: tsx src/zonage-norms-manifest-merge.ts [--apply] [--report <path>]
 */
import { writeFileSync } from "node:fs";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

import { s3Client, getBytes, exists, putBytes, BUCKET } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  crossValidateZoneCodes,
  gridKey,
  normsKey,
  ZONAGE_NORMS_MANIFEST_KEY,
  type Manifest,
  type ManifestEntry,
} from "./lib/zonage-norms.js";
import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

const NORM_VALUE_COLS = [
  "densite_value", "hauteur_min_value", "hauteur_max_value", "frontage_min_value",
  "superficie_min_value", "marge_avant_min_value", "marge_laterale_min_value", "marge_arriere_min_value",
];

async function listParquetSlugs(s3: S3Client): Promise<Set<string>> {
  const out = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "registry/qc-zonage-norms/", ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) {
      const k = o.Key ?? "";
      if (!k.endsWith(".parquet")) continue;
      const s = k.replace("registry/qc-zonage-norms/qc-zonage-norms-", "").replace(/\.parquet$/, "").replace(/\/.*/, "");
      if (s && !s.startsWith("manifest")) out.add(s);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function readManifest(s3: S3Client): Promise<Manifest> {
  if (await exists(s3, ZONAGE_NORMS_MANIFEST_KEY)) {
    const j = JSON.parse((await getBytes(s3, ZONAGE_NORMS_MANIFEST_KEY)).toString("utf8"));
    if (j && Array.isArray(j.entries)) return j as Manifest;
  }
  return { product: "qc-zonage-norms", updated_at: new Date().toISOString(), entries: [] };
}

/** Rebuild a manifest entry for a slug straight from its deposited parquet. */
async function entryFromParquet(s3: S3Client, slug: string): Promise<ManifestEntry | null> {
  const buf = await getBytes(s3, normsKey(slug));
  const rows = await readParquetRowsFromBuffer(buf);
  if (rows.length === 0) return null;
  const str = (v: unknown): string | undefined => (v == null ? undefined : String(v));
  const codes = new Set<string>();
  let publishedCells = 0;
  for (const r of rows) {
    const zc = str(r["zone_code"]);
    if (zc) codes.add(zc);
    for (const c of NORM_VALUE_COLS) if (r[c] != null) publishedCells++;
  }
  const r0 = rows[0]!;
  const pubPct = rows.length ? Math.round((publishedCells / (rows.length * 8)) * 1000) / 10 : 0;
  const fakeZones = [...codes].map((c) => ({ zone_code: c } as unknown as ZoneNormsT));
  const cross = await crossValidateZoneCodes(s3, slug, fakeZones);
  const reglement = str(r0["_reglement"]);
  return {
    slug,
    key: normsKey(slug),
    ...(reglement ? { reglement } : {}),
    source_url: str(r0["_source_url"]) ?? "non-disponible",
    methode: str(r0["_methode"]) ?? "ocr/mistral-ocr",
    snapshot: str(r0["_snapshot"]) ?? new Date().toISOString().slice(0, 10),
    zone_rows: rows.length,
    unique_zone_codes: codes.size,
    published_field_pct: pubPct,
    crossval: {
      gridFound: cross.gridFound,
      sigZoneCodes: cross.sigZoneCodes,
      overlap: cross.overlap,
      recoupExtracted: Math.round(cross.recoupExtracted * 1000) / 1000,
      recoupSig: Math.round(cross.recoupSig * 1000) / 1000,
    },
    deposited_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const reportPath = argv.indexOf("--report") >= 0 ? argv[argv.indexOf("--report") + 1] : undefined;
  const s3 = s3Client();

  const man0 = await readManifest(s3);
  const before = new Set(man0.entries.map((e) => e.slug));
  const parquetSlugs = await listParquetSlugs(s3);
  const newSlugs = [...parquetSlugs].filter((s) => !before.has(s)).sort();
  console.error(`[merge] manifest entries=${man0.entries.length} parquet slugs=${parquetSlugs.size} new=${newSlugs.length}`);

  const newEntries: ManifestEntry[] = [];
  const failed: string[] = [];
  for (const slug of newSlugs) {
    try {
      const e = await entryFromParquet(s3, slug);
      if (e) { newEntries.push(e); console.error(`[merge] + ${slug} rows=${e.zone_rows} uzc=${e.unique_zone_codes} pub%=${e.published_field_pct} overlap=${e.crossval?.overlap} method=${e.methode}`); }
      else failed.push(slug);
    } catch (err) { failed.push(slug); console.error(`[merge] ! ${slug}: ${(err as Error).message.slice(0, 80)}`); }
  }

  // Re-read the manifest IMMEDIATELY before writing (capture any stock writes that
  // landed during this run) and merge into THAT — only adding absent slugs.
  const manNow = await readManifest(s3);
  const bySlug = new Map(manNow.entries.map((e) => [e.slug, e]));
  let added = 0;
  for (const e of newEntries) if (!bySlug.has(e.slug)) { bySlug.set(e.slug, e); added++; }
  const merged = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));

  // Verification: no existing entry dropped.
  const droppedStock = manNow.entries.filter((e) => !merged.some((m) => m.slug === e.slug)).map((e) => e.slug);

  const report = {
    apply,
    manifestBefore: man0.entries.length,
    manifestNowBeforeWrite: manNow.entries.length,
    parquetSlugs: parquetSlugs.size,
    newParquetSlugs: newSlugs.length,
    reconstructed: newEntries.length,
    addedToManifest: added,
    manifestAfter: merged.length,
    droppedStock,
    failed,
    addedSlugs: newEntries.map((e) => e.slug),
  };
  console.error(`[merge] manifestAfter=${merged.length} added=${added} dropped=${droppedStock.length} failed=${failed.length}`);

  if (apply) {
    if (droppedStock.length > 0) throw new Error(`REFUSING to write: would drop ${droppedStock.length} stock entries`);
    const updated: Manifest = { product: "qc-zonage-norms", updated_at: new Date().toISOString(), entries: merged };
    await putBytes(s3, ZONAGE_NORMS_MANIFEST_KEY, JSON.stringify(updated, null, 2), "application/json");
    console.error("[merge] manifest WRITTEN");
  } else {
    console.error("[merge] DRY (pass --apply to write)");
  }
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
