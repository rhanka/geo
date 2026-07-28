/**
 * Read-only S3 analyzer for the closed 56-city density discovery campaign.
 *
 * It re-reads completed capture manifests and their CAS bytes, applies only
 * native parsers, and checkpoints a nominative JSON+Markdown report after every
 * slug. Candidate hits remain review-required: this script cannot verify a
 * legal date, municipal ownership, zone/value/unit binding, or fold a norm.
 */
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CaptureRunHeaderSchema,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import {
  equivalentDocumentUrl,
  parseDensityDiscoveryWorklist,
  type DensityDiscoveryTarget,
} from "../../packages/qc-sources/src/sources/density-document-discovery.js";
import { reviewNativeDensityDocument, type NativeDensityReview } from "./lib/density-document-review.js";
import { exists, getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

interface Args {
  worklists: string[];
  runPrefixes: string[];
  output: string;
}

interface RunEvidence {
  runId: string;
  exitCode: number;
  manifestKey: string;
  lines: CaptureManifestLine[];
}

interface CandidateEvidence {
  url: string;
  retrievedAt: string;
  sha256: string;
  storageKey: string;
  source: string;
  kind: NativeDensityReview["kind"];
  extractor: NativeDensityReview["extractor"];
  disposition: NativeDensityReview["disposition"];
  blocker: string | null;
  hits: NativeDensityReview["hits"];
}

type RowStatus =
  | "pending_capture"
  | "candidate_review_required"
  | "no_density_signal_in_captured_documents"
  | "capture_or_native_parse_blocked";

interface ReportRow {
  slug: string;
  name: string;
  mamhCode: string;
  website: string;
  status: RowStatus;
  reason: string;
  completedRuns: number;
  attempts: number;
  httpStatuses: Record<string, number>;
  candidates: CandidateEvidence[];
  blockers: string[];
}

interface Report {
  contract: "density-document-discovery-report/v1";
  baselineKey: string;
  baselineSha256: string;
  runPrefixes: string[];
  generatedAt: string;
  scopeCount: number;
  completedCount: number;
  rows: ReportRow[];
}

function values(argv: readonly string[], name: string): string[] {
  return argv.flatMap((value, index) => value === `--${name}` && argv[index + 1] ? [argv[index + 1]!] : []);
}

function option(argv: readonly string[], name: string): string | undefined {
  return values(argv, name)[0];
}

export function parseArgs(argv: readonly string[]): Args {
  const worklists = values(argv, "worklist");
  const runPrefixes = values(argv, "run-prefix");
  if (worklists.length === 0) throw new Error("au moins un --worklist est requis");
  if (runPrefixes.length === 0) throw new Error("au moins un --run-prefix est requis");
  return {
    worklists,
    runPrefixes,
    output: option(argv, "output") ?? "work/coverage/density-document-discovery-report-20260728.json",
  };
}

function isReviewableLine(line: CaptureManifestLine): boolean {
  return (
    line.http_status === 200
    && line.sha256 !== null
    && line.storage_key !== null
    && /-document$|-sig$/.test(line.source)
  );
}

function digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function countStatuses(lines: readonly CaptureManifestLine[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const key = line.http_status === null ? "no-response" : String(line.http_status);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function markdown(report: Report): string {
  const lines = [
    "# Découverte d’un autre document portant une densité — 56 collections B’",
    "",
    `Périmètre: ${report.scopeCount}; captures terminées: ${report.completedCount}; génération: ${report.generatedAt}.`,
    "",
    "| Slug | Résultat nominatif |",
    "|---|---|",
  ];
  for (const row of report.rows) {
    const found = row.candidates.filter((candidate) => candidate.disposition === "candidate_review_required");
    const detail = found.length > 0
      ? found.map((candidate) => `${candidate.url} — capturé ${candidate.retrievedAt} — revue juridique requise`).join("<br>")
      : row.reason;
    lines.push(`| ${row.slug} | ${detail.replace(/\|/g, "\\|")} |`);
  }
  lines.push(
    "",
    "> Aucun candidat de ce rapport n’est une norme vérifiée. Le pliage reste interdit sans propriétaire, date en vigueur, zone, valeur et unité verbatim.",
    "",
  );
  return lines.join("\n");
}

function checkpoint(path: string, report: Report): void {
  const jsonTmp = `${path}.tmp`;
  const mdPath = path.replace(/\.json$/i, ".md");
  const mdTmp = `${mdPath}.tmp`;
  writeFileSync(jsonTmp, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(jsonTmp, path);
  writeFileSync(mdTmp, markdown(report));
  renameSync(mdTmp, mdPath);
}

async function completedRuns(prefixes: readonly string[]): Promise<RunEvidence[]> {
  const s3 = s3Client();
  const manifestKeys = new Set<string>();
  for (const prefix of prefixes) {
    for (const object of await listObjectEntries(s3, `capture/_runs/${prefix}`)) {
      if (object.key.endsWith("/manifest.jsonl")) manifestKeys.add(object.key);
    }
  }
  const runs: RunEvidence[] = [];
  for (const manifestKey of [...manifestKeys].sort()) {
    const runId = manifestKey.slice("capture/_runs/".length, -"/manifest.jsonl".length);
    const headerKey = `capture/_runs/${runId}/run.json`;
    // A manifest is flushed request-by-request while the final run header is
    // written only by finish(). Its absence means "still active", never absent
    // evidence and never a failed municipality.
    if (!(await exists(s3, headerKey))) continue;
    const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, headerKey)).toString("utf8")));
    if (header.finished_at === null || header.exit_code === null) continue;
    const lines = parseManifestJsonl((await getBytes(s3, manifestKey)).toString("utf8"));
    runs.push({ runId, exitCode: header.exit_code, manifestKey, lines });
  }
  return runs;
}

