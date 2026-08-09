#!/usr/bin/env node

/**
 * Live Lot 1 collection for the Saint-Amable zoning-PDF staging (BR-1).
 *
 * Lot 1's kernel (`collectZonePdfContentManifest`) was only ever exercised by
 * tests: nothing committed drove it against the real FeatureService, so the
 * 109/109 acceptance could not run. This CLI is that missing entry point and
 * nothing more — it reads the source, validates every PDF and writes the
 * content manifest. It imports no S3 client and exposes no publish flag (D12).
 *
 * On rejection it prints the full diagnostic (code + details) instead of a
 * stack, so a single run identifies the offending OID / zone / item.
 *
 *   npx tsx acquisition/src/saint-amable-lot1-collect.ts --out <manifest.json>
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ArcgisZonePdfStageError,
  SAINT_AMABLE_ZONEPDF_SOURCE,
  collectZonePdfContentManifest,
  fetchPinnedArcgisPdfDownload,
  querySourceRecordsByOidChunks,
  readPdfPageCount,
  readSourceFence,
} from "./lib/arcgis-zonepdf-stage.js";

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * Measure the real page-count distribution over the 109 official grids, without the
 * one-page gate. HCV-191 proved a grid may legitimately continue onto a second page
 * (same zone, extra variant columns), so the blast radius must be measured before the
 * invariant is redesigned. Read-only: downloads and counts, writes nothing but stdout.
 */
async function survey(): Promise<number> {
  const fence = await readSourceFence(fetch, SAINT_AMABLE_ZONEPDF_SOURCE);
  const records = await querySourceRecordsByOidChunks(fetch, fence, SAINT_AMABLE_ZONEPDF_SOURCE);
  console.error(`[survey] records=${records.length}`);
  const distribution = new Map<number, number>();
  const multiPage: { oid: number; code: string; pageCount: number; pageObjectCount: number }[] = [];
  for (const record of records) {
    const download = await fetchPinnedArcgisPdfDownload(fetch, record, SAINT_AMABLE_ZONEPDF_SOURCE);
    const text = Buffer.from(await download.response.arrayBuffer()).toString("latin1");
    const { pageCount, pageObjectCount } = readPdfPageCount(text);
    distribution.set(pageCount, (distribution.get(pageCount) ?? 0) + 1);
    if (pageCount !== 1) multiPage.push({ oid: record.oid, code: record.code, pageCount, pageObjectCount });
  }
  console.log(`pageCount distribution: ${JSON.stringify(Object.fromEntries([...distribution].sort()))}`);
  console.log(`multi-page grids: ${multiPage.length}`);
  for (const zone of multiPage) {
    console.log(`  oid=${zone.oid} code=${zone.code} pages=${zone.pageCount} objects=${zone.pageObjectCount}`);
  }
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const out = arg(argv, "out");
  const started = Date.now();
  if (argv.includes("--survey")) return survey();
  console.error(
    `[lot1] source=${SAINT_AMABLE_ZONEPDF_SOURCE.layerUrl} expected=${SAINT_AMABLE_ZONEPDF_SOURCE.expectedCount}`,
  );
  try {
    const manifest = await collectZonePdfContentManifest(fetch);
    console.log(
      `OK records=${manifest.records.length} fenceT0=${manifest.sourceT0.count} fenceT1=${manifest.sourceT1.count} elapsed=${Math.round((Date.now() - started) / 1000)}s`,
    );
    const pages = new Map<number, number>();
    for (const record of manifest.records) {
      pages.set(record.pdf.pageCount, (pages.get(record.pdf.pageCount) ?? 0) + 1);
    }
    console.log(`pageCount distribution: ${JSON.stringify(Object.fromEntries(pages))}`);
    if (out !== undefined) {
      const path = resolve(out);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
      console.log(`manifest -> ${path}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ArcgisZonePdfStageError) {
      console.error(`REJECTED ${error.code}: ${error.message}`);
      console.error(`details: ${JSON.stringify(error.details, null, 2)}`);
      const cause = (error as { cause?: unknown }).cause;
      if (cause instanceof ArcgisZonePdfStageError) {
        console.error(`cause ${cause.code}: ${JSON.stringify(cause.details, null, 2)}`);
      }
      return 1;
    }
    console.error(error instanceof Error ? error.stack : String(error));
    return 1;
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
