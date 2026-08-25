#!/usr/bin/env node
/**
 * Materialise the committed cohort pin `docs/spec/reports/set-167-bprime.tsv`
 * from the committed reference `work/coverage/cohort-slugs-canonical.json`
 * (contract `cohort-slugs-canonical/v1`, cohort `set-167-bprime`).
 *
 * WHY THIS EXISTS (repro / capitalisation — CLAUDE.md founding principle):
 * several CLIs default/point at `docs/spec/reports/set-167-bprime.tsv`
 * (zoning-event-source-audit-run, zoning-events-cohort-col20 usage), but that
 * exact path was a cross-repo radar file (`radar 800ee90:...set-167-bprime.tsv`,
 * see the `source` note in palier-cohort-167.json) and never lived in geo — a
 * clean checkout ENOENTs on it. This transcribes the 167 slugs VERBATIM from the
 * committed geo reference, so the pin is reproducible on a clean checkout. It
 * INVENTS nothing: every slug is copied, and the plain⋈canonical relationship
 * comes from the reference's own `slug_corrections` map.
 *
 * Output columns (two consumers, two slug axes — both are served by one file):
 *   - `slug`            plain single-dash form — the served key
 *                       `qc-zoning-events-<slug>`; the runner's InventorySchema
 *                       regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` REJECTS double-dash,
 *                       so the audit/inventory axis MUST be plain. Read by
 *                       `parseZoningEventCohortTsv` (audit).
 *   - `graph_city_slug` canonical double-dash MRC form — the S3 `graph/` key.
 *                       Read by `parseCohortFile` (recall-gate / col20), which
 *                       prefers `graph_city_slug`.
 *
 * Deterministic, network-free. Re-run after any change to the reference.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SOURCE = resolve(ROOT, "work/coverage/cohort-slugs-canonical.json");
const OUTPUT = resolve(ROOT, "docs/spec/reports/set-167-bprime.tsv");

// Audit reader (`parseZoningEventCohortTsv`) slug regex — plain form only.
const PLAIN_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Recall-gate reader (`parseCohortFile`) slug regex — accepts double-dash.
const GRAPH_SLUG_RE = /^[a-z0-9-]+$/;

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`set-167-bprime: valeurs ${label} dupliquées`);
  }
}

const reference = JSON.parse(readFileSync(SOURCE, "utf8"));
if (reference.contract !== "cohort-slugs-canonical/v1") {
  throw new Error(`référence inattendue: contract=${reference.contract}`);
}
if (reference.cohort !== "set-167-bprime") {
  throw new Error(`référence inattendue: cohort=${reference.cohort}`);
}
if (reference.total !== 167 || !Array.isArray(reference.slugs) || reference.slugs.length !== 167) {
  throw new Error(`référence inattendue: total=${reference.total} slugs=${reference.slugs?.length}`);
}

// Invert the reference's own correction map: canonical(graph) → plain(source).
const plainByCanonical = new Map();
for (const correction of reference.slug_corrections ?? []) {
  if (plainByCanonical.has(correction.canonical)) {
    throw new Error(`slug_corrections: canonical dupliqué ${correction.canonical}`);
  }
  plainByCanonical.set(correction.canonical, correction.source);
}

const rows = [...reference.slugs]
  .sort((left, right) => left.rank - right.rank)
  .map((entry) => {
    const graph = entry.slug; // canonical (double-dash for disambiguated MRC)
    const plain = plainByCanonical.get(graph) ?? graph;
    if (!PLAIN_SLUG_RE.test(plain)) {
      throw new Error(`slug plat invalide (rang ${entry.rank}): ${JSON.stringify(plain)}`);
    }
    if (!GRAPH_SLUG_RE.test(graph)) {
      throw new Error(`graph_city_slug invalide (rang ${entry.rank}): ${JSON.stringify(graph)}`);
    }
    return { plain, graph };
  });

if (rows.length !== 167) throw new Error(`attendu 167 lignes, obtenu ${rows.length}`);
assertUnique(rows.map((row) => row.plain), "slug");
assertUnique(rows.map((row) => row.graph), "graph_city_slug");

const provenance =
  "# set-167-bprime — pin recette (priorityRank<=167, figé 2026-08-02). Généré par " +
  "scripts/build-set-167-bprime-cohort.mjs depuis work/coverage/cohort-slugs-canonical.json " +
  "(contract cohort-slugs-canonical/v1). slug = forme plate (clé servie qc-zoning-events-<slug>, " +
  "axe audit/inventaire, InventorySchema) ; graph_city_slug = forme canonique double-tiret " +
  "(clé S3 graph/, axe recall-gate). NE PAS éditer à la main — relancer le générateur.";
const header = "slug\tgraph_city_slug";
const body = `${provenance}\n${header}\n${rows.map((row) => `${row.plain}\t${row.graph}`).join("\n")}\n`;

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, body);

// Self-verify the load exactly as the audit reader does (column pick + regex),
// so a clean checkout is proven reproducible without any S3/network call.
const parsedRows = body
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"))
  .map((line) => line.split("\t").map((cell) => cell.trim()));
const parsedHeader = parsedRows[0].map((cell) => cell.toLowerCase());
const slugColumn = parsedHeader.findIndex((cell) => ["slug", "muni_slug", "ville_slug"].includes(cell));
if (slugColumn < 0) throw new Error("self-verify: colonne slug introuvable dans l'en-tête");
const loadedSlugs = parsedRows.slice(1).map((row) => row[slugColumn]);
if (loadedSlugs.length !== 167) throw new Error(`self-verify: ${loadedSlugs.length} slugs != 167`);
for (const slug of loadedSlugs) {
  if (!PLAIN_SLUG_RE.test(slug)) throw new Error(`self-verify: slug plat invalide ${JSON.stringify(slug)}`);
}
if (new Set(loadedSlugs).size !== loadedSlugs.length) throw new Error("self-verify: slug dupliqué");

console.error(JSON.stringify({
  output: "docs/spec/reports/set-167-bprime.tsv",
  cohort: "set-167-bprime",
  rows: rows.length,
  plain_slugs_loaded: loadedSlugs.length,
  graph_double_dash: rows.filter((row) => row.graph.includes("--")).length,
  first: loadedSlugs[0],
  last: loadedSlugs[loadedSlugs.length - 1],
}));
