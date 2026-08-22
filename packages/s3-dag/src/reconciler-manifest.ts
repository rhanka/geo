/**
 * PURE builders for the reconciler's Kubernetes manifests (JSON objects, valid as
 * YAML for `kubectl apply`). Mirrors the proven `captureBacklogCronManifest`
 * pattern, with the dossier-D2 identity correction baked in:
 *
 *  - The per-lane job SAs are PRE-PROVISIONED ({@link laneServiceAccountManifests})
 *    and applied out-of-band; the reconciler ASSIGNS them by name but its RBAC
 *    ({@link reconcilerRbac}) has NO `serviceaccounts` verb — it can neither create
 *    nor patch a SA. That closes "invent/patch an identity" (run isolation). It does
 *    NOT close "assign an existing identity" (the confused-deputy at the creator
 *    level) — per-lane enforcement is the CI identity boundary (infra), not here.
 *  - Job SAs carry NO RBAC of their own (no RoleBinding) → a DAG-node pod is
 *    default-deny (the negative canary proof: a run cannot touch the API).
 */

import { laneServiceAccountName } from "./identity.js";

const MANAGED_BY = { "app.kubernetes.io/managed-by": "s3-dag" };

/** The lock Lease name for a reconciler CronJob (single-writer). */
export const reconcilerLockName = (cronJobName: string): string => `${cronJobName}-lock`;

/**
 * Pre-provisioned per-lane job ServiceAccounts. Applied out-of-band (NOT created by
 * the reconciler at runtime). Each is a bare identity with no RoleBinding, so a pod
 * running as it is default-deny against the API.
 */
export function laneServiceAccountManifests(
  lanes: readonly string[],
  namespace: string,
): Record<string, unknown>[] {
  return lanes.map((lane) => ({
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      name: laneServiceAccountName(lane),
      namespace,
      labels: { ...MANAGED_BY, "s3dag.io/lane": lane },
    },
    // Tokens are mounted per-Job via a projected volume with the gateway audience,
    // not from the SA default token.
    automountServiceAccountToken: false,
  }));
}

export interface ReconcilerRbacArgs {
  cronJobName: string;
  namespace: string;
  /** The SA the RECONCILER pod runs as (distinct from the per-lane job SAs). */
  reconcilerServiceAccountName: string;
}

/**
 * The reconciler's Role + RoleBinding. Minimal verbs — enough to submit/observe
 * Jobs, read the quota, self-suspend, and hold the lock lease — and DELIBERATELY
 * NO `serviceaccounts` verb (cannot invent or patch an identity).
 */
export function reconcilerRbac(args: ReconcilerRbacArgs): {
  serviceAccount: Record<string, unknown>;
  role: Record<string, unknown>;
  roleBinding: Record<string, unknown>;
} {
  const { cronJobName, namespace, reconcilerServiceAccountName } = args;
  return {
    serviceAccount: {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: reconcilerServiceAccountName, namespace, labels: { ...MANAGED_BY } },
    },
    role: {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: { name: cronJobName, namespace, labels: { ...MANAGED_BY } },
      rules: [
        { apiGroups: ["batch"], resources: ["jobs"], verbs: ["get", "list", "create"] },
        { apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] },
        { apiGroups: [""], resources: ["resourcequotas"], verbs: ["get"] },
        // self-suspend at terminal only (restricted to this CronJob)
        { apiGroups: ["batch"], resources: ["cronjobs"], resourceNames: [cronJobName], verbs: ["get", "patch"] },
        // single-writer lock lease
        { apiGroups: ["coordination.k8s.io"], resources: ["leases"], resourceNames: [reconcilerLockName(cronJobName)], verbs: ["get", "update"] },
        { apiGroups: ["coordination.k8s.io"], resources: ["leases"], verbs: ["create"] },
        // NOTE: intentionally NO serviceaccounts verb — cannot create/patch identities.
      ],
    },
    roleBinding: {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: { name: cronJobName, namespace, labels: { ...MANAGED_BY } },
      subjects: [{ kind: "ServiceAccount", name: reconcilerServiceAccountName, namespace }],
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: cronJobName },
    },
  };
}

export interface ReconcilerCronArgs {
  cronJobName: string;
  namespace: string;
  reconcilerServiceAccountName: string;
  image: string;
  /** Entry command (default: run the s3-dag reconcile tick under tsx). */
  command?: readonly string[];
  /** Non-secret env for the tick (dag id, lane, bucket, prefix, quota, …). */
  env: Readonly<Record<string, string>>;
  /** Secret providing S3 credentials (mounted via envFrom). */
  s3SecretName: string;
  /** Cron schedule (default every 2 minutes, like pv-capture). */
  schedule?: string;
  imagePullSecret?: string;
}

/** The reconciler CronJob — one short, idempotent tick; the controller reschedules. */
export function reconcilerCronManifest(args: ReconcilerCronArgs): Record<string, unknown> {
  const baseEnv: Record<string, string> = {
    NODE_OPTIONS: "--dns-result-order=ipv4first",
    AWS_MAX_ATTEMPTS: "10",
    ...args.env,
  };
  const env = Object.entries(baseEnv).map(([name, value]) => ({ name, value }));
  const container: Record<string, unknown> = {
    name: "reconciler",
    image: args.image,
    command: [...(args.command ?? ["tsx", "src/s3dag/reconcile-run.ts"])],
    env,
    envFrom: [{ secretRef: { name: args.s3SecretName } }],
    resources: { requests: { cpu: "10m", memory: "32Mi" }, limits: { cpu: "200m", memory: "192Mi" } },
  };
  return {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: { name: args.cronJobName, namespace: args.namespace, labels: { ...MANAGED_BY } },
    spec: {
      schedule: args.schedule ?? "*/2 * * * *",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      suspend: false,
      jobTemplate: {
        spec: {
          backoffLimit: 0,
          ttlSecondsAfterFinished: 600,
          template: {
            metadata: { labels: { ...MANAGED_BY } },
            spec: {
              serviceAccountName: args.reconcilerServiceAccountName,
              restartPolicy: "Never",
              ...(args.imagePullSecret ? { imagePullSecrets: [{ name: args.imagePullSecret }] } : {}),
              containers: [container],
            },
          },
        },
      },
    },
  };
}
