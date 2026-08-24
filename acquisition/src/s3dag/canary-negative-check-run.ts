/**
 * Self-verifying NEGATIVE checks for the s3-dag canary — run as the lane SA
 * `s3dag-<lane>-sa`. Each mode EXITS 0 iff the expected refusal happened, and EXITS
 * 1 if the forbidden action SUCCEEDED (a security regression). So a green Job = the
 * proof observed on real data (what h-arch requires for the D2+A3 stamp).
 *
 * Modes (poc-k8s wires each into a test Job — pod config noted):
 *  - `no-token`         : pod = the WORKER config (automountServiceAccountToken:false).
 *                         Proof: NO default SA token is mounted → the worker has no
 *                         Kubernetes API credential at all (strongest isolation).
 *  - `cannot-create-jobs` : pod = automount ON (test-only, to obtain a token). Proof:
 *                         the SA has no `jobs:create` → POST jobs returns 403.
 *  - `cannot-create-sa` : pod = automount ON (test-only). Proof: the SA cannot invent
 *                         an identity → POST serviceaccounts returns 403.
 *
 * (The "undeclared lane" refusal and the CROSS-lane refusal are observed at apply /
 * via the VAP respectively — see the runbook; they are not this script's job.)
 */

import { existsSync, readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

const TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

function pass(msg: string): never {
  console.log(JSON.stringify({ result: "REFUSED (proof)", detail: msg }));
  process.exit(0);
}
function fail(msg: string): never {
  console.error(JSON.stringify({ result: "NOT REFUSED (SECURITY REGRESSION)", detail: msg }));
  process.exit(1);
}

interface Attempt {
  status: number;
}

function post(path: string, body: unknown): Promise<Attempt> {
  const host = process.env["KUBERNETES_SERVICE_HOST"];
  const port = Number(process.env["KUBERNETES_SERVICE_PORT_HTTPS"] ?? process.env["KUBERNETES_SERVICE_PORT"] ?? "443");
  if (!host) throw new Error("KUBERNETES_SERVICE_HOST required");
  const token = readFileSync(TOKEN_PATH, "utf8").trim();
  const ca = readFileSync(CA_PATH);
  const payload = JSON.stringify(body);
  return new Promise<Attempt>((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: host,
        port,
        path,
        method: "POST",
        ca,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main(): Promise<void> {
  const mode = process.argv[2]?.trim();
  const namespace = process.env["S3DAG_NAMESPACE"]?.trim() || "geo";

  if (mode === "no-token") {
    if (existsSync(TOKEN_PATH)) fail(`a SA token IS mounted at ${TOKEN_PATH} — automount leaked`);
    pass("no SA token mounted (automountServiceAccountToken:false) → no k8s API credential");
  }

  if (mode === "cannot-create-jobs") {
    const r = await post(`/apis/batch/v1/namespaces/${namespace}/jobs`, {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: "s3dag-neg-probe", namespace },
      spec: { template: { spec: { restartPolicy: "Never", containers: [{ name: "x", image: "busybox" }] } } },
    });
    if (r.status === 403) pass("POST jobs → 403 (SA has no jobs:create)");
    fail(`POST jobs → HTTP ${r.status} (expected 403)`);
  }

  if (mode === "cannot-create-sa") {
    const r = await post(`/api/v1/namespaces/${namespace}/serviceaccounts`, {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: "s3dag-neg-forged-sa", namespace },
    });
    if (r.status === 403) pass("POST serviceaccounts → 403 (SA cannot invent an identity)");
    fail(`POST serviceaccounts → HTTP ${r.status} (expected 403)`);
  }

  throw new Error(`unknown mode "${String(mode)}" (expected: no-token | cannot-create-jobs | cannot-create-sa)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
