#!/usr/bin/env node
/**
 * Deterministic, local-only completion matrix for the four regdens portfolio
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
const PERCITY_OUTPUT = `work/coverage/completion-regdens-percity-${OUTPUT_DATE}.json`;
const COMMITTED_TOTALS_OUTPUT = "work/coverage/completion-regdens-20260802.json";
const OUTPUT_AS_OF = `${OUTPUT_DATE.slice(0, 4)}-${OUTPUT_DATE.slice(4, 6)}-${OUTPUT_DATE.slice(6, 8)}`;
const REGLEMENT_DECLARED_SOURCE_AS_OF = "2026-08-02";
const COHORT_SLUGS = [
  "westmount",
  "saint-lambert",
  "hampstead",
  "mont-royal",
  "montreal-ouest",
  "cote-saint-luc",
  "longueuil",
  "sainte-catherine",
  "la-prairie",
  "delson",
  "candiac",
  "montreal-est",
  "boucherville",
  "dorval",
  "saint-constant",
  "saint-bruno-de-montarville",
  "carignan",
  "dollard-des-ormeaux",
  "pointe-claire",
  "saint-philippe",
  "saint-mathieu",
  "chateauguay",
  "sainte-julie",
  "saint-basile-le-grand",
  "chambly",
  "rosemere",
  "varennes",
  "brossard",
  "lile-dorval",
  "kirkland",
];

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

function countCityStates(cities, axis) {
  const totals = freshTotals();
  for (const city of cities) {
    const state = city[axis];
    invariant(STATES.includes(state), `${axis}/${city.slug} has invalid state ${state}`);
    totals[state] += 1;
  }
  invariant(cities.length === CITY_TARGET, `${axis} has ${cities.length} cities, expected ${CITY_TARGET}`);
  return totals;
}

function assertMatchingTotals(expected, actual, label) {
  for (const state of STATES) {
    invariant(actual[state] === expected[state],
      `${label}/${state} is ${actual[state]}, expected ${expected[state]}`);
  }
}

const catalog = readJson("packages/qc-sources/src/geo/municipalities.qc.json");
invariant(Array.isArray(catalog), "municipal catalogue must be an array");
invariant(catalog.length === CITY_TARGET, `municipal catalogue has ${catalog.length} cities, expected ${CITY_TARGET}`);
const catalogSlugs = new Set(catalog.map(({ slug }) => slug));
invariant(catalogSlugs.size === CITY_TARGET, "municipal catalogue has duplicate or missing slugs");

// Declared regulation provenance is the committed registry snapshot
// acquisition/config/reglement-provenance.json (last revised 2026-08-02): a
// catalog slug with a non-null reglement_numero is declared complete; a slug
// present in the registry without that number is incomplete (partial
// millesime/URL values do not invent a number); a slug absent from the
// registry is unknown. Registry keys outside the municipal catalog are not
// alias-mapped: they establish no status for a catalog city.
const reglementDeclaredSourcePath = "acquisition/config/reglement-provenance.json";
const reglementDeclaredSource = readJson(reglementDeclaredSourcePath);
invariant(reglementDeclaredSource.slugs !== null
  && typeof reglementDeclaredSource.slugs === "object"
  && !Array.isArray(reglementDeclaredSource.slugs),
`${reglementDeclaredSourcePath} has no slugs object`);
const reglementDeclaredBySlug = uniqueSlugs(
  Object.entries(reglementDeclaredSource.slugs).flatMap(([slug, row]) => {
    invariant(row !== null && typeof row === "object" && !Array.isArray(row),
      `${reglementDeclaredSourcePath}/${slug} is not an object`);
    return catalogSlugs.has(slug) ? [{ slug, ...row }] : [];
  }),
  "slug",
  "reglement declared registry",
  catalogSlugs,
);
const reglementDeclaredStateForSlug = (slug) => {
  const row = reglementDeclaredBySlug.get(slug);
  if (row === undefined) return "unknown";
  return row.reglement_numero !== null && row.reglement_numero !== undefined
    ? "complete"
    : "incomplete";
};
const reglementDeclared = countStates(catalog, reglementDeclaredStateForSlug, "reglement_declared");

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
const reglementProvenStateForSlug = (slug) => {
  const row = reglementBySlug.get(slug);
  if (row === undefined) return "unknown";
  const state = reglementStates.get(row.state);
  invariant(state !== undefined, `reglement capture registry/${slug} has unsupported state ${row.state}`);
  return state;
};
const reglementProven = countStates(catalog, reglementProvenStateForSlug, "reglement_proven");

// The enrichment coverage reports a per-city boolean for usage dominant. A
// city omitted from its finite coverage is unknown, rather than incomplete.
const usageSourcePath = "work/coverage/zonage-enrichment.json";
const usageSource = readJson(usageSourcePath);
invariant(typeof usageSource.generatedAt === "string", `${usageSourcePath} is missing generatedAt`);
invariant(Array.isArray(usageSource.perMuni), `${usageSourcePath} has no perMuni array`);
const usageBySlug = uniqueSlugs(usageSource.perMuni, "slug", "usage dominant coverage", catalogSlugs);
const usageDominantStateForSlug = (slug) => {
  const row = usageBySlug.get(slug);
  if (row === undefined) return "unknown";
  invariant(typeof row.usage_dominant === "boolean",
    `usage dominant coverage/${slug} has non-boolean usage_dominant`);
  return row.usage_dominant ? "complete" : "incomplete";
};
const usageDominant = countStates(catalog, usageDominantStateForSlug, "usage_dominant");

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
const effetDensifiantStateForSlug = (slug) => {
  const row = effectBySlug.get(slug);
  if (row === undefined) return "unknown";
  const state = effectStates.get(row.state);
  invariant(state !== undefined, `effet densifiant B-prime/${slug} has unsupported state ${row.state}`);
  return state;
};
const effetDensifiant = countStates(catalog, effetDensifiantStateForSlug, "effet_densifiant");

const matrix = {
  totals: {
    reglement_declared: reglementDeclared,
    reglement_proven: reglementProven,
    usage_dominant: usageDominant,
    effet_densifiant: effetDensifiant,
  },
  source_as_of: {
    reglement_declared: REGLEMENT_DECLARED_SOURCE_AS_OF,
    reglement_proven: reglementSource.timestamp,
    usage_dominant: usageSource.generatedAt,
    effet_densifiant: dateFromFileName(effectSource.relativePath),
  },
};

const stateForSlugByAxis = {
  reglement_declared: reglementDeclaredStateForSlug,
  reglement_proven: reglementProvenStateForSlug,
  usage_dominant: usageDominantStateForSlug,
  effet_densifiant: effetDensifiantStateForSlug,
};
const cities = catalog.map(({ slug }) => ({
  slug,
  ...Object.fromEntries(Object.entries(stateForSlugByAxis)
    .map(([axis, stateForSlug]) => [axis, stateForSlug(slug)])),
}));
const perCity = {
  contract: "completion-regdens-percity/v1",
  as_of: OUTPUT_AS_OF,
  source_as_of: matrix.source_as_of,
  cities,
};

for (const [axis, totals] of Object.entries(matrix.totals)) {
  const total = STATES.reduce((sum, state) => sum + totals[state], 0);
  invariant(total === CITY_TARGET, `${axis} output partition is ${total}, expected ${CITY_TARGET}`);
  assertMatchingTotals(totals, countCityStates(cities, axis), `${axis} per-city totals`);
}

const committedTotals = readJson(COMMITTED_TOTALS_OUTPUT);
invariant(committedTotals !== null && typeof committedTotals === "object"
  && committedTotals.totals !== null && typeof committedTotals.totals === "object",
`${COMMITTED_TOTALS_OUTPUT} has no totals object`);
for (const [axis, totals] of Object.entries(matrix.totals)) {
  assertMatchingTotals(totals, committedTotals.totals[axis], `${axis} committed totals`);
}

const cohortCities = new Map(cities.map((city) => [city.slug, city]));
invariant(new Set(COHORT_SLUGS).size === COHORT_SLUGS.length, "cohort has duplicate slugs");
for (const slug of COHORT_SLUGS) {
  invariant(cohortCities.has(slug), `cohort slug is absent from municipal catalogue: ${slug}`);
}
const cohortComplete = Object.fromEntries(Object.keys(matrix.totals).map((axis) => [
  axis,
  `${COHORT_SLUGS.filter((slug) => cohortCities.get(slug)[axis] === "complete").length}/${COHORT_SLUGS.length}`,
]));

writeFileSync(absolute(OUTPUT), `${JSON.stringify(matrix, null, 2)}\n`);
writeFileSync(absolute(PERCITY_OUTPUT), `${JSON.stringify(perCity, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUTPUT,
  per_city_output: PERCITY_OUTPUT,
  totals: matrix.totals,
  cohort_complete: cohortComplete,
}, null, 2));
