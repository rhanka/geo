/**
 * Pure rules for the served-zone provenance quality matrix.
 *
 * The runner owns S3 I/O.  This module only resolves the effective geo-api
 * layout and classifies observations already read from S3, so the safety rules
 * are unit-testable without credentials or network access.
 */
import {
  CAS_KEY_RE,
  captureProofFields,
  type CaptureManifestLine,
} from "../../../packages/qc-sources/src/capture/index.js";
import {
  assertGeometryProof,
  assertServedZoneGeojson,
  sameGeometryProof,
  type ServedZoneGeoJson,
  type GeometrySourceProof,
} from "./zonage-proof.js";

export const SERVED_ZONE_PREFIX = "normalized/ca-qc-zonage/";
export const QUALITY_STATUSES = ["acceptable", "candidate", "orphan", "unknown", "v2"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];
export type ServedLayout = "flat" | "nested";

export interface ServedZoneCollection {
  slug: string;
  key: string;
  layout: ServedLayout;
  alternatives: string[];
}

export interface CaptureReceipt {
  manifest_key: string;
  line_index: number;
  storage_key: string;
  url: string;
  retrieved_at: string;
  sha256: `sha256:${string}`;
}

export interface VerifiedCaptureReceipt extends CaptureReceipt {
  raw_sha256_verified: true;
}

export interface ServedCollectionClassification {
  status: QualityStatus;
  reason: string;
  /** Exact JSON value read from the served collection, or null when absent. */
  proof: Record<string, unknown> | null;
  /** Exact capture receipt only after its raw CAS bytes were re-hashed. */
  capture: VerifiedCaptureReceipt | null;
}

interface FeatureLike {
  properties?: unknown;
}

interface CollectionLike {
  type?: unknown;
  features?: unknown;
  proof?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseServedZoneKey(key: string): { slug: string; layout: ServedLayout } | null {
  const rest = key.startsWith(SERVED_ZONE_PREFIX) ? key.slice(SERVED_ZONE_PREFIX.length) : "";
  const flat = /^qc-zonage-([a-z0-9-]+)\.geojson$/.exec(rest);
  if (flat) return { slug: flat[1]!, layout: "flat" };
  const nested = /^qc-zonage-([a-z0-9-]+)\/qc-zonage-\1\.geojson$/.exec(rest);
  return nested ? { slug: nested[1]!, layout: "nested" } : null;
}

/** geo-api serves the nested object when both canonical physical layouts exist. */
export function selectServedZoneCollections(keys: readonly string[]): ServedZoneCollection[] {
  const grouped = new Map<string, Partial<Record<ServedLayout, string>>>();
  for (const key of keys) {
    const parsed = parseServedZoneKey(key);
    if (!parsed) continue;
    const layouts = grouped.get(parsed.slug) ?? {};
    layouts[parsed.layout] = key;
    grouped.set(parsed.slug, layouts);
  }
  return [...grouped.entries()]
    .map(([slug, layouts]) => {
      const layout: ServedLayout = layouts.nested ? "nested" : "flat";
      const key = layouts[layout]!;
      const alternatives = [layouts.flat, layouts.nested].filter(
        (candidate): candidate is string => !!candidate && candidate !== key,
      ).sort();
      return { slug, key, layout, alternatives };
    })
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

export function proofTuple(value: Pick<GeometrySourceProof, "url" | "retrieved_at" | "sha256">): string {
  return JSON.stringify([value.url, value.retrieved_at, value.sha256]);
}

/** Convert the suffix returned by listSlugs into one exact capture manifest key. */
export function captureManifestKeyFromListedRest(rest: string): string | null {
  const runId = rest.endsWith("/") ? rest.slice(0, -1) : "";
  // buildCaptureRunId uses uppercase T/Z in its sortable timestamp. Restrict
  // the rest to one path segment, but never lowercase or otherwise rewrite the
  // observed S3 run id.
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(runId) ? `capture/_runs/${runId}/manifest.jsonl` : null;
}

/**
 * Retain a capture row only if its own capture contract is complete and its
 * storage key is a CAS key for the exact declared SHA.  Existence and byte
 * hashing of the CAS payload remain an I/O concern for the runner.
 */
export function captureReceiptFromManifest(
  line: CaptureManifestLine,
  manifestKey: string,
  lineIndex: number,
): CaptureReceipt | null {
  try {
    const fields = captureProofFields(line);
    if (line.storage_key === null) return null;
    const cas = CAS_KEY_RE.exec(line.storage_key);
    if (!cas || cas[2] !== fields.sha256.slice("sha256:".length)) return null;
    return {
      manifest_key: manifestKey,
      line_index: lineIndex,
      storage_key: line.storage_key,
      ...fields,
    };
  } catch {
    return null;
  }
}

/** A served proof is structurally eligible only when putServedZoneGeojson would accept its proof links. */
export function completeServedGeometryProof(collection: unknown): GeometrySourceProof | null {
  if (!isRecord(collection)) return null;
  const fc = collection as CollectionLike;
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features) || fc.features.length === 0) return null;
  const wrapper = isRecord(fc.proof) ? fc.proof : null;
  if (wrapper?.schema_version !== "2.0") return null;
  const proof = wrapper.geometry_source;
  try {
    // This is the complete write contract, including each feature's explicit
    // zone_source_url and zone_source_level. A malformed object the production
    // writer would reject can never receive the stronger v2 credit here.
    assertServedZoneGeojson(
      "normalized/ca-qc-zonage/qc-zonage-proof-validation.geojson",
      collection as unknown as ServedZoneGeoJson,
    );
    assertGeometryProof(proof);
  } catch {
    return null;
  }
  for (const feature of fc.features as FeatureLike[]) {
    const props = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null;
    const featureWrapper = props && isRecord(props.proof) ? props.proof : null;
    if (featureWrapper?.schema_version !== "2.0" || !sameGeometryProof(proof, featureWrapper.geometry_source)) {
      return null;
    }
  }
  return proof;
}

