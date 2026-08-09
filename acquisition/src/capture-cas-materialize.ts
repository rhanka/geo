/**
 * Materialise one already-captured third-party response from the durable CAS.
 *
 * This command never fetches the source URL. It accepts only a completed,
 * successful capture run, verifies the manifest receipt and CAS sidecar, then
 * writes the exact bytes to an explicit local path for native/vision tooling.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/capture-cas-materialize.ts \
 *     --run <capture-run-id> --url <exact-source-url> --output /tmp/source.pdf
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
} from "../../packages/qc-sources/src/capture/index.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { getBytes, s3Client } from "./lib/s3.js";

function value(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requireS3RunEnvironment(): void {
  const options = process.env["NODE_OPTIONS"] ?? "";
  if (!options.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

async function main(): Promise<void> {
  requireS3RunEnvironment();
  const run = value("run");
  const url = value("url");
  const output = value("output");
  if (!run || !url || !output) {
    throw new Error("usage: --run <capture-run-id> --url <exact-source-url> --output <local-path>");
  }

  const s3 = s3Client();
  const keys = captureRunKeys(run);
  const header = CaptureRunHeaderSchema.parse(
    JSON.parse((await getBytes(s3, keys.header)).toString("utf8")),
  );
  if (header.run_id !== run || header.finished_at === null || header.exit_code !== 0) {
    throw new Error(
      `run non probant: id=${header.run_id} finished_at=${String(header.finished_at)} `
      + `exit_code=${String(header.exit_code)}`,
    );
  }

  const manifest = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
  const directMatches = manifest
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.url === url);
  // A Wayback response may redirect its `final_url` to the live URL and would
  // otherwise make one exact live capture look ambiguous. Prefer the requested
  // manifest URL; accept `final_url` only when no direct line exists.
  const matches = directMatches.length > 0
    ? directMatches
    : manifest
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.final_url === url);
  if (matches.length !== 1) {
    throw new Error(`capture exacte attendue une fois, trouvée ${matches.length}: ${url}`);
  }
  const { line, index } = matches[0]!;
  if (
    line.redacted
    || line.http_status === null
    || line.http_status < 200
    || line.http_status >= 300
    || line.storage_key === null
    || line.sha256 === null
  ) {
    throw new Error(
      `capture non matérialisable: status=${String(line.http_status)} `
      + `storage=${String(line.storage_key)} sha=${String(line.sha256)}`,
    );
  }

  const receipt = captureReceiptFromManifest(line, keys.manifest, index);
  if (receipt === null) throw new Error("reçu de capture invalide");
  const bytes = await getBytes(s3, line.storage_key);
  const sidecar = JSON.parse(
    (await getBytes(s3, `${line.storage_key}.meta.json`)).toString("utf8"),
  ) as unknown;
  const verification = verifyRawCapturePayload(receipt, bytes, sidecar);
  if (!verification.verified) {
    throw new Error(`CAS non vérifié: ${verification.reason}`);
  }

  writeFileSync(output, bytes, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    contract: "capture-cas-materialize/v1",
    run_id: run,
    manifest_key: keys.manifest,
    manifest_line: index,
    source_url: line.url,
    final_url: line.final_url,
    retrieved_at: line.retrieved_at,
    http_status: line.http_status,
    source_sha256: line.sha256,
    source_storage_key: line.storage_key,
    bytes: bytes.length,
    output,
  }, null, 2)}\n`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
