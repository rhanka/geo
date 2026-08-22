import { describe, expect, it } from "vitest";

import { assertK8sNodeSpec, buildJobManifest } from "./job-manifest.js";
import type { JobSubmission } from "./ports.js";

function submission(over: Partial<JobSubmission> = {}): JobSubmission {
  return {
    name: "s3dag-extract-abc123",
    runId: "01hab",
    nodeId: "extract",
    attempt: 0,
    identity: { serviceAccountName: "s3dag-pv-sa", tokenAudiences: ["llm-gateway"] },
    spec: { image: "registry/worker:1", args: ["extract"] },
    ...over,
  };
}

// Narrow the plain-object manifest for assertions.
interface JobShape {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace: string; labels: Record<string, string> };
  spec: {
    backoffLimit: number;
    completions: number;
    parallelism: number;
    template: {
      metadata: { labels: Record<string, string> };
      spec: {
        serviceAccountName: string;
        automountServiceAccountToken: boolean;
        restartPolicy: string;
        containers: {
          name: string;
          image: string;
          args?: string[];
          env?: { name: string; value: string }[];
          volumeMounts?: { name: string; mountPath: string; readOnly: boolean }[];
        }[];
        volumes?: { name: string; projected: { sources: { serviceAccountToken: { audience: string; expirationSeconds: number; path: string } }[] } }[];
      };
    };
  };
}

const build = (over?: Partial<JobSubmission>): JobShape =>
  buildJobManifest({ namespace: "geo", lane: "pv", submission: submission(over) }) as unknown as JobShape;

describe("buildJobManifest — structure & safety invariants", () => {
  it("is a batch/v1 Job with backoffLimit:0 and restartPolicy Never (at-least-once = reconciler, not k8s retry)", () => {
    const m = build();
    expect(m.apiVersion).toBe("batch/v1");
    expect(m.kind).toBe("Job");
    expect(m.metadata.name).toBe("s3dag-extract-abc123");
    expect(m.metadata.namespace).toBe("geo");
    expect(m.spec.backoffLimit).toBe(0);
    expect(m.spec.template.spec.restartPolicy).toBe("Never");
  });

  it("runs under the stable per-lane SA with automount, never default", () => {
    const podSpec = build().spec.template.spec;
    expect(podSpec.serviceAccountName).toBe("s3dag-pv-sa");
    expect(podSpec.serviceAccountName).not.toBe("default");
    expect(podSpec.automountServiceAccountToken).toBe(true);
  });

  it("carries lane/run/node labels (observability + fallback only)", () => {
    const labels = build().metadata.labels;
    expect(labels["s3dag.io/lane"]).toBe("pv");
    expect(labels["s3dag.io/run"]).toBe("01hab");
    expect(labels["s3dag.io/node"]).toBe("extract");
    expect(labels["app.kubernetes.io/managed-by"]).toBe("s3-dag");
  });

  it("mounts one projected token per gateway audience (aud = gateway id; lane rides the sub)", () => {
    const podSpec = build().spec.template.spec;
    expect(podSpec.volumes).toHaveLength(1);
    const src = podSpec.volumes![0]!.projected.sources[0]!.serviceAccountToken;
    expect(src.audience).toBe("llm-gateway");
    expect(src.path).toBe("token");
    expect(src.expirationSeconds).toBe(3600);
    const mount = podSpec.containers[0]!.volumeMounts![0]!;
    expect(mount.mountPath).toBe("/var/run/secrets/s3dag/0");
    expect(mount.readOnly).toBe(true);
  });

  it("exposes the token dir + count to the worker via env", () => {
    const env = build().spec.template.spec.containers[0]!.env!;
    const byName = Object.fromEntries(env.map((e) => [e.name, e.value]));
    expect(byName["S3DAG_TOKEN_DIR"]).toBe("/var/run/secrets/s3dag");
    expect(byName["S3DAG_TOKEN_COUNT"]).toBe("1");
  });

  it("mounts NO projected token when the node declares no audiences", () => {
    const podSpec = build({ identity: { serviceAccountName: "s3dag-pv-sa", tokenAudiences: [] } }).spec.template.spec;
    expect(podSpec.volumes).toBeUndefined();
    expect(podSpec.containers[0]!.volumeMounts).toBeUndefined();
  });
});

describe("assertK8sNodeSpec", () => {
  it("rejects a spec with no string image", () => {
    expect(() => assertK8sNodeSpec({})).toThrow(/image/);
    expect(() => assertK8sNodeSpec(null)).toThrow(/image/);
    expect(() => assertK8sNodeSpec({ image: 42 })).toThrow(/image/);
  });

  it("accepts a minimal valid spec", () => {
    expect(() => assertK8sNodeSpec({ image: "x" })).not.toThrow();
  });
});
