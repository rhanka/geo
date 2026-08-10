/**
 * Submit one remote-only captured-PDF → Mistral-schema extraction to the
 * declared cluster. This process stops after `kubectl apply`: Kubernetes owns
 * the bounded retry and the bridge writes the durable S3 receipt.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { CapturedNormesReferenceSchema } from "../../packages/qc-sources/src/capture/index.js";
import { assertDeclaredCluster, kubectlApplyArgs } from "./k8s-capture-run.js";
import { getBytes, s3Client } from "./lib/s3.js";

interface Args {
  referenceKey: string;
  kubeconfig: string;
  image: string;
  namespace: string;
  budgetUsd: number;
  dryRun: boolean;
}

export const DEFAULT_IMAGE = "rg.fr-par.scw.cloud/sentropic-geo/normes-job:captured-mistral-ba5b1b69";

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv: string[]): Args {
  const referenceKey = option(argv, "reference-key");
  const kubeconfig = option(argv, "kubeconfig");
  if (!referenceKey?.startsWith("registry/normes-captured-references/") || !referenceKey.endsWith(".json")) {
    throw new Error("--reference-key must name an immutable captured normes reference");
  }
  if (!kubeconfig) throw new Error("--kubeconfig <path> is required");
  const budgetUsd = Number(option(argv, "budget-usd") ?? "5");
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    throw new Error("--budget-usd must be a finite positive number");
  }
  return {
    referenceKey,
    kubeconfig,
    image: option(argv, "image") ?? DEFAULT_IMAGE,
    namespace: option(argv, "namespace") ?? "geo",
    budgetUsd,
    dryRun: argv.includes("--dry-run"),
  };
}

export function jobName(referenceKey: string, image: string): string {
  // A Kubernetes Job spec is immutable. Include the image identity so a fixed
  // container can be retried against the same durable reference without
  // deleting the failed Job and its diagnostic evidence. The same input pair
  // remains idempotent.
  return `geo-normes-mistral-${createHash("sha256").update(`${referenceKey}\n${image}`).digest("hex").slice(0, 20)}`;
}

export function jobManifest(args: Omit<Args, "dryRun">): string {
  const name = jobName(args.referenceKey, args.image);
  return `apiVersion: batch/v1
kind: Job
metadata:
  name: ${name}
  namespace: ${args.namespace}
  labels:
    app: geo-normes-mistral
    lane: normes
spec:
  # One expensive schema pass is enough: its immutable S3 receipt makes a
  # refusal durable and a deliberate next PDF gets a distinct reference/job.
  backoffLimit: 0
  activeDeadlineSeconds: 3600
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app: geo-normes-mistral
        lane: normes
    spec:
      restartPolicy: Never
      imagePullSecrets:
        - name: geo-registry-pull
      securityContext:
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: mistral-schema
          image: ${args.image}
          imagePullPolicy: IfNotPresent
          env:
            - name: MODE
              value: "captured"
            - name: NORMS_CAPTURE_REFERENCE_KEY
              value: "${args.referenceKey}"
            - name: NORMS_BUDGET_USD
              value: "${args.budgetUsd}"
            - name: GEO_NORMES_CAPTURED_EXECUTION
              value: "remote"
            - name: NODE_OPTIONS
              value: "--dns-result-order=ipv4first"
            - name: AWS_MAX_ATTEMPTS
              value: "10"
          envFrom:
            - secretRef:
                name: geo-s3-credentials
            - secretRef:
                name: mistral-credentials
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
`;
}

function apply(args: Args, manifest: string): void {
  assertDeclaredCluster(args);
  const result = spawnSync("kubectl", kubectlApplyArgs(args), { input: manifest, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`kubectl apply failed: ${(result.stderr || result.stdout || "unknown status").trim()}`);
  }
  process.stderr.write(result.stdout);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // The local process reads only the compact control receipt from S3; PDF bytes
  // remain in CAS and are materialised solely inside the remote pod.
  const reference = CapturedNormesReferenceSchema.parse(
    JSON.parse((await getBytes(s3Client(), args.referenceKey)).toString("utf8")),
  );
  const manifest = jobManifest(args);
  process.stderr.write(
    `[captured-normes-job] slug=${reference.slug} reference=s3://sentropic-geo/${args.referenceKey}\n` +
      `[captured-normes-job] job=${jobName(args.referenceKey, args.image)} image=${args.image}\n`,
  );
  if (args.dryRun) {
    process.stdout.write(manifest);
    return;
  }
  apply(args, manifest);
  process.stderr.write("[captured-normes-job] Job soumis; résultat et refus éventuel seront déposés sur S3. Aucun polling local.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
