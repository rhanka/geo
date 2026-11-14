/**
 * Display mirror — a materialized, versioned, lighter representation of a served
 * collection, stored NEXT TO the exact GeoJSON (never in place of it).
 *
 * Why: a city click in immo downloads `qc-lots-<slug>` + `qc-zonage-<slug>` in
 * full. Even compressed, serving them means reading and validating the whole
 * exact object on every request (up to 30 s cold in prod). The mirror is built
 * once per source version and served as a precompressed object in one read.
 *
 * Layout (store keys, `_`-prefixed so the serving index never lists them as
 * collections, ADR-0027):
 *   _display/<collectionId>/current.json                   — pointer, written LAST
 *   _display/<collectionId>/<version>/manifest.json
 *   _display/<collectionId>/<version>/items.geojson.br|.gz  — display geometry
 *   _display/<collectionId>/<version>/index.json.br|.gz     — no geometry, exact bbox
 *
 * Display geometry (profile `display-p6-v1`): x/y rounded to 6 decimals (<= ~5 cm),
 * consecutive duplicates dropped (rings keep >= 4 positions), no simplification.
 * Validity by construction: when rounding makes a ring non-simple although the
 * exact ring was simple, the feature is retried at 7 then 8 decimals, and keeps
 * its EXACT geometry only if all fail (`precision_counts`, `fallback_exact`).
 * Properties and ids are copied verbatim.
 *
 * Index: one Feature per source feature, `geometry: null`, `bbox` computed on the
 * EXACT coordinates, properties verbatim — enough for search, lists, counters and
 * camera framing without any geometry.
 *
 * Version = sha256(profile + source sha256), truncated: it changes iff the source
 * bytes or the profile change. The exact GeoJSON stays the only source for the
 * lot fiche, the per-feature detail and any computation.
 */

import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { constants, createBrotliCompress, createGzip, type BrotliCompress, type Gzip } from "node:zlib";

import type { Geometry, Position } from "@sentropic/geo-core";

import { parseFeatureCollectionStream } from "../api/providers/collection-loader.js";
import { geometryBBox } from "../api/geo-util.js";
import { roundGeometry } from "../api/precision.js";
import type { ServedFeature } from "../api/provider.js";
import type { ByteStream, Store } from "../storage/index.js";

import { isSimpleRing } from "./ring.js";

export const DISPLAY_PROFILE = "display-p6-v1";
export const DISPLAY_PRECISION = 6;
export const DISPLAY_ROOT = "_display";

export type DisplayArtifact = "items" | "index";
export type DisplayEncoding = "br" | "gzip";

export interface DisplayArtifactInfo {
  /** Uncompressed JSON bytes. */
  bytes: number;
  br: number;
  gzip: number;
}

export interface DisplayManifest {
  profile: string;
  version: string;
  collection: string;
  source_key: string;
  /** Store identity of the source when the build started (staleness check). */
  source_etag: string;
  source_sha256: string;
  built_at: string;
  features: number;
  /** Features per display precision (`"6"`, `"7"`, `"8"`, `"exact"`). */
  precision_counts: Record<string, number>;
  /** Features served with their exact geometry because every rounding broke a ring. */
  fallback_exact: number;
  artifacts: Record<DisplayArtifact, DisplayArtifactInfo>;
}

const EXT: Record<DisplayEncoding, string> = { br: "br", gzip: "gz" };
const FILE: Record<DisplayArtifact, string> = { items: "items.geojson", index: "index.json" };

export function currentKey(collection: string): string {
  return `${DISPLAY_ROOT}/${collection}/current.json`;
}

export function artifactKey(
  collection: string,
  version: string,
  artifact: DisplayArtifact,
  encoding: DisplayEncoding,
): string {
  return `${DISPLAY_ROOT}/${collection}/${version}/${FILE[artifact]}.${EXT[encoding]}`;
}

function manifestKey(collection: string, version: string): string {
  return `${DISPLAY_ROOT}/${collection}/${version}/manifest.json`;
}

export function displayVersion(sourceSha256: string): string {
  return createHash("sha256").update(`${DISPLAY_PROFILE}\n${sourceSha256}`).digest("hex").slice(0, 16);
}

function ringsOf(geometry: Geometry | null): Position[][] {
  if (!geometry) return [];
  switch (geometry.type) {
    case "Polygon":
      return geometry.coordinates;
    case "MultiPolygon":
      return geometry.coordinates.flat();
    case "GeometryCollection":
      return geometry.geometries.flatMap(ringsOf);
    default:
      return [];
  }
}

/** Precisions tried in order; a feature whose rings break at all of them stays exact. */
export const DISPLAY_PRECISION_LADDER = [DISPLAY_PRECISION, 7, 8] as const;

/**
 * Display geometry of one feature: rounded to the coarsest precision of
 * {@link DISPLAY_PRECISION_LADDER} that keeps every exact-simple ring simple;
 * the exact geometry when none does. `precision` is `null` for exact.
 */
export function displayGeometry(geometry: Geometry | null): {
  geometry: Geometry | null;
  precision: number | null;
} {
  const exactRings = ringsOf(geometry);
  let exactSimple: boolean[] | undefined;
  for (const digits of DISPLAY_PRECISION_LADDER) {
    const rounded = roundGeometry(geometry, digits);
    const roundedRings = ringsOf(rounded);
    let ok = true;
    for (let i = 0; i < roundedRings.length && ok; i++) {
      if (isSimpleRing(roundedRings[i]!)) continue;
      exactSimple ??= exactRings.map((r) => isSimpleRing(r));
      // A ring already non-simple in the source is not the rounding's doing.
      if (exactSimple[i]) ok = false;
    }
    if (ok) return { geometry: rounded, precision: digits };
  }
  return { geometry, precision: null };
}

