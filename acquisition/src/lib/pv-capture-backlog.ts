/**
 * Contrat persistant de l'arriéré de capture PV.
 *
 * Les deux objets S3 de la campagne sont volontairement distincts : le
 * manifeste est immuable (ce qui doit être capturé) tandis que l'état est un
 * pointeur CAS mutable (ce qui a été observé). Ainsi, tuer un tick entre deux
 * appels Kubernetes ne change jamais l'ordre ni le contenu d'un lot.
 */
import { createHash } from "node:crypto";

export const PV_CAPTURE_BACKLOG_CONTRACT = "pv-capture-backlog/v1";
export const PV_CAPTURE_BACKLOG_STATE_CONTRACT = "pv-capture-backlog-state/v1";
/** Absolute ceiling: increase only after the progressive controller has proof. */
export const MAX_PV_CAPTURE_JOBS = 18;
export const DEFAULT_PV_CAPTURE_MAX_ACTIVE_JOBS = 10;

export type PvBacklogPhase = "running" | "complete" | "halted";
export type PvBacklogLotStatus = "pending" | "planned" | "submitted" | "settled" | "blocked";
export type KubernetesJobStatus = "missing" | "pending" | "active" | "complete" | "failed";

export interface PvCaptureBacklogLot {
  lot: number;
  targets: number;
  worklist_key: string;
  worklist_sha256: `sha256:${string}`;
  job_name: string;
}

export interface PvCaptureBacklogManifest {
  contract: typeof PV_CAPTURE_BACKLOG_CONTRACT;
  id: string;
  created_at: string;
  lane: "pv";
  namespace: string;
  image: string;
  delay_ms: number;
  max_bytes: number;
  egress: string;
  /** Campaign cap; the live controller starts at one and raises only after completed lots. */
  max_active_jobs: number;
  lots: PvCaptureBacklogLot[];
}

export interface PvCaptureBacklogLotState {
  lot: number;
  status: PvBacklogLotStatus;
  planned_at: string | null;
  submitted_at: string | null;
  settled_at: string | null;
  /** Les 404 restent dans le manifeste de run; cet échec est infrastructurel. */
  blocked_reason: string | null;
}

export interface PvCaptureBacklogState {
  contract: typeof PV_CAPTURE_BACKLOG_STATE_CONTRACT;
  campaign_id: string;
  manifest_key: string;
  phase: PvBacklogPhase;
  created_at: string;
  updated_at: string;
  lots: PvCaptureBacklogLotState[];
  terminal_report_key: string | null;
  quota_snapshot: Record<string, string> | null;
}

export interface ObservedCaptureJob {
  name: string;
  status: KubernetesJobStatus;
  failure_reason: string | null;
}

/** Quota réellement disponible au moment du tick, dans les unités Kubernetes. */
export interface PvCaptureQuotaHeadroom {
  pods: number;
  requests_cpu_milli: number;
  requests_memory_bytes: number;
  limits_cpu_milli: number;
  limits_memory_bytes: number;
}

/**
 * Borne stricte commune aux Jobs, au quota pods, requests et limits. Chaque
 * lot est mono-pod; cette fonction ne sait donc pas "accidentellement" lancer
 * Jobs Indexed multi-pods : chaque lot PV reste strictement mono-pod.
 */
export function captureBacklogSlots(
  activeCaptureJobs: number,
  headroom: PvCaptureQuotaHeadroom,
  maxActiveJobs = MAX_PV_CAPTURE_JOBS,
): number {
  if (!Number.isInteger(activeCaptureJobs) || activeCaptureJobs < 0) throw new Error("nombre de Jobs actifs invalide");
  if (!Number.isInteger(maxActiveJobs) || maxActiveJobs < 1 || maxActiveJobs > MAX_PV_CAPTURE_JOBS) {
    throw new Error(`maximum de Jobs invalide (1..${MAX_PV_CAPTURE_JOBS})`);
  }
  const values = Object.values(headroom);
  if (values.some((value) => !Number.isFinite(value))) throw new Error("headroom quota invalide");
  return Math.max(0, Math.min(
    maxActiveJobs - activeCaptureJobs,
    Math.floor(headroom.pods),
    Math.floor(headroom.requests_cpu_milli / 60),
    Math.floor(headroom.requests_memory_bytes / (120 * 1024 ** 2)),
    Math.floor(headroom.limits_cpu_milli / 150),
    Math.floor(headroom.limits_memory_bytes / (176 * 1024 ** 2)),
  ));
}

