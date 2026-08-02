/**
 * Materialise the exact 2026-08-02 v2-mass capture scope from its committed
 * capture worklist and the final served-proof audit.  It does not fetch or
 * write S3: missing audit facts stay missing and abort the scope.
 *
 * Usage:
 *   npx tsx acquisition/src/_served-zonage-proof-v1-v2-v2mass-scope.ts \
 *     --worklist=work/coverage/zones-v2mass-worklist-capture-20260802T220000Z.json \
 *     --audit=work/coverage/served-zonage-immo-proof-url-audit-final-20260728T120900Z.json \
 *     --out=work/coverage/served-zonage-proof-v1-v2-capture-scope-20260802T220000Z.json \
 *     --worklist-out=work/coverage/served-zonage-proof-v1-v2-capture-control-20260802T220000Z.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const SLUG_RE = /^[a-z0-9-]+$/;
const SOURCE_RE = /^[a-z0-9][a-z0-9._-]*$/;

interface WorklistTarget {
  slug: string;
  source: string;
  urls: string[];
}

interface AuditCase {
  url: string;
  sha256: `sha256:${string}`;
  retrieved_at?: string;
}

interface AuditRow {
  slug: string;
  key: string;
  verifiable_https_sha256_cases: AuditCase[];
}

interface Audit {
  contract: "served-zonage-immo-proof-url-audit/v1";
  complete: true;
  rows: AuditRow[];
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function readWorklist(path: string): WorklistTarget[] {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(value) || value.length !== 111) throw new Error("worklist must contain exactly 111 targets");
  const seenSlugs = new Set<string>();
  for (const target of value) {
    if (
      target === null || typeof target !== "object" ||
      typeof target.slug !== "string" || !SLUG_RE.test(target.slug) ||
      typeof target.source !== "string" || !SOURCE_RE.test(target.source) ||
      !Array.isArray(target.urls) || target.urls.length !== 1 ||
      typeof target.urls[0] !== "string" || !target.urls[0].startsWith("https://") ||
      seenSlugs.has(target.slug)
    ) throw new Error("worklist target is invalid, ambiguous, or repeated");
    seenSlugs.add(target.slug);
  }
  return value as WorklistTarget[];
}

function readAudit(path: string): Audit {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Audit>;
  if (value.contract !== "served-zonage-immo-proof-url-audit/v1" || value.complete !== true || !Array.isArray(value.rows)) {
    throw new Error(`audit incomplete or incompatible: ${relative(ROOT, path)}`);
  }
  return value as Audit;
}

function auditCase(row: AuditRow, url: string): AuditCase {
  const matches = row.verifiable_https_sha256_cases.filter((candidate) => candidate?.url === url);
  if (matches.length !== 1) throw new Error(`audit must expose one exact URL/SHA case for ${row.slug}; found ${matches.length}`);
  const candidate = matches[0]!;
  if (!SHA256_RE.test(candidate.sha256) || (candidate.retrieved_at !== undefined && typeof candidate.retrieved_at !== "string")) {
    throw new Error(`audit URL/SHA case is invalid for ${row.slug}`);
  }
  return candidate;
}

function writeNew(path: string, value: unknown): void {
  if (existsSync(path)) throw new Error(`refusing to overwrite: ${relative(ROOT, path)}`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function main(): void {
  const worklistArgument = option("worklist");
  const auditArgument = option("audit");
  const outputArgument = option("out");
  const controlArgument = option("worklist-out");
  if (!worklistArgument || !auditArgument || !outputArgument || !controlArgument) {
    throw new Error("--worklist=<worklist.json> --audit=<audit.json> --out=<scope.json> --worklist-out=<control.json> are required");
  }
  const worklistPath = insideRepo(worklistArgument, "worklist");
  const auditPath = insideRepo(auditArgument, "audit");
  const outputPath = insideRepo(outputArgument, "out");
  const controlPath = insideRepo(controlArgument, "worklist-out");
  if (outputPath === controlPath) throw new Error("--out and --worklist-out must differ");
  const worklist = readWorklist(worklistPath);
  const audit = readAudit(auditPath);
  const rows = new Map(audit.rows.map((row) => [row.slug, row]));
  if (rows.size !== audit.rows.length) throw new Error("audit repeats a slug");

  const collectionScope = worklist.map((target) => {
    const row = rows.get(target.slug);
    if (!row) throw new Error(`worklist slug absent from audit: ${target.slug}`);
    const expectedKey = `normalized/ca-qc-zonage/qc-zonage-${target.slug}.geojson`;
    const nestedKey = `normalized/ca-qc-zonage/qc-zonage-${target.slug}/qc-zonage-${target.slug}.geojson`;
    if (row.key !== expectedKey && row.key !== nestedKey) throw new Error(`audit key is not a served zonage key for ${target.slug}`);
    const proof = auditCase(row, target.urls[0]!);
    return {
      slug: target.slug,
      key: row.key,
      url: proof.url,
      sha256: proof.sha256,
      retrieved_at: proof.retrieved_at ?? null,
    };
  });
  const scope = {
    contract: "served-zonage-proof-v1-v2-capture-scope/v1",
    generated_at: new Date().toISOString(),
    worklist: relative(ROOT, controlPath),
    source_worklist: relative(ROOT, worklistPath),
    audit: relative(ROOT, auditPath),
    collections: collectionScope.length,
    distinct_urls: new Set(collectionScope.map((row) => row.url)).size,
    collection_scope: collectionScope,
  };
  writeNew(outputPath, scope);
  writeNew(controlPath, worklist);
  console.log(JSON.stringify({ scope: relative(ROOT, outputPath), worklist: relative(ROOT, controlPath), collections: scope.collections, distinct_urls: scope.distinct_urls }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
