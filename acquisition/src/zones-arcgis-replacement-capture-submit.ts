/**
 * Soumet UN Job Kubernetes de capture ArcGIS mono-ville, puis se termine.
 *
 * Le contrat contrôlé est d'abord canonisé et déposé immuablement sur S3. Le
 * pod reçoit sa clé, son SHA et son RUN_ID exact; il ne peut ni choisir une
 * autre worklist ni écrire des données servies. Aucun polling local.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  assertReplacementTargetMatchesMunicipalityRegister,
  parseZonesArcgisReplacementWorklist,
  serializeZonesArcgisReplacementWorklist,
  zonesArcgisReplacementWorklistSha256,
  type RegisteredReplacementMunicipality,
  type ZonesArcgisReplacementWorklist,
} from "./lib/zones-arcgis-replacement-worklist.js";
import { assertDeclaredCluster, kubectlApplyArgs } from "./k8s-capture-run.js";
import { putBytesIfAbsentOrEqual, s3Client } from "./lib/s3.js";

interface Args {
  worklistPath: string;
  kubeconfig: string;
  image: string;
  namespace: string;
  runStamp: string;
  gitSha: string;
  memoryLimitMi: number;
  maxBytes: number;
  egress: string;
  dryRun: boolean;
}

const MUNICIPALITIES = new URL("../../packages/qc-sources/src/geo/municipalities.qc.json", import.meta.url);

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index < 0 ? undefined : argv[index + 1];
}

function flag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function boundedInteger(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} doit être un entier dans ${min}..${max}`);
  }
  return value;
}

function gitHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const sha = result.stdout.trim();
  if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("git HEAD illisible");
  return sha;
}

function captureStamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function isImmutableImage(value: string): boolean {
  return /@sha256:[a-f0-9]{64}$/.test(value);
}

export function parseArgs(argv: readonly string[]): Args {
  const worklistPath = option(argv, "worklist");
  const kubeconfig = option(argv, "kubeconfig");
  const image = option(argv, "image");
  if (!worklistPath) throw new Error("--worklist est requis");
  if (!kubeconfig) throw new Error("--kubeconfig est requis");
  if (!image || !isImmutableImage(image)) throw new Error("--image doit être une référence épinglée par @sha256:<digest>");
  const runStamp = option(argv, "run-stamp") ?? captureStamp();
  if (!/^\d{8}T\d{6}Z$/.test(runStamp)) throw new Error("--run-stamp doit être YYYYMMDDTHHMMSSZ");
  const gitSha = option(argv, "git-sha") ?? gitHead();
  if (!/^[a-f0-9]{40}$/.test(gitSha)) throw new Error("--git-sha doit être un SHA git complet");
  const egress = option(argv, "egress") ?? "direct";
  if (!/^(direct|tor:[a-z0-9][a-z0-9-]*|proxy:[a-z0-9][a-z0-9-]*)$/.test(egress)) {
    throw new Error("--egress doit être direct | tor:<lane> | proxy:<id>");
  }
  return {
    worklistPath,
    kubeconfig,
    image,
    namespace: option(argv, "namespace") ?? "geo",
    runStamp,
    gitSha,
    // La capture flux→CAS ne retient pas le GeoJSON mais son plafond est séparé
    // du 176 Mi générique; le pic cgroup est versé dans run.log avant upload.
    memoryLimitMi: boundedInteger("memory-limit-mi", option(argv, "memory-limit-mi"), 512, 256, 1024),
    maxBytes: boundedInteger("max-bytes", option(argv, "max-bytes"), 268_435_456, 1, 1_073_741_824),
    egress,
    dryRun: flag(argv, "dry-run"),
  };
}

function registeredMunicipalities(): RegisteredReplacementMunicipality[] {
  const parsed = JSON.parse(readFileSync(MUNICIPALITIES, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "object" || entry === null
    || typeof (entry as Partial<RegisteredReplacementMunicipality>).slug !== "string"
    || typeof (entry as Partial<RegisteredReplacementMunicipality>).name !== "string")) {
    throw new Error("registre municipal invalide");
  }
  return parsed as RegisteredReplacementMunicipality[];
}

export function replacementCaptureWorklistKey(worklist: ZonesArcgisReplacementWorklist, runStamp: string): string {
  const target = worklist.targets[0];
  const hash = zonesArcgisReplacementWorklistSha256(worklist).slice("sha256:".length, "sha256:".length + 16);
  return `registry/capture-worklists/zones-arcgis-replacement/${target.slug}-${runStamp}-${hash}.json`;
}

export function replacementCaptureRunId(worklist: ZonesArcgisReplacementWorklist, runStamp: string): string {
  return `zones-${runStamp}-${worklist.targets[0].slug}`;
}

function jobName(args: Args, worklist: ZonesArcgisReplacementWorklist): string {
  const hash = zonesArcgisReplacementWorklistSha256(worklist).slice("sha256:".length, "sha256:".length + 12);
  return `geo-zarc-${args.runStamp.toLowerCase()}-${hash}`;
}

export function jobManifest(args: Args, key: string, worklist: ZonesArcgisReplacementWorklist): string {
  const target = worklist.targets[0];
  const worklistSha256 = zonesArcgisReplacementWorklistSha256(worklist);
  const runId = replacementCaptureRunId(worklist, args.runStamp);
  return `apiVersion: batch/v1
kind: Job
metadata:
  name: ${jobName(args, worklist)}
  namespace: ${args.namespace}
  labels:
    app: geo-zones-arcgis-replacement-capture
    lane: zones
    geo.city: "${target.slug}"
    # Le dépôt lit ce label dans l'objet Job avant toute écriture servie :
    # slug + run-stamp ne suffisent pas à attester qu'il s'agit du même run.
    geo.run-id: "${runId}"
    geo.run-stamp: "${args.runStamp}"
spec:
  completions: 1
  parallelism: 1
  # Aucun retry sous le même RUN_ID : une relance est une nouvelle capture
  # explicitement horodatée, jamais l'écrasement de run.json/manifest.jsonl.
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app: geo-zones-arcgis-replacement-capture
        lane: zones
        geo.city: "${target.slug}"
        geo.run-id: "${runId}"
        geo.run-stamp: "${args.runStamp}"
    spec:
      restartPolicy: Never
      imagePullSecrets:
        - name: geo-registry-pull
      securityContext:
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
              value: "zones"
            - name: CAPTURE_RUNNER
              value: "src/zones-arcgis-replacement-capture-run.ts"
            - name: WORKLIST
              value: "${key}"
            - name: WORKLIST_SHA256
              value: "${worklistSha256}"
            - name: RUN_ID
              value: "${runId}"
            - name: RUN_STAMP
              value: "${args.runStamp}"
            - name: GEO_CAPTURE_EXECUTION
              value: "cluster"
            - name: GEO_GIT_SHA
              value: "${args.gitSha}"
            - name: EGRESS
              value: "${args.egress}"
            - name: MAX_BYTES
              value: "${args.maxBytes}"
            - name: NODE_OPTIONS
              value: "--dns-result-order=ipv4first"
            - name: AWS_MAX_ATTEMPTS
              value: "10"
          envFrom:
            - secretRef:
                name: geo-s3-credentials
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
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
            sizeLimit: 1Gi
`;
}

function apply(args: Args, manifest: string): void {
  assertDeclaredCluster(args);
  const result = spawnSync("kubectl", kubectlApplyArgs(args), { input: manifest, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`kubectl apply a échoué: ${(result.stderr || result.stdout || "statut inconnu").trim()}`);
  }
  process.stderr.write(result.stdout);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const worklist = parseZonesArcgisReplacementWorklist(JSON.parse(readFileSync(args.worklistPath, "utf8")) as unknown);
  assertReplacementTargetMatchesMunicipalityRegister(worklist.targets[0], registeredMunicipalities());
  const key = replacementCaptureWorklistKey(worklist, args.runStamp);
  const canonical = serializeZonesArcgisReplacementWorklist(worklist);
  const manifest = jobManifest(args, key, worklist);
  process.stderr.write(
    `[zones-arcgis-replacement-submit] slug=${worklist.targets[0].slug} run=${replacementCaptureRunId(worklist, args.runStamp)} image=${args.image}\n`
    + `[zones-arcgis-replacement-submit] worklist=s3://sentropic-geo/${key} sha256=${zonesArcgisReplacementWorklistSha256(worklist)}\n`,
  );
  if (args.dryRun) {
    process.stderr.write("[zones-arcgis-replacement-submit] --dry-run: aucun PUT, aucun apply\n");
    process.stdout.write(manifest);
    return;
  }
  await putBytesIfAbsentOrEqual(s3Client(), key, canonical, "application/json");
  apply(args, manifest);
  process.stderr.write("[zones-arcgis-replacement-submit] Job soumis; aucun polling local.\n");
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
