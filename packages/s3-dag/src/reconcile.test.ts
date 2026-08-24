import { describe, expect, it } from "vitest";

import { defineDag } from "./dag.js";
import { reconcileTick, type ReconcileArgs } from "./reconcile.js";
import {
  buildReceipt,
  deterministicJobName,
  latestKey,
  receiptKey,
  type NodeReceipt,
  type RunLatest,
} from "./state.js";
import { FakeJobExecutor, InMemoryDagStore } from "./testing.js";
import type { DagStore, QuotaHeadroom } from "./ports.js";

const spec = { image: "x" };
const SA = "geo-pv-sa";
const NOW = "2026-08-22T00:00:00.000Z";
const ROOMY: QuotaHeadroom = {
  pods: 100,
  requestsCpuMilli: 1_000_000,
  requestsMemoryBytes: 10_000_000 * 1024 ** 2,
  limitsCpuMilli: 1_000_000,
  limitsMemoryBytes: 10_000_000 * 1024 ** 2,
};

const linear = defineDag({
  id: "pv",
  serviceAccountName: SA,
  nodes: { capture: { spec }, normalize: { needs: ["capture"], spec }, serve: { needs: ["normalize"], spec } },
});

function tick(store: InMemoryDagStore, executor: FakeJobExecutor, over: Partial<ReconcileArgs> = {}) {
  return reconcileTick({ dag: linear, runId: "r1", store, executor, quota: ROOMY, now: NOW, ...over });
}
const readLatest = (store: InMemoryDagStore) => store.read<RunLatest>(latestKey("r1"))!;

describe("reconcileTick — happy path + NHI identity", () => {
  it("drives a linear DAG to completion, one ready node at a time", async () => {
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();

    let r = await tick(store, exec); // submit capture
    expect(r.submitted).toEqual(["capture"]);
    expect(readLatest(store).nodes.capture!.phase).toBe("submitted");

    exec.setStatus(deterministicJobName("r1", "capture", 0), "succeeded");
    r = await tick(store, exec); // fold capture, submit normalize
    expect(r.completed).toEqual(["capture"]);
    expect(r.submitted).toEqual(["normalize"]);

    exec.setStatus(deterministicJobName("r1", "normalize", 0), "succeeded");
    r = await tick(store, exec);
    expect(r.submitted).toEqual(["serve"]);

    exec.setStatus(deterministicJobName("r1", "serve", 0), "succeeded");
    r = await tick(store, exec);
    expect(r.phase).toBe("complete");
    expect(Object.values(readLatest(store).nodes).every((n) => n.phase === "succeeded")).toBe(true);
  });

  it("submits every Job under the dedicated lane SA (never default), with node token audiences", async () => {
    const gated = defineDag({
      id: "pv",
      serviceAccountName: "geo-pv-sa",
      nodes: { capture: { spec }, extract: { needs: ["capture"], tokenAudiences: ["llm-gateway"], spec } },
    });
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    await reconcileTick({ dag: gated, runId: "r2", store, executor: exec, quota: ROOMY, now: NOW });
    const sub = exec.submitted.find((s) => s.nodeId === "capture")!;
    expect(sub.identity.serviceAccountName).toBe("geo-pv-sa");
    expect(sub.identity.serviceAccountName).not.toBe("default");
    expect(sub.identity.tokenAudiences).toEqual([]); // capture needs no minted egress

    exec.setStatus(deterministicJobName("r2", "capture", 0), "succeeded");
    await reconcileTick({ dag: gated, runId: "r2", store, executor: exec, quota: ROOMY, now: NOW });
    const ex = exec.submitted.find((s) => s.nodeId === "extract")!;
    expect(ex.identity.serviceAccountName).toBe("geo-pv-sa");
    expect(ex.identity.tokenAudiences).toEqual(["llm-gateway"]);
  });
});

describe("reconcileTick — crash-safety & idempotency", () => {
  it("re-running a tick with jobs still active does NOT double-submit (deterministic names)", async () => {
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    await tick(store, exec); // submit capture (status → active)
    await tick(store, exec); // capture still active → no progress, no re-submit
    expect(exec.submitCount(deterministicJobName("r1", "capture", 0))).toBe(1);
    expect(readLatest(store).nodes.capture!.phase).toBe("submitted");
  });

  it("is receipt-first: a receipt written before a crash is folded even if the executor now disagrees", async () => {
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    await tick(store, exec); // submit capture
    const jobName = deterministicJobName("r1", "capture", 0);
    // Simulate: a prior tick wrote the SUCCEEDED receipt, then crashed before advancing latest.
    await store.put(
      receiptKey("r1", "capture", 0),
      JSON.stringify(buildReceipt({ runId: "r1", nodeId: "capture", attempt: 0, outcome: "succeeded", jobName, finishedAt: NOW })),
    );
    exec.setStatus(jobName, "failed"); // executor DISAGREES — the receipt must win
    const r = await tick(store, exec);
    expect(r.completed).toEqual(["capture"]); // folded from the receipt, not the executor
    expect(readLatest(store).nodes.capture!.phase).toBe("succeeded");
  });

  it("recovers a vanished (missing) job by idempotent re-submit", async () => {
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    await tick(store, exec); // submit capture
    const jobName = deterministicJobName("r1", "capture", 0);
    exec.setStatus(jobName, "missing"); // job disappeared pre-completion, no receipt
    const r = await tick(store, exec);
    expect(r.completed).toEqual([]);
    expect(readLatest(store).nodes.capture!.phase).toBe("submitted"); // still in-flight
    expect(exec.submitCount(jobName)).toBe(2); // re-submitted (idempotent by name)
  });

  it("a lost CAS race reports conflict with no corruption (immutable receipt still persisted)", async () => {
    const inner = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    await tick(inner, exec); // create + submit capture
    exec.setStatus(deterministicJobName("r1", "capture", 0), "succeeded");
    // Wrap the store so the NEXT `latest` CAS loses — as if a concurrent reconciler
    // advanced `latest` between our read and our write.
    let tripped = false;
    const racing: DagStore = {
      get: (k) => inner.get(k),
      put: (k, b) => inner.put(k, b),
      list: (p) => inner.list(p),
      putIfMatch: async (k, b, e) => {
        if (!tripped && k === latestKey("r1") && e !== null) {
          tripped = true;
          const cur = (await inner.get(k))!;
          await inner.putIfMatch(k, cur.body, cur.etag); // concurrent advance bumps the etag
          return { ok: false };
        }
        return inner.putIfMatch(k, b, e);
      },
    };
    const r = await reconcileTick({ dag: linear, runId: "r1", store: racing, executor: exec, quota: ROOMY, now: NOW });
    expect(r.conflict).toBe(true);
    // The capture receipt (immutable) was still written before the lost CAS → no corruption.
    expect(inner.read<NodeReceipt>(receiptKey("r1", "capture", 0))?.outcome).toBe("succeeded");
  });
});

