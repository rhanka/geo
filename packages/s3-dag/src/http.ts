/**
 * Read-only supervision routes, mounted by geo-api at `/v1/refresh`. These serve
 * the immo-facing business view from the immutable S3 objects — never from the
 * Kubernetes API. The engine's own `refresh` CLI verb is unrelated: this is the
 * *observability* surface, so nothing here submits, mutates, or talks to a cluster.
 */

import { Hono } from "hono";

import type { Supervision } from "./supervision.js";

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return Math.min(n, 500);
}

/**
 * Build the `/v1/refresh/*` sub-app over a {@link Supervision} read-model.
 * Mount with `app.route("/v1/refresh", refreshRoutes(sv))`.
 */
export function refreshRoutes(sv: Supervision): Hono {
  const app = new Hono();

  // State of one lane, from its promoted index (closed `unknown` if none).
  app.get("/overview", async (c) => {
    const lane = c.req.query("lane");
    if (lane === undefined || lane === "") return c.json({ error: "query param `lane` is required" }, 400);
    return c.json(await sv.getOverview(lane));
  });

  // Freshness of one lane — recency of the last promoted artifact, not a Job status.
  app.get("/freshness", async (c) => {
    const lane = c.req.query("lane");
    if (lane === undefined || lane === "") return c.json({ error: "query param `lane` is required" }, 400);
    return c.json(await sv.getFreshness(lane));
  });

  // Run history, most-recent first (bounded page).
  app.get("/runs", async (c) => {
    const runs = await sv.getRuns({ limit: parseLimit(c.req.query("limit")) ?? 50 });
    return c.json({ runs });
  });

  // One run's DAG progress + per-node artifacts.
  app.get("/runs/:runId", async (c) => {
    const run = await sv.getRun(c.req.param("runId"));
    if (run === undefined) return c.json({ error: "run not found" }, 404);
    return c.json(run);
  });

  return app;
}
