/**
 * Display mirror at PUBLICATION time — so the first `?profile=display|index`
 * request never pays the build (SPEC_DISPLAY_MIRROR.md § Publication).
 *
 * Two entry points share one freshness rule:
 *   - {@link publishDisplayMirror}: the writer hook. Called right after a served
 *     lots/zonage GeoJSON was written; resolves the served collection the write
 *     belongs to and builds its mirror. It NEVER throws: the exact write is
 *     already done and must not be rolled back or blocked; a failure is returned
 *     and logged loudly (`DISPLAY_MIRROR_PUBLISH_FAILED`).
 *   - {@link ensureDisplayMirror}: the idempotent unit of the prewarm sweep
 *     (`prewarm.ts`) and of the preprod sync.
 *
 * Freshness (same as the API, `service.ts`): `current.json` exists, carries the
 * current profile and the served source key, and its `source_etag` equals the
 * source's store identity (S3 ETag). Anything else is stale.
 *
 * Adoption: a stale pointer whose source BYTES already have a complete version
 * on the store (same `source_sha256`, e.g. a byte-identical rewrite, or a
 * mirror copied from another bucket where the ETag differs) is re-pointed
 * instead of rebuilt — one read of the source, no CPU-heavy build.
 */

import { createHash } from "node:crypto";

import { parseMeta } from "../api/providers/collection-loader.js";
import {
  isCanonicalGeojsonKey,
  preferServedKey,
  servedCollectionId,
  servedKeyLayout,
  stemOf,
  type Store,
} from "../storage/index.js";

import {
  artifactKey,
  buildDisplayMirror,
  currentKey,
  DISPLAY_PROFILE,
  displayVersion,
  manifestKey,
  parseManifest,
  type DisplayArtifact,
  type DisplayEncoding,
  type DisplayManifest,
} from "./mirror.js";

const decoder = new TextDecoder();
const GEOJSON_SUFFIX = ".geojson";

/** Marker of a failed publication-time build in logs (grep/alert on it). */
export const DISPLAY_PUBLISH_FAILED = "DISPLAY_MIRROR_PUBLISH_FAILED";

/**
 * Collections whose display mirror is built at publication and by the prewarm:
 * the two collections a city click downloads, `qc-lots-<slug>` and
 * `qc-zonage-<slug>` (not `qc-zonage-norms-<slug>`). Other collections keep the
 * lazy build of M1.
 */
export function isDisplayPublishedCollection(id: string): boolean {
  if (/^qc-lots-[a-z0-9]/.test(id)) return true;
  return /^qc-zonage-[a-z0-9]/.test(id) && !id.startsWith("qc-zonage-norms-");
}

