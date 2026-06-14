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
  ReferentialFeatureCollection,
  SourceManifest,
} from "@sentropic/geo-core";
// Type-only import: geo-acquire writes through the Store *interface* and never
// pulls in @aws-sdk. `verbatimModuleSyntax` + `import type` guarantee this is
// erased at build time, so no runtime dependency on geo-storage is emitted.
import type { Store } from "../storage/index.js";
import {
  WGS84,
  attributionLine,
  getDataset,
  resolveManifestLicense,
} from "@sentropic/geo-core";

import { arcgisQueryUrl } from "./arcgis.js";
import { type CsvNormalizer, parseCsv } from "./csv.js";
import { type DownloadOptions, download, sha256Hex } from "./download.js";
import {
  DEFAULT_SIMPLIFY_TOLERANCE,
  type CommandRunner,
  type GdalFormat,
  archiveKindFromPath,
  extractLayerToGeoJson,
} from "./gdal.js";
import { assertRedistributable } from "./license-gate.js";
import { type NormalizeContext, type Normalizer, geojsonPassthrough } from "./normalize.js";

export interface AcquireOptions extends DownloadOptions {
  /** Override the normalizer. Defaults to {@link geojsonPassthrough}. */
  normalizer?: Normalizer;
  /**
   * CSV normalizer, **required** when the dataset's format is `csv`: maps parsed
   * rows to a {@link ReferentialFeatureCollection}. `acquire` throws if a CSV
   * dataset is acquired without one.
   */
  csvNormalizer?: CsvNormalizer;
  /**
   * Referential normalizer for a geometry-bearing bulk source (`gpkg`/`shp`/`fgdb`):
   * maps the `ogr2ogr` GeoJSON to a {@link ReferentialFeatureCollection}. When set,
   * it takes precedence over `normalizer` on the GDAL path — for sources whose
   * features are referential (e.g. StatCan FSA postal areas) rather than
   * administrative units.
   */
  referentialNormalizer?: (raw: unknown, ctx: NormalizeContext) => ReferentialFeatureCollection;
  /** Injected GDAL command runner for bulk formats (tests). */
  gdalRunner?: CommandRunner;
}

/** Bulk vector formats acquired via GDAL (archive download + ogr2ogr). */
const GDAL_FORMATS: ReadonlySet<string> = new Set<GdalFormat>(["gpkg", "shp", "fgdb"]);

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
): Promise<NormalizedDataset<AdminFeatureCollection | ReferentialFeatureCollection>> {
  const dataset = getDataset(manifest, datasetId);
  if (!dataset) {
    throw new Error(
      `dataset "${datasetId}" not found in source "${manifest.id}" ` +
        `(available: ${manifest.datasets.map((d) => d.id).join(", ") || "none"})`,
    );
  }

  // License gate — before any network access or persistence.
  assertRedistributable(manifest);

  const downloadOpts: DownloadOptions = {};
  if (opts.cacheDir !== undefined) downloadOpts.cacheDir = opts.cacheDir;
  if (opts.force !== undefined) downloadOpts.force = opts.force;
  if (opts.fetchImpl !== undefined) downloadOpts.fetchImpl = opts.fetchImpl;
  if (opts.headers !== undefined) downloadOpts.headers = opts.headers;

  const ctx: NormalizeContext = { manifest, dataset };
  let collection: AdminFeatureCollection | ReferentialFeatureCollection;

  if (dataset.format === "csv") {
    collection = await acquireCsv(manifest, datasetId, downloadOpts, opts.csvNormalizer, ctx);
  } else {
    const raw = GDAL_FORMATS.has(dataset.format)
      ? await acquireRawViaGdal(manifest, datasetId, downloadOpts, opts.gdalRunner)
      : await acquireRawViaJson(manifest, datasetId, downloadOpts);
    if (GDAL_FORMATS.has(dataset.format) && opts.referentialNormalizer) {
      // Geometry-bearing referential source (e.g. StatCan FSA): emit a
      // ReferentialFeatureCollection rather than admin units.
      collection = opts.referentialNormalizer(raw, ctx);
    } else {
      const normalizer = opts.normalizer ?? geojsonPassthrough;
      collection = normalizer(raw, ctx);
    }
  }

  return assembleDataset(manifest, dataset.id, dataset.title, collection);
}

