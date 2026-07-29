/**
 * Inventaire de pages pour les échecs PV Graphify — lecture seule.
 *
 * Le périmètre est ancré sur un commit historique explicite. Le script lit les
 * rapports batch committés et les objets CAS S3; il ne lance ni Graphify, ni
 * OCR, ni pdftotext, ni rendu, et n'écrit que les deux rapports demandés.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_pv-ocr-pages-inventory.ts \
 *     --input-commit=14c60a04 \
 *     --out=work/coverage/pv-ocr-inventaire-pages-YYYYMMDDTHHMMSSZ.json \
 *     --md=work/coverage/pv-ocr-inventaire-pages-YYYYMMDDTHHMMSSZ.md
 */
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MAX_LOCAL_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FULL_OBJECT_BYTES = 5 * 1024 * 1024;
const FAILURE_OUTCOME = "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED";
const BATCH_REPORT_PATTERN = /^work\/coverage\/pv-graphify-semantic-real-universe-20260729-batch-01-part-\d+\.json$/u;
const FAILURE_TRIAGE_PATH = "work/coverage/pv-extraction-failures-triage-20260729T115007Z.json";
const SNAPSHOT_PATH = "work/coverage/pv-graphify-semantic-real-universe-20260729-snapshot-01.json";
const INDEXED_SUMMARY_PATH = "work/coverage/pv-graphify-semantic-all-20260728-summary.json";
const MUNICIPALITIES_PATH = "packages/qc-sources/src/geo/municipalities.qc.json";
const PAGE_BANDS = [
  { label: "1-5", min: 1, max: 5 },
  { label: "6-20", min: 6, max: 20 },
  { label: "21-50", min: 21, max: 50 },
  { label: "51+", min: 51, max: Number.POSITIVE_INFINITY },
] as const;

interface JsonRecord { readonly [key: string]: unknown }

interface FailureRow {
  readonly report: string;
  readonly row_index: number;
  readonly selection_offset: number;
  readonly selection_offset_hundred: number;
  readonly document_offset: number | null;
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string | null;
  readonly url: string | null;
  readonly failure_reason: string | null;
}

interface Municipality {
  readonly slug: string;
  readonly name: string;
  readonly mrc: string | null;
}

interface PdfMetadata {
  readonly content_length: number | null;
  readonly page_count: number | null;
  readonly pdfinfo_exit_code: number | null;
  readonly pdfinfo_error: string | null;
  readonly title: string | null;
  readonly creator: string | null;
  readonly producer: string | null;
  readonly pdf_version: string | null;
  readonly encrypted: string | null;
  readonly unknown_reason: string | null;
}

interface FailedDocument extends PdfMetadata {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string | null;
  readonly mrc: string | null;
  readonly url: string | null;
  readonly url_host: string | null;
  readonly selection_offsets: number[];
  readonly selection_offset_hundreds: number[];
  readonly source_reports: string[];
}

function requiredArg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`--${name}=... est requis`);
  return value;
}

function insideCoverage(path: string): string {
  const absolute = resolve(ROOT, path);
  const coverage = resolve(ROOT, "work", "coverage");
  if (!absolute.startsWith(`${coverage}/`)) throw new Error(`sortie hors work/coverage refusée: ${path}`);
  return absolute;
}

function asRecord(value: unknown, where: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: objet JSON requis`);
  return value as JsonRecord;
}

function requiredString(record: JsonRecord, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where}.${key}: chaîne requise`);
  return value;
}