async function analyzeTarget(target: DensityDiscoveryTarget, runs: readonly RunEvidence[]): Promise<ReportRow> {
  const targetRuns = runs.filter((run) => run.lines.some((line) => line.slugs.includes(target.slug)));
  const lines = targetRuns.flatMap((run) => run.lines.filter((line) => line.slugs.includes(target.slug)));
  if (targetRuns.length === 0) {
    return {
      slug: target.slug,
      name: target.name,
      mamhCode: target.mamhCode,
      website: target.website,
      status: "pending_capture",
      reason: "aucun run de capture terminé pour ce slug",
      completedRuns: 0,
      attempts: 0,
      httpStatuses: {},
      candidates: [],
      blockers: [],
    };
  }

  const blockers = new Set<string>();
  for (const run of targetRuns) {
    if (run.exitCode !== 0) blockers.add(`run-failed:${run.runId}:exit-${run.exitCode}`);
  }
  for (const line of lines) {
    if (line.error) blockers.add(`${line.source}:${line.error}`);
    if (line.http_status === 403) blockers.add(`${line.source}:http-403-browser-ua`);
  }

  const candidates: CandidateEvidence[] = [];
  const seenSha = new Set<string>();
  const s3 = s3Client();
  for (const line of lines.filter(isReviewableLine)) {
    if (line.sha256 === null || line.storage_key === null || line.retrieved_at === null) continue;
    const resolvedUrl = line.final_url ?? line.url;
    if (
      (target.excludedSourceUrl !== null && equivalentDocumentUrl(resolvedUrl, target.excludedSourceUrl))
      || line.sha256 === `sha256:${target.excludedSourceSha256 ?? ""}`
      || seenSha.has(line.sha256)
    ) continue;
    seenSha.add(line.sha256);
    const bytes = await getBytes(s3, line.storage_key);
    if (digest(bytes) !== line.sha256) {
      blockers.add(`${line.storage_key}:cas-sha-mismatch`);
      continue;
    }
    const review = reviewNativeDensityDocument(bytes, resolvedUrl);
    candidates.push({
      url: resolvedUrl,
      retrievedAt: line.retrieved_at,
      sha256: line.sha256,
      storageKey: line.storage_key,
      source: line.source,
      kind: review.kind,
      extractor: review.extractor,
      disposition: review.disposition,
      blocker: review.blocker,
      hits: review.hits,
    });
    if (review.blocker) blockers.add(`${resolvedUrl}:${review.blocker}`);
  }

  const reviewRequired = candidates.filter((candidate) => candidate.disposition === "candidate_review_required");
  const blocked = targetRuns.some((run) => run.exitCode !== 0)
    || candidates.some((candidate) => candidate.disposition === "native_parse_blocked");
  let status: RowStatus;
  let reason: string;
  if (reviewRequired.length > 0) {
    status = "candidate_review_required";
    reason = `${reviewRequired.length} nouveau(x) document(s) avec passage de densité verbatim; aucune norme encore vérifiée`;
  } else if (blocked) {
    status = "capture_or_native_parse_blocked";
    reason = "recherche inconclusive: au moins une capture ou un parseur natif est bloqué";
  } else {
    status = "no_density_signal_in_captured_documents";
    reason = `aucun passage de densité trouvé par parseur natif dans ${candidates.length} nouveau(x) document(s) capturé(s)`;
  }
  return {
    slug: target.slug,
    name: target.name,
    mamhCode: target.mamhCode,
    website: target.website,
    status,
    reason,
    completedRuns: targetRuns.length,
    attempts: lines.length,
    httpStatuses: countStatuses(lines),
    candidates,
    blockers: [...blockers].sort(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const worklists = args.worklists.map((path) =>
    parseDensityDiscoveryWorklist(JSON.parse(readFileSync(path, "utf8"))));
  const baselines = new Set(worklists.map((worklist) => `${worklist.baselineKey}:${worklist.baselineSha256}`));
  if (baselines.size !== 1) throw new Error("les worklists ne partagent pas le même baseline immuable");
  const targets = worklists.flatMap((worklist) => worklist.targets)
    .sort((left, right) => left.slug.localeCompare(right.slug));
  if (new Set(targets.map((target) => target.slug)).size !== targets.length) {
    throw new Error("slug dupliqué entre worklists");
  }
  const runs = await completedRuns(args.runPrefixes);
  const first = worklists[0]!;
  const report: Report = {
    contract: "density-document-discovery-report/v1",
    baselineKey: first.baselineKey,
    baselineSha256: first.baselineSha256,
    runPrefixes: args.runPrefixes,
    generatedAt: new Date().toISOString(),
    scopeCount: targets.length,
    completedCount: 0,
    rows: [],
  };
  for (const target of targets) {
    const row = await analyzeTarget(target, runs);
    report.rows.push(row);
    report.completedCount = report.rows.filter((item) => item.status !== "pending_capture").length;
    report.generatedAt = new Date().toISOString();
    checkpoint(args.output, report);
    process.stderr.write(`[density-report] ${target.slug} ${row.status}\n`);
  }
  process.stderr.write(
    `[density-report] scope=${report.scopeCount} completed=${report.completedCount} output=${args.output}\n`,
  );
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
