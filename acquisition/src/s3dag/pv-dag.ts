/**
 * The PV canary DAG for @sentropic/s3-dag (WP7 tronc-commun refresh engine).
 *
 * Canari A (orchestrator + run isolation): a small linear DAG whose nodes do real
 * S3 work on the PREPROD bucket, so the reconciler proves the four owner proofs
 * (crash recovery, quota respect, complete immo read-model, index rebuild from
 * S3-only) + run isolation, WITHOUT touching prod or the legacy backlog.
 *
 * Identity (the load-bearing property — see identity.ts): every node's Job runs as
 * the STABLE per-lane SA `s3dag-pv-sa` (assigned by the reconciler, never by the
 * pod; the SA is bare/default-deny, no `jobs:create`), and the lane rides its
 * api-server-signed `sub`. The gateway audience (canari B / prod egress) is a
 * per-node config, mounted as a projected Bearer token (exactly one aud per file).
 */

import { defineDag, type Dag, type NodeDef } from "../../../packages/s3-dag/src/dag.js";
import { laneServiceAccountName } from "../../../packages/s3-dag/src/identity.js";
import type { K8sNodeSpec } from "../../../packages/s3-dag/src/job-manifest.js";

export interface PvCanaryDagOptions {
  /** Digest-pinned worker image (ghcr.io/rhanka/geo-capture@sha256:…). */
  image: string;
  /** Secret with S3 creds mounted via envFrom (data-store only, never a gateway key). */
  s3SecretName: string;
}

function node(nodeId: string, opts: PvCanaryDagOptions, needs?: readonly string[]): NodeDef {
  const spec: K8sNodeSpec = {
    image: opts.image,
    command: ["tsx", "src/s3dag/canary-node-run.ts"],
    args: [nodeId],
    envFrom: [opts.s3SecretName],
    resources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "200m", memory: "256Mi" } },
  };
  return needs ? { needs, spec } : { spec };
}

/**
 * Build the PV canary DAG. `serviceAccountName` is the stable per-lane SA
 * (`s3dag-pv-sa`); the reconciler's lane mode re-derives the same value, so the
 * fixed field and the lane-mode value agree.
 */
export function buildPvCanaryDag(opts: PvCanaryDagOptions): Dag {
  return defineDag({
    id: "pv-canary",
    serviceAccountName: laneServiceAccountName("pv"),
    nodes: {
      capture: node("capture", opts),
      normalize: node("normalize", opts, ["capture"]),
      serve: node("serve", opts, ["normalize"]),
    },
  });
}
