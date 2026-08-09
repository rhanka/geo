/**
 * Publie une worklist de plages Wayback et soumet un Job Indexed court.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  parseCategoryAWaybackRangeWorklist,
} from "./lib/category-a-wayback-range.js";
import { DEFAULT_CAPTURE_USER_AGENT } from "./lib/capture-s3.js";
import { putBytesIfAbsentOrEqual, s3Client } from "./lib/s3.js";

const DEFAULT_IMAGE =
  "rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.5-category-a-range";

function value(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function required(argv: readonly string[], name: string): string {
  const result = value(argv, name);
  if (!result) throw new Error(`--${name} est requis`);
  return result;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const worklistPath = required(argv, "worklist");
  const kubeconfig = required(argv, "kubeconfig");
  const namespace = value(argv, "namespace") ?? "geo";
  const image = value(argv, "image") ?? DEFAULT_IMAGE;
  const gitSha = required(argv, "git-sha");
  if (!/^[a-f0-9]{40}$/.test(gitSha)) throw new Error("--git-sha doit être un SHA complet");
  const runStamp = required(argv, "run-stamp");
  if (!/^\d{8}T\d{6}Z$/.test(runStamp)) throw new Error("--run-stamp invalide");
  const concurrency = Number(value(argv, "concurrency") ?? "2");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new Error("--concurrency doit être 1 ou 2");
  }
  const worklist = parseCategoryAWaybackRangeWorklist(
    JSON.parse(readFileSync(worklistPath, "utf8")),
  );
  const key = `registry/capture-worklists/normes-category-a-wayback-range-${runStamp}.json`;
  const name = `geo-category-a-wayback-range-${runStamp.toLowerCase()}`;
  const manifest = `apiVersion: batch/v1
kind: Job
metadata:
  name: ${name}
  namespace: ${namespace}
  labels:
    app: geo-category-a-wayback-range
    lane: normes
    geo.run-stamp: "${runStamp}"
spec:
  completionMode: Indexed
  completions: ${worklist.targets.length}
  parallelism: ${Math.min(concurrency, worklist.targets.length)}
  backoffLimitPerIndex: 1
  maxFailedIndexes: ${worklist.targets.length}
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app: geo-category-a-wayback-range
        lane: normes
        geo.run-stamp: "${runStamp}"
    spec:
      restartPolicy: Never
      imagePullSecrets:
        - name: geo-registry-pull
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: range
          image: ${image}
          imagePullPolicy: IfNotPresent
          command: ["tsx", "src/category-a-wayback-range-run.ts"]
          env:
            - name: WORKLIST
              value: "${key}"
            - name: RUN_STAMP
              value: "${runStamp}"
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
              value: "${gitSha}"
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
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
`;
  await putBytesIfAbsentOrEqual(
    s3Client(),
    key,
    `${JSON.stringify(worklist, null, 2)}\n`,
    "application/json",
  );
  const result = spawnSync(
    "kubectl",
    ["--kubeconfig", kubeconfig, "-n", namespace, "apply", "-f", "-"],
    { input: manifest, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`kubectl apply: ${(result.stderr || result.stdout).trim()}`);
  }
  process.stderr.write(result.stdout);
  process.stderr.write(
    `[category-a-wayback-range] ${worklist.targets.length} snapshot(s), aucun polling local\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
