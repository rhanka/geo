#!/usr/bin/env node
/**
 * Local-only, deterministic completion matrices for Zones and Normes.
 *
 * This intentionally reads immutable/shared coverage artifacts and writes only
 * the four Completion 1 deliverables named below. It does not fetch, call S3,
 * invoke a model, or edit Track.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANALYSIS_AS_OF = "2026-07-23";
const CITY_TARGET = 1106;
const ALLOWED_STATES = new Set(["complete", "incomplete", "unknown", "N-A"]);

const INPUTS = {
  coverage: "work/coverage/coverage-matrix.json",
  zones: "work/coverage/zone-provenance-status-manifest-20260722.json",
  normes: "work/zonage-norms/manifest-current.json",
  normesProvenance: "work/coverage/normes-provenance.json",
};

const OUTPUTS = {
  zonesMatrix: "work/coverage/completion-1-zones-matrix-20260723.json",
  normesMatrix: "work/coverage/completion-1-normes-matrix-20260723.json",
  summaryJson: "work/coverage/completion-1-zones-normes-summary-20260723.json",
  summaryMarkdown: "work/coverage/completion-1-zones-normes-summary-20260723.md",
};

function absolute(relativePath) {
  return resolve(REPO_ROOT, relativePath);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(absolute(relativePath), "utf8"));
}

function sha256(relativePath) {
  return createHash("sha256").update(readFileSync(absolute(relativePath))).digest("hex");
}

function writeJson(relativePath, value) {
  writeFileSync(absolute(relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function invariant(condition, message) {
  if (!condition) throw new Error(`Validation failed: ${message}`);
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function sortedUnique(values, label) {
  const unique = [...new Set(values)].sort();
  invariant(unique.length === values.length, `${label} contains duplicate identifiers`);
  return unique;
}

function sameMembers(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function range(values) {
  const present = values.filter((value) => typeof value === "string" && value.length > 0).sort();
  return { min: present[0] ?? null, max: present.at(-1) ?? null };
}

function statusCounts(rows) {
  const counts = { complete: 0, incomplete: 0, unknown: 0, "N-A": 0 };
  for (const row of rows) counts[row.state] += 1;
  return counts;
}

function normalizeZoneEvidence(manifest) {
  invariant(Array.isArray(manifest.row_fields), "Zones manifest row_fields must be an array");
  invariant(Array.isArray(manifest.rows), "Zones manifest rows must be an array");
  const index = Object.fromEntries(manifest.row_fields.map((field, position) => [field, position]));
  for (const field of [
    "slug",
    "collection_key",
    "layout",
    "features",
    "registry_status",
    "provenance_state",
    "source_origin",
    "source_identity_ref",
    "evidence_refs",
    "v2_acquisition_readiness",
    "lots_impact_ref",
    "lots_impact_state",
    "rollout_policy",
  ]) {
    invariant(Number.isInteger(index[field]), `Zones manifest is missing ${field}`);
  }

  const entries = manifest.rows.map((row) => ({
    slug: row[index.slug],
    collection_key: row[index.collection_key],
    layout: row[index.layout],
    features: row[index.features],
    registry_status: row[index.registry_status],
    provenance_state: row[index.provenance_state],
    source_origin: row[index.source_origin],
    source_identity_ref: row[index.source_identity_ref],
    evidence_refs: row[index.evidence_refs],
    v2_acquisition_readiness: row[index.v2_acquisition_readiness],
    lots_impact_ref: row[index.lots_impact_ref],
    lots_impact_state: row[index.lots_impact_state],
    rollout_policy: row[index.rollout_policy],
  }));
  const slugs = sortedUnique(entries.map(({ slug }) => slug), "Zones manifest");
  return { bySlug: new Map(entries.map((entry) => [entry.slug, entry])), slugs };
}

function normalizeNormesEvidence(manifest, provenance) {
  invariant(Array.isArray(manifest), "Normes manifest must be an array");
  invariant(Array.isArray(provenance.rows), "Normes provenance rows must be an array");

  const manifestSlugs = sortedUnique(manifest.map(({ slug }) => slug), "Normes manifest");
  const provenanceSlugs = sortedUnique(provenance.rows.map(({ slug }) => slug), "Normes provenance");
  const provenanceBySlug = new Map(provenance.rows.map((entry) => [entry.slug, entry]));
  const evidence = manifest.map((entry) => {
    const retest = provenanceBySlug.get(entry.slug) ?? null;
    const unavailableSourceUrl = entry.source_url === null
      || entry.source_url === ""
      || entry.source_url === "non-disponible";
    return {
      slug: entry.slug,
      present: entry.present === true,
      source_url: entry.source_url,
      source_url_available: !unavailableSourceUrl,
      snapshot: entry.snapshot ?? null,
      methode: entry.methode ?? null,
      zone_rows: entry.zone_rows ?? null,
      unique_zone_codes: entry.unique_zone_codes ?? null,
      published_field_pct: entry.published_field_pct ?? null,
      crossval: entry.crossval ?? null,
      retest: retest === null ? null : {
        retested_at: retest.retested_at ?? null,
        winner: retest.winner ?? null,
        deposited: retest.deposited ?? null,
        invention_ok: retest.invention_ok ?? null,
        raison_si_garde: retest.raison_si_garde ?? null,
      },
    };
  });
  return {
    bySlug: new Map(evidence.map((entry) => [entry.slug, entry])),
    manifestSlugs,
    provenanceSlugs,
  };
}

function sourceCatalog(coverage, zonesManifest, normesManifest, normesProvenance) {
  const cityValues = Object.values(coverage.cities);
  return [
    {
      id: "coverage_matrix",
      path: INPUTS.coverage,
      sha256: sha256(INPUTS.coverage),
      declared_as_of: coverage.generatedAt ?? null,
      status_research_range: {
        zones: range(cityValues.map((city) => city.zones?.lastResearchAt)),
        normes: range(cityValues.map((city) => city.normes?.lastResearchAt)),
      },
      role: "portfolio denominator and base completion status",
    },
    {
      id: "zones_provenance_manifest",
      path: INPUTS.zones,
      sha256: sha256(INPUTS.zones),
      declared_as_of: zonesManifest.as_of ?? null,
      role: "local served-zone collection corroboration and provenance caveats",
    },
    {
      id: "normes_manifest_current",
      path: INPUTS.normes,
      sha256: sha256(INPUTS.normes),
      declared_as_of: range(normesManifest.map((entry) => entry.snapshot)),
      role: "local norms extraction manifest corroboration",
    },
    {
      id: "normes_provenance",
      path: INPUTS.normesProvenance,
      sha256: sha256(INPUTS.normesProvenance),
      declared_as_of: range(normesProvenance.rows.map((entry) => entry.retested_at)),
      role: "local two-engine retest outcome; an error prevents a complete claim",
    },
  ];
}

function zoneRow(slug, base, evidence) {
  const matrixDone = base.status === "done";
  const corroborated = evidence !== undefined;
  let state;
  let reconciliation;
  if (matrixDone && corroborated) {
    state = "complete";
    reconciliation = "matrix_done_and_local_served_collection";
  } else if (!matrixDone && !corroborated) {
    state = "incomplete";
    reconciliation = "matrix_to_research_and_no_local_served_collection";
  } else if (matrixDone) {
    state = "unknown";
    reconciliation = "matrix_done_but_unconfirmed_by_local_served_collection";
  } else {
    state = "unknown";
    reconciliation = "local_served_collection_conflicts_with_matrix_to_research";
  }
  return {
    slug,
    state,
    completion_gate: {
      matrix_status: base.status,
      local_served_collection: corroborated,
      retest_conflict: false,
      complete_rule_satisfied: state === "complete",
    },
    reconciliation,
    base_coverage: {
      status: base.status,
      done_track: base.doneTrack ?? null,
      last_research_at: base.lastResearchAt ?? null,
    },
    local_evidence: evidence ?? null,
    quality_caveat: evidence === undefined ? null : {
      provenance_state: evidence.provenance_state,
      v2_acquisition_readiness: evidence.v2_acquisition_readiness,
      rollout_policy: evidence.rollout_policy,
      note: "Quality/provenance is recorded separately from completion; v2_acquisition_readiness=not-assessed is never represented as v2 proof.",
    },
  };
}

function normesRow(slug, base, evidence) {
  const matrixDone = base.status === "done";
  const corroborated = evidence?.present === true;
  const retestConflict = evidence?.retest?.winner === "error";
  let state;
  let reconciliation;
  if (matrixDone && corroborated && !retestConflict) {
    state = "complete";
    reconciliation = "matrix_done_and_local_manifest_present";
  } else if (!matrixDone && !corroborated) {
    state = "incomplete";
    reconciliation = "matrix_to_research_and_no_local_manifest";
  } else if (retestConflict) {
    state = "unknown";
    reconciliation = "local_retest_error_prevents_complete_claim";
  } else if (matrixDone) {
    state = "unknown";
    reconciliation = "matrix_done_but_unconfirmed_by_local_manifest";
  } else {
    state = "unknown";
    reconciliation = "local_manifest_conflicts_with_matrix_to_research";
  }
  return {
    slug,
    state,
    completion_gate: {
      matrix_status: base.status,
      local_manifest_present: corroborated,
      retest_conflict: retestConflict,
      complete_rule_satisfied: state === "complete",
    },
    reconciliation,
    base_coverage: {
      status: base.status,
      done_track: base.doneTrack ?? null,
      last_research_at: base.lastResearchAt ?? null,
    },
    local_evidence: evidence ?? null,
    quality_caveat: evidence === undefined ? null : {
      source_url_available: evidence.source_url_available,
      note: evidence.source_url_available
        ? null
        : "The local manifest records an extraction, but its source URL is unavailable/non-disponible; this is preserved as a provenance caveat rather than silently invented.",
    },
  };
}

function makeMatrix({ lane, citySlugs, rows, sources, sourceExtras, completionRule }) {
  const states = statusCounts(rows);
  invariant(rows.length === CITY_TARGET, `${lane} output has exactly ${CITY_TARGET} city rows`);
  invariant(sameMembers(rows.map(({ slug }) => slug), citySlugs), `${lane} output city keys differ from portfolio universe`);
  for (const row of rows) {
    invariant(ALLOWED_STATES.has(row.state), `${lane}/${row.slug} has an invalid state`);
    invariant(row.state !== "complete" || row.completion_gate.complete_rule_satisfied, `${lane}/${row.slug} is complete without its gate`);
    invariant(row.state === "complete" || !row.completion_gate.complete_rule_satisfied, `${lane}/${row.slug} has a satisfied complete gate but is not complete`);
  }
  return {
    contract: "geo-completion-city-matrix/v1",
    lane,
    analysis_as_of: ANALYSIS_AS_OF,
    execution: {
      mode: "local-cpu-only",
      network: false,
      s3: false,
      deployment: false,
      track_edits: false,
    },
    city_universe: {
      target: CITY_TARGET,
      actual: rows.length,
      exact: true,
      source: INPUTS.coverage,
    },
    allowed_states: ["complete", "incomplete", "unknown", "N-A"],
    completion_rule: completionRule,
    sources,
    source_rows_not_matched_to_city_universe: sourceExtras,
    state_counts: states,
    cities: rows,
  };
}

function deficitPriority(row) {
  const priorities = {
    local_retest_error_prevents_complete_claim: 0,
    local_served_collection_conflicts_with_matrix_to_research: 1,
    local_manifest_conflicts_with_matrix_to_research: 1,
    matrix_done_but_unconfirmed_by_local_served_collection: 2,
    matrix_done_but_unconfirmed_by_local_manifest: 2,
    matrix_to_research_and_no_local_served_collection: 3,
    matrix_to_research_and_no_local_manifest: 3,
  };
  return priorities[row.reconciliation] ?? 9;
}

function topDeficits(rows) {
  return rows
    .filter((row) => row.state !== "complete" && row.state !== "N-A")
    .sort((left, right) => deficitPriority(left) - deficitPriority(right)
      || left.slug.localeCompare(right.slug))
    .slice(0, 25)
    .map((row) => ({
      slug: row.slug,
      state: row.state,
      reconciliation: row.reconciliation,
      matrix_status: row.base_coverage.status,
      source_url_available: row.local_evidence?.source_url_available ?? null,
      retest_winner: row.local_evidence?.retest?.winner ?? null,
    }));
}

function markdownTable(rows) {
  return rows.map((row) => `| ${row.state} | ${row.slug} | ${row.reconciliation} |`).join("\n");
}

function makeMarkdown(summary) {
  const sourceLines = summary.sources.map((source) => {
    const asOf = typeof source.declared_as_of === "string"
      ? source.declared_as_of
      : JSON.stringify(source.declared_as_of);
    return `| ${source.id} | \`${source.path}\` | ${asOf} | \`${source.sha256}\` |`;
  }).join("\n");
  return `# Completion 1 — Zones et Normes\n\n`
    + `Analyse locale déterministe au **${summary.analysis_as_of}**. Aucun réseau, S3, déploiement ni écriture Track.\n\n`
    + `Une ville est \`complete\` seulement si son statut portefeuille est \`done\` et si l’artefact local correspondant le corrobore; pour Normes, un \`winner=error\` de revalidation force \`unknown\`. \`unknown\` n’est jamais compté comme \`complete\`. Aucun \`N-A\` n’a été inféré.\n\n`
    + `## Validation\n\n`
    + `- Univers portefeuille : **${summary.validation.city_universe.actual}/${summary.validation.city_universe.target}** villes, exact.\n`
    + `- Matrice Zones : **${summary.validation.zones_rows}** lignes; matrice Normes : **${summary.validation.normes_rows}** lignes.\n`
    + `- Toutes les lignes sont dans \`complete|incomplete|unknown|N-A\`; les portes \`complete\` sont validées.\n\n`
    + `## Résumé\n\n`
    + `| Couche | Complete | Incomplete | Unknown | N-A |\n`
    + `|---|---:|---:|---:|---:|\n`
    + `| Zones | ${summary.lanes.zones.state_counts.complete} | ${summary.lanes.zones.state_counts.incomplete} | ${summary.lanes.zones.state_counts.unknown} | ${summary.lanes.zones.state_counts["N-A"]} |\n`
    + `| Normes | ${summary.lanes.normes.state_counts.complete} | ${summary.lanes.normes.state_counts.incomplete} | ${summary.lanes.normes.state_counts.unknown} | ${summary.lanes.normes.state_counts["N-A"]} |\n\n`
    + `Les statuts de provenance Zones (orphan/candidate, v2 non évalué) restent des avertissements de qualité distincts de cette mesure de présence/couverture; ils ne sont jamais promus en preuve v2.\n\n`
    + `## Sources et as-of\n\n`
    + `| Source | Chemin | As-of déclaré | SHA-256 |\n`
    + `|---|---|---|---|\n${sourceLines}\n\n`
    + `## Écarts de source non appariés\n\n`
    + `- Zones : ${summary.lanes.zones.source_rows_not_matched_to_city_universe.length} lignes locales non appariées à l’univers portefeuille : ${summary.lanes.zones.source_rows_not_matched_to_city_universe.map((entry) => `\`${entry}\``).join(", ") || "—"}.\n`
    + `- Normes : ${summary.lanes.normes.source_rows_not_matched_to_city_universe.length} lignes locales non appariées à l’univers portefeuille : ${summary.lanes.normes.source_rows_not_matched_to_city_universe.map((entry) => `\`${entry}\``).join(", ") || "—"}.\n\n`
    + `## Top 25 déficits — Zones\n\n`
    + `| État | Ville | Règle de réconciliation |\n`
    + `|---|---|---|\n${markdownTable(summary.lanes.zones.top_deficits)}\n\n`
    + `## Top 25 déficits — Normes\n\n`
    + `| État | Ville | Règle de réconciliation |\n`
    + `|---|---|---|\n${markdownTable(summary.lanes.normes.top_deficits)}\n`;
}

const coverage = readJson(INPUTS.coverage);
const zonesManifest = readJson(INPUTS.zones);
const normesManifest = readJson(INPUTS.normes);
const normesProvenance = readJson(INPUTS.normesProvenance);

invariant(coverage.municipalityCount === CITY_TARGET, "coverage matrix municipalityCount must equal 1106");
invariant(coverage.cities && typeof coverage.cities === "object", "coverage matrix cities must be an object");
const citySlugs = sortedUnique(Object.keys(coverage.cities), "coverage matrix cities");
invariant(citySlugs.length === CITY_TARGET, "coverage matrix must contain exactly 1106 city keys");
for (const slug of citySlugs) {
  invariant(coverage.cities[slug].zones && coverage.cities[slug].normes, `${slug} lacks a Zones or Normes coverage entry`);
}

const zones = normalizeZoneEvidence(zonesManifest);
const normes = normalizeNormesEvidence(normesManifest, normesProvenance);
const sources = sourceCatalog(coverage, zonesManifest, normesManifest, normesProvenance);
const citySet = new Set(citySlugs);

const zoneRows = citySlugs.map((slug) => zoneRow(slug, coverage.cities[slug].zones, zones.bySlug.get(slug)));
const normesRows = citySlugs.map((slug) => normesRow(slug, coverage.cities[slug].normes, normes.bySlug.get(slug)));
const unmatchedZones = zones.slugs.filter((slug) => !citySet.has(slug));
const unmatchedNormes = normes.manifestSlugs.filter((slug) => !citySet.has(slug));
const unmatchedNormesProvenance = normes.provenanceSlugs.filter((slug) => !citySet.has(slug));

const zonesMatrix = makeMatrix({
  lane: "zones",
  citySlugs,
  rows: zoneRows,
  sources,
  sourceExtras: unmatchedZones,
  completionRule: {
    complete: "coverage-matrix zones.status=done AND an exact-slug row exists in the local zone provenance manifest",
    incomplete: "coverage-matrix zones.status is not done AND no exact-slug local zone provenance row exists",
    unknown: "all remaining cases; this includes a done base status without local corroboration and any contradictory evidence",
    na: "only explicit source evidence could produce N-A; no such evidence exists in these inputs",
  },
});
const normesMatrix = makeMatrix({
  lane: "normes",
  citySlugs,
  rows: normesRows,
  sources,
  sourceExtras: unmatchedNormes,
  completionRule: {
    complete: "coverage-matrix normes.status=done AND manifest-current present=true AND the matching local retest winner is not error",
    incomplete: "coverage-matrix normes.status is not done AND no exact-slug manifest-current row with present=true exists",
    unknown: "all remaining cases; a local retest winner=error always prevents a complete claim",
    na: "only explicit source evidence could produce N-A; no such evidence exists in these inputs",
  },
});

const summary = {
  contract: "geo-completion-1-summary/v1",
  analysis_as_of: ANALYSIS_AS_OF,
  execution: zonesMatrix.execution,
  sources,
  validation: {
    city_universe: { target: CITY_TARGET, actual: citySlugs.length, exact: true },
    zones_rows: zoneRows.length,
    normes_rows: normesRows.length,
    zones_and_normes_city_sets_match: sameMembers(zoneRows.map(({ slug }) => slug), normesRows.map(({ slug }) => slug)),
    allowed_states_only: [...zoneRows, ...normesRows].every((row) => ALLOWED_STATES.has(row.state)),
    unknown_never_complete: [...zoneRows, ...normesRows].every((row) => row.state !== "unknown" || !row.completion_gate.complete_rule_satisfied),
  },
  lanes: {
    zones: {
      state_counts: statusCounts(zoneRows),
      base_status_counts: countBy(zoneRows.map((row) => row.base_coverage.status)),
      local_manifest_matches: zoneRows.filter((row) => row.local_evidence !== null).length,
      source_rows_not_matched_to_city_universe: unmatchedZones,
      quality_caveat_counts: countBy(zoneRows
        .map((row) => row.local_evidence?.v2_acquisition_readiness)
        .filter((value) => value !== undefined)),
      top_deficits: topDeficits(zoneRows),
    },
    normes: {
      state_counts: statusCounts(normesRows),
      base_status_counts: countBy(normesRows.map((row) => row.base_coverage.status)),
      local_manifest_matches: normesRows.filter((row) => row.local_evidence !== null).length,
      source_rows_not_matched_to_city_universe: unmatchedNormes,
      provenance_rows_not_matched_to_city_universe: unmatchedNormesProvenance,
      local_retest_error_count: normesRows.filter((row) => row.completion_gate.retest_conflict).length,
      source_url_unavailable_count: normesRows.filter((row) => row.local_evidence && !row.local_evidence.source_url_available).length,
      top_deficits: topDeficits(normesRows),
    },
  },
  deliverables: OUTPUTS,
};

invariant(summary.validation.zones_and_normes_city_sets_match, "Zones and Normes output city sets must match");
invariant(summary.validation.allowed_states_only, "all output states must be allowed");
invariant(summary.validation.unknown_never_complete, "unknown must never satisfy a complete gate");

writeJson(OUTPUTS.zonesMatrix, zonesMatrix);
writeJson(OUTPUTS.normesMatrix, normesMatrix);
writeJson(OUTPUTS.summaryJson, summary);
writeFileSync(absolute(OUTPUTS.summaryMarkdown), makeMarkdown(summary));

console.log(JSON.stringify({
  outputs: OUTPUTS,
  validation: summary.validation,
  zones: summary.lanes.zones.state_counts,
  normes: summary.lanes.normes.state_counts,
}, null, 2));
