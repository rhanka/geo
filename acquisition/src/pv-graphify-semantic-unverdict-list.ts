/**
 * Freeze the remaining CAS keys that have no durable Graphify verdict.
 *
 * This is deliberately a local, read-only reconciliation: it never contacts
 * S3, captures a document, or writes outside the requested coverage report.
 * A key is considered already decided when it is either in the snapshot's
 * historical indexed graph or has a terminal document outcome in a real-CAS
 * universe batch report.  The remaining queue is keyed solely by immutable
 * CAS key.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-graphify-semantic-unverdict-list.ts \
 *     --out=work/coverage/pv-graphify-semantic-real-universe-20260729-unverdict-list-01.json
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const SNAPSHOT = resolve(COVERAGE, "pv-graphify-semantic-real-universe-20260729-snapshot-01.json");
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const CAS_KEY = /^raw\/pv-index\/cas\/[a-f0-9]{64}\.pdf$/u;
const REAL_BATCH_REPORT = /^pv-graphify-semantic-real-universe-\d{8}-batch-\d{2}(?:-part-\d+)?\.json$/u;
const OUTCOMES = new Set([
  "INDEXED",
  "OWNER_NOT_CONFIRMED",
  "CONTAMINATION_OWNER_MISMATCH",
  "GRAPHIFY_FAILED",
  "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED",
]);

type SourceStatus = "READY" | "NO_TERMINAL_PV_MANIFEST" | "AMBIGUOUS_MANIFEST_SCOPE";

interface UniverseDocument {
  readonly storage_key: string;
  readonly source_status: SourceStatus;
  readonly source_observations: number;
  readonly slug?: string;
  readonly municipality_name?: string;
  readonly url?: string;
}

interface Verdict {
  readonly outcome: string;
  readonly sources: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: Record<string, unknown>, key: string, where: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) throw new Error(`${where}.${key} doit être une chaîne non vide`);
  return field.trim();
}

function requiredNonNegativeInteger(value: Record<string, unknown>, key: string, where: string): number {
  const field = value[key];
  if (!Number.isInteger(field) || typeof field !== "number" || field < 0) {
    throw new Error(`${where}.${key} doit être un entier positif ou nul`);
  }
  return field;
}

function requiredArray(value: Record<string, unknown>, key: string, where: string): readonly unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new Error(`${where}.${key} doit être un tableau`);
  return field;
}

function readSmallJson(path: string): unknown {
  const { size } = statSync(path);
  if (size > MAX_REPORT_BYTES) throw new Error(`${relative(ROOT, path)}: ${size} octets > plafond de lecture ${MAX_REPORT_BYTES}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function option(name: string): string {
  const values = process.argv.slice(2)
    .filter((argument) => argument.startsWith(`--${name}=`))
    .map((argument) => argument.slice(name.length + 3));
  if (values.length !== 1 || !values[0]) throw new Error(`--${name}=... est requis une seule fois`);
  return values[0];
}

function outputPath(): string {
  const output = resolve(ROOT, option("out"));
  if (!output.startsWith(`${ROOT}/`)) throw new Error("--out doit rester dans le dépôt");
  if (existsSync(output)) throw new Error(`refus d'écraser l'artefact: ${relative(ROOT, output)}`);
  return output;
}

function parseUniverseDocument(value: unknown, where: string): UniverseDocument {
  if (!isRecord(value)) throw new Error(`${where} doit être un objet`);
  const storageKey = requiredString(value, "storage_key", where);
  if (!CAS_KEY.test(storageKey)) throw new Error(`${where}.storage_key n'est pas une clé CAS PV`);
  const sourceStatus = requiredString(value, "source_status", where);
  if (sourceStatus !== "READY" && sourceStatus !== "NO_TERMINAL_PV_MANIFEST" && sourceStatus !== "AMBIGUOUS_MANIFEST_SCOPE") {
    throw new Error(`${where}.source_status invalide: ${sourceStatus}`);
  }
  const sourceObservations = requiredNonNegativeInteger(value, "source_observations", where);
  if (sourceStatus !== "READY") return { storage_key: storageKey, source_status: sourceStatus, source_observations: sourceObservations };
  return {
    storage_key: storageKey,
    source_status: sourceStatus,
    source_observations: sourceObservations,
    slug: requiredString(value, "slug", where),
    municipality_name: requiredString(value, "municipality_name", where),
    url: requiredString(value, "url", where),
  };
}

function addVerdict(verdicts: Map<string, Verdict>, storageKey: string, outcome: string, source: string): void {
  const previous = verdicts.get(storageKey);
  if (!previous) {
    verdicts.set(storageKey, { outcome, sources: [source] });
    return;
  }
  if (previous.outcome !== outcome) {
    throw new Error(`verdicts contradictoires pour ${storageKey}: ${previous.outcome} puis ${outcome} (${source})`);
  }
  previous.sources.push(source);
}

function writeImmutableJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function main(): void {
  const output = outputPath();
  const snapshot = readSmallJson(SNAPSHOT);
  if (!isRecord(snapshot) || snapshot.contract !== "pv-graphify-semantic-real-universe/v1") {
    throw new Error(`${relative(ROOT, SNAPSHOT)}: contrat d'univers invalide`);
  }
  const population = snapshot.population;
  const indexedGraph = snapshot.indexed_graph;
  const realUniverse = snapshot.real_universe;
  if (!isRecord(population) || !isRecord(indexedGraph) || !isRecord(realUniverse)) {
    throw new Error(`${relative(ROOT, SNAPSHOT)}: sections population/indexed_graph/real_universe requises`);
  }
  const expectedPopulation = requiredNonNegativeInteger(population, "unique_cas_keys", relative(ROOT, SNAPSHOT));
  const initialIndexed = requiredArray(indexedGraph, "storage_keys", relative(ROOT, SNAPSHOT));
  const sourceDocuments = requiredArray(realUniverse, "documents", relative(ROOT, SNAPSHOT));
  const documents = new Map<string, UniverseDocument>();
  for (const [index, raw] of sourceDocuments.entries()) {
    const document = parseUniverseDocument(raw, `${relative(ROOT, SNAPSHOT)}.real_universe.documents[${index}]`);
    if (documents.has(document.storage_key)) throw new Error(`univers: clé CAS dupliquée ${document.storage_key}`);
    documents.set(document.storage_key, document);
  }
  const populationKeys = new Set<string>();
  for (const [index, raw] of initialIndexed.entries()) {
    if (typeof raw !== "string" || !CAS_KEY.test(raw)) throw new Error(`indexed_graph.storage_keys[${index}] invalide`);
    populationKeys.add(raw);
  }
  for (const key of documents.keys()) populationKeys.add(key);
  if (populationKeys.size !== expectedPopulation) {
    throw new Error(`population CAS non réconciliée: ${populationKeys.size}/${expectedPopulation}`);
  }

  const verdicts = new Map<string, Verdict>();
  for (const key of initialIndexed) addVerdict(verdicts, key as string, "INDEXED", "snapshot.indexed_graph.storage_keys");
  const reportNames = readdirSync(COVERAGE)
    .filter((name) => REAL_BATCH_REPORT.test(name))
    .sort((left, right) => left.localeCompare(right));
  for (const name of reportNames) {
    const report = readSmallJson(resolve(COVERAGE, name));
    if (!isRecord(report) || report.contract !== "pv-graphify-semantic-control/v1") {
      throw new Error(`work/coverage/${name}: contrat de rapport invalide`);
    }
    for (const [index, raw] of requiredArray(report, "documents", `work/coverage/${name}`).entries()) {
      if (!isRecord(raw)) throw new Error(`work/coverage/${name}.documents[${index}] invalide`);
      const storageKey = requiredString(raw, "storage_key", `work/coverage/${name}.documents[${index}]`);
      const outcome = requiredString(raw, "outcome", `work/coverage/${name}.documents[${index}]`);
      if (!CAS_KEY.test(storageKey) || !populationKeys.has(storageKey)) throw new Error(`work/coverage/${name}: clé CAS hors univers ${storageKey}`);
      if (!OUTCOMES.has(outcome)) throw new Error(`work/coverage/${name}: verdict inconnu ${outcome}`);
      addVerdict(verdicts, storageKey, outcome, `work/coverage/${name}`);
    }
  }
  const preexistingOutcomes: Record<string, number> = {};
  for (const verdict of verdicts.values()) preexistingOutcomes[verdict.outcome] = (preexistingOutcomes[verdict.outcome] ?? 0) + 1;
  const withoutVerdict = [...populationKeys]
    .filter((key) => !verdicts.has(key))
    .sort((left, right) => left.localeCompare(right));
  const queue = withoutVerdict.map((key) => {
    const document = documents.get(key);
    if (!document) throw new Error(`univers: clé sans verdict ni description ${key}`);
    return document;
  });
  const bySourceStatus = Object.fromEntries(
    ["READY", "NO_TERMINAL_PV_MANIFEST", "AMBIGUOUS_MANIFEST_SCOPE"].map((status) => [
      status,
      queue.filter((document) => document.source_status === status).length,
    ]),
  );
  const report = {
    contract: "pv-graphify-semantic-unverdict-list/v1",
    generated_at: new Date().toISOString(),
    universe_report: relative(ROOT, SNAPSHOT),
    verdict_sources: {
      snapshot_indexed_graph: "snapshot.indexed_graph.storage_keys",
      batch_report_pattern: "pv-graphify-semantic-real-universe-*-batch-*.json",
      batch_reports: reportNames,
      batch_report_inventory_sha256: createHash("sha256").update(JSON.stringify(reportNames)).digest("hex"),
    },
    reconciliation: {
      universe_cas_keys: populationKeys.size,
      keys_with_preexisting_verdict: verdicts.size,
      preexisting_outcomes: preexistingOutcomes,
      keys_without_verdict: queue.length,
      queue_by_source_status: bySourceStatus,
    },
    documents: queue,
  };
  writeImmutableJson(output, report);
  console.log(JSON.stringify({ report: relative(ROOT, output), reconciliation: report.reconciliation }));
}

main();
