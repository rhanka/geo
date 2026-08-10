/**
 * Derive a candidate-PDF selection from an already-captured municipal HTML page.
 *
 * This is deliberately S3 read-only toward source bytes: it never contacts a
 * municipal host. The resulting immutable selection is control data for the
 * next Kubernetes capture worklist, and retains the exact HTML CAS receipt that
 * justified every emitted URL.
 */
import { pathToFileURL } from "node:url";

import {
  assertCapturedNormesReference,
  captureRunKeys,
  CapturedNormesDiscoveryReceiptSchema,
  CapturedNormesDiscoveryRunReceiptSchema,
  parseManifestJsonl,
  selectNormesPdfCandidates,
  selectNormesSubpages,
  type CapturedNormesReference,
} from "../../packages/qc-sources/src/capture/index.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";
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
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

export function selectionKey(runId: string, lineIndex: number): string {
  // v4 additionally recognizes high-confidence CMS download controllers that
  // do not expose a `.pdf` suffix. Keep earlier decisions immutable: their
  // bytes document the then-current classifier, while a rerun publishes an
  // independently auditable corrected selection.
  return `registry/normes-captured-discovery/v4/${runId}/${lineIndex}.json`;
}

export function discoveryReceiptKey(runId: string, lineIndex: number): string {
  return `registry/normes-captured-discovery-receipts/v4/${runId}/${lineIndex}.json`;
}

export function discoveryRunReceiptKey(runId: string, slug: string): string {
  return `registry/normes-captured-discovery-run-receipts/v4/${runId}/${slug}.json`;
}

export function subpageSelectionKey(runId: string, lineIndex: number): string {
  // v2 selection keys supersede the initial media-extension gap without ever
  // mutating the immutable v1 control object already published in S3.
  return `registry/normes-captured-subpages/v2/${runId}/${lineIndex}.json`;
}

export async function discoverCapturedNormesPage(args: {
  runId: string;
  lineIndex: number;
  slug: string;
  outputKey?: string;
}): Promise<{
  key: string;
  receipt_key: string;
  subpage_selection_key: string;
  reference: CapturedNormesReference;
  candidates: number;
  pdf_candidates: Array<{ slug: string; pdf_url: string; titre: string; score_classif: number; matched: string[] }>;
  subpages: number;
  subpage_candidates: Array<{ url: string; anchor: string }>;
  upload: "created" | "existing-equal";
}> {
  requireS3RunEnvironment();
  if (!Number.isInteger(args.lineIndex) || args.lineIndex < 0) throw new Error("--line-index must be a non-negative integer");
  const s3 = s3Client();
  const keys = captureRunKeys(args.runId);
  const header = JSON.parse((await getBytes(s3, keys.header)).toString("utf8")) as unknown;
  const lines = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
  const line = lines[args.lineIndex];
  if (!line) throw new Error(`manifest line ${args.lineIndex} does not exist`);
  if (line.final_url === null || line.retrieved_at === null || line.sha256 === null || line.storage_key === null) {
    throw new Error("capture line is incomplete");
  }
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
    selection_key: null,
  }, header, line);
  if (!/\btext\/html\b/i.test(line.content_type ?? "")) {
    throw new Error(`captured discovery body must be text/html, got ${String(line.content_type)}`);
  }
  const captureReceipt = captureReceiptFromManifest(line, keys.manifest, args.lineIndex);
  if (captureReceipt === null) throw new Error("invalid capture receipt");
  const bytes = await getBytes(s3, line.storage_key);
  const sidecar = JSON.parse((await getBytes(s3, `${line.storage_key}.meta.json`)).toString("utf8")) as unknown;
  const verification = verifyRawCapturePayload(captureReceipt, bytes, sidecar);
  if (!verification.verified) throw new Error(`CAS non vérifié: ${verification.reason}`);

  const selection = selectNormesPdfCandidates(bytes.toString("utf8"), reference);
  const key = args.outputKey ?? selectionKey(args.runId, args.lineIndex);
  const upload = await putBytesIfAbsentOrEqual(s3, key, `${JSON.stringify(selection, null, 2)}\n`, "application/json");
  const subpageSelection = selectNormesSubpages(bytes.toString("utf8"), reference);
  const subpageKey = subpageSelectionKey(args.runId, args.lineIndex);
  await putBytesIfAbsentOrEqual(s3, subpageKey, `${JSON.stringify(subpageSelection, null, 2)}\n`, "application/json");
  const receipt = CapturedNormesDiscoveryReceiptSchema.parse({
    contract: "captured-normes-discovery-receipt/v1",
    generated_at: reference.retrieved_at,
    capture: reference,
    selection_key: key,
    candidate_count: selection.candidates.length,
    status: selection.candidates.length > 0 ? "candidates" : "refused",
    refusal: selection.candidates.length > 0 ? null : "no classified grille PDF candidate in captured HTML",
  });
  const receiptKey = discoveryReceiptKey(args.runId, args.lineIndex);
  await putBytesIfAbsentOrEqual(s3, receiptKey, `${JSON.stringify(receipt, null, 2)}\n`, "application/json");
  return {
    key,
    receipt_key: receiptKey,
    subpage_selection_key: subpageKey,
    reference,
    candidates: selection.candidates.length,
    pdf_candidates: selection.candidates.map((candidate) => ({ ...candidate, matched: [...candidate.matched] })),
    subpages: subpageSelection.subpages.length,
    subpage_candidates: subpageSelection.subpages,
    upload,
  };
}

