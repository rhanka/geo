/**
 * Non-negotiable acquisition proof for a served qc-zonage GeoJSON.
 * A URL is the fetched geometry artefact/endpoint, never an S3 key, local path,
 * home page, pipeline label, or regulation URL.
 */
import { createHash } from "node:crypto";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { BUCKET, isServedZoneKey } from "./s3.js";

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
