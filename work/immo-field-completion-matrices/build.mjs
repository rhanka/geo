#!/usr/bin/env node
/**
 * Build a deterministic, local-only Immo field-completion matrix.
 *
 * This deliberately consumes frozen local snapshots only.  It neither imports
 * the acquisition runner nor has a network, S3, deployment, or Track path.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MATRIX_SOURCE = resolve(ROOT, "work/coverage/coverage-matrix.json");
const IMMO_SOURCE = resolve(ROOT, "work/coverage/immo-lots.json");
const JSON_OUTPUT = resolve(HERE, "immo-field-completion-matrix.json");
const CSV_OUTPUT = resolve(HERE, "immo-field-completion-matrix.csv");

const EXPECTED_CITY_COUNT = 1106;
const EXPECTED_IMMO_SOURCE_ROW_COUNT = 877;
const STATUS_VALUES = new Set(["complete", "incomplete", "unknown", "N/A"]);
const FIELD_COLUMNS = ["lots_served", "surface_m2", "postal_code", "civic_address", "tod_applicability", "tod_completion"];

// These input spellings are duplicate source rows, not additional cities.  The
// exact city slug is preferred when both rows are present.  The audit below
// makes each duplicate visible and rejects any unrecognised source row.
const SOURCE_ALIAS_TO_CITY = Object.freeze({
  "l-assomption": "lassomption",
  "l-epiphanie": "lepiphanie",
  "sainte-christine-d-auvergne": "sainte-christine-dauvergne",
});

function fail(message) {
  throw new Error(`immo-field-completion-matrix: ${message}`);
}

function invariant(condition, message) {
  if (!condition) fail(message);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function readJson(path) {
  const text = readFileSync(path, "utf8");
  return { text, value: JSON.parse(text) };
}

function compareSlugs(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableNumber(value, label) {
  invariant(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`);
  return value;
}

function statusCell(status, reason, values = {}) {
  invariant(STATUS_VALUES.has(status), `unsupported status ${String(status)}`);
  invariant(typeof reason === "string" && reason.length > 0, `missing reason for ${status}`);
  return { status, reason, ...values };
}

function fieldCell(row, sourceField, label) {
  if (!row) {
    return statusCell("unknown", `No canonical local Immo perMuni stats row exists; ${label} cannot be measured.`, {
      observed_lots: null,
      completed_lots: null,
    });
  }

  const totalLots = stableNumber(row.numLots, `${row.slug}.numLots`);
  if (totalLots === 0) {
    return statusCell("N/A", `Canonical local Immo stats report zero lots; ${label} has no per-lot denominator.`, {
      observed_lots: 0,
      completed_lots: null,
    });
  }

  const completedLots = stableNumber(row.fieldNum?.[sourceField], `${row.slug}.fieldNum.${sourceField}`);
  invariant(completedLots <= totalLots, `${row.slug}.${sourceField} exceeds numLots`);
  if (completedLots === totalLots) {
    return statusCell("complete", `Local Immo stats report ${completedLots}/${totalLots} lots with ${label}.`, {
      observed_lots: totalLots,
      completed_lots: completedLots,
    });
  }
  return statusCell("incomplete", `Local Immo stats report ${completedLots}/${totalLots} lots with ${label}.`, {
    observed_lots: totalLots,
    completed_lots: completedLots,
  });
}

function lotsServedCell(row) {
  if (!row) {
    return statusCell("incomplete", "No canonical local Immo perMuni stats row is present in the served-lots snapshot.", {
      observed_lots: null,
    });
  }
  const totalLots = stableNumber(row.numLots, `${row.slug}.numLots`);
  const reason =
    totalLots === 0
      ? "Canonical local Immo perMuni stats row is present and reports zero lots."
      : `Canonical local Immo perMuni stats row is present and reports ${totalLots} served lots.`;
  return statusCell("complete", reason, { observed_lots: totalLots });
}

function todApplicabilityCell(city) {
  const tod = city.tod;
  if (!tod) {
    return statusCell("N/A", "The local coverage matrix has no TOD scope entry for this city.");
  }
  if (tod.status === "done") {
    return statusCell("complete", "The local coverage matrix declares TOD scope with status done.");
  }
  if (typeof tod.status === "string" && tod.status.length > 0) {
    return statusCell("incomplete", `The local coverage matrix declares TOD scope with status ${tod.status}.`);
  }
  return statusCell("unknown", "The local coverage matrix has a TOD entry without a usable status.");
}

function todCompletionCell(applicability, row) {
  if (applicability.status === "N/A") {
    return statusCell("N/A", "TOD is not applicable according to the local coverage matrix.", {
      observed_lots: null,
      joined_lots: null,
      in_tod_lots: null,
    });
  }
  if (applicability.status !== "complete") {
    return statusCell("unknown", "TOD applicability is not confirmed complete, so TOD completion cannot be measured.", {
      observed_lots: null,
      joined_lots: null,
      in_tod_lots: null,
    });
  }
  if (!row) {
    return statusCell("unknown", "TOD scope is confirmed, but no canonical local Immo perMuni stats row is available.", {
      observed_lots: null,
      joined_lots: null,
      in_tod_lots: null,
    });
  }

  const totalLots = stableNumber(row.numLots, `${row.slug}.numLots`);
  if (totalLots === 0) {
    return statusCell("N/A", "TOD scope is confirmed, but the canonical local Immo stats row has zero lots.", {
      observed_lots: 0,
      joined_lots: null,
      in_tod_lots: null,
    });
  }

  const joinedLots = stableNumber(row.fieldNum?.in_tod, `${row.slug}.fieldNum.in_tod`);
  const inTodLots = stableNumber(row.numInTod, `${row.slug}.numInTod`);
  invariant(joinedLots <= totalLots, `${row.slug}.in_tod exceeds numLots`);
  invariant(inTodLots <= totalLots, `${row.slug}.numInTod exceeds numLots`);
  if (row.todPresent === true && joinedLots === totalLots) {
    return statusCell(
      "complete",
      `Local Immo stats report a TOD join for ${joinedLots}/${totalLots} lots (${inTodLots} lots are in TOD).`,
      { observed_lots: totalLots, joined_lots: joinedLots, in_tod_lots: inTodLots },
    );
  }
  const state = row.todPresent === true ? "is partial" : "is absent";
  return statusCell(
    "incomplete",
    `Local Immo stats report the TOD join ${state}: ${joinedLots}/${totalLots} lots joined (${inTodLots} lots in TOD).`,
    { observed_lots: totalLots, joined_lots: joinedLots, in_tod_lots: inTodLots },
  );
}

function comparableImmoFields(row) {
  return {
    numLots: row.numLots,
    todPresent: row.todPresent,
    numInTod: row.numInTod,
    surface_m2: row.fieldNum?.surface_m2,
    code_postal: row.fieldNum?.code_postal,
    adresse: row.fieldNum?.adresse,
    in_tod: row.fieldNum?.in_tod,
  };
}

function makeReconciliation(cities, immoRows) {
  invariant(immoRows.length === EXPECTED_IMMO_SOURCE_ROW_COUNT, `expected ${EXPECTED_IMMO_SOURCE_ROW_COUNT} Immo rows, found ${immoRows.length}`);
  const sourceRows = new Map();
  for (const row of immoRows) {
    invariant(typeof row.slug === "string" && row.slug.length > 0, "Immo row has no slug");
    invariant(!sourceRows.has(row.slug), `duplicate identical Immo source slug ${row.slug}`);
    sourceRows.set(row.slug, row);
  }

  const canonicalRows = new Map();
  for (const slug of cities.keys()) {
    const row = sourceRows.get(slug);
    if (row) canonicalRows.set(slug, row);
  }

  const aliases = [];
  const unaccounted = [];
  for (const [sourceSlug, row] of sourceRows) {
    if (canonicalRows.get(sourceSlug) === row) continue;
    const citySlug = SOURCE_ALIAS_TO_CITY[sourceSlug];
    if (!citySlug || !cities.has(citySlug)) {
      unaccounted.push(sourceSlug);
      continue;
    }
    const canonical = canonicalRows.get(citySlug);
    invariant(canonical, `alias ${sourceSlug} has no exact canonical source row for ${citySlug}`);
    const sourceComparable = JSON.stringify(comparableImmoFields(row));
    const canonicalComparable = JSON.stringify(comparableImmoFields(canonical));
    invariant(
      sourceComparable === canonicalComparable,
      `alias ${sourceSlug} does not match canonical Immo fields for ${citySlug}`,
    );
    aliases.push({
      source_slug: sourceSlug,
      canonical_city_slug: citySlug,
      resolution: "noncanonical_duplicate_of_exact_city_slug",
      compared_fields: comparableImmoFields(row),
    });
  }
  invariant(unaccounted.length === 0, `unaccounted Immo source rows: ${unaccounted.join(", ")}`);
  invariant(aliases.length === Object.keys(SOURCE_ALIAS_TO_CITY).length, "alias reconciliation count drifted");
  invariant(canonicalRows.size + aliases.length === sourceRows.size, "Immo reconciliation does not account for every source row");

  return {
    canonical_immo_city_rows: canonicalRows.size,
    cities_without_immo_stats: cities.size - canonicalRows.size,
    immo_source_rows: sourceRows.size,
    noncanonical_duplicate_source_rows: aliases.length,
    noncanonical_duplicate_source_rows_detail: aliases.sort((a, b) => compareSlugs(a.source_slug, b.source_slug)),
    unaccounted_immo_source_rows: unaccounted,
    canonicalRows,
  };
}

function countStatuses(cities) {
  const byField = {};
  for (const field of FIELD_COLUMNS) {
    byField[field] = { complete: 0, incomplete: 0, unknown: 0, "N/A": 0 };
  }
  for (const city of cities) {
    for (const field of FIELD_COLUMNS) {
      const cell = city[field];
      invariant(cell && STATUS_VALUES.has(cell.status), `${city.slug}.${field} has invalid status`);
      invariant(typeof cell.reason === "string" && cell.reason.length > 0, `${city.slug}.${field} has no reason`);
      byField[field][cell.status]++;
    }
  }
  for (const field of FIELD_COLUMNS) {
    const total = Object.values(byField[field]).reduce((sum, count) => sum + count, 0);
    invariant(total === cities.length, `${field} summary does not cover every city`);
  }
  return byField;
}

function csvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(cities) {
  const columns = [
    "city_slug",
    "immo_source_slug",
    "lots_served_status",
    "lots_served_reason",
    "lots_served_observed_lots",
    "surface_m2_status",
    "surface_m2_reason",
    "surface_m2_observed_lots",
    "surface_m2_completed_lots",
    "postal_code_status",
    "postal_code_reason",
    "postal_code_observed_lots",
    "postal_code_completed_lots",
    "civic_address_status",
    "civic_address_reason",
    "civic_address_observed_lots",
    "civic_address_completed_lots",
    "tod_applicability_status",
    "tod_applicability_reason",
    "tod_completion_status",
    "tod_completion_reason",
    "tod_completion_observed_lots",
    "tod_completion_joined_lots",
    "tod_completion_in_tod_lots",
  ];
  const lines = [columns.join(",")];
  for (const city of cities) {
    const values = [
      city.slug,
      city.immo_source_slug,
      city.lots_served.status,
      city.lots_served.reason,
      city.lots_served.observed_lots,
      city.surface_m2.status,
      city.surface_m2.reason,
      city.surface_m2.observed_lots,
      city.surface_m2.completed_lots,
      city.postal_code.status,
      city.postal_code.reason,
      city.postal_code.observed_lots,
      city.postal_code.completed_lots,
      city.civic_address.status,
      city.civic_address.reason,
      city.civic_address.observed_lots,
      city.civic_address.completed_lots,
      city.tod_applicability.status,
      city.tod_applicability.reason,
      city.tod_completion.status,
      city.tod_completion.reason,
      city.tod_completion.observed_lots,
      city.tod_completion.joined_lots,
      city.tod_completion.in_tod_lots,
    ];
    lines.push(values.map(csvValue).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function buildArtifacts() {
  const coverageSource = readJson(MATRIX_SOURCE);
  const immoSource = readJson(IMMO_SOURCE);
  const coverage = coverageSource.value;
  const immo = immoSource.value;

  invariant(coverage.municipalityCount === EXPECTED_CITY_COUNT, `coverage matrix municipalityCount is not ${EXPECTED_CITY_COUNT}`);
  invariant(coverage.cities && typeof coverage.cities === "object", "coverage matrix has no cities object");
  const entries = Object.entries(coverage.cities).sort(([left], [right]) => compareSlugs(left, right));
  invariant(entries.length === EXPECTED_CITY_COUNT, `coverage matrix has ${entries.length} city rows, not ${EXPECTED_CITY_COUNT}`);
  invariant(immo.totalMunis === EXPECTED_CITY_COUNT, `Immo snapshot totalMunis is not ${EXPECTED_CITY_COUNT}`);
  invariant(Array.isArray(immo.perMuni), "Immo snapshot has no perMuni array");

  const citySource = new Map(entries);
  const reconciliation = makeReconciliation(citySource, immo.perMuni);
  const cities = entries.map(([slug, city]) => {
    const row = reconciliation.canonicalRows.get(slug);
    const todApplicability = todApplicabilityCell(city);
    if (row?.todPresent === true) {
      invariant(todApplicability.status === "complete", `${slug} has a TOD Immo row outside complete TOD scope`);
    }
    return {
      slug,
      immo_source_slug: row?.slug ?? null,
      lots_served: lotsServedCell(row),
      surface_m2: fieldCell(row, "surface_m2", "surface_m2"),
      postal_code: fieldCell(row, "code_postal", "code_postal"),
      civic_address: fieldCell(row, "adresse", "civic address"),
      tod_applicability: todApplicability,
      tod_completion: todCompletionCell(todApplicability, row),
    };
  });
  const byField = countStatuses(cities);

  const matrix = {
    $schema: "immo-field-completion-matrix/v1",
    deterministic: {
      build_timestamp: null,
      city_order: "slug ascending (code-point comparison)",
      source_policy: "local files only; no network, S3, deployment, or Track access",
      status_values: ["complete", "incomplete", "unknown", "N/A"],
    },
    source_files: [
      { path: relative(ROOT, MATRIX_SOURCE), sha256: sha256(coverageSource.text) },
      { path: relative(ROOT, IMMO_SOURCE), sha256: sha256(immoSource.text) },
    ],
    status_legend: {
      complete: "The local evidence confirms completion for the field's stated denominator.",
      incomplete: "The local evidence confirms a remaining gap or missing served-lots row.",
      unknown: "The local artifacts do not provide enough field evidence to classify completion.",
      "N/A": "The field has no applicable scope or no per-lot denominator.",
    },
    city_count: cities.length,
    reconciliation: {
      canonical_immo_city_rows: reconciliation.canonical_immo_city_rows,
      cities_without_immo_stats: reconciliation.cities_without_immo_stats,
      immo_source_rows: reconciliation.immo_source_rows,
      noncanonical_duplicate_source_rows: reconciliation.noncanonical_duplicate_source_rows,
      noncanonical_duplicate_source_rows_detail: reconciliation.noncanonical_duplicate_source_rows_detail,
      unaccounted_immo_source_rows: reconciliation.unaccounted_immo_source_rows,
    },
    summary: { by_field_status: byField },
    cities,
  };

  return { json: `${JSON.stringify(matrix, null, 2)}\n`, csv: toCsv(cities), matrix };
}

function main() {
  const argv = process.argv.slice(2);
  invariant(argv.length <= 1 && (argv.length === 0 || argv[0] === "--check"), "usage: node build.mjs [--check]");
  const { json, csv, matrix } = buildArtifacts();
  if (argv[0] === "--check") {
    invariant(existsSync(JSON_OUTPUT), `missing output ${relative(ROOT, JSON_OUTPUT)}`);
    invariant(existsSync(CSV_OUTPUT), `missing output ${relative(ROOT, CSV_OUTPUT)}`);
    invariant(readFileSync(JSON_OUTPUT, "utf8") === json, "JSON output is not deterministic or is stale");
    invariant(readFileSync(CSV_OUTPUT, "utf8") === csv, "CSV output is not deterministic or is stale");
    console.log(
      `PASS immo field matrix: ${matrix.city_count}/${EXPECTED_CITY_COUNT} cities; ` +
        `${matrix.reconciliation.immo_source_rows} Immo rows accounted for; ` +
        `${matrix.reconciliation.unaccounted_immo_source_rows.length} unaccounted source rows.`,
    );
    return;
  }
  writeFileSync(JSON_OUTPUT, json);
  writeFileSync(CSV_OUTPUT, csv);
  console.log(`WROTE ${relative(ROOT, JSON_OUTPUT)} and ${relative(ROOT, CSV_OUTPUT)} (${matrix.city_count} cities).`);
}

main();
