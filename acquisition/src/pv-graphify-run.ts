/**
 * PV graphify runner — consume already captured PV documents from a KPI snapshot
 * and execute graphify extract on the `octets_conserves` corpus.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/pv-graphify-run.ts
 */

import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { s3Client, getBytes } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const AQUI = resolve(ROOT, "acquisition");
const RUN_PREFIX = "pv-graphify-run";
const DEFAULT_KPI_PREFIX = "pv-capture-kpi-";

interface RawDocument {
  url: unknown;
  state: unknown;
  captures?: unknown;
}

interface RawCapture {
  storage_key?: unknown;
}

interface GraphifyDocumentRun {
  index: number;
  url: string;
  storage_key: string;
  manifest_dir: string;
  command: string;
  exit_code: number;
  status: "graph" | "empty" | "failed";
  reason: string | null;
  nodes: number;
  edges: number;
  entity_types: string[];
}

interface GraphifyRunReport {
  contract: "pv-graphify-run/v1";
  generated_at: string;
  run_id: string;
  source_kpi_file: string;
  documents_selected: number;
  documents_processed: number;
  documents_no_storage_key: number;
  document_status: {
    graph: number;
    empty: number;
    failed: number;
  };
  totals: {
    nodes: number;
    edges: number;
    entity_type_count: number;
    entity_types: string[];
  };
  graphify: {
    command: string;
    args: string[];
    backend: string | null;
    workspace_root: string;
    executed_with: {
      node_options: string;
      aws_max_attempts: string;
    };
  };
  documents: GraphifyDocumentRun[];
}

interface KpiPayload {
  documents?: RawDocument[];
}

interface ParsedArgs {
  kpiFile: string | null;
  outFile: string;
  backend: string | null;
  workspace: string;
  graphifyBin: string;
  concurrency: number;
}

function usage(): never {
  console.log("Usage: npx tsx acquisition/src/pv-graphify-run.ts [--kpi=PATH] [--out=PATH] [--backend=<name|none>] [--workspace=PATH] [--graphify-bin=COMMAND] [--concurrency=N]");
  console.log("Ex: NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 npx tsx acquisition/src/pv-graphify-run.ts --kpi=work/coverage/pv-capture-kpi-20260727-084c868acc968fb1.json");
  process.exit(0);
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) usage();

  const value = (name: string): string | undefined => {
    const raw = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (!raw) return undefined;
    return raw.slice(name.length + 3);
  };

  const concurrencyValue = Number(value("concurrency") ?? "2");
  if (!Number.isInteger(concurrencyValue) || concurrencyValue < 1) {
    throw new Error("--concurrency doit être un entier >= 1");
  }

  const kpiFile = value("kpi") ?? null;
  const outFile = value("out") ?? resolve(ROOT, "work", "coverage", `${RUN_PREFIX}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}Z.json`);
  const backend = (() => {
    const raw = value("backend");
    if (!raw) return null;
    const normalized = raw.trim().toLowerCase();
    if (!normalized || normalized === "none" || normalized === "auto") return null;
    return normalized;
  })();

  const workspace = value("workspace") ?? resolve(ROOT, "work", "graphify", RUN_PREFIX);
  const graphifyBin = value("graphify-bin") ?? resolve(AQUI, "node_modules", ".bin", "graphify");

  return {
    kpiFile,
    outFile,
    backend,
    workspace,
    graphifyBin,
    concurrency: concurrencyValue,
  };
}

