#!/usr/bin/env node

/**
 * Build a deterministic, local-only city-level PV completion audit.
 *
 * Inputs are deliberately fixed to the canonical city list and local coverage
 * matrix.  No network, S3, deployment, Track, clock, or random input is used.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_MUNICIPALITIES = 1106;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PATHS = {
  coverage: 'work/coverage/coverage-matrix.json',
  identities: 'packages/qc-sources/src/geo/municipalities.qc.json',
  directory: 'packages/qc-sources/src/geo/qc-municipal-directory.json',
  audit: 'work/coverage/pv-completion-city-audit.json',
  report: 'work/coverage/PV-COMPLETION-CITY-AUDIT.md',
  openCities: 'work/coverage/pv-completion-open-cities.csv',
};

const STATE_ORDER = ['complete', 'incomplete', 'unknown', 'N-A'];
const SOURCE_STATUS_TO_STATE = new Map([
  ['done', 'complete'],
  ['planned', 'incomplete'],
  ['to-research', 'unknown'],
]);

function fail(message) {
  throw new Error(`PV completion audit: ${message}`);
}

function absolute(relativePath) {
  return resolve(ROOT, relativePath);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(absolute(relativePath), 'utf8'));
}

function sha256(relativePath) {
  return `sha256:${createHash('sha256').update(readFileSync(absolute(relativePath))).digest('hex')}`;
}

function sorted(values, compare = (left, right) => left.localeCompare(right, 'fr')) {
  return [...values].sort(compare);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

function csv(value) {
  const string = value == null ? '' : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function stateFor(city, pv) {
  if (city.excluded) return 'N-A';
  const state = SOURCE_STATUS_TO_STATE.get(pv.status);
  assert(state, `unsupported PV status ${JSON.stringify(pv.status)} for ${city.slug}`);
  return state;
}

function reasonFor(state, pv, city) {
  switch (state) {
    case 'complete':
      return 'coverage PV status is done';
    case 'incomplete':
      return 'coverage PV status is planned; planned is not complete';
    case 'unknown':
      return 'coverage PV status is to-research; research is not complete';
    case 'N-A':
      return `canonical city exclusion: ${city.excludedReason}`;
    default:
      fail(`missing audit reason for ${state}`);
  }
}

function renderMarkdown(audit) {
  const stateRows = STATE_ORDER.map((state) => `| ${state} | ${audit.summary.states[state]} | ${audit.summary.targetMunicipalities} |`);
  const openRows = audit.openCityList.map((city) => (
    `| ${city.name} | \`${city.slug}\` | ${city.mrc ?? '—'} | ${city.state} | \`${city.sourceStatus}\` | ${city.sourceAsOf} | ${city.reason} |`
  ));
  const naRows = audit.naCityList.map((city) => (
    `| ${city.name} | \`${city.slug}\` | ${city.mrc ?? '—'} | ${city.reason} | ${city.sourceAsOf} |`
  ));

  return [
    '# PV completion audit — Québec municipalities',
    '',
    `Deterministic, local-only audit. Status authority: \`${PATHS.coverage}\` as of ${audit.asOf}. `
      + 'No network, S3, deployment, or Track operation was used.',
    '',
    '## Result',
    '',
    '| State | Cities | Target |',
    '|---|---:|---:|',
    ...stateRows,
    `| Open (incomplete + unknown) | ${audit.summary.openCities} | ${audit.summary.targetMunicipalities} |`,
    '',
    `The target remains **${audit.summary.targetMunicipalities} municipalities**. `
      + `${audit.summary.inScopeMunicipalities} are in scope after the two explicit N-A pilot-city exclusions; `
      + 'N-A cities remain in the target and matrix.',
    '',
    '## State rules',
    '',
    '- `complete`: local coverage PV status is `done` and the canonical city is not excluded.',
    '- `incomplete`: local coverage PV status is `planned`; planned work receives no completion credit.',
    '- `unknown`: local coverage PV status is `to-research`; research receives no completion credit.',
    '- `N-A`: the canonical city list explicitly excludes the municipality (`pilot-city-*`). This state takes precedence over a coverage status.',
    '',
    'Local PV probe/research artifacts are not promotion evidence. A probe result cannot change `planned` or `to-research` to `complete` in this audit.',
    '',
    '## Exact-universe validation',
    '',
    `- Canonical city identities: ${audit.validation.identityCount}/${TARGET_MUNICIPALITIES}; duplicate slugs: ${audit.validation.duplicateSlugs.length}.`,
    `- Coverage PV rows: ${audit.validation.coverageCount}/${TARGET_MUNICIPALITIES}; canonical-only slugs: ${audit.validation.identityOnlySlugs.length}; coverage-only slugs: ${audit.validation.coverageOnlySlugs.length}.`,
    `- Directory registry cross-check: registry total ${audit.validation.directoryRegistryTotal}; matched entries ${audit.validation.directoryMatched}; unmatched entries ${audit.validation.directoryUnmatched}.`,
    `- State partition: ${audit.validation.stateTotal}/${TARGET_MUNICIPALITIES}; every city has exactly one explicit state.`,
    '',
    '## Sources and as-of',
    '',
    `- PV status: \`${PATHS.coverage}\`, generated ${audit.sources.coverage.asOf}, ${audit.sources.coverage.sha256}.`,
    `- Canonical city identity and N-A rule: \`${PATHS.identities}\`, ${audit.sources.identities.sha256}. This source embeds no generated-at field.`,
    `- Municipal registry cross-check: \`${PATHS.directory}\`, generated ${audit.sources.directory.asOf}, ${audit.sources.directory.sha256}; source ${audit.sources.directory.source.name}.`,
    '',
    'The JSON matrix contains all 1,106 city identities, their source status/as-of, audit state, and basis. The CSV below is the explicit actionable open-city list.',
    '',
    `- Full matrix: \`${PATHS.audit}\``,
    `- Open-city CSV: \`${PATHS.openCities}\``,
    '',
    '## Open city list',
    '',
    '| Municipality | Slug | MRC | State | Local PV status | Status as-of | Basis |',
    '|---|---|---|---|---|---|---|',
    ...openRows,
    '',
    '## N-A cities (retained in target)',
    '',
    '| Municipality | Slug | MRC | Basis | Status as-of |',
    '|---|---|---|---|---|',
    ...naRows,
    '',
    '## Reproduce',
    '',
    '```bash',
    'node scripts/audit-pv-completion.mjs',
    '```',
    '',
  ].join('\n');
}

function main() {
  const coverage = readJson(PATHS.coverage);
  const identities = readJson(PATHS.identities);
  const directory = readJson(PATHS.directory);

  assert(coverage.$schema === 'qc-coverage-matrix/v1', 'unexpected coverage schema');
  assert(coverage.municipalityCount === TARGET_MUNICIPALITIES, `coverage target must be ${TARGET_MUNICIPALITIES}`);
  assert(typeof coverage.generatedAt === 'string', 'coverage generatedAt is required');
  assert(Array.isArray(identities), 'canonical identities must be an array');
  assert(identities.length === TARGET_MUNICIPALITIES, `identity target must be ${TARGET_MUNICIPALITIES}`);
  assert(directory.$schema === 'qc-municipal-directory/v1', 'unexpected municipal directory schema');
  assert(directory.stats?.registryTotal === TARGET_MUNICIPALITIES, `directory registry target must be ${TARGET_MUNICIPALITIES}`);
  assert(directory.stats?.matched === Object.keys(directory.entries ?? {}).length, 'directory matched count must equal entry count');

  const identityBySlug = new Map();
  for (const city of identities) {
    assert(typeof city?.slug === 'string' && city.slug.length > 0, 'each city needs a slug');
    assert(typeof city.name === 'string' && city.name.length > 0, `city ${city.slug} needs a name`);
    assert(!identityBySlug.has(city.slug), `duplicate identity slug ${city.slug}`);
    assert(typeof city.excluded === 'boolean', `city ${city.slug} needs an excluded flag`);
    if (city.excluded) assert(typeof city.excludedReason === 'string' && city.excludedReason.length > 0, `excluded city ${city.slug} needs a reason`);
    identityBySlug.set(city.slug, city);
  }

  const coverageSlugs = new Set(Object.keys(coverage.cities ?? {}));
  const identitySlugs = new Set(identityBySlug.keys());
  const coverageOnlySlugs = sorted(setDifference(coverageSlugs, identitySlugs));
  const identityOnlySlugs = sorted(setDifference(identitySlugs, coverageSlugs));
  assert(coverageSlugs.size === TARGET_MUNICIPALITIES, `coverage has ${coverageSlugs.size} city rows, expected ${TARGET_MUNICIPALITIES}`);
  assert(coverageOnlySlugs.length === 0, `coverage has non-canonical city slugs: ${coverageOnlySlugs.join(', ')}`);
  assert(identityOnlySlugs.length === 0, `canonical cities missing from coverage: ${identityOnlySlugs.join(', ')}`);

  const cities = sorted(identities, (left, right) => left.slug.localeCompare(right.slug)).map((city) => {
    const pv = coverage.cities[city.slug]?.pv;
    assert(pv && typeof pv === 'object', `city ${city.slug} has no PV status`);
    assert(typeof pv.status === 'string', `city ${city.slug} has no PV source status`);
    assert(typeof pv.lastResearchAt === 'string', `city ${city.slug} has no PV status as-of`);

    const state = stateFor(city, pv);
    return {
      slug: city.slug,
      name: city.name,
      mrc: city.mrc,
      state,
      reason: reasonFor(state, pv, city),
      identity: {
        source: PATHS.identities,
        registryCrossCheck: {
          source: PATHS.directory,
          asOf: directory.generatedAt,
          matched: Object.hasOwn(directory.entries, city.slug),
        },
        excluded: city.excluded,
        excludedReason: city.excludedReason,
      },
      pvStatus: {
        source: PATHS.coverage,
        sourceStatus: pv.status,
        asOf: pv.lastResearchAt,
        notes: pv.notes ?? null,
      },
    };
  });

  const states = Object.fromEntries(STATE_ORDER.map((state) => [state, 0]));
  for (const city of cities) states[city.state] += 1;
  const stateTotal = Object.values(states).reduce((total, count) => total + count, 0);
  assert(stateTotal === TARGET_MUNICIPALITIES, `state total ${stateTotal} must equal ${TARGET_MUNICIPALITIES}`);

  const openCityList = cities
    .filter((city) => city.state === 'incomplete' || city.state === 'unknown')
    .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
    .map((city) => ({
      slug: city.slug,
      name: city.name,
      mrc: city.mrc,
      state: city.state,
      reason: city.reason,
      sourceStatus: city.pvStatus.sourceStatus,
      sourceAsOf: city.pvStatus.asOf,
    }));
  const naCityList = cities
    .filter((city) => city.state === 'N-A')
    .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
    .map((city) => ({
      slug: city.slug,
      name: city.name,
      mrc: city.mrc,
      state: city.state,
      reason: city.reason,
      sourceStatus: city.pvStatus.sourceStatus,
      sourceAsOf: city.pvStatus.asOf,
    }));

  const audit = {
    $schema: 'qc-pv-completion-city-audit/v1',
    title: 'PV completion audit — Québec municipalities',
    deterministic: true,
    localOnly: true,
    asOf: coverage.generatedAt,
    targetMunicipalities: TARGET_MUNICIPALITIES,
    stateRules: {
      complete: 'coverage PV status is done and the canonical city is not excluded',
      incomplete: 'coverage PV status is planned; planned is not complete',
      unknown: 'coverage PV status is to-research; research is not complete',
      'N-A': 'canonical city is explicitly excluded; N-A takes precedence over coverage status and remains in the 1,106 target',
    },
    nonPromotionRule: 'Local PV probes and research artifacts do not promote a planned or to-research city to complete.',
    sources: {
      coverage: {
        path: PATHS.coverage,
        asOf: coverage.generatedAt,
        sha256: sha256(PATHS.coverage),
      },
      identities: {
        path: PATHS.identities,
        asOf: null,
        asOfNote: 'The canonical identity list does not embed a generated-at field.',
        sha256: sha256(PATHS.identities),
      },
      directory: {
        path: PATHS.directory,
        asOf: directory.generatedAt,
        sha256: sha256(PATHS.directory),
        source: directory.source,
      },
    },
    summary: {
      targetMunicipalities: TARGET_MUNICIPALITIES,
      inScopeMunicipalities: TARGET_MUNICIPALITIES - states['N-A'],
      states,
      openCities: openCityList.length,
    },
    validation: {
      identityCount: identities.length,
      coverageCount: coverageSlugs.size,
      duplicateSlugs: [],
      coverageOnlySlugs,
      identityOnlySlugs,
      directoryRegistryTotal: directory.stats.registryTotal,
      directoryMatched: directory.stats.matched,
      directoryUnmatched: directory.stats.unmatched,
      stateTotal,
    },
    cities,
    openCityList,
    naCityList,
  };

  const csvRows = [
    ['name', 'slug', 'mrc', 'state', 'source_status', 'source_as_of', 'basis'],
    ...openCityList.map((city) => [city.name, city.slug, city.mrc, city.state, city.sourceStatus, city.sourceAsOf, city.reason]),
  ];
  const json = `${JSON.stringify(audit, null, 2)}\n`;
  const markdown = renderMarkdown(audit);
  const openCitiesCsv = `${csvRows.map((row) => row.map(csv).join(',')).join('\n')}\n`;

  writeFileSync(absolute(PATHS.audit), json);
  writeFileSync(absolute(PATHS.report), markdown);
  writeFileSync(absolute(PATHS.openCities), openCitiesCsv);

  process.stdout.write(`${PATHS.audit}\n${PATHS.report}\n${PATHS.openCities}\n`);
}

main();