/** Collects one compressed output; awaits drain so memory stays bounded. */
class Sink {
  readonly #chunks: Buffer[] = [];
  readonly #encoder: BrotliCompress | Gzip;
  readonly #done: Promise<void>;
  bytes = 0;

  constructor(encoding: DisplayEncoding) {
    this.#encoder =
      encoding === "br"
        ? createBrotliCompress({
            params: {
              [constants.BROTLI_PARAM_QUALITY]: 9,
              [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            },
          })
        : createGzip({ level: 9 });
    const chunks = this.#chunks;
    const out = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    });
    this.#done = new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
      this.#encoder.on("error", reject);
    });
    this.#encoder.pipe(out);
  }

  async write(text: string): Promise<void> {
    if (!this.#encoder.write(text)) {
      await new Promise<void>((resolve) => this.#encoder.once("drain", resolve));
    }
  }

  async end(): Promise<Uint8Array> {
    this.#encoder.end();
    await this.#done;
    return Buffer.concat(this.#chunks);
  }
}

/** Two encodings of one artifact, fed the same text. */
class Artifact {
  readonly br = new Sink("br");
  readonly gzip = new Sink("gzip");
  bytes = 0;

  async write(text: string): Promise<void> {
    this.bytes += Buffer.byteLength(text);
    await Promise.all([this.br.write(text), this.gzip.write(text)]);
  }
}

async function* hashing(source: ByteStream, hash: ReturnType<typeof createHash>): ByteStream {
  for await (const chunk of source) {
    hash.update(chunk);
    yield chunk;
  }
}

/**
 * Build and publish the display mirror of `collection` from its exact source
 * object, streaming (one feature in memory at a time; outputs held compressed).
 * Writes the version's objects, then flips `current.json` last.
 */
export async function buildDisplayMirror(
  store: Store,
  collection: string,
  sourceKey: string,
  options: { now?: () => Date } = {},
): Promise<DisplayManifest> {
  const sourceEtag = (await store.stat?.(sourceKey))?.etag ?? "";
  const source = store.getStream ? await store.getStream(sourceKey) : undefined;
  if (!source) throw new Error(`display mirror: source unreadable: ${sourceKey}`);

  const hash = createHash("sha256");
  const items = new Artifact();
  const index = new Artifact();
  await items.write('{"type":"FeatureCollection","features":[');
  await index.write('{"type":"FeatureCollection","features":[');

  let features = 0;
  const precisionCounts: Record<string, number> = {};
  for await (const feature of parseFeatureCollectionStream(hashing(source, hash))) {
    const sep = features === 0 ? "" : ",";
    features++;
    const display = displayGeometry(feature.geometry);
    const bucket = display.precision === null ? "exact" : String(display.precision);
    precisionCounts[bucket] = (precisionCounts[bucket] ?? 0) + 1;
    await items.write(sep + JSON.stringify({ ...feature, geometry: display.geometry }));
    await index.write(sep + JSON.stringify(indexFeature(feature)));
  }

  const sourceSha256 = hash.digest("hex");
  const version = displayVersion(sourceSha256);
  const builtAt = (options.now?.() ?? new Date()).toISOString();
  const tail = `],"numberMatched":${features},"numberReturned":${features},"timeStamp":${JSON.stringify(builtAt)},"display":${JSON.stringify({ profile: DISPLAY_PROFILE, version, source_sha256: sourceSha256 })}}`;
  await items.write(tail);
  await index.write(tail);

  const [itemsBr, itemsGz, indexBr, indexGz] = await Promise.all([
    items.br.end(),
    items.gzip.end(),
    index.br.end(),
    index.gzip.end(),
  ]);

  const manifest: DisplayManifest = {
    profile: DISPLAY_PROFILE,
    version,
    collection,
    source_key: sourceKey,
    source_etag: sourceEtag,
    source_sha256: sourceSha256,
    built_at: builtAt,
    features,
    precision_counts: precisionCounts,
    fallback_exact: precisionCounts["exact"] ?? 0,
    artifacts: {
      items: { bytes: items.bytes, br: itemsBr.byteLength, gzip: itemsGz.byteLength },
      index: { bytes: index.bytes, br: indexBr.byteLength, gzip: indexGz.byteLength },
    },
  };

  await Promise.all([
    store.put(artifactKey(collection, version, "items", "br"), itemsBr),
    store.put(artifactKey(collection, version, "items", "gzip"), itemsGz),
    store.put(artifactKey(collection, version, "index", "br"), indexBr),
    store.put(artifactKey(collection, version, "index", "gzip"), indexGz),
  ]);
  const manifestJson = JSON.stringify(manifest);
  await store.put(manifestKey(collection, version), manifestJson, { contentType: "application/json" });
  // The pointer flips only once every object of the version is in place.
  await store.put(currentKey(collection), manifestJson, { contentType: "application/json" });
  return manifest;
}

function indexFeature(feature: ServedFeature): Record<string, unknown> {
  const bbox = geometryBBox(feature.geometry);
  return {
    type: "Feature",
    ...(feature.id !== undefined ? { id: feature.id } : {}),
    geometry: null,
    bbox: bbox ?? null,
    properties: feature.properties ?? null,
  };
}

/** Parse a `current.json` body; `undefined` when absent or malformed. */
export function parseManifest(text: string | undefined): DisplayManifest | undefined {
  if (text === undefined) return undefined;
  try {
    const m = JSON.parse(text) as Partial<DisplayManifest>;
    if (typeof m.version !== "string" || typeof m.profile !== "string" || typeof m.source_key !== "string") {
      return undefined;
    }
    return m as DisplayManifest;
  } catch {
    return undefined;
  }
}
