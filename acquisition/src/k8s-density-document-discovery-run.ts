/**
 * Submit one short density-document discovery lot to Kubernetes and return.
 *
 * The controller executes one slug per Indexed completion and persists progress
 * request-by-request in capture manifests. This orchestrator has no polling,
 * sleep or wait loop.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { parseDensityDiscoveryWorklist } from "../../packages/qc-sources/src/sources/density-document-discovery.js";
import { DEFAULT_CAPTURE_USER_AGENT } from "./lib/capture-s3.js";
import { putBytesIfAbsent, s3Client } from "./lib/s3.js";

interface Args {
  worklistPath: string;
  kubeconfig: string;
  namespace: string;
  image: string;
  concurrency: number;
  memoryLimitMi: number;
  runStamp: string;
  gitSha: string;
  dryRun: boolean;
}

const DEFAULT_IMAGE = "rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.3-density";

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function flag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function integer(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} doit être un entier dans ${min}..${max}`);
  }
  return value;
}

function gitHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const sha = (result.stdout ?? "").trim();
  if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("git HEAD illisible");
  return sha;
}

function runStamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function parseArgs(argv: readonly string[]): Args {
  const worklistPath = option(argv, "worklist");
  const kubeconfig = option(argv, "kubeconfig");
  if (!worklistPath) throw new Error("--worklist est requis");
  if (!kubeconfig) throw new Error("--kubeconfig est requis");
  const stamp = option(argv, "run-stamp") ?? runStamp();
  if (!/^\d{8}T\d{6}Z$/.test(stamp)) throw new Error("--run-stamp doit être YYYYMMDDTHHMMSSZ");
  const sha = option(argv, "git-sha") ?? gitHead();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("--git-sha doit être un SHA git complet");
  return {
    worklistPath,
    kubeconfig,
    namespace: option(argv, "namespace") ?? "geo",
    image: option(argv, "image") ?? DEFAULT_IMAGE,
    concurrency: integer("concurrency", option(argv, "concurrency"), 1, 1, 2),
    memoryLimitMi: integer("memory-limit-mi", option(argv, "memory-limit-mi"), 480, 256, 512),
    runStamp: stamp,
    gitSha: sha,
    dryRun: flag(argv, "dry-run"),
  };
}

export function densityWorklistKey(
  baselineSha256: string,
  lot: number,
): string {
  return `registry/capture-worklists/normes-density-${baselineSha256.slice(0, 16)}-lot-${String(lot).padStart(2, "0")}.json`;
}

export function jobManifest(
  args: Args,
  key: string,
  lot: number,
  targetCount: number,
): string {
  const name = `geo-density-l${lot}-${args.runStamp.toLowerCase()}`;
  return `apiVersion: batch/v1
kind: Job
metadata:
  name: ${name}
  namespace: ${args.namespace}
  labels:
    app: geo-density-discovery
    lane: normes
    geo.run-stamp: "${args.runStamp}"
    geo.lot: "${lot}"
spec:
  completionMode: Indexed
  completions: ${targetCount}
  parallelism: ${args.concurrency}
  backoffLimitPerIndex: 1
  maxFailedIndexes: ${targetCount}
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app: geo-density-discovery
        lane: normes
        geo.run-stamp: "${args.runStamp}"
        geo.lot: "${lot}"
    spec:
      restartPolicy: Never
      imagePullSecrets:
        - name: geo-registry-pull
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: discovery
          image: ${args.image}
          imagePullPolicy: IfNotPresent
          command:
            - tsx
            - src/density-document-discovery-run.ts
          env:
            - name: WORKLIST
              value: "${key}"
            - name: RUN_STAMP
              value: "${args.runStamp}"
            - name: TARGET_INDEX
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
            - name: POD_UID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.uid
            - name: GEO_CAPTURE_EXECUTION
              value: "cluster"
            - name: GEO_GIT_SHA
              value: "${args.gitSha}"
            - name: CAPTURE_USER_AGENT
              value: "${DEFAULT_CAPTURE_USER_AGENT}"
            - name: NODE_OPTIONS
              value: "--dns-result-order=ipv4first"
            - name: AWS_MAX_ATTEMPTS
              value: "10"
          envFrom:
            - secretRef:
                name: geo-s3-credentials
          resources:
            requests:
              cpu: 80m
              memory: 160Mi
            limits:
              cpu: 400m
              memory: ${args.memoryLimitMi}Mi
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
`;
}

export function kubectlApplyArgs(args: Pick<Args, "kubeconfig" | "namespace">): string[] {
  return ["--kubeconfig", args.kubeconfig, "-n", args.namespace, "apply", "-f", "-"];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const worklist = parseDensityDiscoveryWorklist(JSON.parse(readFileSync(args.worklistPath, "utf8")));
  const key = densityWorklistKey(worklist.baselineSha256, worklist.lot);
  const manifest = jobManifest(args, key, worklist.lot, worklist.targets.length);
  process.stderr.write(
    `[density-orch] lot=${worklist.lot}/${worklist.lots} targets=${worklist.targets.length} `
      + `concurrency=${args.concurrency} image=${args.image}\n`
      + `[density-orch] worklist=s3://sentropic-geo/${key}\n`,
  );
  if (args.dryRun) {
    process.stderr.write("[density-orch] --dry-run: aucun PUT, aucun apply\n");
    process.stdout.write(manifest);
    return;
  }
  const canonical = `${JSON.stringify(worklist, null, 2)}\n`;
  await putBytesIfAbsent(s3Client(), key, canonical, "application/json");
  const result = spawnSync("kubectl", kubectlApplyArgs(args), {
    input: manifest,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`kubectl apply a échoué: ${(result.stderr || result.stdout || "statut inconnu").trim()}`);
  }
  process.stderr.write(result.stdout);
  process.stderr.write("[density-orch] lot soumis; aucun polling local\n");
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
