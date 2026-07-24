/**
 * Non-negotiable acquisition proof for a served qc-zonage GeoJSON.
 * A URL is the fetched geometry artefact/endpoint, never an S3 key, local path,
 * home page, pipeline label, or regulation URL.
 */
import { createHash } from "node:crypto";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { BUCKET, isServedZoneKey, getBytes, objectHead, copyObject } from "./s3.js";

export type GeometrySourceType = "wfs" | "arcgis" | "agol" | "geonet" | "jmap" | "geojson-officiel" | "pdf-zonage";
export type GeometryMethod = "natif" | "georeference";
export type GeometryReliability = "directe" | "georeferencee";
export interface GeometrySourceProof {
  url: string;
  type: GeometrySourceType;
  method: GeometryMethod;
  reliability: GeometryReliability;
  retrieved_at: string;
  sha256: `sha256:${string}`;
}
export interface ServedZoneGeoJson { type: "FeatureCollection"; features: Array<{ properties?: Record<string, unknown> | null }>; proof?: { schema_version: "2.0"; geometry_source: GeometrySourceProof } }

const SOURCE_TYPES = new Set<GeometrySourceType>(["wfs", "arcgis", "agol", "geonet", "jmap", "geojson-officiel", "pdf-zonage"]);
const METHODS = new Set<GeometryMethod>(["natif", "georeference"]);
const RELIABILITIES = new Set<GeometryReliability>(["directe", "georeferencee"]);
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function isRealGeometryUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    // Fragments are permitted (e.g. layer identity), but the actual network URL
    // must remain HTTP(S), and internal storage/local pseudo-sources are rejected.
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname && !/^(localhost|127\.|::1)/i.test(u.hostname) && !/s3[.:]/i.test(u.hostname);
  } catch { return false; }
}

export function sha256(bytes: string | Buffer | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function proofFromFetched(input: Omit<GeometrySourceProof, "retrieved_at" | "sha256"> & { bytes: string | Buffer | Uint8Array; retrievedAt?: string }): GeometrySourceProof {
  if (!isRealGeometryUrl(input.url)) throw new Error(`geometry proof requires a real HTTP(S) acquisition URL, got ${JSON.stringify(input.url)}`);
  const retrieved_at = input.retrievedAt ?? new Date().toISOString();
  if (!isIsoTimestamp(retrieved_at)) throw new Error("geometry proof retrieved_at must be an ISO timestamp");
  const proof = { url: input.url, type: input.type, method: input.method, reliability: input.reliability, retrieved_at, sha256: sha256(input.bytes) };
  assertGeometryProof(proof);
  return proof;
}

export function assertGeometryProof(value: unknown): asserts value is GeometrySourceProof {
  const p = value as Partial<GeometrySourceProof> | null;
  const coherentMethod = p?.method === "natif"
    ? p.reliability === "directe" && p.type !== "pdf-zonage"
    : p?.method === "georeference"
      ? p.reliability === "georeferencee" && p.type === "pdf-zonage"
      : false;
  if (
    !p ||
    !isRealGeometryUrl(p.url) ||
    !SOURCE_TYPES.has(p.type as GeometrySourceType) ||
    !METHODS.has(p.method as GeometryMethod) ||
    !RELIABILITIES.has(p.reliability as GeometryReliability) ||
    !coherentMethod ||
    !isIsoTimestamp(p.retrieved_at) ||
    !/^sha256:[a-f0-9]{64}$/.test(String(p.sha256))
  ) {
    throw new Error("served qc-zonage deposit refused: missing or invalid geometry acquisition proof");
  }
}

export function sameGeometryProof(a: unknown, b: unknown): boolean {
  try { assertGeometryProof(a); assertGeometryProof(b); }
  catch { return false; }
  return a.url === b.url && a.type === b.type && a.method === b.method && a.reliability === b.reliability && a.retrieved_at === b.retrieved_at && a.sha256 === b.sha256;
}

export { isServedZoneKey } from "./s3.js";

/** Attach the exact same reviewed acquisition proof to collection and each feature. */
export function attachGeometryProof<T extends ServedZoneGeoJson>(fc: T, geometrySource: GeometrySourceProof): T {
  assertGeometryProof(geometrySource);
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) throw new Error("served qc-zonage deposit refused: not a FeatureCollection");
  for (const feature of fc.features) feature.properties = { ...(feature.properties ?? {}), proof: { schema_version: "2.0", geometry_source: { ...geometrySource } } };
  fc.proof = { schema_version: "2.0", geometry_source: { ...geometrySource } };
  return fc;
}

