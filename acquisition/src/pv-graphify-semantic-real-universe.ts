/**
 * Build the real, durable PV Graphify universe.
 *
 * The population is the CAS namespace itself, never a capture report row or a
 * URL.  Graphified documents are reconciled by the same immutable CAS key.
 * Capture manifests only supply a provisional municipal scope and source URL;
 * the Graphify runner still requires the owner to be printed in the PDF.
 *
 * This runner is S3 read-only.  It neither captures nor writes raw objects or
 * capture run records.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/pv-graphify-semantic-real-universe.ts \
 *     --out=work/coverage/pv-graphify-semantic-real-universe-YYYYMMDD-snapshot-01.json
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CaptureRunHeaderSchema, parseManifestJsonl } from "../../packages/qc-sources/src/capture/index.js";

import { selectBalancedPvControl } from "./lib/pv-graphify-control.js";
import { BUCKET, getBytes, listObjectEntries, objectHead, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const CAS_PREFIX = "raw/pv-index/cas/";
const PV_RUNS_PREFIX = "capture/_runs/pv-";
const BASE_SUMMARY = resolve(COVERAGE, "pv-graphify-semantic-all-20260728-summary.json");
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const DEFAULT_BATCH_SIZE = 300;
const REAL_BATCH_REPORT = /^pv-graphify-semantic-real-universe-\d{8}-batch-\d{2}(?:-part-\d+)?\.json$/u;
const CAS_KEY = /^raw\/pv-index\/cas\/[a-f0-9]{64}\.pdf$/u;

interface GraphifyDocument {
  readonly storage_key: string;
  readonly graphify: { readonly exit_code: number; readonly nodes: number; readonly edges: number };
}

interface IndexedGraph {
  readonly documents: ReadonlyMap<string, GraphifyDocument>;
  readonly nodes: number;
  readonly edges: number;
}

interface Observation {
  readonly storage_key: string;
  readonly url: string;
  readonly slugs: readonly string[];
  readonly manifest_key: string;
  readonly line_index: number;
}

interface Candidate {
  readonly storage_key: string;
  readonly source_status: "READY" | "NO_TERMINAL_PV_MANIFEST" | "AMBIGUOUS_MANIFEST_SCOPE";
  readonly source_observations: number;
  readonly slug?: string;
  readonly municipality_name?: string;
  readonly url?: string;
}

interface GraphifyCandidate extends Candidate {
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
}

interface Args {
  readonly output: string;
  readonly batchSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}.${key} doit être une chaîne non vide`);
  return value;
}

function requiredInteger(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`${where}.${key} doit être un entier positif ou nul`);
  }
  return value;
}

function requiredArray(record: Record<string, unknown>, key: string, where: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${where}.${key} doit être un tableau`);
  return value;
}

function assertS3RunEnvironment(): void {
  if (!process.env.NODE_OPTIONS?.split(/\s+/u).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env.AWS_MAX_ATTEMPTS !== "10") throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

function option(name: string): string | null {
  const values = process.argv.slice(2)
    .filter((argument) => argument.startsWith(`--${name}=`))
    .map((argument) => argument.slice(name.length + 3));
  if (values.length > 1) throw new Error(`--${name} ne peut apparaître qu'une fois`);
  return values[0] ?? null;
}

function parseArgs(): Args {
  const output = option("out");
  if (output === null) throw new Error("--out=work/coverage/pv-graphify-semantic-real-universe-...json est requis");
  const absolute = resolve(ROOT, output);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error("--out doit rester dans le dépôt");
  const batchRaw = option("batch-size") ?? String(DEFAULT_BATCH_SIZE);
  const batchSize = Number(batchRaw);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > DEFAULT_BATCH_SIZE) {
    throw new Error(`--batch-size doit être un entier de 1 à ${DEFAULT_BATCH_SIZE}`);
  }
  return { output: absolute, batchSize };
}

function readSmallJson(path: string): unknown {
  const { size } = statSync(path);
  if (size > MAX_REPORT_BYTES) throw new Error(`${relative(ROOT, path)}: ${size} octets > plafond de lecture ${MAX_REPORT_BYTES}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function parseGraphifyDocument(value: unknown, where: string): GraphifyDocument {
  if (!isRecord(value)) throw new Error(`${where} doit être un objet`);
  const graphify = value.graphify;
  if (!isRecord(graphify)) throw new Error(`${where}.graphify doit être un objet`);
  return {
    storage_key: requiredString(value, "storage_key", where),
    graphify: {
      exit_code: requiredInteger(graphify, "exit_code", `${where}.graphify`),
      nodes: requiredInteger(graphify, "nodes", `${where}.graphify`),
      edges: requiredInteger(graphify, "edges", `${where}.graphify`),
    },
  };
}

function supersededKeys(report: Record<string, unknown>, where: string): ReadonlySet<string> {
  if (report.supersedes_storage_keys === undefined) return new Set();
  const values = requiredArray(report, "supersedes_storage_keys", where)
    .map((value, index) => requiredString({ value }, "value", `${where}.supersedes_storage_keys[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${where}.supersedes_storage_keys contient un doublon`);
  return new Set(values);
}

function mergeGraphifyReport(
  documents: Map<string, GraphifyDocument>,
  value: unknown,
  where: string,
): void {
  if (!isRecord(value)) throw new Error(`${where} doit être un objet`);
  const supersedes = supersededKeys(value, where);
  const reportKeys = new Set<string>();
  for (const [index, raw] of requiredArray(value, "documents", where).entries()) {
    const document = parseGraphifyDocument(raw, `${where}.documents[${index}]`);
    if (!CAS_KEY.test(document.storage_key)) throw new Error(`${where}: clé CAS PV invalide: ${document.storage_key}`);
    if (documents.has(document.storage_key) && !supersedes.has(document.storage_key)) {
      throw new Error(`${where}: clé CAS Graphify dupliquée sans supersession: ${document.storage_key}`);
    }
    documents.set(document.storage_key, document);
    reportKeys.add(document.storage_key);
  }
  for (const key of supersedes) {
    if (!reportKeys.has(key)) throw new Error(`${where}: supersession sans document correspondant: ${key}`);
  }
}

function successfulGraph(documents: ReadonlyMap<string, GraphifyDocument>): IndexedGraph {
  let nodes = 0;
  let edges = 0;
  const indexed = new Map<string, GraphifyDocument>();
  for (const [key, document] of documents) {
    if (document.graphify.exit_code !== 0 || document.graphify.nodes === 0) continue;
    indexed.set(key, document);
    nodes += document.graphify.nodes;
    edges += document.graphify.edges;
  }
  return { documents: indexed, nodes, edges };
}

function baseGraph(): IndexedGraph {
  const summary = readSmallJson(BASE_SUMMARY);
  if (!isRecord(summary) || summary.contract !== "pv-graphify-semantic-all-summary/v1") {
    throw new Error("agrégat PV Graphify historique invalide");
  }
  const indexedExpected = requiredInteger(summary, "indexed_pvs", relative(ROOT, BASE_SUMMARY));
  const graph = summary.graph;
  if (!isRecord(graph)) throw new Error("agrégat PV Graphify historique: graph invalide");
  const expectedNodes = requiredInteger(graph, "nodes", "summary.graph");
  const expectedEdges = requiredInteger(graph, "edges", "summary.graph");
  const documents = new Map<string, GraphifyDocument>();
  for (const [index, relativePath] of requiredArray(summary, "source_reports", "summary").entries()) {
    if (typeof relativePath !== "string") throw new Error(`summary.source_reports[${index}] invalide`);
    const path = resolve(ROOT, relativePath);
    if (!path.startsWith(`${ROOT}/`)) throw new Error(`rapport Graphify hors dépôt: ${relativePath}`);
    mergeGraphifyReport(documents, readSmallJson(path), relativePath);
  }
  const indexed = successfulGraph(documents);
  if (indexed.documents.size !== indexedExpected || indexed.nodes !== expectedNodes || indexed.edges !== expectedEdges) {
    throw new Error(
      `agrégat PV Graphify historique non réconcilié: ` +
      `indexés=${indexed.documents.size}/${indexedExpected}, noeuds=${indexed.nodes}/${expectedNodes}, arêtes=${indexed.edges}/${expectedEdges}`,
    );
  }
  return indexed;
}

function currentGraph(): IndexedGraph {
  const base = baseGraph();
  const documents = new Map(base.documents);
  const batchReports = readdirSync(COVERAGE)
    .filter((name) => REAL_BATCH_REPORT.test(name))
    .sort((left, right) => left.localeCompare(right));
  for (const name of batchReports) mergeGraphifyReport(documents, readSmallJson(resolve(COVERAGE, name)), `work/coverage/${name}`);
  return successfulGraph(documents);
}

function existingEntriesRemainStable(
  left: readonly { key: string; etag: string | null; last_modified: string | null }[],
  right: readonly { key: string; etag: string | null; last_modified: string | null }[],
): boolean {
  const after = new Map(right.map((entry) => [entry.key, entry]));
  return left.every((entry) => {
    const current = after.get(entry.key);
    return current !== undefined && entry.etag === current.etag && entry.last_modified === current.last_modified;
  });
}

async function readSmallS3Text(s3: ReturnType<typeof s3Client>, key: string): Promise<string> {
  const head = await objectHead(s3, key);
  if (!head.exists || head.contentLength === undefined) throw new Error(`${key}: objet absent ou taille inconnue`);
  if (head.contentLength > MAX_REPORT_BYTES) throw new Error(`${key}: ${head.contentLength} octets > plafond de lecture ${MAX_REPORT_BYTES}`);
  return (await getBytes(s3, key)).toString("utf8");
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

async function terminalPvObservations(unindexed: ReadonlySet<string>): Promise<{
  readonly observations: ReadonlyMap<string, readonly Observation[]>;
  readonly terminal_manifests: number;
  readonly non_terminal_manifests: number;
}> {
  const s3 = s3Client();
  const manifestKeys = (await listObjectEntries(s3, PV_RUNS_PREFIX))
    .map((entry) => entry.key)
    .filter((key) => key.endsWith("/manifest.jsonl"))
    .sort((left, right) => left.localeCompare(right));
  const grouped = new Map<string, Observation[]>();
  const scanned = await mapConcurrent(manifestKeys, 8, async (manifestKey) => {
    const runKey = `${manifestKey.slice(0, -"manifest.jsonl".length)}run.json`;
    const runHead = await objectHead(s3, runKey);
    if (!runHead.exists || runHead.contentLength === undefined || runHead.contentLength > MAX_REPORT_BYTES) {
      return { terminal: false, observations: [] as Observation[] };
    }
    const header = CaptureRunHeaderSchema.parse(JSON.parse(await readSmallS3Text(s3, runKey)));
    if (header.lane !== "pv" || header.finished_at === null || header.exit_code !== 0) {
      return { terminal: false, observations: [] as Observation[] };
    }
    const lines = parseManifestJsonl(await readSmallS3Text(s3, manifestKey));
    const found: Observation[] = [];
    for (const [lineIndex, line] of lines.entries()) {
      if (line.source !== "pv-index" || line.storage_key === null || !unindexed.has(line.storage_key)) continue;
      found.push({ storage_key: line.storage_key, url: line.url, slugs: [...line.slugs].sort(), manifest_key: manifestKey, line_index: lineIndex });
    }
    return { terminal: true, observations: found };
  });
  for (const item of scanned) {
    for (const observation of item.observations) {
      const entries = grouped.get(observation.storage_key) ?? [];
      entries.push(observation);
      grouped.set(observation.storage_key, entries);
    }
  }
  return {
    observations: grouped,
    terminal_manifests: scanned.filter((item) => item.terminal).length,
    non_terminal_manifests: scanned.filter((item) => !item.terminal).length,
  };
}

function candidateFor(
  storageKey: string,
  observations: readonly Observation[],
  municipalityNames: ReadonlyMap<string, string>,
): Candidate {
  if (observations.length === 0) {
    return { storage_key: storageKey, source_status: "NO_TERMINAL_PV_MANIFEST", source_observations: 0 };
  }
  const singleton = observations.filter((observation) => observation.slugs.length === 1 && municipalityNames.has(observation.slugs[0]!));
  const slugs = new Set(singleton.map((observation) => observation.slugs[0]!));
  // A single capture line with multiple municipalities is insufficient to
  // scope a municipal gazetteer.  A filename or a path segment cannot repair
  // that ambiguity.
  if (singleton.length !== observations.length || slugs.size !== 1) {
    return {
      storage_key: storageKey,
      source_status: "AMBIGUOUS_MANIFEST_SCOPE",
      source_observations: observations.length,
    };
  }
  const slug = [...slugs][0]!;
  const url = [...new Set(singleton.map((observation) => observation.url))].sort((left, right) => left.localeCompare(right))[0]!;
  return {
    storage_key: storageKey,
    source_status: "READY",
    source_observations: observations.length,
    slug,
    municipality_name: municipalityNames.get(slug)!,
    url,
  };
}

function municipalityNames(): ReadonlyMap<string, string> {
  const path = resolve(ROOT, "packages", "geo-sources-americas", "src", "ca-qc", "municipalities", "municipalities.qc.json");
  const value = readSmallJson(path);
  if (!Array.isArray(value)) throw new Error("gazetteer municipal invalide");
  const names = new Map<string, string>();
  for (const [index, row] of value.entries()) {
    if (!isRecord(row)) throw new Error(`gazetteer municipal[${index}] invalide`);
    const slug = requiredString(row, "slug", `gazetteer municipal[${index}]`);
    const name = requiredString(row, "name", `gazetteer municipal[${index}]`);
    if (names.has(slug)) throw new Error(`gazetteer municipal: slug dupliqué ${slug}`);
    names.set(slug, name);
  }
  return names;
}

function writeImmutableJson(path: string, value: unknown): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path)) throw new Error(`refus d'écraser l'artefact: ${relative(ROOT, path)}`);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, body, "utf8");
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const args = parseArgs();
  assertS3RunEnvironment();
  const s3 = s3Client();
  const before = await listObjectEntries(s3, CAS_PREFIX);
  const casKeys = before.map((entry) => entry.key).filter((key) => CAS_KEY.test(key));
  const nonPdfObjects = before.filter((entry) => !CAS_KEY.test(entry.key));
  if (new Set(casKeys).size !== casKeys.length) throw new Error(`${CAS_PREFIX}: clé CAS dupliquée dans le listing S3`);

  const graph = currentGraph();
  const unindexedKeys = casKeys.filter((key) => !graph.documents.has(key));
  const observations = await terminalPvObservations(new Set(unindexedKeys));
  const names = municipalityNames();
  const candidates = unindexedKeys
    .map((key) => candidateFor(key, observations.observations.get(key) ?? [], names))
    .sort((left, right) => left.storage_key.localeCompare(right.storage_key));
  const ready = candidates.filter((candidate): candidate is GraphifyCandidate => candidate.source_status === "READY");
  const batch = unindexedKeys.length === 0
    ? []
    : selectBalancedPvControl(ready, Math.min(args.batchSize, ready.length));

  const after = await listObjectEntries(s3, CAS_PREFIX);
  if (!existingEntriesRemainStable(before, after)) {
    throw new Error(`clé déjà listée sous ${CAS_PREFIX} supprimée ou modifiée pendant le rapprochement; aucun artefact publié`);
  }
  const beforeKeys = new Set(before.map((entry) => entry.key));
  const appendedDuringInventory = after.filter((entry) => !beforeKeys.has(entry.key)).length;

  const snapshot = {
    contract: "pv-graphify-semantic-real-universe/v1",
    generated_at: new Date().toISOString(),
    population: {
      bucket: BUCKET,
      prefix: CAS_PREFIX,
      listed_objects: before.length,
      non_pdf_objects_excluded: nonPdfObjects.length,
      unique_cas_keys: casKeys.length,
      listing_sha256: createHash("sha256").update(JSON.stringify(before)).digest("hex"),
      objects_appended_during_inventory: appendedDuringInventory,
    },
    indexed_graph: {
      source: "work/coverage/pv-graphify-semantic-all-20260728-summary.json + pv-graphify-semantic-real-universe-*-batch-*.json",
      indexed_pvs: graph.documents.size,
      nodes: graph.nodes,
      edges: graph.edges,
      storage_keys: [...graph.documents.keys()].sort((left, right) => left.localeCompare(right)),
    },
    real_universe: {
      unindexed_pvs: unindexedKeys.length,
      ready_for_graphify: ready.length,
      no_terminal_pv_manifest: candidates.filter((candidate) => candidate.source_status === "NO_TERMINAL_PV_MANIFEST").length,
      ambiguous_manifest_scope: candidates.filter((candidate) => candidate.source_status === "AMBIGUOUS_MANIFEST_SCOPE").length,
      documents: candidates,
    },
    manifest_evidence: {
      terminal_manifests: observations.terminal_manifests,
      non_terminal_manifests: observations.non_terminal_manifests,
    },
    batch: {
      batch_size: batch.length,
      requested_batch_size: args.batchSize,
      selected_documents: batch,
    },
  };
  writeImmutableJson(args.output, snapshot);
  console.log(JSON.stringify({
    report: relative(ROOT, args.output),
    durable_cas_pvs: casKeys.length,
    indexed_pvs: graph.documents.size,
    real_universe: unindexedKeys.length,
    ready_for_graphify: ready.length,
    selected_documents: batch.length,
  }));
  if (unindexedKeys.length === 0) {
    throw new Error("univers réel PV à indexer = 0; arrêt requis avant toute indexation");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