describe("reconcileTick — quota bounding & cascade skip", () => {
  const fan = defineDag({
    id: "fan",
    serviceAccountName: SA,
    nodes: { a: { spec }, b: { spec }, c: { spec }, d: { spec }, e: { spec } }, // 5 roots, all ready at once
  });

  it("submits at most `availableSlots` jobs this tick (quota-bounded)", async () => {
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    const r = await reconcileTick({
      dag: fan, runId: "rf", store, executor: exec, quota: { ...ROOMY, pods: 3 },
      now: NOW, maxActiveJobs: 100, reservePods: 1, // (3-1)/1 = 2 slots
    });
    expect(r.submitted).toHaveLength(2);
  });

  it("cascade-skips downstream when an upstream fails, and marks the run failed", async () => {
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    await tick(store, exec); // submit capture
    exec.setStatus(deterministicJobName("r1", "capture", 0), "failed");
    const r = await tick(store, exec); // fold failure → normalize skipped
    expect(r.failed).toEqual(["capture"]);
    expect(r.skipped).toEqual(["normalize"]);
    const r2 = await tick(store, exec); // serve skipped (its need normalize is skipped)
    expect(r2.skipped).toEqual(["serve"]);
    expect(r2.phase).toBe("failed");
  });
});

describe("reconcileTick — index reconstruction (gate proof 4, pure level)", () => {
  it("run state is fully derivable from the immutable manifest + receipts", async () => {
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    // Drive to completion.
    await tick(store, exec);
    for (const id of linear.order) {
      exec.setStatus(deterministicJobName("r1", id, 0), "succeeded");
      await tick(store, exec);
    }
    // Every terminal node has an immutable receipt on S3 — the rebuild source.
    const receipts = await store.list(`runs/r1/nodes/`);
    const outcomes = receipts
      .map((k) => store.read<NodeReceipt>(k)!.outcome)
      .sort();
    expect(receipts).toHaveLength(3);
    expect(outcomes).toEqual(["succeeded", "succeeded", "succeeded"]);
  });
});

describe("reconcileTick — per-run lane-carrying identity (mechanism (a))", () => {
  const gated = defineDag({
    id: "pv",
    serviceAccountName: "geo-pv-sa",
    nodes: { capture: { spec }, extract: { needs: ["capture"], tokenAudiences: ["llm-gateway"], spec } },
  });

  it("uses the stable per-lane SA + lane-scoped audiences when a lane is given", async () => {
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    await reconcileTick({ dag: gated, runId: "01hab", store, executor: exec, quota: ROOMY, now: NOW, lane: "usage-dominant" });
    const cap = exec.submitted.find((s) => s.nodeId === "capture")!;
    expect(cap.identity.serviceAccountName).toBe("s3dag-usage-dominant-sa"); // stable, hyphenated lane preserved, no run
    expect(cap.identity.serviceAccountName).not.toBe("default");
    expect(cap.identity.tokenAudiences).toEqual([]); // no base audiences → no projected token

    exec.setStatus(deterministicJobName("01hab", "capture", 0), "succeeded");
    await reconcileTick({ dag: gated, runId: "01hab", store, executor: exec, quota: ROOMY, now: NOW, lane: "usage-dominant" });
    const ex = exec.submitted.find((s) => s.nodeId === "extract")!;
    expect(ex.identity.serviceAccountName).toBe("s3dag-usage-dominant-sa");
    expect(ex.identity.tokenAudiences).toEqual(["llm-gateway"]); // audience = gateway id (pure); lane rides the sub
  });

  it("stays in fixed mode (dag SA, raw audiences) when no lane is given — Phase 0 unchanged", async () => {
    const store = new InMemoryDagStore();
    const exec = new FakeJobExecutor();
    await reconcileTick({ dag: gated, runId: "01hab", store, executor: exec, quota: ROOMY, now: NOW });
    const cap = exec.submitted.find((s) => s.nodeId === "capture")!;
    expect(cap.identity.serviceAccountName).toBe("geo-pv-sa");
  });
});
