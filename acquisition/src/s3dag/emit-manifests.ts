/**
 * Generator for the s3-dag PV-canari Kubernetes bundle (source of truth = the
 * TESTED builders in @sentropic/s3-dag, not a hand-written YAML). Prints a k8s
 * `List` (JSON, valid for `kubectl apply -f -`) to stdout. poc-k8s renders it with
 * the real values at apply:
 *
 *   S3DAG_IMAGE=ghcr.io/rhanka/geo-capture@sha256:… \
 *   S3DAG_PREFIX=preprod-runs/<sha> \
 *   tsx src/s3dag/emit-manifests.ts | kubectl apply -f -
 *
 * Emits, in ns `geo`: the 8 PRE-PROVISIONED per-lane worker SAs (bare, default-deny,
 * no `jobs:create`), the reconciler SA + minimal Role/RoleBinding (jobs create/get,
 * pods get, quota get, self-suspend, lock lease — NO serviceaccounts verb), and the
 * reconciler CronJob. Nothing here has a static gateway key; the worker's only
 * gateway credential is the projected Bearer token the reconciler mounts per node.
 */

import { CAPTURE_LANES } from "../../../packages/qc-sources/src/capture/manifest.js";
import {
  laneServiceAccountManifests,
  reconcilerCronManifest,
  reconcilerRbac,
} from "../../../packages/s3-dag/src/reconciler-manifest.js";

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function main(): void {
  const namespace = env("S3DAG_NAMESPACE", "geo");
  const reconcilerServiceAccountName = env("S3DAG_RECONCILER_SA", "s3dag-reconciler-sa");
  const cronJobName = env("S3DAG_CRONJOB", "s3dag-pv-reconciler");
  const image = env("S3DAG_IMAGE", "ghcr.io/rhanka/geo-capture:REPLACE_WITH_DIGEST_AT_APPLY");
  const bucket = env("S3DAG_BUCKET", "sentropic-geo-preprod");
  const prefix = env("S3DAG_PREFIX", "preprod-runs/canary");
  const runId = env("S3DAG_RUN_ID", "canary");
  const s3SecretName = env("S3DAG_S3_SECRET", "geo-s3-credentials-preprod");
  const quota = env("S3DAG_QUOTA", "tenant-quota");
  const imagePullSecret = env("S3DAG_PULL_SECRET", "geo-registry-pull");

  const laneSas = laneServiceAccountManifests([...CAPTURE_LANES], namespace);
  const { serviceAccount, role, roleBinding } = reconcilerRbac({
    cronJobName,
    namespace,
    reconcilerServiceAccountName,
  });
  const cron = reconcilerCronManifest({
    cronJobName,
    namespace,
    reconcilerServiceAccountName,
    image,
    env: {
      S3DAG_DAG_ID: "pv-canary",
      S3DAG_LANE: "pv",
      S3DAG_RUN_ID: runId,
      S3DAG_NAMESPACE: namespace,
      S3DAG_BUCKET: bucket,
      S3DAG_PREFIX: prefix,
      S3DAG_QUOTA: quota,
      S3DAG_IMAGE: image, // worker Jobs use the same image
      S3DAG_S3_SECRET: s3SecretName,
      S3DAG_CRONJOB: cronJobName,
    },
    s3SecretName,
    imagePullSecret,
  });

  const list = {
    apiVersion: "v1",
    kind: "List",
    items: [...laneSas, serviceAccount, role, roleBinding, cron],
  };
  process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
}

main();