/** Validate the complete object, not merely two independently well-formed proofs. */
export function assertServedZoneGeojson(key: string, fc: ServedZoneGeoJson): void {
  if (!isServedZoneKey(key)) throw new Error(`not a served zonage key: ${key}`);
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features) || fc.features.length === 0) {
    throw new Error("served qc-zonage deposit refused: empty or invalid FeatureCollection");
  }
  if (fc.proof?.schema_version !== "2.0") throw new Error("served qc-zonage deposit refused: invalid collection proof schema");
  assertGeometryProof(fc.proof?.geometry_source);
  for (const f of fc.features) {
    const proof = f.properties?.proof as { schema_version?: unknown; geometry_source?: unknown } | undefined;
    if (proof?.schema_version !== "2.0" || !sameGeometryProof(fc.proof.geometry_source, proof.geometry_source)) {
      throw new Error("served qc-zonage deposit refused: feature proof differs from collection proof");
    }
  }
}

/** Only route for new served-zone writes. It validates proof immediately before S3. */
export async function putServedZoneGeojson(s3: S3Client, key: string, fc: ServedZoneGeoJson): Promise<void> {
  assertServedZoneGeojson(key, fc);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(fc), ContentType: "application/geo+json" }));
}

/**
 * Provenance metadata keys an ADDITIVE fold may add/update/delete on an already
 * served qc-zonage collection WITHOUT re-proving geometry. This is the CEILING:
 * a caller narrows it via `opts.allowedProps` but can never widen it. Any key
 * OUTSIDE this set that differs from the served object aborts the write, so the
 * geometry and the `proof` block stay immutable through this path. These are the
 * exact keys the metadata folds stamp: reglement (fold-reglement-to-zonage),
 * usage_dominant (fold-usage-dominant), geometry status (fold-geometry-status-to-zonage)
 * and source url/level (fold-zone-source-to-zonage).
 */
export const PROVENANCE_PROP_WHITELIST: ReadonlySet<string> = new Set<string>([
  "reglement_numero",
  "reglement_millesime",
  "reglement_page_source",
  "reglement_url",
  "usage_dominant",
  "usage_dominant_source",
  "zone_geometry_status",
  "zone_geometry_flagged",
  "zone_source_url",
  "zone_source_level",
]);

export interface AdditiveOptions {
  /** Narrow the ceiling to exactly the keys this fold stamps (defence in depth).
   *  Must be a subset of {@link PROVENANCE_PROP_WHITELIST} or the write fails closed. */
  allowedProps?: Iterable<string>;
  /** Take a non-destructive server-side backup of the current served object to
   *  `<key>.additive-prebackup.geojson` before overwriting. Default true. */
  backup?: boolean;
}

/** Order-tolerant-per-key deep equality via canonical JSON. Both operands here are
 *  parsed from the SAME served bytes (geometry) or scalar provenance values, so a
 *  stringify compare is exact and cheap; it never treats a real change as equal. */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

interface AdditiveFeature { geometry?: unknown; properties?: Record<string, unknown> | null }
interface AdditiveFC { type?: unknown; features?: AdditiveFeature[] }

