/**
 * Soumet une capture générique au cluster sans rester à la surveiller.
 *
 * Le programme dépose d'abord une worklist validée sous
 * `registry/capture-worklists/`, puis applique UN Job Kubernetes Indexed. Le
 * contrôleur Kubernetes borne lui-même `parallelism` à `--concurrency`; ce
 * processus local n'a ni boucle de polling ni sleep et se termine dès l'apply.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  CAPTURE_LANES,
  captureRunStamp,
  parseCaptureWorklist,
  type CaptureLane,
  type CaptureWorklistTarget,
} from "../../packages/qc-sources/src/capture/index.js";
import {
  assertObjectStoreCampaignOwnerGo,
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  isCampaignBucket,
  type CampaignBucket,
  type CampaignExecutionPlan,
  type H2aRecordReader,
  type ObjectStoreCampaignOwnerGo,
  type Sha256Ref,
} from "./lib/object-store-campaign-gate.js";
import {
  assertLaneGatedCaptureAuthorized,
  SUBMITTED_JOB_EXECUTION,
  type LaneGatedCaptureOwnerGoArtifact,
} from "./lib/lane-gated-capture-authorization.js";
import { putBytesIfAbsent, s3Client, s3Target } from "./lib/s3.js";
import { assertPinnedImage } from "./lib/capture-image-pin.js";

interface Args {
  lane: CaptureLane;
  worklistPath: string;
  kubeconfig: string;
  shards: number;
  concurrency: number;
  image: string;
  allowUnpinnedImage: boolean;
  namespace: string;
  runStamp: string;
  delayMs: number;
  maxBytes: number;
  memoryLimitMi: number;
  egress: string;
  dryRun: boolean;
  /** Active CA-G8, uniquement pour une capture additive lancée par la lane k8s. */
  laneGatedCapture: boolean;
  /** Artefact owner-go complet lu et vérifié depuis l'inbox h2a de la lane k8s. */
  ownerGoArtifactPath?: string;
  /**
   * SHA git 40-hex du CODE réellement exécuté (runner_git_sha du plan owner-go).
   * Optionnel au parse (le contrat `jobManifest`/`parseArgs` existant reste
   * inchangé) ; EXIGÉ par le gate de campagne avant toute soumission storante.
   */
  gitSha?: string;
}

interface CaptureImageConfig {
  image: string;
  registry: string;
  pinned_at: string;
}

/**
 * Image de capture déclarée DANS LE DÉPÔT ; c'est ce fichier qui fait foi. Le
 * défaut était un tag Scaleway mutable (geo-capture:0.1.1 / normes-pdf-*) qui
 * pouvait glisser vers une AUTRE image sans signal — une capture rejouée aurait
 * alors tourné du code périmé sous le KPI cardinal (preuve v2). On épingle
 * désormais un digest GHCR immuable (acquisition/config/capture-image.json), et
 * `assertPinnedImage` REFUSE tout ce qui n'est pas ce digest.
 */
