/**
 * Local-only deterministic reconciliation source.
 *
 * Reads the retained 871-row provenance baseline and completed 32-candidate
 * and 112-orphan manifests. It emits one JSON report to stdout and does not
 * fetch, write, deploy, edit Track, or promote identity/v2 information.
 *
 * Run from the repository root:
 * npx tsx acquisition/src/provenance-baseline-871-reconciliation-local-20260723.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = "work/coverage/zone-provenance-status-manifest-20260722.json";
const CANDIDATES = "work/coverage/proof-candidates-32-verification-20260722.json";
const ORPHANS = "work/coverage/proof-orphan-112-local-batches-20260722.json";
const CITIES = "work/coverage/coverage-matrix.json";
const STATES = ["historical-verified", "legacy-traceable", "candidate-needs-human-confirmation", "orphan"];
const CANDIDATE = "candidate-needs-human-confirmation";
const ORPHAN = "orphan";
const CODE: Record<string, string> = {
  "historical-verified": "h", "legacy-traceable": "l",
  "candidate-needs-human-confirmation": "c", orphan: "o",
};
const CANDIDATE_AFTER: Record<string, string> = {
  "historical-verified": "historical-verified",
  "legacy-traceable": "legacy-traceable",
  "remains-candidate": CANDIDATE,
  orphan: ORPHAN,
};
const CITY_ALIASES: Record<string, string> = {
  "l-assomption": "lassomption",
  "l-epiphanie": "lepiphanie",
  "sainte-christine-d-auvergne": "sainte-christine-dauvergne",
};

function fail(message: string): never { throw new Error(message); }
function assert(value: unknown, message: string): asserts value { if (!value) fail(message); }
function path(name: string): string { return resolve(ROOT, name); }
function read(name: string): any { return JSON.parse(readFileSync(path(name), "utf8")); }
function sha256(name: string): string {
  return "sha256:" + createHash("sha256").update(readFileSync(path(name))).digest("hex");
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function totals(rows: any[]): { collections: number; features: number } {
  return { collections: rows.length, features: rows.reduce((total: number, row: any) => total + row.features, 0) };
}
function stateTotals(rows: any[], field: "before" | "after"): Record<string, { collections: number; features: number }> {
  return Object.fromEntries(STATES.map((state) => [state, totals(rows.filter((row: any) => row[field] === state))]));
}
function isState(value: unknown): value is string {
  return typeof value === "string" && STATES.includes(value);
}

function main(): void {
  const baseline = read(BASELINE);
  const candidates = read(CANDIDATES);
  const orphans = read(ORPHANS);
  const coverage = read(CITIES);
  assert(baseline.contract === "zone-provenance-status-manifest/r2", "unexpected baseline contract");
  assert(candidates.contract === "proof-candidates-32-verification/v1", "unexpected candidate contract");
  assert(orphans.contract === "proof-orphan-local-batch/112/v1", "unexpected orphan contract");
  assert(Array.isArray(baseline.row_fields) && Array.isArray(baseline.rows), "invalid baseline rows");
  assert(Array.isArray(candidates.collections) && Array.isArray(orphans.collections), "invalid completed recovery rows");
  assert(coverage.municipalityCount === 1106 && coverage.cities && typeof coverage.cities === "object", "invalid city universe");

  type BaselineRow = { slug: string; collection_key: string; layout: string; features: number; provenance_state: string };
  const baselineRows: BaselineRow[] = baseline.rows.map((values: any[], index: number) => {
    assert(Array.isArray(values) && values.length === baseline.row_fields.length, "invalid baseline row " + index);
    const row = Object.fromEntries(baseline.row_fields.map((field: string, fieldIndex: number) => [field, values[fieldIndex]]));
    assert(typeof row.slug === "string" && typeof row.collection_key === "string" && typeof row.layout === "string" &&
      Number.isInteger(row.features) && row.features >= 0 && isState(row.provenance_state), "invalid baseline contract " + index);
    return row as { slug: string; collection_key: string; layout: string; features: number; provenance_state: string };
  });
  assert(baselineRows.length === 871 && totals(baselineRows).features === 95551, "baseline arithmetic mismatch");
  assert(new Set(baselineRows.map((row: any) => row.slug)).size === 871 &&
    new Set(baselineRows.map((row: any) => row.collection_key)).size === 871, "baseline uniqueness mismatch");

  const cityKeys = Object.keys(coverage.cities).sort(compare);
  const citySet = new Set(cityKeys);
  assert(cityKeys.length === 1106, "city universe cardinality mismatch");
  const cityFor = (slug: string): string => {
    if (citySet.has(slug)) return slug;
    const alias = CITY_ALIASES[slug];
    assert(alias && citySet.has(alias), "unmapped baseline slug " + slug);
    return alias;
  };
  const candidateBySlug = new Map<string, any>(candidates.collections.map((row: any) => [row.slug, row]));
  const orphanBySlug = new Map<string, any>(orphans.collections.map((row: any) => [row.slug, row]));
  assert(candidates.collections.length === 32 && totals(candidates.collections).features === 1857 &&
    candidateBySlug.size === 32, "candidate input arithmetic mismatch");
  assert(orphans.collections.length === 112 && totals(orphans.collections).features === 14584 &&
    orphanBySlug.size === 112, "orphan input arithmetic mismatch");

  const rows = baselineRows.map((row) => {
    if (row.provenance_state === CANDIDATE) {
      const result = candidateBySlug.get(row.slug);
      assert(result && result.collection_key === row.collection_key && result.features === row.features &&
        result.prior_classification === CANDIDATE && CANDIDATE_AFTER[result.classification], "candidate mismatch " + row.slug);
      return { city: cityFor(row.slug), ...row, before: CANDIDATE, after: CANDIDATE_AFTER[result.classification], recovery: "candidate-32" };
    }
    if (row.provenance_state === ORPHAN) {
      const result = orphanBySlug.get(row.slug);
      assert(result && result.collection_key === row.collection_key && result.features === row.features &&
        isState(result.classification), "orphan mismatch " + row.slug);
      return { city: cityFor(row.slug), ...row, before: ORPHAN, after: result.classification, recovery: "orphan-112" };
    }
    return { city: cityFor(row.slug), ...row, before: row.provenance_state, after: row.provenance_state, recovery: "baseline-unaffected" };
  }).sort((left: any, right: any) => compare(left.city, right.city) || compare(left.slug, right.slug));
  assert(rows.length === 871 && new Set(rows.map((row: any) => row.city)).size === 871, "city join mismatch");
  assert(rows.filter((row: any) => row.recovery === "candidate-32").length === 32 &&
    rows.filter((row: any) => row.recovery === "orphan-112").length === 112, "recovery partition mismatch");

  const cityCounts = new Map<string, Record<string, number>>(cityKeys.map((city) => [city, {
    candidate_before_collections: 0, candidate_before_features: 0,
    candidate_after_collections: 0, candidate_after_features: 0,
    orphan_before_collections: 0, orphan_before_features: 0,
    orphan_after_collections: 0, orphan_after_features: 0,
  }]));
  for (const row of rows) {
    const count = cityCounts.get(row.city)!;
    if (row.before === CANDIDATE) { count.candidate_before_collections++; count.candidate_before_features += row.features; }
    if (row.after === CANDIDATE) { count.candidate_after_collections++; count.candidate_after_features += row.features; }
    if (row.before === ORPHAN) { count.orphan_before_collections++; count.orphan_before_features += row.features; }
    if (row.after === ORPHAN) { count.orphan_after_collections++; count.orphan_after_features += row.features; }
  }
  const cityRows = cityKeys.map((city) => {
    const count = cityCounts.get(city)!;
    return [city, count.candidate_before_collections, count.candidate_before_features,
      count.candidate_after_collections, count.candidate_after_features,
      count.orphan_before_collections, count.orphan_before_features,
      count.orphan_after_collections, count.orphan_after_features];
  });
  const cityTotal = (column: number): number => cityRows.reduce((total: number, row: any[]) => total + row[column], 0);

  const transitions = new Map<string, { before: string; after: string; collections: number; features: number }>();
  for (const row of rows) {
    const key = row.before + "\u0000" + row.after;
    const current = transitions.get(key) ?? { before: row.before, after: row.after, collections: 0, features: 0 };
    current.collections++;
    current.features += row.features;
    transitions.set(key, current);
  }
  const before = stateTotals(rows, "before");
  const after = stateTotals(rows, "after");
  const passed = after["historical-verified"].collections === 31 && after["historical-verified"].features === 6126 &&
    after["legacy-traceable"].collections === 701 && after["legacy-traceable"].features === 73737 &&
    after[CANDIDATE].collections === 96 && after[CANDIDATE].features === 9636 &&
    after[ORPHAN].collections === 43 && after[ORPHAN].features === 6052 &&
    cityTotal(1) === before[CANDIDATE].collections && cityTotal(2) === before[CANDIDATE].features &&
    cityTotal(3) === after[CANDIDATE].collections && cityTotal(4) === after[CANDIDATE].features &&
    cityTotal(5) === before[ORPHAN].collections && cityTotal(6) === before[ORPHAN].features &&
    cityTotal(7) === after[ORPHAN].collections && cityTotal(8) === after[ORPHAN].features;
  assert(passed, "final arithmetic mismatch");

  const report = {
    contract: "provenance-baseline-871-local-reconciliation/v1",
    reconciled_on: "2026-07-23",
    generation_mode: "deterministic-local-cpu-only",
    operation: { network: false, source_refetches: 0, s3_reads: 0, s3_writes: 0, deployments: 0, track_edits: 0, existing_files_edited: 0 },
    non_promotion_policy: {
      source_identity: "No source identity, URL, hash, identity reference, or evidence is copied, inferred, or promoted.",
      v2_acquisition: "No v2 readiness, validation, acquisition, or rollout claim is made.",
      status_interpretation: "Only retained local recovery classifications are reconciled; remains-candidate becomes candidate-needs-human-confirmation.",
    },
    inputs: [
      { role: "provenance-baseline", path: BASELINE, contract: baseline.contract, sha256: sha256(BASELINE), collections: 871, features: 95551 },
      { role: "completed-candidate-recovery", path: CANDIDATES, contract: candidates.contract, sha256: sha256(CANDIDATES), collections: 32, features: 1857 },
      { role: "completed-orphan-recovery", path: ORPHANS, contract: orphans.contract, sha256: sha256(ORPHANS), collections: 112, features: 14584 },
      { role: "city-universe", path: CITIES, sha256: sha256(CITIES), municipalities: 1106 },
    ],
    state_catalog: { h: "historical-verified", l: "legacy-traceable", c: CANDIDATE, o: ORPHAN },
    transition_row_fields: ["before_state_code", "after_state_code", "collections", "features"],
    transition_rows: [...transitions.values()].sort((left, right) => compare(left.before, right.before) || compare(left.after, right.after))
      .map((row) => [CODE[row.before], CODE[row.after], row.collections, row.features]),
    state_partitions: { before, after },
    city_join: {
      universe: "The 1,106 city keys in coverage-matrix.json",
      rule: "Exact slug match first; only listed retained-local spelling aliases apply when the exact key is absent.",
      aliases: CITY_ALIASES, baseline_collections_mapped: 871, cities_without_a_baseline_collection: 235,
    },
    city_count_row_fields: ["city", "candidate_before_collections", "candidate_before_features", "candidate_after_collections", "candidate_after_features", "orphan_before_collections", "orphan_before_features", "orphan_after_collections", "orphan_after_features"],
    city_count_rows: cityRows,
    collection_transition_row_fields: ["city", "slug", "collection_key", "layout", "features", "before_state_code", "after_state_code", "recovery_input"],
    collection_transition_rows: rows.map((row: any) => [row.city, row.slug, row.collection_key, row.layout, row.features, CODE[row.before], CODE[row.after], row.recovery]),
    arithmetic_checks: {
      baseline: { collections: 871, features: 95551, state_partition_collections: "27 + 700 + 32 + 112 = 871", state_partition_features: "5875 + 73235 + 1857 + 14584 = 95551" },
      completed_recovery_inputs: {
        candidate_32: { collections: 32, features: 1857, transition_partition_collections: "4 + 1 + 24 + 3 = 32", transition_partition_features: "251 + 502 + 979 + 125 = 1857" },
        orphan_112: { collections: 112, features: 14584, transition_partition_collections: "72 + 40 = 112", transition_partition_features: "8657 + 5927 = 14584" },
      },
      reconciled_after: { collections: 871, features: 95551, state_partition_collections: "31 + 701 + 96 + 43 = 871", state_partition_features: "6126 + 73737 + 9636 + 6052 = 95551" },
      city_candidate_orphan_partitions: {
        city_rows: cityRows.length,
        candidate_before: { collections: cityTotal(1), features: cityTotal(2) },
        candidate_after: { collections: cityTotal(3), features: cityTotal(4) },
        orphan_before: { collections: cityTotal(5), features: cityTotal(6) },
        orphan_after: { collections: cityTotal(7), features: cityTotal(8) },
      },
      passed: true,
    },
    validation: {
      baseline_row_count: 871, candidate_input_matches_baseline_candidate_partition: true,
      orphan_input_matches_baseline_orphan_partition: true,
      all_871_baseline_collections_map_to_exactly_one_city: true, city_universe_count: cityRows.length,
      city_rows_include_zero_counts: true, collection_transition_row_count: rows.length,
      no_source_identity_or_v2_fields_in_collection_transition_rows: true, passed: true,
    },
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main();
