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
const effetDensifiantRawStateForSlug = effetDensifiantStateForSlug;

// N-A absence-proof registry (SPEC_PALIER_RESOLUTION §1). Each proof is a
// REPRODUCIBLE proof of legitimate absence carrying {source, date, result}. A
// proof promotes a NON-complete derived state (unknown|incomplete) to N/A; it is
// NEVER allowed on a cell that is already complete (that would be a contradiction
// and fails loud). Anti-invention: a proof missing any required field, naming a
// slug outside the catalogue, or an unknown axis is rejected here — the registry
// cannot silently relabel an unproven UNKNOWN as N/A. An EMPTY registry leaves
// every partition unchanged (mechanism inert until real proofs are deposited).
const NA_PROOF_PATH = "acquisition/config/palier-na-proofs.json";
const AXES = ["reglement_declared", "reglement_proven", "usage_dominant", "effet_densifiant"];
const rawStateForSlugByAxis = {
  reglement_declared: reglementDeclaredStateForSlug,
  reglement_proven: reglementProvenStateForSlug,
  usage_dominant: usageDominantStateForSlug,
  effet_densifiant: effetDensifiantRawStateForSlug,
};
const naProofSource = readJson(NA_PROOF_PATH);
invariant(naProofSource.contract === "palier-na-proofs/v1",
  `${NA_PROOF_PATH} has unexpected contract`);
invariant(Array.isArray(naProofSource.proofs), `${NA_PROOF_PATH} has no proofs array`);
const naBySlugAxis = new Map();
for (const proof of naProofSource.proofs) {
  invariant(proof !== null && typeof proof === "object" && !Array.isArray(proof),
    `${NA_PROOF_PATH} proof is not an object`);
  const { geo_slug: geoSlug, axis } = proof;
  invariant(typeof geoSlug === "string" && catalogSlugs.has(geoSlug),
    `${NA_PROOF_PATH} proof geo_slug is not a catalogue slug: ${geoSlug}`);
  invariant(AXES.includes(axis), `${NA_PROOF_PATH} proof axis is unknown: ${axis}`);
  for (const field of ["criterion", "source", "date", "result"]) {
    invariant(typeof proof[field] === "string" && proof[field].length > 0,
      `${NA_PROOF_PATH} proof ${geoSlug}/${axis} is missing ${field} (N-A exige une preuve d'absence reproductible)`);
  }
  const key = `${geoSlug} ${axis}`;
  invariant(!naBySlugAxis.has(key), `${NA_PROOF_PATH} has a duplicate proof for ${geoSlug}/${axis}`);
  const rawState = rawStateForSlugByAxis[axis](geoSlug);
  invariant(rawState !== "complete",
    `${NA_PROOF_PATH} proof ${geoSlug}/${axis} contradicts a COMPLETE derived cell`);
  naBySlugAxis.set(key, proof);
}
function withNaProof(axis, rawStateForSlug) {
  return (slug) => {
    const state = rawStateForSlug(slug);
    if (state === "complete") return state;
    return naBySlugAxis.has(`${slug} ${axis}`) ? "N/A" : state;
  };
}
const reglementDeclaredResolvedForSlug = withNaProof("reglement_declared", reglementDeclaredStateForSlug);
const reglementProvenResolvedForSlug = withNaProof("reglement_proven", reglementProvenStateForSlug);
const usageDominantResolvedForSlug = withNaProof("usage_dominant", usageDominantStateForSlug);
const effetDensifiantResolvedForSlug = withNaProof("effet_densifiant", effetDensifiantRawStateForSlug);

// Resolved totals fold any deposited N-A proof over the raw partition. With an
// empty registry these equal the raw partitions above (reglementDeclared, …).
const matrix = {
  totals: {
    reglement_declared: countStates(catalog, reglementDeclaredResolvedForSlug, "reglement_declared"),
    reglement_proven: countStates(catalog, reglementProvenResolvedForSlug, "reglement_proven"),
    usage_dominant: countStates(catalog, usageDominantResolvedForSlug, "usage_dominant"),
    effet_densifiant: countStates(catalog, effetDensifiantResolvedForSlug, "effet_densifiant"),
  },
  source_as_of: {
    reglement_declared: REGLEMENT_DECLARED_SOURCE_AS_OF,
    reglement_proven: reglementSource.timestamp,
    usage_dominant: usageSource.generatedAt,
    effet_densifiant: dateFromFileName(effectSource.relativePath),
  },
  na_proofs: {
    source: NA_PROOF_PATH,
    revised: naProofSource.revised,
    count: naBySlugAxis.size,
  },
};