async function main(): Promise<void> {
  const runId = required("run");
  const slug = required("slug");
  if (process.argv.includes("--all")) {
    requireS3RunEnvironment();
    const s3 = s3Client();
    const keys = captureRunKeys(runId);
    const header = JSON.parse((await getBytes(s3, keys.header)).toString("utf8")) as { finished_at?: unknown };
    if (typeof header.finished_at !== "string") throw new Error("capture run is not terminal");
    const lines = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
    const results = [];
    for (const [lineIndex, line] of lines.entries()) {
      if (line.source !== "normes-grille-discovery" || !line.slugs.includes(slug) || line.http_status !== 200) continue;
      if (!/\btext\/html\b/i.test(line.content_type ?? "")) continue;
      results.push(await discoverCapturedNormesPage({ runId, lineIndex, slug }));
    }
    const attempts = lines
      .map((line, lineIndex) => ({ line, lineIndex }))
      .filter(({ line }) => line.slugs.includes(slug))
      .map(({ line, lineIndex }) => ({
        line_index: lineIndex,
        url: line.url,
        final_url: line.final_url,
        http_status: line.http_status,
        content_type: line.content_type,
        storage_key: line.storage_key,
        sha256: line.sha256,
        error: line.error,
      }));
    const candidateCount = results.reduce((total, result) => total + result.candidates, 0);
    const runReceipt = CapturedNormesDiscoveryRunReceiptSchema.parse({
      contract: "captured-normes-discovery-run-receipt/v1",
      generated_at: header.finished_at,
      run_id: runId,
      manifest_key: keys.manifest,
      slug,
      attempts,
      page_receipt_keys: results.map((result) => result.receipt_key),
      candidate_count: candidateCount,
      status: candidateCount > 0 ? "candidates" : "refused",
      refusal: candidateCount > 0
        ? null
        : attempts.length === 0
          ? "no capture attempt for slug in this run"
          : results.length === 0
            ? "no successful text/html capture eligible for discovery"
            : "no classified grille PDF candidate in eligible captured HTML",
    });
    const runReceiptKey = discoveryRunReceiptKey(runId, slug);
    const upload = await putBytesIfAbsentOrEqual(s3, runReceiptKey, `${JSON.stringify(runReceipt, null, 2)}\n`, "application/json");
    process.stdout.write(`${JSON.stringify({ run_id: runId, slug, results, run_receipt_key: runReceiptKey, upload }, null, 2)}\n`);
    return;
  }
  const result = await discoverCapturedNormesPage({
    runId,
    lineIndex: Number(required("line-index")),
    slug,
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
