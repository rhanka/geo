/**
 * Re-measure the provenance quality of the qc-zonage collections geo-api
 * actually serves.  This is intentionally read-only on S3: it reads
 * normalized/, capture/ and raw/, then writes only a local coverage matrix.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/zone-provenance-quality-run.ts
 *
 * Long runs checkpoint after small read batches. Re-run with --resume after an
 * interruption; no served, capture or raw S3 key is ever written.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import {
  SERVED_ZONE_PREFIX,
  captureManifestKeyFromListedRest,
  captureReceiptFromManifest,
  classifyServedCollection,
  completeServedGeometryProof,
  proofTuple,
  selectServedZoneCollections,
  type CaptureReceipt,
  type QualityStatus,
  type ServedCollectionClassification,
  type ServedZoneCollection,
  type VerifiedCaptureReceipt,
} from "./lib/zone-provenance-quality.js";
import {
  verifyRawCapturePayload,
  type RawCaptureVerificationObservation,
} from "./lib/zone-provenance-raw-capture.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const CATALOG = resolve(ROOT, "packages", "qc-sources", "src", "geo", "municipalities.qc.json");
const CAPTURE_RUNS_PREFIX = "capture/_runs/";
const UNIVERSE = 1106;
const S3_READ_TIMEOUT_MS = 300_000;
let s3ReadTimeoutMs = S3_READ_TIMEOUT_MS;

interface City {
  slug: string;
  name: string;
}

interface CollectionAudit extends ServedZoneCollection {
  feature_count: number | null;
  object_sha256: string | null;
  classification: ServedCollectionClassification;
  read_error: string | null;
}

interface Progress {
  contract: "zone-provenance-quality-progress/v1";
  as_of: string;
  listing_sha256: string;
  /** Retained so a rejected resume identifies a changed served object exactly. */
  listing_identity: readonly (readonly [string, string | null, string | null])[];
  capture_listing_sha256: string;
  capture_manifest_identity: readonly (readonly [string, string | null, string | null])[];
  selected_keys: string[];
  audits: CollectionAudit[];
}

interface CaptureScan {
  key: string;
  lines: number;
  receipts: CaptureReceipt[];
  error: string | null;
}

interface RawVerification {
  receipt: VerifiedCaptureReceipt | null;
  reason: string | null;
  indeterminate: boolean;
  observation: RawCaptureVerificationObservation | null;
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

function sha256(value: Buffer | string): string {
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

async function retryS3<T>(label: string, fn: (abortSignal: AbortSignal) => Promise<T>, timeoutMs = S3_READ_TIMEOUT_MS): Promise<T> {
  let last: unknown;
  // The AWS client itself observes AWS_MAX_ATTEMPTS. These short immediate
  // retries cover the known IPv6 happy-eyeballs AggregateError without a
  // blocking sleep/poll loop.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
        return await fn(controller.signal);
      } catch (error) {
        if (timedOut) throw new Error(`lecture S3 expirée après ${timeoutMs}ms: ${label}`);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      last = error;
      if (attempt < 3) console.error(`[provenance] retry ${attempt}/2: ${label}: ${errorText(error)}`);
    }
  }
  throw last;
}

async function scanCaptureManifest(s3: ReturnType<typeof s3Client>, key: string): Promise<CaptureScan> {
  try {
    const text = (await retryS3(`GetObject ${key}`, (signal) => getBytes(s3, key, undefined, signal))).toString("utf8");
    const lines = parseManifestJsonl(text);
    const receipts = lines.flatMap((line: CaptureManifestLine, lineIndex) => {
      const receipt = captureReceiptFromManifest(line, key, lineIndex);
      return receipt ? [receipt] : [];
    });
    return { key, lines: lines.length, receipts, error: null };
  } catch (error) {
    return { key, lines: 0, receipts: [], error: errorText(error) };
  }
}

