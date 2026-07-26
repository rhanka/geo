/**
 * Measure durable capture coverage of PV indexes and emit resumable capture
 * worklists.  S3 is read only: this program never writes `normalized/`, raw
 * bytes, or capture manifests.  Those are written only by the cluster Job.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/pv-capture-kpi-run.ts
 *
 * A run interrupted while reading indexes can be resumed with `--resume`.
 * There is deliberately no S3 read timeout: an expired read is not proof that
 * a document or a capture is absent.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { exists, getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import {
  classifyPvCityCapture,
  classifyPvDocumentCapture,
  type AttachablePvCapture,
  type FailedPvCaptureAttempt,
} from "./lib/pv-capture-kpi.js";
import {
  captureManifestKeyFromListedRest,
  captureReceiptFromManifest,
} from "./lib/zone-provenance-quality.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const CONFIG = resolve(ROOT, "acquisition", "config");
const CATALOG = resolve(ROOT, "packages", "qc-sources", "src", "geo", "municipalities.qc.json");
const PV_INDEX_PREFIX = "registry/qc-pv/";
const CAPTURE_RUNS_PREFIX = "capture/_runs/";
const UNIVERSE = 1106;
const WORKLIST_SOURCE = "pv-index";

interface City {
  slug: string;
  name: string;
}

interface IndexScan {
  slug: string;
  index_key: string;
  declared_count: number | null;
  entry_count: number;
  urls: string[];
}

interface Progress {
  contract: "pv-capture-kpi-progress/v1";
  as_of: string;
  /** Identity of the input which is actually checkpointed: PV indexes. */
  index_listing_sha256: string;
  pv_index_listing: readonly (readonly [string, string | null, string | null])[];
  capture_manifest_listing: readonly (readonly [string, string | null, string | null])[];
  scans: IndexScan[];
}

interface ManifestScan {
  key: string;
  lines: CaptureManifestLine[];
}

const argv = process.argv.slice(2);

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function today(): string {
  const forced = option("date");
  if (forced) {
    if (!/^\d{8}$/.test(forced)) throw new Error("--date doit être YYYYMMDD");
    return forced;
  }
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function positiveInt(name: string, fallback: number, min: number, max: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} doit être un entier ${min}..${max}`);
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorText(error: unknown): string {
  const value = error as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const status = value?.$metadata?.httpStatusCode;
  return `${String(value?.name ?? "Error")}: ${String(value?.message ?? error)}${status ? ` (HTTP ${status})` : ""}`;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
}

/** Dated reports and worklists are immutable control records. */
function writeImmutableJson(path: string, value: unknown): void {
  const serialized = JSON.stringify(value, null, 2) + "\n";
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === serialized) return;
    throw new Error(`refus d'écraser l'artefact daté existant: ${path}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, serialized);
  renameSync(temporary, path);
}

function readCities(): City[] {
  const parsed: unknown = JSON.parse(readFileSync(CATALOG, "utf8"));
  if (!Array.isArray(parsed) || parsed.length !== UNIVERSE) {
    throw new Error(`catalogue villes: ${Array.isArray(parsed) ? parsed.length : "non-array"} ≠ ${UNIVERSE}`);
  }
  const cities = parsed.map((row): City => {
    if (!row || typeof row !== "object") throw new Error("catalogue villes: ligne invalide");
    const candidate = row as { slug?: unknown; name?: unknown };
    if (typeof candidate.slug !== "string" || typeof candidate.name !== "string") {
      throw new Error("catalogue villes: slug/name invalide");
    }
    return { slug: candidate.slug, name: candidate.name };
  }).sort((left, right) => left.slug.localeCompare(right.slug));
  if (new Set(cities.map((city) => city.slug)).size !== UNIVERSE) throw new Error("catalogue villes: slugs dupliqués");
  return cities;
}

