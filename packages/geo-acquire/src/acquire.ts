/**
 * High-level acquisition: manifest + dataset id → {@link NormalizedDataset}.
 *
 * Pipeline: resolve the dataset → enforce the license gate → build the fetch
 * URL for the dataset's format → download (cached) → parse JSON → normalize to
 * an {@link AdminFeatureCollection} → assemble provenance {@link CollectionMeta}.
 * The license gate runs before any download, so non-redistributable data is
 * never fetched, returned, or persisted.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AdminFeatureCollection,
  CollectionMeta,
  NormalizedDataset,
  SourceManifest,
} from "@sentropic/geo-core";
import {
  WGS84,
  attributionLine,
  getDataset,
  resolveManifestLicense,
} from "@sentropic/geo-core";

import { arcgisQueryUrl } from "./arcgis.js";
import { type DownloadOptions, download, sha256Hex } from "./download.js";
import { assertRedistributable } from "./license-gate.js";
import { type NormalizeContext, type Normalizer, geojsonPassthrough } from "./normalize.js";

export interface AcquireOptions extends DownloadOptions {
  /** Override the normalizer. Defaults to {@link geojsonPassthrough}. */
  normalizer?: Normalizer;
}

/** Deterministic JSON serialization (sorted object keys) for stable checksums. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        sorted[key] = record[key];
      }
      return sorted;
    }
    return val;
  });
}

/**
 * Acquire and normalize a single dataset from a source manifest.
 *
 * @throws Error if the dataset id is unknown or the format is unsupported in V1.
 * @throws LicenseError if the source's license forbids redistribution.
 */
export async function acquire(
  manifest: SourceManifest,
  datasetId: string,
  opts: AcquireOptions = {},
): Promise<NormalizedDataset> {
  const dataset = getDataset(manifest, datasetId);
  if (!dataset) {
    throw new Error(
      `dataset "${datasetId}" not found in source "${manifest.id}" ` +
        `(available: ${manifest.datasets.map((d) => d.id).join(", ") || "none"})`,
    );
  }

  // License gate — before any network access or persistence.
  assertRedistributable(manifest);

  const url = resolveFetchUrl(manifest, datasetId);

  const downloadOpts: DownloadOptions = {};
  if (opts.cacheDir !== undefined) downloadOpts.cacheDir = opts.cacheDir;
  if (opts.force !== undefined) downloadOpts.force = opts.force;
  if (opts.fetchImpl !== undefined) downloadOpts.fetchImpl = opts.fetchImpl;
  if (opts.headers !== undefined) downloadOpts.headers = opts.headers;

  const result = await download(url, downloadOpts);

  let raw: unknown;
  try {
    raw = JSON.parse(result.text());
  } catch (cause) {
    throw new Error(
      `failed to parse JSON from ${url} (source "${manifest.id}", dataset "${datasetId}")`,
      { cause },
    );
  }

  const normalizer = opts.normalizer ?? geojsonPassthrough;
  const ctx: NormalizeContext = { manifest, dataset };
  const collection: AdminFeatureCollection = normalizer(raw, ctx);

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
    checksum: { algo: "sha256", value: sha256Hex(canonicalJson(collection)) },
  };

  return { meta, collection };
}

/** Resolve the download URL for a dataset based on its declared format. */
function resolveFetchUrl(manifest: SourceManifest, datasetId: string): string {
  const dataset = getDataset(manifest, datasetId);
  if (!dataset) {
    throw new Error(`dataset "${datasetId}" not found in source "${manifest.id}"`);
  }
  switch (dataset.format) {
    case "geojson":
      return dataset.url;
    case "arcgis-rest": {
      const layer = dataset.layer ?? 0;
      return arcgisQueryUrl(dataset.url, layer, dataset.query ?? {});
    }
    default:
      throw new Error(
        `format "${dataset.format}" is not yet supported in V1 ` +
          `(source "${manifest.id}", dataset "${datasetId}"). ` +
          `Supported formats: geojson, arcgis-rest.`,
      );
  }
}

/** Slugify a source id into a filesystem-safe directory segment. */
function sourceSlug(sourceId: string): string {
  return (
    sourceId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "source"
  );
}

/**
 * Persist a {@link NormalizedDataset} to disk:
 * `<dir>/<sourceSlug>/<datasetId>.geojson` (the FeatureCollection) plus a
 * sibling `.meta.json`. Data only reaches here after the license gate has
 * passed in {@link acquire}.
 */
export async function writeNormalized(
  dataset: NormalizedDataset,
  dir: string,
): Promise<{ geojsonPath: string; metaPath: string }> {
  const slug = sourceSlug(dataset.meta.sourceId);
  const outDir = join(dir, slug);
  await mkdir(outDir, { recursive: true });

  const geojsonPath = join(outDir, `${dataset.meta.datasetId}.geojson`);
  const metaPath = join(outDir, `${dataset.meta.datasetId}.meta.json`);

  await writeFile(geojsonPath, `${JSON.stringify(dataset.collection, null, 2)}\n`);
  await writeFile(metaPath, `${JSON.stringify(dataset.meta, null, 2)}\n`);

  return { geojsonPath, metaPath };
}