/**
 * Acquire a CSV referential dataset: download (cached) the file, parse it with
 * the RFC 4180 parser (delimiter from `dataset.query.delimiter`, default `,`),
 * then run the caller-supplied {@link CsvNormalizer} to produce a
 * {@link ReferentialFeatureCollection}.
 *
 * @throws Error when no `csvNormalizer` was provided (it is required for CSV).
 */
async function acquireCsv(
  manifest: SourceManifest,
  datasetId: string,
  downloadOpts: DownloadOptions,
  csvNormalizer: CsvNormalizer | undefined,
  ctx: NormalizeContext,
): Promise<ReferentialFeatureCollection> {
  if (!csvNormalizer) {
    throw new Error(
      `format "csv" requires an AcquireOptions.csvNormalizer ` +
        `(source "${manifest.id}", dataset "${datasetId}"). ` +
        `Provide one that maps parsed rows to a ReferentialFeatureCollection.`,
    );
  }
  const dataset = ctx.dataset;
  const result = await download(dataset.url, downloadOpts);

  const rawDelimiter = dataset.query?.["delimiter"];
  const parseOpts =
    typeof rawDelimiter === "string" && rawDelimiter.length > 0
      ? { delimiter: rawDelimiter }
      : undefined;
  const { rows } = parseCsv(result.text(), parseOpts);

  return csvNormalizer(rows, ctx);
}

/** Build the provenance {@link CollectionMeta} envelope around a normalized collection. */
function assembleDataset(
  manifest: SourceManifest,
  datasetId: string,
  title: string,
  collection: AdminFeatureCollection | ReferentialFeatureCollection,
): NormalizedDataset<AdminFeatureCollection | ReferentialFeatureCollection> {
  const license = resolveManifestLicense(manifest);
  const meta: CollectionMeta = {
    sourceId: manifest.id,
    datasetId,
    title,
    license,
    attribution: attributionLine(manifest.provider.name, license),
    crs: WGS84,
    fetchedAt: new Date().toISOString(),
    count: collection.features.length,
    checksum: { algo: "sha256", value: sha256Hex(canonicalJson(collection)) },
  };
  return { meta, collection };
}

/**
 * Acquire a raw GeoJSON payload for a JSON-over-HTTP dataset (`geojson` /
 * `arcgis-rest`). Downloads (cached) and parses the body as JSON.
 */
async function acquireRawViaJson(
  manifest: SourceManifest,
  datasetId: string,
  downloadOpts: DownloadOptions,
): Promise<unknown> {
  const url = resolveFetchUrl(manifest, datasetId);
  const result = await download(url, downloadOpts);
  try {
    return JSON.parse(result.text());
  } catch (cause) {
    throw new Error(
      `failed to parse JSON from ${url} (source "${manifest.id}", dataset "${datasetId}")`,
      { cause },
    );
  }
}

/**
 * Acquire a raw GeoJSON payload for a bulk vector dataset (`gpkg` / `shp` /
 * `fgdb`) via GDAL. Downloads (cached) the archive, then reprojects the
 * requested layer to WGS84 GeoJSON with `ogr2ogr`.
 */