function exactIndexKeySlug(key: string): string | null {
  const match = /^registry\/qc-pv\/([a-z0-9][a-z0-9-]*)\/index\.json$/.exec(key);
  return match?.[1] ?? null;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseIndex(slug: string, key: string, value: unknown): IndexScan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key}: index JSON non-objet`);
  const manifest = value as { slug?: unknown; count?: unknown; entries?: unknown };
  if (manifest.slug !== slug) throw new Error(`${key}: slug interne ${JSON.stringify(manifest.slug)} ≠ ${slug}`);
  if (!Array.isArray(manifest.entries)) throw new Error(`${key}: entries n'est pas un tableau`);
  if (manifest.count !== undefined && (!Number.isInteger(manifest.count) || (manifest.count as number) < 0)) {
    throw new Error(`${key}: count invalide`);
  }
  const urls: string[] = [];
  for (const [index, entry] of manifest.entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !isHttpUrl((entry as { url?: unknown }).url)) {
      throw new Error(`${key}: entries[${index}] n'a pas une URL http(s) littérale`);
    }
    urls.push((entry as { url: string }).url);
  }
  return {
    slug,
    index_key: key,
    declared_count: typeof manifest.count === "number" ? manifest.count : null,
    entry_count: manifest.entries.length,
    urls: [...new Set(urls)].sort(),
  };
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  onResolved?: (item: T, result: R) => void,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index]!;
      const value = await fn(item);
      result[index] = value;
      onResolved?.(item, value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

async function readIndex(s3: ReturnType<typeof s3Client>, selection: { slug: string; key: string }): Promise<IndexScan> {
  return parseIndex(selection.slug, selection.key, JSON.parse((await getBytes(s3, selection.key)).toString("utf8")) as unknown);
}

async function readManifest(s3: ReturnType<typeof s3Client>, key: string): Promise<ManifestScan> {
  return { key, lines: parseManifestJsonl((await getBytes(s3, key)).toString("utf8")) };
}

function loadProgress(path: string, indexListingSha: string, indexedSlugs: ReadonlySet<string>): Map<string, IndexScan> {
  if (!existsSync(path)) throw new Error(`--resume demandé mais checkpoint absent: ${path}`);
  const progress = JSON.parse(readFileSync(path, "utf8")) as Progress;
  if (progress.contract !== "pv-capture-kpi-progress/v1" || progress.index_listing_sha256 !== indexListingSha) {
    throw new Error("checkpoint incompatible avec le listing des index PV; reprendre sans --resume");
  }
  if (!Array.isArray(progress.scans) || progress.scans.some((scan) => !indexedSlugs.has(scan.slug))) {
    throw new Error("checkpoint contient un index hors du listing S3 actuel; reprendre sans --resume");
  }
  return new Map(progress.scans.map((scan) => [scan.slug, scan]));
}

function writeProgress(
  path: string,
  asOf: string,
  indexListingSha: string,
  indexListing: readonly (readonly [string, string | null, string | null])[],
  manifestListing: readonly (readonly [string, string | null, string | null])[],
  scans: Map<string, IndexScan>,
): void {
  writeAtomic(path, {
    contract: "pv-capture-kpi-progress/v1",
    as_of: asOf,
    index_listing_sha256: indexListingSha,
    pv_index_listing: indexListing,
    capture_manifest_listing: manifestListing,
    scans: [...scans.values()].sort((left, right) => left.slug.localeCompare(right.slug)),
  } satisfies Progress);
}

function failedAttempt(line: CaptureManifestLine, manifestKey: string, lineIndex: number): FailedPvCaptureAttempt {
  return {
    url: line.url,
    requested_at: line.requested_at,
    retrieved_at: line.retrieved_at,
    http_status: line.http_status,
    error: line.error,
    manifest_key: manifestKey,
    line_index: lineIndex,
  };
}

function countStates<T extends string>(states: readonly T[]): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const state of states) counts[state] = (counts[state] ?? 0) + 1;
  return counts;
}