export function campaignManifestKey(id: string): string {
  assertCampaignId(id);
  return `registry/capture-orchestrators/${id}/manifest.json`;
}

export function campaignStateKey(id: string): string {
  assertCampaignId(id);
  return `registry/capture-orchestrators/${id}/state.json`;
}

export function campaignReportKey(id: string): string {
  assertCampaignId(id);
  return `registry/capture-orchestrators/${id}/report.json`;
}

/** Kubernetes LeaseTime requires a microsecond RFC3339 fraction, not JS's milliseconds. */
export function kubernetesLeaseTime(now: Date): string {
  return now.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

export function worklistKey(id: string, lot: number): string {
  assertCampaignId(id);
  return `registry/capture-worklists/${id}/lot-${lot.toString().padStart(4, "0")}.json`;
}

export function captureJobName(id: string, lot: number): string {
  assertCampaignId(id);
  if (!Number.isInteger(lot) || lot < 1 || lot > 9_999) throw new Error(`lot PV invalide: ${lot}`);
  const name = `geo-capture-pv-${id}-${lot.toString().padStart(4, "0")}`;
  if (name.length > 63) throw new Error(`nom de Job Kubernetes trop long: ${name}`);
  return name;
}

export function sha256(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function createBacklogManifest(
  args: Omit<PvCaptureBacklogManifest, "contract" | "max_active_jobs"> & { max_active_jobs?: number },
): PvCaptureBacklogManifest {
  const manifest: PvCaptureBacklogManifest = {
    ...args,
    contract: PV_CAPTURE_BACKLOG_CONTRACT,
    max_active_jobs: args.max_active_jobs ?? DEFAULT_PV_CAPTURE_MAX_ACTIVE_JOBS,
    lots: [...args.lots].sort((left, right) => left.lot - right.lot),
  };
  assertBacklogManifest(manifest);
  return manifest;
}

export function createBacklogState(manifest: PvCaptureBacklogManifest, now: string): PvCaptureBacklogState {
  assertBacklogManifest(manifest);
  return {
    contract: PV_CAPTURE_BACKLOG_STATE_CONTRACT,
    campaign_id: manifest.id,
    manifest_key: campaignManifestKey(manifest.id),
    phase: "running",
    created_at: now,
    updated_at: now,
    lots: manifest.lots.map((lot) => ({
      lot: lot.lot,
      status: "pending",
      planned_at: null,
      submitted_at: null,
      settled_at: null,
      blocked_reason: null,
    })),
    terminal_report_key: null,
    quota_snapshot: null,
  };
}

export function assertBacklogManifest(value: PvCaptureBacklogManifest): void {
  if (value.contract !== PV_CAPTURE_BACKLOG_CONTRACT) throw new Error("contrat manifeste arriéré PV invalide");
  assertCampaignId(value.id);
  if (value.lane !== "pv") throw new Error("l'arriéré ne peut lancer que la lane pv");
  if (!Number.isInteger(value.max_active_jobs) || value.max_active_jobs < 1 || value.max_active_jobs > MAX_PV_CAPTURE_JOBS) {
    throw new Error(`max_active_jobs doit être 1..${MAX_PV_CAPTURE_JOBS}`);
  }
  if (!Array.isArray(value.lots) || value.lots.length === 0) throw new Error("manifeste arriéré PV sans lot");
  const expected = value.lots.map((lot) => lot.lot).sort((left, right) => left - right);
  if (new Set(expected).size !== expected.length || expected.some((lot, index) => lot !== index + 1)) {
    throw new Error("lots d'arriéré PV non contigus à partir de 1");
  }
  for (const lot of value.lots) {
    if (!Number.isInteger(lot.targets) || lot.targets < 1) throw new Error(`lot ${lot.lot}: targets invalide`);
    if (!/^registry\/capture-worklists\/[a-z0-9-]+\/lot-\d{4}\.json$/.test(lot.worklist_key)) {
      throw new Error(`lot ${lot.lot}: clé worklist hors préfixe autorisé`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(lot.worklist_sha256)) throw new Error(`lot ${lot.lot}: hash worklist invalide`);
    if (lot.job_name !== captureJobName(value.id, lot.lot)) throw new Error(`lot ${lot.lot}: nom Job non déterministe`);
  }
}

export function assertBacklogState(state: PvCaptureBacklogState, manifest: PvCaptureBacklogManifest): void {
  if (state.contract !== PV_CAPTURE_BACKLOG_STATE_CONTRACT) throw new Error("contrat état arriéré PV invalide");
  if (state.campaign_id !== manifest.id || state.manifest_key !== campaignManifestKey(manifest.id)) {
    throw new Error("état arriéré PV rattaché à un autre manifeste");
  }
  if (state.lots.length !== manifest.lots.length) throw new Error("état arriéré PV: nombre de lots divergent");
  for (const lot of manifest.lots) {
    const found = state.lots.find((candidate) => candidate.lot === lot.lot);
    if (!found) throw new Error(`état arriéré PV: lot ${lot.lot} absent`);
  }
}

/**
 * Réconcilie seulement des faits terminalement observables. Un Job absent après
 * avoir été soumis est un défaut bloquant : le recréer pourrait refetcher une
 * URL dont le GET a réussi juste avant un crash sans manifest final.
 */
export function reconcileBacklogState(
  state: PvCaptureBacklogState,
  manifest: PvCaptureBacklogManifest,
  jobs: readonly ObservedCaptureJob[],
  now: string,
): PvCaptureBacklogState {
  assertBacklogState(state, manifest);
  if (state.phase !== "running") return state;
  const byName = new Map(jobs.map((job) => [job.name, job]));
  let blocked = false;
  const lots = state.lots.map((previous) => {
    const lot = manifest.lots.find((candidate) => candidate.lot === previous.lot)!;
    const job = byName.get(lot.job_name) ?? { name: lot.job_name, status: "missing" as const, failure_reason: null };
    if (job.status === "complete") {
      return { ...previous, status: "settled" as const, settled_at: previous.settled_at ?? now, blocked_reason: null };
    }
    if (job.status === "failed") {
      blocked = true;
      return {
        ...previous,
        status: "blocked" as const,
        settled_at: previous.settled_at ?? now,
        blocked_reason: job.failure_reason ?? "Job Kubernetes Failed",
      };
    }
    if (job.status === "pending" || job.status === "active") {
      return {
        ...previous,
        status: "submitted" as const,
        submitted_at: previous.submitted_at ?? now,
      };
    }
    if (previous.status === "submitted") {
      blocked = true;
      return {
        ...previous,
        status: "blocked" as const,
        settled_at: previous.settled_at ?? now,
        blocked_reason: "Job soumis mais absent: reprise automatique refusée pour ne rien recapturer ambiguëment",
      };
    }
    return previous;
  });
  const phase: PvBacklogPhase = blocked || lots.some((lot) => lot.status === "blocked")
    ? "halted"
    : lots.every((lot) => lot.status === "settled") ? "complete" : "running";
  return { ...state, phase, lots, updated_at: now };
}

/** Marque AVANT create le Job déterministe; reprise = même nom, jamais un nouveau lot. */
export function planLot(state: PvCaptureBacklogState, lot: number, now: string): PvCaptureBacklogState {
  if (state.phase !== "running") throw new Error(`campagne ${state.campaign_id} ${state.phase}: aucun lancement permis`);
  const found = state.lots.find((candidate) => candidate.lot === lot);
  if (!found || found.status !== "pending") throw new Error(`lot ${lot} non pending`);
  return {
    ...state,
    updated_at: now,
    lots: state.lots.map((candidate) => candidate.lot === lot
      ? { ...candidate, status: "planned" as const, planned_at: now }
      : candidate),
  };
}

export function pendingLots(state: PvCaptureBacklogState, slots: number): number[] {
  if (!Number.isInteger(slots) || slots < 0) throw new Error(`slots invalide: ${slots}`);
  if (state.phase !== "running") return [];
  // `planned` est le crash-point volontairement durable entre le CAS S3 et le
  // POST Kubernetes. Le relancer emploie exactement le même nom/worklist.
  return state.lots
    .filter((lot) => lot.status === "pending" || lot.status === "planned")
    .slice(0, slots)
    .map((lot) => lot.lot);
}

export function markLotSubmitted(state: PvCaptureBacklogState, lot: number, now: string): PvCaptureBacklogState {
  const found = state.lots.find((candidate) => candidate.lot === lot);
  if (!found || (found.status !== "planned" && found.status !== "submitted")) {
    throw new Error(`lot ${lot} non planifié`);
  }
  return {
    ...state,
    updated_at: now,
    lots: state.lots.map((candidate) => candidate.lot === lot
      ? { ...candidate, status: "submitted" as const, submitted_at: candidate.submitted_at ?? now }
      : candidate),
  };
}

export function stateCounts(state: PvCaptureBacklogState): Record<PvBacklogLotStatus, number> {
  const counts: Record<PvBacklogLotStatus, number> = { pending: 0, planned: 0, submitted: 0, settled: 0, blocked: 0 };
  for (const lot of state.lots) counts[lot.status]++;
  return counts;
}

/**
 * A new campaign begins with a single pod. Every higher ceiling requires at
 * least one additional successfully settled Job; a Pending/Failed Job can
 * therefore never make the controller increase concurrency.
 */
export function verifiedCaptureConcurrency(state: PvCaptureBacklogState, manifest: PvCaptureBacklogManifest): number {
  assertBacklogState(state, manifest);
  const settled = state.lots.filter((lot) => lot.status === "settled").length;
  return Math.min(manifest.max_active_jobs, settled + 1);
}

/** Un Job de lot est toujours mono-pod; 6 lots => au plus 6 pods de capture. */
export function captureBacklogJobManifest(manifest: PvCaptureBacklogManifest, lot: PvCaptureBacklogLot): string {
  assertBacklogManifest(manifest);
  const labels = { app: "geo-capture", lane: "pv", "geo.sentropic.io/capture-backlog": manifest.id };
  return `${JSON.stringify({
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: lot.job_name, namespace: manifest.namespace, labels },
    spec: {
      completions: 1,
      parallelism: 1,
      // No opaque retry: a failed lot blocks the campaign rather than re-fetching it.
      backoffLimit: 0,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          imagePullSecrets: [{ name: "geo-registry-pull" }],
          securityContext: { fsGroup: 1000, runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
          containers: [{
            name: "capture",
            image: manifest.image,
            imagePullPolicy: "IfNotPresent",
            env: [
              { name: "LANE", value: "pv" },
              { name: "WORKLIST", value: lot.worklist_key },
              { name: "RUN_STAMP", value: lot.job_name },
              { name: "SHARD", value: "0" },
              { name: "SHARDS", value: "1" },
              { name: "DELAY_MS", value: String(manifest.delay_ms) },
              { name: "EGRESS", value: manifest.egress },
              { name: "MAX_BYTES", value: String(manifest.max_bytes) },
              { name: "DRY_RUN", value: "0" },
              { name: "GEO_CAPTURE_EXECUTION", value: "cluster" },
              { name: "NODE_OPTIONS", value: "--dns-result-order=ipv4first" },
              { name: "AWS_MAX_ATTEMPTS", value: "10" },
              { name: "POD_UID", valueFrom: { fieldRef: { fieldPath: "metadata.uid" } } },
            ],
            envFrom: [{ secretRef: { name: "geo-s3-credentials" } }],
            resources: {
              requests: { cpu: "60m", memory: "120Mi" },
              limits: { cpu: "150m", memory: "176Mi" },
            },
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
            volumeMounts: [{ name: "scratch", mountPath: "/scratch" }],
          }],
          volumes: [{ name: "scratch", emptyDir: { sizeLimit: "4Gi" } }],
        },
      },
    },
  }, null, 2)}\n`;
}

/**
 * Le CronJob est généré avec l'identité exacte du manifeste S3, donc aucun
 * identifiant implicite ne peut pointer par mégarde vers une autre campagne. Il est
 * séparé du CronJob mensuel de refresh, qui conserve son rôle de détection.
 */
export function captureBacklogCronManifest(manifest: PvCaptureBacklogManifest, cronJobName: string): string {
  assertBacklogManifest(manifest);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,50}[a-z0-9])?$/.test(cronJobName)) {
    throw new Error(`nom CronJob invalide: ${cronJobName}`);
  }
  const serviceAccount = `${cronJobName}-sa`;
  if (serviceAccount.length > 63) throw new Error(`ServiceAccount trop long: ${serviceAccount}`);
  return `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${serviceAccount}
  namespace: ${manifest.namespace}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${cronJobName}
  namespace: ${manifest.namespace}
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "list", "create"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["resourcequotas"]
    verbs: ["get"]
  - apiGroups: ["batch"]
    resources: ["cronjobs"]
    resourceNames: ["${cronJobName}"]
    verbs: ["get", "patch"]
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    resourceNames: ["${cronJobName}-lock"]
    verbs: ["get", "update"]
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${cronJobName}
  namespace: ${manifest.namespace}
subjects:
  - kind: ServiceAccount
    name: ${serviceAccount}
    namespace: ${manifest.namespace}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${cronJobName}
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${cronJobName}
  namespace: ${manifest.namespace}
  labels:
    app: geo-capture-backlog
    geo.sentropic.io/capture-backlog: ${manifest.id}
spec:
  # Un tick fini vite; la minute suivante reprend sur state.json. Pas de loop.
  schedule: "*/2 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 3
  suspend: false
  jobTemplate:
    spec:
      backoffLimit: 0
      ttlSecondsAfterFinished: 600
      template:
        metadata:
          labels:
            app: geo-capture-backlog
        spec:
          serviceAccountName: ${serviceAccount}
          restartPolicy: Never
          imagePullSecrets:
            - name: geo-registry-pull
          securityContext:
            runAsNonRoot: true
            seccompProfile:
              type: RuntimeDefault
          containers:
            - name: orchestrator
              image: ${manifest.image}
              imagePullPolicy: IfNotPresent
              command: ["tsx", "src/pv-capture-backlog-run.ts"]
              env:
                - name: PV_CAPTURE_BACKLOG_ID
                  value: "${manifest.id}"
                - name: PV_CAPTURE_BACKLOG_CRONJOB
                  value: "${cronJobName}"
                - name: PV_CAPTURE_BACKLOG_QUOTA
                  value: "tenant-quota"
                - name: NODE_OPTIONS
                  value: "--dns-result-order=ipv4first"
                - name: AWS_MAX_ATTEMPTS
                  value: "10"
              envFrom:
                - secretRef:
                    name: geo-s3-credentials
              resources:
                requests:
                  # Le tick reste petit face aux Jobs de capture; le quota borne
                  # la montée progressive dans captureBacklogSlots.
                  cpu: 10m
                  memory: 16Mi
                limits:
                  cpu: 100m
                  memory: 128Mi
              securityContext:
                allowPrivilegeEscalation: false
                capabilities:
                  drop: ["ALL"]
`;
}

function assertCampaignId(id: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,34}[a-z0-9])?$/.test(id)) {
    throw new Error("id de campagne invalide (DNS label 1..36, minuscules/chiffres/tirets)");
  }
}
