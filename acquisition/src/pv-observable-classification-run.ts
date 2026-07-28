/**
 * Classify the QC PV index corpus by observable URL/title markers only.
 *
 * This is deliberately cheaper and stricter than capture: it reads only
 * registry/qc-pv/<slug>/index.json manifests from S3, never opens the listed
 * documents, and writes only local coverage artifacts.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     node_modules/.bin/tsx acquisition/src/pv-observable-classification-run.ts \
 *       --date=20260727 --concurrency=2 --batch=20
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { classifyPvObservableDocument } from "./lib/pv-observable-classification.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const PV_INDEX_PREFIX = "registry/qc-pv/";
const YEAR_MIN = 1990;
const YEAR_MAX = 2026;

const CLASSES = ["pv_probable", "ordre_du_jour", "autre_document", "non_document", "indetermine"] as const;
type DocClass = (typeof CLASSES)[number];

const CLASS_LABEL: Record<DocClass, string> = {
  pv_probable: "PV probable",
  ordre_du_jour: "Ordre du jour",
  autre_document: "Autre document",
  non_document: "Non-document",
  indetermine: "Indetermine",
};

const MEDIA_EXTENSIONS = new Set(["mp3", "m4a", "mp4", "wav", "wma", "mov", "avi", "wmv", "webm", "flv"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "svg"]);
const PAGE_LIKE_EXTENSIONS = new Set(["sans_extension", "php", "asp", "aspx", "html", "htm"]);
const UNKNOWN_YEAR = "indetermine";

interface RawEntry {
  readonly url?: unknown;
  readonly title?: unknown;
}

interface IndexScan {
  readonly slug: string;
  readonly key: string;
  readonly index_url: string | null;
  readonly declared_count: number | null;
  readonly entries: EntryObservation[];
}

interface EntryObservation {
  readonly url: string;
  readonly title?: string;
  readonly self_reference: boolean;
}

interface Progress {
  readonly contract: "pv-observable-classification-progress/v1";
  readonly as_of: string;
  readonly index_listing_sha256: string;
  readonly pv_index_listing: readonly (readonly [string, string | null, string | null])[];
  readonly scans: IndexScan[];
}

interface DocumentObservation {
  readonly url: string;
  readonly titles: Set<string>;
  readonly sourceSlugs: Set<string>;
  readonly sourceIndexKeys: Set<string>;
  selfReference: boolean;
  duplicateEntries: number;
}

interface Classification {
  readonly class: DocClass;
  readonly marker: string;
}

const argv = process.argv.slice(2);

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function today(): string {
  const forced = option("date");
  if (forced !== null) {
    if (!/^\d{8}$/.test(forced)) throw new Error("--date must be YYYYMMDD");
    return forced;
  }
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function positiveInt(name: string, fallback: number, min: number, max: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer ${min}..${max}`);
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeAtomic(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
}

function writeJsonAtomic(path: string, value: unknown): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeImmutableText(path: string, value: string): void {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === value) return;
    throw new Error(`refusing to overwrite existing dated artifact: ${path}`);
  }
  writeAtomic(path, value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function exactIndexKeySlug(key: string): string {
  const match = /^registry\/qc-pv\/([a-z0-9][a-z0-9-]*)\/index\.json$/.exec(key);
  if (!match) throw new Error(`unexpected PV index key: ${key}`);
  return match[1]!;
}

function decodeLoose(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fold(value: string): string {
  return decodeLoose(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenText(value: string): string {
  return fold(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function urlObservable(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function extensionOf(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return "url_invalide";
  }
  const match = /\.([a-z0-9]{1,5})$/i.exec(path);
  return match ? match[1]!.toLowerCase() : "sans_extension";
}

function yearsIn(value: string): number[] {
  const years: number[] = [];
  for (const match of value.matchAll(/(?:19|20)\d{2}/g)) {
    const year = Number.parseInt(match[0], 10);
    if (year >= YEAR_MIN && year <= YEAR_MAX) years.push(year);
  }
  return years;
}

function yearOf(doc: DocumentObservation): number | null {
  const years = [
    ...yearsIn(doc.url),
    ...[...doc.titles].flatMap((title) => yearsIn(title)),
  ];
  return years.length === 0 ? null : Math.max(...years);
}

function hasSpecificDate(text: string): boolean {
  const raw = fold(text);
  const spaced = tokenText(text);
  const months = "janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre";
  return (
    /\b(?:19|20)\d{2}[-_/ ](?:0?[1-9]|1[0-2])[-_/ ](?:0?[1-9]|[12]\d|3[01])\b/.test(raw) ||
    /\b(?:0?[1-9]|[12]\d|3[01])[-_/ ](?:0?[1-9]|1[0-2])[-_/ ](?:19|20)\d{2}\b/.test(raw) ||
    new RegExp(`\\b(?:0?[1-9]|[12]\\d|3[01])\\s+(?:${months})\\s+(?:19|20)\\d{2}\\b`).test(spaced) ||
    /\b(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\b/.test(spaced) ||
    /\b(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])(?:19|20)\d{2}\b/.test(spaced)
  );
}

function firstMarker(text: string, markers: readonly [string, RegExp][]): string | null {
  for (const [marker, regex] of markers) {
    if (regex.test(text)) return marker;
  }
  return null;
}

function isIndexPagePattern(urlText: string, titleText: string, extension: string, textHasSpecificDate: boolean): string | null {
  if (!PAGE_LIKE_EXTENSIONS.has(extension)) return null;
  if (/\bf pv (?:19|20)\d{2}\b/.test(urlText)) return "index_page:f-pv-year";
  if (textHasSpecificDate) return null;
  if (/\b(proces verbaux|seances du conseil|conseil municipal)\b/.test(titleText)) {
    return "index_page:title";
  }
  if (/\b(proces verbaux|seances du conseil)\b/.test(urlText) && !/\b(pdf|docx?|ashx)\b/.test(urlText)) {
    return "index_page:url";
  }
  return null;
}

function classify(doc: DocumentObservation): Classification {
  return classifyPvObservableDocument(doc);
}

function bump(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function emptyClassMap(): Record<DocClass, number> {
  return Object.fromEntries(CLASSES.map((name) => [name, 0])) as Record<DocClass, number>;
}

function sortedCountRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function sortedYearRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((left, right) => {
    if (left[0] === UNKNOWN_YEAR) return 1;
    if (right[0] === UNKNOWN_YEAR) return -1;
    return Number(right[0]) - Number(left[0]);
  }));
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

function parseIndex(slug: string, key: string, parsed: unknown): IndexScan {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${key}: JSON root is not an object`);
  const record = parsed as Record<string, unknown>;
  if (record["slug"] !== undefined && record["slug"] !== slug) {
    throw new Error(`${key}: embedded slug ${JSON.stringify(record["slug"])} != ${slug}`);
  }
  const indexUrl = str(record["pvIndexUrl"]);
  const declared = record["count"];
  const declaredCount = Number.isInteger(declared) && (declared as number) >= 0 ? (declared as number) : null;
  const entries = Array.isArray(record["entries"]) ? (record["entries"] as RawEntry[]) : [];
  return {
    slug,
    key,
    index_url: indexUrl,
    declared_count: declaredCount,
    entries: entries.flatMap((entry) => {
      const url = str(entry.url);
      if (url === null) return [];
      const title = str(entry.title);
      return [{
        url,
        ...(title !== null ? { title } : {}),
        self_reference: indexUrl !== null && url === indexUrl,
      }];
    }),
  };
}

async function readIndex(
  s3: ReturnType<typeof s3Client>,
  selection: { readonly slug: string; readonly key: string },
): Promise<IndexScan> {
  return parseIndex(selection.slug, selection.key, JSON.parse((await getBytes(s3, selection.key)).toString("utf8")) as unknown);
}

function writeProgress(
  path: string,
  asOf: string,
  listingSha: string,
  listing: readonly (readonly [string, string | null, string | null])[],
  scans: ReadonlyMap<string, IndexScan>,
): void {
  writeJsonAtomic(path, {
    contract: "pv-observable-classification-progress/v1",
    as_of: asOf,
    index_listing_sha256: listingSha,
    pv_index_listing: listing,
    scans: [...scans.values()].sort((left, right) => left.key.localeCompare(right.key)),
  } satisfies Progress);
}

function loadProgress(path: string, listingSha: string): Map<string, IndexScan> {
  if (!existsSync(path)) throw new Error(`--resume requested but checkpoint is absent: ${path}`);
  const progress = JSON.parse(readFileSync(path, "utf8")) as Progress;
  if (progress.contract !== "pv-observable-classification-progress/v1" || progress.index_listing_sha256 !== listingSha) {
    throw new Error("checkpoint does not match current PV index listing");
  }
  return new Map(progress.scans.map((scan) => [scan.key, scan]));
}

function buildDocuments(scans: Iterable<IndexScan>): { documents: Map<string, DocumentObservation>; entriesTotal: number; selfReferences: number } {
  const documents = new Map<string, DocumentObservation>();
  let entriesTotal = 0;
  let selfReferences = 0;
  for (const scan of scans) {
    for (const entry of scan.entries) {
      entriesTotal += 1;
      if (entry.self_reference) selfReferences += 1;
      let doc = documents.get(entry.url);
      if (!doc) {
        doc = {
          url: entry.url,
          titles: new Set<string>(),
          sourceSlugs: new Set<string>(),
          sourceIndexKeys: new Set<string>(),
          selfReference: false,
          duplicateEntries: 0,
        };
        documents.set(entry.url, doc);
      }
      if (entry.title !== undefined) doc.titles.add(entry.title);
      doc.sourceSlugs.add(scan.slug);
      doc.sourceIndexKeys.add(scan.key);
      doc.selfReference ||= entry.self_reference;
      doc.duplicateEntries += 1;
    }
  }
  return { documents, entriesTotal, selfReferences };
}

function renderMarkdown(report: {
  readonly generated_at: string;
  readonly source_snapshot: { readonly sha256: string };
  readonly indexes: { readonly found: number; readonly read: number };
  readonly entries: { readonly total_with_duplicates: number; readonly distinct_urls: number; readonly self_referencing_entries: number };
  readonly class_counts: Record<DocClass, number>;
  readonly by_class_year: Record<DocClass, Record<string, number>>;
  readonly marker_counts: Record<DocClass, Record<string, number>>;
}): string {
  const countRows = CLASSES.map((name) => `| ${CLASS_LABEL[name]} | ${report.class_counts[name]} |`);
  const yearRows = CLASSES.flatMap((name) => {
    const years = report.by_class_year[name];
    return Object.entries(years).map(([year, count]) => `| ${CLASS_LABEL[name]} | ${year} | ${count} |`);
  });
  const markerRows = CLASSES.flatMap((name) => {
    const markers = report.marker_counts[name];
    return Object.entries(markers).map(([marker, count]) => `| ${CLASS_LABEL[name]} | \`${marker}\` | ${count} |`);
  });
  return [
    "# Classification observable du corpus PV",
    "",
    `Genere: ${report.generated_at}`,
    `Instantane index S3: ${report.source_snapshot.sha256}`,
    "",
    "Important: `PV probable` est une classification par MARQUEUR observable dans l'URL ou le titre, pas une lecture du contenu du document. Aucun document liste par les index n'a ete ouvert.",
    "",
    `Index lus: ${report.indexes.read}/${report.indexes.found}`,
    `Entrees: ${report.entries.total_with_duplicates} avec doublons; ${report.entries.distinct_urls} URL distinctes; ${report.entries.self_referencing_entries} auto-references d'index.`,
    "",
    "## Decompte par classe",
    "",
    "| Classe | URL distinctes |",
    "|---|---:|",
    ...countRows,
    "",
    "## Croisement classe x millesime",
    "",
    "| Classe | Millesime | URL distinctes |",
    "|---|---:|---:|",
    ...yearRows,
    "",
    "## Marqueurs observes",
    "",
    "| Classe | Marqueur | URL distinctes |",
    "|---|---|---:|",
    ...markerRows,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const asOf = today();
  const batchSize = positiveInt("batch", 20, 1, 100);
  const concurrency = positiveInt("concurrency", 2, 1, 4);
  const maxBatches = positiveInt("max-batches", 100_000, 1, 100_000);
  const resume = argv.includes("--resume");
  const s3 = s3Client();

  const indexObjects = (await listObjectEntries(s3, PV_INDEX_PREFIX)).filter((entry) => entry.key.endsWith("/index.json"));
  const indexListing = indexObjects.map((entry) => [entry.key, entry.etag, entry.last_modified] as const);
  const indexListingSha = sha256(JSON.stringify({ pv_index_listing: indexListing }));
  const checkpoint = resolve(COVERAGE, `.pv-observable-classification-progress-${asOf}-${indexListingSha.slice(0, 16)}.json`);
  const selections = indexObjects.map((entry) => ({ key: entry.key, slug: exactIndexKeySlug(entry.key) }));
  const scans = resume ? loadProgress(checkpoint, indexListingSha) : new Map<string, IndexScan>();
  const pending = selections.filter((entry) => !scans.has(entry.key));

  console.error(`[pv-observable] indexes=${selections.length} pending=${pending.length} concurrency=${concurrency} batch=${batchSize} snapshot=${indexListingSha.slice(0, 16)}`);
  let batchesRun = 0;
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const results = await mapConcurrent(batch, concurrency, (entry) => readIndex(s3, entry));
    for (const scan of results) scans.set(scan.key, scan);
    writeProgress(checkpoint, asOf, indexListingSha, indexListing, scans);
    batchesRun += 1;
    console.error(`[pv-observable] progress=${scans.size}/${selections.length} checkpoint=${checkpoint}`);
    if (batchesRun >= maxBatches && scans.size < selections.length) {
      console.log(JSON.stringify({
        complete: false,
        checkpoint,
        scanned_indexes: scans.size,
        remaining_indexes: selections.length - scans.size,
        resume: "re-run with --resume",
      }, null, 2));
      return;
    }
  }

  const finalListing = (await listObjectEntries(s3, PV_INDEX_PREFIX))
    .filter((entry) => entry.key.endsWith("/index.json"))
    .map((entry) => [entry.key, entry.etag, entry.last_modified] as const);
  const finalListingSha = sha256(JSON.stringify({ pv_index_listing: finalListing }));
  if (finalListingSha !== indexListingSha) {
    throw new Error("PV index listing changed during read; refusing to publish a mixed-snapshot measurement");
  }

  const { documents, entriesTotal, selfReferences } = buildDocuments(scans.values());
  const classCounts = emptyClassMap();
  const markerCounts = Object.fromEntries(CLASSES.map((name) => [name, new Map<string, number>()])) as Record<DocClass, Map<string, number>>;
  const byClassYearMaps = Object.fromEntries(CLASSES.map((name) => [name, new Map<string, number>()])) as Record<DocClass, Map<string, number>>;
  const byClassExtensionMaps = Object.fromEntries(CLASSES.map((name) => [name, new Map<string, number>()])) as Record<DocClass, Map<string, number>>;

  for (const doc of documents.values()) {
    const result = classify(doc);
    classCounts[result.class] += 1;
    bump(markerCounts[result.class], result.marker);
    bump(byClassExtensionMaps[result.class], extensionOf(doc.url));
    const year = yearOf(doc);
    bump(byClassYearMaps[result.class], year === null ? UNKNOWN_YEAR : String(year));
  }

  const byClassYear = Object.fromEntries(CLASSES.map((name) => [name, sortedYearRecord(byClassYearMaps[name])])) as Record<DocClass, Record<string, number>>;
  const markerCountsOut = Object.fromEntries(CLASSES.map((name) => [name, sortedCountRecord(markerCounts[name])])) as Record<DocClass, Record<string, number>>;
  const byClassExtension = Object.fromEntries(CLASSES.map((name) => [name, sortedCountRecord(byClassExtensionMaps[name])])) as Record<DocClass, Record<string, number>>;
  const outputStem = `pv-observable-classification-${asOf}-${indexListingSha.slice(0, 16)}`;
  const jsonPath = resolve(COVERAGE, `${outputStem}.json`);
  const mdPath = resolve(COVERAGE, `${outputStem}.md`);
  const report = {
    contract: "pv-observable-classification/v1",
    generated_at: new Date().toISOString(),
    read_only_s3: true,
    no_document_fetch: true,
    note: "`pv_probable` is a marker classification from observable URL/title text, not a content reading. Entries without an observable document-type marker remain `indetermine`.",
    source_snapshot: {
      sha256: `sha256:${indexListingSha}`,
      pv_index_listing: indexListing,
    },
    indexes: {
      found: selections.length,
      read: scans.size,
    },
    entries: {
      total_with_duplicates: entriesTotal,
      distinct_urls: documents.size,
      duplicate_url_entries: entriesTotal - documents.size,
      self_referencing_entries: selfReferences,
    },
    class_counts: classCounts,
    indetermine_count: classCounts.indetermine,
    by_class_year: byClassYear,
    pv_probable_by_year: byClassYear.pv_probable,
    by_class_extension: byClassExtension,
    marker_counts: markerCountsOut,
    rules: {
      non_document: ["index URL self-reference", "known index page URL/title patterns", "audio/video/image extensions"],
      ordre_du_jour: ["ordre du jour", "odj", "avis de convocation", "convocation", "agenda"],
      autre_document: ["reglement", "avis public", "budget", "rapport", "annexe", "politique", "formulaire", "communique", "calendrier", "taxation/taxes", "permis", "appel d'offres/soumission", "contrat", "certificat"],
      pv_probable: ["proces-verbal/proces-verbaux", "pv token", "seance ordinaire", "seance extraordinaire", "minutes", "SO/SE with a specific date", "conseil/council with a specific date"],
      indetermine: ["no observable URL/title marker"],
    },
  };
  writeImmutableText(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeImmutableText(mdPath, renderMarkdown(report));
  console.log(JSON.stringify({
    complete: true,
    json: jsonPath,
    markdown: mdPath,
    entries: report.entries,
    class_counts: report.class_counts,
    pv_probable_by_year: report.pv_probable_by_year,
    indetermine_count: report.indetermine_count,
  }, null, 2));
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
