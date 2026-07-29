/** Aggregate short PV octet classifications for one bounded campaign. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { parseManifestJsonl, type CaptureManifestLine } from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MAX_REPORT_BYTES = 5 * 1024 * 1024;

type ClassificationLine = {
  manifest_key: unknown;
  line_index: unknown;
  url: unknown;
  storage_key: unknown;
  classification: unknown;
};

type ClassificationReport = {
  contract: unknown;
  complete: unknown;
  scope: { bucket?: unknown; lane?: unknown; source?: unknown; run_prefix?: unknown } | null;
  progress: { attempts?: unknown } | null;
  summary: Record<string, unknown>;
  lines: unknown;
};

type ClassificationEvidence = {
  path: string;
  scope: { run_prefix: string };
  lines: ClassificationLine[];
};

function optionValues(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv.slice(2).flatMap((arg) => arg.startsWith(prefix) ? [arg.slice(prefix.length)] : []);
}

function optionValue(name: string): string {
  const value = optionValues(name)[0];
  if (!value) throw new Error(`--${name}=... est requis`);
  return value;
}

function repoPath(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt refusé: ${path}`);
  return absolute;
}

function readSmallJson(path: string): unknown {
  const absolute = repoPath(path);
  const size = statSync(absolute).size;
  if (size > MAX_REPORT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture ${MAX_REPORT_BYTES}`);
  return JSON.parse(readFileSync(absolute, "utf8"));
}

function parseClassification(path: string): ClassificationEvidence {
  const raw = readSmallJson(path) as ClassificationReport;
  if (raw.contract !== "pv-capture-octets-classification/v1" || raw.complete !== true) {
    throw new Error(`${path}: classification PV complète requise`);
  }
  if (
    raw.scope?.bucket !== "sentropic-geo" ||
    raw.scope.lane !== "pv" ||
    raw.scope.source !== "pv-index" ||
    typeof raw.scope.run_prefix !== "string"
  ) {
    throw new Error(`${path}: scope PV invalide`);
  }
  if (!Array.isArray(raw.lines)) throw new Error(`${path}: lines invalide`);
  const lines = raw.lines.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`${path}: lines[${index}] invalide`);
    const line = value as ClassificationLine;
    if (typeof line.manifest_key !== "string" || !Number.isInteger(line.line_index)) {
      throw new Error(`${path}: identité de ligne invalide à ${index}`);
    }
    if (typeof line.url !== "string" || typeof line.classification !== "string") {
      throw new Error(`${path}: classification invalide à ${index}`);
    }
    if (line.storage_key !== null && typeof line.storage_key !== "string") {
      throw new Error(`${path}: storage_key invalide à ${index}`);
    }
    return line;
  });
  return { path, scope: { run_prefix: raw.scope.run_prefix }, lines };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "<url-invalide>";
  }
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function lineKey(manifestKey: string, lineIndex: number): string {
  return `${manifestKey}\u0000${lineIndex}`;
}

async function manifestEvidence(
  s3: ReturnType<typeof s3Client>,
  report: ClassificationEvidence,
): Promise<Map<string, CaptureManifestLine>> {
  const prefix = report.scope.run_prefix!;
  const keys = (await listObjectEntries(s3, prefix))
    .map((entry) => entry.key)
    .filter((key) => key.endsWith("/manifest.jsonl"));
  if (keys.length === 0) throw new Error(`${report.path}: manifeste S3 absent sous ${prefix}`);
  const result = new Map<string, CaptureManifestLine>();
  for (const key of keys) {
    const body = await getBytes(s3, key);
    if (body.byteLength > MAX_REPORT_BYTES) throw new Error(`${key}: ${body.byteLength} octets > plafond de lecture ${MAX_REPORT_BYTES}`);
    for (const [index, line] of parseManifestJsonl(body.toString("utf8")).entries()) {
      result.set(lineKey(key, index + 1), line);
    }
  }
  return result;
}

function compactCounts(lines: readonly ClassificationLine[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) increment(counts, String(line.classification));
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function main(): Promise<void> {
  const paths = optionValues("classification");
  if (paths.length < 4) throw new Error("au moins quatre --classification=... sont requis pour un taux d'arrêt");
  const output = optionValue("out");
  const outPath = repoPath(output);
  const markdownPath = outPath.endsWith(".json") ? `${outPath.slice(0, -5)}.md` : `${outPath}.md`;
  if (existsSync(outPath) || existsSync(markdownPath)) throw new Error(`refus d'écraser le rapport ${relative(ROOT, outPath)}`);

  const reports = paths.map(parseClassification);
  const s3 = s3Client();
  const manifestByClassification = new Map<string, CaptureManifestLine>();
  for (const report of reports) {
    const evidence = await manifestEvidence(s3, report);
    for (const [key, line] of evidence) manifestByClassification.set(key, line);
  }

  const allLines = reports.flatMap((report) => report.lines);
  const counts = compactCounts(allLines);
  const confirmed = counts.PV_LISIBLE_PROPRIETAIRE_CONFIRME ?? 0;
  const http404 = counts.HTTP_404 ?? 0;
  const http403 = counts.HTTP_403 ?? 0;
  const denominator = allLines.length - http404 - http403;
  const stopRatePercent = denominator === 0 ? 0 : Number(((confirmed / denominator) * 100).toFixed(2));
  const casKeys = new Set<string>();
  const newCasKeys = new Set<string>();
  const deadHosts = new Map<string, number>();
  for (const line of allLines) {
    if (line.storage_key !== null) {
      casKeys.add(line.storage_key as string);
      const manifestLine = manifestByClassification.get(lineKey(line.manifest_key as string, line.line_index as number));
      if (!manifestLine) throw new Error(`ligne de classification absente du manifeste: ${line.manifest_key}:${line.line_index}`);
      if (manifestLine.storage_key !== line.storage_key) throw new Error(`storage_key divergent: ${line.manifest_key}:${line.line_index}`);
      if (manifestLine.dedup === false) newCasKeys.add(line.storage_key as string);
    }
    if (line.classification === "HTTP_404") increment(deadHosts, hostOf(line.url as string));
  }

  const lots = reports.map((report) => ({
    report: relative(ROOT, report.path),
    run_prefix: report.scope.run_prefix,
    attempts: report.lines.length,
    counts: compactCounts(report.lines),
  }));
  const hostRows = [...deadHosts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([host, count]) => ({ host, http_404: count, status: "hote_mort" }));
  const result = {
    contract: "pv-capture-ordre-du-jour-campaign-report/v1",
    generated_at: new Date().toISOString(),
    scope: { lane: "pv", source: "pv-index", lots: reports.length, attempts: allLines.length },
    lots,
    aggregate: {
      counts,
      confirmed,
      http_404: http404,
      http_403: http403,
      denominator,
      stop_rate_percent: stopRatePercent,
      expected_confirmation_percent: 76.7,
      unique_cas_keys: casKeys.size,
      new_cas_keys: newCasKeys.size,
    },
    dead_hosts: hostRows,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  const lotLines = lots.map((lot, index) => `${index + 1}. ${lot.attempts} tentatives — ${Object.entries(lot.counts).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  const markdown = [
    "# Capture ODJ — agrégat des six lots",
    "",
    `Rapport JSON : \`${relative(ROOT, outPath)}\``,
    "",
    ...lotLines,
    "",
    `- Agrégat : ${allLines.length} tentatives ; confirmés=${confirmed} ; 404=${http404} ; 403=${http403}`,
    `- Taux d'arrêt agrégé : ${confirmed}/${denominator} = ${stopRatePercent}% (cible 76,7 % ; calcul sur au moins quatre lots)`,
    `- CAS : ${casKeys.size} distinctes durables ; ${newCasKeys.size} nouvelles (dedup=false)`,
    `- Hôtes morts journalisés : ${hostRows.length === 0 ? "aucun" : hostRows.map((row) => `${row.host} (${row.http_404}×404)`).join(", ")}`,
    "",
  ].join("\n");
  writeFileSync(markdownPath, markdown);
  process.stdout.write(`${JSON.stringify({ report: relative(ROOT, outPath), markdown: relative(ROOT, markdownPath), attempts: allLines.length, confirmed, denominator, stop_rate_percent: stopRatePercent, unique_cas_keys: casKeys.size, new_cas_keys: newCasKeys.size, dead_hosts: hostRows }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
