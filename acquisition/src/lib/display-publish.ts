/**
 * Publication-time display mirror — the acquisition side of the writer hook
 * (SPEC_DISPLAY_MIRROR.md § Publication). Called by the shared S3 write
 * primitives (`s3.ts`: putBytes / putStream / putBytesIfMatch) and by the
 * proof-gated served-zone writers (`zonage-proof.ts`), right after the exact
 * object landed — so every runner that publishes `qc-lots-<slug>` or
 * `qc-zonage-<slug>` builds its mirror in the same pass, without a call site of
 * its own.
 *
 * The logic (served-collection resolution, freshness, build) is the library's
 * (`@sentropic/geo/display`); this module only adapts an S3 client + bucket to a
 * store rooted at `normalized/` — the root geo-api serves (`GEO_DATA_URI =
 * s3://<bucket>/normalized`), so mirror keys land at
 * `normalized/_display/<collectionId>/…` exactly where the API reads them.
 *
 * Failure policy: never thrown. The exact write is done and stays done; the
 * failure is logged on stderr with the `DISPLAY_MIRROR_PUBLISH_FAILED` marker
 * and kept in {@link displayPublishFailures} for the runner's summary. The
 * cluster prewarm sweep repairs it; until then geo-api still builds lazily.
 *
 * Opt-out: `GEO_DISPLAY_PUBLISH=0` (unit tests with fake S3 clients, or a bulk
 * job that runs the prewarm sweep afterwards).
 */
import type { S3Client } from "@aws-sdk/client-s3";
// Explicit `.js` subpaths: they resolve through the package `exports` (dist) under
// node/vitest AND through the tsconfig `paths` (src, via tsx) in the acquisition
// images, which ship packages/geo sources without dist nor geo-core. The display
// graph is kept free of runtime geo-core imports for that reason.
import { publishDisplayMirror, type PublishOutcome } from "@sentropic/geo/display/index.js";
import { S3Store } from "@sentropic/geo/storage/index.js";

/** Store prefix geo-api serves; only writes under it can publish a collection. */
export const SERVED_ROOT = "normalized";

const failures: PublishOutcome[] = [];

/** Publication-time mirror failures of this process (for a runner summary). */
export function displayPublishFailures(): readonly PublishOutcome[] {
  return failures;
}

export function displayPublishEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env["GEO_DISPLAY_PUBLISH"] !== "0";
}

/**
 * Cheap pre-filter without any request: a GeoJSON under the served root. The
 * collection id is decided by the library from the key AND its `.meta.json`
 * (`qc-cadastre-lots/<slug>.geojson` serves `qc-lots-<slug>`), so the stem
 * alone cannot exclude a key here.
 */
export function mayPublishDisplay(key: string): boolean {
  return key.startsWith(`${SERVED_ROOT}/`) && (key.endsWith(GEOJSON) || key.endsWith(META));
}

const GEOJSON = ".geojson";
const META = ".meta.json";

/**
 * Build the display mirror of the served collection that the write of `key`
 * (full object key) in `bucket` changed. A `.meta.json` write re-resolves its
 * sibling GeoJSON (a `datasetId` decides the served id, and a writer may land
 * the meta after the GeoJSON). No-op outside `normalized/`, for other keys, and
 * when disabled. Never throws.
 */
export async function publishDisplayAfterWrite(
  s3: S3Client,
  key: string,
  bucket: string,
): Promise<PublishOutcome | undefined> {
  if (!displayPublishEnabled() || !mayPublishDisplay(key)) return undefined;
  const store = new S3Store({ bucket, prefix: SERVED_ROOT, client: s3 });
  let storeKey = key.slice(SERVED_ROOT.length + 1);
  if (storeKey.endsWith(META)) {
    storeKey = `${storeKey.slice(0, -META.length)}${GEOJSON}`;
    // A meta written before its GeoJSON: the GeoJSON write publishes later.
    // A HEAD error falls through, so the publication below reports it loudly.
    if (!(await store.has(storeKey).catch(() => true))) return undefined;
  }
  const outcome = await publishDisplayMirror(store, storeKey);
  if (outcome.status === "failed") failures.push(outcome);
  return outcome;
}
