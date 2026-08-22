import { describe, expect, it } from "vitest";

import {
  jobFailureReason,
  jobStatusOf,
  K8sJobExecutor,
  type K8sJobsApi,
  type RawJob,
  type RawPod,
} from "./executor-k8s.js";
import type { JobSubmission } from "./ports.js";

class FakeApi implements K8sJobsApi {
  readonly jobs = new Map<string, RawJob>();
  readonly pods = new Map<string, RawPod[]>();
  readonly created: { namespace: string; manifest: Record<string, unknown> }[] = [];

  getJob(_ns: string, name: string): Promise<RawJob | undefined> {
    return Promise.resolve(this.jobs.get(name));
  }
  createJob(namespace: string, manifest: Record<string, unknown>): Promise<void> {
    this.created.push({ namespace, manifest });
    return Promise.resolve();
  }
  listPodsForJob(_ns: string, jobName: string): Promise<RawPod[]> {
    return Promise.resolve(this.pods.get(jobName) ?? []);
  }
}

const submission = (over: Partial<JobSubmission> = {}): JobSubmission => ({
  name: "s3dag-capture-abc",
  runId: "01hab",
  nodeId: "capture",
  attempt: 0,
  identity: { serviceAccountName: "s3dag-pv-sa", tokenAudiences: [] },
  spec: { image: "registry/worker:1" },
  ...over,
});

describe("jobStatusOf (pure)", () => {
  it("maps conditions/counts to the port lifecycle", () => {
    expect(jobStatusOf({})).toBe("pending");
    expect(jobStatusOf({ status: { active: 1 } })).toBe("active");
    expect(jobStatusOf({ status: { succeeded: 1 } })).toBe("succeeded");
    expect(jobStatusOf({ status: { failed: 1 } })).toBe("failed");
    expect(jobStatusOf({ status: { conditions: [{ type: "Complete", status: "True" }] } })).toBe("succeeded");
    expect(jobStatusOf({ status: { conditions: [{ type: "Failed", status: "True" }] } })).toBe("failed");
  });
});

describe("jobFailureReason (pure)", () => {
  it("surfaces OOMKilled from a pod, else a condition reason, else generic", () => {
    const oom: RawPod = { status: { containerStatuses: [{ state: { terminated: { reason: "OOMKilled" } } }] } };
    expect(jobFailureReason({}, [oom])).toBe("OOMKilled");
    expect(jobFailureReason({ status: { conditions: [{ type: "Failed", status: "True", reason: "BackoffLimitExceeded" }] } }, [])).toBe("BackoffLimitExceeded");
    expect(jobFailureReason({}, [])).toBe("Job failed");
  });
});

describe("K8sJobExecutor.observe", () => {
  it("reports missing for an absent Job (drives idempotent re-submit upstream)", async () => {
    const api = new FakeApi();
    const exec = new K8sJobExecutor({ namespace: "geo", lane: "pv", api });
    expect(await exec.observe(["nope"])).toEqual([{ name: "nope", status: "missing" }]);
  });

  it("maps present Jobs and attaches a failure reason only when failed", async () => {
    const api = new FakeApi();
    api.jobs.set("ok", { status: { succeeded: 1 } });
    api.jobs.set("run", { status: { active: 1 } });
    api.jobs.set("bad", { status: { failed: 1 } });
    api.pods.set("bad", [{ status: { containerStatuses: [{ state: { terminated: { reason: "OOMKilled" } } }] } }]);
    const exec = new K8sJobExecutor({ namespace: "geo", lane: "pv", api });
    const obs = await exec.observe(["ok", "run", "bad"]);
    expect(obs).toEqual([
      { name: "ok", status: "succeeded" },
      { name: "run", status: "active" },
      { name: "bad", status: "failed", failureReason: "OOMKilled" },
    ]);
  });
});

describe("K8sJobExecutor.submit", () => {
  it("POSTs a Job manifest carrying the assigned per-lane SA and deterministic name", async () => {
    const api = new FakeApi();
    const exec = new K8sJobExecutor({ namespace: "geo", lane: "pv", api });
    await exec.submit(submission({ name: "s3dag-capture-xyz" }));
    expect(api.created).toHaveLength(1);
    const m = api.created[0]!.manifest as {
      metadata: { name: string; namespace: string };
      spec: { template: { spec: { serviceAccountName: string } } };
    };
    expect(m.metadata.name).toBe("s3dag-capture-xyz");
    expect(m.metadata.namespace).toBe("geo");
    expect(m.spec.template.spec.serviceAccountName).toBe("s3dag-pv-sa");
  });
});
