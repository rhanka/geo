/**
 * Un tick autonome de l'arriéré PV, exécuté par le CronJob du même nom.
 *
 * Ce programme ne reste jamais en attente: il prend un Lease, réconcilie l'état
 * S3 avec Kubernetes, lance au plus les places disponibles, persiste chaque
 * transition, puis sort. Le contrôleur CronJob planifie le tick suivant.
 */
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

import { parseCaptureWorklist, parseManifestJsonl } from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, objectHead, putBytesIfAbsent, putBytesIfAbsentOrEqual, putBytesIfMatch, s3Client } from "./lib/s3.js";
import {
  assertBacklogManifest,
  assertBacklogState,
  assertPvBacklogWorklistBytes,
  canonicalCaptureUrl,
  campaignManifestKey,
  campaignReportKey,
  campaignStateKey,
  captureBacklogJobManifest,
  captureBacklogSlots,
  deduplicatePvBacklogTargets,
  kubernetesLeaseTime,
  markLotSubmitted,
  pendingLots,
  planLot,
  sha256,
  reconcileBacklogState,
  stateCounts,
  verifiedCaptureConcurrency,
  type KubernetesJobStatus,
  type ObservedCaptureJob,
  type PvCaptureBacklogManifest,
  type PvCaptureBacklogState,
} from "./lib/pv-capture-backlog.js";

const TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

interface KubernetesList<T> {
  items?: T[];
}

interface KubernetesJob {
  metadata?: { name?: string };
  status?: { active?: number; succeeded?: number; failed?: number; conditions?: { type?: string; status?: string; reason?: string; message?: string }[] };
}

interface KubernetesPod {
  status?: { containerStatuses?: { state?: { terminated?: { reason?: string; message?: string } } }[] };
}

interface KubernetesLease {
  metadata?: { resourceVersion?: string };
  spec?: { holderIdentity?: string; renewTime?: string; leaseDurationSeconds?: number };
}

interface KubernetesResourceQuota {
  status?: { hard?: Record<string, string>; used?: Record<string, string> };
}

class KubernetesApi {
  private readonly host = requireEnv("KUBERNETES_SERVICE_HOST");
  private readonly port = Number(process.env["KUBERNETES_SERVICE_PORT_HTTPS"] ?? process.env["KUBERNETES_SERVICE_PORT"] ?? "443");
  private readonly token = readFileSync(TOKEN_PATH, "utf8").trim();
  private readonly ca = readFileSync(CA_PATH);

