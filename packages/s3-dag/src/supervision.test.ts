import { describe, expect, it } from "vitest";

import {
  buildReceipt,
  latestKey,
  manifestKey,
  receiptKey,
  RUN_LATEST_CONTRACT,
  RUN_MANIFEST_CONTRACT,
  type NodeState,
  type RunLatest,
  type RunManifest,
} from "./state.js";
import {
  laneIndexKey,
  LANE_INDEX_CONTRACT,
  supervision,
  type LaneIndex,
} from "./supervision.js";
import { InMemoryDagStore } from "./testing.js";

const DAG = "pv";

function nodeState(nodeId: string, phase: NodeState["phase"], receipt = false): NodeState {
  return {
    nodeId,
    phase,
    attempt: 0,
    jobName: `job-${nodeId}`,
    receiptKey: receipt ? receiptKey("does-not-matter", nodeId, 0) : null,
  };
}

async function seedRun(
  store: InMemoryDagStore,
  runId: string,
  opts: { updatedAt: string; phase: RunLatest["phase"]; nodes: Record<string, NodeState>; artifacts?: Record<string, string> },
): Promise<void> {
  const manifest: RunManifest = {
    contract: RUN_MANIFEST_CONTRACT,
    dagId: DAG,
    runId,
    createdAt: opts.updatedAt,
    nodes: Object.keys(opts.nodes),
  };
  await store.put(manifestKey(runId), JSON.stringify(manifest));

  const nodes: Record<string, NodeState> = {};
  for (const [id, st] of Object.entries(opts.nodes)) {
    const withRun: NodeState = { ...st, receiptKey: st.receiptKey ? receiptKey(runId, id, 0) : null };
    nodes[id] = withRun;
    if (withRun.receiptKey) {
      await store.put(
        withRun.receiptKey,
        JSON.stringify(
          buildReceipt({
            runId,
            nodeId: id,
            attempt: 0,
            outcome: st.phase === "succeeded" ? "succeeded" : st.phase === "failed" ? "failed" : "skipped",
            jobName: st.jobName ?? "job",
            finishedAt: opts.updatedAt,
            artifact: opts.artifacts?.[id],
          }),
        ),
      );
    }
  }
  const latest: RunLatest = {
    contract: RUN_LATEST_CONTRACT,
    runId,
    dagId: DAG,
    phase: opts.phase,
    updatedAt: opts.updatedAt,
    nodes,
  };
  await store.put(latestKey(runId), JSON.stringify(latest));
}

describe("supervision — lane overview / freshness (promoted index)", () => {
  it("returns a CLOSED unknown when a lane has no promoted index (never guesses)", async () => {
    const sv = supervision(new InMemoryDagStore());
    expect(await sv.getOverview("pv")).toEqual({
      lane: "pv",
      lastRunId: null,
      lastSuccessAt: null,
      freshness: "unknown",
      observedAt: null,
    });
    expect(await sv.getFreshness("pv")).toEqual({
      lane: "pv",
      observedAt: null,
      lastSuccessAt: null,
      freshness: "unknown",
      cadenceSeconds: null,
    });
  });

  it("reads overview + freshness from the promoted lane index (the artifact, not a Job)", async () => {
    const store = new InMemoryDagStore();
    const idx: LaneIndex = {
      contract: LANE_INDEX_CONTRACT,
      lane: "pv",
      lastRunId: "r1",
      lastSuccessAt: "2026-08-22T01:00:00.000Z",
      freshness: "fresh",
      observedAt: "2026-08-22T02:00:00.000Z",
      cadenceSeconds: 86400,
      artifact: "s3://sentropic-geo-preprod/preprod-runs/r1/serve.json",
    };
    await store.put(laneIndexKey("pv"), JSON.stringify(idx));
    const sv = supervision(store);
    expect(await sv.getOverview("pv")).toEqual({
      lane: "pv",
      lastRunId: "r1",
      lastSuccessAt: "2026-08-22T01:00:00.000Z",
      freshness: "fresh",
      observedAt: "2026-08-22T02:00:00.000Z",
    });
    expect(await sv.getFreshness("pv")).toEqual({
      lane: "pv",
      observedAt: "2026-08-22T02:00:00.000Z",
      lastSuccessAt: "2026-08-22T01:00:00.000Z",
      freshness: "fresh",
      cadenceSeconds: 86400,
    });
  });
});

describe("supervision — run history & detail", () => {
  it("lists runs most-recent-first and honours the limit", async () => {
    const store = new InMemoryDagStore();
    await seedRun(store, "r1", { updatedAt: "2026-08-22T01:00:00.000Z", phase: "complete", nodes: { capture: nodeState("capture", "succeeded") } });
    await seedRun(store, "r2", { updatedAt: "2026-08-22T03:00:00.000Z", phase: "running", nodes: { capture: nodeState("capture", "submitted") } });
    await seedRun(store, "r3", { updatedAt: "2026-08-22T02:00:00.000Z", phase: "failed", nodes: { capture: nodeState("capture", "failed") } });
    const sv = supervision(store);
    const runs = await sv.getRuns();
    expect(runs.map((r) => r.runId)).toEqual(["r2", "r3", "r1"]);
    expect(runs[0]).toEqual({ runId: "r2", dagId: "pv", phase: "running", updatedAt: "2026-08-22T03:00:00.000Z" });
    expect((await sv.getRuns({ limit: 2 })).map((r) => r.runId)).toEqual(["r2", "r3"]);
  });

  it("returns undefined for an unknown run id", async () => {
    const sv = supervision(new InMemoryDagStore());
    expect(await sv.getRun("nope")).toBeUndefined();
  });

  it("reports DAG progress and per-node promoted artifacts from immutable receipts", async () => {
    const store = new InMemoryDagStore();
    await seedRun(store, "r1", {
      updatedAt: "2026-08-22T01:00:00.000Z",
      phase: "complete",
      nodes: {
        capture: nodeState("capture", "succeeded", true),
        serve: nodeState("serve", "succeeded", true),
      },
      artifacts: { capture: "s3://b/preprod-runs/r1/capture.json" }, // serve produced none
    });
    const sv = supervision(store);
    const run = await sv.getRun("r1");
    expect(run?.progress).toEqual({ done: 2, total: 2, percent: 100 });
    const capture = run?.nodes.find((n) => n.nodeId === "capture");
    const serve = run?.nodes.find((n) => n.nodeId === "serve");
    expect(capture?.artifact).toBe("s3://b/preprod-runs/r1/capture.json");
    expect(serve?.artifact).toBeUndefined();
  });

  it("computes partial progress for an in-flight run (terminal nodes only count as done)", async () => {
    const store = new InMemoryDagStore();
    await seedRun(store, "r1", {
      updatedAt: "2026-08-22T01:00:00.000Z",
      phase: "running",
      nodes: {
        capture: nodeState("capture", "succeeded", true),
        serve: nodeState("serve", "submitted"),
      },
    });
    const run = await supervision(store).getRun("r1");
    expect(run?.progress).toEqual({ done: 1, total: 2, percent: 50 });
  });
});
