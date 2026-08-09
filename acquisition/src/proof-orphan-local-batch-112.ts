/**
 * Local-only recovery pass for the 112 zone collections that remained `orphan`
 * in proof-orphan-356 reconciliation.  It deliberately does not fetch, use S3,
 * or alter the served corpus.
 *
 * Usage (from repository root):
 *   npx tsx acquisition/src/proof-orphan-local-batch-112.ts
 *   npx tsx acquisition/src/proof-orphan-local-batch-112.ts --batch-size 16 --batch-index 1
 *   npx tsx acquisition/src/proof-orphan-local-batch-112.ts --resume
 *
 * `--resume` is intentionally conservative: a compatible primary JSON report
 * is checked, completed batches are retained, and only the selected batch is
 * re-scanned. The JSON is the atomic source of truth; its Markdown companion
 * is deterministically regenerated after each successful JSON write.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..");
export const DEFAULT_INPUT = "work/coverage/proof-orphan-356-reconciliation-20260722.json";
export const DEFAULT_OUTPUT = "work/coverage/proof-orphan-112-local-batches-20260722.json";
export const DEFAULT_MARKDOWN_OUTPUT = "work/coverage/proof-orphan-112-local-batches-20260722.md";
const CONTRACT = "proof-orphan-local-batch/112/v1";
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_GIT_DIFF_BYTES = 2 * 1024 * 1024;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Classification = "historical-verified" | "legacy-traceable" | "candidate-needs-human-confirmation" | "orphan";
type EvidenceKind = "current-json" | "current-text" | "git-diff";
type Evidence = {
  kind: EvidenceKind;
  path: string;
  sha256: string;
  source_url: string;
  source_field?: string;
  json_pointer?: string;
  line?: number;
  commit?: string;
  retained_artifact?: { path: string; sha256: string; tied_to_source_url: string };
  chain_markers?: string[];
};
export type InputCollection = {
  slug: string;
  collection_key: string;
  layout: "flat" | "nested";
  features: number;
  classification: string;
};
type ScanFact = Evidence & {
  identity: "exact-collection" | "exact-run" | "slug-only";
  has_successful_run: boolean;
  has_output_chain: boolean;
};
export type Row = {
  slug: string;
  collection_key: string;
  layout: "flat" | "nested";
  features: number;
  classification: Classification;
  source_identity: string | null;
  source_identity_status: "historical-linked" | "legacy-linked" | "candidate-only" | null;
  evidence: Evidence[];
  rationale: string;
  recovery: { priority: "P0" | "P1" | "P2" | "P3"; action: string };
};
type Args = {
  input: string;
  out: string;
  markdownOut: string;
  batchSize: number;
  batchIndex: number | null;
  resume: boolean;
};
type Report = {
  contract: string;
  local_only: true;
  input: { path: string; sha256: string; selected_classification: "orphan"; selected_collections: number; selected_features: number };
  batch: { batch_size: number; batch_index: number | null; batch_count: number; selected_rows: number; completed_batch_indexes: number[]; report_rows: number; complete: boolean };
  scan: { roots: string[]; extensions: string[]; current_files_examined: number; git_history_queries: number; git_history_hits: number };
  policy: Record<Classification, string>;
  counts: Record<Classification, { collections: number; features: number }>;
  collections: Row[];
  validation: Record<string, boolean>;
};

const codepointCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const posix = (value: string): string => value.split(sep).join("/");
const sha256 = (value: Buffer | string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const cleanPath = (path: string): string => posix(relative(ROOT, path));

function usage(): never {
  throw new Error("usage: proof-orphan-local-batch-112.ts [--input path] [--out path] [--markdown-out path] [--batch-size N] [--batch-index N] [--resume]");
}

export function parseArgs(argv: string[]): Args {
  let input = DEFAULT_INPUT;
  let out = DEFAULT_OUTPUT;
  let markdownOut = DEFAULT_MARKDOWN_OUTPUT;
  let batchSize = 112;
  let batchIndex: number | null = null;
  let resume = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = (): string => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) usage();
      return value;
    };
    if (arg === "--input") input = next();
    else if (arg === "--out") out = next();
    else if (arg === "--markdown-out") markdownOut = next();
    else if (arg === "--batch-size") batchSize = Number(next());
    else if (arg === "--batch-index") batchIndex = Number(next());
    else if (arg === "--resume") resume = true;
    else usage();
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 112) throw new Error("--batch-size must be an integer from 1 to 112");
  if (batchIndex !== null && (!Number.isInteger(batchIndex) || batchIndex < 1)) throw new Error("--batch-index must be a positive integer");
  return { input, out, markdownOut, batchSize, batchIndex, resume };
}

function isObject(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function selectOrphans(input: Json): InputCollection[] {
  if (!isObject(input) || !Array.isArray(input.collections)) throw new Error("reconciliation input has no collections array");
  const rows = input.collections.filter((value): value is Json & InputCollection => isObject(value) && value.classification === "orphan");
  const parsed = rows.map((row) => {
    if (typeof row.slug !== "string" || typeof row.collection_key !== "string" ||
      (row.layout !== "flat" && row.layout !== "nested") || typeof row.features !== "number") {
      throw new Error("orphan reconciliation row has an invalid collection contract");
    }
    return { slug: row.slug, collection_key: row.collection_key, layout: row.layout, features: row.features, classification: row.classification };
  }).sort((a, b) => codepointCompare(a.slug, b.slug));
  if (parsed.length !== 112) throw new Error(`expected exactly 112 orphan collections, got ${parsed.length}`);
  if (new Set(parsed.map((row) => row.slug)).size !== parsed.length) throw new Error("orphan slugs are not unique");
  return parsed;
}

function scanRoots(): string[] {
  return ["acquisition/config", "acquisition/work", "config", "work"].filter((path) => existsSync(resolve(ROOT, path)));
}

const SCANNED_EXTENSIONS = new Set([".json", ".jsonl", ".ndjson", ".geojson", ".txt", ".log", ".out", ".err", ".md", ".csv", ".tsv", ".yaml", ".yml"]);
const ARTIFACT_EXTENSIONS = new Set([".pdf", ".geojson", ".json", ".zip", ".gpkg", ".shp", ".tif", ".tiff"]);
const IGNORED_DIRECTORY_NAMES = new Set([".git", "node_modules", ".tsx-tmp", ".tmp-tsx", ".codex-tmp-geo-test"]);

function localFiles(excluded: ReadonlySet<string>): string[] {
  const result: string[] = [];
  const visit = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => codepointCompare(a.name, b.name))) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) visit(resolve(folder, entry.name));
      } else if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const path = resolve(folder, entry.name);
        if (!excluded.has(path) && lstatSync(path).size <= MAX_TEXT_BYTES) result.push(path);
      }
    }
  };
  for (const root of scanRoots()) visit(resolve(ROOT, root));
  return result.sort((a, b) => codepointCompare(cleanPath(a), cleanPath(b)));
}

function stringsIn(value: Json, prefix = ""): Array<{ value: string; pointer: string }> {
  if (typeof value === "string") return [{ value, pointer: prefix || "/" }];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringsIn(item, `${prefix}/${index}`));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => stringsIn(item, `${prefix}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
}

function lowerKeys(value: Json): string[] {
  if (!isObject(value)) return [];
  return Object.keys(value).map((key) => key.toLowerCase());
}

function directStrings(value: Json): string[] {
  if (!isObject(value)) return [];
  return Object.values(value).filter((item): item is string => typeof item === "string");
}

function exactSourceUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith("amazonaws.com") || host.includes("s3.")) return false;
  return /\.(geojson|json|zip|gpkg|shp|pdf|kml)(?:$|\/)/.test(pathname) ||
    /\/(featureserver|mapserver)\/\d+(?:\/query)?\/?$/.test(pathname) ||
    /\/(wfs|ows)(?:\/|$)/.test(pathname) ||
    /service=wfs|f=geojson|request=getfeature/i.test(url.search);
}

function sourceField(key: string): boolean {
  const lower = key.toLowerCase();
  if (/reglement|regulation|homepage|website|municipal|s3/.test(lower)) return false;
  return /(?:source|upstream|geometry|layer|service|endpoint|download|url|href)/.test(lower);
}

function sourceValues(record: Json): Array<{ field: string; url: string }> {
  if (!isObject(record)) return [];
  const result: Array<{ field: string; url: string }> = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && sourceField(key) && exactSourceUrl(value)) result.push({ field: key, url: value });
    if (isObject(value) && sourceField(key)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (typeof nestedValue === "string" && sourceField(nestedKey) && exactSourceUrl(nestedValue)) result.push({ field: `${key}.${nestedKey}`, url: nestedValue });
      }
    }
  }
  return result.sort((a, b) => codepointCompare(`${a.field}\n${a.url}`, `${b.field}\n${b.url}`));
}

function identityFor(record: Json, collection: InputCollection): ScanFact["identity"] | null {
  const values = stringsIn(record).map((item) => item.value);
  const collectionName = `qc-zonage-${collection.slug}`;
  if (values.some((value) => value.includes(collection.collection_key))) return "exact-collection";
  if (values.some((value) => value === collectionName || value.includes(`/${collectionName}.geojson`))) return "exact-run";
  if (isObject(record) && record.slug === collection.slug) return "slug-only";
  return null;
}

export function chainMarkers(record: Json, collection: InputCollection): { successful: boolean; output: boolean; markers: string[] } {
  if (!isObject(record)) return { successful: false, output: false, markers: [] };
  const collectionName = `qc-zonage-${collection.slug}`;
  let successful = false;
  let output = false;
  for (const [key, value] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if ((lower === "success" || lower === "successful") && value === true) successful = true;
    if (/^(status|state|result|outcome)$/.test(lower) && typeof value === "string" && /^(success|successful|succeeded|complete|completed)$/i.test(value.trim())) successful = true;
    if (/^(?:output|served|deposited|published)(?:_|$)/.test(lower) && typeof value === "string" &&
      (value.includes(collection.collection_key) || value === collectionName || value.includes(`/${collectionName}.geojson`))) output = true;
  }
  const markers: string[] = [];
  if (successful) markers.push("successful-run");
  if (output) markers.push("output-chain");
  return { successful, output, markers };
}

export function hasArtifactBinding(record: Json, sourceUrl: string): boolean {
  if (!isObject(record)) return false;
  return ["source_artifact_url", "geometry_artifact_url", "local_source_url"]
    .some((key) => record[key] === sourceUrl);
}

function localArtifact(record: Json, sourceUrl: string): { path: string; sha256: string; tied_to_source_url: string } | undefined {
  if (!isObject(record)) return undefined;
  if (!hasArtifactBinding(record, sourceUrl)) return undefined;
  for (const [key, candidate] of Object.entries(record)) {
    const lower = key.toLowerCase();
    // Only an explicit source/geometry artifact field in the same structured
    // record as the URL is a retained source artifact. Never promote a generic
    // output path, evidence path, or arbitrary neighbouring PDF/GeoJSON.
    if (typeof candidate !== "string" || !/^(?:local_)?(?:source|geometry)_(?:artifact|file|path)$/.test(lower)) continue;
    if (!ARTIFACT_EXTENSIONS.has(extname(candidate).toLowerCase())) continue;
    const path = resolve(ROOT, candidate);
    if (!path.startsWith(`${ROOT}${sep}`) || !existsSync(path) || !lstatSync(path).isFile()) continue;
    return { path: cleanPath(path), sha256: sha256(readFileSync(path)), tied_to_source_url: sourceUrl };
  }
  return undefined;
}

function jsonFacts(value: Json, path: string, fileHash: string, collections: InputCollection[]): Map<string, ScanFact[]> {
  const facts = new Map(collections.map((collection) => [collection.slug, [] as ScanFact[]]));
  const bySlug = new Map(collections.map((collection) => [collection.slug, collection]));
  const byName = new Map(collections.map((collection) => [`qc-zonage-${collection.slug}`, collection]));
  const visit = (record: Json, pointer: string): void => {
    if (!isObject(record)) {
      if (Array.isArray(record)) record.forEach((item, index) => visit(item, `${pointer}/${index}`));
      return;
    }
    const matches = new Map<string, { collection: InputCollection; identity: ScanFact["identity"] }>();
    for (const value of directStrings(record)) {
      for (const collection of collections) {
        if (value.includes(collection.collection_key)) matches.set(collection.slug, { collection, identity: "exact-collection" });
      }
      const named = byName.get(value);
      if (named && !matches.has(named.slug)) matches.set(named.slug, { collection: named, identity: "exact-run" });
    }
    if (typeof record.slug === "string") {
      const slugged = bySlug.get(record.slug);
      if (slugged && !matches.has(slugged.slug)) matches.set(slugged.slug, { collection: slugged, identity: "slug-only" });
    }
    const sources = matches.size ? sourceValues(record) : [];
    if (matches.size && sources.length) {
      for (const { collection, identity } of matches.values()) {
        const chain = chainMarkers(record, collection);
        for (const source of sources) {
          const artifact = localArtifact(record, source.url);
          facts.get(collection.slug)!.push({
            kind: "current-json", path: cleanPath(path), sha256: fileHash, source_url: source.url, source_field: source.field,
            json_pointer: pointer || "/", identity, has_successful_run: chain.successful, has_output_chain: chain.output,
            ...(artifact ? { retained_artifact: artifact } : {}), ...(chain.markers.length ? { chain_markers: chain.markers } : {}),
          });
        }
      }
    }
    for (const [key, nested] of Object.entries(record)) visit(nested, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  };
  visit(value, "");
  return facts;
}

function textFacts(text: string, path: string, fileHash: string, collection: InputCollection): ScanFact[] {
  const lines = text.split(/\r?\n/);
  const facts: ScanFact[] = [];
  const needle = `qc-zonage-${collection.slug}`;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.includes(collection.collection_key) && !line.includes(needle)) continue;
    // A bulk log can put unrelated municipalities next to one another. Text
    // evidence is admissible only when its exact collection identity and URL
    // occur on the same record line.
    const urls = [...line.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((match) => match[0]!.replace(/[),.;]+$/, "")).filter(exactSourceUrl);
    for (const sourceUrl of [...new Set(urls)].sort(codepointCompare)) facts.push({
      kind: "current-text", path: cleanPath(path), sha256: fileHash, source_url: sourceUrl, line: index + 1,
      identity: line.includes(collection.collection_key) ? "exact-collection" : "exact-run",
      has_successful_run: false, has_output_chain: false,
    });
  }
  return facts;
}

function mentionsCollection(text: string, collection: InputCollection): boolean {
  const name = `qc-zonage-${collection.slug}`;
  return text.includes(collection.collection_key) || text.includes(name) ||
    new RegExp(`\\"slug\\"\\s*:\\s*\\"${collection.slug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\"`).test(text);
}

function currentFacts(files: string[], collections: InputCollection[]): Map<string, ScanFact[]> {
  const found = new Map(collections.map((collection) => [collection.slug, [] as ScanFact[]]));
  for (const path of files) {
    const bytes = readFileSync(path);
    const text = bytes.toString("utf8");
    if (text.startsWith("# Proof-orphan 112 local batches —")) continue;
    const candidates = collections.filter((collection) => mentionsCollection(text, collection));
    if (!candidates.length) continue;
    const fileHash = sha256(bytes);
    if ([".json", ".geojson"].includes(extname(path).toLowerCase())) {
      try {
        const parsed = JSON.parse(text) as Json;
        if (isObject(parsed) && parsed.contract === CONTRACT) continue;
        const indexedFacts = jsonFacts(parsed, path, fileHash, candidates);
        for (const [slug, facts] of indexedFacts) found.get(slug)!.push(...facts);
        continue;
      } catch { /* fall through: malformed JSON is still searchable text evidence. */ }
    }
    for (const collection of candidates) found.get(collection.slug)!.push(...textFacts(text, path, fileHash, collection));
  }
  return found;
}

