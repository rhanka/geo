/**
 * Published tile archives (SPEC_VECTOR_TILES.md § Storage and publication).
 *
 * Layout, next to the display mirror and under the same rules (`_`-prefixed
 * keys are never indexed as collections, ADR-0027):
 *
 *   _tiles/<collectionId>/current.json                       pointer (copy of the manifest), written LAST
 *   _tiles/<collectionId>/<version>/manifest.json
 *   _tiles/<collectionId>/<version>/<collectionId>.pmtiles   one PMTiles v3 archive, gzip MVT tiles
 *
 * `version = sha256("tiles\n" + fingerprint + "\n" + source_sha256)[0:16]`, the
 * fingerprint covering the profile (whitelist, tiers, id rule) and the build
 * options: it changes iff the source bytes, the profile or the options change.
 *
 * Freshness, adoption and building follow the display mirror
 * (`display/publish.ts`): fresh = `current.json` of this fingerprint, built
 * from the served source key at its current ETag; otherwise adopt an existing
 * complete version of the same source bytes, otherwise build. The serving pod
 * never builds tiles (no lazy build): publication and the prewarm sweep do.
 */

import { createHash } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FeatureTooLargeError, parseFeatureCollectionStream } from "../api/providers/collection-loader.js";
import type { ByteStream, Store } from "../storage/index.js";

import {
  LayerTilesBuilder,
  TILE_DEFAULTS,
  TileBudgetError,
  writeSpooledPmtiles,
  type SourceFeature,
  type SpooledLayer,
} from "./build.js";
import { FileSpool } from "./spool.js";
import { citySlugFromCollection, profileForCollection, type FeatureIdStats, type LayerProfile } from "./profiles.js";

export const TILES_PROFILE = "tiles-v1";
export const TILES_ROOT = "_tiles";
export const PMTILES_CONTENT_TYPE = "application/vnd.pmtiles";

/**
 * Largest JSON text of one source Feature the tile builder accepts (64 MiB,
 * same as the display mirror), checked on the raw bytes before parsing.
 */
export const TILES_MAX_FEATURE_BYTES = 64 * 2 ** 20;

/**
 * Largest number of polygon features one build accepts. The compact builder
 * holds ~8 B per vertex plus a few bytes per ring and feature, one zoom's
 * simplified copy and a bounded junction table; tiles go to a spool file
 * (SPEC_VECTOR_TILES.md § Scale: `qc-lots-montreal`, 680 087 lots, measured
 * there). A safety bound well above the largest served city.
 */
export const TILES_MAX_FEATURES = 1_500_000;

/**
 * Revision of the builder's output bytes, part of the fingerprint: 2 = compact
 * builder (coordinates quantized once at maxZoom, lower zooms rounded from it).
 */
export const TILES_BUILDER_REVISION = 2;

/** Build options that change the tiles' bytes (hence the version). */
export interface TilesBuildSettings {
  minZoom: number;
  maxZoom: number;
  extent: number;
  buffer: number;
  tolerance: number;
  maxZoomTolerance: number;
  sharedBorders: boolean;
  gzipLevel: number;
}

export const DEFAULT_TILES_SETTINGS: Readonly<TilesBuildSettings> = Object.freeze({ ...TILE_DEFAULTS });

