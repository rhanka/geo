/**
 * Closed, read-only proof partition for the GeoJSON collections served by
 * geo-api. It consumes a completed object-store scan, then scans immutable
 * capture manifests in resumable batches at exactly two concurrent S3 reads.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifestJsonl, captureProofFields } from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import {
  PROOF_PARTITION_CATEGORIES,
  classifyProofPartitionCollection,
  manifestTuple,
  type ClassifiedProofCollection,
  type ProofEnvelopeSample,
  type ProofPartitionCategory,
  type ProofPartitionRowInput,
} from "./lib/served-zonage-proof-partition.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAPTURE_RUNS_PREFIX = "capture/_runs/";
const READ_CONCURRENCY = 2;
const DEFAULT_BATCH_SIZE = 25;

interface ScanRow extends ProofPartitionRowInput {
  key: string;
  layout: "flat" | "nested";
  alternatives: string[];
  proof_envelope_samples: ProofEnvelopeSample[];
}

interface ScanReport {
  contract: "served-zonage-immo-proof-url-audit/v2";
  complete: true;
  read_only_s3: true;
  selection: { slugs: string[] };
  collections: { served: number; read: number };
  rows: ScanRow[];
}

interface ManifestMatch {
  manifest_key: string;
  line_index: number;
}

interface Progress {
  contract: "served-zonage-proof-partition-progress/v1";
  scan_path: string;
  target_tuples: string[];
  manifest_keys: string[] | null;
  next_batch: number;
  matches: Record<string, ManifestMatch[]>;
  failures: Array<{ key: string; error: string }>;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function positiveIntegerOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function asScanReport(value: unknown, path: string): ScanReport {
  const candidate = value as Partial<ScanReport>;
  if (
    candidate.contract !== "served-zonage-immo-proof-url-audit/v2" ||
    candidate.complete !== true ||
    candidate.read_only_s3 !== true ||
    !Array.isArray(candidate.selection?.slugs) || candidate.selection.slugs.length !== 0 ||
    candidate.collections?.served !== 871 || candidate.collections.read !== 871 ||
    !Array.isArray(candidate.rows) || candidate.rows.length !== 871
  ) throw new Error(`completed full 871-collection scan required: ${relative(ROOT, path)}`);
  return candidate as ScanReport;
}

function statePathFor(output: string): string {
  return output.endsWith(".json") ? `${output.slice(0, -5)}.state.json` : `${output}.state.json`;
}

function markdownPathFor(output: string): string {
  return output.endsWith(".json") ? `${output.slice(0, -5)}.md` : `${output}.md`;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function readProgress(path: string, scanPath: string, targetTuples: readonly string[]): Progress | null {
  if (!existsSync(path)) return null;
  const progress = JSON.parse(readFileSync(path, "utf8")) as Partial<Progress>;
  if (
    progress.contract !== "served-zonage-proof-partition-progress/v1" ||
    progress.scan_path !== relative(ROOT, scanPath) ||
    JSON.stringify(progress.target_tuples) !== JSON.stringify(targetTuples) ||
    !Array.isArray(progress.manifest_keys) && progress.manifest_keys !== null ||
    typeof progress.next_batch !== "number" || !Number.isInteger(progress.next_batch) || progress.next_batch < 0 ||
    !progress.matches || typeof progress.matches !== "object" || !Array.isArray(progress.failures)
  ) throw new Error(`incompatible partition checkpoint: ${relative(ROOT, path)}`);
  return progress as Progress;
}

function targetTuples(rows: readonly ScanRow[]): string[] {
  const tuples = new Set<string>();
  for (const row of rows) {
    for (const sample of row.proof_envelope_samples) {
      const proof = sample.proof as { geometry_source?: { url?: unknown; retrieved_at?: unknown; sha256?: unknown } } | null;
      const source = proof?.geometry_source;
      if (typeof source?.url === "string" && typeof source.retrieved_at === "string" && typeof source.sha256 === "string") {
        tuples.add(manifestTuple(source.url, source.retrieved_at, source.sha256));
      }
    }
  }
  return [...tuples].sort();
}

function manifestKey(key: string): boolean {
  return /^capture\/_runs\/[^/]+\/manifest\.jsonl$/.test(key);
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function mapConcurrent<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker));
  return results;
}

async function scanManifests(progress: Progress, progressPath: string, maxBatches: number): Promise<boolean> {
  const s3 = s3Client();
  if (progress.manifest_keys === null) {
    progress.manifest_keys = (await listObjectEntries(s3, CAPTURE_RUNS_PREFIX)).map((entry) => entry.key).filter(manifestKey).sort();
    writeAtomic(progressPath, progress);
    console.log(`[proof-partition] ${progress.manifest_keys.length} manifests listed, state saved`);
  }
  const targets = new Set(progress.target_tuples);
  const batches = Math.ceil(progress.manifest_keys.length / DEFAULT_BATCH_SIZE);
  let scanned = 0;
  while (progress.next_batch < batches && scanned < maxBatches) {
    const batch = progress.next_batch;
    const keys = progress.manifest_keys.slice(batch * DEFAULT_BATCH_SIZE, (batch + 1) * DEFAULT_BATCH_SIZE);
    const outcomes = await mapConcurrent(keys, async (key) => {
      const lines = parseManifestJsonl((await getBytes(s3, key)).toString("utf8"));
      return lines.flatMap((line, lineIndex) => {
        try {
          const fields = captureProofFields(line);
          return targets.has(manifestTuple(fields.url, fields.retrieved_at, fields.sha256))
            ? [{ tuple: manifestTuple(fields.url, fields.retrieved_at, fields.sha256), match: { manifest_key: key, line_index: lineIndex } }]
            : [];
        } catch {
          return [];
        }
      });
    });
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === "rejected") {
        progress.failures.push({ key: keys[index]!, error: errorText(outcome.reason) });
        continue;
      }
      for (const { tuple, match } of outcome.value) {
        progress.matches[tuple] = [...(progress.matches[tuple] ?? []), match];
      }
    }
    progress.next_batch++;
    scanned++;
    writeAtomic(progressPath, progress);
    console.log(`[proof-partition] manifests batch ${batch + 1}/${batches}: ${keys.length} read, state saved`);
    if (outcomes.some((outcome) => outcome.status === "rejected")) throw new Error("manifest read failure; state saved for a safe retry");
  }
  return progress.next_batch >= batches;
}

function categoryRows(rows: readonly ClassifiedProofCollection[], category: ProofPartitionCategory): ClassifiedProofCollection[] {
  return rows.filter((row) => row.category === category).sort((left, right) => left.slug.localeCompare(right.slug));
}

function otherReasons(rows: readonly ClassifiedProofCollection[]): Array<{ reason: string; observations: number }> {
  const counts = new Map<string, number>();
  for (const observation of rows.flatMap((row) => row.observations)) {
    counts.set(observation.reason, (counts.get(observation.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, observations]) => ({ reason, observations }))
    .sort((left, right) => left.reason.localeCompare(right.reason));
}

function markdown(report: Record<string, unknown>, output: string): string {
  const partition = report.partition as Record<ProofPartitionCategory, { collections: number }>;
  const immo = report.immo as { openable_and_verifiable: number; strict_v2_exact: number };
  return [
    "# Partition des preuves servies",
    "",
    `Rapport complet : \`${relative(ROOT, output)}\`.`,
    "",
    `Partition fermée : v2 exacte ${partition.PREUVE_V2_EXACTE.collections} / URL+SHA sans capture ${partition.URL_SHA_SANS_CAPTURE.collections} / URI interne ${partition.URI_INTERNE.collections} / SHA absent ${partition.SHA_ABSENT.collections} / pas de preuve ${partition.PAS_DE_PREUVE.collections} / autre ${partition.AUTRE.collections} = 871.`,
    `Immo — ouvrir l’URL et vérifier le hash : ${immo.openable_and_verifiable} (catégories 1+2).`,
    `KPI strict « preuve v2 exacte » : ${immo.strict_v2_exact} (catégorie 1 seule).`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const scanArgument = option("scan");
  const outputArgument = option("out");
  if (!scanArgument || !outputArgument) throw new Error("--scan=<completed-scan.json> --out=<report.json> are required");
  const scanPath = insideRepo(scanArgument, "scan");
  const outputPath = insideRepo(outputArgument, "out");
  const progressPath = statePathFor(outputPath);
  const markdownPath = markdownPathFor(outputPath);
  const scan = asScanReport(JSON.parse(readFileSync(scanPath, "utf8")) as unknown, scanPath);
  const tuples = targetTuples(scan.rows);
  if (existsSync(outputPath) || existsSync(markdownPath)) throw new Error(`refusing to overwrite report: ${relative(ROOT, outputPath)}`);
  const progress = readProgress(progressPath, scanPath, tuples) ?? {
    contract: "served-zonage-proof-partition-progress/v1" as const,
    scan_path: relative(ROOT, scanPath),
    target_tuples: tuples,
    manifest_keys: null,
    next_batch: 0,
    matches: {},
    failures: [],
  };
  if (!existsSync(progressPath)) writeAtomic(progressPath, progress);
  const complete = await scanManifests(progress, progressPath, positiveIntegerOption("max-batches", Number.MAX_SAFE_INTEGER));
  if (!complete) {
    console.log(JSON.stringify({ output: progressPath, complete: false, next_manifest_batch: progress.next_batch, resume: "rerun with the same --scan and --out" }, null, 2));
    return;
  }
  if (progress.failures.length > 0) throw new Error(`manifest scan incomplete: ${progress.failures.length} failure(s)`);
  const tuplesWithCapture = new Set(Object.keys(progress.matches));
  const rows = scan.rows.map((row) => classifyProofPartitionCollection(row, tuplesWithCapture));
  const partition = Object.fromEntries(PROOF_PARTITION_CATEGORIES.map((category) => {
    const members = categoryRows(rows, category);
    return [category, {
      collections: members.length,
      slugs: members.map((member) => member.slug),
      mixed_collections: members.filter((member) => member.mixed_forms).map((member) => ({ slug: member.slug, observations: member.observations })),
      other_reasons: category === "AUTRE" ? otherReasons(members) : [],
    }];
  })) as Record<ProofPartitionCategory, { collections: number; slugs: string[]; mixed_collections: unknown[]; other_reasons: unknown[] }>;
  const total = PROOF_PARTITION_CATEGORIES.reduce((sum, category) => sum + partition[category].collections, 0);
  if (total !== scan.rows.length || total !== 871) throw new Error(`partition not closed: ${total}/${scan.rows.length}`);
  const report = {
    contract: "preuves-servies-partition/v1",
    generated_at: new Date().toISOString(),
    read_only_s3: true,
    scope: {
      served_collections: scan.rows.length,
      selection_rule: "nested_when_present_else_flat",
      source_scan: relative(ROOT, scanPath),
    },
    method: {
      weak_category_rule: "a collection with mixed proof forms receives its least strong observed category",
      v2_endpoint_alias: "proof.geometry_source.url is the v2 equivalent of proof.sources.geometry.artifact_uri",
      strict_v2_rule: "https endpoint + valid sha256 + valid retrieved_at + exact url/retrieved_at/sha256 capture-manifest tuple",
      manifest_scan: { manifests: progress.manifest_keys?.length ?? 0, read_concurrency: READ_CONCURRENCY, failures: progress.failures.length, matched_tuples: tuplesWithCapture.size },
    },
    partition,
    validation: { total, equation: PROOF_PARTITION_CATEGORIES.map((category) => partition[category].collections).join(" + ") + " = 871", closed: true },
    immo: {
      openable_and_verifiable: partition.PREUVE_V2_EXACTE.collections + partition.URL_SHA_SANS_CAPTURE.collections,
      strict_v2_exact: partition.PREUVE_V2_EXACTE.collections,
    },
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  writeFileSync(markdownPath, markdown(report, outputPath), { flag: "wx" });
  console.log(JSON.stringify({ output: relative(ROOT, outputPath), complete: true, partition: report.partition, immo: report.immo }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
