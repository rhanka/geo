/**
 * Produce normalized data for @sentropic/geo-source-fr-postal.
 *
 * The La Poste codes-postaux CSV is **ISO-8859-1 (Latin-1)** encoded, but
 * `@sentropic/geo-acquire`'s `download().text()` decodes bytes as UTF-8, which
 * corrupts accented commune names. This script therefore mirrors the acquire CSV
 * pipeline locally while reusing geo-acquire's `download` (content-addressed
 * cache, gitignored), `parseCsv`, the package's `csvNormalizer`, and
 * `writeNormalized`, decoding the cached body as Latin-1 before parsing so the
 * on-disk output shape is identical to `acquire` + `writeNormalized` but with
 * correct text:
 *
 *   1. download the CSV (cached under .cache/geo-fr-postal/, gitignored),
 *   2. decode the bytes as Latin-1, parse RFC 4180 with the `;` delimiter,
 *   3. run the package's csvNormalizer → ReferentialFeatureCollection (null geom),
 *   4. assemble CollectionMeta (license/attribution/checksum) and
 *      writeNormalized() to data/normalized/<sourceSlug>/.
 *
 * Usage:  tsx scripts/produce.ts [--out <dir>]
 */

import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WGS84,
  attributionLine,
  getDataset,
  resolveManifestLicense,
  type CollectionMeta,
  type NormalizedDataset,
  type ReferentialFeatureCollection,
} from "@sentropic/geo-core";
import {
  download,
  parseCsv,
  writeNormalized,
} from "@sentropic/geo/acquire";
import type { NormalizeContext } from "@sentropic/geo-core";

import { DATASET_CODES_POSTAUX, manifest } from "../src/manifest.js";
import { codesPostauxNormalizer } from "../src/normalizers.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

const CACHE_DIR = join(repoRoot, ".cache", "geo-fr-postal");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const outDir = arg("--out") ?? join(repoRoot, "data", "normalized");

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(rec).sort()) sorted[k] = rec[k];
      return sorted;
    }
    return v;
  });
}

async function main(): Promise<void> {
  const dataset = getDataset(manifest, DATASET_CODES_POSTAUX);
  if (!dataset) throw new Error(`unknown dataset ${DATASET_CODES_POSTAUX}`);

  console.log(`[fr-postal] downloading ${dataset.url}`);
  const result = await download(dataset.url, { cacheDir: CACHE_DIR });
  console.log(
    `[fr-postal] ${result.fromCache ? "cache hit" : "fetched"} ` +
      `(${(result.body.byteLength / 1_000_000).toFixed(2)} MB) → ${result.cachePath}`,
  );

  // The file is Latin-1; decode accordingly (download().text() assumes UTF-8).
  const text = new TextDecoder("latin1").decode(result.body);

  const delimiter = dataset.query?.["delimiter"];
  const parseOpts =
    typeof delimiter === "string" && delimiter.length > 0 ? { delimiter } : undefined;
  const { rows } = parseCsv(text, parseOpts);
  console.log(`[fr-postal] parsed ${rows.length} CSV rows`);

  const ctx: NormalizeContext = { manifest, dataset };
  const collection: ReferentialFeatureCollection = codesPostauxNormalizer(rows, ctx);

  const license = resolveManifestLicense(manifest);
  const meta: CollectionMeta = {
    sourceId: manifest.id,
    datasetId: dataset.id,
    title: dataset.title,
    license,
    attribution: attributionLine(manifest.provider.name, license),
    crs: WGS84,
    fetchedAt: new Date().toISOString(),
    count: collection.features.length,
    checksum: {
      algo: "sha256",
      value: createHash("sha256").update(canonicalJson(collection)).digest("hex"),
    },
  };

  const normalized: NormalizedDataset<ReferentialFeatureCollection> = { meta, collection };
  const { geojsonPath, metaPath } = await writeNormalized(normalized, outDir);
  const { size } = await stat(geojsonPath);
  console.log(
    `[fr-postal] ${dataset.id}: ${collection.features.length} features → ${geojsonPath} ` +
      `(${(size / 1_000_000).toFixed(2)} MB)`,
  );
  console.log(`[fr-postal] meta → ${metaPath}`);
  console.log("[fr-postal] done.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
