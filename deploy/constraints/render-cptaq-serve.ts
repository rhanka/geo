// §9 stage-2 committed apply-script (Q2=(a)). Reads the latest constraints capture manifest from S3
// (proof-bound), extracts the CPTAQ raw-cas-key + capture-manifest-key, renders cptaq-serve-job.yaml.
// Traced: derives BOTH keys from the committed capture's proof-bound output (never hand-typed).
// Double-verified: the cptaq-runner re-validates rawCasKey (RAW_KEY_RE + proof line + sidecar) at runtime.
// Usage: tsx deploy/constraints/render-cptaq-serve.ts | kubectl apply -f -   (S3 creds via S3_ENV_FILE; kubeconfig via env)
import { readFileSync } from "node:fs";
import { listObjectEntries, getBytes, s3Client } from "../../acquisition/src/lib/s3.js";

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
  if (!rawCasKey) throw new Error(`no cptaq proof line (source=cptaq, storage_key=raw/cptaq/cas/<sha>.zip) in ${captureManifestKey}`);
  // 3. render the committed Job template with the derived (not hand-typed) keys
  const tmpl = readFileSync(process.argv[2] ?? "deploy/constraints/cptaq-serve-job.yaml", "utf8");
  const jobName = ("cptaq-serve-" + runStamp).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const rendered = tmpl
    .replace(/cptaq-serve-REPLACE_RUNSTAMP/g, jobName)
    .replace(/raw\/cptaq\/cas\/REPLACE_RAW_SHA\.zip/g, rawCasKey)
    .replace(/capture\/_runs\/constraints-REPLACE_RUN\/manifest\.jsonl/g, captureManifestKey);
  process.stdout.write(rendered);
  process.stderr.write(`[render-cptaq-serve] run=${runStamp} raw-cas-key=${rawCasKey}\n`);
}
main().catch((e) => { process.stderr.write(String(e?.stack ?? e) + "\n"); process.exit(1); });
