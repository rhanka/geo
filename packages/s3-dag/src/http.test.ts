import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { refreshRoutes } from "./http.js";
import {
  latestKey,
  manifestKey,
  RUN_LATEST_CONTRACT,
  RUN_MANIFEST_CONTRACT,
  type RunLatest,
  type RunManifest,
} from "./state.js";
import { laneIndexKey, LANE_INDEX_CONTRACT, supervision, type LaneIndex } from "./supervision.js";
import { InMemoryDagStore } from "./testing.js";

async function seed(store: InMemoryDagStore): Promise<void> {
  const idx: LaneIndex = {
    contract: LANE_INDEX_CONTRACT,
    lane: "pv",
    lastRunId: "r1",
    lastSuccessAt: "2026-08-22T01:00:00.000Z",
    freshness: "fresh",
    observedAt: "2026-08-22T02:00:00.000Z",
  };
  await store.put(laneIndexKey("pv"), JSON.stringify(idx));
  const manifest: RunManifest = {
    contract: RUN_MANIFEST_CONTRACT,
    dagId: "pv",
    runId: "r1",
    createdAt: "2026-08-22T00:00:00.000Z",
    nodes: ["capture"],
  };
  await store.put(manifestKey("r1"), JSON.stringify(manifest));
  const latest: RunLatest = {
    contract: RUN_LATEST_CONTRACT,
    runId: "r1",
    dagId: "pv",
    phase: "complete",
    updatedAt: "2026-08-22T01:00:00.000Z",
    nodes: { capture: { nodeId: "capture", phase: "succeeded", attempt: 0, jobName: "j", receiptKey: null } },
  };
  await store.put(latestKey("r1"), JSON.stringify(latest));
}

function buildApp(store: InMemoryDagStore): Hono {
  const app = new Hono();
  app.route("/v1/refresh", refreshRoutes(supervision(store)));
  return app;
}

describe("refreshRoutes — read-only /v1/refresh/*", () => {
  it("400s when overview/freshness are called without a lane", async () => {
    const app = buildApp(new InMemoryDagStore());
    expect((await app.request("/v1/refresh/overview")).status).toBe(400);
    expect((await app.request("/v1/refresh/freshness")).status).toBe(400);
  });

  it("serves lane overview and freshness", async () => {
    const store = new InMemoryDagStore();
    await seed(store);
    const app = buildApp(store);

    const ov = await app.request("/v1/refresh/overview?lane=pv");
    expect(ov.status).toBe(200);
    expect(await ov.json()).toEqual({
      lane: "pv",
      lastRunId: "r1",
      lastSuccessAt: "2026-08-22T01:00:00.000Z",
      freshness: "fresh",
      observedAt: "2026-08-22T02:00:00.000Z",
    });

    const fr = await app.request("/v1/refresh/freshness?lane=pv");
    expect(fr.status).toBe(200);
    expect(((await fr.json()) as { freshness: string }).freshness).toBe("fresh");
  });

  it("serves a closed unknown for a lane with no promoted index", async () => {
    const app = buildApp(new InMemoryDagStore());
    const ov = await app.request("/v1/refresh/overview?lane=ghost");
    expect(ov.status).toBe(200);
    expect(await ov.json()).toMatchObject({ lane: "ghost", freshness: "unknown", lastRunId: null });
  });

  it("lists runs and fetches one run, 404ing on an unknown id", async () => {
    const store = new InMemoryDagStore();
    await seed(store);
    const app = buildApp(store);

    const runs = await app.request("/v1/refresh/runs");
    expect(runs.status).toBe(200);
    const runsBody = (await runs.json()) as { runs: { runId: string }[] };
    expect(runsBody.runs.map((r) => r.runId)).toEqual(["r1"]);

    const one = await app.request("/v1/refresh/runs/r1");
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({ runId: "r1", phase: "complete", progress: { done: 1, total: 1, percent: 100 } });

    expect((await app.request("/v1/refresh/runs/nope")).status).toBe(404);
  });
});
