/**
 * File-backed {@link FeatureProvider}.
 *
 * GeoJSON bodies are indexed and served as streams. The initial scan computes
 * the same collection count/extent that the former eager loader exposed, but
 * it never retains a collection's complete text or feature array.
 */

import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { resolveLicense, type CollectionMeta, type License } from "@sentropic/geo-core";

import {
  parseFeatureCollectionStream,
  parseMeta,
  validateFeatureCollectionStream,
} from "./collection-loader.js";
import { geometryBBox, geometryIntersectsBBox, unionBBox, type BBox2D } from "../geo-util.js";
import type {
  CollectionInfo,
  FeatureProvider,
  ItemsQuery,
  ItemsResult,
  ItemsStream,
  ServedFeature,
} from "../provider.js";
import type { ByteStream } from "../../storage/index.js";

/** Default location of normalized datasets, relative to the repo root. */
export const DEFAULT_DATA_DIR = "data/normalized";
const DEFAULT_CRS = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";

interface FileCollectionEntry {
  geojsonPath: string;
  info: CollectionInfo;
}

export class FileProvider implements FeatureProvider {
  readonly #dir: string;
  /** Resolves once filenames and lightweight collection statistics are indexed. */
  #indexed: Promise<Map<string, FileCollectionEntry>> | undefined;

  constructor(dir: string = DEFAULT_DATA_DIR) {
    this.#dir = dir;
  }

  /** Force a re-scan of the directory on next access (e.g. after data refresh). */
  invalidate(): void {
    this.#indexed = undefined;
  }

  #ensureIndexed(): Promise<Map<string, FileCollectionEntry>> {
    if (!this.#indexed) this.#indexed = this.#index();
    return this.#indexed;
  }

  async #index(): Promise<Map<string, FileCollectionEntry>> {
    const map = new Map<string, FileCollectionEntry>();
    let entries: string[];
    try {
      entries = await readdir(this.#dir, { recursive: true });
    } catch {
      return map;
    }
    for (const relPath of entries.filter((name) => name.endsWith(".geojson")).sort()) {
      const entry = await this.#indexOne(relPath);
      if (!entry) continue;
      const existing = map.get(entry.info.id);
      map.set(entry.info.id, existing ? selectServedEntry(existing, entry) : entry);
    }
    return map;
  }

  async #indexOne(relPath: string): Promise<FileCollectionEntry | undefined> {
    const geojsonPath = join(this.#dir, relPath);
    const metaPath = `${geojsonPath.slice(0, -".geojson".length)}.meta.json`;
    const meta = parseMeta(await readMaybe(metaPath));
    try {
      const validationSource = await openFile(geojsonPath);
      if (!validationSource) return undefined;
      await validateFeatureCollectionStream(validationSource);
      const source = await openFile(geojsonPath);
      if (!source) return undefined;
      const info = await describeCollection(basename(relPath, ".geojson"), source, meta);
      return { geojsonPath, info };
    } catch {
      return undefined;
    }
  }

  async listCollections(): Promise<CollectionInfo[]> {
    const map = await this.#ensureIndexed();
    return [...map.values()].map((entry) => entry.info);
  }

  async getCollection(id: string): Promise<CollectionInfo | undefined> {
    const map = await this.#ensureIndexed();
    return map.get(id)?.info;
  }

  async getItems(id: string, query: ItemsQuery): Promise<ItemsResult | undefined> {
    const stream = await this.streamItems(id, query);
    if (!stream) return undefined;
    const features: ServedFeature[] = [];
    let numberMatched = 0;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? Number.POSITIVE_INFINITY;
    for await (const feature of stream.features) {
      numberMatched++;
      if (numberMatched <= offset || features.length >= limit) continue;
      features.push(feature);
    }
    return { features, numberMatched, numberReturned: features.length };
  }

