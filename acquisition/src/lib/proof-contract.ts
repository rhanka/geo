/** Additive, versioned proof contract shared by qc-lots and qc-zonage. */
export type ProofStatus = "complete" | "partial" | "missing";
export interface ProofSource {
  status: "available" | "unavailable";
  artifact_uri: string | null;
  upstream_uri: string | null;
}
export interface FeatureProof {
  schema_version: "1.0";
  status: ProofStatus;
  sources: { geometry: ProofSource; regulation: ProofSource };
  zone: {
    collection: string | null;
    zone_code: string | null;
    feature_ref: string | null;
    assignment_method: string | null;
  } | null;
  gaps: string[];
}

const text = (value: unknown): string | null =>
  value === null || value === undefined || !String(value).trim() ? null : String(value).trim();

/** Only retain a URL that was actually supplied by an upstream product/config. */
export function urlOrNull(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : null;
  } catch { return null; }
}

export function source(artifactUri: string | null, upstreamUri: string | null): ProofSource {
  return { status: artifactUri || upstreamUri ? "available" : "unavailable", artifact_uri: artifactUri, upstream_uri: upstreamUri };
}

export function proofStatus(gaps: string[]): ProofStatus {
  return gaps.length === 0 ? "complete" : "partial";
}

export function zoneProof(input: {
  geometryArtifact: string;
  geometryUpstream: unknown;
  regulationArtifact: string | null;
  regulationUpstream: unknown;
}): FeatureProof {
  const gaps: string[] = [];
  const regulationUrl = urlOrNull(input.regulationUpstream);
  if (!input.regulationArtifact && !regulationUrl) gaps.push("regulation_source_unavailable");
  return {
    schema_version: "1.0", status: proofStatus(gaps),
    sources: { geometry: source(input.geometryArtifact, urlOrNull(input.geometryUpstream)), regulation: source(input.regulationArtifact, regulationUrl) },
    zone: null, gaps,
  };
}

export function lotProof(input: {
  geometryArtifact: string;
  zoneCollection: string | null;
  zoneCode: unknown;
  zoneFeatureRef: string | null;
  assignmentMethod: unknown;
  regulationArtifact: string | null;
  regulationUpstream: unknown;
}): FeatureProof {
  const zoneCode = text(input.zoneCode);
  const assignmentMethod = text(input.assignmentMethod);
  const regulationUrl = urlOrNull(input.regulationUpstream);
  const gaps: string[] = [];
  if (!zoneCode) gaps.push("zone_assignment_unavailable");
  else if (!input.zoneFeatureRef) gaps.push("precise_zone_feature_unavailable");
  if (!assignmentMethod) gaps.push("assignment_method_unavailable");
  if (!input.regulationArtifact && !regulationUrl) gaps.push("regulation_source_unavailable");
  return {
    schema_version: "1.0", status: proofStatus(gaps),
    sources: {
      geometry: source(input.geometryArtifact, null),
      regulation: source(input.regulationArtifact, regulationUrl),
    },
    zone: { collection: input.zoneCollection, zone_code: zoneCode, feature_ref: input.zoneFeatureRef, assignment_method: assignmentMethod },
    gaps,
  };
}
