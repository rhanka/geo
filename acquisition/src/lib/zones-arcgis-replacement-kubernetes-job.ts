/**
 * Decode the Kubernetes API object that attests an ArcGIS replacement capture.
 *
 * This is deliberately separate from the S3 receipt verifier: Kubernetes is
 * the authority for whether the pod actually completed, while S3 is the
 * authority for the bytes it captured.  A caller must obtain this object from
 * the declared cluster before it can construct `CompletedCaptureJob`.
 */
import type { CompletedCaptureJob } from "./zones-arcgis-replacement-receipt.js";

export interface KubernetesJobObservation {
  metadata?: {
    name?: unknown;
    namespace?: unknown;
    labels?: Record<string, unknown>;
  };
  status?: {
    succeeded?: unknown;
    failed?: unknown;
    completionTime?: unknown;
  };
}

export interface ExpectedZonesArcgisCaptureJob {
  runId: string;
  namespace: string;
  slug: string;
}

const APP = "geo-zones-arcgis-replacement-capture";

function labelsOf(job: KubernetesJobObservation): Record<string, unknown> {
  const labels = job.metadata?.labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error("deposit refused: Kubernetes capture Job has no labels");
  }
  return labels;
}

/**
 * Fail closed unless this is the exact mono-city Job submitted for the S3 run.
 * The label checks deliberately precede status checks: a completed Job for the
 * same city or timestamp is not evidence for a different immutable run.
 */
export function completedZonesArcgisCaptureJob(
  job: KubernetesJobObservation,
  expected: ExpectedZonesArcgisCaptureJob,
): CompletedCaptureJob {
  if (
    typeof job.metadata?.name !== "string" ||
    job.metadata.name.length === 0 ||
    job.metadata.namespace !== expected.namespace
  ) {
    throw new Error("deposit refused: Kubernetes capture Job identity is incomplete or in another namespace");
  }
  const labels = labelsOf(job);
  if (
    labels["app"] !== APP ||
    labels["lane"] !== "zones" ||
    labels["geo.city"] !== expected.slug ||
    labels["geo.run-id"] !== expected.runId
  ) {
    throw new Error("deposit refused: Kubernetes capture Job labels do not attest the expected zones run");
  }

  const succeeded = job.status?.succeeded;
  const failed = job.status?.failed ?? 0;
  const completionTime = job.status?.completionTime;
  if (
    succeeded !== 1 ||
    failed !== 0 ||
    typeof completionTime !== "string" ||
    Number.isNaN(Date.parse(completionTime))
  ) {
    throw new Error("deposit refused: Kubernetes capture Job is not exactly one completed success");
  }
  return { runId: expected.runId, succeeded, failed, completionTime };
}
