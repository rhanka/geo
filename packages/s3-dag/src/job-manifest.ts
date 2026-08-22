/**
 * PURE builder: a Kubernetes Job manifest from a {@link JobSubmission}. No I/O —
 * the k8s executor POSTs whatever this returns. Design invariants:
 *
 *  - `backoffLimit: 0` — at-least-once is the RECONCILER's job (idempotent
 *    re-submit by deterministic name), NOT k8s pod retries. A retried pod would
 *    double-run a node behind the reconciler's back.
 *  - `serviceAccountName` = the stable per-lane SA (the lane carrier via its
 *    verified `sub`; RBAC + observability). Never `default`.
 *  - One projected-token volume PER audience, each `aud` = the gateway id (the
 *    token's recipient — NOT the lane carrier). A node with no audiences mounts no
 *    projected token.
 *  - `s3dag.io/{lane,run,node}` labels — observability ONLY (the run-id lives here,
 *    not in the SA name); never the security source of truth (labels are settable).
 */

import type { JobSubmission } from "./ports.js";

/** The concrete shape a DAG node's opaque `spec` must take for the k8s executor. */
export interface K8sNodeSpec {
  image: string;
  command?: readonly string[];
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  /** Projected-token lifetime in seconds (default 3600). */
  tokenExpirationSeconds?: number;
  /** Directory the projected tokens mount under (default /var/run/secrets/s3dag). */
  tokenMountDir?: string;
}

const DEFAULT_TOKEN_DIR = "/var/run/secrets/s3dag";
const DEFAULT_TOKEN_TTL = 3600;

const sanitize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function assertK8sNodeSpec(spec: unknown): asserts spec is K8sNodeSpec {
  if (typeof spec !== "object" || spec === null || typeof (spec as { image?: unknown }).image !== "string") {
    throw new Error("s3-dag: k8s node spec requires a string `image`");
  }
}

export interface BuildJobManifestArgs {
  namespace: string;
  /** Lane label (observability); the SECURITY carrier is the audience, not this. */
  lane: string;
  submission: JobSubmission;
}

/** Build the batch/v1 Job manifest (a plain JSON-serialisable object). */
export function buildJobManifest(args: BuildJobManifestArgs): Record<string, unknown> {
  const { namespace, lane, submission } = args;
  const spec = submission.spec;
  assertK8sNodeSpec(spec);
  const tokenDir = spec.tokenMountDir ?? DEFAULT_TOKEN_DIR;
  const ttl = spec.tokenExpirationSeconds ?? DEFAULT_TOKEN_TTL;

  const labels: Record<string, string> = {
    "app.kubernetes.io/managed-by": "s3-dag",
    "s3dag.io/lane": sanitize(lane) || "lane",
    "s3dag.io/run": sanitize(submission.runId) || "run",
    "s3dag.io/node": sanitize(submission.nodeId) || "node",
    "s3dag.io/attempt": String(submission.attempt),
  };

  // One projected-token volume per (lane-scoped) audience.
  const volumes = submission.identity.tokenAudiences.map((aud, i) => ({
    name: `s3dag-tok-${i}`,
    projected: {
      sources: [{ serviceAccountToken: { audience: aud, expirationSeconds: ttl, path: "token" } }],
    },
  }));
  const volumeMounts = submission.identity.tokenAudiences.map((_, i) => ({
    name: `s3dag-tok-${i}`,
    mountPath: `${tokenDir}/${i}`,
    readOnly: true,
  }));

  const env = Object.entries(spec.env ?? {}).map(([name, value]) => ({ name, value }));
  // Let the worker discover its token mounts without parsing audiences.
  env.push({ name: "S3DAG_TOKEN_DIR", value: tokenDir });
  env.push({ name: "S3DAG_TOKEN_COUNT", value: String(submission.identity.tokenAudiences.length) });

  const container: Record<string, unknown> = { name: "worker", image: spec.image };
  if (spec.command !== undefined) container["command"] = [...spec.command];
  if (spec.args !== undefined) container["args"] = [...spec.args];
  if (env.length > 0) container["env"] = env;
  if (spec.resources !== undefined) container["resources"] = spec.resources;
  if (volumeMounts.length > 0) container["volumeMounts"] = volumeMounts;

  const podSpec: Record<string, unknown> = {
    serviceAccountName: submission.identity.serviceAccountName,
    automountServiceAccountToken: true,
    restartPolicy: "Never",
    containers: [container],
  };
  if (volumes.length > 0) podSpec["volumes"] = volumes;

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: submission.name, namespace, labels },
    spec: {
      backoffLimit: 0,
      completions: 1,
      parallelism: 1,
      template: { metadata: { labels }, spec: podSpec },
    },
  };
}
