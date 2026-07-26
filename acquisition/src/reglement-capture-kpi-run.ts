/**
 * Measure the durable capture coverage of served `reglement_url` values.
 *
 * Reads S3 only; writes dated local KPI artefacts and resumable cluster
 * worklists.  It never writes `normalized/`, and deliberately sets no S3 read
 * timeout: a slow read is not evidence that an object is absent.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/reglement-capture-kpi-run.ts
 *
 * Re-run an interrupted pass with `--resume`.  Each small batch checkpoints
 * under `work/coverage/`; `--max-batches=N` is useful for an intentional short
 * run and exits with the precise resume command.
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
  classifyReglementCityCapture,
  classifyReglementUrlCapture,
  observeReglementUrls,
  type AttachableCapture,
  type FailedCaptureAttempt,
  type ReglementUrlObservation,
} from "./lib/reglement-capture-kpi.js";
import {
  captureManifestKeyFromListedRest,
  captureReceiptFromManifest,
  selectServedZoneCollections,
  SERVED_ZONE_PREFIX,
} from "./lib/zone-provenance-quality.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const CONFIG = resolve(ROOT, "acquisition", "config");
const CATALOG = resolve(ROOT, "packages", "qc-sources", "src", "geo", "municipalities.qc.json");
const CAPTURE_RUNS_PREFIX = "capture/_runs/";
const UNIVERSE = 1106;
const WORKLIST_SOURCE = "reglement-served";

interface City {
  slug: string;
  name: string;
}

interface CollectionScan {
  slug: string;
  collection_key: string;
  selected_layout: "flat" | "nested";
  observation: ReglementUrlObservation | null;
  read_error: string | null;
}

interface Progress {
  contract: "reglement-capture-kpi-progress/v1";
  as_of: string;
  snapshot_sha256: string;
  zone_listing: readonly (readonly [string, string | null, string | null])[];
  capture_manifest_listing: readonly (readonly [string, string | null, string | null])[];
  scans: CollectionScan[];
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
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, path);
}

/** A worklist is immutable control input.  A matching interrupted write is reusable; a divergent one is refused. */
function writeImmutableJson(path: string, value: unknown): void {
  const serialized = JSON.stringify(value, null, 2) + "\n";
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === serialized) return;
    throw new Error(`refus d'écraser l'artefact daté existant: ${path}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, serialized);
  renameSync(temp, path);
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

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>, onResolved?: (item: T, result: R) => void): Promise<R[]> {
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

async function scanCollection(s3: ReturnType<typeof s3Client>, selection: { slug: string; key: string; layout: "flat" | "nested" }): Promise<CollectionScan> {
  try {
    const collection = JSON.parse((await getBytes(s3, selection.key)).toString("utf8")) as unknown;
    return {
      slug: selection.slug,
      collection_key: selection.key,
      selected_layout: selection.layout,
      observation: observeReglementUrls(collection),
      read_error: null,
    };
  } catch (error) {
    // An unreadable served object is unknown, never treated as a city without a règlement URL.
    return {
      slug: selection.slug,
      collection_key: selection.key,
      selected_layout: selection.layout,
      observation: null,
      read_error: errorText(error),
    };
  }
}

function loadProgress(path: string, snapshotSha: string, selectedSlugs: ReadonlySet<string>): Map<string, CollectionScan> {
  if (!existsSync(path)) throw new Error(`--resume demandé mais checkpoint absent: ${path}`);
  const progress = JSON.parse(readFileSync(path, "utf8")) as Progress;
  if (progress.contract !== "reglement-capture-kpi-progress/v1" || progress.snapshot_sha256 !== snapshotSha) {
    throw new Error("checkpoint incompatible avec le snapshot S3 actuel; reprendre sans --resume");
  }
  if (!Array.isArray(progress.scans) || progress.scans.some((scan) => !selectedSlugs.has(scan.slug))) {
    throw new Error("checkpoint contient une collection hors du listing S3 actuel; reprendre sans --resume");
  }
  return new Map(progress.scans.map((scan) => [scan.slug, scan]));
}

function writeProgress(path: string, asOf: string, snapshotSha: string, zoneListing: readonly (readonly [string, string | null, string | null])[], manifestListing: readonly (readonly [string, string | null, string | null])[], scans: Map<string, CollectionScan>): void {
  writeAtomic(path, {
    contract: "reglement-capture-kpi-progress/v1",
    as_of: asOf,
    snapshot_sha256: snapshotSha,
    zone_listing: zoneListing,
    capture_manifest_listing: manifestListing,
    scans: [...scans.values()].sort((left, right) => left.slug.localeCompare(right.slug)),
  } satisfies Progress);
}

function failedAttempt(line: CaptureManifestLine, manifestKey: string, lineIndex: number): FailedCaptureAttempt {
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

async function readManifest(s3: ReturnType<typeof s3Client>, key: string): Promise<ManifestScan> {
  return { key, lines: parseManifestJsonl((await getBytes(s3, key)).toString("utf8")) };
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
  const s3 = s3Client();

  // Both listings are a snapshot identity.  A resumed run never silently mixes
  // a new manifest (or changed served collection) with old observations.
  const zoneObjects = await listObjectEntries(s3, SERVED_ZONE_PREFIX);
  const selected = selectServedZoneCollections(zoneObjects.map((entry) => entry.key));
  const zoneIdentityByKey = new Map(zoneObjects.map((entry) => [entry.key, [entry.etag, entry.last_modified] as const]));
  const zoneListing = selected.map((entry) => [entry.key, ...(zoneIdentityByKey.get(entry.key) ?? [null, null])] as const);
  const captureObjects = await listObjectEntries(s3, CAPTURE_RUNS_PREFIX);
  const manifestEntries = captureObjects.flatMap((entry) => {
    const key = captureManifestKeyFromListedRest(entry.key.slice(CAPTURE_RUNS_PREFIX.length));
    return key === entry.key ? [entry] : [];
  });
  const manifestListing = manifestEntries.map((entry) => [entry.key, entry.etag, entry.last_modified] as const);
  const snapshotSha = sha256(JSON.stringify({ zone_listing: zoneListing, capture_manifest_listing: manifestListing }));
  const checkpoint = resolve(COVERAGE, `.reglement-capture-kpi-progress-${asOf}-${snapshotSha.slice(0, 16)}.json`);
  console.error(`[reglement-capture] collections servies: ${selected.length}; manifests: ${manifestEntries.length}; snapshot=${snapshotSha.slice(0, 16)}`);

  // The complete manifest scan is an all-or-nothing input: an unread manifest
  // must stop the measurement rather than turn unknown evidence into "absent".
  const manifests = await mapConcurrent(manifestEntries.map((entry) => entry.key), concurrency, (key) => readManifest(s3, key));
  const manifestLines = manifests.flatMap((scan) => scan.lines.map((line, lineIndex) => ({ line, manifest_key: scan.key, line_index: lineIndex })));
  console.error(`[reglement-capture] lignes manifest lues: ${manifestLines.length}`);

  const scans = resume
    ? loadProgress(checkpoint, snapshotSha, new Set(selected.map((entry) => entry.slug)))
    : new Map<string, CollectionScan>();
  const pending = selected.filter((entry) => !scans.has(entry.slug));
  console.error(`[reglement-capture] collections à lire: ${pending.length}/${selected.length}${resume ? " (reprise)" : ""}`);
  let batchesRun = 0;
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    await mapConcurrent(batch, concurrency, (entry) => scanCollection(s3, entry), (_entry, scan) => {
      scans.set(scan.slug, scan);
      writeProgress(checkpoint, asOf, snapshotSha, zoneListing, manifestListing, scans);
    });
    writeProgress(checkpoint, asOf, snapshotSha, zoneListing, manifestListing, scans);
    batchesRun++;
    console.error(`[reglement-capture] progression: ${scans.size}/${selected.length} · checkpoint ${checkpoint}`);
    if (batchesRun >= maxBatches && scans.size < selected.length) {
      console.log(JSON.stringify({
        complete: false,
        checkpoint,
        scanned_collections: scans.size,
        remaining_collections: selected.length - scans.size,
        resume: "re-run with --resume",
      }, null, 2));
      return;
    }
  }

  const allServedUrls = new Set<string>();
  for (const scan of scans.values()) for (const url of scan.observation?.urls ?? []) allServedUrls.add(url);
  const candidateReceipts: Array<AttachableCapture & { raw_exists?: boolean }> = [];
  const failedAttempts: FailedCaptureAttempt[] = [];
  for (const { line, manifest_key, line_index } of manifestLines) {
    if (!allServedUrls.has(line.url)) continue;
    const receipt = captureReceiptFromManifest(line, manifest_key, line_index);
    if (receipt) {
      candidateReceipts.push({ ...receipt, source: line.source });
    } else {
      // A 404/403/timeout remains visible in the per-URL history.  A malformed
      // non-receipt success is also retained as an attempt, never promoted.
      failedAttempts.push(failedAttempt(line, manifest_key, line_index));
    }
  }
  const rawKeys = [...new Set(candidateReceipts.map((receipt) => receipt.storage_key))].sort();
  const rawExists = new Map<string, boolean>();
  await mapConcurrent(rawKeys, concurrency, async (key) => ({ key, present: await exists(s3, key) }), (_key, result) => {
    rawExists.set(result.key, result.present);
  });
  const attachable = candidateReceipts.filter((receipt) => rawExists.get(receipt.storage_key) === true);
  const rawMissing = candidateReceipts.filter((receipt) => rawExists.get(receipt.storage_key) !== true);

  const featureCounts = {
    features_total: 0,
    features_with_reglement_url: 0,
    features_with_http_reglement_url: 0,
    features_with_invalid_reglement_url: 0,
    collections_unreadable: 0,
  };
  for (const scan of scans.values()) {
    if (!scan.observation) {
      featureCounts.collections_unreadable++;
      continue;
    }
    featureCounts.features_total += scan.observation.feature_count;
    featureCounts.features_with_reglement_url += scan.observation.features_with_reglement_url;
    featureCounts.features_with_http_reglement_url += scan.observation.features_with_http_reglement_url;
    featureCounts.features_with_invalid_reglement_url += scan.observation.features_with_invalid_reglement_url;
  }

  const cityRows = cities.map((city) => {
    const scan = scans.get(city.slug) ?? null;
    const kpi = scan?.observation
      ? classifyReglementCityCapture(scan.observation.urls, { attachable, failed: failedAttempts })
      : classifyReglementCityCapture([], { attachable, failed: [] });
    return {
      city_slug: city.slug,
      city_name: city.name,
      collection_key: scan?.collection_key ?? null,
      selected_layout: scan?.selected_layout ?? null,
      collection_read_error: scan?.read_error ?? (scan ? null : "no-served-collection"),
      feature_observation: scan?.observation ?? null,
      ...kpi,
    };
  });
  const cityStateCounts = countStates(cityRows.map((row) => row.state));
  if (Object.values(cityStateCounts).reduce((sum, value) => sum + value, 0) !== UNIVERSE) {
    throw new Error("partition état-ville règlement invalide");
  }

  const urls = [...allServedUrls].sort().map((url) => classifyReglementUrlCapture(url, { attachable, failed: failedAttempts }));
  const urlStateCounts = countStates(urls.map((row) => row.state));
  const urlsWithCas = urls.filter((row) => row.captures.length > 0).length;
  const urlsWithoutCas = urls.length - urlsWithCas;
  if (urlsWithCas + urlsWithoutCas !== urls.length) throw new Error("partition URL règlement invalide");

  const representativeSlugByUrl = new Map<string, string>();
  for (const row of cityRows) {
    for (const entry of row.urls) {
      const previous = representativeSlugByUrl.get(entry.url);
      if (!previous || row.city_slug.localeCompare(previous) < 0) representativeSlugByUrl.set(entry.url, row.city_slug);
    }
  }
  const missingTargets = urls
    .filter((entry) => entry.captures.length === 0)
    .map((entry) => ({
      slug: representativeSlugByUrl.get(entry.url)!,
      source: WORKLIST_SOURCE,
      urls: [entry.url],
    }))
    .sort((left, right) => left.urls[0]!.localeCompare(right.urls[0]!));
  const worklists: string[] = [];
  for (let start = 0; start < missingTargets.length; start += worklistBatch) {
    const lot = String(Math.floor(start / worklistBatch) + 1).padStart(3, "0");
    const path = resolve(CONFIG, `reglement-capture-${asOf}-${snapshotSha.slice(0, 16)}-lot-${lot}.json`);
    writeImmutableJson(path, missingTargets.slice(start, start + worklistBatch));
    worklists.push(path);
  }

  const report = {
    contract: "reglement-capture-kpi/v1",
    generated_at: new Date().toISOString(),
    read_only_s3: true,
    universe: UNIVERSE,
    source_snapshot: {
      sha256: `sha256:${snapshotSha}`,
      served_collection_listing: zoneListing,
      capture_manifest_listing: manifestListing,
    },
    feature_counts: featureCounts,
    url_counts: {
      distinct_served_http_urls: urls.length,
      with_attachable_cas: urlsWithCas,
      without_attachable_cas: urlsWithoutCas,
      by_state: urlStateCounts,
    },
    city_counts: {
      by_state: cityStateCounts,
      unknown_without_http_reglement_url_or_unreadable_collection: cityRows.filter((row) => row.state === "unknown").length,
    },
    capture_evidence: {
      manifests_scanned: manifests.length,
      manifest_lines_scanned: manifestLines.length,
      candidate_receipts_for_served_urls: candidateReceipts.length,
      attachable_receipts: attachable.length,
      distinct_raw_keys_checked: rawKeys.length,
      receipts_with_missing_raw: rawMissing.length,
      failed_attempts_for_served_urls: failedAttempts.length,
    },
    capture_worklists: worklists.map((path) => ({ path, targets: JSON.parse(readFileSync(path, "utf8")).length })),
    cities: cityRows,
    urls,
  };
  const output = resolve(COVERAGE, `reglement-capture-kpi-${asOf}-${snapshotSha.slice(0, 16)}.json`);
  writeImmutableJson(output, report);
  console.log(JSON.stringify({
    complete: true,
    output,
    checkpoint,
    url_counts: report.url_counts,
    city_counts: report.city_counts,
    capture_worklists: report.capture_worklists,
  }, null, 2));
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