  async json<T>(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<T> {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<T>((resolve, reject) => {
      const request = httpsRequest({
        hostname: this.host,
        port: this.port,
        path,
        method,
        ca: this.ca,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(serialized === undefined ? {} : { "Content-Type": contentType, "Content-Length": Buffer.byteLength(serialized) }),
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("error", reject);
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const error = new Error(`Kubernetes ${method} ${path}: HTTP ${status} ${text.slice(0, 800)}`) as Error & { status?: number };
            error.status = status;
            reject(error);
            return;
          }
          if (!text) {
            resolve({} as T);
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on("error", reject);
      if (serialized !== undefined) request.write(serialized);
      request.end();
    });
  }

  async jobs(namespace: string): Promise<KubernetesJob[]> {
    const selector = encodeURIComponent("app=geo-capture");
    return (await this.json<KubernetesList<KubernetesJob>>("GET", `/apis/batch/v1/namespaces/${namespace}/jobs?labelSelector=${selector}`)).items ?? [];
  }

  async podsForJob(namespace: string, jobName: string): Promise<KubernetesPod[]> {
    const selector = encodeURIComponent(`job-name=${jobName}`);
    return (await this.json<KubernetesList<KubernetesPod>>("GET", `/api/v1/namespaces/${namespace}/pods?labelSelector=${selector}`)).items ?? [];
  }

  async resourceQuota(namespace: string, name: string): Promise<KubernetesResourceQuota> {
    return this.json<KubernetesResourceQuota>("GET", `/api/v1/namespaces/${namespace}/resourcequotas/${name}`);
  }

  async createJob(namespace: string, manifest: string): Promise<void> {
    try {
      await this.json("POST", `/apis/batch/v1/namespaces/${namespace}/jobs`, JSON.parse(manifest));
    } catch (error) {
      if (statusOf(error) === 409) return; // Même nom déterministe: création déjà réussie avant le crash du tick.
      throw error;
    }
  }

  async suspendCronJob(namespace: string, name: string): Promise<void> {
    await this.json("PATCH", `/apis/batch/v1/namespaces/${namespace}/cronjobs/${name}`, { spec: { suspend: true } }, "application/merge-patch+json");
  }

  async acquireLease(namespace: string, name: string, holder: string, now: Date, seconds: number): Promise<boolean> {
    const path = `/apis/coordination.k8s.io/v1/namespaces/${namespace}/leases/${name}`;
    let previous: KubernetesLease;
    try {
      previous = await this.json<KubernetesLease>("GET", path);
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
      try {
        await this.json("POST", `/apis/coordination.k8s.io/v1/namespaces/${namespace}/leases`, {
          apiVersion: "coordination.k8s.io/v1",
          kind: "Lease",
          metadata: { name, namespace },
          spec: { holderIdentity: holder, leaseDurationSeconds: seconds, renewTime: kubernetesLeaseTime(now) },
        });
        return true;
      } catch (createError) {
        if (statusOf(createError) === 409) return false;
        throw createError;
      }
    }
    const renewal = previous.spec?.renewTime ? Date.parse(previous.spec.renewTime) : 0;
    const duration = previous.spec?.leaseDurationSeconds ?? seconds;
    const expired = !Number.isFinite(renewal) || renewal + duration * 1_000 < now.getTime();
    if (!expired && previous.spec?.holderIdentity !== holder) return false;
    try {
      await this.json("PUT", path, {
        apiVersion: "coordination.k8s.io/v1",
        kind: "Lease",
        metadata: { name, namespace, resourceVersion: previous.metadata?.resourceVersion },
        spec: { holderIdentity: holder, leaseDurationSeconds: seconds, renewTime: kubernetesLeaseTime(now) },
      });
      return true;
    } catch (error) {
      if (statusOf(error) === 409) return false;
      throw error;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} est requis`);
  return value;
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const detail = error as { status?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (typeof detail.status === "number") return detail.status;
  return typeof detail.$metadata?.httpStatusCode === "number" ? detail.$metadata.httpStatusCode : null;
}

function statusOfJob(job: KubernetesJob): KubernetesJobStatus {
  const conditions = job.status?.conditions ?? [];
  const complete = conditions.find((condition) => condition.type === "Complete" && condition.status === "True");
  if (complete || (job.status?.succeeded ?? 0) > 0) return "complete";
  const failed = conditions.find((condition) => condition.type === "Failed" && condition.status === "True");
  if (failed) return "failed";
  if ((job.status?.active ?? 0) > 0) return "active";
  return "pending";
}

function failureOfJob(job: KubernetesJob, pods: readonly KubernetesPod[]): string | null {
  for (const pod of pods) {
    for (const status of pod.status?.containerStatuses ?? []) {
      const terminated = status.state?.terminated;
      if (terminated?.reason === "OOMKilled") return `OOMKilled${terminated.message ? `: ${terminated.message}` : ""}`;
    }
  }
  const failed = (job.status?.conditions ?? []).find((condition) => condition.type === "Failed" && condition.status === "True");
  return failed?.reason ? `${failed.reason}${failed.message ? `: ${failed.message}` : ""}` : "Job Kubernetes Failed";
}

function numberQuantity(value: string | undefined, resource: string): number {
  if (!value) return 0;
  if (resource.endsWith("cpu")) {
    if (value.endsWith("m")) return Number(value.slice(0, -1));
    return Number(value) * 1_000;
  }
  const units: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, K: 1_000, M: 1_000 ** 2, G: 1_000 ** 3 };
  const match = value.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|K|M|G)?$/);
  if (!match) throw new Error(`quantité Kubernetes invalide ${resource}=${value}`);
  return Number(match[1]) * (match[2] ? units[match[2]]! : 1);
}

function quotaSlots(
  quota: KubernetesResourceQuota,
  activeCaptureJobs: number,
  verifiedConcurrency: number,
): { slots: number; snapshot: Record<string, string> } {
  const hard = quota.status?.hard ?? {};
  const used = quota.status?.used ?? {};
  const snapshot: Record<string, string> = {};
  const remaining: Record<string, number> = {};
  for (const resource of ["pods", "requests.cpu", "requests.memory", "limits.cpu", "limits.memory"]) {
    const available = numberQuantity(hard[resource], resource) - numberQuantity(used[resource], resource);
    remaining[resource] = available;
    snapshot[`${resource}.hard`] = hard[resource] ?? "absent";
    snapshot[`${resource}.used`] = used[resource] ?? "0";
  }
  return {
    slots: captureBacklogSlots(activeCaptureJobs, {
      pods: remaining["pods"]!,
      requests_cpu_milli: remaining["requests.cpu"]!,
      requests_memory_bytes: remaining["requests.memory"]!,
      limits_cpu_milli: remaining["limits.cpu"]!,
      limits_memory_bytes: remaining["limits.memory"]!,
    }, verifiedConcurrency),
    snapshot,
  };
}

async function writeState(
  state: PvCaptureBacklogState,
  etag: string,
): Promise<string> {
  const key = campaignStateKey(state.campaign_id);
  const client = s3Client();
  await putBytesIfMatch(client, key, `${JSON.stringify(state, null, 2)}\n`, etag, "application/json");
  const after = await objectHead(client, key);
  if (!after.exists || !after.etag) throw new Error("state S3 écrit sans ETag: arrêt sûr");
  return after.etag;
}

async function putImmutableReport(state: PvCaptureBacklogState, manifest: PvCaptureBacklogManifest): Promise<string> {
  const key = campaignReportKey(manifest.id);
  const body = `${JSON.stringify({
    contract: "pv-capture-backlog-report/v1",
    // Le rapport doit être rejouable après un crash entre son PUT et le CAS de
    // state; l'horodatage terminal est donc celui déjà durable dans state.
    generated_at: state.updated_at,
    campaign: manifest.id,
    phase: state.phase,
    manifest_key: campaignManifestKey(manifest.id),
    counts: stateCounts(state),
    lots: state.lots,
  }, null, 2)}\n`;
  const s3 = s3Client();
  try {
    await putBytesIfAbsent(s3, key, body, "application/json");
  } catch (error) {
    if (statusOf(error) !== 412) throw error;
    const existing = await getBytes(s3, key);
    if (existing.toString("utf8") !== body) throw new Error(`rapport terminal déjà présent mais divergent: ${key}`);
  }
  return key;
}

/**
 * Les runs de ce contrôleur ont un RUN_ID déterministe: le shell de capture
 * préfixe le RUN_STAMP (nom de Job) par `pv-`. On ne liste donc jamais le
 * corpus entier: seulement les manifests des lots déjà soumis par CETTE
 * campagne, y compris ceux bloqués après un Job disparu.
 */
async function capturedUrlsForCampaign(
  s3: ReturnType<typeof s3Client>,
  manifest: PvCaptureBacklogManifest,
): Promise<Set<string>> {
  // L'état est un pointeur mutable et peut être en retard sur un run écrit
  // juste avant un crash. Les manifests de la campagne sont la seule preuve
  // admissible pour une reprise, y compris pour un lot encore `pending`.
  const entries = await listObjectEntries(s3, `capture/_runs/pv-geo-capture-pv-${manifest.id}-`);
  const manifestKeys = entries
    .map((entry) => entry.key)
    .filter((key) => key.endsWith("/manifest.jsonl"));
  const captured = new Set<string>();
  for (const key of manifestKeys) {
    const lines = parseManifestJsonl((await getBytes(s3, key)).toString("utf8"));
    for (const line of lines) {
      if (line.source === "pv-index" && line.storage_key !== null) captured.add(canonicalCaptureUrl(line.url));
    }
  }
  return captured;
}

interface PreparedWorklist {
  worklist_key: string;
  worklist_sha256: `sha256:${string}`;
  discarded_captured: number;
  remaining_targets: number;
}

/** Prépare une worklist dérivée immuable avant de marquer le lot planned. */
async function prepareWorklist(
  s3: ReturnType<typeof s3Client>,
  manifest: PvCaptureBacklogManifest,
  lot: PvCaptureBacklogManifest["lots"][number],
  capturedUrls: ReadonlySet<string>,
): Promise<PreparedWorklist> {
  const original = await getBytes(s3, lot.worklist_key);
  assertPvBacklogWorklistBytes(lot.lot, lot.worklist_key, lot.worklist_sha256, original);
  const deduplicated = deduplicatePvBacklogTargets(
    lot.lot,
    parseCaptureWorklist(JSON.parse(original.toString("utf8"))),
    capturedUrls,
  );
  if (deduplicated.discarded_captured === 0) {
    return {
      worklist_key: lot.worklist_key,
      worklist_sha256: lot.worklist_sha256,
      discarded_captured: 0,
      remaining_targets: deduplicated.targets.length,
    };
  }
  const body = `${JSON.stringify(deduplicated.targets, null, 2)}\n`;
  const worklist_sha256 = sha256(body);
  const worklist_key = `registry/capture-worklists/${manifest.id}/resume/lot-${lot.lot.toString().padStart(4, "0")}-${worklist_sha256.slice("sha256:".length, "sha256:".length + 16)}.json`;
  await putBytesIfAbsentOrEqual(s3, worklist_key, body, "application/json");
  return {
    worklist_key,
    worklist_sha256,
    discarded_captured: deduplicated.discarded_captured,
    remaining_targets: deduplicated.targets.length,
  };
}

function plannedWorklist(
  state: PvCaptureBacklogState,
  lot: PvCaptureBacklogManifest["lots"][number],
): PreparedWorklist {
  const stateLot = state.lots.find((candidate) => candidate.lot === lot.lot);
  if (!stateLot) throw new Error(`lot ${lot.lot} absent de l'état`);
  if (stateLot.effective_worklist_key !== undefined && stateLot.effective_worklist_key !== null) {
    if (stateLot.effective_worklist_sha256 === undefined || stateLot.effective_worklist_sha256 === null) {
      throw new Error(`lot ${lot.lot}: worklist effective sans hash`);
    }
    return {
      worklist_key: stateLot.effective_worklist_key,
      worklist_sha256: stateLot.effective_worklist_sha256,
      discarded_captured: stateLot.discarded_captured ?? 0,
      remaining_targets: lot.targets - (stateLot.discarded_captured ?? 0),
    };
  }
  return { worklist_key: lot.worklist_key, worklist_sha256: lot.worklist_sha256, discarded_captured: 0, remaining_targets: lot.targets };
}

/** Relit la worklist effective avant chaque POST, y compris après un crash planned. */
async function verifyPreparedWorklist(
  s3: ReturnType<typeof s3Client>,
  lot: PvCaptureBacklogManifest["lots"][number],
  prepared: PreparedWorklist,
): Promise<void> {
  const body = await getBytes(s3, prepared.worklist_key);
  assertPvBacklogWorklistBytes(lot.lot, prepared.worklist_key, prepared.worklist_sha256, body);
}

async function main(): Promise<void> {
  const id = requireEnv("PV_CAPTURE_BACKLOG_ID");
  const cronJob = requireEnv("PV_CAPTURE_BACKLOG_CRONJOB");
  const quotaName = process.env["PV_CAPTURE_BACKLOG_QUOTA"] ?? "tenant-quota";
  const holder = process.env["HOSTNAME"] ?? `tick-${process.pid}`;
  const now = new Date();
  const s3 = s3Client();
  const manifest = JSON.parse((await getBytes(s3, campaignManifestKey(id))).toString("utf8")) as PvCaptureBacklogManifest;
  assertBacklogManifest(manifest);
  const stateHead = await objectHead(s3, campaignStateKey(id));
  if (!stateHead.exists || !stateHead.etag) throw new Error("state d'arriéré absent ou sans ETag: refus de deviner");
  let state = JSON.parse((await getBytes(s3, campaignStateKey(id))).toString("utf8")) as PvCaptureBacklogState;
  assertBacklogState(state, manifest);
  let stateEtag = stateHead.etag;

  const k8s = new KubernetesApi();
  if (!await k8s.acquireLease(manifest.namespace, `${cronJob}-lock`, holder, now, 90)) {
    console.log(JSON.stringify({ campaign: id, action: "lease-held", state: state.phase }));
    return;
  }

  const jobs = await k8s.jobs(manifest.namespace);
  const ownNames = new Set(manifest.lots.map((lot) => lot.job_name));
  const observed: ObservedCaptureJob[] = [];
  for (const job of jobs) {
    const name = job.metadata?.name;
    if (!name || !ownNames.has(name)) continue;
    const status = statusOfJob(job);
    observed.push({
      name,
      status,
      failure_reason: status === "failed" ? failureOfJob(job, await k8s.podsForJob(manifest.namespace, name)) : null,
    });
  }
  state = reconcileBacklogState(state, manifest, observed, now.toISOString());
  if (state.phase !== "running") {
    stateEtag = await writeState(state, stateEtag);
    const report = await putImmutableReport(state, manifest);
    if (state.terminal_report_key === null) {
      state = { ...state, terminal_report_key: report, updated_at: state.updated_at };
      stateEtag = await writeState(state, stateEtag);
    }
    await k8s.suspendCronJob(manifest.namespace, cronJob);
    console.log(JSON.stringify({ campaign: id, action: "terminal", phase: state.phase, report, counts: stateCounts(state) }));
    return;
  }
  const activeCaptureJobs = jobs.filter((job) => {
    const status = statusOfJob(job);
    return status === "pending" || status === "active";
  }).length;
  const quota = await k8s.resourceQuota(manifest.namespace, quotaName);
  const verifiedConcurrency = verifiedCaptureConcurrency(state, manifest);
  const capacity = quotaSlots(quota, activeCaptureJobs, verifiedConcurrency);
  state = { ...state, quota_snapshot: capacity.snapshot, updated_at: now.toISOString() };
  stateEtag = await writeState(state, stateEtag);

  const lots = pendingLots(state, capacity.slots);
  const capturedUrls = await capturedUrlsForCampaign(s3, manifest);
  for (const lotNumber of lots) {
    const lot = manifest.lots.find((candidate) => candidate.lot === lotNumber)!;
    const existing = state.lots.find((candidate) => candidate.lot === lotNumber)!;
    let prepared = plannedWorklist(state, lot);
    if (existing.status === "pending") {
      prepared = await prepareWorklist(s3, manifest, lot, capturedUrls);
      if (prepared.discarded_captured > 0) {
        console.log(JSON.stringify({
          campaign: manifest.id,
          lot: lotNumber,
          action: "deduplicated-captured",
          discarded_captured: prepared.discarded_captured,
          remaining_targets: prepared.remaining_targets,
        }));
      }
      state = planLot(
        state,
        lotNumber,
        new Date().toISOString(),
        prepared.discarded_captured > 0 ? prepared : undefined,
      );
      stateEtag = await writeState(state, stateEtag); // CAS avant POST Kubernetes.
    }
    await verifyPreparedWorklist(s3, lot, prepared);
    await k8s.createJob(manifest.namespace, captureBacklogJobManifest(manifest, lot, prepared.worklist_key));
    state = markLotSubmitted(state, lotNumber, new Date().toISOString());
    stateEtag = await writeState(state, stateEtag);
  }
  console.log(JSON.stringify({
    campaign: id,
    action: lots.length === 0 ? "waiting-quota-or-jobs" : "launched",
    launched_lots: lots,
    active_capture_jobs: activeCaptureJobs,
    verified_concurrency: verifiedConcurrency,
    quota_slots: capacity.slots,
    counts: stateCounts(state),
    state_key: campaignStateKey(id),
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