function optionalString(record: JsonRecord, key: string, where: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${where}.${key}: chaîne ou null requis`);
  return value;
}

function git(args: readonly string[], maxBuffer = MAX_LOCAL_FILE_BYTES + 1024): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer });
}

function committedJson(commit: string, path: string): unknown {
  const size = Number(git(["cat-file", "-s", `${commit}:${path}`]).trim());
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_LOCAL_FILE_BYTES) {
    throw new Error(`${path}: ${size} octets, plafond local ${MAX_LOCAL_FILE_BYTES}`);
  }
  return JSON.parse(git(["show", `${commit}:${path}`]));
}

function committedBatchReportPaths(commit: string): string[] {
  const triage = asRecord(committedJson(commit, FAILURE_TRIAGE_PATH), FAILURE_TRIAGE_PATH);
  const census = asRecord(triage.failure_census, `${FAILURE_TRIAGE_PATH}.failure_census`);
  if (!Array.isArray(census.reports)) throw new Error(`${FAILURE_TRIAGE_PATH}.failure_census.reports: tableau requis`);
  const paths = census.reports.map((value, index) => {
    const report = asRecord(value, `${FAILURE_TRIAGE_PATH}.failure_census.reports[${index}]`);
    const path = requiredString(report, "path", `${FAILURE_TRIAGE_PATH}.failure_census.reports[${index}]`);
    if (!BATCH_REPORT_PATTERN.test(path)) throw new Error(`${path}: hors motif de rapports batch`);
    return path;
  }).sort((left, right) => left.localeCompare(right));
  if (paths.length === 0) throw new Error(`${commit}: aucun rapport batch 20260729 committé`);
  for (const path of paths) git(["cat-file", "-e", `${commit}:${path}`]);
  return paths;
}

function numberValue(record: JsonRecord, key: string, where: string): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${where}.${key}: entier positif requis`);
  return value as number;
}

function collectFailures(commit: string, paths: readonly string[]): { rows: FailureRow[]; report_count: number } {
  const rows: FailureRow[] = [];
  for (const path of paths) {
    const report = asRecord(committedJson(commit, path), path);
    if (report.contract !== "pv-graphify-semantic-control/v1") throw new Error(`${path}: contrat inattendu`);
    const indexing = asRecord(report.indexing, `${path}.indexing`);
    const outcomes = asRecord(indexing.outcomes, `${path}.indexing.outcomes`);
    const declared = numberValue(outcomes, FAILURE_OUTCOME, `${path}.indexing.outcomes`);
    if (!Array.isArray(report.documents)) throw new Error(`${path}.documents: tableau requis`);
    const selection = asRecord(report.universe_selection, `${path}.universe_selection`);
    const offset = numberValue(selection, "offset", `${path}.universe_selection`);
    const selected = numberValue(selection, "selected", `${path}.universe_selection`);
    const requested = selection.requested === undefined ? selected : numberValue(selection, "requested", `${path}.universe_selection`);
    const skipped = selection.skipped_indexed_cas_keys ?? [];
    if (!Array.isArray(skipped) || skipped.some((value) => typeof value !== "string")) {
      throw new Error(`${path}.universe_selection.skipped_indexed_cas_keys: tableau de chaînes requis`);
    }
    if (report.documents.length !== selected) throw new Error(`${path}: documents != selected`);
    const offsetsObservable = skipped.length === 0 && selected === requested;
    let actual = 0;
    for (const [rowIndex, value] of report.documents.entries()) {
      const document = asRecord(value, `${path}.documents[${rowIndex}]`);
      if (document.outcome !== FAILURE_OUTCOME) continue;
      actual++;
      const reason = optionalString(document, "failure_reason", `${path}.documents[${rowIndex}]`);
      rows.push({
        report: path,
        row_index: rowIndex,
        selection_offset: offset,
        selection_offset_hundred: Math.floor(offset / 100) * 100,
        document_offset: offsetsObservable ? offset + rowIndex : null,
        storage_key: requiredString(document, "storage_key", `${path}.documents[${rowIndex}]`),
        slug: requiredString(document, "slug", `${path}.documents[${rowIndex}]`),
        municipality_name: optionalString(document, "municipality_name", `${path}.documents[${rowIndex}]`),
        url: optionalString(document, "url", `${path}.documents[${rowIndex}]`),
        failure_reason: reason,
      });
    }
    if (actual !== declared) throw new Error(`${path}: échecs déclarés ${declared}, observés ${actual}`);
  }
  return { rows, report_count: paths.length };
}

function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  return Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]!);
    }
  })).then(() => output);
}

