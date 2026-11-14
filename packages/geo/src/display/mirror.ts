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

export function manifestKey(collection: string, version: string): string {
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

/** ES2024 resizable `ArrayBuffer` (Node >= 20), not in the ES2023 lib typings. */
interface ResizableArrayBuffer extends ArrayBuffer {
  readonly maxByteLength: number;
  resize(byteLength: number): void;
}
const ResizableArrayBuffer = ArrayBuffer as unknown as new (
  byteLength: number,
  options: { maxByteLength: number },
) => ResizableArrayBuffer;

/**
 * Address space reserved per compressed output — virtual only, never committed
 * beyond what is written (the largest output, `qc-lots-montreal` items, is
 * ~112 MB; its uncompressed text ~680 MB).
 */
const MAX_COMPRESSED_BYTES = 2 ** 30;

/**
 * One contiguous, growable byte buffer whose memory is returned to the OS on
 * {@link release} — deterministically, not at the next major GC. A list of
 * chunks would need a concatenated copy to be uploaded (doubling the peak), and
 * the released chunks would linger until V8 collects them.
 */
class GrowableBytes {
  #buffer = new ResizableArrayBuffer(0, { maxByteLength: MAX_COMPRESSED_BYTES });
  #length = 0;

  append(chunk: Uint8Array): void {
    const need = this.#length + chunk.byteLength;
    if (need > this.#buffer.byteLength) {
      if (need > MAX_COMPRESSED_BYTES) throw new Error(`display mirror: compressed output over ${MAX_COMPRESSED_BYTES} bytes`);
      // Growing only extends the accessible range of the reservation: no copy.
      this.#buffer.resize(Math.min(MAX_COMPRESSED_BYTES, Math.max(need, this.#buffer.byteLength * 2, 1 << 20)));
    }
    new Uint8Array(this.#buffer, this.#length, chunk.byteLength).set(chunk);
    this.#length = need;
  }

  /** The bytes written so far (a view, valid until {@link release}). */
  view(): Uint8Array {
    this.#buffer.resize(this.#length);
    return new Uint8Array(this.#buffer, 0, this.#length);
  }

  release(): void {
    this.#buffer.resize(0);
    this.#length = 0;
  }
}

/** Collects one compressed output; awaits drain so memory stays bounded. */
class Sink {
  readonly #out = new GrowableBytes();
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
    const bytes = this.#out;
    const out = new Writable({
      write(chunk: Buffer, _enc, cb) {
        try {
          bytes.append(chunk);
          cb();
        } catch (error) {
          cb(error as Error);
        }
      },
    });
    this.#done = new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
      this.#encoder.on("error", reject);
    });
    // Observed by write()/end(); never an unhandled rejection in between.
    this.#done.catch(() => {});
    this.#encoder.pipe(out);
  }

  async write(text: string): Promise<void> {
    if (!this.#encoder.write(text)) {
      // A failed encoder never drains: its error ends the wait instead of hanging.
      await Promise.race([new Promise<void>((resolve) => this.#encoder.once("drain", resolve)), this.#done]);
    }
  }

  /** Finish the stream; the result is a view valid until {@link release}. */
  async end(): Promise<Uint8Array> {
    this.#encoder.end();
    await this.#done;
    return this.#out.view();
  }

  /** Return the output memory to the OS and free the encoder (idempotent). */
  release(): void {
    this.#encoder.destroy();
    this.#out.release();
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

  release(): void {
    this.br.release();
    this.gzip.release();
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
 * object, streaming (one feature in memory at a time; outputs held compressed,
 * one contiguous buffer each). Writes the version's objects one at a time —
 * each output is uploaded then freed before the next — and flips
 * `current.json` last. `signal` aborts the build (no pointer flip).
 */
export async function buildDisplayMirror(
  store: Store,
  collection: string,
  sourceKey: string,
  options: { now?: () => Date; signal?: AbortSignal } = {},
): Promise<DisplayManifest> {
  const { signal } = options;
  const sourceEtag = (await store.stat?.(sourceKey))?.etag ?? "";
  signal?.throwIfAborted();
  const source = store.getStream ? await store.getStream(sourceKey, signal ? { signal } : {}) : undefined;
  if (!source) throw new Error(`display mirror: source unreadable: ${sourceKey}`);

  const items = new Artifact();
  const index = new Artifact();
  try {
    return await buildInto(store, collection, sourceKey, sourceEtag, source, items, index, options);
  } finally {
    // Success, failure or abort: free the outputs and the encoders now.
    items.release();
    index.release();
  }
}

async function buildInto(
  store: Store,
  collection: string,
  sourceKey: string,
  sourceEtag: string,
  source: ByteStream,
  items: Artifact,
  index: Artifact,
  options: { now?: () => Date; signal?: AbortSignal },
): Promise<DisplayManifest> {
  const { signal } = options;
  const hash = createHash("sha256");
  await items.write('{"type":"FeatureCollection","features":[');
  await index.write('{"type":"FeatureCollection","features":[');

  let features = 0;
  const precisionCounts: Record<string, number> = {};
  for await (const feature of parseFeatureCollectionStream(hashing(source, hash))) {
    signal?.throwIfAborted();
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

  // One output at a time: finish, upload, release. Each output is ONE growable
  // buffer uploaded as is (no concatenated copy) and returned to the OS right
  // after its upload. Before, the four outputs were concatenated next to their
  // chunks and uploaded in parallel (TLS holds an encrypted copy of each
  // in-flight body): ~1 GB peak on qc-lots-montreal, OOMKilled at 1Gi.
  // Smallest (index) first, so the largest uploads happen once the rest is freed.
  const putOptions = signal ? { signal } : undefined;
  const compressed: Record<DisplayArtifact, Record<DisplayEncoding, number>> = {
    items: { br: 0, gzip: 0 },
    index: { br: 0, gzip: 0 },
  };
  for (const [artifact, outputs] of [["index", index], ["items", items]] as const) {
    for (const encoding of ["br", "gzip"] as const) {
      signal?.throwIfAborted();
      const sink = outputs[encoding];
      const bytes = await sink.end();
      compressed[artifact][encoding] = bytes.byteLength;
      // Store.put contract: the body is not retained once the promise settles.
      await store.put(artifactKey(collection, version, artifact, encoding), bytes, putOptions);
      sink.release();
    }
  }

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
      items: { bytes: items.bytes, ...compressed.items },
      index: { bytes: index.bytes, ...compressed.index },
    },
  };

  const manifestJson = JSON.stringify(manifest);
  const jsonPut = { contentType: "application/json", ...putOptions };
  signal?.throwIfAborted();
  await store.put(manifestKey(collection, version), manifestJson, jsonPut);
  // The pointer flips only once every object of the version is in place.
  signal?.throwIfAborted();
  await store.put(currentKey(collection), manifestJson, jsonPut);
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
