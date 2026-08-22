/**
 * A single s3-dag PV-canary NODE worker (the command each node Job runs).
 *
 * Runs as the stable per-lane SA `s3dag-<lane>-sa` — a BARE ServiceAccount with no
 * RBAC and (Job-side) `automountServiceAccountToken:false`, so it has NO Kubernetes
 * API access at all (the negative canary proof). Its only credentials are the S3
 * keys (envFrom, data-store only) — no `jobs:create`, no static gateway key.
 *
 * The node does real, IDEMPOTENT S3 work: write its artifact create-only
 * (`putIfMatch(..., null)`), so a node replay skips an already-written shard
 * cheaply (a 412 is "already done", not an error). Under fan-out (Indexed Job) each
 * pod reads its shard from JOB_COMPLETION_INDEX.
 */

import { readFileSync } from "node:fs";

import { S3DagStore } from "../../../packages/s3-dag/src/s3-store.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} est requis`);
  return v;
}

function s3EndpointRegion(): { endpoint: string; region: string } {
  const path = new URL("../../config/s3-target.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { endpoint?: string; region?: string };
  if (!parsed.endpoint || !parsed.region) throw new Error("s3-target.json: endpoint et region requis");
  return { endpoint: parsed.endpoint, region: parsed.region };
}

async function main(): Promise<void> {
  const nodeId = process.argv[2]?.trim();
  if (!nodeId) throw new Error("usage: canary-node-run <nodeId>");
  const runId = requireEnv("S3DAG_RUN_ID");
  const bucket = requireEnv("S3DAG_BUCKET");
  const prefix = requireEnv("S3DAG_PREFIX");
  const indexRaw = process.env["JOB_COMPLETION_INDEX"]?.trim(); // set by k8s for Indexed Jobs
  const index = indexRaw !== undefined && indexRaw !== "" ? Number(indexRaw) : null;
  const { endpoint, region } = s3EndpointRegion();

  const store = new S3DagStore({
    bucket,
    prefix,
    endpoint,
    region,
    accessKeyId: requireEnv("S3_ACCESS_KEY"),
    secretAccessKey: requireEnv("S3_SECRET_KEY"),
  });

  const shard = index === null ? "" : `-${index}`;
  const key = `artifacts/${nodeId}${shard}.json`;
  const body = `${JSON.stringify({
    contract: "s3-dag/canary-artifact/v1",
    node: nodeId,
    run: runId,
    index,
    at: new Date().toISOString(),
  })}\n`;

  // Create-only: a replay of an already-written shard is a cheap no-op (412), not
  // an overwrite and not an error — idempotent by construction.
  const res = await store.putIfMatch(key, body, null);
  console.log(JSON.stringify({ run: runId, node: nodeId, index, key, written: res.ok }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