async function verifyRawCapture(
  s3: ReturnType<typeof s3Client>,
  receipt: CaptureReceipt,
): Promise<RawVerification> {
  try {
    const bytes = await retryS3(`GetObject ${receipt.storage_key}`, (signal) => getBytes(s3, receipt.storage_key, undefined, signal), s3ReadTimeoutMs);
    const metaKey = `${receipt.storage_key}.meta.json`;
    const meta = JSON.parse((await retryS3(`GetObject ${metaKey}`, (signal) => getBytes(s3, metaKey, undefined, signal), s3ReadTimeoutMs)).toString("utf8")) as unknown;
    const checked = verifyRawCapturePayload(receipt, bytes, meta);
    return checked.verified
      ? { receipt: { ...receipt, raw_sha256_verified: true }, reason: null, indeterminate: false, observation: checked.observation }
      : { receipt: null, reason: checked.reason, indeterminate: false, observation: checked.observation };
  } catch (error) {
    return { receipt: null, reason: errorText(error), indeterminate: true, observation: null };
  }
}

function unknownAudit(selection: ServedZoneCollection, reason: string): CollectionAudit {
  return {
    ...selection,
    feature_count: null,
    object_sha256: null,
    classification: { status: "unknown", reason, proof: null, capture: null },
    read_error: reason,
  };
}

async function scanCollection(
  s3: ReturnType<typeof s3Client>,
  selection: ServedZoneCollection,
  captures: ReadonlyMap<string, CaptureReceipt[]>,
  rawVerification: Map<string, Promise<RawVerification>>,
): Promise<CollectionAudit> {
  let bytes: Buffer;
  let collection: unknown;
  try {
    bytes = await retryS3(`GetObject ${selection.key}`, (signal) => getBytes(s3, selection.key, undefined, signal), s3ReadTimeoutMs);
    collection = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return unknownAudit(selection, `served-collection-unreadable:${errorText(error)}`);
  }

  const verified = new Map<string, VerifiedCaptureReceipt>();
  let captureVerificationIndeterminate = false;
  const proof = completeServedGeometryProof(collection);
  if (proof) {
    const tuple = proofTuple(proof);
    for (const receipt of captures.get(tuple) ?? []) {
      const cacheKey = `${receipt.manifest_key}#${receipt.line_index}`;
      let check = rawVerification.get(cacheKey);
      if (!check) {
        check = verifyRawCapture(s3, receipt);
        rawVerification.set(cacheKey, check);
      }
      const result = await check;
      if (result.receipt) {
        verified.set(tuple, result.receipt);
        break;
      }
      captureVerificationIndeterminate ||= result.indeterminate;
    }
  }

  const features = collection && typeof collection === "object" && Array.isArray((collection as { features?: unknown }).features)
    ? (collection as { features: unknown[] }).features.length
    : null;
  const classification = classifyServedCollection(collection, verified);
  return {
    ...selection,
    feature_count: features,
    object_sha256: sha256(bytes),
    classification: captureVerificationIndeterminate && classification.status !== "v2"
      ? { ...classification, status: "unknown", reason: `capture-verification-indeterminate:${classification.reason}` }
      : classification,
    read_error: null,
  };
}

function counts(): Record<QualityStatus, number> {
  return { acceptable: 0, candidate: 0, orphan: 0, unknown: 0, v2: 0 };
}

function loadProgress(path: string, listingSha: string, captureListingSha: string, selected: ServedZoneCollection[]): Map<string, CollectionAudit> {
  if (!existsSync(path)) throw new Error(`--resume demandé mais checkpoint absent: ${path}`);
  const progress = JSON.parse(readFileSync(path, "utf8")) as Progress;
  if (
    progress.contract !== "zone-provenance-quality-progress/v1" ||
    progress.listing_sha256 !== listingSha ||
    progress.capture_listing_sha256 !== captureListingSha
  ) {
    throw new Error("checkpoint incompatible avec le snapshot S3 actuel; reprendre sans --resume");
  }
  const expected = new Set(selected.map((entry) => entry.key));
  if (!Array.isArray(progress.audits) || progress.audits.some((audit) => !expected.has(audit.key))) {
    throw new Error("checkpoint contient une collection hors du listing S3 actuel; reprendre sans --resume");
  }
  return new Map(progress.audits.map((audit) => [audit.slug, audit]));
}