/** Profile + settings, canonical JSON: the part of the version that is not the source. */
export function tilesFingerprint(profile: LayerProfile, settings: TilesBuildSettings = DEFAULT_TILES_SETTINGS): string {
  const canonical = JSON.stringify({ profile: TILES_PROFILE, builder: TILES_BUILDER_REVISION, layer: profile, settings });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function tilesVersion(fingerprint: string, sourceSha256: string): string {
  return createHash("sha256").update(`tiles\n${fingerprint}\n${sourceSha256}`).digest("hex").slice(0, 16);
}

export function tilesCurrentKey(collection: string): string {
  return `${TILES_ROOT}/${collection}/current.json`;
}

export function tilesManifestKey(collection: string, version: string): string {
  return `${TILES_ROOT}/${collection}/${version}/manifest.json`;
}

export function tilesArchiveKey(collection: string, version: string): string {
  return `${TILES_ROOT}/${collection}/${version}/${collection}.pmtiles`;
}

export interface TilesZoomSummary {
  z: number;
  tiles: number;
  missing: number;
  markers: number;
  maxTileBytes: number;
  maxTileGzipBytes: number;
  totalGzipBytes: number;
  maxFeaturesPerTile: number;
}

export interface TilesManifest {
  profile: string;
  fingerprint: string;
  version: string;
  collection: string;
  layer: string;
  source_key: string;
  /** Store identity of the source when the build started (staleness check). */
  source_etag: string;
  source_sha256: string;
  built_at: string;
  features: number;
  skipped_non_polygon: number;
  minzoom: number;
  maxzoom: number;
  /** [minLon, minLat, maxLon, maxLat]. */
  bounds: [number, number, number, number];
  fields: Record<string, string>;
  archive: { bytes: number; tiles: number };
  ids: FeatureIdStats;
  zooms: TilesZoomSummary[];
}

/** Parse a `current.json` / `manifest.json` body; `undefined` when absent or malformed. */
export function parseTilesManifest(text: string | undefined): TilesManifest | undefined {
  if (text === undefined) return undefined;
  try {
    const m = JSON.parse(text) as Partial<TilesManifest>;
    if (
      typeof m.version !== "string" ||
      typeof m.profile !== "string" ||
      typeof m.source_key !== "string" ||
      typeof m.minzoom !== "number" ||
      typeof m.maxzoom !== "number"
    ) {
      return undefined;
    }
    return m as TilesManifest;
  } catch {
    return undefined;
  }
}

/**
 * The source cannot be tiled within the builder's budgets (one Feature over
 * {@link TILES_MAX_FEATURE_BYTES}, or more than the feature budget).
 * Deterministic for given source bytes: retrying the same source fails the
 * same way, so the prewarm does not fail the Job for it (reason `too-large`).
 */
export class TilesTooLargeError extends Error {
  readonly reason = "too-large";
  constructor(
    readonly collection: string,
    readonly sourceEtag: string,
    detail: string,
  ) {
    super(`tiles too large for ${collection}: ${detail}`);
    this.name = "TilesTooLargeError";
  }
}

export interface TilesBuildOptions {
  now?: () => Date;
  signal?: AbortSignal;
  /** Default {@link TILES_MAX_FEATURE_BYTES}. */
  maxFeatureBytes?: number;
  /** Default {@link TILES_MAX_FEATURES}. */
  maxFeatures?: number;
  settings?: TilesBuildSettings;
  /** Parent of the temporary build directory (default `TILES_TMPDIR`, else the OS temp dir). */
  tmpDir?: string;
}

/** Upload the assembled archive from its file: streamed when the store can, else read once. */
async function putArchive(store: Store, key: string, path: string, putOptions: { signal: AbortSignal } | undefined): Promise<void> {
  const opts = { contentType: PMTILES_CONTENT_TYPE, ...putOptions };
  if (store.putFile) await store.putFile(key, path, opts);
  else await store.put(key, await readFile(path), opts);
}

async function* hashing(source: ByteStream, hash: ReturnType<typeof createHash>): ByteStream {
  for await (const chunk of source) {
    hash.update(chunk);
    yield chunk;
  }
}

function requireProfile(collection: string): LayerProfile {
  const profile = profileForCollection(collection);
  if (!profile) throw new Error(`tiles: no tile profile for ${collection}`);
  return profile;
}

/**
 * Build and publish the tile archive of `collection` from its exact source
 * object, streamed (one parsed feature at a time). Writes the archive, then
 * the manifest, then flips `current.json` last. `signal` aborts the build (no
 * pointer flip). A source over the budgets throws {@link TilesTooLargeError}.
 */
export async function buildTilesArchive(
  store: Store,
  collection: string,
  sourceKey: string,
  options: TilesBuildOptions = {},
): Promise<TilesManifest> {
  const profile = requireProfile(collection);
  const settings = options.settings ?? DEFAULT_TILES_SETTINGS;
  const { signal } = options;
  const sourceEtag = (await store.stat?.(sourceKey))?.etag ?? "";
  signal?.throwIfAborted();
  const source = store.getStream ? await store.getStream(sourceKey, signal ? { signal } : {}) : undefined;
  if (!source) throw new Error(`tiles: source unreadable: ${sourceKey}`);

  const hash = createHash("sha256");
  const builder = new LayerTilesBuilder(profile, {
    ...settings,
    citySlug: citySlugFromCollection(collection, profile),
    maxFeatures: options.maxFeatures ?? TILES_MAX_FEATURES,
  });
  // Tiles and the assembled archive go to a temporary directory (never the
  // archive or every tile in memory); removed whatever happens.
  const dir = await mkdtemp(join(options.tmpDir ?? process.env["TILES_TMPDIR"] ?? tmpdir(), "geo-tiles-"));
  let built: SpooledLayer;
  let version: string;
  let sourceSha256: string;
  let archiveBytes: number;
  const fingerprint = tilesFingerprint(profile, settings);
  const archivePath = join(dir, "archive.pmtiles");
  const putOptions = signal ? { signal } : undefined;
  try {
    const spool = new FileSpool(join(dir, "tiles.spool"));
    try {
      try {
        for await (const feature of parseFeatureCollectionStream(hashing(source, hash), {
          maxFeatureBytes: options.maxFeatureBytes ?? TILES_MAX_FEATURE_BYTES,
        })) {
          signal?.throwIfAborted();
          builder.add(feature as SourceFeature);
        }
        signal?.throwIfAborted();
        built = await builder.buildToSpool(spool, signal);
      } catch (error) {
        if (error instanceof FeatureTooLargeError || error instanceof TileBudgetError) {
          throw new TilesTooLargeError(collection, sourceEtag, error.message);
        }
        throw error;
      }
      const missing = built.zooms.filter((z) => z.missing > 0);
      if (missing.length > 0) {
        // The no-drop guarantee is a contract of the tiles: never publish a violation.
        throw new Error(`tiles: features missing for ${collection} at z${missing.map((z) => `${z.z}:${z.missing}`).join(",")}`);
      }
      sourceSha256 = hash.digest("hex");
      version = tilesVersion(fingerprint, sourceSha256);
      const fd = openSync(archivePath, "w");
      try {
        archiveBytes = writeSpooledPmtiles(
          built,
          spool,
          (chunk) => {
            let written = 0;
            while (written < chunk.length) written += writeSync(fd, chunk, written, chunk.length - written);
          },
          { name: collection, tiles_version: version },
        );
      } finally {
        closeSync(fd);
      }
    } finally {
      spool.close();
    }
    signal?.throwIfAborted();
    await putArchive(store, tilesArchiveKey(collection, version), archivePath, putOptions);
  } finally {
    builder.release();
    await rm(dir, { recursive: true, force: true });
  }
  const builtAt = (options.now?.() ?? new Date()).toISOString();

  const manifest: TilesManifest = {
    profile: TILES_PROFILE,
    fingerprint,
    version,
    collection,
    layer: built.layer,
    source_key: sourceKey,
    source_etag: sourceEtag,
    source_sha256: sourceSha256,
    built_at: builtAt,
    features: built.features,
    skipped_non_polygon: built.skippedNonPolygon,
    minzoom: built.minZoom,
    maxzoom: built.maxZoom,
    bounds: built.bounds,
    fields: built.fields,
    archive: { bytes: archiveBytes, tiles: built.tileCount },
    ids: built.ids,
    zooms: built.zooms.map((z) => ({
      z: z.z,
      tiles: z.tiles,
      missing: z.missing,
      markers: z.markers,
      maxTileBytes: z.maxTileBytes,
      maxTileGzipBytes: z.maxTileGzipBytes,
      totalGzipBytes: z.totalGzipBytes,
      maxFeaturesPerTile: z.maxFeaturesPerTile,
    })),
  };
  const json = JSON.stringify(manifest);
  const jsonPut = { contentType: "application/json", ...putOptions };
  signal?.throwIfAborted();
  await store.put(tilesManifestKey(collection, version), json, jsonPut);
  // The pointer flips only once the archive and the manifest are in place.
  signal?.throwIfAborted();
  await store.put(tilesCurrentKey(collection), json, jsonPut);
  return manifest;
}

const decoder = new TextDecoder();

async function readText(store: Store, key: string): Promise<string | undefined> {
  try {
    const bytes = await store.get(key);
    return bytes === undefined ? undefined : decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

export async function readTilesCurrent(store: Store, collection: string): Promise<TilesManifest | undefined> {
  return parseTilesManifest(await readText(store, tilesCurrentKey(collection)));
}

export type TilesStaleReason = "no-archive" | "other-profile" | "other-source" | "source-changed";

export type TilesFreshness =
  | { fresh: true; manifest: TilesManifest; sourceEtag: string }
  | { fresh: false; reason: TilesStaleReason; sourceEtag: string; manifest?: TilesManifest };

/** Is the archive of `collection` current for `sourceKey`? Reads `current.json` and HEADs the source. */
export async function tilesFreshness(
  store: Store,
  collection: string,
  sourceKey: string,
  settings: TilesBuildSettings = DEFAULT_TILES_SETTINGS,
): Promise<TilesFreshness> {
  if (!store.stat) throw new Error("tiles: store cannot stat objects (no ETag to compare)");
  const stat = await store.stat(sourceKey);
  if (!stat) throw new Error(`tiles: source missing: ${sourceKey}`);
  const sourceEtag = stat.etag;
  const manifest = await readTilesCurrent(store, collection);
  if (!manifest) return { fresh: false, reason: "no-archive", sourceEtag };
  if (manifest.profile !== TILES_PROFILE || manifest.fingerprint !== tilesFingerprint(requireProfile(collection), settings)) {
    return { fresh: false, reason: "other-profile", sourceEtag, manifest };
  }
  if (manifest.source_key !== sourceKey) return { fresh: false, reason: "other-source", sourceEtag, manifest };
  if (manifest.source_etag !== sourceEtag) return { fresh: false, reason: "source-changed", sourceEtag, manifest };
  return { fresh: true, manifest, sourceEtag };
}

async function adoptExistingTiles(
  store: Store,
  collection: string,
  sourceKey: string,
  sourceEtag: string,
  settings: TilesBuildSettings,
  signal?: AbortSignal,
): Promise<TilesManifest | undefined> {
  const hash = createHash("sha256");
  if (store.getStream) {
    const stream = await store.getStream(sourceKey, signal ? { signal } : {});
    if (!stream) return undefined;
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      hash.update(chunk);
    }
  } else {
    const bytes = await store.get(sourceKey);
    if (!bytes) return undefined;
    hash.update(bytes);
  }
  signal?.throwIfAborted();
  const sourceSha256 = hash.digest("hex");
  const fingerprint = tilesFingerprint(requireProfile(collection), settings);
  const version = tilesVersion(fingerprint, sourceSha256);
  const existing = parseTilesManifest(await readText(store, tilesManifestKey(collection, version)));
  if (
    !existing ||
    existing.profile !== TILES_PROFILE ||
    existing.fingerprint !== fingerprint ||
    existing.version !== version ||
    existing.source_sha256 !== sourceSha256 ||
    !(await store.has(tilesArchiveKey(collection, version)))
  ) {
    return undefined;
  }
  const pointer: TilesManifest = { ...existing, collection, source_key: sourceKey, source_etag: sourceEtag };
  signal?.throwIfAborted();
  await store.put(tilesCurrentKey(collection), JSON.stringify(pointer), {
    contentType: "application/json",
    ...(signal ? { signal } : {}),
  });
  return pointer;
}

export interface EnsureTilesOptions extends Omit<TilesBuildOptions, "settings"> {
  /** Re-point to an existing version of the same source bytes before building (default true). */
  adopt?: boolean;
  /** Build when nothing fresh or adoptable exists (default true); false reports `needs-build`. */
  build?: boolean;
  settings?: TilesBuildSettings;
}

export type EnsureTilesAction = "fresh" | "adopted" | "built" | "needs-build";

export interface EnsureTilesResult {
  action: EnsureTilesAction;
  collection: string;
  sourceKey: string;
  reason?: TilesStaleReason;
  version?: string;
  ms: number;
}

/** Collections that get a tile archive: those with a tile profile (`qc-lots-*`, `qc-zonage-*` but not norms). */
export function isTilesPublishedCollection(collection: string): boolean {
  return profileForCollection(collection) !== undefined;
}

/**
 * Make the tile archive of `collection` current for `sourceKey`: skip when
 * fresh, otherwise adopt an existing version of the same bytes, otherwise
 * build. Idempotent; throws on a build/read failure ({@link TilesTooLargeError}
 * for a source over the budgets).
 */
export async function ensureTilesArchive(
  store: Store,
  collection: string,
  sourceKey: string,
  options: EnsureTilesOptions = {},
): Promise<EnsureTilesResult> {
  const started = Date.now();
  const settings = options.settings ?? DEFAULT_TILES_SETTINGS;
  const done = (action: EnsureTilesAction, extra: Partial<EnsureTilesResult>): EnsureTilesResult => ({
    action,
    collection,
    sourceKey,
    ...extra,
    ms: Date.now() - started,
  });
  const { signal } = options;
  signal?.throwIfAborted();
  const state = await tilesFreshness(store, collection, sourceKey, settings);
  if (state.fresh) return done("fresh", { version: state.manifest.version });
  signal?.throwIfAborted();
  if (options.adopt !== false) {
    const adopted = await adoptExistingTiles(store, collection, sourceKey, state.sourceEtag, settings, signal);
    if (adopted) return done("adopted", { reason: state.reason, version: adopted.version });
  }
  if (options.build === false) return done("needs-build", { reason: state.reason });
  signal?.throwIfAborted();
  const manifest = await buildTilesArchive(store, collection, sourceKey, { ...options, settings });
  return done("built", { reason: state.reason, version: manifest.version });
}
