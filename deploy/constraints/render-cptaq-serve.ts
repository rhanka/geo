// §9 stage-2 apply-script. Reads the latest constraints capture manifest from S3
// (proof-bound), extracts the CPTAQ raw-cas-key + capture-manifest-key, then renders the
// committed Job via the PURE, CI-tested lib (acquisition/src/lib/cptaq-serve-render).
// The render (jobName ≤63, label bounds, placeholder substitution) is unit-tested there —
// so `merged` implies `deployable`. Traced: BOTH keys derive from the committed capture's
// proof-bound output (never hand-typed); the cptaq-runner re-validates rawCasKey at runtime.
// Usage: tsx deploy/constraints/render-cptaq-serve.ts | kubectl apply -f -   (S3 creds via S3_ENV_FILE; kubeconfig via env)
import { readFileSync } from "node:fs";
import { listObjectEntries, getBytes, s3Client } from "../../acquisition/src/lib/s3.js";
import { renderCptaqServeJob } from "../../acquisition/src/lib/cptaq-serve-render.js";

const RAW_KEY_RE = /^raw\/cptaq\/cas\/[0-9a-f]{64}\.(bin|zip)$/;      // == cptaq-runner RAW_KEY_RE
const RUN_RE = /^capture\/_runs\/(constraints-[^/]+)\/manifest\.jsonl$/;

async function main(): Promise<void> {
  const s3 = s3Client();
  // 1. latest constraints run manifest (lexical sort on run-stamp = chronological)
  const entries = await listObjectEntries(s3, "capture/_runs/constraints-");
  const manifestKeys = entries.map((e: any) => e.key as string).filter((k) => RUN_RE.test(k)).sort();
  const captureManifestKey = manifestKeys[manifestKeys.length - 1];
  if (!captureManifestKey) throw new Error("no capture/_runs/constraints-*/manifest.jsonl found");
  const runStamp = RUN_RE.exec(captureManifestKey)![1];
  // 2. read the manifest → the single cptaq proof line → its storage_key = raw-cas-key
  const manifest = new TextDecoder().decode(await getBytes(s3, captureManifestKey));
  let rawCasKey = "";
  for (const line of manifest.split("\n")) {
    if (!line.trim()) continue;
    const o: any = JSON.parse(line);
    if (o.source === "cptaq" && typeof o.storage_key === "string" && RAW_KEY_RE.test(o.storage_key)) {
      rawCasKey = o.storage_key; break;
    }
  }
  if (!rawCasKey) throw new Error(`no cptaq proof line (source=cptaq, storage_key=raw/cptaq/cas/<sha>.(bin|zip)) in ${captureManifestKey}`);
  // 3. render the committed Job template via the CI-tested pure lib (name/label ≤63 by construction)
  const tmpl = readFileSync(process.argv[2] ?? "deploy/constraints/cptaq-serve-job.yaml", "utf8");
  process.stdout.write(renderCptaqServeJob(tmpl, { runStamp, rawCasKey, captureManifestKey }));
  process.stderr.write(`[render-cptaq-serve] run=${runStamp} raw-cas-key=${rawCasKey}\n`);
}
main().catch((e) => { process.stderr.write(String(e?.stack ?? e) + "\n"); process.exit(1); });