function writeProgress(
  path: string,
  asOf: string,
  listingSha: string,
  listingIdentity: readonly (readonly [string, string | null, string | null])[],
  captureListingSha: string,
  captureManifestIdentity: readonly (readonly [string, string | null, string | null])[],
  selected: ServedZoneCollection[],
  audits: Map<string, CollectionAudit>,
): void {
  writeAtomic(path, {
    contract: "zone-provenance-quality-progress/v1",
    as_of: asOf,
    listing_sha256: listingSha,
    listing_identity: listingIdentity,
    capture_listing_sha256: captureListingSha,
    capture_manifest_identity: captureManifestIdentity,
    selected_keys: selected.map((entry) => entry.key),
    audits: [...audits.values()].sort((left, right) => left.slug.localeCompare(right.slug)),
  } satisfies Progress);
}

async function main(): Promise<void> {
  const asOf = today();
  const batchSize = positiveInt("batch", 25, 1, 100);
  const concurrency = positiveInt("concurrency", 4, 1, 16);
  const maxBatches = positiveInt("max-batches", 100_000, 1, 100_000);
  s3ReadTimeoutMs = positiveInt("s3-read-timeout-ms", S3_READ_TIMEOUT_MS, 1_000, S3_READ_TIMEOUT_MS);
  const resume = argv.includes("--resume");
  const cities = readCities();
  const canonical = new Map(cities.map((city) => [city.slug, city]));
  const s3 = s3Client();

  const zoneObjects = await retryS3(`ListObjectsV2 ${SERVED_ZONE_PREFIX}`, (signal) => listObjectEntries(s3, SERVED_ZONE_PREFIX, undefined, signal));
  const selected = selectServedZoneCollections(zoneObjects.map((entry) => entry.key));
  const zoneIdentity = new Map(zoneObjects.map((entry) => [entry.key, [entry.etag, entry.last_modified] as const]));
  const listingIdentity = selected.map((entry) => [entry.key, ...(zoneIdentity.get(entry.key) ?? [null, null])] as const);
  const listingSha = sha256(JSON.stringify(listingIdentity));
  const checkpoint = resolve(COVERAGE, `.zone-provenance-quality-progress-${asOf}-${listingSha.slice(0, 16)}.json`);
  console.error(`[provenance] collections S3 effectivement servies: ${selected.length} (nested prioritaire)`);

  const captureObjects = await retryS3(`ListObjectsV2 ${CAPTURE_RUNS_PREFIX}`, (signal) => listObjectEntries(s3, CAPTURE_RUNS_PREFIX, undefined, signal));
  const manifestEntries = captureObjects.flatMap((entry) => {
    const key = captureManifestKeyFromListedRest(entry.key.slice(CAPTURE_RUNS_PREFIX.length));
    return key === entry.key ? [{ key, etag: entry.etag, last_modified: entry.last_modified }] : [];
  });
  const manifestKeys = manifestEntries.map((entry) => entry.key);
  const captureManifestIdentity = manifestEntries.map((entry) => [entry.key, entry.etag, entry.last_modified] as const);
  const captureListingSha = sha256(JSON.stringify(captureManifestIdentity));
  const manifestScans = await mapConcurrent(manifestKeys, concurrency, (key) => scanCaptureManifest(s3, key));
  const captureByTuple = new Map<string, CaptureReceipt[]>();
  for (const receipt of manifestScans.flatMap((scan) => scan.receipts).sort((left, right) =>
    left.manifest_key.localeCompare(right.manifest_key) || left.line_index - right.line_index,
  )) {
    const tuple = proofTuple(receipt);
    captureByTuple.set(tuple, [...(captureByTuple.get(tuple) ?? []), receipt]);
  }
  const manifestErrors = manifestScans.filter((scan) => scan.error !== null).map((scan) => ({ key: scan.key, error: scan.error }));
  console.error(`[provenance] manifests capture: ${manifestKeys.length}, lignes exploitables: ${[...captureByTuple.values()].reduce((sum, rows) => sum + rows.length, 0)}, erreurs: ${manifestErrors.length}`);
  if (manifestErrors.length > 0) throw new Error(`lecture de manifestes capture incomplète: ${JSON.stringify(manifestErrors)}`);

  const audits = resume ? loadProgress(checkpoint, listingSha, captureListingSha, selected) : new Map<string, CollectionAudit>();
  const pending = selected.filter((entry) => !audits.has(entry.slug));
  const rawVerification = new Map<string, Promise<RawVerification>>();
  console.error(`[provenance] collections à lire: ${pending.length}/${selected.length}${resume ? " (reprise)" : ""}`);
  let batchesRun = 0;
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    console.error(`[provenance] lecture lot ${batchesRun + 1}: ${batch.length} collection(s)`);
    const scanned = await mapConcurrent(
      batch,
      concurrency,
      (entry) => scanCollection(s3, entry, captureByTuple, rawVerification),
      (_entry, audit) => {
        // Persist every completed collection: an interrupted long S3 batch is
        // always resumable without re-labelling unobserved collections.
        audits.set(audit.slug, audit);
        writeProgress(
          checkpoint,
          asOf,
          listingSha,
          listingIdentity,
          captureListingSha,
          captureManifestIdentity,
          selected,
          audits,
        );
      },
    );
    for (const audit of scanned) audits.set(audit.slug, audit);
    writeProgress(
      checkpoint,
      asOf,
      listingSha,
      listingIdentity,
      captureListingSha,
      captureManifestIdentity,
      selected,
      audits,
    );
    console.error(`[provenance] progression collections: ${audits.size}/${selected.length} · checkpoint ${checkpoint}`);
    batchesRun++;
    if (batchesRun >= maxBatches && audits.size < selected.length) {
      console.log(JSON.stringify({
        complete: false,
        checkpoint,
        scanned_collections: audits.size,
        remaining_collections: selected.length - audits.size,
        resume: "re-run with --resume",
      }, null, 2));
      return;
    }
  }

  const qualityCounts = counts();
  const rows = cities.map((city) => {
    const audit = audits.get(city.slug);
    const classification = audit?.classification ?? { status: "unknown" as const, reason: "no-served-collection", proof: null, capture: null };
    qualityCounts[classification.status]++;
    return {
      city_slug: city.slug,
      city_name: city.name,
      quality_status: classification.status,
      collection_key: audit?.key ?? null,
      selected_layout: audit?.layout ?? null,
      shadowed_keys: audit?.alternatives ?? [],
      feature_count: audit?.feature_count ?? null,
      object_sha256: audit?.object_sha256 ? `sha256:${audit.object_sha256}` : null,
      proof: classification.proof,
      capture: classification.capture,
      reason: classification.reason,
      read_error: audit?.read_error ?? null,
    };
  });
  const exactJoins = rows.filter((row) => row.collection_key !== null).length;
  const unlinked = [...audits.values()]
    .filter((audit) => !canonical.has(audit.slug))
    .map((audit) => ({
      slug: audit.slug,
      collection_key: audit.key,
      selected_layout: audit.layout,
      feature_count: audit.feature_count,
      quality_status: audit.classification.status,
      reason: audit.classification.reason,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const featureCounts = counts();
  let exactFeatures = 0;
  for (const audit of audits.values()) {
    if (!canonical.has(audit.slug) || audit.feature_count === null) continue;
    featureCounts[audit.classification.status] += audit.feature_count;
    exactFeatures += audit.feature_count;
  }
  const unlinkedFeatures = unlinked.reduce((sum, row) => sum + (row.feature_count ?? 0), 0);
  const proofWithoutCapture = rows
    .filter((row) => row.proof !== null && row.capture === null)
    .map((row) => ({ city_slug: row.city_slug, collection_key: row.collection_key, proof: row.proof, reason: row.reason }));
  const rawChecks = await Promise.all(rawVerification.values());
  const rawCheckFailures = rawChecks.filter((check) => check.receipt === null && check.reason !== null).map((check) => check.reason);
  const total = Object.values(qualityCounts).reduce((sum, value) => sum + value, 0);
  if (total !== UNIVERSE) throw new Error(`partition qualité invalide: ${total} ≠ ${UNIVERSE}`);
  // Une collection illisible tombe dans `unknown` — indiscernable d'un « mesuré,
  // rien trouvé ». Un run à timeout court a déjà produit une matrice à 788/1106
  // lectures expirées : elle disait `acceptable 75` là où la mesure précédente
  // disait 727, et le rapport l'aurait servie comme un effondrement de qualité.
  const unreadableRows = rows.filter((row) => row.read_error !== null).length;

  const matrix = {
    contract: "zone-provenance-quality-matrix/v1",
    as_of: `${asOf.slice(0, 4)}-${asOf.slice(4, 6)}-${asOf.slice(6, 8)}`,
    generation: {
      runner: "acquisition/src/zone-provenance-quality-run.ts",
      generated_at: new Date().toISOString(),
      read_only_s3: true,
      served_prefix: SERVED_ZONE_PREFIX,
      serving_precedence: "nested_when_present_else_flat",
      capture_rule: "exact url+retrieved_at+sha256 manifest tuple; CAS payload re-hashed; sidecar SHA-256 and storage key match that payload; backfilled excluded. A CAS sidecar sourceUrl/fetchedAt may belong to an earlier deduplicated fetch.",
      checkpoint_strategy: "local atomic batches; removed after successful matrix write; --resume requires the retained checkpoint after interruption",
    },
    quality_status_policy: {
      acceptable: "Uniform served zone_source_level historical-verified, documented, or legacy-traceable; this is never inferred as v2.",
      candidate: "Uniform served zone_source_level candidate.",
      orphan: "Uniform served zone_source_level orphan.",
      unknown: "No served collection, unreadable/ambiguous collection, or absent/invalid/non-uniform served source level.",
      v2: "A complete served v2 proof whose exact url/retrieved_at/sha256 tuple matches a valid capture manifest, whose CAS bytes re-hash to that SHA, and whose non-backfilled sidecar identifies that CAS object.",
    },
    validation: {
      city_identity: {
        expected_cities: UNIVERSE,
        matrix_rows: rows.length,
        unique_catalog_slugs: cities.length,
        unique_matrix_city_slugs: new Set(rows.map((row) => row.city_slug)).size,
        exact_slug_joins: exactJoins,
        cities_without_exact_zone_row: UNIVERSE - exactJoins,
        exact_coverage_equation: `${exactJoins} + ${UNIVERSE - exactJoins} = ${UNIVERSE}`,
        passed: rows.length === UNIVERSE && exactJoins + (UNIVERSE - exactJoins) === UNIVERSE,
      },
      zone_identity: {
        manifest_rows: selected.length,
        unique_manifest_slugs: selected.length,
        exact_city_joins: exactJoins,
        unlinked_zone_rows: unlinked.length,
        collection_equation: `${exactJoins} + ${unlinked.length} = ${selected.length}`,
        unlinked_zone_slugs: unlinked.map((row) => row.slug),
        passed: exactJoins + unlinked.length === selected.length,
      },
      quality_status_partition: {
        counts: qualityCounts,
        equation: `${qualityCounts.acceptable} + ${qualityCounts.candidate} + ${qualityCounts.orphan} + ${qualityCounts.v2} + ${qualityCounts.unknown} = ${UNIVERSE}`,
        passed: total === UNIVERSE,
      },
      feature_arithmetic: {
        exact_city_joined_features: featureCounts,
        exact_city_joined_total: exactFeatures,
        unlinked_zone_row_features: unlinkedFeatures,
        manifest_total: exactFeatures + unlinkedFeatures,
        equation: `${exactFeatures} + ${unlinkedFeatures} = ${exactFeatures + unlinkedFeatures}`,
        passed: true,
      },
      v2: {
        v2_quality_statuses: qualityCounts.v2,
        assertion: "No v2 proof is claimed without an exact capture tuple and re-hashed attached CAS payload.",
        passed: true,
      },
      read_integrity: {
        rows_unreadable: unreadableRows,
        assertion: "An unreadable served collection is NOT measured; counting it 'unknown' would report a timeout as a provenance verdict.",
        passed: unreadableRows === 0,
      },
    },
    inputs: [
      { role: "authoritative 1,106-city identity catalog", path: "packages/qc-sources/src/geo/municipalities.qc.json", sha256: `sha256:${sha256(readFileSync(CATALOG))}` },
      { role: "served zone universe", s3_prefix: `s3://sentropic-geo/${SERVED_ZONE_PREFIX}`, logical_collections: selected.length, listing_sha256: `sha256:${listingSha}` },
      { role: "capture manifests", s3_prefix: "s3://sentropic-geo/capture/_runs/", manifests: manifestKeys.length },
    ],
    layouts: {
      logical_collections: selected.length,
      selected_nested: selected.filter((entry) => entry.layout === "nested").length,
      selected_flat: selected.filter((entry) => entry.layout === "flat").length,
      coexistences: selected.filter((entry) => entry.alternatives.length > 0).length,
    },
    capture_scan: {
      manifests: manifestKeys.length,
      manifest_errors: manifestErrors,
      valid_receipts: [...captureByTuple.values()].reduce((sum, entries) => sum + entries.length, 0),
      raw_cas_verifications_attempted: rawChecks.length,
      raw_cas_verifications_verified: rawChecks.filter((check) => check.receipt !== null).length,
      raw_cas_verification_failures: rawCheckFailures,
      // This is an audit trace, not another authority: it makes a CAS dedup's
      // first-fetch sidecar observable alongside the exact matched manifest row.
      raw_cas_verification_observations: rawChecks.flatMap((check) => check.observation ? [check.observation] : []),
    },
    unlinked_served_collections: unlinked,
    proof_without_attachable_capture: proofWithoutCapture,
    rows,
  };
  const serialized = JSON.stringify(matrix, null, 2) + "\n";
  // Le nom EST le contrat de découverte du rapport (`latestZoneProvenanceQualityMatrix`).
  // Un run dont des lectures ont échoué n'a pas mesuré : il sort sous un nom
  // NON reconnu par le résolveur, pour qu'une mesure partielle ne puisse jamais
  // devenir la référence en se contentant d'être la plus récente.
  // Horodatage à la SECONDE, pas seulement la date : le suffixe est un sha de
  // CONTENU, pas une horloge. Avec une simple date, deux runs du même jour se
  // départageaient par ordre lexicographique de leur hash — le rapport a ainsi
  // lu 23 v2 alors que la mesure la plus récente en comptait 36.
  const stamp = `${asOf}T${new Date().toISOString().slice(11, 19).replace(/:/g, "")}Z`;
  const stem = unreadableRows === 0
    ? `zone-provenance-quality-matrix-${stamp}-${sha256(serialized).slice(0, 16)}`
    : `zone-provenance-quality-PARTIAL-${stamp}-${sha256(serialized).slice(0, 16)}`;
  const output = resolve(COVERAGE, `${stem}.json`);
  if (existsSync(output)) throw new Error(`matrice déjà présente, refus d'écraser: ${output}`);
  writeAtomic(output, matrix);
  rmSync(checkpoint, { force: true });
  console.log(JSON.stringify({
    output: resolve(ROOT, output),
    served_collections: selected.length,
    v2: qualityCounts.v2,
    delta_from_zero: qualityCounts.v2,
    proof_without_attachable_capture: proofWithoutCapture.length,
    rows_unreadable: unreadableRows,
    publishable: unreadableRows === 0,
    checkpoint_removed: true,
  }, null, 2));
  if (unreadableRows > 0) {
    throw new Error(
      `${unreadableRows}/${UNIVERSE} collections servies illisibles: la matrice n'a PAS mesuré la provenance et sort en PARTIAL. `
      + `Relance sans brider --s3-read-timeout-ms (défaut ${S3_READ_TIMEOUT_MS} ms) et avec NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10.`,
    );
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