export function captureImage(): CaptureImageConfig {
  const path = new URL("../config/capture-image.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CaptureImageConfig>;
  if (!parsed.image) {
    throw new Error("acquisition/config/capture-image.json incomplet: image (digest GHCR) requis");
  }
  return { image: parsed.image, registry: parsed.registry ?? "", pinned_at: parsed.pinned_at ?? "" };
}

/**
 * Options d'`assertPinnedImage` PAR CHEMIN. Le chemin **store** (soumission
 * storante gated) IGNORE `--allow-unpinned-image` PAR CONSTRUCTION → image
 * épinglée toujours exigée ; l'échappatoire n'est honorée QUE sur le chemin
 * **dry-run** (debug non storant), et seulement si le flag est explicitement passé.
 * Rendre l'inatteignabilité STRUCTURELLE (pas « on ne passe juste pas le flag »)
 * empêche un refactor futur de re-câbler l'échappatoire dans l'assert storant sans
 * casser ce helper + son test.
 */
export function imagePinOptsForPath(
  path: "store" | "dry-run",
  allowUnpinned: boolean,
): { allowUnpinned: boolean } {
  return { allowUnpinned: path === "dry-run" ? allowUnpinned : false };
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function flag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function integer(name: string, raw: string | undefined, fallback: number, min: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < min) throw new Error(`--${name} doit être un entier >= ${min}`);
  return value;
}

function lane(raw: string | undefined): CaptureLane {
  if (raw && (CAPTURE_LANES as readonly string[]).includes(raw)) return raw as CaptureLane;
  throw new Error(`--lane est requis (${CAPTURE_LANES.join(" | ")})`);
}

function parseArgs(argv: string[]): Args {
  const worklistPath = option(argv, "worklist");
  if (!worklistPath) throw new Error("--worklist <targets.json> est requis");
  const kubeconfig = option(argv, "kubeconfig");
  if (!kubeconfig) throw new Error("--kubeconfig <path> est requis");
  const shards = integer("shards", option(argv, "shards"), 1, 1);
  const concurrency = integer("concurrency", option(argv, "concurrency"), 1, 1);
  if (concurrency > shards) throw new Error("--concurrency ne peut pas dépasser --shards");
  const runStamp = option(argv, "run-stamp") ?? captureRunStamp();
  if (!/^\d{8}T\d{6}Z$/.test(runStamp)) {
    throw new Error("--run-stamp doit être YYYYMMDDTHHMMSSZ");
  }
  const egress = option(argv, "egress") ?? "direct";
  if (!/^(direct|tor:[a-z0-9][a-z0-9-]*|proxy:[a-z0-9][a-z0-9-]*)$/.test(egress)) {
    throw new Error("--egress doit être direct | tor:<lane> | proxy:<id>");
  }
  const memoryLimitMi = integer("memory-limit-mi", option(argv, "memory-limit-mi"), 176, 176);
  const gitSha = option(argv, "git-sha");
  if (gitSha !== undefined && !/^[0-9a-f]{40}$/.test(gitSha)) {
    throw new Error("--git-sha doit être un SHA git complet (40 hex)");
  }
  const laneGatedCapture = flag(argv, "lane-gated-capture");
  const ownerGoArtifactPath = option(argv, "owner-go-artifact");
  if (laneGatedCapture && (!ownerGoArtifactPath || ownerGoArtifactPath.startsWith("--"))) {
    throw new Error("--owner-go-artifact <path> requis avec --lane-gated-capture");
  }
  if (laneGatedCapture && gitSha === undefined) {
    throw new Error("--git-sha <40-hex> requis avec --lane-gated-capture");
  }
  return {
    lane: lane(option(argv, "lane")),
    worklistPath,
    kubeconfig,
    shards,
    concurrency,
    image: option(argv, "image") ?? captureImage().image,
    allowUnpinnedImage: flag(argv, "allow-unpinned-image"),
    namespace: option(argv, "namespace") ?? "geo",
    runStamp,
    delayMs: integer("delay-ms", option(argv, "delay-ms"), 2_000, 0),
    maxBytes: integer("max-bytes", option(argv, "max-bytes"), 104_857_600, 1),
    memoryLimitMi,
    egress,
    dryRun: flag(argv, "dry-run"),
    laneGatedCapture,
    ...(ownerGoArtifactPath !== undefined ? { ownerGoArtifactPath } : {}),
    ...(gitSha !== undefined ? { gitSha } : {}),
  };
}

function jobName(args: Args): string {
  // Kubernetes names are DNS labels; the run stamp is case-normalised only for
  // metadata. The durable `run_id` preserves its canonical uppercase T/Z.
  return `geo-capture-${args.lane}-${args.runStamp.toLowerCase()}`;
}

function worklistKey(args: Args): string {
  return `registry/capture-worklists/${args.lane}-${args.runStamp}.json`;
}

function jobManifest(args: Args, key: string, bucket: string): string {
  return `apiVersion: batch/v1
kind: Job
metadata:
  name: ${jobName(args)}
  namespace: ${args.namespace}
  labels:
    app: geo-capture
    lane: ${args.lane}
    geo.run-stamp: "${args.runStamp}"
spec:
  completionMode: Indexed
  completions: ${args.shards}
  parallelism: ${args.concurrency}
  backoffLimit: 2
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app: geo-capture
        lane: ${args.lane}
        geo.run-stamp: "${args.runStamp}"
    spec:
      restartPolicy: Never
      imagePullSecrets:
        - name: geo-registry-pull
      securityContext:
        # The capture image declares USER 1000:1000. EmptyDir is
        # mounted at /scratch for its redacted temporary log, so grant that
        # group ownership before the non-root entrypoint starts.
        fsGroup: 1000
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: capture
          image: ${args.image}
          imagePullPolicy: IfNotPresent
          env:
            - name: LANE
              value: "${args.lane}"
            - name: WORKLIST
              value: "${key}"
            - name: RUN_STAMP
              value: "${args.runStamp}"
            - name: SHARD
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
            - name: SHARDS
              value: "${args.shards}"
            - name: DELAY_MS
              value: "${args.delayMs}"
            - name: EGRESS
              value: "${args.egress}"
            - name: MAX_BYTES
              value: "${args.maxBytes}"
            - name: DRY_RUN
              value: "0"
            - name: GEO_CAPTURE_EXECUTION
              value: "cluster"
            - name: NODE_OPTIONS
              value: "--dns-result-order=ipv4first"
            - name: AWS_MAX_ATTEMPTS
              value: "10"
            # Bucket cible injecté depuis le runner (bucket gated, config-driven §6). L'image
            # bake le bucket prod par défaut ; cet override fait qu'UNE image sert les 2 envs
            # (le pod écrit là où le gate a validé — même source, zéro divergence).
            - name: S3_BUCKET
              value: "${bucket}"
            - name: POD_UID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.uid
          envFrom:
            - secretRef:
                name: geo-s3-credentials
          resources:
            requests:
              # Avec les services résidents, le quota laisse 395m de requêtes:
              # six captures à 60m utilisent 360m.
              cpu: 60m
              # Le quota laisse 736Mi de requêtes mémoire après les services:
              # six captures réservent 720Mi sans abaisser leur limite de 176Mi.
              memory: 120Mi
            limits:
              # Le quota laisse 900m de limites CPU: six captures à 150m
              # atteignent ce plafond sans empêcher leur création.
              cpu: 150m
              # 176 Mi est le réglage mesuré par défaut. Une couche qui dépasse
              # ce pic est reprise seule avec --memory-limit-mi, jamais avec
              # un troisième pod hors quota.
              memory: ${args.memoryLimitMi}Mi
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: scratch
              mountPath: /scratch
      volumes:
        - name: scratch
          emptyDir:
            sizeLimit: 4Gi
`;
}

export function kubectlApplyArgs(args: Pick<Args, "kubeconfig" | "namespace">): string[] {
  return ["--kubeconfig", args.kubeconfig, "-n", args.namespace, "apply", "-f", "-"];
}

interface K8sTarget {
  server: string;
  cluster: string;
  namespace: string;
}

/** Cible declaree dans le depot; c'est elle qui fait foi, pas le kubeconfig fourni. */
export function k8sTarget(): K8sTarget {
  const path = new URL("../config/k8s-target.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<K8sTarget>;
  if (!parsed.server || !parsed.cluster || !parsed.namespace) {
    throw new Error("acquisition/config/k8s-target.json incomplet: server, cluster et namespace sont requis");
  }
  return { server: parsed.server, cluster: parsed.cluster, namespace: parsed.namespace };
}

/**
 * Refuse d'appliquer sur un cluster autre que celui declare.
 *
 * `--kubeconfig` etait deja obligatoire, mais rien ne verifiait QUEL cluster ce
 * fichier designe. Le 2026-07-29, l'outillage a donc cree un CronJob de capture
 * sur SCALEWAY — cadence toutes les 2 minutes, pods en Error — et c'est l'equipe k8s qui l'a vu
 * depuis chez elle. Rien de notre cote ne pouvait le signaler: un apply reussi
 * sur le mauvais cluster ressemble exactement a un apply reussi.
 */
export function assertDeclaredCluster(args: Pick<Args, "kubeconfig" | "namespace">): void {
  const target = k8sTarget();
  const view = spawnSync(
    "kubectl",
    ["--kubeconfig", args.kubeconfig, "config", "view", "--minify", "-o", "jsonpath={.clusters[0].cluster.server}"],
    { encoding: "utf8" },
  );
  if (view.status !== 0) {
    throw new Error(`kubectl config view a échoué sur ${args.kubeconfig}: ${(view.stderr || "statut inconnu").trim()}`);
  }
  const server = view.stdout.trim();
  if (server !== target.server) {
    throw new Error(
      `cluster ${server || "(vide)"} ne correspond pas a la cible declaree ${target.server} ` +
        `(acquisition/config/k8s-target.json). Une bascule de cluster se declare DANS LE DEPOT; ` +
        `le kubeconfig ${args.kubeconfig} designe un autre cluster.`,
    );
  }
  if (args.namespace !== target.namespace) {
    throw new Error(`namespace ${args.namespace} ne correspond pas a la cible declaree ${target.namespace}`);
  }
}

function apply(args: Args, manifest: string): void {
  assertDeclaredCluster(args);
  const result = spawnSync("kubectl", kubectlApplyArgs(args), {
    input: manifest,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`kubectl apply a échoué: ${(result.stderr || result.stdout || "statut inconnu").trim()}`);
  }
  process.stderr.write(result.stdout);
}

// ─────────────────────────────────────────────────────────────────────────────
// FIREWALL — gate owner-go de la campagne object-store (SPEC §3, CA-G1/G2/G6)
//
// Avant TOUTE soumission d'un Job de capture STORANTE (PUT worklist + kubectl
// apply), le runner exige un artefact `object-store-campaign-owner-go/v1` valide
// RELU du store h2a via des lecteurs INJECTÉS. Un relais conducteur (« l'owner a
// dit go ») ne satisfait JAMAIS le gate. Refus par construction : sans câblage
// explicite de l'artefact, rien ne fire.
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignOwnerGoResolution {
  ownerGo: ObjectStoreCampaignOwnerGo;
  readEnvelope: H2aRecordReader;
  readSession: H2aRecordReader;
}

/**
 * Point d'injection du store h2a. ABSENT PAR DÉFAUT → refus par construction :
 * aucune capture storante ne fire tant que l'owner-go n'est pas câblé (lu depuis
 * le store h2a injecté, jamais depuis un message conducteur).
 */
export interface CaptureCampaignGateDeps {
  resolveOwnerGo?: (ctx: {
    plan: CampaignExecutionPlan;
    designSha256: Sha256Ref;
  }) => Promise<CampaignOwnerGoResolution>;
}

/** Params de méthode stables de la campagne capture (partie de la préimage design_sha256). */
export function captureCampaignMethod(
  args: Pick<Args, "lane" | "egress" | "image" | "maxBytes">,
): Record<string, unknown> {
  return { lane: args.lane, egress: args.egress, image: args.image, max_bytes: args.maxBytes };
}

function requireRunnerGitSha(args: Pick<Args, "gitSha">): string {
  if (args.gitSha === undefined || !/^[0-9a-f]{40}$/.test(args.gitSha)) {
    throw new Error(
      "--git-sha <40-hex> requis: runner_git_sha du plan owner-go de la campagne object-store (le CODE réellement exécuté)",
    );
  }
  return args.gitSha;
}

/**
 * GATE avant toute soumission STORANTE (§3) :
 * (a) CA-G2 — `execution === "cluster"` (JAMAIS local) ;
 * (b) construit le plan résolu RÉEL (scope="capture", cibles TRIÉES, runner_git_sha,
 *     method), RECALCULE `design_sha256`, et exige un artefact owner-go valide relu
 *     du store h2a via `assertObjectStoreCampaignOwnerGo`.
 * Sans artefact valide → THROW (refus de soumettre). Preuve-v2 par construction
 * reste assurée en aval par `captureProofFields` (les lignes de capture).
 */
export async function assertCaptureStoreAuthorized(input: {
  execution: "local" | "cluster";
  runnerGitSha: string;
  /** Bucket RÉEL config-driven (= `s3Target().bucket`, lu UNE fois par l'appelant, ∈ allowlist). */
  bucket: CampaignBucket;
  method: Record<string, unknown>;
  targets: readonly CaptureWorklistTarget[];
  deps: CaptureCampaignGateDeps;
}): Promise<{ designSha256: Sha256Ref }> {
  // (a) CA-G2 — JAMAIS local.
  if (input.execution !== "cluster") {
    throw new Error(
      `capture store refusé: execution="${input.execution}" — CA-G2 exige "cluster" (jamais local)`,
    );
  }
  // (b) plan résolu réel (cibles exactes + code) → design_sha256 recalculé.
  const plan = buildCampaignExecutionPlan({
    scope: "capture",
    bucket: input.bucket,
    runnerGitSha: input.runnerGitSha,
    method: input.method,
    targets: input.targets,
  });
  const designSha256 = campaignDesignSha256(plan);
  const resolve = input.deps.resolveOwnerGo;
  if (!resolve) {
    throw new Error(
      "capture store refusé: aucun artefact owner-go câblé — object-store-campaign-owner-go/v1 requis, " +
        "lu depuis le store h2a INJECTÉ (refus par construction). Un relais conducteur ne satisfait pas le gate.",
    );
  }
  const resolution = await resolve({ plan, designSha256 });
  await assertObjectStoreCampaignOwnerGo(
    resolution.ownerGo,
    { designSha256, scope: "capture", bucket: input.bucket },
    resolution.readEnvelope,
    resolution.readSession,
  );
  return { designSha256 };
}

async function main(deps: CaptureCampaignGateDeps = {}): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targets = parseCaptureWorklist(JSON.parse(readFileSync(args.worklistPath, "utf8")));
  const key = worklistKey(args);
  // Bucket RÉEL config-driven (s3Target), lu UNE fois → plan (→ design_sha256), env du pod
  // (S3_BUCKET injecté dans le manifest) ET la capture aval : même source, zéro divergence
  // gate≠write (§6, fail-closed si le s3-target est hors allowlist campagne). Résolu ici (avant
  // le dry-run) pour que le manifest — imprimé en dry-run — porte le S3_BUCKET réel du pod.
  const rawBucket = s3Target().bucket;
  if (!isCampaignBucket(rawBucket)) {
    throw new Error(
      `capture store refusé: s3Target().bucket (${rawBucket}) hors de l'allowlist campagne — refus fail-closed`,
    );
  }
  const bucket: CampaignBucket = rawBucket;
  const manifest = jobManifest(args, key, bucket);
  process.stderr.write(
    `[capture-orch] lane=${args.lane} targets=${targets.length} shards=${args.shards} concurrency=${args.concurrency}\n` +
      `[capture-orch] image=${args.image}\n` +
      `[capture-orch] worklist=s3://sentropic-geo/${key}\n`,
  );
  if (args.dryRun) {
    // Chemin dry-run NON storant : l'échappatoire --allow-unpinned-image n'est
    // tolérée qu'ICI (debug explicite), jamais dans le chemin storant gated.
    assertPinnedImage(args.image, imagePinOptsForPath("dry-run", args.allowUnpinnedImage));
    process.stderr.write("[capture-orch] --dry-run: aucun PUT ni kubectl apply\n");
    process.stdout.write(manifest);
    return;
  }
  // Chemin STORANT gated : image épinglée EXIGÉE PAR CONSTRUCTION. --allow-unpinned-image
  // est INATTEIGNABLE ici (jamais passé) — une image non épinglée casserait de toute
  // façon le binding design_sha256 (method.image ⊂ la préimage) → refus du gate ;
  // cet assert est la ceinture par-dessus les bretelles. imagePinOptsForPath("store", …)
  // force allowUnpinned:false — le flag debug est structurellement ignoré ici.
  assertPinnedImage(args.image, imagePinOptsForPath("store", args.allowUnpinnedImage));
  if (args.laneGatedCapture) {
    const ownerGoArtifact = JSON.parse(
      readFileSync(args.ownerGoArtifactPath as string, "utf8"),
    ) as LaneGatedCaptureOwnerGoArtifact;
    const gate = assertLaneGatedCaptureAuthorized({
      execution: SUBMITTED_JOB_EXECUTION,
      runnerGitSha: requireRunnerGitSha(args),
      bucket,
      method: captureCampaignMethod(args),
      targets,
      ownerGoArtifact,
    });
    // C3 (preuve) : la trace capture le via + la provenance PAR MODE (ancre procédurale
    // évidencée) — h2a_envelope_id/session_id (lane-B, cross-checké vs l'inbox) OU
    // executor_session/received_at (lane-A, la session exécutante du go owner).
    const provenanceTrace =
      ownerGoArtifact.via === "geo-cond"
        ? `h2a_envelope_id=${ownerGoArtifact.h2a_envelope_id}, h2a_session_id=${ownerGoArtifact.h2a_session_id}`
        : `executor_session=${ownerGoArtifact.executor_session}, received_at=${ownerGoArtifact.received_at}`;
    process.stderr.write(
      `[capture-orch] LANE-GATED additive capture launch, via=${ownerGoArtifact.via}, ` +
        `design_sha=${gate.designSha256}, owner_instance=${ownerGoArtifact.owner_instance}, ` +
        `${provenanceTrace}\n`,
    );
  } else {
    // FIREWALL : rien ne fire vers sentropic-geo sans go owner DIRECT relu du store.
    const gate = await assertCaptureStoreAuthorized({
      execution: SUBMITTED_JOB_EXECUTION,
      runnerGitSha: requireRunnerGitSha(args),
      bucket,
      method: captureCampaignMethod(args),
      targets,
      deps,
    });
    process.stderr.write(`[capture-orch] owner-go vérifié: design_sha256=${gate.designSha256}\n`);
  }
  // Ne jamais écraser une worklist portant le même identifiant : l'objet auquel
  // run.json fait référence reste le contrat exact soumis au cluster.
  // Écriture sur le bucket GATED (`bucket` = s3Target validé) EXPLICITEMENT — MÊME source que
  // le gate + le S3_BUCKET injecté au pod : le pod lit la worklist là où l'orchestrateur l'écrit,
  // zéro divergence même si l'env de l'orchestrateur portait un S3_BUCKET ≠ s3Target (§6, cohérence).
  await putBytesIfAbsent(s3Client(), key, `${JSON.stringify(targets, null, 2)}\n`, "application/json", bucket);
  apply(args, manifest);
  process.stderr.write("[capture-orch] Job soumis; le contrôleur Kubernetes gère la concurrence. Aucun polling local.\n");
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}

export { assertLaneGatedCaptureAuthorized, jobManifest, parseArgs, worklistKey };