function writeAtomic(path: string, body: string): void {
  const tmp = `${path}.${Date.now()}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
}

function assertWriteableDirectory(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true });
}

function latestKpiFile(): string {
  const coverage = resolve(ROOT, "work", "coverage");
  const files = readdirSync(coverage)
    .filter((name) => name.startsWith(DEFAULT_KPI_PREFIX) && name.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new Error(`Aucun fichier trouvé sous ${coverage} pour ${DEFAULT_KPI_PREFIX}*.json`);
  return resolve(coverage, files[files.length - 1]!);
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function pickStorageKey(doc: RawDocument): string | null {
  if (!Array.isArray(doc.captures)) return null;
  for (const capture of doc.captures) {
    const raw = capture as RawCapture;
    const storageKey = toString(raw?.storage_key);
    if (storageKey) return storageKey;
  }
  return null;
}

function outputRootFromWorkspace(runId: string): string {
  return resolve(ROOT, "work", "graphify", `${RUN_PREFIX}-${runId}`);
}

function selectDocuments(payload: KpiPayload): RawDocument[] {
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  return documents.filter((document) => toString(document.state) === "octets_conserves");
}

function graphifyCommand(bin: string): string {
  if (existsSync(bin)) return bin;
  return "graphify";
}

function findGraphArtifacts(dir: string): string[] {
  const root = resolve(dir, ".graphify");
  if (!existsSync(root)) return [];
  const stack: string[] = [root];
  const candidates: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
        continue;
      }
      if (!entry.isFile()) continue;
      const base = entry.name.toLowerCase();
      if (base.endsWith("graph.json") || base === "graph.jsonl" || base.includes("graph") && base.endsWith(".json")) {
        candidates.push(next);
      }
    }
  }
  return candidates;
}

function normalizeGraphNodeType(node: unknown): string | null {
  if (node === null || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const value =
    (typeof record["type"] === "string" && record["type"]) ||
    (typeof record["node_type"] === "string" && record["node_type"]) ||
    (typeof record["kind"] === "string" && record["kind"]);
  return typeof value === "string" ? value : null;
}

function countGraphFromPath(path: string): { nodes: number; edges: number; entityTypes: string[] } {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as {
    nodes?: unknown;
    edges?: unknown;
    links?: unknown;
    graph?: { nodes?: unknown; edges?: unknown; links?: unknown };
  };

  const graph = (typeof parsed.graph === "object" && parsed.graph !== null) ? parsed.graph : parsed;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : Array.isArray(graph.links) ? graph.links : Array.isArray(parsed.edges) ? parsed.edges : Array.isArray(parsed.links) ? parsed.links : [];
  const entityTypes = new Set<string>();
  for (const node of nodes) {
    const type = normalizeGraphNodeType(node);
    if (type) entityTypes.add(type);
  }
  return { nodes: nodes.length, edges: edges.length, entityTypes: [...entityTypes].sort() };
}

function readGraphSummary(workspace: string): { nodes: number; edges: number; entityTypes: string[] } {
  const candidates = findGraphArtifacts(workspace);
  for (const candidate of candidates) {
    try {
      const summary = countGraphFromPath(candidate);
      if (summary.nodes > 0 || summary.edges > 0 || summary.entityTypes.length > 0) {
        return summary;
      }
    } catch {
      // Ignore malformed candidate files and keep searching.
    }
  }

  for (const candidate of candidates) {
    try {
      return countGraphFromPath(candidate);
    } catch {
      // ignore
    }
  }

  return { nodes: 0, edges: 0, entityTypes: [] };
}

function extractFailureReason(rawStdout: string, rawStderr: string): string | null {
  const text = `${rawStdout}\n${rawStderr}`.toLowerCase();
  if (text.includes("--backend") && text.includes("no provider api key read")) {
    return "provider API key manquante pour extraction sémantique";
  }
  if (text.includes("graph is empty")) return "graphify a produit un graphe vide";
  if (text.includes("does not appear to be a graphify project") || text.includes("no graphify project config")) {
    return "configuration graphify introuvable";
  }
  if (text.includes("error")) {
    for (const line of text.split("\n")) {
      if (line.includes("error")) return line.trim();
    }
  }
  return null;
}

async function runOne(
  index: number,
  doc: RawDocument,
  workspaceRoot: string,
  graphify: string,
  backend: string | null,
  concurrencySignal: { abort: boolean },
): Promise<GraphifyDocumentRun> {
  const url = toString(doc.url, `unknown-${index}`);
  const storageKey = pickStorageKey(doc);
  if (!storageKey) {
    return {
      index,
      url,
      storage_key: "",
      manifest_dir: workspaceRoot,
      command: `${graphify} extract`,
      exit_code: -1,
      status: "failed",
      reason: "aucun storage_key dans captures",
      nodes: 0,
      edges: 0,
      entity_types: [],
    };
  }

  const dir = resolve(workspaceRoot, String(index).padStart(4, "0"));
  const docInputDir = resolve(dir, "input");
  assertWriteableDirectory(dir);
  assertWriteableDirectory(docInputDir);

  const sourceExt = extname(storageKey) || ".pdf";
  const sourcePath = resolve(docInputDir, `source${sourceExt}`);

  const s3 = s3Client();
  let bytes: Buffer;
  try {
    bytes = await getBytes(s3, storageKey);
    writeFileSync(sourcePath, bytes);
  } catch (error) {
    return {
      index,
      url,
      storage_key: storageKey,
      manifest_dir: dir,
      command: `${graphify} extract`,
      exit_code: -1,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      nodes: 0,
      edges: 0,
      entity_types: [],
    };
  }

  const args = ["extract", "--out", dir, "--no-cluster", "--no-label", "--no-description", sourcePath];
  if (backend) args.splice(2, 0, "--backend", backend);
  const runArgs = [args.join(" ")];

  const execEnv = {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--dns-result-order=ipv4first",
    AWS_MAX_ATTEMPTS: process.env.AWS_MAX_ATTEMPTS ?? "10",
  };

  if (concurrencySignal.abort) {
    return {
      index,
      url,
      storage_key: storageKey,
      manifest_dir: dir,
      command: `${graphify} ${args.join(" ")}`,
      exit_code: -1,
      status: "failed",
      reason: "arrêt demandé",
      nodes: 0,
      edges: 0,
      entity_types: [],
    };
  }

  // `encoding: "utf8"` ci-dessous fait rendre des `string` a spawnSync, pas des
  // Buffer : la declaration disait l'inverse. Les deux consommateurs appellent
  // `.toString()`, qui marche sur l'un comme sur l'autre — c'est pourquoi le
  // code fonctionnait pendant que le typecheck restait rouge, et pourquoi tout
  // rapport de typecheck cible etait « vert par omission ».
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(graphify, args, {
      cwd: AQUI,
      env: execEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 6 * 1024 * 1024,
    });
  } catch (error) {
    return {
      index,
      url,
      storage_key: storageKey,
      manifest_dir: dir,
      command: `${graphify} ${args.join(" ")}`,
      exit_code: -1,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      nodes: 0,
      edges: 0,
      entity_types: [],
    };
  }

  const stdout = result.stdout?.toString() ?? "";
  const stderr = result.stderr?.toString() ?? "";
  const summary = readGraphSummary(dir);
  const failure = extractFailureReason(stdout, stderr);

  const hasFailure = result.status !== 0 || failure !== null;
  if (hasFailure) {
    return {
      index,
      url,
      storage_key: storageKey,
      manifest_dir: dir,
      command: `${graphify} ${args.join(" ")}`,
      exit_code: result.status ?? -1,
      status: "failed",
      reason: failure ?? `graphify_exit_${result.status ?? "signal"}`,
      nodes: 0,
      edges: 0,
      entity_types: [],
    };
  }

  if (summary.nodes === 0 && summary.edges === 0) {
    return {
      index,
      url,
      storage_key: storageKey,
      manifest_dir: dir,
      command: `${graphify} ${args.join(" ")}`,
      exit_code: result.status ?? 0,
      status: "empty",
      reason: failure,
      nodes: summary.nodes,
      edges: summary.edges,
      entity_types: summary.entityTypes,
    };
  }

  return {
    index,
    url,
    storage_key: storageKey,
    manifest_dir: dir,
    command: `${graphify} ${args.join(" ")}`,
    exit_code: 0,
    status: "graph",
    reason: failure,
    nodes: summary.nodes,
    edges: summary.edges,
    entity_types: summary.entityTypes,
  };
}

function splitToBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const kpiPath = options.kpiFile ?? latestKpiFile();
  const graphify = graphifyCommand(options.graphifyBin);
  const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "") + "Z";
  const workspace = outputRootFromWorkspace(runId);
  assertWriteableDirectory(workspace);

  const payload = JSON.parse(readFileSync(resolve(ROOT, kpiPath), "utf8")) as KpiPayload;
  const selected = selectDocuments(payload);
  const runs: GraphifyDocumentRun[] = [];
  const entityTypes = new Set<string>();
  const counts = { graph: 0, empty: 0, failed: 0 };
  let totalNodes = 0;
  let totalEdges = 0;
  const stop = { abort: false };

  const batches = splitToBatches(selected, options.concurrency);
  for (const batch of batches) {
    const promises = batch.map(async (doc, offset) => {
      const index = offset + runs.length + 1;
      return runOne(index, doc, workspace, graphify, options.backend, stop);
    });
    const results = await Promise.all(promises);
    for (const result of results) {
      runs.push(result);
      counts[result.status === "graph" ? "graph" : result.status === "empty" ? "empty" : "failed"] += 1;
      totalNodes += result.nodes;
      totalEdges += result.edges;
      for (const type of result.entity_types) entityTypes.add(type);
    }
  }

  const skippedNoStorageKey = runs.filter((run) => run.storage_key === "").length;

  const report: GraphifyRunReport = {
    contract: "pv-graphify-run/v1",
    generated_at: new Date().toISOString(),
    run_id: runId,
    source_kpi_file: kpiPath,
    documents_selected: selected.length,
    documents_processed: runs.length,
    documents_no_storage_key: skippedNoStorageKey,
    document_status: counts,
    totals: {
      nodes: totalNodes,
      edges: totalEdges,
      entity_type_count: entityTypes.size,
      entity_types: [...entityTypes].sort(),
    },
    graphify: {
      command: graphify,
      args: ["extract", ...(options.backend ? ["--backend", options.backend] : []), "--out", "<run-workspace>", "<input-file>"],
      backend: options.backend,
      workspace_root: workspace,
      executed_with: {
        node_options: process.env.NODE_OPTIONS ?? "--dns-result-order=ipv4first",
        aws_max_attempts: process.env.AWS_MAX_ATTEMPTS ?? "10",
      },
    },
    documents: runs,
  };

  const outPath = resolve(ROOT, options.outFile);
  assertWriteableDirectory(dirname(outPath));
  writeAtomic(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    source_kpi_file: kpiPath,
    documents_selected: report.documents_selected,
    documents_processed: report.documents_processed,
    nodes: report.totals.nodes,
    edges: report.totals.edges,
    entity_type_count: report.totals.entity_type_count,
    documents_no_storage_key: report.documents_no_storage_key,
    documents_graph: counts.graph,
    documents_empty: counts.empty,
    documents_failed: counts.failed,
    report: options.outFile,
    workspace,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
