/**
 * Kubernetes {@link JobExecutor} — submits/observes DAG nodes as idempotent Jobs.
 *
 * Design (dossier D2):
 *  - `submit` POSTs the Job built by {@link buildJobManifest}; a 409 (name already
 *    exists) is a NO-OP — the deterministic name makes re-submit idempotent, so a
 *    crashed tick re-runs safely.
 *  - `observe` reads each Job BY NAME (404 → `missing`, which drives an idempotent
 *    re-submit upstream). Statuses map to the port's {@link JobStatus}.
 *  - The executor ASSIGNS a PRE-PROVISIONED per-lane SA (via the manifest's
 *    `serviceAccountName`); it never creates or patches ServiceAccounts. Its RBAC
 *    is therefore minimal — `jobs` (create/get) + `pods` (get, for failure reasons)
 *    — with NO `create`/`patch serviceaccounts`. That closes "invent/patch an
 *    identity" (run isolation); it does NOT by itself enforce per-lane (whoever
 *    holds `create jobs` still writes `serviceAccountName` — the CI-boundary is
 *    infra, not this executor). See {@link laneServiceAccountName}.
 *  - The k8s transport is INJECTABLE ({@link K8sJobsApi}) so the mapping is unit-
 *    testable without a cluster; {@link inClusterJobsApi} is the real adapter.
 */

import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

import { buildJobManifest } from "./job-manifest.js";
import type { JobExecutor, JobStatus, JobSubmission, ObservedJob } from "./ports.js";

export interface RawJob {
  metadata?: { name?: string };
  status?: {
    active?: number;
    succeeded?: number;
    failed?: number;
    conditions?: { type?: string; status?: string; reason?: string; message?: string }[];
  };
}

export interface RawPod {
  status?: { containerStatuses?: { state?: { terminated?: { reason?: string; message?: string } } }[] };
}

/** Minimal k8s Jobs surface the executor needs — injectable for tests. */
export interface K8sJobsApi {
  /** GET a Job by name; `undefined` on 404. */
  getJob(namespace: string, name: string): Promise<RawJob | undefined>;
  /** POST a Job manifest; a 409 (already exists) MUST resolve as a no-op. */
  createJob(namespace: string, manifest: Record<string, unknown>): Promise<void>;
  /** GET the pods of a Job (for failure diagnosis). */
  listPodsForJob(namespace: string, jobName: string): Promise<RawPod[]>;
}

/** PURE: map a raw Job's status to the port's lifecycle status. */
export function jobStatusOf(job: RawJob): JobStatus {
  const conditions = job.status?.conditions ?? [];
  const complete = conditions.find((c) => c.type === "Complete" && c.status === "True");
  if (complete || (job.status?.succeeded ?? 0) > 0) return "succeeded";
  const failed = conditions.find((c) => c.type === "Failed" && c.status === "True");
  if (failed || (job.status?.failed ?? 0) > 0) return "failed";
  if ((job.status?.active ?? 0) > 0) return "active";
  return "pending";
}

/** PURE: a concise failure reason (OOMKilled surfaced first), or a generic fallback. */
export function jobFailureReason(job: RawJob, pods: readonly RawPod[]): string {
  for (const pod of pods) {
    for (const cs of pod.status?.containerStatuses ?? []) {
      const t = cs.state?.terminated;
      if (t?.reason === "OOMKilled") return `OOMKilled${t.message ? `: ${t.message}` : ""}`;
    }
  }
  const failed = (job.status?.conditions ?? []).find((c) => c.type === "Failed" && c.status === "True");
  return failed?.reason ? `${failed.reason}${failed.message ? `: ${failed.message}` : ""}` : "Job failed";
}

export class K8sJobExecutor implements JobExecutor {
  readonly #namespace: string;
  readonly #lane: string;
  readonly #api: K8sJobsApi;

  constructor(cfg: { namespace: string; lane: string; api: K8sJobsApi }) {
    this.#namespace = cfg.namespace;
    this.#lane = cfg.lane;
    this.#api = cfg.api;
  }

  async observe(names: readonly string[]): Promise<ObservedJob[]> {
    const out: ObservedJob[] = [];
    for (const name of names) {
      const job = await this.#api.getJob(this.#namespace, name);
      if (!job) {
        out.push({ name, status: "missing" });
        continue;
      }
      const status = jobStatusOf(job);
      if (status === "failed") {
        const pods = await this.#api.listPodsForJob(this.#namespace, name);
        out.push({ name, status, failureReason: jobFailureReason(job, pods) });
      } else {
        out.push({ name, status });
      }
    }
    return out;
  }

  async submit(job: JobSubmission): Promise<void> {
    const manifest = buildJobManifest({ namespace: this.#namespace, lane: this.#lane, submission: job });
    await this.#api.createJob(this.#namespace, manifest); // 409 → no-op inside the api
  }
}

// ── in-cluster REST adapter ─────────────────────────────────────────────────
const TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

function statusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { status?: unknown };
  return typeof e.status === "number" ? e.status : null;
}

/**
 * The real {@link K8sJobsApi}, over the in-cluster REST API (node:https + the
 * projected SA token/CA). Reuses the proven `pv-capture-backlog-run` transport.
 * Credentials/host are read lazily so importing this module never touches the FS.
 */
export function inClusterJobsApi(): K8sJobsApi {
  const host = process.env["KUBERNETES_SERVICE_HOST"];
  const port = Number(process.env["KUBERNETES_SERVICE_PORT_HTTPS"] ?? process.env["KUBERNETES_SERVICE_PORT"] ?? "443");
  if (!host) throw new Error("KUBERNETES_SERVICE_HOST is required (must run in-cluster)");
  const token = readFileSync(TOKEN_PATH, "utf8").trim();
  const ca = readFileSync(CA_PATH);

  function json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<T>((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: host,
          port,
          path,
          method,
          ca,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(serialized === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(serialized) }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
          res.on("error", reject);
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const code = res.statusCode ?? 0;
            if (code < 200 || code >= 300) {
              const error = new Error(`k8s ${method} ${path}: HTTP ${code} ${text.slice(0, 600)}`) as Error & { status?: number };
              error.status = code;
              reject(error);
              return;
            }
            resolve(text ? (JSON.parse(text) as T) : ({} as T));
          });
        },
      );
      req.on("error", reject);
      if (serialized !== undefined) req.write(serialized);
      req.end();
    });
  }

  return {
    async getJob(namespace, name) {
      try {
        return await json<RawJob>("GET", `/apis/batch/v1/namespaces/${namespace}/jobs/${name}`);
      } catch (err) {
        if (statusOf(err) === 404) return undefined;
        throw err;
      }
    },
    async createJob(namespace, manifest) {
      try {
        await json("POST", `/apis/batch/v1/namespaces/${namespace}/jobs`, manifest);
      } catch (err) {
        if (statusOf(err) === 409) return; // deterministic name already created — idempotent
        throw err;
      }
    },
    async listPodsForJob(namespace, jobName) {
      const selector = encodeURIComponent(`job-name=${jobName}`);
      const list = await json<{ items?: RawPod[] }>("GET", `/api/v1/namespaces/${namespace}/pods?labelSelector=${selector}`);
      return list.items ?? [];
    },
  };
}
