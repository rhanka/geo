#!/usr/bin/env tsx
/**
 * Validation geo-independante, strictement on-disk, du snapshot >=prod de recette.
 *
 * This script intentionally has no S3 client and no credential handling.  It reads
 * only the shared handoff files emitted by recette, then writes an auditable JSON
 * and Markdown report under the root-relative --out path.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

type NodeRecord = { id: string };
type GraphFile = {
  citySlug?: string;
  municipality?: string;
  node_count?: number;
  nodes?: NodeRecord[];
  edges?: unknown[];
};

type CitySpec = {
  slug: string;
  expectedNodes: number;
  expectedEdges: number;
  targetIds: readonly string[];
};

type CityResult = {
  city: string;
  expected_node_count: number;
  node_count_latest: number | null;
  node_count_subgraph: number | null;
  expected_edge_count: number;
  edge_count_latest: number | null;
  subgraph_only_count: number | null;
  subgraph_only: string[];
  target_ids: { present: string[]; absent: string[] };
  verdict: "PASS" | "FAIL";
  failure_reasons: string[];
};

const HANDOFF_DIR = "/home/antoinefa/src/radar-immobilier/tmp/handoff/recette-prod-3cities";
const SPECS: readonly CitySpec[] = [
  {
    slug: "saint-urbain-premier",
    expectedNodes: 47,
    expectedEdges: 52,
    targetIds: [
      "rezonage-R4-H2-2026-03-30", "piia-12-terrasse-vincent-2026-03-09",
      "piia-213-215-principale-2026", "densification-R4-bifamiliale-2026",
      "piia-243a-principale-2026-05-04",
    ],
  },
  {
    slug: "saint-jean-baptiste",
    expectedNodes: 50,
    expectedEdges: 47,
    targetIds: [
      "rezonage-R2-multifamilial-2026-05-05", "modif-lotissement-R2-2026-05-05",
      "cptaq-1006-26-2026-05-05", "derogation-DPDRL260017-2026-04-07",
      "piia-projet-integre-2026-02",
    ],
  },
  {
    slug: "saint-mathieu",
    expectedNodes: 40,
    expectedEdges: 51,
    targetIds: [
      "derogation-2025-00034", "derogation-2026-00001", "lotissement-2427246",
      "modification-zonage-315-2024-01", "derogation-mineure-lotissement",
    ],
  },
];

function requiredOutPath(args: readonly string[]): string {
  const arg = args.find((value) => value.startsWith("--out="));
  if (arg === undefined || arg.length === "--out=".length) {
    throw new Error("USAGE_ERROR: --out=<root-relative .json path> is required");
  }
  const output = arg.slice("--out=".length);
  if (path.isAbsolute(output) || output.split(path.sep).includes("..") || !output.endsWith(".json")) {
    throw new Error("USAGE_ERROR: --out must be a root-relative .json path without '..'");
  }
  return path.resolve(process.cwd(), output);
}

async function readGraph(file: string, label: string): Promise<GraphFile> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`INPUT_MISSING: ${label}: ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(raw) as GraphFile;
  } catch (error) {
    throw new Error(`INPUT_INVALID_JSON: ${label}: ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function nodeIds(graph: GraphFile, label: string): Set<string> {
  if (!Array.isArray(graph.nodes) || graph.nodes.some((node) => typeof node?.id !== "string" || node.id.length === 0)) {
    throw new Error(`INPUT_INVALID_SCHEMA: ${label}: nodes must be an array of non-empty string ids`);
  }
  return new Set(graph.nodes.map((node) => node.id));
}

function edgeCount(graph: GraphFile, label: string): number {
  if (!Array.isArray(graph.edges)) {
    throw new Error(`INPUT_INVALID_SCHEMA: ${label}: edges must be an array`);
  }
  return graph.edges.length;
}

async function validateCity(spec: CitySpec): Promise<CityResult> {
  const subgraph = await readGraph(path.join(HANDOFF_DIR, `${spec.slug}.subgraph.json`), `${spec.slug} subgraph`);
  const latest = await readGraph(path.join(HANDOFF_DIR, `${spec.slug}.latest.json`), `${spec.slug} latest`);
  const subgraphIds = nodeIds(subgraph, `${spec.slug} subgraph`);
  const latestIds = nodeIds(latest, `${spec.slug} latest`);
  const subgraphOnly = [...subgraphIds].filter((id) => !latestIds.has(id)).sort();
  const present = spec.targetIds.filter((id) => latestIds.has(id));
  const absent = spec.targetIds.filter((id) => !latestIds.has(id));
  const nodeCountSubgraph = subgraph.nodes!.length;
  const nodeCountLatest = latest.nodes!.length;
  const edgeCountLatest = edgeCount(latest, `${spec.slug} latest`);
  const reasons: string[] = [];

  if (subgraph.node_count !== nodeCountSubgraph) {
    reasons.push(`subgraph node_count field ${String(subgraph.node_count)} differs from nodes.length ${nodeCountSubgraph}`);
  }
  if (nodeCountLatest !== spec.expectedNodes) {
    reasons.push(`node_count(latest) ${nodeCountLatest} != expected ${spec.expectedNodes}`);
  }
  if (nodeCountSubgraph !== spec.expectedNodes) {
    reasons.push(`node_count(subgraph) ${nodeCountSubgraph} != expected ${spec.expectedNodes}`);
  }
  if (subgraphOnly.length > 0) {
    reasons.push(`subgraph_only has ${subgraphOnly.length} id(s): ${subgraphOnly.join(", ")}`);
  }
  if (edgeCountLatest !== spec.expectedEdges) {
    reasons.push(`edge_count(latest) ${edgeCountLatest} != expected ${spec.expectedEdges}`);
  }
  if (absent.length > 0) {
    reasons.push(`target ids absent (${absent.length}/5): ${absent.join(", ")}`);
  }

  return {
    city: spec.slug,
    expected_node_count: spec.expectedNodes,
    node_count_latest: nodeCountLatest,
    node_count_subgraph: nodeCountSubgraph,
    expected_edge_count: spec.expectedEdges,
    edge_count_latest: edgeCountLatest,
    subgraph_only_count: subgraphOnly.length,
    subgraph_only: subgraphOnly,
    target_ids: { present, absent },
    verdict: reasons.length === 0 ? "PASS" : "FAIL",
    failure_reasons: reasons,
  };
}

function renderConsole(result: CityResult): string {
  return [
    `CITY ${result.city}`,
    `node_count(latest)=${String(result.node_count_latest)}; node_count(subgraph)=${String(result.node_count_subgraph)}; expected=${result.expected_node_count}`,
    `|subgraph_only|=${String(result.subgraph_only_count)}${result.subgraph_only.length === 0 ? "" : `; subgraph_only=${result.subgraph_only.join(", ")}`}`,
    `edge_count(latest)=${String(result.edge_count_latest)}; expected=${result.expected_edge_count}`,
    `target_ids present (${result.target_ids.present.length}/5): ${result.target_ids.present.join(", ") || "(none)"}`,
    `target_ids absent (${result.target_ids.absent.length}/5): ${result.target_ids.absent.join(", ") || "(none)"}`,
    `VERDICT ${result.verdict}${result.failure_reasons.length === 0 ? "" : `: ${result.failure_reasons.join("; ")}`}`,
  ].join("\n");
}

function renderMarkdown(output: { generated_at: string; results: CityResult[]; overall_verdict: string }): string {
  return [
    "# Validation geo-independante — superset ≥prod, 3 villes",
    "",
    `Généré le : ${output.generated_at}`,
    "",
    "Cette validation prouve, côté geo et sans credentials, que l’objet ≥prod de recette contient tous les nœuds prod-PG et les 15 ids cibles : 0 nœud prod perdu.",
    "",
    "Le fait que l’ancien objet S3 (24/24/23) soit un sous-ensemble de prod (S3-only=0) est l’attestation de lecture-S3 de recette; geo n’a pas les credentials du bucket `radar-immobilier-docs-pocs` et ne le re-vérifie donc pas ici. Le PUT lui-même revient à immo (décision frontière v3.4).",
    "",
    "## Résultats bruts",
    "",
    ...output.results.flatMap((result) => [
      `### ${result.city} — ${result.verdict}`,
      "",
      `- node_count(latest) : ${String(result.node_count_latest)}; node_count(subgraph) : ${String(result.node_count_subgraph)}; attendu : ${result.expected_node_count}`,
      `- |subgraph_only| : ${String(result.subgraph_only_count)}${result.subgraph_only.length === 0 ? "" : ` (${result.subgraph_only.join(", ")})`}`,
      `- edge_count(latest) : ${String(result.edge_count_latest)}; attendu : ${result.expected_edge_count}`,
      `- ids cibles présents (${result.target_ids.present.length}/5) : ${result.target_ids.present.join(", ") || "(aucun)"}`,
      `- ids cibles absents (${result.target_ids.absent.length}/5) : ${result.target_ids.absent.join(", ") || "(aucun)"}`,
      `- raisons d’échec : ${result.failure_reasons.join("; ") || "aucune"}`,
      "",
    ]),
    `## Verdict global : ${output.overall_verdict}`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const outputJson = requiredOutPath(process.argv.slice(2));
  const results: CityResult[] = [];
  for (const spec of SPECS) {
    results.push(await validateCity(spec));
  }
  const output = {
    generated_at: new Date().toISOString(),
    scope: "on-disk only; no S3, credentials, or network access",
    handoff_dir: HANDOFF_DIR,
    results,
    overall_verdict: results.every((result) => result.verdict === "PASS") ? "PASS" : "FAIL",
  };
  await mkdir(path.dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(outputJson.replace(/\.json$/, ".md"), renderMarkdown(output), "utf8");
  for (const result of results) console.log(renderConsole(result));
  console.log(`OVERALL VERDICT ${output.overall_verdict}`);
  console.log(`REPORT JSON ${path.relative(process.cwd(), outputJson)}`);
  console.log(`REPORT MD ${path.relative(process.cwd(), outputJson.replace(/\.json$/, ".md"))}`);
  if (output.overall_verdict === "FAIL") process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
