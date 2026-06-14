/**
 * File-backed {@link FeatureProvider}.
 *
 * Reads normalized datasets from a directory. The on-disk format mirrors what
 * `@sentropic/geo-acquire`'s `writeNormalized` emits: for each dataset a pair
 * of sibling files
 *
 *   - `<name>.geojson`      — an {@link AdminFeatureCollection} (WGS84 GeoJSON)
 *   - `<name>.meta.json`    — the {@link CollectionMeta} for that collection
 *
 * The collection id is the meta's `datasetId` when present, otherwise the
 * `<name>` stem of the file. Datasets are loaded lazily on first access and
 * cached. A missing or empty directory yields zero collections (not an error),
 * so the server boots cleanly before any data has been acquired.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  isFeatureCollection,
  resolveLicense,
  type CollectionMeta,
  type FeatureCollection,
  type Geometry,
  type License,
} from "@sentropic/geo-core";

import { geometryBBox, geometryIntersectsBBox, unionBBox, type BBox2D } from "../geo-util.js";
import type {
  CollectionInfo,
  FeatureProvider,
  ItemsQuery,
  ItemsResult,
  ServedFeature,
} from "../provider.js";

/** Default location of normalized datasets, relative to the repo root. */
export const DEFAULT_DATA_DIR = "data/normalized";

/**
 * A loaded collection. Geometry may be `null` per feature (referential
 * crosswalks), so the on-disk shape is the broad GeoJSON FeatureCollection
 * rather than the geometry-required {@link AdminFeatureCollection}.
 */
type LoadedFeatureCollection = FeatureCollection<Geometry | null>;

interface LoadedCollection {
  info: CollectionInfo;
  /** Features as served (geometry may be null for referential rows). */
  features: ServedFeature[];
  /** featureId → feature, for O(1) item lookup. */
  byId: Map<string, ServedFeature>;
}

/** A feature's stable id: its GeoJSON `id`, falling back to `properties.geoId`. */
function featureKey(feature: ServedFeature, index: number): string {
  if (feature.id !== undefined && feature.id !== null) return String(feature.id);
  const geoId = feature.properties?.["geoId"];
  if (typeof geoId === "string") return geoId;
  return String(index);
}

function isMeta(value: unknown): value is CollectionMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { datasetId?: unknown }).datasetId === "string"
  );
}

export class FileProvider implements FeatureProvider {
  readonly #dir: string;
  /** Resolves once the directory has been scanned and all datasets loaded. */
  #loaded: Promise<Map<string, LoadedCollection>> | undefined;

  constructor(dir: string = DEFAULT_DATA_DIR) {
    this.#dir = dir;
  }

  /** Force a re-scan of the directory on next access (e.g. after data refresh). */
  invalidate(): void {
    this.#loaded = undefined;
  }

  #ensureLoaded(): Promise<Map<string, LoadedCollection>> {
    if (!this.#loaded) this.#loaded = this.#load();
    return this.#loaded;
  }

  async #load(): Promise<Map<string, LoadedCollection>> {
    const map = new Map<string, LoadedCollection>();
    let entries: string[];
    try {
      // Recurse: `writeNormalized` namespaces datasets under <sourceSlug>/, e.g.
      // `ca-qc-sda/qc-municipalites.geojson` (see ADR-0005). Paths are relative to #dir.
      entries = await readdir(this.#dir, { recursive: true });
    } catch {
      // Missing/unreadable directory → zero collections.
      return map;
    }
    const geojsonFiles = entries
      .filter((name) => name.endsWith(".geojson"))
      .sort();
    for (const relPath of geojsonFiles) {
      const loaded = await this.#loadOne(relPath);
      if (loaded) map.set(loaded.info.id, loaded);
    }
    return map;
  }

  async #loadOne(relPath: string): Promise<LoadedCollection | undefined> {
    const stem = basename(relPath, ".geojson");
    const geojsonPath = join(this.#dir, relPath);
    const metaPath = `${geojsonPath.slice(0, -".geojson".length)}.meta.json`;

    let collection: LoadedFeatureCollection;
    try {
      const raw = JSON.parse(await readFile(geojsonPath, "utf8")) as unknown;
      if (!isFeatureCollection(raw)) return undefined;
      collection = raw as LoadedFeatureCollection;
    } catch {
      return undefined;
    }

    let meta: CollectionMeta | undefined;
    try {
      const raw = JSON.parse(await readFile(metaPath, "utf8")) as unknown;
      if (isMeta(raw)) meta = raw;
    } catch {
      // Sibling meta is optional; fall back to defaults derived from the file.
    }

    const id = meta?.datasetId ?? stem;
    const license: License = resolveLicense(meta?.license);

    const features = collection.features as ServedFeature[];
    const byId = new Map<string, ServedFeature>();
    let bbox: BBox2D | undefined;
    // Extent is the union of non-null geometries; `geometryBBox(null)` is
    // undefined, so null-geometry referential rows are skipped (no crash) and
    // `extent` is omitted entirely when every feature is null-geometry.
    features.forEach((feature, index) => {
      byId.set(featureKey(feature, index), feature);
      bbox = unionBBox(bbox, geometryBBox(feature.geometry));
    });

    const info: CollectionInfo = {
      id,
      title: meta?.title ?? id,
      license,
      attribution: meta?.attribution ?? license.title,
      crs: meta?.crs ?? "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      count: meta?.count ?? features.length,
      ...(bbox ? { extent: { bbox } } : {}),
    };

    return { info, features, byId };
  }

  async listCollections(): Promise<CollectionInfo[]> {
    const map = await this.#ensureLoaded();
    return [...map.values()].map((c) => c.info);
  }

  async getCollection(id: string): Promise<CollectionInfo | undefined> {
    const map = await this.#ensureLoaded();
    return map.get(id)?.info;
  }

  async getItems(id: string, query: ItemsQuery): Promise<ItemsResult | undefined> {
    const map = await this.#ensureLoaded();
    const loaded = map.get(id);
    if (!loaded) return undefined;

    const filter = query.bbox;
    const matched = filter
      ? loaded.features.filter((f) => geometryIntersectsBBox(f.geometry, filter))
      : loaded.features;

    const offset = query.offset ?? 0;
    const limit = query.limit ?? matched.length;
    const page = matched.slice(offset, offset + limit);

    return {
      features: page,
      numberMatched: matched.length,
      numberReturned: page.length,
    };
  }

  async getItem(id: string, featureId: string): Promise<ServedFeature | undefined> {
    const map = await this.#ensureLoaded();
    return map.get(id)?.byId.get(featureId);
  }
}
