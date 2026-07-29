/**
 * Materialise une campagne PV qui ouvre d'abord des municipalités sans PV
 * indexé dans une partition finale fermée. Aucun octet de document n'est lu :
 * seules les entrées d'index PV S3 sont consultées.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { canonicalCaptureUrl } from "./lib/pv-capture-backlog.js";
import {
  partitionPvCaptureTargetsByMunicipality,
  planPvProbableTargets,
  selectPvProbableTargetsForUncoveredMunicipalities,
  sha256,
  splitPvCaptureTargets,
  stablePvIndexListing,
  type PvIndexListing,
  type PvIndexSnapshot,
  type StablePvIndexListing,
} from "./lib/pv-probable-capture-plan.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PV_INDEX_PREFIX = "registry/qc-pv/";
const MAX_LOCAL_INPUT_BYTES = 5 * 1024 * 1024;

interface ClassificationReport {
  readonly contract: "pv-observable-classification/v1";
  readonly source_snapshot: { readonly sha256: string };
  readonly no_document_fetch: true;
}

interface MunicipalReference {
  readonly slug: unknown;
}

interface PartitionReport {
  readonly contract: "pv-univers-partition-finale/v1";
  readonly municipal_coverage: {
    readonly reference_municipalities: unknown;
    readonly municipalities_with_at_least_one_indexed_pv: unknown;
    readonly municipality_slugs: readonly { readonly slug: unknown }[];
  };
}

interface SubmittedWorklistUrlsReport {
  readonly contract: "pv-capture-submitted-worklist-urls/v1";
  readonly campaign: unknown;
  readonly unique_urls: unknown;
  readonly urls: unknown;
}

function value(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function values(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv.slice(2).flatMap((arg) => arg.startsWith(prefix) ? [arg.slice(prefix.length)] : []);
}

function required(name: string): string {
  const found = value(name);
  if (!found) throw new Error(`--${name}=... est requis`);
  return found;
}

function integer(name: string, minimum: number): number {
  const parsed = Number(required(name));
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`--${name} doit être un entier >= ${minimum}`);
  return parsed;
}

function insideRepo(path: string, name: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`--${name} doit rester dans le dépôt`);
  return absolute;
}

function readSmallJson(path: string, name: string): unknown {
  const absolute = insideRepo(path, name);
  const size = statSync(absolute).size;
  if (size > MAX_LOCAL_INPUT_BYTES) throw new Error(`--${name}: ${size} octets > plafond de lecture ${MAX_LOCAL_INPUT_BYTES}`);
  return JSON.parse(readFileSync(absolute, "utf8"));
}

function slugFromKey(key: string): string {
  const match = /^registry\/qc-pv\/([a-z0-9][a-z0-9-]*)\/index\.json$/.exec(key);
  if (!match) throw new Error(`clé d'index PV invalide: ${key}`);
  return match[1]!;
}

function stringSet(values: readonly { readonly slug: unknown }[] | readonly MunicipalReference[], name: string): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    if (typeof value.slug !== "string" || !value.slug) throw new Error(`${name}: slug municipal invalide`);
    if (result.has(value.slug)) throw new Error(`${name}: slug municipal dupliqué: ${value.slug}`);
    result.add(value.slug);
  }
  return result;
}

function submittedWorklistUrls(paths: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const path of paths) {
    const report = readSmallJson(path, "exclude-submitted-url-report") as SubmittedWorklistUrlsReport;
    if (
      report.contract !== "pv-capture-submitted-worklist-urls/v1"
      || typeof report.campaign !== "string"
      || !Number.isInteger(report.unique_urls)
      || !Array.isArray(report.urls)
      || report.urls.length !== report.unique_urls
    ) {
      throw new Error(`--exclude-submitted-url-report: contrat invalide: ${path}`);
    }
    for (const url of report.urls) {
      if (typeof url !== "string" || canonicalCaptureUrl(url) !== url) {
        throw new Error(`--exclude-submitted-url-report: URL canonique invalide: ${path}`);
      }
      result.add(url);
    }
  }
  return result;
}

function parseIndex(slug: string, raw: unknown): PvIndexSnapshot {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`index PV invalide pour ${slug}`);
  const index = raw as Record<string, unknown>;
  if (index.slug !== undefined && index.slug !== slug) throw new Error(`index PV ${slug}: slug intégré divergent`);
  return {
    slug,
    index_url: typeof index.pvIndexUrl === "string" && index.pvIndexUrl.trim() ? index.pvIndexUrl.trim() : null,
    entries: Array.isArray(index.entries) ? index.entries : [],
  };
}

function writeImmutable(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === body) return;
    throw new Error(`refus d'écraser l'artefact déterministe: ${path}`);
  }
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, body);
  renameSync(temporary, path);
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

async function readSnapshot(classification: ClassificationReport): Promise<{ scans: PvIndexSnapshot[]; listing: StablePvIndexListing }> {
  const s3 = s3Client();
  const firstListing = (await listObjectEntries(s3, PV_INDEX_PREFIX))
    .filter((entry) => entry.key.endsWith("/index.json"))
    .map((entry) => [entry.key, entry.etag, entry.last_modified] as const) satisfies PvIndexListing;
  const scans = await mapConcurrent(firstListing, 4, async ([key]) =>
    parseIndex(slugFromKey(key), JSON.parse((await getBytes(s3, key)).toString("utf8")) as unknown));
  const finalListing = (await listObjectEntries(s3, PV_INDEX_PREFIX))
    .filter((entry) => entry.key.endsWith("/index.json"))
    .map((entry) => [entry.key, entry.etag, entry.last_modified] as const) satisfies PvIndexListing;
  return { scans, listing: stablePvIndexListing(classification.source_snapshot.sha256, firstListing, finalListing) };
}

async function main(): Promise<void> {
  const classificationPath = required("classification");
  const partitionPath = required("partition");
  const municipalitiesPath = required("municipalities");
  const outPrefix = insideRepo(required("out-prefix"), "out-prefix");
  const combinedOut = insideRepo(required("combined-out"), "combined-out");
  const outPlan = insideRepo(required("out-plan"), "out-plan");
  const excludedUrlReportPaths = values("exclude-submitted-url-report");
  const count = integer("count", 1);
  const lotSize = integer("lot-size", 1);
  if (!outPrefix.endsWith("lot-")) throw new Error("--out-prefix doit finir par lot-");
  const classification = readSmallJson(classificationPath, "classification") as ClassificationReport;
  if (classification.contract !== "pv-observable-classification/v1" || classification.no_document_fetch !== true || !classification.source_snapshot?.sha256) {
    throw new Error("--classification doit être le rapport observable PV complet");
  }
  const partition = readSmallJson(partitionPath, "partition") as PartitionReport;
  if (partition.contract !== "pv-univers-partition-finale/v1") throw new Error("--partition doit être une partition PV finale fermée");
  const municipalities = readSmallJson(municipalitiesPath, "municipalities");
  if (!Array.isArray(municipalities)) throw new Error("--municipalities doit être un tableau municipal");
  const municipalitySlugs = stringSet(municipalities as MunicipalReference[], "référentiel municipal");
  const covered = stringSet(partition.municipal_coverage?.municipality_slugs ?? [], "partition municipale");
  const excludedUrls = submittedWorklistUrls(excludedUrlReportPaths);
  if (partition.municipal_coverage.reference_municipalities !== municipalitySlugs.size) {
    throw new Error("partition municipale: taille du référentiel divergente");
  }
  if (partition.municipal_coverage.municipalities_with_at_least_one_indexed_pv !== covered.size) {
    throw new Error("partition municipale: cardinalité couverte divergente");
  }
  const snapshot = await readSnapshot(classification);
  const candidates = planPvProbableTargets(snapshot.scans);
  const candidatePartition = partitionPvCaptureTargetsByMunicipality(candidates, municipalitySlugs);
  const eligibleCandidates = candidatePartition.recognized.filter((target) => !excludedUrls.has(canonicalCaptureUrl(target.urls[0])));
  const selected = selectPvProbableTargetsForUncoveredMunicipalities({
    targets: eligibleCandidates,
    municipalitySlugs,
    coveredMunicipalitySlugs: covered,
    count,
  });
  const lots = splitPvCaptureTargets(selected, lotSize);
  const combinedBody = `${JSON.stringify(selected, null, 2)}\n`;
  writeImmutable(combinedOut, combinedBody);
  const worklists = lots.map((lot, index) => {
    const body = `${JSON.stringify(lot, null, 2)}\n`;
    const path = `${outPrefix}${String(index + 1).padStart(4, "0")}.json`;
    writeImmutable(path, body);
    return { lot: index + 1, path: path.slice(ROOT.length + 1), targets: lot.length, sha256: sha256(body) };
  });
  const targetedMunicipalities = new Set(selected.map((target) => target.slug));
  const plan = {
    contract: "pv-uncovered-municipality-capture-plan/v1",
    classification: classificationPath,
    partition: partitionPath,
    municipalities: municipalitiesPath,
    source_snapshot: snapshot.listing.sha256,
    classification_snapshot: classification.source_snapshot.sha256,
    classification_recomputed_from_fresh_index: snapshot.listing.classificationWasStale,
    expected_pv_probable: candidates.length,
    pv_probable_with_reference_municipality: candidatePartition.recognized.length,
    pv_probable_without_reference_municipality: candidatePartition.unrecognized.length,
    submitted_worklist_exclusions: {
      reports: excludedUrlReportPaths,
      unique_urls: excludedUrls.size,
      pv_probable_excluded: candidatePartition.recognized.length - eligibleCandidates.length,
    },
    municipal_coverage: {
      reference_municipalities: municipalitySlugs.size,
      municipalities_with_at_least_one_indexed_pv: covered.size,
      municipalities_without_any_indexed_pv: municipalitySlugs.size - covered.size,
      municipalities_targeted_without_any_indexed_pv: [...targetedMunicipalities].filter((slug) => !covered.has(slug)).length,
    },
    selected: { targets: selected.length, sha256: sha256(`${JSON.stringify(selected)}\n`) },
    combined_worklist: { path: combinedOut.slice(ROOT.length + 1), targets: selected.length, sha256: sha256(combinedBody) },
    worklists,
  };
  writeImmutable(outPlan, `${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ plan: outPlan.slice(ROOT.length + 1), targets: selected.length, lots: lots.length, municipalities_targeted_without_any_indexed_pv: plan.municipal_coverage.municipalities_targeted_without_any_indexed_pv }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
