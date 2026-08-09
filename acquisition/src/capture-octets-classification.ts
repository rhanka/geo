/**
 * Read-only census of the actual capture bodies referenced by all zones-* run
 * manifests. It never hashes, stamps, or writes S3 objects.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/capture-octets-classification.ts \
 *     --out=work/coverage/capture-octets-classification-<UTC>.json
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifestJsonl, type CaptureManifestLine } from "../../packages/qc-sources/src/capture/index.js";
import { classifyCapturedOctets, type CaptureOctetClass } from "./lib/capture-octets-classification.js";
import { runPvCaptureOctetsClassification } from "./lib/pv-capture-octets-run.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_PREFIX = "capture/_runs/zones-";
const BATCH_SIZE = 20;
const READ_CONCURRENCY = 3;

interface ClassifiedLine {
  manifest_key: string;
  line_index: number;
  run_id: string;
  source: string;
  slugs: string[];
  url: string;
  storage_key: string | null;
  manifest_bytes: number | null;
  content_type: string | null;
  classification: CaptureOctetClass;
  detail: string;
  coordinate_features: number | null;
}

interface Report {
  contract: "capture-octets-classification/v1";
  generated_at: string;
  complete: boolean;
  scope: { bucket: "sentropic-geo"; run_prefix: "capture/_runs/zones-*"; http_status: 200 };
  progress: { manifests: number; http_200_total: number; classified: number; batch_size: number; read_concurrency: number };
  summary: {
    GEOMETRIE: number;
    "PAGE HTML": number;
    AUTRE: number;
    partition_total: number;
    partition_matches_http_200: boolean;
    by_detail: Record<string, number>;
    by_content_type: Record<string, number>;
  };
  lines: ClassifiedLine[];
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

function writeAtomic(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
}

function isZonesManifestKey(key: string): boolean {
  return /^capture\/_runs\/zones-[^/]+\/manifest\.jsonl$/.test(key);
}

function reportFor(generatedAt: string, manifests: number, total: number, lines: ClassifiedLine[], complete: boolean): Report {
  const byDetail: Record<string, number> = {};
  const byContentType: Record<string, number> = {};
  const summary = { GEOMETRIE: 0, "PAGE HTML": 0, AUTRE: 0, partition_total: 0, partition_matches_http_200: false, by_detail: byDetail, by_content_type: byContentType };
  for (const line of lines) {
    summary[line.classification]++;
    summary.partition_total++;
    byDetail[line.detail] = (byDetail[line.detail] ?? 0) + 1;
    const contentType = line.content_type ?? "<null>";
    byContentType[contentType] = (byContentType[contentType] ?? 0) + 1;
  }
  summary.partition_matches_http_200 = summary.partition_total === total;
  return {
    contract: "capture-octets-classification/v1",
    generated_at: generatedAt,
    complete,
    scope: { bucket: "sentropic-geo", run_prefix: "capture/_runs/zones-*", http_status: 200 },
    progress: { manifests, http_200_total: total, classified: lines.length, batch_size: BATCH_SIZE, read_concurrency: READ_CONCURRENCY },
    summary,
    lines,
  };
}

function markdown(report: Report, jsonPath: string): string {
  const { summary, progress } = report;
  return [
    "# Classification des octets de capture zones",
    "",
    `Rapport: \`${relative(ROOT, jsonPath)}\` — ${report.generated_at}`,
    "",
    `- Lignes HTTP 200: ${progress.http_200_total}`,
    `- GEOMETRIE: ${summary.GEOMETRIE}`,
    `- PAGE HTML: ${summary["PAGE HTML"]}`,
    `- AUTRE: ${summary.AUTRE}`,
    `- Partition fermée: ${summary.partition_total}/${progress.http_200_total} (${summary.partition_matches_http_200 ? "oui" : "non"})`,
    "",
    "`AUTRE` est ventilé dans le JSON par contenu réellement lu; aucune extension de clé CAS n’est utilisée.",
    "",
  ].join("\n");
}

async function mapConcurrent<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker));
  return results;
}

async function classifyLine(line: CaptureManifestLine, manifestKey: string, lineIndex: number): Promise<ClassifiedLine> {
  if (line.storage_key === null) {
    return {
      manifest_key: manifestKey, line_index: lineIndex, run_id: line.run_id, source: line.source, slugs: line.slugs,
      url: line.url, storage_key: null, manifest_bytes: line.bytes, content_type: line.content_type,
      classification: "AUTRE", detail: "no-durable-captured-body", coordinate_features: null,
    };
  }
  const body = await getBytes(s3Client(), line.storage_key);
  const classification = classifyCapturedOctets(body, line.content_type);
  return {
    manifest_key: manifestKey, line_index: lineIndex, run_id: line.run_id, source: line.source, slugs: line.slugs,
    url: line.url, storage_key: line.storage_key, manifest_bytes: line.bytes, content_type: line.content_type,
    ...classification,
  };
}

function lineIdentity(manifestKey: string, lineIndex: number): string {
  return `${manifestKey}\u0000${lineIndex}`;
}

function readPartialReport(path: string): Report | null {
  if (!existsSync(path)) return null;
  const report = JSON.parse(readFileSync(path, "utf8")) as Report;
  if (
    report.contract !== "capture-octets-classification/v1" ||
    report.complete !== false ||
    report.scope?.bucket !== "sentropic-geo" ||
    report.scope?.run_prefix !== "capture/_runs/zones-*" ||
    report.scope?.http_status !== 200 ||
    !Array.isArray(report.lines)
  ) {
    throw new Error(`existing report is not a resumable partial classification: ${relative(ROOT, path)}`);
  }
  return report;
}

async function main(): Promise<void> {
  const output = option("out");
  if (!output) throw new Error("--out=work/coverage/capture-octets-classification-<UTC>.json is required");
  const outPath = insideRepo(output, "out");
  const markdownPath = outPath.endsWith(".json") ? `${outPath.slice(0, -".json".length)}.md` : `${outPath}.md`;
  if (existsSync(markdownPath)) throw new Error(`refusing to overwrite existing report: ${relative(ROOT, markdownPath)}`);
  const partial = readPartialReport(outPath);

  const s3 = s3Client();
  const manifestKeys = (await listObjectEntries(s3, RUN_PREFIX)).map((entry) => entry.key).filter(isZonesManifestKey);
  if (manifestKeys.length === 0) throw new Error(`no zones capture manifests found under ${RUN_PREFIX}`);
  console.error(`[capture-octets] manifests=${manifestKeys.length}; reading manifests`);
  const manifests = await mapConcurrent(manifestKeys, async (manifestKey) => ({
    manifestKey,
    lines: parseManifestJsonl((await getBytes(s3, manifestKey)).toString("utf8")),
  }));
  const candidates = manifests.flatMap(({ manifestKey, lines }) => lines.flatMap((line, lineIndex) => (
    line.http_status === 200 ? [{ line, manifestKey, lineIndex }] : []
  )));
  const candidateIdentities = new Set(candidates.map(({ manifestKey, lineIndex }) => lineIdentity(manifestKey, lineIndex)));
  const classified = partial?.lines ?? [];
  const completedIdentities = new Set<string>();
  for (const line of classified) {
    const identity = lineIdentity(line.manifest_key, line.line_index);
    if (!candidateIdentities.has(identity)) throw new Error(`partial report contains a non-HTTP-200 manifest line: ${identity}`);
    if (completedIdentities.has(identity)) throw new Error(`partial report repeats a manifest line: ${identity}`);
    completedIdentities.add(identity);
  }
  const pending = candidates.filter(({ manifestKey, lineIndex }) => !completedIdentities.has(lineIdentity(manifestKey, lineIndex)));
  const generatedAt = partial?.generated_at ?? new Date().toISOString();
  if (partial === null) writeAtomic(outPath, `${JSON.stringify(reportFor(generatedAt, manifestKeys.length, candidates.length, classified, false), null, 2)}\n`);
  else console.error(`[capture-octets] resuming classified=${classified.length}/${candidates.length}`);

  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE);
    const results = await mapConcurrent(batch, ({ line, manifestKey, lineIndex }) => classifyLine(line, manifestKey, lineIndex));
    classified.push(...results);
    const partial = reportFor(generatedAt, manifestKeys.length, candidates.length, classified, false);
    writeAtomic(outPath, `${JSON.stringify(partial, null, 2)}\n`);
    console.error(`[capture-octets] classified=${classified.length}/${candidates.length}`);
  }

  classified.sort((left, right) => left.manifest_key.localeCompare(right.manifest_key) || left.line_index - right.line_index);
  const finalReport = reportFor(generatedAt, manifestKeys.length, candidates.length, classified, true);
  if (!finalReport.summary.partition_matches_http_200) throw new Error("classification partition does not match HTTP 200 total");
  writeAtomic(outPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  writeAtomic(markdownPath, markdown(finalReport, outPath));
  console.log(JSON.stringify({
    report: relative(ROOT, outPath), markdown: relative(ROOT, markdownPath),
    http_200: finalReport.progress.http_200_total, geometry: finalReport.summary.GEOMETRIE,
    page_html: finalReport.summary["PAGE HTML"], autre: finalReport.summary.AUTRE,
  }, null, 2));
}

// This is a standalone report runner (it is not imported by application code).
// ESM loader-specific argv/import-meta guards can silently skip the required
// octet-opening pass, so every invocation must execute its requested lane.
const lane = option("lane") ?? "zones";
const runner = lane === "zones"
  ? main()
  : lane === "pv"
    ? runPvCaptureOctetsClassification(process.argv.slice(2))
    : Promise.reject(new Error("--lane doit être zones ou pv"));
runner.catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