/**
 * ADDITIVE provenance write onto an ALREADY SERVED qc-zonage collection.
 *
 * The ONLY sanctioned way for a metadata fold to touch a served-zone key. It does
 * NOT relax the geometry proof gate of {@link putServedZoneGeojson}: it PROVES the
 * geometry is byte-identical to what is already served and refuses anything else,
 * so no new geometry can enter by this door.
 *
 * Safety invariants enforced before a single byte is written:
 *   (a) the target key ALREADY EXISTS — this path never CREATES a served collection;
 *   (b) same feature COUNT and same ORDER as the served object;
 *   (c) each feature's GEOMETRY is byte-identical to the served geometry;
 *   (d) every property that DIFFERS from the served object is in the whitelist —
 *       a fold may add/update/delete provenance keys and NOTHING else, so the
 *       `proof` block and every substantive attribute stay untouched.
 * The current served object is re-read from S3 as the baseline (the caller is never
 * trusted for it). Then a non-destructive backup is taken and the bytes are written.
 */
export async function putServedZoneAdditive(
  s3: S3Client,
  key: string,
  fc: AdditiveFC,
  opts: AdditiveOptions = {},
): Promise<{ features: number }> {
  if (!isServedZoneKey(key)) throw new Error(`putServedZoneAdditive: not a served zonage key: ${key}`);
  const allowed = opts.allowedProps ? new Set(opts.allowedProps) : new Set(PROVENANCE_PROP_WHITELIST);
  for (const k of allowed) {
    if (!PROVENANCE_PROP_WHITELIST.has(k)) {
      throw new Error(`putServedZoneAdditive: "${k}" is not a provenance metadata key; refuse to widen the whitelist`);
    }
  }
  if (fc?.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new Error("putServedZoneAdditive: payload is not a FeatureCollection");
  }
  // (a) the collection must already be served — additive writes never create one.
  if (!(await objectHead(s3, key)).exists) {
    throw new Error(`putServedZoneAdditive: refuse to create a served collection additively (${key})`);
  }
  // Re-read the authoritative served object as the geometry baseline; never trust
  // the caller's in-memory copy for what is currently served.
  const current = JSON.parse((await getBytes(s3, key)).toString("utf8")) as AdditiveFC;
  const curFeats = Array.isArray(current.features) ? current.features : [];
  const nxtFeats = fc.features as AdditiveFeature[];
  // (b) same count and order.
  if (curFeats.length !== nxtFeats.length) {
    throw new Error(
      `putServedZoneAdditive: feature count changed (${curFeats.length} -> ${nxtFeats.length}); a geometry change requires putServedZoneGeojson with proof`,
    );
  }
  for (let i = 0; i < curFeats.length; i++) {
    const cur = curFeats[i]!;
    const nxt = nxtFeats[i]!;
    // (c) geometry byte-identical.
    if (!jsonEqual(cur.geometry, nxt.geometry)) {
      throw new Error(
        `putServedZoneAdditive: feature ${i} geometry differs from served; new geometry requires putServedZoneGeojson with proof`,
      );
    }
    // (d) only whitelisted properties may differ (add / update / delete).
    const curProps = (cur.properties ?? {}) as Record<string, unknown>;
    const nxtProps = (nxt.properties ?? {}) as Record<string, unknown>;
    for (const propKey of new Set([...Object.keys(curProps), ...Object.keys(nxtProps)])) {
      if (jsonEqual(curProps[propKey], nxtProps[propKey])) continue;
      if (!allowed.has(propKey)) {
        throw new Error(
          `putServedZoneAdditive: non-provenance property "${propKey}" changed on feature ${i}; refused (geometry/proof and substantive attributes are immutable on this path)`,
        );
      }
    }
  }
  // Non-destructive backup of the current served object before overwriting. The
  // backup key carries a suffix before `.geojson`, so it is NOT a served-zone key
  // and the generic copy gate accepts it (single, overwriteable "before this write").
  if (opts.backup !== false) {
    await copyObject(s3, key, `${key.replace(/\.geojson$/, "")}.additive-prebackup.geojson`);
  }
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(fc), ContentType: "application/geo+json" }),
  );
  return { features: nxtFeats.length };
}
