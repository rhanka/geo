#!/usr/bin/env node
/**
 * Deterministic, local-only completion matrix for the three regdens portfolio
 * KPIs. Missing city evidence is always unknown: this script never infers a
 * status from a neighbouring or historical city.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CITY_TARGET = 1106;
const STATES = ["complete", "incomplete", "unknown", "N/A"];
const OUTPUT_DATE = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const OUTPUT = `work/coverage/completion-regdens-${OUTPUT_DATE}.json`;

function absolute(relativePath) {
  return resolve(REPO_ROOT, relativePath);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(absolute(relativePath), "utf8"));
}

function invariant(condition, message) {
  if (!condition) throw new Error(`Validation failed: ${message}`);
}

function latestCoverageFile(pattern, timestampField) {
  const candidates = readdirSync(absolute("work/coverage"))
    .filter((name) => pattern.test(name))
    .map((name) => {
      const relativePath = `work/coverage/${name}`;
      const data = readJson(relativePath);
      const timestamp = data[timestampField];
      invariant(typeof timestamp === "string" && timestamp.length > 0,
        `${relativePath} is missing ${timestampField}`);
      return { relativePath, data, timestamp };
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp)
      || left.relativePath.localeCompare(right.relativePath));
  invariant(candidates.length > 0, `no authoritative coverage file matches ${pattern}`);
  return candidates.at(-1);
}

function dateFromFileName(relativePath) {
  const match = relativePath.match(/(20\d{2})(\d{2})(\d{2})/);
  invariant(match !== null, `${relativePath} has no YYYYMMDD date`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function uniqueSlugs(rows, slugField, label, catalogSlugs) {
  const bySlug = new Map();
  for (const row of rows) {
    const slug = row?.[slugField];
    invariant(typeof slug === "string" && slug.length > 0, `${label} row has no ${slugField}`);
    invariant(catalogSlugs.has(slug), `${label} contains a slug outside the municipal catalogue: ${slug}`);
    invariant(!bySlug.has(slug), `${label} contains duplicate slug: ${slug}`);
    bySlug.set(slug, row);
  }
  return bySlug;
}

function freshTotals() {
  return Object.fromEntries(STATES.map((state) => [state, 0]));
}

function countStates(catalog, stateForSlug, axis) {
  const totals = freshTotals();
  for (const { slug } of catalog) {
    const state = stateForSlug(slug);
    invariant(STATES.includes(state), `${axis}/${slug} has invalid state ${state}`);
    totals[state] += 1;
  }
  const total = STATES.reduce((sum, state) => sum + totals[state], 0);
  invariant(total === CITY_TARGET, `${axis} partition is ${total}, expected ${CITY_TARGET}`);
  return totals;
}

const catalog = readJson("packages/qc-sources/src/geo/municipalities.qc.json");
invariant(Array.isArray(catalog), "municipal catalogue must be an array");
invariant(catalog.length === CITY_TARGET, `municipal catalogue has ${catalog.length} cities, expected ${CITY_TARGET}`);
const catalogSlugs = new Set(catalog.map(({ slug }) => slug));
invariant(catalogSlugs.size === CITY_TARGET, "municipal catalogue has duplicate or missing slugs");

// Authoritative regulation provenance/capture registry: a captured unchanged
// regulation is complete; a missing or changed capture is incomplete; an
// unreadable/no-URL observation remains unknown.
const reglementSource = latestCoverageFile(/^reglement-capture-kpi-.*\.json$/, "generated_at");
invariant(Array.isArray(reglementSource.data.cities), `${reglementSource.relativePath} has no cities array`);
const reglementBySlug = uniqueSlugs(reglementSource.data.cities, "city_slug", "reglement capture registry", catalogSlugs);
const reglementStates = new Map([
  ["capture_inchange", "complete"],
  ["jamais_capture", "incomplete"],
  ["change", "incomplete"],
  ["unknown", "unknown"],
]);
const reglement = countStates(catalog, (slug) => {
  const row = reglementBySlug.get(slug);
  if (row === undefined) return "unknown";
  const state = reglementStates.get(row.state);
  invariant(state !== undefined, `reglement capture registry/${slug} has unsupported state ${row.state}`);
  return state;
}, "reglement");

// The enrichment coverage reports a per-city boolean for usage dominant. A
// city omitted from its finite coverage is unknown, rather than incomplete.
const usageSourcePath = "work/coverage/zonage-enrichment.json";
const usageSource = readJson(usageSourcePath);
invariant(typeof usageSource.generatedAt === "string", `${usageSourcePath} is missing generatedAt`);
invariant(Array.isArray(usageSource.perMuni), `${usageSourcePath} has no perMuni array`);
const usageBySlug = uniqueSlugs(usageSource.perMuni, "slug", "usage dominant coverage", catalogSlugs);
const usageDominant = countStates(catalog, (slug) => {
  const row = usageBySlug.get(slug);
  if (row === undefined) return "unknown";
  invariant(typeof row.usage_dominant === "boolean",
    `usage dominant coverage/${slug} has non-boolean usage_dominant`);
  return row.usage_dominant ? "complete" : "incomplete";
}, "usage_dominant");

// B-prime is the authoritative effect assessment. "unserved" establishes no
// structural N/A condition, so it stays unknown along with absent source rows.
const effectSource = latestCoverageFile(/^effet-densifiant-bprime-acquisition-universe-.*\.json$/, "universe_rule");
invariant(Array.isArray(effectSource.data.rows), `${effectSource.relativePath} has no rows array`);
const effectBySlug = uniqueSlugs(effectSource.data.rows, "slug", "effet densifiant B-prime", catalogSlugs);
const effectStates = new Map([
  ["known", "complete"],
  ["absent", "incomplete"],
  ["unknown_only", "unknown"],
  ["unserved", "unknown"],
]);
const effetDensifiant = countStates(catalog, (slug) => {
  const row = effectBySlug.get(slug);
  if (row === undefined) return "unknown";
  const state = effectStates.get(row.state);
  invariant(state !== undefined, `effet densifiant B-prime/${slug} has unsupported state ${row.state}`);
  return state;
}, "effet_densifiant");

const matrix = {
  totals: {
    reglement,
    usage_dominant: usageDominant,
    effet_densifiant: effetDensifiant,
  },
  source_as_of: {
    reglement: reglementSource.timestamp,
    usage_dominant: usageSource.generatedAt,
    effet_densifiant: dateFromFileName(effectSource.relativePath),
  },
};

for (const [axis, totals] of Object.entries(matrix.totals)) {
  const total = STATES.reduce((sum, state) => sum + totals[state], 0);
  invariant(total === CITY_TARGET, `${axis} output partition is ${total}, expected ${CITY_TARGET}`);
}

writeFileSync(absolute(OUTPUT), `${JSON.stringify(matrix, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, totals: matrix.totals }, null, 2));
