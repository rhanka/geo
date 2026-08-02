/**
 * Build a closed, slug-deduplicated inventory of locally committed zonage
 * proof-URL candidates. This script deliberately reads the blobs at HEAD,
 * rather than working-tree copies: an uncommitted capture or report must not
 * become evidence by accident.
 *
 * Usage:
 *   npx --no-install tsx acquisition/src/zones-live-url-candidate-inventory.ts
 *
 * No HTTP or S3 access is performed. Outputs are new, timestamped files under
 * work/coverage/ and are never overwritten.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COVERAGE_ROOT = "work/coverage";
const CONTRACT = "zones-live-url-candidate-inventory/v1" as const;
const UNMEASURED_DISTINCT_PATH =
  "work/coverage/zonage-proof-url-candidates-unmeasured-distinct-20260728T113754Z.json";
const BPRIME_PATH = "work/coverage/zone-v2-bprime-wave4-20260726-candidates.json";
const QUALITY_MATRIX_PATH =
  "work/coverage/zone-provenance-quality-matrix-20260726T130555Z-8c02991472f0e3a0.json";
const CANDIDATE_PATH = /^work\/coverage\/zonage-proof-url-candidates-.*\.json$/u;
const SURVIVAL_PATH = /^work\/coverage\/served-zonage-proof-url-survival.*\.json$/u;
const LIVENESS_STATUSES = ["LIVE", "DEAD", "UNKNOWN"] as const;
const QUALITY_STATUSES = ["v2", "acceptable", "candidate", "orphan", "unknown"] as const;

type LivenessStatus = (typeof LIVENESS_STATUSES)[number];
type QualityStatus = (typeof QUALITY_STATUSES)[number];

interface InputRecord {
  readonly kind: "candidate" | "bprime" | "quality_matrix" | "survival";
  readonly path: string;
  readonly committed: true;
  readonly sha256: string;
}

interface MissingInput {
  readonly kind: "candidate" | "bprime" | "quality_matrix";
  readonly path: string;
  readonly reason: "absent_from_HEAD";
}

interface SourceReference {
  readonly path: string;
  readonly source: string | null;
}

interface LivenessEvidence {
  readonly source: string;
  readonly evidence: string;
  readonly candidate_url: string;
  readonly served_url: string;
  readonly classification: "GEOMETRIE" | "PAGE HTML" | "404" | "AUTRE";
  readonly detail: string;
}

interface InventoryEntry {
  readonly slug: string;
  readonly sources: readonly SourceReference[];
  readonly urls: readonly string[];
  readonly liveness_status: LivenessStatus;
  readonly liveness_evidence: readonly LivenessEvidence[];
  readonly measured_quality: QualityStatus | null;
}

interface InputBlob {
  readonly value: unknown;
  readonly sha256: string;
}

interface MutableEntry {
  readonly sources: Map<string, SourceReference>;
  readonly urls: Set<string>;
  readonly livenessEvidence: LivenessEvidence[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: object required`);
  return value;
}

function array(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where}: array required`);
  return value;
}

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where}: non-empty string required`);
  return value;
}

function slug(value: unknown, where: string): string {
  const result = nonEmptyString(value, where);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(result)) throw new Error(`${where}: invalid slug`);
  return result;
}

function urls(value: unknown, where: string): readonly string[] {
  return array(value, where).map((url, index) => nonEmptyString(url, `${where}[${index}]`));
}

function optionalSource(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  return nonEmptyString(value, where);
}

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function committedCoveragePaths(): Set<string> {
  return new Set(
    git(["ls-tree", "-r", "--name-only", "HEAD", "--", COVERAGE_ROOT])
      .split("\n")
      .map((path) => path.trim())
      .filter((path) => path.length > 0),
  );
}

function readCommittedJson(path: string, committedPaths: ReadonlySet<string>): InputBlob {
  if (!path.startsWith(`${COVERAGE_ROOT}/`)) throw new Error(`input outside ${COVERAGE_ROOT}: ${path}`);
  if (!committedPaths.has(path)) throw new Error(`input is not committed at HEAD: ${path}`);
  const text = git(["show", `HEAD:${path}`]);
  return {
    value: JSON.parse(text) as unknown,
    sha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
  };
}

function addCandidate(
  entries: Map<string, MutableEntry>,
  slugValue: string,
  source: SourceReference,
  candidateUrls: readonly string[],
): void {
  if (candidateUrls.length === 0) return;
  const entry = entries.get(slugValue) ?? {
    sources: new Map<string, SourceReference>(),
    urls: new Set<string>(),
    livenessEvidence: [],
  };
  entry.sources.set(`${source.path}\u0000${source.source ?? ""}`, source);
  for (const candidateUrl of candidateUrls) entry.urls.add(candidateUrl);
  entries.set(slugValue, entry);
}

function readCandidateRows(
  path: string,
  blob: InputBlob,
  entries: Map<string, MutableEntry>,
): void {
  for (const [index, value] of array(blob.value, path).entries()) {
    const row = record(value, `${path}[${index}]`);
    addCandidate(entries, slug(row.slug, `${path}[${index}].slug`), {
      path,
      source: nonEmptyString(row.source, `${path}[${index}].source`),
    }, urls(row.urls, `${path}[${index}].urls`));
  }
}

function readBprimeRows(blob: InputBlob, entries: Map<string, MutableEntry>): void {
  const report = record(blob.value, BPRIME_PATH);
  for (const [index, value] of array(report.rows, `${BPRIME_PATH}.rows`).entries()) {
    const row = record(value, `${BPRIME_PATH}.rows[${index}]`);
    addCandidate(entries, slug(row.slug, `${BPRIME_PATH}.rows[${index}].slug`), {
      path: BPRIME_PATH,
      source: optionalSource(row.source, `${BPRIME_PATH}.rows[${index}].source`),
    }, urls(row.http_source_urls, `${BPRIME_PATH}.rows[${index}].http_source_urls`));
  }
}

function qualityStatus(value: unknown, where: string): QualityStatus {
  const result = nonEmptyString(value, where);
  if (!(QUALITY_STATUSES as readonly string[]).includes(result)) throw new Error(`${where}: unsupported quality status ${result}`);
  return result as QualityStatus;
}

function readQualityMatrix(blob: InputBlob): Map<string, QualityStatus> {
  const report = record(blob.value, QUALITY_MATRIX_PATH);
  const qualities = new Map<string, QualityStatus>();
  for (const [index, value] of array(report.rows, `${QUALITY_MATRIX_PATH}.rows`).entries()) {
    const row = record(value, `${QUALITY_MATRIX_PATH}.rows[${index}]`);
    const citySlug = slug(row.city_slug, `${QUALITY_MATRIX_PATH}.rows[${index}].city_slug`);
    const status = qualityStatus(row.quality_status, `${QUALITY_MATRIX_PATH}.rows[${index}].quality_status`);
    const prior = qualities.get(citySlug);
    if (prior !== undefined && prior !== status) {
      throw new Error(`${QUALITY_MATRIX_PATH}: conflicting quality statuses for ${citySlug}`);
    }
    qualities.set(citySlug, status);
  }
  return qualities;
}

function classification(value: unknown, where: string): LivenessEvidence["classification"] {
  const result = nonEmptyString(value, where);
  if (result === "GEOMETRIE" || result === "PAGE HTML" || result === "404" || result === "AUTRE") return result;
  throw new Error(`${where}: unsupported survival classification ${result}`);
}

function readSurvivalRows(path: string, blob: InputBlob, entries: Map<string, MutableEntry>): void {
  const report = record(blob.value, path);
  if (report.contract !== "served-zonage-proof-url-survival/v1") {
    throw new Error(`${path}: incompatible survival contract`);
  }
  for (const [index, value] of array(report.rows, `${path}.rows`).entries()) {
    const row = record(value, `${path}.rows[${index}]`);
    const slugValue = slug(row.slug, `${path}.rows[${index}].slug`);
    const entry = entries.get(slugValue);
    if (entry === undefined) continue;
    entry.livenessEvidence.push({
      source: path,
      evidence: nonEmptyString(row.evidence, `${path}.rows[${index}].evidence`),
      candidate_url: nonEmptyString(row.candidate_url, `${path}.rows[${index}].candidate_url`),
      served_url: nonEmptyString(row.served_url, `${path}.rows[${index}].served_url`),
      classification: classification(row.classification, `${path}.rows[${index}].classification`),
      detail: nonEmptyString(row.detail, `${path}.rows[${index}].detail`),
    });
  }
}

function livenessStatus(evidence: readonly LivenessEvidence[]): LivenessStatus {
  const observed = new Set(evidence.map((item) => item.classification === "GEOMETRIE" ? "LIVE" : "DEAD"));
  if (observed.size === 0) return "UNKNOWN";
  if (observed.size === 1) return [...observed][0] as LivenessStatus;
  return "UNKNOWN";
}

function sortEvidence(evidence: readonly LivenessEvidence[]): readonly LivenessEvidence[] {
  return [...evidence].sort((left, right) => {
    const leftKey = `${left.source}\u0000${left.evidence}\u0000${left.candidate_url}`;
    const rightKey = `${right.source}\u0000${right.evidence}\u0000${right.candidate_url}`;
    return leftKey.localeCompare(rightKey);
  });
}

function compactUtcStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
}

function countBy<T extends string>(values: readonly T[], categories: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(categories.map((category) => [category, 0])) as Record<T, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

function assertClosedPartition(name: string, total: number, counts: Readonly<Record<string, number>>): void {
  const sum = Object.values(counts).reduce((partial, count) => partial + count, 0);
  if (sum !== total) throw new Error(`${name}: ${sum} does not equal ${total}`);
}

function markdown(
  jsonPath: string,
  total: number,
  liveness: Readonly<Record<LivenessStatus, number>>,
  quality: Readonly<Record<QualityStatus | "null", number>>,
  missingInputs: readonly MissingInput[],
): string {
  const missing = missingInputs.length === 0
    ? "Aucune entrée explicitement demandée n'est absente de HEAD."
    : `Entrées explicitement absentes de HEAD : ${missingInputs.map((input) => `\`${input.path}\``).join(", ")}.`;
  return [
    "# Inventaire des candidats URL de preuve zonage",
    "",
    `Rapport : \`${jsonPath}\``,
    "",
    `${total} slugs distincts avec au moins une URL de preuve.`,
    `Liveness (partition fermée) : LIVE ${liveness.LIVE} / DEAD ${liveness.DEAD} / UNKNOWN ${liveness.UNKNOWN} = ${total}.`,
    `Qualité mesurée : v2 ${quality.v2} / acceptable ${quality.acceptable} / candidate ${quality.candidate} / orphan ${quality.orphan} / unknown ${quality.unknown} / null ${quality.null} = ${total}.`,
    missing,
    "",
  ].join("\n");
}

function main(): void {
  const stamp = compactUtcStamp(new Date());
  const committedPaths = committedCoveragePaths();
  const inputCommit = git(["rev-parse", "HEAD"]).trim();
  const inputs: InputRecord[] = [];
  const missingInputs: MissingInput[] = [];
  const entries = new Map<string, MutableEntry>();

  const candidatePaths = [...committedPaths].filter((path) => CANDIDATE_PATH.test(path)).sort((left, right) => left.localeCompare(right));
  for (const path of candidatePaths) {
    const blob = readCommittedJson(path, committedPaths);
    readCandidateRows(path, blob, entries);
    inputs.push({ kind: "candidate", path, committed: true, sha256: blob.sha256 });
  }
  if (!committedPaths.has(UNMEASURED_DISTINCT_PATH)) {
    missingInputs.push({ kind: "candidate", path: UNMEASURED_DISTINCT_PATH, reason: "absent_from_HEAD" });
  }

  let qualities = new Map<string, QualityStatus>();
  if (committedPaths.has(BPRIME_PATH)) {
    const blob = readCommittedJson(BPRIME_PATH, committedPaths);
    readBprimeRows(blob, entries);
    inputs.push({ kind: "bprime", path: BPRIME_PATH, committed: true, sha256: blob.sha256 });
  } else {
    missingInputs.push({ kind: "bprime", path: BPRIME_PATH, reason: "absent_from_HEAD" });
  }
  if (committedPaths.has(QUALITY_MATRIX_PATH)) {
    const blob = readCommittedJson(QUALITY_MATRIX_PATH, committedPaths);
    qualities = readQualityMatrix(blob);
    inputs.push({ kind: "quality_matrix", path: QUALITY_MATRIX_PATH, committed: true, sha256: blob.sha256 });
  } else {
    missingInputs.push({ kind: "quality_matrix", path: QUALITY_MATRIX_PATH, reason: "absent_from_HEAD" });
  }

  const survivalPaths = [...committedPaths].filter((path) => SURVIVAL_PATH.test(path)).sort((left, right) => left.localeCompare(right));
  for (const path of survivalPaths) {
    const blob = readCommittedJson(path, committedPaths);
    readSurvivalRows(path, blob, entries);
    inputs.push({ kind: "survival", path, committed: true, sha256: blob.sha256 });
  }

  const inventory: InventoryEntry[] = [...entries.entries()]
    .map(([slugValue, entry]) => ({
      slug: slugValue,
      sources: [...entry.sources.values()].sort((left, right) => {
        const leftKey = `${left.path}\u0000${left.source ?? ""}`;
        const rightKey = `${right.path}\u0000${right.source ?? ""}`;
        return leftKey.localeCompare(rightKey);
      }),
      urls: [...entry.urls].sort((left, right) => left.localeCompare(right)),
      liveness_status: livenessStatus(entry.livenessEvidence),
      liveness_evidence: sortEvidence(entry.livenessEvidence),
      measured_quality: qualities.get(slugValue) ?? null,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));

  const livenessCounts = countBy(inventory.map((entry) => entry.liveness_status), LIVENESS_STATUSES);
  const qualityCounts = countBy(
    inventory.map((entry) => entry.measured_quality ?? "null"),
    [...QUALITY_STATUSES, "null"] as const,
  );
  const total = inventory.length;
  assertClosedPartition("liveness_status", total, livenessCounts);
  assertClosedPartition("measured_quality", total, qualityCounts);
  if (new Set(inventory.map((entry) => entry.slug)).size !== total) throw new Error("slug deduplication failed");
  if (inventory.some((entry) => entry.urls.length === 0)) throw new Error("inventory contains a slug without a proof URL");

  const jsonPath = `${COVERAGE_ROOT}/zones-live-url-candidate-inventory-${stamp}.json`;
  const markdownPath = `${COVERAGE_ROOT}/zones-live-url-candidate-inventory-${stamp}.md`;
  const report = {
    contract: CONTRACT,
    generated_at: new Date().toISOString(),
    input_commit: inputCommit,
    inputs: inputs.sort((left, right) => left.path.localeCompare(right.path)),
    missing_inputs: missingInputs.sort((left, right) => left.path.localeCompare(right.path)),
    entries: inventory,
    validation: {
      distinct_slug_inventory: {
        total,
        unique_slugs: new Set(inventory.map((entry) => entry.slug)).size,
        every_entry_has_proof_url: true,
        passed: true,
      },
      liveness_status_partition: {
        counts: livenessCounts,
        total,
        equation: `${livenessCounts.LIVE} + ${livenessCounts.DEAD} + ${livenessCounts.UNKNOWN} = ${total}`,
        closed: true,
      },
      measured_quality_partition: {
        counts: qualityCounts,
        total,
        equation: `${qualityCounts.v2} + ${qualityCounts.acceptable} + ${qualityCounts.candidate} + ${qualityCounts.orphan} + ${qualityCounts.unknown} + ${qualityCounts.null} = ${total}`,
        closed: true,
      },
    },
  };
  writeFileSync(resolve(ROOT, jsonPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  writeFileSync(
    resolve(ROOT, markdownPath),
    markdown(relative(ROOT, resolve(ROOT, jsonPath)), total, livenessCounts, qualityCounts, missingInputs),
    { encoding: "utf8", flag: "wx" },
  );
  console.log(JSON.stringify({ json: jsonPath, markdown: markdownPath, total, liveness: livenessCounts, quality: qualityCounts }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
