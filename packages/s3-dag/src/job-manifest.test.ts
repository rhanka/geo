import { describe, expect, it } from "vitest";

import { assertK8sNodeSpec, buildJobManifest, resolveFanout } from "./job-manifest.js";
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
    completionMode?: string;
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
          envFrom?: { secretRef: { name: string } }[];
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

  it("runs under the stable per-lane SA with automount OFF (projected token is the only token)", () => {
    const podSpec = build().spec.template.spec;
    expect(podSpec.serviceAccountName).toBe("s3dag-pv-sa");
    expect(podSpec.serviceAccountName).not.toBe("default");
    expect(podSpec.automountServiceAccountToken).toBe(false);
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

  it("carries EXACTLY ONE audience per token file, separate volumes for multiple recipients (never stacked)", () => {
    // C7 is strict equality on aud: a multi-audience token would be replayable elsewhere.
    const podSpec = build({ identity: { serviceAccountName: "s3dag-pv-sa", tokenAudiences: ["gw-a", "gw-b"] } }).spec.template.spec;
    expect(podSpec.volumes).toHaveLength(2); // one volume per recipient
    for (const v of podSpec.volumes!) {
      expect(v.projected.sources).toHaveLength(1); // one source
      expect(typeof v.projected.sources[0]!.serviceAccountToken.audience).toBe("string"); // one aud, not an array
    }
    const auds = podSpec.volumes!.map((v) => v.projected.sources[0]!.serviceAccountToken.audience);
    expect(auds).toEqual(["gw-a", "gw-b"]); // distinct files, distinct aud
    const mounts = podSpec.containers[0]!.volumeMounts!.map((m) => m.mountPath);
    expect(new Set(mounts).size).toBe(2); // distinct mount paths
  });

  it("mounts NO projected token when the node declares no audiences", () => {
    const podSpec = build({ identity: { serviceAccountName: "s3dag-pv-sa", tokenAudiences: [] } }).spec.template.spec;
    expect(podSpec.volumes).toBeUndefined();
    expect(podSpec.containers[0]!.volumeMounts).toBeUndefined();
  });
});

describe("buildJobManifest — fan-out (Indexed Job) & creds surface", () => {
  it("stays a single completion by default (no completionMode)", () => {
    const m = build();
    expect(m.spec.completions).toBe(1);
    expect(m.spec.parallelism).toBe(1);
    expect(m.spec.completionMode).toBeUndefined();
  });

  it("becomes an Indexed Job when the node declares completions > 1", () => {
    const m = build({ spec: { image: "registry/worker:1", args: ["capture"], completions: 6 } as unknown as JobSubmission["spec"] });
    expect(m.spec.completions).toBe(6);
    expect(m.spec.parallelism).toBe(6); // defaults to completions
    expect(m.spec.completionMode).toBe("Indexed");
  });

  it("honours an explicit parallelism bound under fan-out", () => {
    const m = build({ spec: { image: "x", completions: 10, parallelism: 3 } as unknown as JobSubmission["spec"] });
    expect(m.spec.completions).toBe(10);
    expect(m.spec.parallelism).toBe(3);
  });

  it("REFUSES completions < 1 structurally (zero-shard node is COMPLETE, never an empty Job)", () => {
    // Forces the reconciler to resolve an all-done fan-out node to SUCCESS instead of
    // silently coercing it to a 1-pod Job — the empty-because-done vs empty-because-absent
    // distinction (h-arch) made structural, not a comment.
    expect(() =>
      buildJobManifest({ namespace: "geo", lane: "pv", submission: submission({ spec: { image: "x", completions: 0 } as unknown as JobSubmission["spec"] }) }),
    ).toThrow(/completions < 1|zero-shard/);
  });

  it("mounts S3 creds via envFrom (data-store only) and NO static gateway key", () => {
    const m = build({ spec: { image: "x", envFrom: ["geo-s3-credentials-preprod"] } as unknown as JobSubmission["spec"] });
    const c = m.spec.template.spec.containers[0]!;
    expect(c.envFrom).toEqual([{ secretRef: { name: "geo-s3-credentials-preprod" } }]);
    // The only gateway credential is the projected Bearer token — never a static key in env.
    const envNames = (c.env ?? []).map((e) => e.name);
    expect(envNames).not.toContain("ANTHROPIC_API_KEY");
    expect(envNames).not.toContain("X_API_KEY");
  });
});

describe("resolveFanout — typed empty-done vs run (structural, not a guard)", () => {
  it("resolves 0 remaining to `complete` (no Job — the all-done node succeeds, never a silent 1-pod)", () => {
    expect(resolveFanout(0)).toEqual({ kind: "complete" });
  });

  it("resolves N>0 to `run` with a REQUIRED completions (no optional to slip through)", () => {
    expect(resolveFanout(6)).toEqual({ kind: "run", completions: 6 });
    expect(resolveFanout(1)).toEqual({ kind: "run", completions: 1 });
  });

  it("throws on a negative or non-integer count (a broken sizing is a defect, not a 1-pod)", () => {
    expect(() => resolveFanout(-1)).toThrow(/non-negative/);
    expect(() => resolveFanout(1.5)).toThrow(/non-negative/);
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
