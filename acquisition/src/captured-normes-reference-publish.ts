/**
 * Publish the exact PDF-capture reference consumed by the remote Mistral job.
 *
 * The candidate must originate from an immutable HTML discovery selection. The
 * PDF body is re-verified from S3 in memory before the reference is made durable.
 */
import { pathToFileURL } from "node:url";

import {
  assertCapturedNormesReference,
  captureRunKeys,
  parseManifestJsonl,
  selectionIncludesPdfCaptureUrl,
} from "../../packages/qc-sources/src/capture/index.js";
import { loadCapturedNormesPdf } from "./capture-cas-materialize.js";
import { getBytes, putBytesIfAbsentOrEqual, s3Client } from "./lib/s3.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function requireS3RunEnvironment(): void {
  if (!(process.env["NODE_OPTIONS"] ?? "").split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

export function referenceKey(runId: string, lineIndex: number): string {
  return `registry/normes-captured-references/${runId}/${lineIndex}.json`;
}

export async function publishCapturedNormesPdfReference(args: {
  runId: string;
  lineIndex: number;
  slug: string;
  selectionKey: string;
  outputKey?: string;
}): Promise<{ key: string; bytes: number; upload: "created" | "existing-equal" }> {
  requireS3RunEnvironment();
  if (!Number.isInteger(args.lineIndex) || args.lineIndex < 0) throw new Error("--line-index must be a non-negative integer");
  const s3 = s3Client();
  const selection = JSON.parse((await getBytes(s3, args.selectionKey)).toString("utf8")) as unknown;
  const keys = captureRunKeys(args.runId);
  const header = JSON.parse((await getBytes(s3, keys.header)).toString("utf8")) as unknown;
  const lines = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
  const line = lines[args.lineIndex];
  if (!line || line.final_url === null || line.retrieved_at === null || line.sha256 === null || line.storage_key === null) {
    throw new Error("capture line is incomplete");
  }
  if (line.source !== "normes-grille-pdf") throw new Error(`unexpected PDF capture source: ${line.source}`);
  const reference = assertCapturedNormesReference({
    slug: args.slug,
    run_id: args.runId,
    manifest_key: keys.manifest,
    line_index: args.lineIndex,
    url: line.url,
    final_url: line.final_url,
    retrieved_at: line.retrieved_at,
    sha256: line.sha256,
    storage_key: line.storage_key,
    selection_key: args.selectionKey,
  }, header, line);
  if (!selectionIncludesPdfCaptureUrl(selection, args.slug, reference.url)) {
    throw new Error("captured PDF URL is not present in its immutable discovery selection");
  }
  const verified = await loadCapturedNormesPdf(reference);
  const key = args.outputKey ?? referenceKey(args.runId, args.lineIndex);
  const upload = await putBytesIfAbsentOrEqual(s3, key, `${JSON.stringify(reference, null, 2)}\n`, "application/json");
  return { key, bytes: verified.bytes.length, upload };
}

async function main(): Promise<void> {
  const result = await publishCapturedNormesPdfReference({
    runId: required("run"),
    lineIndex: Number(required("line-index")),
    slug: required("slug"),
    selectionKey: required("selection-key"),
    ...(option("output-key") ? { outputKey: option("output-key") } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
