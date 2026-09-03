// §9 CPTAQ stage-1 raw — INDEPENDENT SEAL (read-only diagnostic sonde).
//
// Verifies the capture output on preprod S3, independent of k8s (the self-reporter)
// and of pv (prod-scoped creds → AccessDenied on preprod). Confirms, by construction:
//   1. the latest `capture/_runs/constraints-*/manifest.jsonl` has EXACTLY one cptaq
//      proof line (source=cptaq, storage_key = raw/cptaq/cas/<64hex>.(bin|zip));
//   2. that line's proof-v2 fields: lane=constraints, http_status 2xx, url = the
//      ratified ZA_transposee.zip, redacted=false, error=null, sha256 == sha256:<path>;
//   3. objectHead(storage_key).contentLength == the line's `bytes`;
//   4. the raw sidecar `<raw>.meta.json`: source=cptaq, storageKey == raw key,
//      sourceUrl = ZA_transposee.zip, sha256(64hex) == the path sha.
//
// Field names mirror the runner's own validators (packages/geo/src/constraints/
// cptaq-runner.ts proofFromCptaqManifest + validateCptaqRawSidecar) and the capture
// manifest schema (packages/qc-sources/src/capture/manifest.ts). Read-only: no PUT/DELETE.
//
// Run (preprod, read-only):
//   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
//   S3_BUCKET=sentropic-geo-preprod tsx acquisition/src/_cptaq-raw-verify.ts
import { s3Client, listObjectEntries, getBytes, getJson, objectHead } from "./lib/s3.js";

const BUCKET = "sentropic-geo-preprod";
const RAW_KEY_RE = /^raw\/cptaq\/cas\/([0-9a-f]{64})\.(bin|zip)$/;
const RUN_RE = /^capture\/_runs\/(constraints-[^/]+)\/manifest\.jsonl$/;
const UPSTREAM = "https://carto.cptaq.gouv.qc.ca/data/shapefiles/ZA_transposee.zip";

interface ManifestLine {
  source?: unknown;
  storage_key?: unknown;
  lane?: unknown;
  http_status?: unknown;
  url?: unknown;
  retrieved_at?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  redacted?: unknown;
  error?: unknown;
}

interface Sidecar {
  source?: unknown;
  storageKey?: unknown;
  sourceUrl?: unknown;
  sha256?: unknown;
}

async function main(): Promise<void> {
  const s3 = s3Client();

  // 1. latest constraints run manifest (lexical sort on run-stamp = chronological).
  const entries = await listObjectEntries(s3, "capture/_runs/constraints-", BUCKET);
  const manifestKeys = entries.map((e) => e.key).filter((k) => RUN_RE.test(k)).sort();
  const manifestKey = manifestKeys[manifestKeys.length - 1];
  if (!manifestKey) throw new Error("SEAL FAIL: no capture/_runs/constraints-*/manifest.jsonl on preprod");
  const runId = RUN_RE.exec(manifestKey)![1];

  // 2. the single cptaq proof line (successful: storage_key is a valid CAS key).
  const manifestText = (await getBytes(s3, manifestKey, BUCKET)).toString("utf8");
  const cptaqLines = manifestText
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ManifestLine)
    .filter((o) => o.source === "cptaq" && typeof o.storage_key === "string" && RAW_KEY_RE.test(o.storage_key));
  if (cptaqLines.length !== 1) {
    throw new Error(`SEAL FAIL: expected exactly 1 cptaq proof line in ${manifestKey}, found ${cptaqLines.length}`);
  }
  const line = cptaqLines[0]!;
  const rawKey = line.storage_key as string;
  const pathSha = RAW_KEY_RE.exec(rawKey)![1]!;

  // 3. HEAD the raw → ContentLength.
  const head = await objectHead(s3, rawKey, BUCKET);

  // 4. sidecar proof-v2.
  const sidecarKey = `${rawKey}.meta.json`;
  const sidecar = await getJson<Sidecar>(s3, sidecarKey, BUCKET);

  const checks: Array<[string, boolean]> = [
    ["manifest.source == cptaq", line.source === "cptaq"],
    ["manifest.lane == constraints", line.lane === "constraints"],
    [
      "manifest.http_status 2xx",
      typeof line.http_status === "number" && line.http_status >= 200 && line.http_status < 300,
    ],
    ["manifest.url == ZA_transposee.zip", line.url === UPSTREAM],
    ["manifest.redacted == false", line.redacted === false],
    ["manifest.error == null", line.error === null],
    ["manifest.sha256 == sha256:<path>", line.sha256 === `sha256:${pathSha}`],
    ["raw object exists", head.exists === true],
    [`raw contentLength(${head.contentLength}) == manifest.bytes(${String(line.bytes)})`, head.contentLength === line.bytes],
    ["sidecar.source == cptaq", sidecar.source === "cptaq"],
    ["sidecar.storageKey == rawKey", sidecar.storageKey === rawKey],
    ["sidecar.sourceUrl == ZA_transposee.zip", sidecar.sourceUrl === UPSTREAM],
    [`sidecar.sha256 == <path>(${pathSha})`, sidecar.sha256 === pathSha],
  ];

  const report = {
    bucket: BUCKET,
    run_id: runId,
    manifest_key: manifestKey,
    raw_cas_key: rawKey,
    content_length: head.contentLength ?? null,
    manifest_bytes: (line.bytes as number | null | undefined) ?? null,
    retrieved_at: (line.retrieved_at as string | undefined) ?? null,
    sha256: (line.sha256 as string | undefined) ?? null,
    http_status: (line.http_status as number | undefined) ?? null,
    checks: checks.map(([name, ok]) => ({ check: name, ok })),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) {
    process.stderr.write(`SEAL FAIL (${failed.length}): ${failed.join(" | ")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("SEAL OK: all stage-1 raw proof-v2 checks passed\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