  async streamItems(
    id: string,
    query: Pick<ItemsQuery, "bbox">,
  ): Promise<ItemsStream | undefined> {
    const map = await this.#ensureIndexed();
    const entry = map.get(id);
    if (!entry) return undefined;
    try {
      const validationSource = await openFile(entry.geojsonPath);
      if (!validationSource) return undefined;
      await validateFeatureCollectionStream(validationSource);
      const source = await openFile(entry.geojsonPath);
      if (!source) return undefined;
      return { features: matchingFeatures(parseFeatureCollectionStream(source), query.bbox) };
    } catch {
      return undefined;
    }
  }

  async getItem(id: string, featureId: string): Promise<ServedFeature | undefined> {
    const stream = await this.streamItems(id, {});
    if (!stream) return undefined;
    let index = 0;
    let matched: ServedFeature | undefined;
    for await (const feature of stream.features) {
      if (featureKey(feature, index) === featureId) matched = feature;
      index++;
    }
    return matched;
  }
}

/** Open a file as chunks, ensuring missing files still become a normal 404. */
async function openFile(path: string): Promise<ByteStream | undefined> {
  try {
    await stat(path);
    return readStream(path);
  } catch {
    return undefined;
  }
}

async function* readStream(path: string): ByteStream {
  for await (const chunk of createReadStream(path)) {
    yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike);
  }
}

async function* matchingFeatures(
  source: AsyncIterable<ServedFeature>,
  bbox: ItemsQuery["bbox"],
): AsyncGenerator<ServedFeature> {
  for await (const feature of source) {
    if (!bbox || geometryIntersectsBBox(feature.geometry, bbox)) yield feature;
  }
}

async function describeCollection(
  stem: string,
  source: ByteStream,
  meta: CollectionMeta | undefined,
): Promise<CollectionInfo> {
  let count = 0;
  let bbox: BBox2D | undefined;
  for await (const feature of parseFeatureCollectionStream(source)) {
    count++;
    bbox = unionBBox(bbox, geometryBBox(feature.geometry));
  }

  const id = meta?.datasetId ?? stem;
  const license: License = resolveLicense(meta?.license);
  return {
    id,
    title: meta?.title ?? id,
    license,
    attribution: meta?.attribution ?? license.title,
    ...(meta?.rights ? { rights: meta.rights } : {}),
    crs: meta?.crs ?? DEFAULT_CRS,
    count: meta?.count ?? count,
    ...(bbox ? { extent: { bbox } } : {}),
  };
}

type CollectionLayout = "flat" | "nested";

/** The nested layout is `<slug>/<slug>.geojson`; enclosing directories are not layouts. */
function collectionLayout(geojsonPath: string): CollectionLayout {
  const stem = stemOf(geojsonPath);
  return basename(dirname(geojsonPath)) === stem ? "nested" : "flat";
}

function stemOf(geojsonPath: string): string {
  return basename(geojsonPath, ".geojson");
}

/**
 * Served-contract rule: when a collection exists in both layouts, use nested.
 * Equal layouts keep the prior sorted, last-path-wins behavior.
 */
function selectServedEntry(
  existing: FileCollectionEntry,
  candidate: FileCollectionEntry,
): FileCollectionEntry {
  if (stemOf(existing.geojsonPath) !== stemOf(candidate.geojsonPath)) return candidate;
  const existingLayout = collectionLayout(existing.geojsonPath);
  const candidateLayout = collectionLayout(candidate.geojsonPath);
  if (existingLayout !== candidateLayout) {
    return candidateLayout === "nested" ? candidate : existing;
  }
  return candidate;
}

/** A feature's stable id: GeoJSON `id`, then `properties.geoId`, then position. */
function featureKey(feature: ServedFeature, index: number): string {
  if (feature.id !== undefined && feature.id !== null) return String(feature.id);
  const geoId = feature.properties?.["geoId"];
  return typeof geoId === "string" ? geoId : String(index);
}

/** Read a small metadata file as UTF-8, returning undefined on I/O errors. */
async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
