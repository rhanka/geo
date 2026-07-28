/**
 * Read a durable capture run for the legal-date lane.  This command never
 * fetches a third-party URL and never changes served data: it only reads the
 * capture manifest, its CAS bytes, and their sidecars from S3.
 */
import { fileURLToPath, pathToFileURL } from "node:url";

import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";
import { extractNativeDocumentText } from "./lib/density-document-review.js";
import {
  legalDateFollowUps,
  legalDateFragments,
  legalDateTextState,
} from "./lib/legal-date-capture-review.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { getBytes, s3Client } from "./lib/s3.js";
import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";

interface ReviewedCapture {
  slug: string;
  source_url: string;
  retrieved_at: string | null;
  http_status: number | null;
  source_sha256: string | null;
  source_storage_key: string | null;
  capture_verified: boolean | null;
  capture_verification_reason: string | null;
  text_state: "native-text" | "native-text-absent" | "extractor-error" | "non-text-container" | null;
  text_blocker: string | null;
  legal_fragments: ReturnType<typeof legalDateFragments>;
  follow_up_urls: ReturnType<typeof legalDateFollowUps>;
  conclusion: "review-only-no-legal-date-inferred";
}

function value(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requireS3RunEnvironment(): void {
  const options = process.env["NODE_OPTIONS"] ?? "";
  if (!options.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

function requestedSlugs(): Set<string> {
  return new Set((value("slugs") ?? "").split(",").map((slug) => slug.trim()).filter(Boolean));
}

function relevant(line: CaptureManifestLine, wanted: ReadonlySet<string>): string[] {
  if (line.source === "robots-txt") return [];
  return wanted.size === 0 ? line.slugs : line.slugs.filter((slug) => wanted.has(slug));
}

async function reviewLine(
  line: CaptureManifestLine,
  manifestKey: string,
  lineIndex: number,
  slug: string,
): Promise<ReviewedCapture> {
  const base: ReviewedCapture = {
    slug,
    source_url: line.url,
    retrieved_at: line.retrieved_at,
    http_status: line.http_status,
    source_sha256: line.sha256,
    source_storage_key: line.storage_key,
    capture_verified: null,
    capture_verification_reason: null,
    text_state: null,
    text_blocker: null,
    legal_fragments: [],
    follow_up_urls: [],
    conclusion: "review-only-no-legal-date-inferred",
  };
  if (line.redacted) {
    return { ...base, capture_verified: false, capture_verification_reason: "redacted-capture-url" };
  }
  if (line.http_status === null || line.http_status < 200 || line.http_status >= 300) {
    return { ...base, capture_verified: false, capture_verification_reason: "non-2xx-capture" };
  }
  if (line.storage_key === null || line.sha256 === null) {
    return { ...base, capture_verified: false, capture_verification_reason: "missing-cas-bytes" };
  }

  const s3 = s3Client();
  const receipt = captureReceiptFromManifest(line, manifestKey, lineIndex);
  if (receipt === null) return { ...base, capture_verified: false, capture_verification_reason: "invalid-capture-receipt" };
  const bytes = await getBytes(s3, line.storage_key);
  const meta = JSON.parse((await getBytes(s3, `${line.storage_key}.meta.json`)).toString("utf8")) as unknown;
  const verification = verifyRawCapturePayload(receipt, bytes, meta);
  const native = extractNativeDocumentText(bytes, {
    sourceName: line.final_url ?? line.url,
  });
  const text = native.text;
  return {
    ...base,
    capture_verified: verification.verified,
    capture_verification_reason: verification.reason,
    text_state: legalDateTextState(text, native.blocker),
    text_blocker: native.blocker,
    legal_fragments: text === null ? [] : legalDateFragments(text),
    follow_up_urls: native.kind === "text" && text !== null ? legalDateFollowUps(text, line.url) : [],
  };
}

async function main(): Promise<void> {
  requireS3RunEnvironment();
  const run = value("run");
  if (!run) throw new Error("usage: --run <capture-run-id> [--slugs a,b]");
  const keys = captureRunKeys(run);
  const s3 = s3Client();
  const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, keys.header)).toString("utf8")));
  if (header.run_id !== run) throw new Error(`run header mismatch: ${header.run_id}`);
  if (header.finished_at === null || header.exit_code !== 0) {
    throw new Error(`run non probant: finished_at=${String(header.finished_at)} exit_code=${String(header.exit_code)}`);
  }
  const manifest = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
  const wanted = requestedSlugs();
  const reviewed: ReviewedCapture[] = [];
  for (const [lineIndex, line] of manifest.entries()) {
    for (const slug of relevant(line, wanted)) reviewed.push(await reviewLine(line, keys.manifest, lineIndex, slug));
  }
  process.stdout.write(`${JSON.stringify({
    contract: "legal-date-capture-review/v1",
    run_id: run,
    manifest_key: keys.manifest,
    reviewed,
  }, null, 2)}\n`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