async function main(): Promise<void> {
  const asOf = today();
  const batchSize = positiveInt("batch", 25, 1, 100);
  const concurrency = positiveInt("concurrency", 4, 1, 16);
  const maxBatches = positiveInt("max-batches", 100_000, 1, 100_000);
  const worklistBatch = positiveInt("worklist-batch", 50, 1, 200);
  const resume = argv.includes("--resume");
  const cities = readCities();
  const citySlugs = new Set(cities.map((city) => city.slug));
  const s3 = s3Client();

  // Listings are the snapshot identity. A resumed pass never mixes a changed
  // index or new capture manifest with old observations.
  const indexObjects = await listObjectEntries(s3, PV_INDEX_PREFIX);
  const recognizedIndexes = indexObjects.flatMap((entry) => {
    const slug = exactIndexKeySlug(entry.key);
    return slug && citySlugs.has(slug) ? [{ slug, key: entry.key, etag: entry.etag, last_modified: entry.last_modified }] : [];
  });
  if (new Set(recognizedIndexes.map((entry) => entry.slug)).size !== recognizedIndexes.length) {
    throw new Error("listing PV: plusieurs index canoniques pour une même ville");
  }
  const noncanonicalIndexKeys = indexObjects.map((entry) => entry.key).filter((key) => {
    const slug = exactIndexKeySlug(key);
    return slug === null || !citySlugs.has(slug);
  });
  const indexListing = recognizedIndexes.map((entry) => [entry.key, entry.etag, entry.last_modified] as const);

  const captureObjects = await listObjectEntries(s3, CAPTURE_RUNS_PREFIX);
  const manifestEntries = captureObjects.flatMap((entry) => {
    const key = captureManifestKeyFromListedRest(entry.key.slice(CAPTURE_RUNS_PREFIX.length));
    return key === entry.key ? [entry] : [];
  });
  const manifestListing = manifestEntries.map((entry) => [entry.key, entry.etag, entry.last_modified] as const);
  const indexListingSha = sha256(JSON.stringify({ pv_index_listing: indexListing }));
  const snapshotSha = sha256(JSON.stringify({ pv_index_listing: indexListing, capture_manifest_listing: manifestListing }));
  const checkpoint = resolve(COVERAGE, `.pv-capture-kpi-progress-${asOf}-${indexListingSha.slice(0, 16)}.json`);
  console.error(`[pv-capture] index PV canoniques: ${recognizedIndexes.length}/${UNIVERSE}; manifests: ${manifestEntries.length}; index_snapshot=${indexListingSha.slice(0, 16)} evidence_snapshot=${snapshotSha.slice(0, 16)}`);

  // A capture manifest is evidence input. It is all-or-nothing: a bad or
  // unreadable manifest stops measurement instead of being converted to absent.
  const manifests = await mapConcurrent(manifestEntries.map((entry) => entry.key), concurrency, (key) => readManifest(s3, key));
  const manifestLines = manifests.flatMap((scan) => scan.lines.map((line, lineIndex) => ({ line, manifest_key: scan.key, line_index: lineIndex })));
  console.error(`[pv-capture] lignes manifest lues: ${manifestLines.length}`);

  const scans = resume
    ? loadProgress(checkpoint, indexListingSha, new Set(recognizedIndexes.map((entry) => entry.slug)))
    : new Map<string, IndexScan>();
  const pending = recognizedIndexes.filter((entry) => !scans.has(entry.slug));
  console.error(`[pv-capture] index à lire: ${pending.length}/${recognizedIndexes.length}${resume ? " (reprise)" : ""}`);
  let batchesRun = 0;
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    await mapConcurrent(batch, concurrency, (entry) => readIndex(s3, entry), (_entry, scan) => {
      scans.set(scan.slug, scan);
      writeProgress(checkpoint, asOf, indexListingSha, indexListing, manifestListing, scans);
    });
    writeProgress(checkpoint, asOf, indexListingSha, indexListing, manifestListing, scans);
    batchesRun++;
    console.error(`[pv-capture] progression: ${scans.size}/${recognizedIndexes.length} · checkpoint ${checkpoint}`);
    if (batchesRun >= maxBatches && scans.size < recognizedIndexes.length) {
      console.log(JSON.stringify({
        complete: false,
        checkpoint,
        scanned_indexes: scans.size,
        remaining_indexes: recognizedIndexes.length - scans.size,
        resume: "re-run with --resume",
      }, null, 2));
      return;
    }
  }

  const allDocumentUrls = new Set<string>();
  for (const scan of scans.values()) for (const url of scan.urls) allDocumentUrls.add(url);
  const candidateReceipts: AttachablePvCapture[] = [];
  const failedAttempts: FailedPvCaptureAttempt[] = [];
  for (const { line, manifest_key, line_index } of manifestLines) {
    if (!allDocumentUrls.has(line.url)) continue;
    const receipt = captureReceiptFromManifest(line, manifest_key, line_index);
    if (receipt) candidateReceipts.push({ ...receipt, source: line.source });
    else failedAttempts.push(failedAttempt(line, manifest_key, line_index));
  }
  const rawKeys = [...new Set(candidateReceipts.map((receipt) => receipt.storage_key))].sort();
  const rawExists = new Map<string, boolean>();
  await mapConcurrent(rawKeys, concurrency, async (key) => ({ key, present: await exists(s3, key) }), (_key, result) => {
    rawExists.set(result.key, result.present);
  });
  const attachable = candidateReceipts.filter((receipt) => rawExists.get(receipt.storage_key) === true);
  const rawMissing = candidateReceipts.filter((receipt) => rawExists.get(receipt.storage_key) !== true);

  const cityRows = cities.map((city) => {
    const index = scans.get(city.slug) ?? null;
    const kpi = classifyPvCityCapture(index !== null, index?.urls ?? [], { attachable, failed: failedAttempts });
    return {
      city_slug: city.slug,
      city_name: city.name,
      index_key: index?.index_key ?? null,
      index_declared_count: index?.declared_count ?? null,
      index_entry_count: index?.entry_count ?? null,
      index_distinct_document_urls: index?.urls.length ?? null,
      index_count_matches_entries: index ? index.declared_count === null ? null : index.declared_count === index.entry_count : null,
      ...kpi,
    };
  });
  const cityStateCounts = countStates(cityRows.map((row) => row.state));
  if (Object.values(cityStateCounts).reduce((sum, value) => sum + value, 0) !== UNIVERSE) {
    throw new Error("partition état-ville PV invalide");
  }

  const documents = [...allDocumentUrls].sort().map((url) => classifyPvDocumentCapture(url, { attachable, failed: failedAttempts }));
  const documentStateCounts = countStates(documents.map((document) => document.state));
  const documentsWithCas = documents.filter((document) => document.captures.length > 0).length;
  const referencesTotal = cityRows.reduce((total, row) => total + row.documents_total, 0);
  if (documentsWithCas + (documents.length - documentsWithCas) !== documents.length) throw new Error("partition document PV invalide");

  // One target per city/document keeps the municipal context in every capture
  // manifest row. A shared URL may therefore be fetched twice, but CAS makes
  // the bytes idempotent and the two city provenance links remain explicit.
  const missingTargets = cityRows.flatMap((row) => row.documents
    .filter((document) => document.captures.length === 0)
    .map((document) => ({ slug: row.city_slug, source: WORKLIST_SOURCE, urls: [document.url] })))
    .sort((left, right) => left.slug.localeCompare(right.slug) || left.urls[0]!.localeCompare(right.urls[0]!));
  const worklists: string[] = [];
  for (let start = 0; start < missingTargets.length; start += worklistBatch) {
    const lot = String(Math.floor(start / worklistBatch) + 1).padStart(3, "0");
    const path = resolve(CONFIG, `pv-capture-${asOf}-${snapshotSha.slice(0, 16)}-lot-${lot}.json`);
    writeImmutableJson(path, missingTargets.slice(start, start + worklistBatch));
    worklists.push(path);
  }

  const report = {
    contract: "pv-capture-kpi/v1",
    generated_at: new Date().toISOString(),
    read_only_s3: true,
    universe: UNIVERSE,
    source_snapshot: {
      sha256: `sha256:${snapshotSha}`,
      pv_index_listing: indexListing,
      capture_manifest_listing: manifestListing,
    },
    index_counts: {
      cities_with_index: scans.size,
      cities_without_index: UNIVERSE - scans.size,
      index_entries_total: scans.size === 0 ? 0 : [...scans.values()].reduce((total, scan) => total + scan.entry_count, 0),
      index_distinct_document_references_total: referencesTotal,
      distinct_document_urls_global: documents.length,
      noncanonical_index_keys: noncanonicalIndexKeys,
    },
    document_counts: {
      distinct_document_urls_global: documents.length,
      with_attachable_cas: documentsWithCas,
      without_attachable_cas: documents.length - documentsWithCas,
      by_state: documentStateCounts,
    },
    city_counts: {
      by_state: cityStateCounts,
      cities_with_partial_capture: cityRows.filter((row) => row.documents_with_octets > 0 && row.documents_without_octets > 0).length,
      cities_with_all_index_documents_captured: cityRows.filter((row) => row.documents_total > 0 && row.documents_without_octets === 0).length,
    },
    capture_evidence: {
      manifests_scanned: manifests.length,
      manifest_lines_scanned: manifestLines.length,
      candidate_receipts_for_index_documents: candidateReceipts.length,
      attachable_receipts: attachable.length,
      distinct_raw_keys_checked: rawKeys.length,
      receipts_with_missing_raw: rawMissing.length,
      failed_attempts_for_index_documents: failedAttempts.length,
      http_404_attempts: failedAttempts.filter((attempt) => attempt.http_status === 404).length,
      http_404: failedAttempts.filter((attempt) => attempt.http_status === 404),
    },
    capture_worklists: worklists.map((path) => ({ path, targets: JSON.parse(readFileSync(path, "utf8")).length })),
    cities: cityRows,
    documents,
  };
  const output = resolve(COVERAGE, `pv-capture-kpi-${asOf}-${snapshotSha.slice(0, 16)}.json`);
  writeImmutableJson(output, report);
  console.log(JSON.stringify({
    complete: true,
    output,
    checkpoint,
    index_counts: report.index_counts,
    document_counts: report.document_counts,
    city_counts: report.city_counts,
    capture_evidence: report.capture_evidence,
    capture_worklists: report.capture_worklists,
  }, null, 2));
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