async function acquireRawViaGdal(
  manifest: SourceManifest,
  datasetId: string,
  downloadOpts: DownloadOptions,
  runner: CommandRunner | undefined,
): Promise<unknown> {
  const dataset = getDataset(manifest, datasetId);
  if (!dataset) {
    throw new Error(`dataset "${datasetId}" not found in source "${manifest.id}"`);
  }
  if (typeof dataset.layer !== "string" || dataset.layer.length === 0) {
    throw new Error(
      `dataset "${datasetId}" (format "${dataset.format}") requires a string "layer" ` +
        `naming the layer to extract (source "${manifest.id}").`,
    );
  }

  const result = await download(dataset.url, downloadOpts);

  const tolerance =
    typeof dataset.query?.["simplify"] === "number"
      ? (dataset.query["simplify"] as number)
      : DEFAULT_SIMPLIFY_TOLERANCE;

  const extractOpts: Parameters<typeof extractLayerToGeoJson>[0] = {
    archivePath: result.cachePath,
    layer: dataset.layer,
    tolerance,
    archiveKind: archiveKindFromPath(dataset.url),
  };
  const inner = dataset.query?.["inner"];
  if (typeof inner === "string") extractOpts.inner = inner;
  if (runner !== undefined) extractOpts.runner = runner;

  const { geojson } = await extractLayerToGeoJson(extractOpts);
  return geojson;
}

/** Resolve the download URL for a JSON-over-HTTP dataset's declared format. */
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
          `Supported formats: geojson, arcgis-rest, gpkg, shp, fgdb.`,
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
 *
 * The FeatureCollection is written **compactly** (no pretty-print): geometry
 * coordinate arrays dominate these files, and 2-space indentation roughly
 * triples the on-disk size of provincial boundary sets for no machine benefit.
 * The small, human-read `.meta.json` stays pretty-printed.
 */
export async function writeNormalized(
  dataset: NormalizedDataset<AdminFeatureCollection | ReferentialFeatureCollection>,
  dir: string,
): Promise<{ geojsonPath: string; metaPath: string }> {
  const slug = sourceSlug(dataset.meta.sourceId);
  const outDir = join(dir, slug);
  await mkdir(outDir, { recursive: true });

  const geojsonPath = join(outDir, `${dataset.meta.datasetId}.geojson`);
  const metaPath = join(outDir, `${dataset.meta.datasetId}.meta.json`);

  await writeFile(geojsonPath, `${JSON.stringify(dataset.collection)}\n`);
  await writeFile(metaPath, `${JSON.stringify(dataset.meta, null, 2)}\n`);

  return { geojsonPath, metaPath };
}

/**
 * Persist a {@link NormalizedDataset} to a {@link Store} (ADR-0012): normalized
 * data lives on object storage, not git. Mirrors {@link writeNormalized}'s
 * layout — `<prefix>/<sourceSlug>/<datasetId>.geojson` (compact) plus a sibling
 * `.meta.json` (pretty) — but addresses by store key rather than disk path, so
 * the same write path serves a local {@link FsStore} or an S3 backend.
 *
 * geo-acquire depends only on the `Store` **interface** (type-only import); it
 * never references `@aws-sdk`. Returns the keys written, not paths.
 */
export async function writeNormalizedToStore(
  dataset: NormalizedDataset<AdminFeatureCollection | ReferentialFeatureCollection>,
  store: Store,
  prefix?: string,
): Promise<{ geojsonKey: string; metaKey: string }> {
  const slug = sourceSlug(dataset.meta.sourceId);
  const base = prefix && prefix.length > 0 ? `${trimSlashes(prefix)}/${slug}` : slug;

  const geojsonKey = `${base}/${dataset.meta.datasetId}.geojson`;
  const metaKey = `${base}/${dataset.meta.datasetId}.meta.json`;

  await store.put(geojsonKey, `${JSON.stringify(dataset.collection)}\n`, {
    contentType: "application/geo+json",
  });
  await store.put(metaKey, `${JSON.stringify(dataset.meta, null, 2)}\n`, {
    contentType: "application/json",
  });

  return { geojsonKey, metaKey };
}

/** Strip leading/trailing slashes from a store-key prefix. */
function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
