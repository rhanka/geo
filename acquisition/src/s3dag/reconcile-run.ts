/**
 * One reconciler TICK for the s3-dag PV canary, run by the reconciler CronJob.
 *
 * Never blocks: take the single-writer lease, read the live quota, run ONE
 * `reconcileTick` (fold finished Jobs → immutable receipts, submit runnable nodes
 * bounded by quota), persist via CAS, exit. The CronJob schedules the next tick.
 *
 * Identity: `reconcileTick` runs in LANE mode → every node Job is assigned the
 * stable per-lane SA `s3dag-<lane>-sa` (pre-provisioned, bare/default-deny; this
 * reconciler is the ONLY holder of `jobs:create`, and it is lease-guarded).
 *
 * S3: endpoint/region come from the committed `acquisition/config/s3-target.json`
 * (the "target fait foi" guard against a silent cloud switch); the bucket is the
 * PREPROD canary bucket (env), never `/normalized`. OVH #236 checksum-safe options
 * are baked into S3DagStore.
 */

import { readFileSync } from "node:fs";

import { reconcileTick } from "../../../packages/s3-dag/src/reconcile.js";
import { S3DagStore } from "../../../packages/s3-dag/src/s3-store.js";
import { K8sJobExecutor, inClusterJobsApi } from "../../../packages/s3-dag/src/executor-k8s.js";
import { inClusterRest } from "../../../packages/s3-dag/src/k8s-rest.js";
import { inClusterQuotaApi, readQuotaHeadroom } from "../../../packages/s3-dag/src/quota-k8s.js";
import { acquireLease } from "../../../packages/s3-dag/src/lease.js";
import { reconcilerLockName } from "../../../packages/s3-dag/src/reconciler-manifest.js";
import { buildPvCanaryDag } from "./pv-dag.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} est requis`);
  return v;
}

interface S3Target {
  endpoint: string;
  region: string;
  bucket: string;
}

function s3Target(): S3Target {
  const path = new URL("../../config/s3-target.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<S3Target>;
  if (!parsed.endpoint || !parsed.region) {
    throw new Error("acquisition/config/s3-target.json: endpoint et region sont requis");
  }
  return { endpoint: parsed.endpoint, region: parsed.region, bucket: parsed.bucket ?? "" };
}

async function main(): Promise<void> {
  const runId = requireEnv("S3DAG_RUN_ID");
  const lane = process.env["S3DAG_LANE"]?.trim() || "pv";
  const namespace = process.env["S3DAG_NAMESPACE"]?.trim() || "geo";
  const bucket = requireEnv("S3DAG_BUCKET"); // preprod canary bucket
  const prefix = requireEnv("S3DAG_PREFIX"); // e.g. preprod-runs/<sha>
  const quotaName = process.env["S3DAG_QUOTA"]?.trim() || "tenant-quota";
  const image = requireEnv("S3DAG_IMAGE"); // digest-pinned worker image
  const s3SecretName = process.env["S3DAG_S3_SECRET"]?.trim() || "geo-s3-credentials-preprod";
  const cronJobName = requireEnv("S3DAG_CRONJOB");
  const holder = process.env["HOSTNAME"]?.trim() || `tick-${process.pid}`;
  const now = new Date();

  const target = s3Target();
  const store = new S3DagStore({
    bucket,
    prefix,
    endpoint: target.endpoint,
    region: target.region,
    accessKeyId: requireEnv("S3_ACCESS_KEY"),
    secretAccessKey: requireEnv("S3_SECRET_KEY"),
  });

  const rest = inClusterRest();
  // Single-writer: if another tick holds the lease, exit quietly (CAS already makes
  // a lost race harmless; the lease just avoids wasted concurrent work).
  const held = await acquireLease({ rest, namespace, name: reconcilerLockName(cronJobName), holder, now, seconds: 90 });
  if (!held) {
    console.log(JSON.stringify({ run: runId, action: "lease-held" }));
    return;
  }

  const executor = new K8sJobExecutor({ namespace, lane, api: inClusterJobsApi(rest) });
  const quota = await readQuotaHeadroom(inClusterQuotaApi(rest), namespace, quotaName);
  const dag = buildPvCanaryDag({ image, s3SecretName });

  const result = await reconcileTick({
    dag,
    runId,
    store,
    executor,
    quota,
    now: now.toISOString(),
    lane, // per-lane stable SA + gateway audiences verbatim
    reservePods: 1, // never schedule over the served API's own slot
  });

  console.log(
    JSON.stringify({
      run: runId,
      lane,
      phase: result.phase,
      submitted: result.submitted,
      completed: result.completed,
      failed: result.failed,
      skipped: result.skipped,
      conflict: result.conflict,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
