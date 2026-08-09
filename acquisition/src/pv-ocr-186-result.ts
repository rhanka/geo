/** Assemble the final, auditable result for the fixed 186-document OCR lot. */
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { pvOcrUsd } from "./lib/pv-ocr-artifact.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const INVENTORY = resolve(COVERAGE, "pv-ocr-inventaire-pages-20260729T122121Z.json");
const MAX_BYTES = 5 * 1024 * 1024;
const EXPECTED = 186;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, where: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: objet requis`);
  return value as JsonRecord;
}

function string(value: unknown, where: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${where}: chaîne requise`);
  return value;
}

function integerOrNull(value: unknown, where: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${where}: entier positif ou null requis`);
  return value as number;
}

function readSmallJson(path: string): unknown {
  const size = statSync(path).size;
  if (size > MAX_BYTES) throw new Error(`${path}: lecture > 5 MiB interdite`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function arg(name: string): string {
  const values = process.argv.slice(2).filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3));
  if (values.length !== 1 || !values[0]) throw new Error(`--${name}=... est requis une seule fois`);
  return values[0]!;
}

function writeImmutable(path: string, contents: string): void {
  if (existsSync(path)) throw new Error(`artefact déjà présent: ${path}`);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, contents, "utf8");
  renameSync(temp, path);
}

interface InventoryDoc { readonly key: string; readonly slug: string }

function inventory(): { documents: Map<string, InventoryDoc>; baselineZero: Set<string> } {
  const root = record(readSmallJson(INVENTORY), INVENTORY);
  if (root.contract !== "pv-ocr-inventaire-pages/v1" || root.unique_failed_documents !== EXPECTED || !Array.isArray(root.failed_documents)) {
    throw new Error("inventaire OCR autorisé invalide");
  }
  const documents = new Map<string, InventoryDoc>();
  for (const [index, value] of root.failed_documents.entries()) {
    const item = record(value, `inventory.failed_documents[${index}]`);
    const key = string(item.storage_key, "storage_key");
    if (documents.has(key)) throw new Error(`clé OCR dupliquée: ${key}`);
    documents.set(key, { key, slug: string(item.slug, "slug") });
  }
  const impact = record(root.municipal_impact, "municipal_impact");
  if (!Array.isArray(impact.municipalities)) throw new Error("municipal_impact.municipalities requis");
  const baselineZero = new Set<string>();
  for (const value of impact.municipalities) {
    const municipality = record(value, "municipal_impact.municipalities[]");
    if (municipality.other_indexed_documents === 0) baselineZero.add(string(municipality.slug, "municipality.slug"));
  }
  if (documents.size !== EXPECTED || baselineZero.size !== 16) throw new Error("inventaire OCR: cardinalités de contrôle invalides");
  return { documents, baselineZero };
}

interface OcrFact { readonly billedPages: number; readonly costUsd: string; readonly outcome: string; readonly artifact: string | null }

function stageFacts(allowed: ReadonlyMap<string, InventoryDoc>): Map<string, OcrFact> {
  const facts = new Map<string, OcrFact>();
  const paths = readdirSync(COVERAGE).filter((name) => /^pv-ocr-186-stage-.*\.json$/u.test(name)).sort();
  if (paths.length === 0) throw new Error("aucun checkpoint OCR trouvé");
  for (const name of paths) {
    const path = resolve(COVERAGE, name);
    const root = record(readSmallJson(path), path);
    if (root.contract !== "pv-ocr-stage/v1" || !Array.isArray(root.documents)) continue;
    for (const item of root.documents) {
      const document = record(item, `${name}.documents[]`);
      const key = string(document.storage_key, `${name}.storage_key`);
      if (!allowed.has(key)) throw new Error(`${name}: clé hors des 186 autorisées: ${key}`);
      const billed = integerOrNull(document.billed_pages, `${name}.billed_pages`);
      if (billed === null) continue;
      const cost = string(document.cost_usd, `${name}.cost_usd`);
      if (cost !== pvOcrUsd(billed)) throw new Error(`${name}: coût incohérent pour ${key}`);
      const outcome = string(document.outcome, `${name}.outcome`);
      const artifact = document.ocr_artifact_key === undefined ? null : string(document.ocr_artifact_key, `${name}.ocr_artifact_key`);
      const previous = facts.get(key);
      if (previous && (previous.billedPages !== billed || previous.costUsd !== cost)) throw new Error(`${key}: double comptage OCR contradictoire`);
      facts.set(key, { billedPages: billed, costUsd: cost, outcome, artifact });
    }
  }
  return facts;
}

interface GraphFact { readonly outcome: string; readonly slug: string; readonly provenanceMarked: boolean }

function graphFacts(allowed: ReadonlyMap<string, InventoryDoc>): Map<string, GraphFact> {
  const facts = new Map<string, GraphFact>();
  const paths = readdirSync(COVERAGE).filter((name) => /^pv-ocr-186-graph-.*\.json$/u.test(name)).sort();
  if (paths.length === 0) throw new Error("aucun rapport Graphify OCR trouvé");
  for (const name of paths) {
    const path = resolve(COVERAGE, name);
    const root = record(readSmallJson(path), path);
    if (root.contract !== "pv-graphify-semantic-control/v1" || root.mode !== "ocr-artifact-stage" || !Array.isArray(root.documents)) {
      throw new Error(`${name}: rapport Graphify OCR invalide`);
    }
    for (const item of root.documents) {
      const document = record(item, `${name}.documents[]`);
      const key = string(document.storage_key, `${name}.storage_key`);
      const allowedDocument = allowed.get(key);
      if (!allowedDocument) throw new Error(`${name}: clé Graphify hors des 186: ${key}`);
      const provenanceMarked = document.text_provenance === "OCR"
        && typeof document.ocr === "object" && document.ocr !== null
        && document.source_file === "document.ocr.txt";
      const fact = { outcome: string(document.outcome, `${name}.outcome`), slug: string(document.slug, `${name}.slug`), provenanceMarked };
      const previous = facts.get(key);
      if (previous && previous.outcome !== fact.outcome) throw new Error(`${key}: verdict Graphify OCR contradictoire`);
      facts.set(key, fact);
    }
  }
  return facts;
}

function main(): void {
  const jsonOut = resolve(ROOT, arg("out"));
  const mdOut = resolve(ROOT, arg("md"));
  if (!jsonOut.startsWith(`${COVERAGE}/`) || !mdOut.startsWith(`${COVERAGE}/`)) throw new Error("sorties hors work/coverage refusées");
  const { documents, baselineZero } = inventory();
  const ocr = stageFacts(documents);
  const graph = graphFacts(documents);
  if (ocr.size !== EXPECTED) throw new Error(`OCR incomplet: ${ocr.size}/${EXPECTED} documents ont un coût réel observé`);
  if (graph.size !== EXPECTED) throw new Error(`Graphify OCR incomplet: ${graph.size}/${EXPECTED}`);
  const billedPages = [...ocr.values()].reduce((sum, fact) => sum + fact.billedPages, 0);
  const indexed = [...graph.values()].filter((fact) => fact.outcome === "INDEXED");
  const ownerNotConfirmed = [...graph.values()].filter((fact) => fact.outcome === "OWNER_NOT_CONFIRMED");
  const stillFailing = EXPECTED - indexed.length - ownerNotConfirmed.length;
  const municipalitiesNowIndexed = new Set(indexed.map((fact) => fact.slug));
  const baselineRecovered = [...baselineZero].filter((slug) => municipalitiesNowIndexed.has(slug)).length;
  const provenanceMarked = [...graph.values()].every((fact) => fact.provenanceMarked);
  const result = {
    contract: "pv-ocr-186-result/v1",
    generated_at: new Date().toISOString(),
    authorization: { input_inventory: INVENTORY.slice(ROOT.length + 1), unique_cas_keys: EXPECTED, hard_cap_usd: "2.000" },
    ocr: { documents_with_observed_cost: ocr.size, billed_pages: billedPages, actual_cost_usd: pvOcrUsd(billedPages), hard_cap_exceeded: billedPages > 2_000 },
    indexing: {
      indexed_documents: indexed.length,
      owner_not_confirmed: ownerNotConfirmed.length,
      still_failing: stillFailing,
      outcomes: [...graph.values()].reduce<Record<string, number>>((counts, fact) => ({ ...counts, [fact.outcome]: (counts[fact.outcome] ?? 0) + 1 }), {}),
    },
    municipal_impact: { baseline_without_another_indexed_document: 16, now_with_at_least_one_indexed_document: baselineRecovered },
    provenance: { ocr_marked_in_every_graph_report_document: provenanceMarked, marker: "text_provenance=OCR; source_file=document.ocr.txt; ocr artifact metadata" },
  };
  writeImmutable(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  writeImmutable(mdOut, [
    "# OCR PV — résultat",
    "",
    `- Coût réel: ${result.ocr.actual_cost_usd} USD; ${billedPages} pages OCRisées.`,
    `- ${indexed.length}/${EXPECTED} indexés; ${ownerNotConfirmed.length} OWNER_NOT_CONFIRMED; ${stillFailing} autres échecs.`,
    `- Municipalités auparavant sans autre PV indexé: ${baselineRecovered}/16 désormais couvertes.`,
    `- Provenance OCR marquée dans le rapport: ${provenanceMarked ? "oui" : "non"}.`,
    "",
  ].join("\n"));
  if (billedPages > 2_000) throw new Error(`plafond dépassé: coût réel ${result.ocr.actual_cost_usd} USD`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
