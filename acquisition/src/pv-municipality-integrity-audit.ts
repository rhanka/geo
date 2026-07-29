/**
 * Read-only integrity audit for the Municipality node of indexed PVs.
 *
 * The sample is deterministic, but is selected from the indexed documents by
 * CAS key rather than by slug. The printed owner is accepted only when the
 * Municipality node citation points to an exact line in the local
 * document.txt and the node label occurs in that line.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const SUMMARY_PATH = resolve(COVERAGE, "pv-graphify-semantic-all-20260728-summary.json");
const OUTPUT_PATH = resolve(COVERAGE, "pv-municipality-integrity-audit-20260729.json");
const SAMPLE_SIZE = 20;
const MAX_READ_BYTES = 5_000_000;
const SAMPLE_SEED = "pv-municipality-integrity-audit/v1";

interface Citation {
  readonly source_file?: unknown;
  readonly source_location?: unknown;
  readonly quote?: unknown;
}

interface MunicipalityEntity {
  readonly label?: unknown;
  readonly citation?: Citation;
}

interface DocumentReport {
  readonly slug?: unknown;
  readonly municipality_name?: unknown;
  readonly storage_key?: unknown;
  readonly source_file?: unknown;
  readonly entities?: Readonly<Record<string, readonly MunicipalityEntity[]>>;
}

interface BatchReport {
  readonly workspace?: unknown;
  readonly documents?: readonly DocumentReport[];
  readonly supersedes_storage_keys?: readonly string[];
}

interface Summary {
  readonly source_reports?: readonly string[];
}

interface LoadedDocument {
  readonly workspace: string;
  readonly document: DocumentReport;
}

function assertSmall(path: string): void {
  const bytes = statSync(path).size;
  if (bytes > MAX_READ_BYTES) throw new Error(`fichier refusé (>5 Mo): ${path}`);
}

function readJson<T>(path: string): T {
  assertSmall(path);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where} doit être une chaîne non vide`);
  return value.trim();
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("fr-CA")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function sourcePath(document: LoadedDocument, sourceFile: string): string {
  if (sourceFile.startsWith("/") || sourceFile.split(/[\\/]/u).includes("..")) {
    throw new Error(`source_file invalide: ${sourceFile}`);
  }
  const slug = requiredString(document.document.slug, "document.slug");
  const storageKey = requiredString(document.document.storage_key, "document.storage_key");
  return resolve(document.workspace, slug, storageKey.slice(-16), "input", sourceFile);
}

function lineNumber(location: string): number | null {
  const match = /^document\.txt:line:(\d+)$/u.exec(location);
  return match ? Number(match[1]) : null;
}

function stableRank(storageKey: string): string {
  return createHash("sha256").update(`${SAMPLE_SEED}\u0000${storageKey}`).digest("hex");
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function main(): void {
  const summary = readJson<Summary>(SUMMARY_PATH);
  const sourceReports = summary.source_reports ?? [];
  if (sourceReports.length === 0) throw new Error("summary sans source_reports");

  const byStorageKey = new Map<string, LoadedDocument>();
  for (const reportPath of sourceReports) {
    const batch = readJson<BatchReport>(resolve(ROOT, reportPath));
    const workspace = requiredString(batch.workspace, `${reportPath}.workspace`);
    for (const document of batch.documents ?? []) {
      const storageKey = requiredString(document.storage_key, `${reportPath}.document.storage_key`);
      byStorageKey.set(storageKey, { workspace, document });
    }
  }

  const allDocuments = [...byStorageKey.entries()]
    .map(([storage_key, loaded]) => ({ storage_key, ...loaded }))
    .sort((left, right) => stableRank(left.storage_key).localeCompare(stableRank(right.storage_key)));
  const sample = allDocuments.slice(0, SAMPLE_SIZE);
  if (sample.length !== SAMPLE_SIZE) throw new Error(`population indexée insuffisante: ${sample.length}`);

  const documents = sample.map((loaded) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const entities = loaded.document.entities?.Municipality ?? [];
    const node = entities.length === 1 ? entities[0] : undefined;
    if (!node) errors.push(entities.length === 0 ? "municipality_node_absent" : "municipality_node_count_not_one");

    let label: string | null = null;
    let quote: string | null = null;
    let source_path: string | null = null;
    let source_line: number | null = null;
    if (node) {
      try {
        label = requiredString(node.label, "Municipality.label");
        const citation = node.citation ?? {};
        const sourceFile = requiredString(citation.source_file, "Municipality.citation.source_file");
        const location = requiredString(citation.source_location, "Municipality.citation.source_location");
        quote = requiredString(citation.quote, "Municipality.citation.quote");
        source_line = lineNumber(location);
        if (source_line === null) errors.push("municipality_citation_location_invalid");
        source_path = sourcePath(loaded, sourceFile);
        assertSmall(source_path);
        const lines = readFileSync(source_path, "utf8").split(/\r?\n/gu);
        const printedLine = source_line === null ? undefined : lines[source_line - 1];
        if (printedLine !== quote && printedLine?.trim() === quote.trim()) warnings.push("municipality_citation_leading_spacing_only");
        else if (printedLine !== quote) warnings.push("municipality_citation_quote_mismatch");
        if (!printedLine || !normalize(printedLine).includes(normalize(label))) {
          errors.push("municipality_node_not_printed_on_cited_line");
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return {
      storage_key: loaded.storage_key,
      slug: requiredString(loaded.document.slug, "document.slug"),
      classification_municipality: requiredString(loaded.document.municipality_name, "document.municipality_name"),
      municipality_node: label,
      printed_municipality_quote: quote,
      source_path,
      source_line,
      divergences: errors,
      citation_warnings: warnings,
    };
  });

  const divergences = documents.flatMap((document) => document.divergences.map((reason) => ({
    storage_key: document.storage_key,
    slug: document.slug,
    reason,
  })));
  const report = {
    contract: "pv-municipality-integrity-audit/v1",
    generated_at: new Date().toISOString(),
    mode: "read-only-local-graphify-inputs",
    input: {
      summary: "work/coverage/pv-graphify-semantic-all-20260728-summary.json",
      source_reports: sourceReports,
      maximum_read_bytes: MAX_READ_BYTES,
      deterministic_sampling: SAMPLE_SEED,
    },
    population: {
      indexed_documents: allDocuments.length,
      sampled_documents: documents.length,
      sampled_municipalities: new Set(documents.map((document) => document.slug)).size,
    },
    owner_audit: {
      checked: documents.length,
      passed: documents.length - new Set(divergences.map((item) => item.storage_key)).size,
      divergence_count: divergences.length,
      divergences,
      citation_warning_count: documents.reduce((total, document) => total + document.citation_warnings.length, 0),
      documents,
    },
  };
  writeAtomic(OUTPUT_PATH, report);
  console.log(JSON.stringify({
    report: OUTPUT_PATH.slice(ROOT.length + 1),
    indexed_documents: allDocuments.length,
    sampled_documents: documents.length,
    sampled_municipalities: report.population.sampled_municipalities,
    owner_divergences: divergences.length,
  }));
  if (divergences.length > 0) process.exitCode = 2;
}

main();