async function readRange(s3: S3Client, key: string, length: number): Promise<Buffer> {
  const response = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Range: `bytes=0-${length - 1}`,
  }));
  const body = response.Body as AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void };
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_FULL_OBJECT_BYTES) {
      body.destroy?.(new Error(`réponse S3 > 5 MiB: ${key}`));
      throw new Error(`${key}: réponse S3 supérieure au plafond`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function compact(value: string): string | null {
  const result = value.replace(/\s+/gu, " ").trim();
  return result.length === 0 ? null : result.slice(0, 300);
}

function pdfinfoField(stdout: string, field: string): string | null {
  const line = stdout.split("\n").find((value) => value.startsWith(`${field}:`));
  if (!line) return null;
  const value = line.slice(field.length + 1).trim();
  return value.length === 0 ? null : value;
}

function pageCount(stdout: string): number | null {
  const value = pdfinfoField(stdout, "Pages");
  if (value === null || !/^\d+$/u.test(value)) return null;
  const pages = Number(value);
  return Number.isSafeInteger(pages) && pages > 0 ? pages : null;
}

async function inspectPdf(s3: S3Client, key: string): Promise<PdfMetadata> {
  let contentLength: number;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!Number.isSafeInteger(head.ContentLength) || (head.ContentLength as number) < 1) {
      return { content_length: head.ContentLength ?? null, page_count: null, pdfinfo_exit_code: null, pdfinfo_error: null, title: null, creator: null, producer: null, pdf_version: null, encrypted: null, unknown_reason: "HeadObject sans taille positive" };
    }
    contentLength = head.ContentLength as number;
  } catch (error) {
    return { content_length: null, page_count: null, pdfinfo_exit_code: null, pdfinfo_error: compact(String(error)), title: null, creator: null, producer: null, pdf_version: null, encrypted: null, unknown_reason: "HeadObject en échec" };
  }
  if (contentLength > MAX_FULL_OBJECT_BYTES) {
    return { content_length: contentLength, page_count: null, pdfinfo_exit_code: null, pdfinfo_error: null, title: null, creator: null, producer: null, pdf_version: null, encrypted: null, unknown_reason: "objet > 5 MiB: lecture intégrale interdite par le protocole" };
  }
  let bytes: Buffer;
  try {
    bytes = await readRange(s3, key, contentLength);
  } catch (error) {
    return { content_length: contentLength, page_count: null, pdfinfo_exit_code: null, pdfinfo_error: compact(String(error)), title: null, creator: null, producer: null, pdf_version: null, encrypted: null, unknown_reason: "lecture S3 en échec" };
  }
  const result = spawnSync("pdfinfo", ["-"], { input: bytes, encoding: "utf8", maxBuffer: 128 * 1024 });
  if (result.error) {
    return { content_length: contentLength, page_count: null, pdfinfo_exit_code: result.status, pdfinfo_error: compact(result.error.message), title: null, creator: null, producer: null, pdf_version: null, encrypted: null, unknown_reason: "pdfinfo indisponible" };
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const pages = pageCount(stdout);
  return {
    content_length: contentLength,
    page_count: pages,
    pdfinfo_exit_code: result.status,
    pdfinfo_error: compact(stderr),
    title: pdfinfoField(stdout, "Title"),
    creator: pdfinfoField(stdout, "Creator"),
    producer: pdfinfoField(stdout, "Producer"),
    pdf_version: pdfinfoField(stdout, "PDF version"),
    encrypted: pdfinfoField(stdout, "Encrypted"),
    unknown_reason: pages === null ? "pdfinfo n'a pas rendu un nombre de pages" : null,
  };
}

function countBy(values: readonly (string | null)[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value ?? "unknown";
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function urlHost(url: string | null): string | null {
  if (url === null) return null;
  try { return new URL(url).host; } catch { return null; }
}

function uniqueDocuments(rows: readonly FailureRow[], metadata: readonly PdfMetadata[], municipalities: ReadonlyMap<string, Municipality>): FailedDocument[] {
  const byKey = new Map<string, FailureRow[]>();
  for (const row of rows) byKey.set(row.storage_key, [...(byKey.get(row.storage_key) ?? []), row]);
  const keys = [...byKey.keys()].sort((left, right) => left.localeCompare(right));
  return keys.map((key, index) => {
    const sourceRows = byKey.get(key)!;
    const first = sourceRows[0]!;
    const muni = municipalities.get(first.slug);
    return {
      ...metadata[index]!,
      storage_key: key,
      slug: first.slug,
      municipality_name: first.municipality_name,
      mrc: muni?.mrc ?? null,
      url: first.url,
      url_host: urlHost(first.url),
      selection_offsets: [...new Set(sourceRows.map((row) => row.selection_offset))].sort((left, right) => left - right),
      selection_offset_hundreds: [...new Set(sourceRows.map((row) => row.selection_offset_hundred))].sort((left, right) => left - right),
      source_reports: [...new Set(sourceRows.map((row) => row.report))].sort((left, right) => left.localeCompare(right)),
    };
  });
}

function indexedSlugMap(commit: string, batchPaths: readonly string[], allowedKeys: ReadonlySet<string>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (document: JsonRecord): void => {
    const key = requiredString(document, "storage_key", "indexed document");
    if (!allowedKeys.has(key)) return;
    const slugs = new Set<string>();
    const primary = document.slug;
    if (typeof primary === "string" && primary.length > 0) slugs.add(primary);
    const scope = document.owner_scope;
    if (typeof scope === "object" && scope !== null && !Array.isArray(scope)) {
      const printed = (scope as JsonRecord).printed_owner_slugs;
      if (Array.isArray(printed)) for (const slug of printed) if (typeof slug === "string" && slug.length > 0) slugs.add(slug);
    }
    if (slugs.size === 0) return;
    const existing = map.get(key) ?? new Set<string>();
    for (const slug of slugs) existing.add(slug);
    map.set(key, existing);
  };
  const summary = asRecord(committedJson(commit, INDEXED_SUMMARY_PATH), INDEXED_SUMMARY_PATH);
  const sourceReports = summary.source_reports;
  if (!Array.isArray(sourceReports)) throw new Error(`${INDEXED_SUMMARY_PATH}.source_reports: tableau requis`);
  for (const value of sourceReports) {
    if (typeof value !== "string") throw new Error(`${INDEXED_SUMMARY_PATH}.source_reports: chemin invalide`);
    const report = asRecord(committedJson(commit, value), value);
    if (!Array.isArray(report.documents)) throw new Error(`${value}.documents: tableau requis`);
    for (const document of report.documents) add(asRecord(document, `${value}.documents[]`));
  }
  for (const path of batchPaths) {
    const report = asRecord(committedJson(commit, path), path);
    if (!Array.isArray(report.documents)) continue;
    for (const value of report.documents) {
      const document = asRecord(value, `${path}.documents[]`);
      if (document.outcome === "INDEXED") add(document);
    }
  }
  return map;
}

function bucketEvidence(documents: readonly FailedDocument[], rows: readonly FailureRow[], municipalities: ReadonlyMap<string, Municipality>): Array<JsonRecord> {
  const buckets = [...new Set(rows.map((row) => row.selection_offset_hundred))].sort((left, right) => left - right);
  return buckets.map((bucket) => {
    const bucketRows = rows.filter((row) => row.selection_offset_hundred === bucket);
    const keys = new Set(bucketRows.map((row) => row.storage_key));
    const bucketDocs = documents.filter((document) => keys.has(document.storage_key));
    const mrcValues = bucketDocs.map((document) => municipalities.get(document.slug)?.mrc ?? null);
    const uniqueMrc = countBy(mrcValues);
    const uniqueProducer = countBy(bucketDocs.map((document) => document.producer));
    const uniqueCreator = countBy(bucketDocs.map((document) => document.creator));
    const uniqueHost = countBy(bucketDocs.map((document) => document.url_host));
    const uniqueMunicipalities = countBy(bucketDocs.map((document) => document.slug));
    return {
      offset_start: bucket,
      offset_end_inclusive: bucket + 99,
      failure_rows: bucketRows.length,
      unique_documents: bucketDocs.length,
      distinct_municipalities: uniqueMunicipalities.length,
      municipalities_by_count: uniqueMunicipalities,
      mrc_by_count: uniqueMrc,
      pdfinfo_producer_by_count: uniqueProducer,
      pdfinfo_creator_by_count: uniqueCreator,
      url_host_by_count: uniqueHost,
      unique_mrc_values: uniqueMrc.length,
      unique_producer_values: uniqueProducer.length,
      unique_creator_values: uniqueCreator.length,
      unique_url_host_values: uniqueHost.length,
      cause_unique_common_dimension: uniqueMunicipalities.length === 1
        ? "municipality"
        : uniqueMrc.length === 1 && uniqueMrc[0]?.value !== "unknown"
          ? "mrc"
          : uniqueProducer.length === 1 && uniqueProducer[0]?.value !== "unknown"
            ? "pdfinfo_producer"
            : null,
    };
  });
}

function markdown(report: JsonRecord): string {
  const pages = asRecord(report.pages, "pages");
  const bands = pages.distribution_by_band as Array<{ label: string; count: number }>;
  const cost = asRecord(report.cost_usd, "cost_usd");
  const impact = asRecord(report.municipal_impact, "municipal_impact");
  const buckets = report.offset_concentration as Array<JsonRecord>;
  const focused = buckets.filter((bucket) => Number(bucket.offset_start) === 200 || Number(bucket.offset_start) === 1000);
  const offsetLines = focused.map((bucket) => {
    const topMuni = (bucket.municipalities_by_count as Array<{ value: string; count: number }>)[0];
    const topMrc = (bucket.mrc_by_count as Array<{ value: string; count: number }>)[0];
    const topProducer = (bucket.pdfinfo_producer_by_count as Array<{ value: string; count: number }>)[0];
    return `- **${String(bucket.offset_start)}–${String(bucket.offset_end_inclusive)}**: ${String(bucket.failure_rows)} lignes / ${String(bucket.unique_documents)} documents, ${String(bucket.distinct_municipalities)} municipalités; dominants observés — municipalité ${topMuni?.value ?? "unknown"} (${topMuni?.count ?? 0}), MRC ${topMrc?.value ?? "unknown"} (${topMrc?.count ?? 0}), Producer ${topProducer?.value ?? "unknown"} (${topProducer?.count ?? 0}). Cause unique identifiée: **${bucket.cause_unique_common_dimension === null ? "non" : String(bucket.cause_unique_common_dimension)}**.`;
  });
  const lines = [
    "# Inventaire des pages — échecs OCR candidats PV",
    "",
    `Périmètre fermé: commit d'entrée \`${String(report.input_commit)}\`, ${String(report.failure_rows)} lignes d'échec, ${String(report.unique_failed_documents)} clés CAS uniques; OCR, rendu, extraction texte et indexation non lancés.`,
    "",
    "## Pages et coût",
    "",
    `Pages connues: **${String(pages.known_pages_total)}**; médiane des connus: **${String(pages.median_known_documents)}**; min/max des connus: **${String(pages.min_known)} / ${String(pages.max_known)}**; unknown: **${String(pages.unknown_documents)}**. La médiane et le maximum des 186 sont donc **unknown**.`,
    `Distribution connue: ${bands.map((band) => `${band.label}=${band.count}`).join(", ")}.`,
    `Coût exact des pages connues: **${String(cost.known_pages_cost_usd)} USD**; fourchette avec unknown au niveau de la médiane: **${String(cost.range_lower_usd)}–${String(cost.range_upper_usd)} USD** (borne haute = extrapolation, pas une mesure).`,
    "",
    "## Municipalités",
    "",
    `${String(impact.distinct_affected_municipalities)} municipalités distinctes touchées; ${String(impact.municipalities_without_another_indexed_document)} n'ont aucun autre document indexé dans le périmètre de preuve. Dénominateur: ${String(report.captured_documents)} CAS PDF captés; part: ${String(report.captured_share_percent)}%.`,
    "",
    "## Offset 200 / 1000",
    "",
    ...offsetLines,
    "",
    "Les distributions détaillées par municipalité, MRC, URL et métadonnées `pdfinfo` sont dans le JSON; aucune cause de numérisation n'est déclarée lorsque les dimensions restent mixtes.",
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const inputCommit = requiredArg("input-commit");
  const outputPath = insideCoverage(requiredArg("out"));
  const markdownPath = insideCoverage(requiredArg("md"));
  const batchPaths = committedBatchReportPaths(inputCommit);
  const census = collectFailures(inputCommit, batchPaths);
  const triage = asRecord(committedJson(inputCommit, FAILURE_TRIAGE_PATH), FAILURE_TRIAGE_PATH);
  const triageCensus = asRecord(triage.failure_census, `${FAILURE_TRIAGE_PATH}.failure_census`);
  const snapshot = asRecord(committedJson(inputCommit, SNAPSHOT_PATH), SNAPSHOT_PATH);
  const population = asRecord(snapshot.population, `${SNAPSHOT_PATH}.population`);
  const capturedDocuments = numberValue(population, "unique_cas_keys", `${SNAPSHOT_PATH}.population`);
  const indexedGraph = asRecord(snapshot.indexed_graph, `${SNAPSHOT_PATH}.indexed_graph`);
  const snapshotIndexed = Array.isArray(indexedGraph.storage_keys) ? indexedGraph.storage_keys.filter((value): value is string => typeof value === "string") : [];
  const municipalitiesJson = committedJson(inputCommit, MUNICIPALITIES_PATH);
  if (!Array.isArray(municipalitiesJson)) throw new Error(`${MUNICIPALITIES_PATH}: tableau requis`);
  const municipalities = new Map<string, Municipality>();
  for (const value of municipalitiesJson) {
    const municipality = asRecord(value, MUNICIPALITIES_PATH);
    const slug = requiredString(municipality, "slug", MUNICIPALITIES_PATH);
    const name = requiredString(municipality, "name", MUNICIPALITIES_PATH);
    const mrcValue = municipality.mrc;
    if (mrcValue !== null && typeof mrcValue !== "string") throw new Error(`${MUNICIPALITIES_PATH}.${slug}.mrc: chaîne ou null requis`);
    municipalities.set(slug, { slug, name, mrc: mrcValue as string | null });
  }
  const uniqueRows = [...new Map(census.rows.map((row) => [row.storage_key, row])).values()];
  if (census.rows.length !== Number(triageCensus.exact_failed_outcome_rows)) throw new Error(`lignes d'échec != triage committé (${census.rows.length} != ${String(triageCensus.exact_failed_outcome_rows)})`);
  if (uniqueRows.length !== Number(triageCensus.exact_unique_failed_cas_keys)) throw new Error(`clés CAS uniques != triage committé (${uniqueRows.length} != ${String(triageCensus.exact_unique_failed_cas_keys)})`);
  const s3 = s3Client();
  const metadata = await mapConcurrent(uniqueRows, 4, (row) => inspectPdf(s3, row.storage_key));
  const documents = uniqueDocuments(census.rows, metadata, municipalities);
  const knownPages = documents.flatMap((document) => document.page_count === null ? [] : [document.page_count]);
  const unknownDocuments = documents.length - knownPages.length;
  const knownTotal = knownPages.reduce((sum, value) => sum + value, 0);
  const knownMedian = median(knownPages);
  const bands = PAGE_BANDS.map((band) => ({ label: band.label, count: knownPages.filter((pages) => pages >= band.min && pages <= band.max).length }));
  const exactCost = knownTotal * 0.001;
  const extrapolatedUnknownCost = knownMedian === null ? null : unknownDocuments * knownMedian * 0.001;
  const extrapolatedTotal = extrapolatedUnknownCost === null ? null : exactCost + extrapolatedUnknownCost;
  const indexedByKey = indexedSlugMap(inputCommit, batchPaths, new Set(snapshotIndexed));
  if (indexedByKey.size !== snapshotIndexed.length) {
    throw new Error(`clés indexées du snapshot non toutes rattachables à une municipalité (${indexedByKey.size}/${snapshotIndexed.length})`);
  }
  const failedKeys = new Set(documents.map((document) => document.storage_key));
  const indexedCounts = new Map<string, number>();
  for (const [key, slugs] of indexedByKey) {
    if (failedKeys.has(key)) continue;
    for (const slug of slugs) indexedCounts.set(slug, (indexedCounts.get(slug) ?? 0) + 1);
  }
  const affectedSlugs = [...new Set(documents.map((document) => document.slug))].sort((left, right) => left.localeCompare(right));
  const affectedMunicipalities = affectedSlugs.map((slug) => {
    const docs = documents.filter((document) => document.slug === slug);
    return {
      slug,
      name: municipalities.get(slug)?.name ?? docs[0]?.municipality_name ?? null,
      mrc: municipalities.get(slug)?.mrc ?? null,
      failed_documents: docs.length,
      other_indexed_documents: indexedCounts.get(slug) ?? 0,
      has_other_indexed_document: (indexedCounts.get(slug) ?? 0) > 0,
    };
  });
  const offsetConcentration = bucketEvidence(documents, census.rows, municipalities);
  const report: JsonRecord = {
    contract: "pv-ocr-inventaire-pages/v1",
    generated_at: new Date().toISOString(),
    input_commit: inputCommit,
    analysis_script: "acquisition/src/_pv-ocr-pages-inventory.ts",
    source_triage: FAILURE_TRIAGE_PATH,
    source_snapshot: SNAPSHOT_PATH,
    read_only: true,
    ocr_launched: false,
    graphify_or_indexing_launched: false,
    pdf_metadata_tool: "pdfinfo -",
    pdf_metadata_only: true,
    captured_documents: capturedDocuments,
    captured_share_percent: Number(((documents.length / capturedDocuments) * 100).toFixed(1)),
    failure_rows: census.rows.length,
    unique_failed_documents: documents.length,
    duplicate_failure_rows: census.rows.length - documents.length,
    pages: {
      documents: documents.length,
      known_documents: knownPages.length,
      unknown_documents: unknownDocuments,
      known_pages_total: knownTotal,
      total_pages: null,
      median_known_documents: knownMedian,
      median_all_documents: null,
      min_known: knownPages.length === 0 ? null : Math.min(...knownPages),
      max_known: knownPages.length === 0 ? null : Math.max(...knownPages),
      max_all_documents: null,
      distribution_by_band: bands,
    },
    cost_usd: {
      price_per_page_usd: "0.001",
      known_pages_cost_usd: exactCost.toFixed(3),
      unknown_at_known_median_extrapolation_usd: extrapolatedUnknownCost === null ? null : extrapolatedUnknownCost.toFixed(3),
      range_lower_usd: exactCost.toFixed(3),
      range_upper_usd: extrapolatedTotal === null ? null : extrapolatedTotal.toFixed(3),
      range_upper_is_extrapolation: unknownDocuments > 0,
    },
    municipal_impact: {
      distinct_affected_municipalities: affectedMunicipalities.length,
      municipalities_without_another_indexed_document: affectedMunicipalities.filter((municipality) => !municipality.has_other_indexed_document).length,
      indexed_evidence_documents: indexedByKey.size,
      snapshot_indexed_pvs: snapshotIndexed.length,
      municipalities: affectedMunicipalities,
    },
    offset_concentration: offsetConcentration,
    failed_documents: documents,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, markdown(report), "utf8");
  process.stdout.write(JSON.stringify({
    report: outputPath.replace(`${ROOT}/`, ""),
    markdown: markdownPath.replace(`${ROOT}/`, ""),
    pages: report.pages,
    municipal_impact: report.municipal_impact,
    offset_concentration: offsetConcentration.filter((bucket) => bucket.offset_start === 200 || bucket.offset_start === 1000),
  }, null, 2) + "\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
