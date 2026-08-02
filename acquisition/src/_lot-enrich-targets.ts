/**
 * _lot-enrich-targets.ts — sélection lecture seule des re-folds productifs.
 *
 * Intersection fermée : assignment lot-zone complete, normes done dans la
 * matrice de couverture, folded-normes incomplet dans la matrice datée, lot
 * <= 15k, puis contrôle du plafond réellement servi. Le plafond est le nombre
 * de normes que le parquet qc-lot-zonage courant peut fournir au join; une
 * ville n'est productive que si qc-lots servi en contient moins.
 *
 * Aucun dépôt, aucune capture, aucune adresse inventée. Une muni sans stats
 * servies lisibles reste explicitement non-ciblée.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_lot-enrich-targets.ts --limit 40
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { exists, getJson, s3Client } from "./lib/s3.js";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const ASSIGNMENT_PATH = resolve(ROOT, "work/coverage/immo-lot-zone-assignment-matrix-20260802.json");
const FOLDED_PATH = resolve(ROOT, "work/coverage/immo-folded-normes-city-matrix-20260802.json");
const COVERAGE_PATH = resolve(ROOT, "work/coverage/coverage-matrix.json");
const MAX_LOTS = 15_000;
const PILOT_DONE = new Set([
  "chesterville",
  "saint-zephirin-de-courval",
  "sainte-francoise--les-basques",
  "duhamel-ouest",
  "saint-ours",
  "dupuy",
  "ormstown",
  "havelock",
]);

interface AssignmentRow {
  slug: string;
  state: string;
  reason: string;
  observed_lots: number;
}

interface FoldedRow {
  slug: string;
  state: string;
  reason: string;
  observed_lots: number | null;
  folded_normes_lots: number | null;
  missing_folded_normes_lots: number | null;
}

interface CoverageCell {
  status?: string;
  doneTrack?: string;
}

interface Stats {
  num_lots?: unknown;
  num_assigned?: unknown;
  num_without_norms?: unknown;
  num_with_norms?: unknown;
  role?: { num_with_adresse?: unknown } | null;
}

interface Candidate {
  slug: string;
  lots: number;
  assignment_reason: string;
  normes_reason: string;
  normes_track: string | null;
  folded_normes_matrix: number;
  folded_normes_matrix_missing: number;
  folded_normes_served: number;
  folded_normes_join_ceiling: number;
  potential_gain: number;
  adresse_served: number | null;
  stats_key: string;
}

interface Args {
  limit: number;
}

function parseArgs(argv: readonly string[]): Args {
  let limit = 40;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--limit") limit = Math.max(1, Number(argv[++i] ?? "40") || 40);
    else if (token !== "--help") throw new Error(`unknown argument: ${token}`);
  }
  return { limit };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

async function readStats(s3: ReturnType<typeof s3Client>, keys: readonly string[]): Promise<{ key: string; stats: Stats } | null> {
  for (const key of keys) {
    if (await exists(s3, key)) return { key, stats: await getJson<Stats>(s3, key) };
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const assignment = readJson<{ city_measurements: AssignmentRow[] }>(ASSIGNMENT_PATH);
  const folded = readJson<{ city_measurements: FoldedRow[] }>(FOLDED_PATH);
  const coverage = readJson<{ cities: Record<string, { normes?: CoverageCell }> }>(COVERAGE_PATH);
  const foldedBySlug = new Map(folded.city_measurements.map((row) => [row.slug, row]));
  const matrixCandidates = assignment.city_measurements
    .filter((row) => row.state === "complete" && row.observed_lots <= MAX_LOTS && !PILOT_DONE.has(row.slug))
    .map((row) => ({ assignment: row, folded: foldedBySlug.get(row.slug), normes: coverage.cities[row.slug]?.normes }))
    .filter((row) => row.folded?.state === "incomplete" && row.normes?.status === "done")
    .sort((left, right) => (right.folded!.missing_folded_normes_lots ?? 0) - (left.folded!.missing_folded_normes_lots ?? 0));

  const s3 = s3Client();
  const ceiling: Array<Record<string, unknown>> = [];
  const unavailable: Array<Record<string, unknown>> = [];
  const productive: Candidate[] = [];

  for (const row of matrixCandidates) {
    const slug = row.assignment.slug;
    const matrixFolded = row.folded?.folded_normes_lots;
    const matrixMissing = row.folded?.missing_folded_normes_lots;
    if (matrixFolded === null || matrixFolded === undefined || matrixMissing === null || matrixMissing === undefined) {
      unavailable.push({ slug, reason: "folded matrix row has no usable counters" });
      continue;
    }
    const enriched = await readStats(s3, [
      `normalized/qc-lots/qc-lots-${slug}/qc-lots-${slug}.stats.json`,
      `normalized/qc-lots/qc-lots-${slug}.stats.json`,
    ]);
    const join = await readStats(s3, [`normalized/qc-lot-zonage/${slug}.stats.json`]);
    const current = finiteInteger(enriched?.stats.num_with_norms);
    const assigned = finiteInteger(join?.stats.num_assigned);
    const withoutNorms = finiteInteger(join?.stats.num_without_norms);
    const joinCeiling = assigned !== null && withoutNorms !== null && withoutNorms <= assigned ? assigned - withoutNorms : null;
    const address = finiteInteger(enriched?.stats.role && enriched.stats.role.num_with_adresse);
    const base = {
      slug,
      lots: row.assignment.observed_lots,
      assignment_reason: row.assignment.reason,
      normes_reason: row.folded!.reason,
      normes_track: row.normes?.doneTrack ?? null,
      folded_normes_matrix: matrixFolded,
      folded_normes_matrix_missing: matrixMissing,
      folded_normes_served: current,
      folded_normes_join_ceiling: joinCeiling,
      adresse_served: address,
      stats_key: enriched?.key ?? "",
    };
    if (current === null || joinCeiling === null) {
      unavailable.push({ ...base, reason: "stats qc-lots or qc-lot-zonage unreadable" });
      continue;
    }
    const potentialGain = joinCeiling - current;
    if (potentialGain > 0) productive.push({ ...base, folded_normes_served: current, folded_normes_join_ceiling: joinCeiling, potential_gain: potentialGain });
    else ceiling.push({ ...base, potential_gain: potentialGain, reason: "current folded-normes already reaches the current join ceiling" });
  }

  productive.sort((left, right) => right.potential_gain - left.potential_gain || right.folded_normes_matrix_missing - left.folded_normes_matrix_missing || left.slug.localeCompare(right.slug));
  console.log(JSON.stringify({
    contract: "lot-enrich-targets/v1",
    as_of: "20260802",
    rule: "assignment complete + coverage normes done + folded matrix incomplete + <=15000 lots + current folded < current join ceiling",
    source_matrices: [
      "work/coverage/immo-lot-zone-assignment-matrix-20260802.json",
      "work/coverage/immo-folded-normes-city-matrix-20260802.json",
      "work/coverage/coverage-matrix.json",
    ],
    pilot_excluded: [...PILOT_DONE].sort(),
    matrix_candidates: matrixCandidates.length,
    productive: productive.slice(0, args.limit),
    productive_total: productive.length,
    ceiling,
    ceiling_total: ceiling.length,
    unavailable,
    unavailable_total: unavailable.length,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