async function readText(store: Store, key: string): Promise<string | undefined> {
  try {
    const bytes = await store.get(key);
    return bytes === undefined ? undefined : decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

async function readCurrent(store: Store, collection: string): Promise<DisplayManifest | undefined> {
  return parseManifest(await readText(store, currentKey(collection)));
}

export type StaleReason = "no-mirror" | "other-profile" | "other-source" | "source-changed";

export type MirrorFreshness =
  | { fresh: true; manifest: DisplayManifest; sourceEtag: string }
  | { fresh: false; reason: StaleReason; sourceEtag: string; manifest?: DisplayManifest };

/**
 * Is the mirror of `collection` current for the source at `sourceKey`? Reads
 * `current.json` and HEADs the source; never reads the source bytes. Throws
 * when the source is absent or the store cannot report object identities.
 */
export async function displayMirrorFreshness(
  store: Store,
  collection: string,
  sourceKey: string,
): Promise<MirrorFreshness> {
  if (!store.stat) throw new Error("display mirror: store cannot stat objects (no ETag to compare)");
  const stat = await store.stat(sourceKey);
  if (!stat) throw new Error(`display mirror: source missing: ${sourceKey}`);
  const sourceEtag = stat.etag;
  const manifest = await readCurrent(store, collection);
  if (!manifest) return { fresh: false, reason: "no-mirror", sourceEtag };
  if (manifest.profile !== DISPLAY_PROFILE) return { fresh: false, reason: "other-profile", sourceEtag, manifest };
  if (manifest.source_key !== sourceKey) return { fresh: false, reason: "other-source", sourceEtag, manifest };
  if (manifest.source_etag !== sourceEtag) return { fresh: false, reason: "source-changed", sourceEtag, manifest };
  return { fresh: true, manifest, sourceEtag };
}

const ARTIFACTS: readonly DisplayArtifact[] = ["items", "index"];
const ENCODINGS: readonly DisplayEncoding[] = ["br", "gzip"];

/**
 * Re-point `current.json` to an existing complete version built from the same
 * source bytes. Returns the new pointer, or `undefined` when no such version
 * exists (the caller then builds).
 */
async function adoptExistingVersion(
  store: Store,
  collection: string,
  sourceKey: string,
  sourceEtag: string,
): Promise<DisplayManifest | undefined> {
  const hash = createHash("sha256");
  if (store.getStream) {
    const stream = await store.getStream(sourceKey);
    if (!stream) return undefined;
    for await (const chunk of stream) hash.update(chunk);
  } else {
    const bytes = await store.get(sourceKey);
    if (!bytes) return undefined;
    hash.update(bytes);
  }
  const sourceSha256 = hash.digest("hex");
  const version = displayVersion(sourceSha256);
  const existing = parseManifest(await readText(store, manifestKey(collection, version)));
  if (
    !existing ||
    existing.profile !== DISPLAY_PROFILE ||
    existing.version !== version ||
    existing.source_sha256 !== sourceSha256
  ) {
    return undefined;
  }
  for (const artifact of ARTIFACTS) {
    for (const encoding of ENCODINGS) {
      if (!(await store.has(artifactKey(collection, version, artifact, encoding)))) return undefined;
    }
  }
  // The ETag was read BEFORE the bytes: if the source changed in between, the
  // stamped ETag is already outdated and the next check rebuilds (fails safe).
  const pointer: DisplayManifest = { ...existing, collection, source_key: sourceKey, source_etag: sourceEtag };
  await store.put(currentKey(collection), JSON.stringify(pointer), { contentType: "application/json" });
  return pointer;
}

export interface EnsureOptions {
  /** Re-point to an existing version of the same source bytes before building (default true). */
  adopt?: boolean;
  /** Build when nothing fresh or adoptable exists (default true); false reports `needs-build`. */
  build?: boolean;
  now?: () => Date;
}

export type EnsureAction = "fresh" | "adopted" | "built" | "needs-build";

export interface EnsureResult {
  action: EnsureAction;
  collection: string;
  sourceKey: string;
  /** Why the mirror was not fresh (absent for `fresh`). */
  reason?: StaleReason;
  /** Version `current.json` points to after the call (absent for `needs-build`). */
  version?: string;
  ms: number;
}

/**
 * Make the mirror of `collection` current for `sourceKey`: skip when fresh,
 * otherwise adopt an existing version of the same bytes, otherwise build.
 * Idempotent; throws on a build/read failure.
 */
export async function ensureDisplayMirror(
  store: Store,
  collection: string,
  sourceKey: string,
  options: EnsureOptions = {},
): Promise<EnsureResult> {
  const started = Date.now();
  const done = (action: EnsureAction, extra: Partial<EnsureResult>): EnsureResult => ({
    action,
    collection,
    sourceKey,
    ...extra,
    ms: Date.now() - started,
  });
  const state = await displayMirrorFreshness(store, collection, sourceKey);
  if (state.fresh) return done("fresh", { version: state.manifest.version });
  if (options.adopt !== false) {
    const adopted = await adoptExistingVersion(store, collection, sourceKey, state.sourceEtag);
    if (adopted) return done("adopted", { reason: state.reason, version: adopted.version });
  }
  if (options.build === false) return done("needs-build", { reason: state.reason });
  const manifest = await buildDisplayMirror(store, collection, sourceKey, options.now ? { now: options.now } : {});
  return done("built", { reason: state.reason, version: manifest.version });
}

export type PublishResolution =
  | { kind: "target"; collection: string; sourceKey: string }
  | { kind: "skip"; reason: string; collection?: string };

/**
 * The served collection a write at `writtenKey` (store key) publishes, without
 * listing the store: id = `servedCollectionId(stem, meta.datasetId)` (the
 * serving rule), restricted to {@link isDisplayPublishedCollection}. Skips when
 * the written key is not the one geo-api serves for that id:
 *   - a flat key whose nested twin exists (geo-api serves nested);
 *   - a key that loses the served tie-break ({@link preferServedKey}) against
 *     the source the current mirror was built from, when that source still exists.
 * A collision this local view cannot see is left to the prewarm sweep (full
 * listing, exact index rule) and, at worst, to the API's lazy build.
 */
export async function resolvePublishedCollection(store: Store, writtenKey: string): Promise<PublishResolution> {
  if (!isCanonicalGeojsonKey(writtenKey)) return { kind: "skip", reason: "not-canonical" };
  const stem = stemOf(writtenKey);
  const meta = parseMeta(await readText(store, `${writtenKey.slice(0, -GEOJSON_SUFFIX.length)}.meta.json`));
  const collection = servedCollectionId(stem, meta?.datasetId);
  if (!isDisplayPublishedCollection(collection)) return { kind: "skip", reason: "not-display-family", collection };

  if (servedKeyLayout(writtenKey) === "flat") {
    const dir = writtenKey.slice(0, writtenKey.length - stem.length - GEOJSON_SUFFIX.length);
    if (await store.has(`${dir}${stem}/${stem}${GEOJSON_SUFFIX}`)) {
      return { kind: "skip", reason: "superseded-by-nested", collection };
    }
  }

  const current = await readCurrent(store, collection);
  const other = current?.source_key;
  if (other !== undefined && other !== writtenKey && isCanonicalGeojsonKey(other) && (await store.has(other))) {
    const [first, second] = other < writtenKey ? [other, writtenKey] : [writtenKey, other];
    if (preferServedKey(first, second) !== writtenKey) {
      return { kind: "skip", reason: "served-by-other-key", collection };
    }
  }
  return { kind: "target", collection, sourceKey: writtenKey };
}

export type PublishOutcome =
  | { status: "skipped"; key: string; reason: string; collection?: string }
  | ({ status: EnsureAction; key: string } & Omit<EnsureResult, "action">)
  | { status: "failed"; key: string; collection?: string; error: string; ms: number };

export interface PublishOptions extends EnsureOptions {
  /** Progress sink (default `console.log`); failures always also go to `console.error`. */
  log?: (line: string) => void;
}

/**
 * Writer hook: build the display mirror of the served collection that the
 * write at `writtenKey` just changed. Never throws — see the module comment.
 * Defaults to `adopt: false` (a fresh write almost always changed the bytes).
 */
export async function publishDisplayMirror(
  store: Store,
  writtenKey: string,
  options: PublishOptions = {},
): Promise<PublishOutcome> {
  const started = Date.now();
  const log = options.log ?? ((line: string) => console.log(line));
  let collection: string | undefined;
  try {
    const resolution = await resolvePublishedCollection(store, writtenKey);
    if (resolution.kind === "skip") {
      return {
        status: "skipped",
        key: writtenKey,
        reason: resolution.reason,
        ...(resolution.collection !== undefined ? { collection: resolution.collection } : {}),
      };
    }
    collection = resolution.collection;
    const { action, ...rest } = await ensureDisplayMirror(store, resolution.collection, resolution.sourceKey, {
      adopt: false,
      ...options,
    });
    log(`[display-publish] ${action} ${rest.collection}${rest.version ? ` version=${rest.version}` : ""} ms=${rest.ms}`);
    return { status: action, key: writtenKey, ...rest };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome: PublishOutcome = {
      status: "failed",
      key: writtenKey,
      ...(collection !== undefined ? { collection } : {}),
      error: message,
      ms: Date.now() - started,
    };
    // Loud, machine-greppable, and never thrown: the exact write stands; the
    // prewarm sweep (or, at worst, the API's lazy build) repairs the mirror.
    console.error(`[display-publish] ${DISPLAY_PUBLISH_FAILED} ${JSON.stringify(outcome)}`);
    return outcome;
  }
}
