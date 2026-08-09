/** Open captured HTML CAS bodies and give every one an explicit PV verdict. */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { getBytes, objectHead, s3Client } from "./lib/s3.js";
import { assessPvHtmlResource } from "./lib/pv-html-resource-verdict.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MAX_REPORT_BYTES = 5 * 1024 * 1024;

interface HtmlLine {
  readonly classification: string;
  readonly storage_key: string | null;
  readonly slug?: string;
  readonly municipality_name?: string | null;
  readonly url: string;
}

function values(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv.slice(2).flatMap((arg) => arg.startsWith(prefix) ? [arg.slice(prefix.length)] : []);
}

function repoPath(value: string): string {
  const path = resolve(ROOT, value);
  if (!path.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt refusé: ${value}`);
  return path;
}

function readSmallJson(path: string): unknown {
  if (statSync(path).size > MAX_REPORT_BYTES) throw new Error(`${relative(ROOT, path)}: lecture > 5 MiB refusée`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function writeImmutable(path: string, value: unknown): void {
  if (existsSync(path)) throw new Error(`refus d'écraser le rapport: ${relative(ROOT, path)}`);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const classifications = values("classification");
  const outputs = values("out");
  if (classifications.length === 0 || outputs.length !== 1 || !outputs[0]) {
    throw new Error("--classification=... et --out=... sont requis");
  }
  const lines: HtmlLine[] = [];
  const seen = new Set<string>();
  for (const rawPath of classifications) {
    const path = repoPath(rawPath);
    const report = readSmallJson(path);
    if (!report || typeof report !== "object" || (report as { contract?: unknown }).contract !== "pv-capture-octets-classification/v1") {
      throw new Error(`${rawPath}: rapport de classification PV invalide`);
    }
    const reportLines = (report as { lines?: unknown }).lines;
    if (!Array.isArray(reportLines)) throw new Error(`${rawPath}: lines absentes`);
    for (const value of reportLines) {
      if (!value || typeof value !== "object") throw new Error(`${rawPath}: ligne invalide`);
      const line = value as HtmlLine;
      if (line.classification !== "PAGE_HTML") continue;
      if (!line.storage_key || seen.has(line.storage_key)) throw new Error(`${rawPath}: clé HTML absente ou dupliquée`);
      if (typeof line.municipality_name !== "string" || !line.municipality_name.trim()) {
        throw new Error(`${rawPath}: propriétaire municipal absent pour ${line.storage_key}`);
      }
      seen.add(line.storage_key);
      lines.push(line);
    }
  }
  const s3 = s3Client();
  const documents = [];
  for (const line of lines.sort((left, right) => left.storage_key!.localeCompare(right.storage_key!))) {
    const head = await objectHead(s3, line.storage_key!);
    if (!head.exists || head.contentLength === undefined) throw new Error(`${line.storage_key}: objet HTML absent ou sans taille`);
    if (head.contentLength > MAX_REPORT_BYTES) throw new Error(`${line.storage_key}: octets > 5 MiB refusés`);
    const assessment = assessPvHtmlResource(await getBytes(s3, line.storage_key!), line.url, line.municipality_name!);
    documents.push({
      storage_key: line.storage_key,
      slug: line.slug ?? null,
      municipality_name: line.municipality_name,
      requested_url: line.url,
      ...assessment,
      indexed: false,
    });
  }
  const counts = Object.fromEntries([...documents.reduce((map, document) => {
    map.set(document.verdict, (map.get(document.verdict) ?? 0) + 1);
    return map;
  }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right)));
  const report = {
    contract: "pv-html-resource-audit/v1",
    generated_at: new Date().toISOString(),
    source_classifications: classifications.map(repoPath).map((path) => relative(ROOT, path)),
    opened_html_documents: documents.length,
    verdict_counts: counts,
    documents,
  };
  const output = repoPath(outputs[0]!);
  writeImmutable(output, report);
  console.log(JSON.stringify({ report: relative(ROOT, output), opened_html_documents: documents.length, verdict_counts: counts }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
