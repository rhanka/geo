/**
 * One-off acquisition driver for @sentropic/geo-source-ca.
 *
 * Runs the real geo-acquire pipeline for `ca-provinces`:
 *   download (cached) → ogr2ogr reproject EPSG:3347→4326 + simplify → normalize
 *   → writeNormalized to data/normalized/<sourceSlug>/.
 *
 * Not part of the package build/test; kept for reproducible refreshes. Run from
 * the repo root:  node packages/geo-source-ca/scripts/acquire.mjs [datasetId]
 */

import { acquire, writeNormalized } from "@sentropic/geo-acquire";
import { manifest, normalizers } from "@sentropic/geo-source-ca";

const datasetId = process.argv[2] ?? "ca-provinces";
const outDir = "data/normalized";

const normalizer = normalizers[datasetId];
if (!normalizer) {
  console.error(`no normalizer for dataset "${datasetId}"`);
  process.exit(1);
}

console.error(`acquiring ${manifest.id} / ${datasetId} …`);
const dataset = await acquire(manifest, datasetId, { normalizer });
const { geojsonPath, metaPath } = await writeNormalized(dataset, outDir);

console.error(`features: ${dataset.collection.features.length}`);
console.error(`wrote: ${geojsonPath}`);
console.error(`wrote: ${metaPath}`);