function observedProof(collection: unknown): Record<string, unknown> | null {
  if (!isRecord(collection) || !isRecord((collection as CollectionLike).proof)) return null;
  return (collection as CollectionLike).proof as Record<string, unknown>;
}

function uniformSourceLevel(collection: unknown): QualityStatus | null {
  if (!isRecord(collection)) return null;
  const features = (collection as CollectionLike).features;
  if (!Array.isArray(features) || features.length === 0) return null;
  let level: unknown = undefined;
  for (const feature of features as FeatureLike[]) {
    const props = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null;
    if (!props || !("zone_source_level" in props)) return null;
    const candidate = props.zone_source_level;
    if (level === undefined) level = candidate;
    else if (candidate !== level) return null;
  }
  if (level === "historical-verified" || level === "documented" || level === "legacy-traceable") return "acceptable";
  if (level === "candidate" || level === "orphan" || level === "unknown") return level;
  return null;
}

/**
 * Classify only facts observed on the selected served collection.  A matching
 * capture is supplied exclusively after the runner has re-hashed its raw CAS
 * object; no URL, timestamp, SHA or level is inferred here.
 */
export function classifyServedCollection(
  collection: unknown,
  verifiedCaptures: ReadonlyMap<string, VerifiedCaptureReceipt> = new Map(),
): ServedCollectionClassification {
  const proof = observedProof(collection);
  const exactProof = completeServedGeometryProof(collection);
  if (exactProof) {
    const capture = verifiedCaptures.get(proofTuple(exactProof)) ?? null;
    if (capture) return { status: "v2", reason: "verified-v2-capture", proof, capture };
  }

  const level = uniformSourceLevel(collection);
  const reason = exactProof ? "proof-without-attachable-capture" : proof ? "incomplete-or-invalid-geometry-proof" : "no-geometry-proof";
  if (level) return { status: level, reason, proof, capture: null };
  return { status: "unknown", reason: `${reason}; source-level-not-uniform-or-absent`, proof, capture: null };
}
