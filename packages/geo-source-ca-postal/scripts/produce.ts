/**
 * Produce normalized data for @sentropic/geo-source-ca-postal.
 *
 * Drives the standard geometry-bearing referential acquisition end-to-end and
 * writes the normalized output to `data/normalized/<sourceSlug>/`:
 *
 *   1. acquire(manifest, "ca-fsa", { referentialNormalizer }) — geo-acquire
 *      downloads (content-addressed cache, gitignored) the FSA zip, runs GDAL
 *      (`ogrinfo`/`ogr2ogr`, `/vsizip/` with the nested `query.inner` .shp,
 *      `-t_srs EPSG:4326 -simplify <query.simplify>`), parses the WGS84 GeoJSON,
 *      and runs the package's referentialNormalizer → ReferentialFeatureCollection
 *      (geometry KEPT) with CollectionMeta (license/attribution/checksum),
 *   2. writeNormalized() → data/normalized/ca-statcan-fsa/ca-fsa.{geojson,meta.json}.
 *
 * The geometry payload (~1 643 FSA polygons, multi-MB) is for S3 (ADR-0012), not
 * git — this script reproduces it on demand; it is not a committed artifact.
 *
 * Usage:  tsx scripts/produce.ts [--out <dir>]
 */

import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { acquire, writeNormalized } from "@sentropic/geo/acquire";

import { DATASET_FSA, manifest } from "../src/manifest.js";
import { fsaReferentialNormalizer } from "../src/normalizers.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

const CACHE_DIR = join(repoRoot, ".cache", "geo-ca-postal");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const outDir = arg("--out") ?? join(repoRoot, "data", "normalized");

async function main(): Promise<void> {
  console.log(`[ca-postal] acquiring ${DATASET_FSA} from ${manifest.id}`);
  const normalized = await acquire(manifest, DATASET_FSA, {
    cacheDir: CACHE_DIR,
    referentialNormalizer: fsaReferentialNormalizer,
  });

  const { geojsonPath, metaPath } = await writeNormalized(normalized, outDir);
  const { size } = await stat(geojsonPath);
  console.log(
    `[ca-postal] ${DATASET_FSA}: ${normalized.collection.features.length} features → ` +
      `${geojsonPath} (${(size / 1_000_000).toFixed(2)} MB)`,
  );
  console.log(`[ca-postal] meta → ${metaPath}`);
  console.log("[ca-postal] done.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
