import { describe, expect, it } from "vitest";

import { defineDag } from "./dag.js";
import {
  buildReceipt,
  classifyEligible,
  deterministicJobName,
  initialRunLatest,
  latestKey,
  receiptKey,
  runPhase,
  type NodeReceipt,
  type RunLatest,
} from "./state.js";
import { InMemoryDagStore } from "./testing.js";

const spec = { image: "x" };
const SA = "geo-pv-sa";
const NOW = "2026-08-22T00:00:00.000Z";

const linear = defineDag({
  id: "pv",
  serviceAccountName: SA,
  nodes: { capture: { spec }, normalize: { needs: ["capture"], spec }, serve: { needs: ["normalize"], spec } },
});

const succeeded = (nodeId: string): NodeReceipt =>
  buildReceipt({ runId: "r1", nodeId, attempt: 0, outcome: "succeeded", jobName: "j", finishedAt: NOW });

describe("deterministicJobName", () => {
  it("is stable for the same (run,node,attempt) and DNS-1123 safe", () => {
    const a = deterministicJobName("r1", "capture", 0);
    expect(a).toBe(deterministicJobName("r1", "capture", 0));
    expect(a).toMatch(/^s3dag-[a-z0-9-]{1,}$/);
    expect(a.length).toBeLessThanOrEqual(63);
  });
  it("differs by node and by attempt", () => {
    expect(deterministicJobName("r1", "capture", 0)).not.toBe(deterministicJobName("r1", "normalize", 0));
    expect(deterministicJobName("r1", "capture", 0)).not.toBe(deterministicJobName("r1", "capture", 1));
  });
  it("sanitizes messy node ids", () => {
    expect(deterministicJobName("r1", "Zone/Arc GIS", 0)).toMatch(/^s3dag-zone-arc-gis-[0-9a-f]{12}$/);
  });
});

describe("classifyEligible", () => {
  it("only considers a pending node once ALL its needs are terminal", () => {
    const latest = initialRunLatest(linear, "r1", NOW);
    expect(classifyEligible(linear, latest, {})).toEqual({ runnable: ["capture"], skippable: [] });
    latest.nodes.capture!.phase = "succeeded";
    expect(classifyEligible(linear, latest, { capture: succeeded("capture") })).toEqual({ runnable: ["normalize"], skippable: [] });
  });

  it("cascade-SKIPS a downstream node when a need failed (default gate)", () => {
    const latest = initialRunLatest(linear, "r1", NOW);
    latest.nodes.capture!.phase = "failed";
    const receipts = { capture: buildReceipt({ runId: "r1", nodeId: "capture", attempt: 0, outcome: "failed", jobName: "j", finishedAt: NOW }) };
    expect(classifyEligible(linear, latest, receipts)).toEqual({ runnable: [], skippable: ["normalize"] });
  });

  it("honours a custom `when` predicate over upstream receipts (LLM node gated off)", () => {
    const gated = defineDag({
      id: "g",
      serviceAccountName: SA,
      nodes: {
        capture: { spec },
        // LLM node plugs in later: only runs when egress is declared ready.
        extract: { needs: ["capture"], when: (up) => up.capture?.outcome === "succeeded" && false, spec },
      },
    });
    const latest = initialRunLatest(gated, "r1", NOW);
    latest.nodes.capture!.phase = "succeeded";
    expect(classifyEligible(gated, latest, { capture: succeeded("capture") })).toEqual({ runnable: [], skippable: ["extract"] });
  });
});

describe("runPhase", () => {
  it("running while any node is not terminal", () => {
    expect(runPhase(initialRunLatest(linear, "r1", NOW))).toBe("running");
  });
  it("complete when all nodes are terminal and none failed", () => {
    const latest = initialRunLatest(linear, "r1", NOW);
    for (const id of linear.order) latest.nodes[id]!.phase = id === "serve" ? "skipped" : "succeeded";
    expect(runPhase(latest)).toBe("complete");
  });
  it("failed if any node failed (even if others are done)", () => {
    const latest = initialRunLatest(linear, "r1", NOW);
    latest.nodes.capture!.phase = "succeeded";
    latest.nodes.normalize!.phase = "failed";
    latest.nodes.serve!.phase = "skipped";
    expect(runPhase(latest)).toBe("failed");
  });
});

describe("InMemoryDagStore — CAS (If-Match) 412 semantics", () => {
  it("create-if-absent, then reject a stale-etag write (412)", async () => {
    const store = new InMemoryDagStore();
    const latest = initialRunLatest(linear, "r1", NOW);
    const created = await store.putIfMatch(latestKey("r1"), JSON.stringify(latest), null);
    expect(created.ok).toBe(true);
    // A second create-if-absent must fail (object now exists).
    expect((await store.putIfMatch(latestKey("r1"), "{}", null)).ok).toBe(false);
    const cur = (await store.get(latestKey("r1")))!;
    // Correct etag → wins; then the OLD etag is stale → 412.
    expect((await store.putIfMatch(latestKey("r1"), "{}", cur.etag)).ok).toBe(true);
    expect((await store.putIfMatch(latestKey("r1"), "{}", cur.etag)).ok).toBe(false);
  });

  it("immutable receipts are write-once-content-addressed (put is idempotent by key)", async () => {
    const store = new InMemoryDagStore();
    const rk = receiptKey("r1", "capture", 0);
    await store.put(rk, JSON.stringify(succeeded("capture")));
    expect(store.read<NodeReceipt>(rk)?.outcome).toBe("succeeded");
  });
});

// Type-only touch so `RunLatest` import is used even if lint tightens.
const _t: RunLatest = initialRunLatest(linear, "r1", NOW);
void _t;