const stateForSlugByAxis = {
  reglement_declared: reglementDeclaredResolvedForSlug,
  reglement_proven: reglementProvenResolvedForSlug,
  usage_dominant: usageDominantResolvedForSlug,
  effet_densifiant: effetDensifiantResolvedForSlug,
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

// Palier cohort = the owner's 167-city resolution target (SPEC_PALIER_RESOLUTION,
// qa commit e78c725c). This file is a byte-for-byte mirror of the authoritative
// artifact work/coverage/palier-matrix-cohort-167.json produced on lane/qa
// (commit 8754014b) from radar 800ee90:docs/spec/reports/set-167-bprime.tsv —
// slug/priorityRank VERBATIM. Committed here so this generator stays reproducible
// on a clean lane/reglement checkout. A palier slug that is not a geo catalogue
// slug is reported as `unmatched`, never silently assigned a status.
const PALIER_COHORT_PATH = "work/coverage/palier-cohort-167.json";
const palierCohortSource = readJson(PALIER_COHORT_PATH);
invariant(palierCohortSource.contract === "city-kpi-matrix-slug-cohort/v1",
  `${PALIER_COHORT_PATH} has unexpected contract`);
invariant(Array.isArray(palierCohortSource.cities), `${PALIER_COHORT_PATH} has no cities array`);
const PALIER_TARGET = 167;
invariant(palierCohortSource.cities.length === PALIER_TARGET,
  `${PALIER_COHORT_PATH} has ${palierCohortSource.cities.length} cities, expected ${PALIER_TARGET}`);
const palierRows = palierCohortSource.cities.map((row) => {
  invariant(typeof row.slug === "string" && row.slug.length > 0, `${PALIER_COHORT_PATH} row has no slug`);
  invariant(Number.isInteger(row.priorityRank), `${PALIER_COHORT_PATH}/${row.slug} has no integer priorityRank`);
  return { slug: row.slug, priorityRank: row.priorityRank };
});
invariant(new Set(palierRows.map((r) => r.slug)).size === PALIER_TARGET, "palier cohort has duplicate slugs");
invariant(new Set(palierRows.map((r) => r.priorityRank)).size === PALIER_TARGET, "palier cohort has duplicate ranks");
for (const { priorityRank } of palierRows) {
  invariant(priorityRank >= 1 && priorityRank <= PALIER_TARGET,
    `palier cohort priorityRank ${priorityRank} out of 1..${PALIER_TARGET}`);
}

// Continuity guard: the historical hand-maintained 30-cohort must equal the
// priorityRank<=30 view of the authoritative 167. A drift here means the two
// definitions diverged and the report would silently misreport the 30-slice.
const palier30Slugs = palierRows.filter((r) => r.priorityRank <= 30).map((r) => r.slug);
invariant(palier30Slugs.length === 30, `palier rank<=30 view has ${palier30Slugs.length} slugs, expected 30`);
invariant(new Set(palier30Slugs).size === new Set(COHORT_SLUGS).size
  && [...COHORT_SLUGS].every((slug) => palier30Slugs.includes(slug)),
  "legacy 30-cohort set differs from palier rank<=30 view");

// The radar slug space (set-167-bprime) joins some cities on a SINGLE hyphen
// before the MRC disambiguation suffix, whereas the geo catalogue uses a DOUBLE
// hyphen `--` there. These 7 are the exact, verified 1:1 equivalents (matched on
// municipality name + MRC in packages/qc-sources/src/geo/municipalities.qc.json);
// this is an explicit whitelist, NOT a hyphen heuristic — each target is asserted
// present in the catalogue below, so a wrong alias fails loud rather than guessing.
const PALIER_SLUG_ALIASES = {
  "saint-isidore-roussillon": "saint-isidore--roussillon",
  "saint-damase-les-maskoutains": "saint-damase--les-maskoutains",
  "hemmingford-les-jardins-de-napierville": "hemmingford--les-jardins-de-napierville",
  "saint-louis-de-gonzague-beauharnois-salaberry": "saint-louis-de-gonzague--beauharnois-salaberry",
  "hemmingford-les-jardins-de-napierville-2": "hemmingford--les-jardins-de-napierville--2",
  "saint-sebastien-le-haut-richelieu": "saint-sebastien--le-haut-richelieu",
  "sainte-sabine-brome-missisquoi": "sainte-sabine--brome-missisquoi",
};
function resolvePalierSlug(slug) {
  if (cohortCities.has(slug)) return slug;
  const alias = PALIER_SLUG_ALIASES[slug];
  if (alias === undefined) return undefined;
  invariant(cohortCities.has(alias),
    `palier alias target absent from municipal catalogue: ${slug} -> ${alias}`);
  return alias;
}

// Per-axis partition over a slug list; a slug that resolves to no catalogue city
// (even after the verified alias whitelist) is counted as `unmatched`, not guessed.
function sliceForSlugs(slugs, label) {
  const axes = Object.keys(matrix.totals);
  const partition = Object.fromEntries(axes.map((axis) => [axis,
    Object.fromEntries([...STATES, "unmatched"].map((state) => [state, 0]))]));
  const unmatched = [];
  for (const slug of slugs) {
    const geoSlug = resolvePalierSlug(slug);
    const city = geoSlug === undefined ? undefined : cohortCities.get(geoSlug);
    if (city === undefined) {
      unmatched.push(slug);
      for (const axis of axes) partition[axis].unmatched += 1;
      continue;
    }
    for (const axis of axes) partition[axis][city[axis]] += 1;
  }
  for (const axis of axes) {
    const total = [...STATES, "unmatched"].reduce((sum, state) => sum + partition[axis][state], 0);
    invariant(total === slugs.length, `${label}/${axis} partition is ${total}, expected ${slugs.length}`);
  }
  return { count: slugs.length, unmatched, partition };
}

const palier167Slugs = palierRows.map((r) => r.slug);
const palier167 = sliceForSlugs(palier167Slugs, "palier167");
const palier30 = sliceForSlugs(palier30Slugs, "palier30");
const cohortComplete = Object.fromEntries(Object.keys(matrix.totals).map((axis) => [
  axis,
  `${palier30.partition[axis].complete}/30`,
]));
const palier167Complete = Object.fromEntries(Object.keys(matrix.totals).map((axis) => [
  axis,
  `${palier167.partition[axis].complete}/${PALIER_TARGET}`,
]));
// The owner target is 100%-RÉSOLU = 0 UNKNOWN: every cell COMPLETE or N-A PROUVÉ.
// resolved = complete + N/A (an incomplete cell is NOT resolved). This is the
// number the palier is scored on; complete alone under-reports once N-A lands.
const palier167Resolved = Object.fromEntries(Object.keys(matrix.totals).map((axis) => [
  axis,
  `${palier167.partition[axis].complete + palier167.partition[axis]["N/A"]}/${PALIER_TARGET}`,
]));

// Handoff artifact for qa: per-axis partition over the 167 plus the per-city
// rows, so the qa matrix joins statuses on slug without re-deriving anything.
const PALIER_OUTPUT = `work/coverage/completion-regdens-palier167-${OUTPUT_DATE}.json`;
const palierHandoff = {
  contract: "completion-regdens-palier167/v1",
  as_of: OUTPUT_AS_OF,
  cohort: palierCohortSource.cohort,
  cohort_source: palierCohortSource.source,
  source_as_of: matrix.source_as_of,
  na_proofs: matrix.na_proofs,
  target: PALIER_TARGET,
  partition: palier167.partition,
  // resolved = complete + N-A PROUVÉ (the owner's 100%-RÉSOLU scoring line).
  resolved: palier167Resolved,
  unmatched: palier167.unmatched,
  // Per-axis gap lists (radar slug + resolved geo slug) so a campaign can shard
  // exactly the non-complete cities without re-deriving from the per-city rows.
  gaps: Object.fromEntries(Object.keys(matrix.totals).map((axis) => {
    const buckets = { unknown: [], incomplete: [] };
    for (const { slug } of palierRows) {
      const geoSlug = resolvePalierSlug(slug);
      const city = geoSlug === undefined ? undefined : cohortCities.get(geoSlug);
      if (city === undefined) continue;
      if (city[axis] === "unknown" || city[axis] === "incomplete") {
        buckets[city[axis]].push(geoSlug);
      }
    }
    return [axis, buckets];
  })),
  cities: palierRows.map(({ slug, priorityRank }) => {
    const geoSlug = resolvePalierSlug(slug);
    const city = geoSlug === undefined ? undefined : cohortCities.get(geoSlug);
    return {
      priorityRank,
      slug,
      geo_slug: geoSlug ?? null,
      aliased: geoSlug !== undefined && geoSlug !== slug,
      matched: city !== undefined,
      ...(city !== undefined
        ? Object.fromEntries(Object.keys(matrix.totals).map((axis) => [axis, city[axis]]))
        : {}),
    };
  }),
};

writeFileSync(absolute(OUTPUT), `${JSON.stringify(matrix, null, 2)}\n`);
writeFileSync(absolute(PERCITY_OUTPUT), `${JSON.stringify(perCity, null, 2)}\n`);
writeFileSync(absolute(PALIER_OUTPUT), `${JSON.stringify(palierHandoff, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUTPUT,
  per_city_output: PERCITY_OUTPUT,
  palier167_output: PALIER_OUTPUT,
  totals: matrix.totals,
  cohort_complete: cohortComplete,
  palier167_complete: palier167Complete,
  palier167_resolved: palier167Resolved,
  na_proofs: matrix.na_proofs,
  palier167_unmatched: palier167.unmatched,
  palier167_partition: palier167.partition,
}, null, 2));
