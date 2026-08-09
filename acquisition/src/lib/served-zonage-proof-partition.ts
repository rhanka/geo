/**
 * Pure classification rules for the closed partition of proof envelopes
 * exposed by served QC zoning collections. The runner supplies only immutable
 * manifest tuple identities; this module performs no I/O.
 */

export const PROOF_PARTITION_CATEGORIES = [
  "PREUVE_V2_EXACTE",
  "URL_SHA_SANS_CAPTURE",
  "URI_INTERNE",
  "SHA_ABSENT",
  "PAS_DE_PREUVE",
  "AUTRE",
] as const;

export type ProofPartitionCategory = (typeof PROOF_PARTITION_CATEGORIES)[number];

export interface ProofEnvelopeSample {
  location: "collection.proof" | "feature.properties.proof";
  proof: unknown;
}

export interface ProofPartitionRowInput {
  slug: string;
  proof_values: number;
  proof_envelope_samples: readonly ProofEnvelopeSample[];
}

export interface ProofObservation {
  category: ProofPartitionCategory;
  reason: string;
  field: string | null;
  url: string | null;
  sha256: string | null;
  retrieved_at: string | null;
}

export interface ClassifiedProofCollection {
  slug: string;
  category: ProofPartitionCategory;
  mixed_forms: boolean;
  observations: ProofObservation[];
}

const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const STRENGTH: Record<ProofPartitionCategory, number> = {
  PREUVE_V2_EXACTE: 6,
  URL_SHA_SANS_CAPTURE: 5,
  URI_INTERNE: 4,
  SHA_ABSENT: 3,
  PAS_DE_PREUVE: 2,
  AUTRE: 1,
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function manifestTuple(url: string, retrievedAt: string, sha256: string): string {
  return JSON.stringify([url, retrievedAt, sha256]);
}

function classifyGeometrySource(
  value: Record<string, unknown>,
  field: "proof.sources.geometry.artifact_uri" | "proof.geometry_source.url",
  manifestTuples: ReadonlySet<string>,
): ProofObservation {
  const url = field === "proof.sources.geometry.artifact_uri" ? value.artifact_uri : value.url;
  const sha256 = typeof value.sha256 === "string" ? value.sha256 : null;
  const retrievedAt = typeof value.retrieved_at === "string" ? value.retrieved_at : null;
  if (validHttpsUrl(url)) {
    if (sha256 === null || !SHA256_RE.test(sha256)) {
      return { category: "SHA_ABSENT", reason: "https-uri-sha256-absent-or-malformed", field, url, sha256, retrieved_at: retrievedAt };
    }
    if (validTimestamp(retrievedAt) && manifestTuples.has(manifestTuple(url, retrievedAt, sha256))) {
      return { category: "PREUVE_V2_EXACTE", reason: "https-uri-sha256-retrieved-at-manifest-match", field, url, sha256, retrieved_at: retrievedAt };
    }
    return { category: "URL_SHA_SANS_CAPTURE", reason: "https-uri-sha256-without-exact-capture", field, url, sha256, retrieved_at: retrievedAt };
  }
  if (typeof url === "string" && url.startsWith("s3://")) {
    return { category: "URI_INTERNE", reason: "s3-artifact-uri", field, url, sha256, retrieved_at: retrievedAt };
  }
  if (url === null || url === undefined || url === "") {
    return { category: "PAS_DE_PREUVE", reason: "geometry-uri-absent", field, url: null, sha256, retrieved_at: retrievedAt };
  }
  return { category: "AUTRE", reason: "geometry-uri-not-https-or-s3", field, url: typeof url === "string" ? url : null, sha256, retrieved_at: retrievedAt };
}

function observationsForEnvelope(proofValue: unknown, manifestTuples: ReadonlySet<string>): ProofObservation[] {
  const proof = record(proofValue);
  if (proof === null) {
    return [{ category: "PAS_DE_PREUVE", reason: "proof-envelope-not-an-object", field: null, url: null, sha256: null, retrieved_at: null }];
  }
  const legacyGeometry = record(record(proof.sources)?.geometry);
  const v2Geometry = record(proof.geometry_source);
  const observations: ProofObservation[] = [];
  if (legacyGeometry !== null) {
    observations.push(classifyGeometrySource(legacyGeometry, "proof.sources.geometry.artifact_uri", manifestTuples));
  }
  if (v2Geometry !== null) {
    observations.push(classifyGeometrySource(v2Geometry, "proof.geometry_source.url", manifestTuples));
  }
  return observations.length > 0
    ? observations
    : [{ category: "PAS_DE_PREUVE", reason: "proof-envelope-has-no-geometry-source", field: null, url: null, sha256: null, retrieved_at: null }];
}

/**
 * A collection receives the least strong category observed on any of its proof
 * envelopes. This makes a mixed collection impossible to over-credit.
 */
export function classifyProofPartitionCollection(
  row: ProofPartitionRowInput,
  manifestTuples: ReadonlySet<string>,
): ClassifiedProofCollection {
  const observations = row.proof_envelope_samples.flatMap((sample) => observationsForEnvelope(sample.proof, manifestTuples));
  if (observations.length === 0 && row.proof_values > 0) {
    observations.push({ category: "PAS_DE_PREUVE", reason: "proof-envelope-not-exploitable", field: null, url: null, sha256: null, retrieved_at: null });
  }
  if (observations.length === 0) {
    observations.push({ category: "PAS_DE_PREUVE", reason: "proof-envelope-absent", field: null, url: null, sha256: null, retrieved_at: null });
  }
  const category = observations.reduce((weakest, observation) =>
    STRENGTH[observation.category] < STRENGTH[weakest] ? observation.category : weakest,
  observations[0]!.category);
  return {
    slug: row.slug,
    category,
    mixed_forms: new Set(observations.map((observation) => observation.category)).size > 1,
    observations,
  };
}