function gitText(command: string[]): string {
  const run = spawnSync("git", command, { cwd: ROOT, encoding: "utf8", maxBuffer: MAX_GIT_DIFF_BYTES });
  if (run.status !== 0) throw new Error(`git ${command.join(" ")} failed: ${run.stderr.trim()}`);
  return run.stdout;
}

/** A historical diff larger than the fixed local inspection bound is not proof. */
function boundedGitText(command: string[]): { text: string; sha256: string } | null {
  const run = spawnSync("git", command, { cwd: ROOT, maxBuffer: MAX_GIT_DIFF_BYTES });
  if (run.status !== 0 || !run.stdout) return null;
  const bytes = Buffer.from(run.stdout);
  return { text: bytes.toString("utf8"), sha256: sha256(bytes) };
}

function gitFacts(collections: InputCollection[]): { facts: Map<string, ScanFact[]>; commits: number; queries: number } {
  const commitIds = new Set<string>();
  const historyBatchSize = 16;
  for (let index = 0; index < collections.length; index += historyBatchSize) {
    const pattern = collections.slice(index, index + historyBatchSize)
      .flatMap((collection) => [collection.collection_key, `qc-zonage-${collection.slug}`])
      .map((identity) => identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    for (const commit of gitText(["log", "--all", "--format=%H", "-G", pattern, "--", "work", "acquisition/config", "acquisition/work", "config"])
      .trim().split(/\r?\n/).filter(Boolean)) commitIds.add(commit);
  }
  const commits = [...commitIds].sort(codepointCompare);
  const facts = new Map(collections.map((collection) => [collection.slug, [] as ScanFact[]]));
  for (const commit of commits) {
    const diff = boundedGitText(["show", "--format=", "--unified=0", commit]);
    if (diff === null) continue;
    if (Buffer.byteLength(diff.text) > MAX_GIT_DIFF_BYTES) continue;
    const lines = diff.text.split(/\r?\n/);
    for (const collection of collections) {
      for (let index = 0; index < lines.length; index += 1) {
        const collectionName = `qc-zonage-${collection.slug}`;
        if (!lines[index]!.includes(collection.collection_key) && !lines[index]!.includes(collectionName)) continue;
        // Git diffs are unstructured. Never associate an adjacent changed line
        // with the collection line; require exact same-line identity instead.
        const urls = [...lines[index]!.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((match) => match[0]!.replace(/[),.;]+$/, "")).filter(exactSourceUrl);
        for (const sourceUrl of [...new Set(urls)].sort(codepointCompare)) facts.get(collection.slug)!.push({
          kind: "git-diff", path: "git-history", sha256: diff.sha256, source_url: sourceUrl, line: index + 1, commit,
          identity: lines[index]!.includes(collection.collection_key) ? "exact-collection" : "exact-run", has_successful_run: false, has_output_chain: false,
        });
      }
    }
  }
  return { facts, commits: commits.length, queries: Math.ceil(collections.length / historyBatchSize) };
}

function evidenceKey(evidence: Evidence): string {
  return [evidence.kind, evidence.path, evidence.sha256, evidence.source_url, evidence.source_field ?? "", evidence.json_pointer ?? "", evidence.line ?? "", evidence.commit ?? ""].join("\u0000");
}

function evidenceFromFact(fact: ScanFact): Evidence {
  const { identity: _identity, has_successful_run: _run, has_output_chain: _output, ...evidence } = fact;
  return evidence;
}

export function classifyFacts(facts: ScanFact[]): Pick<Row, "classification" | "source_identity" | "source_identity_status" | "evidence" | "rationale" | "recovery"> {
  const sorted = [...facts].sort((a, b) => codepointCompare(evidenceKey(a), evidenceKey(b)));
  const historical = sorted.filter((fact) => fact.kind === "current-json" && fact.identity === "exact-collection" && fact.has_successful_run && fact.has_output_chain && fact.retained_artifact?.tied_to_source_url === fact.source_url);
  if (historical.length) return {
    classification: "historical-verified", source_identity: historical[0]!.source_url, source_identity_status: "historical-linked",
    evidence: [...new Map(historical.map((fact) => [evidenceKey(fact), evidenceFromFact(fact)])).values()],
    rationale: "A retained local source artifact, exact collection identity, and successful output chain occur in the same local record.",
    recovery: { priority: "P0", action: "Preserve the retained artifact and independently validate its bytes before any authorized re-acquisition." },
  };
  const legacy = sorted.filter((fact) => fact.kind === "current-json" && fact.identity !== "slug-only" && fact.has_successful_run && fact.has_output_chain);
  if (legacy.length) return {
    classification: "legacy-traceable", source_identity: legacy[0]!.source_url, source_identity_status: "legacy-linked",
    evidence: [...new Map(legacy.map((fact) => [evidenceKey(fact), evidenceFromFact(fact)])).values()],
    rationale: "A local record ties an exact source identity to a supported collection/run identity, but lacks the retained source-artifact chain required for historical verification.",
    recovery: { priority: "P1", action: "Reconstruct and validate the missing exact artifact chain under separate authorization." },
  };
  const candidates = sorted.filter((fact) => fact.identity !== "slug-only" || fact.kind === "current-json");
  if (candidates.length) return {
    classification: "candidate-needs-human-confirmation", source_identity: candidates[0]!.source_url, source_identity_status: "candidate-only",
    evidence: [...new Map(candidates.map((fact) => [evidenceKey(fact), evidenceFromFact(fact)])).values()],
    rationale: "A local candidate source identity exists, but the retained exact source-artifact chain or supported run linkage is incomplete.",
    recovery: { priority: "P2", action: "Require human confirmation or an authorized source validation before linking this candidate to the served collection." },
  };
  return {
    classification: "orphan", source_identity: null, source_identity_status: null, evidence: [],
    rationale: "No admissible exact local source identity was found. Generic regulation/homepage/S3 references and unlinked pipeline labels are excluded.",
    recovery: { priority: "P3", action: "Manual historical recovery is required from operator archives or the original producer; do not infer a source from names or generic references." },
  };
}

function writeAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

function loadResume(path: string, inputHash: string, batchSize: number): Report | null {
  if (!existsSync(path)) return null;
  const previous = JSON.parse(readFileSync(path, "utf8")) as Partial<Report>;
  if (previous.contract !== CONTRACT || previous.input?.sha256 !== inputHash) {
    throw new Error("--resume refused: existing report has a different contract or reconciliation input hash");
  }
  if (previous.batch?.batch_size !== batchSize || !Array.isArray(previous.collections)) {
    throw new Error("--resume refused: existing report has an incompatible batch size or row set");
  }
  return previous as Report;
}

export function mergeRows(all: InputCollection[], prior: Row[], refreshed: Row[]): Row[] {
  const input = new Map(all.map((row) => [row.slug, row]));
  const merged = new Map<string, Row>();
  for (const row of [...prior, ...refreshed]) {
    const expected = input.get(row.slug);
    if (!expected || expected.collection_key !== row.collection_key || expected.features !== row.features || expected.layout !== row.layout) {
      throw new Error("--resume refused: existing report contains a row outside the immutable orphan input");
    }
    merged.set(row.slug, row);
  }
  return [...merged.values()].sort((a, b) => codepointCompare(a.slug, b.slug));
}

function countRows(rows: Row[]): Record<Classification, { collections: number; features: number }> {
  const counts: Record<Classification, { collections: number; features: number }> = {
    "historical-verified": { collections: 0, features: 0 },
    "legacy-traceable": { collections: 0, features: 0 },
    "candidate-needs-human-confirmation": { collections: 0, features: 0 },
    orphan: { collections: 0, features: 0 },
  };
  for (const row of rows) { counts[row.classification].collections += 1; counts[row.classification].features += row.features; }
  return counts;
}

function runnerHasNoNetworkOrS3Import(): boolean {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  // Split the checked tokens so this audit does not match its own source text.
  return ["fe" + "tch(", "@aws" + "-sdk", "S3" + "Client", "https." + "request"].every((token) => !source.includes(token));
}

function markdown(report: Report): string {
  const lines = [
    "# Proof-orphan 112 local batches — 2026-07-22",
    "",
    "Strictly local, deterministic evidence recovery over exactly the 112 `orphan` collections from `proof-orphan-356-reconciliation-20260722.json`. No network, S3, deployment, or existing-file mutation was used.",
    "",
    `Input SHA-256: \`${report.input.sha256}\``,
    `Batches complete: ${report.batch.completed_batch_indexes.join(", ") || "none"}/${report.batch.batch_count}; report rows: ${report.batch.report_rows}/${report.input.selected_collections}.`,
    "",
    "| Classification | Collections | Features |",
    "|---|---:|---:|",
    ...(["historical-verified", "legacy-traceable", "candidate-needs-human-confirmation", "orphan"] as Classification[]).map((kind) => `| ${kind} | ${report.counts[kind].collections} | ${report.counts[kind].features} |`),
    "",
    "`historical-verified` requires one current structured record containing the exact collection identity, a successful output chain, and a retained local source artifact. `legacy-traceable` requires exact local source/run identity. All weaker findings remain candidates; no URL or hash is inferred.",
    "",
    "| Slug | Features | Classification | Exact source identity | Evidence |",
    "|---|---:|---|---|---|",
    ...report.collections.map((row) => `| ${row.slug} | ${row.features} | ${row.classification} | ${row.source_identity ?? "—"} | ${row.evidence.map((item) => `${item.kind}:${item.path}${item.json_pointer ?? item.line ? `#${item.json_pointer ?? `L${item.line}`}` : ""}`).join("<br>") || "—"} |`),
    "",
    "The machine-readable report records every accepted evidence locator, content hash, and any retained artifact hash.",
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(ROOT, args.input);
  const outPath = resolve(ROOT, args.out);
  const markdownPath = resolve(ROOT, args.markdownOut);
  const inputBytes = readFileSync(inputPath);
  const inputHash = sha256(inputBytes);
  const previous = args.resume ? loadResume(outPath, inputHash, args.batchSize) : null;
  const all = selectOrphans(JSON.parse(inputBytes.toString("utf8")) as Json);
  const batchCount = Math.ceil(all.length / args.batchSize);
  if (args.batchIndex !== null && args.batchIndex > batchCount) throw new Error(`--batch-index must be at most ${batchCount} for batch size ${args.batchSize}`);
  const selected = args.batchIndex === null ? all : all.slice((args.batchIndex - 1) * args.batchSize, args.batchIndex * args.batchSize);
  // Never treat a previous run's report as an artifact or source record. This
  // makes --resume a deterministic re-scan, not a self-confirming loop.
  const files = localFiles(new Set([
    outPath,
    markdownPath,
    resolve(ROOT, DEFAULT_OUTPUT),
    resolve(ROOT, DEFAULT_MARKDOWN_OUTPUT),
  ]));
  // Keep the all-112 default bounded exactly like an operator-selected batch.
  // This avoids turning a large aggregate artifact into 112 simultaneous JSON
  // traversals, while preserving one deterministic final report.
  const factsBySlug = new Map(selected.map((collection) => [collection.slug, [] as ScanFact[]]));
  let gitHistoryQueries = 0;
  let gitHistoryHits = 0;
  const scanBatchSize = 16;
  for (let index = 0; index < selected.length; index += scanBatchSize) {
    const group = selected.slice(index, index + scanBatchSize);
    for (const [slug, facts] of currentFacts(files, group)) factsBySlug.get(slug)!.push(...facts);
    const history = gitFacts(group);
    for (const [slug, facts] of history.facts) factsBySlug.get(slug)!.push(...facts);
    gitHistoryQueries += history.queries;
    gitHistoryHits += history.commits;
  }
  const refreshed: Row[] = [];
  for (const collection of selected) {
    const classified = classifyFacts(factsBySlug.get(collection.slug) ?? []);
    refreshed.push({ slug: collection.slug, collection_key: collection.collection_key, layout: collection.layout, features: collection.features, ...classified });
  }
  const rows = mergeRows(all, previous?.collections ?? [], refreshed);
  const completed = [...new Set([
    ...(previous?.batch.completed_batch_indexes ?? (previous?.batch.batch_index === null ? [1] : previous?.batch.batch_index ? [previous.batch.batch_index] : [])),
    ...(args.batchIndex === null ? [1] : [args.batchIndex]),
  ])].sort((a, b) => a - b);
  const counts = countRows(rows);
  const report: Report = {
    contract: CONTRACT, local_only: true,
    input: { path: cleanPath(inputPath), sha256: inputHash, selected_classification: "orphan", selected_collections: all.length, selected_features: all.reduce((sum, row) => sum + row.features, 0) },
    batch: { batch_size: args.batchSize, batch_index: args.batchIndex, batch_count: batchCount, selected_rows: selected.length, completed_batch_indexes: completed, report_rows: rows.length, complete: rows.length === all.length },
    scan: { roots: scanRoots(), extensions: [...SCANNED_EXTENSIONS].sort(codepointCompare), current_files_examined: files.length, git_history_queries: gitHistoryQueries, git_history_hits: gitHistoryHits },
    policy: {
      "historical-verified": "Only a retained exact local source artifact plus exact collection identity and successful output chain in one current structured record.",
      "legacy-traceable": "Only a current structured record with an admissible exact source identity and supported exact collection/run identity.",
      "candidate-needs-human-confirmation": "An admissible exact source identity exists locally but its chain to the audited served collection is incomplete.",
      orphan: "No admissible exact local source identity survives after generic regulation/homepage/S3 references and unsupported inference are excluded.",
    },
    counts, collections: rows,
    validation: {
      exactly_112_input_orphans: all.length === 112,
      selected_slugs_unique: new Set(all.map((row) => row.slug)).size === all.length,
      selected_features_match_reconciliation: all.reduce((sum, row) => sum + row.features, 0) === 14584,
      selected_rows_recomputed: refreshed.length === selected.length,
      output_rows_are_only_input_orphans: rows.every((row) => all.some((input) => input.slug === row.slug && input.collection_key === row.collection_key)),
      no_network_or_s3_client_import: runnerHasNoNetworkOrS3Import(),
    },
  };
  if (!Object.values(report.validation).every(Boolean)) throw new Error("internal report validation failed");
  // Markdown is derived from the primary JSON. Write it first: if interrupted,
  // the prior atomic JSON remains resumable and the next run repairs Markdown.
  writeAtomic(markdownPath, markdown(report));
  writeAtomic(outPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: cleanPath(outPath), rows: rows.length, counts }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
