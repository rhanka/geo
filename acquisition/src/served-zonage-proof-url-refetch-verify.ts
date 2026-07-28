/**
 * Re-hash two or more public URL refetches captured by the cluster and prove
 * that each body still equals the SHA-256 written by the restamp plan.
 *
 * This runner never writes served data.  It reads the cluster's immutable
 * manifest and CAS object, where `verifyRawCapturePayload` re-hashes the
 * refetched bytes.  The plan is only the authority for the SHA already
 * written; a refetch digest can never become a stamping source.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/served-zonage-proof-url-refetch-verify.ts \
 *     --plan=work/coverage/served-zonage-proof-url-restamp-ready-<UTC>.json \
 *     --run-prefix=zones-<UTC> \
 *     --out=work/coverage/served-zonage-proof-url-refetch-verify-<UTC>.json
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifestJsonl } from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { captureReceiptFromManifest, type CaptureReceipt } from "./lib/zone-provenance-quality.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Attestation {
  replacementUrl: string;
  sha256: `sha256:${string}`;
}

interface PlannedRow {
  slug: string;
  attestations: Attestation[];
}

interface Plan {
  contract: "served-zonage-proof-url-restamp-plan/v3";
  complete: boolean;
  ready: PlannedRow[];
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readPlan(path: string): Plan {
  const value = JSON.parse(readFileSync(path, "utf8")) as Plan;
  if (
    value.contract !== "served-zonage-proof-url-restamp-plan/v3" ||
    value.complete !== true ||
    !Array.isArray(value.ready) ||
    !value.ready.every((row) =>
      typeof row?.slug === "string" &&
      Array.isArray(row.attestations) &&
      row.attestations.every((attestation) =>
        typeof attestation?.replacementUrl === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(attestation.sha256),
      ),
    )
  ) throw new Error(`plan incomplete or incompatible: ${relative(ROOT, path)}`);
  return value;
}

function receiptIdentity(receipt: CaptureReceipt): string {
  return JSON.stringify([receipt.storage_key, receipt.url, receipt.sha256]);
}

async function main(): Promise<void> {
  const planArgument = option("plan");
  const runPrefix = option("run-prefix");
  const outputArgument = option("out");
  if (!planArgument || !runPrefix || !outputArgument) {
    throw new Error("--plan=<complete-restamp-plan> --run-prefix=<zones-run> --out=<report.json> are required");
  }
  if (!/^zones-[A-Za-z0-9-]+$/.test(runPrefix)) throw new Error("--run-prefix must name one zones capture run");
  const planPath = insideRepo(planArgument, "plan");
  const outputPath = insideRepo(outputArgument, "out");
  if (existsSync(outputPath)) throw new Error(`refusing to overwrite existing report: ${relative(ROOT, outputPath)}`);
  const plan = readPlan(planPath);
  if (plan.ready.length === 0) throw new Error("plan has no restamped collection to verify");

  const s3 = s3Client();
  const manifestKeys = (await listObjectEntries(s3, `capture/_runs/${runPrefix}`))
    .map((entry) => entry.key)
    .filter((key) => new RegExp(`^capture/_runs/${runPrefix}-[^/]+/manifest\\.jsonl$`).test(key))
    .sort();
  if (manifestKeys.length === 0) throw new Error(`no manifests found for ${runPrefix}`);
  const manifestLines = (await Promise.all(manifestKeys.map(async (manifestKey) => ({
    manifestKey,
    lines: parseManifestJsonl((await getBytes(s3, manifestKey)).toString("utf8")),
  })))).flatMap(({ manifestKey, lines }) => lines.map((line, lineIndex) => ({ manifestKey, line, lineIndex })));

  const observations = [];
  for (const row of plan.ready) {
    for (const attestation of row.attestations) {
      const matches = manifestLines.flatMap(({ manifestKey, line, lineIndex }) => {
        if (line.http_status !== 200 || !line.slugs.includes(row.slug) || line.url !== attestation.replacementUrl) return [];
        const receipt = captureReceiptFromManifest(line, manifestKey, lineIndex);
        return receipt === null ? [] : [receipt];
      });
      const identities = new Set(matches.map(receiptIdentity));
      if (identities.size !== 1) {
        throw new Error(`refetch receipt is missing or ambiguous for ${row.slug}: ${attestation.replacementUrl}`);
      }
      const receipt = matches.sort((left, right) => left.retrieved_at.localeCompare(right.retrieved_at))[0]!;
      const [bytes, sidecarBytes] = await Promise.all([
        getBytes(s3, receipt.storage_key),
        getBytes(s3, `${receipt.storage_key}.meta.json`),
      ]);
      const checked = verifyRawCapturePayload(receipt, bytes, JSON.parse(sidecarBytes.toString("utf8")) as unknown);
      if (!checked.verified) throw new Error(`refetch CAS re-hash failed for ${row.slug}: ${checked.reason}`);
      if (receipt.sha256 !== attestation.sha256) {
        throw new Error(`refetched SHA differs from written proof for ${row.slug}: ${receipt.sha256} !== ${attestation.sha256}`);
      }
      observations.push({
        slug: row.slug,
        url: attestation.replacementUrl,
        written_sha256: attestation.sha256,
        refetched_sha256: receipt.sha256,
        refetched_at: receipt.retrieved_at,
        manifest_key: receipt.manifest_key,
        line_index: receipt.line_index,
        storage_key: receipt.storage_key,
        rehash_matches_written_proof: true,
      });
    }
  }

  const report = {
    contract: "served-zonage-proof-url-refetch-verify/v1",
    generated_at: new Date().toISOString(),
    complete: true,
    plan: relative(ROOT, planPath),
    plan_sha256: sha256(readFileSync(planPath)),
    run_prefix: runPrefix,
    manifests_scanned: manifestKeys.length,
    verified: observations.length,
    observations,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ output: relative(ROOT, outputPath), verified: observations.length, complete: true }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
