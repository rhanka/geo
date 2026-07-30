/**
 * Deterministic PV → Graphify runner.
 *
 * The PDF is used only as the captured source from which `pdftotext -layout`
 * materializes a local text input. All semantic assertions come from that text
 * through `lib/pv-graphify-semantic.ts`; no model/backend is selected here.
 *
 * Usage (S3 runs must retain these two environment values):
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx src/pv-graphify-semantic-run.ts --control=20
 *
 * The default control cycles through every available municipality. This keeps
 * the municipal distribution as even as the eligible population permits.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";

import {
  extractPvSemantic,
  printedMunicipalityOwners,
  type GraphifySemanticExtraction,
  type MunicipalityGazetteerEntry,
  type MunicipalLotGazetteer,
  type MunicipalZoneGazetteer,
  analyzeZoneGazetteerMatchMode,
  type ZoneGazetteerMatchPolicy,
} from "./lib/pv-graphify-semantic.js";
import { selectBalancedPvControl, selectPvControlBatch } from "./lib/pv-graphify-control.js";
import { readReadyPvRealUniverse } from "./lib/pv-graphify-real-universe.js";
import { parsePvOcrTextArtifact } from "./lib/pv-ocr-artifact.js";
import { extractNativeDocumentText } from "./lib/density-document-review.js";
import { BUCKET, exists, getBytes, objectHead, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const REAL_BATCH_REPORT = /^pv-graphify-semantic-real-universe-\d{8}-batch-\d{2}(?:-part-\d+)?\.json$/u;
const DEFAULT_CLASSIFICATIONS = [1, 2, 3, 4, 5, 6, 7].map((lot) =>
  resolve(ROOT, "work", "coverage", `pv-capture-octets-classification-20260728-campaign-lot-${String(lot).padStart(4, "0")}.json`),
);
const MUNICIPALITIES_PATH = resolve(ROOT, "packages", "geo-sources-americas", "src", "ca-qc", "municipalities", "municipalities.qc.json");
const ZONE_REGISTRY_PATH = resolve(ROOT, "packages", "geo-sources-americas", "src", "ca-qc-zonage-arcgis", "registry.generated.json");
const ZONAGE_RESOLUTION_PATH = resolve(ROOT, "acquisition", "data", "zonage-resolution.json");
const GRAPHIFY_BIN = resolve(ROOT, "node_modules", ".bin", "graphify");
const LOTS_PREFIX = "normalized/qc-lots/qc-lots-";
const LOTS_SUFFIX = ".geojson";
const LOT_NUMBER_FIELDS = ["NO_LOT", "noLot", "no_lot", "lot_id", "lot", "code", "lot_n"];
const ZONE_FIELD_FALLBACKS = ["zone_code", "zonecode", "zonage", "zone", "zonagemunicipal", "zonagemunicipalid", "no_zone", "num_zone", "code_zone", "zoneid", "zonage_id", "zone_no", "numzonage"];

interface ClassificationLine {
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
  readonly storage_key: string;
  readonly classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME";
  /** Durable S3 OCR artefact; absent for the native pdftotext path. */
  readonly ocr_artifact_key?: string;
}

interface RealUniverseSelection {
  readonly candidates: readonly ClassificationLine[];
  readonly initiallyIndexedStorageKeys: ReadonlySet<string>;
  readonly populationStorageKeys: readonly string[];
}

interface ZoneRegistryEntry {
  readonly citySlug: string;
  readonly zoneCodeField: string;
}

interface ZoneGazetteerReport {
  readonly municipality_slug: string;
  readonly matching_mode: "normalized" | "exact";
  readonly zone_code_count: number;
  readonly collision_count: number;
  readonly collision_examples: readonly string[];
  readonly codes: readonly string[];
}

interface LotGazetteerReport {
  readonly municipality_slug: string;
  readonly lot_count: number;
  readonly served: boolean;
  readonly lot_numbers: readonly string[];
}

interface ParsedArgs {
  readonly classifications: readonly string[];
  readonly universe: string | null;
  readonly unverdictList: string | null;
  readonly ocrStage: string | null;
  readonly universeOffset: number;
  readonly universeLimit: number | null;
  readonly unverdictOffset: number;
  readonly unverdictLimit: number | null;
  readonly concurrency: number;
  readonly control: number | null;
  readonly all: boolean;
  readonly storageKeys: readonly string[];
  readonly batchSize: number | null;
  readonly batchIndex: number | null;
  /** Explicit historical index used when a new captured campaign is outside the snapshot population. */
  readonly dedupeSnapshot: string | null;
  readonly output: string;
}

interface ZoneResolutionEntry {
  readonly ville: string;
  readonly collection_id: string | null;
  readonly couche: string | null;
  readonly sample_attr: unknown | null;
}

interface GraphifyRunResult {
  readonly exit_code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly nodes: number;
  readonly edges: number;
}

type DocumentOutcome =
  | "INDEXED"
  | "OWNER_NOT_CONFIRMED"
  | "CONTAMINATION_OWNER_MISMATCH"
  | "GRAPHIFY_FAILED"
  | "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED"
  | "UNKNOWN_NO_TERMINAL_PV_MANIFEST"
  | "UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE";

/** An unavailable source-object read is an operational blocker, never a document verdict. */
class S3CasReadUnavailableError extends Error {
  constructor(storageKey: string, cause: unknown) {
    super(`${storageKey}: lecture S3 indisponible (${cause instanceof Error ? cause.message : String(cause)}); aucun verdict documentaire n'a été produit`);
    this.name = "S3CasReadUnavailableError";
  }
}

interface OwnerScopeReport {
  readonly status: "CONFIRMED" | "NOT_CONFIRMED" | "CONTAMINATION_OWNER_MISMATCH" | "UNAVAILABLE_NO_MUNICIPAL_SCOPE";
  readonly printed_owner_slugs: readonly string[];
}

interface ControlDocumentReport {
  readonly slug: string | null;
  readonly municipality_name: string | null;
  readonly url: string | null;
  readonly storage_key: string;
  readonly source_file: string | null;
  readonly text_provenance: "NATIVE" | "OCR" | "UNAVAILABLE";
  readonly ocr?: {
    readonly artifact_key: string;
    readonly provider: "mistral-ocr";
    readonly methode: string;
    readonly model: string | null;
    readonly billed_pages: number;
    readonly cost_usd: string;
  };
  readonly entity_counts: Readonly<Record<string, number>>;
  readonly entities: Readonly<Record<string, readonly {
    readonly label: string;
    readonly legal_quality?: string;
    readonly citation: {
      readonly source_file: string;
      readonly source_location: string;
      readonly quote: string;
    };
  }[]>>;
  readonly graphify: GraphifyRunResult;
  readonly outcome: DocumentOutcome;
  readonly owner_scope: OwnerScopeReport;
  readonly failure_reason: string | null;
  readonly manual_verification: "UNVERIFIED";
}

interface MatchDetail {
  readonly municipality_slug: string;
  readonly storage_key: string;
  readonly entity_type: "Zone" | "LotCadastre";
  readonly value: string;
  readonly source_file: string;
  readonly source_location: string;
  readonly quote: string;
}

interface MunicipalizeResult {
  readonly zone: MunicipalZoneGazetteer | undefined;
  readonly lot: MunicipalLotGazetteer | undefined;
  readonly zonePolicy: ZoneGazetteerMatchPolicy | null;
  readonly lotServed: boolean;
}

interface UnverdictReadyDocument extends ClassificationLine {
  readonly source_status: "READY";
  readonly source_observations: number;
}

interface UnverdictAbsentScopeDocument {
  readonly storage_key: string;
  readonly source_status: "NO_TERMINAL_PV_MANIFEST" | "AMBIGUOUS_MANIFEST_SCOPE";
  readonly source_observations: number;
}

type UnverdictDocument = UnverdictReadyDocument | UnverdictAbsentScopeDocument;

interface UnverdictList {
  readonly documents: readonly UnverdictDocument[];
}

function usage(): never {
  console.log("Usage: NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 npx tsx src/pv-graphify-semantic-run.ts [--control=N | --all | --storage-key=CAS_KEY] [--classification=PATH --dedupe-snapshot=PATH] [--universe=PATH --universe-offset=N --universe-limit=N | --unverdict-list=PATH --unverdict-offset=N --unverdict-limit=N | --ocr-stage=PATH] [--concurrency=1..4] [--out=PATH]");
  process.exit(0);
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) usage();
  const values = (name: string): string[] => argv
    .filter((argument) => argument.startsWith(`--${name}=`))
    .map((argument) => argument.slice(name.length + 3));
  const controlValue = values("control").at(-1);
  const all = argv.includes("--all");
  const storageKeys = values("storage-key");
  const universeValues = values("universe");
  const unverdictListValues = values("unverdict-list");
  const ocrStageValues = values("ocr-stage");
  if (universeValues.length > 1) throw new Error("--universe ne peut apparaître qu'une fois");
  if (unverdictListValues.length > 1) throw new Error("--unverdict-list ne peut apparaître qu'une fois");
  if (ocrStageValues.length > 1) throw new Error("--ocr-stage ne peut apparaître qu'une fois");
  const universe = universeValues[0] === undefined ? null : resolve(ROOT, universeValues[0]);
  const unverdictList = unverdictListValues[0] === undefined ? null : resolve(ROOT, unverdictListValues[0]);
  const ocrStage = ocrStageValues[0] === undefined ? null : resolve(ROOT, ocrStageValues[0]);
  if (universe !== null && !universe.startsWith(`${ROOT}/`)) throw new Error("--universe doit rester dans le dépôt");
  if (unverdictList !== null && !unverdictList.startsWith(`${ROOT}/`)) throw new Error("--unverdict-list doit rester dans le dépôt");
  if (ocrStage !== null && !ocrStage.startsWith(`${ROOT}/`)) throw new Error("--ocr-stage doit rester dans le dépôt");
  const universeOffsetValue = values("universe-offset").at(-1);
  const universeLimitValue = values("universe-limit").at(-1);
  const unverdictOffsetValue = values("unverdict-offset").at(-1);
  const unverdictLimitValue = values("unverdict-limit").at(-1);
  const universeOffset = universeOffsetValue === undefined ? 0 : Number(universeOffsetValue);
  const universeLimit = universeLimitValue === undefined ? null : Number(universeLimitValue);
  const unverdictOffset = unverdictOffsetValue === undefined ? 0 : Number(unverdictOffsetValue);
  const unverdictLimit = unverdictLimitValue === undefined ? null : Number(unverdictLimitValue);
  const concurrency = Number(values("concurrency").at(-1) ?? "1");
  if (!Number.isInteger(universeOffset) || universeOffset < 0) throw new Error("--universe-offset doit être un entier positif ou nul");
  if (universeLimit !== null && (!Number.isInteger(universeLimit) || universeLimit < 1)) {
    throw new Error("--universe-limit doit être un entier positif");
  }
  if (universe === null && (universeOffsetValue !== undefined || universeLimitValue !== undefined)) {
    throw new Error("--universe-offset et --universe-limit exigent --universe");
  }
  if (unverdictList === null && (unverdictOffsetValue !== undefined || unverdictLimitValue !== undefined)) {
    throw new Error("--unverdict-offset et --unverdict-limit exigent --unverdict-list");
  }
  if (!Number.isInteger(unverdictOffset) || unverdictOffset < 0) throw new Error("--unverdict-offset doit être un entier positif ou nul");
  if (unverdictLimit !== null && (!Number.isInteger(unverdictLimit) || unverdictLimit < 1)) {
    throw new Error("--unverdict-limit doit être un entier positif");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("--concurrency doit être un entier de 1 à 4");
  }
  if (storageKeys.some((key) => !key)) throw new Error("--storage-key doit être une clé CAS non vide");
  if (new Set(storageKeys).size !== storageKeys.length) throw new Error("--storage-key ne peut pas être répété");
  if ((universe !== null || unverdictList !== null) && (values("classification").length > 0 || storageKeys.length > 0 || all || controlValue !== undefined)) {
    throw new Error("--universe et --unverdict-list sont exclusifs de --classification, --storage-key, --all et --control");
  }
  if (universe !== null && unverdictList !== null) throw new Error("--universe et --unverdict-list sont exclusifs");
  if (ocrStage !== null && (universe !== null || unverdictList !== null || values("classification").length > 0 || storageKeys.length > 0 || all || controlValue !== undefined || universeOffsetValue !== undefined || universeLimitValue !== undefined || unverdictOffsetValue !== undefined || unverdictLimitValue !== undefined)) {
    throw new Error("--ocr-stage est exclusif de --universe, --unverdict-list, --classification, --storage-key, --all, --control et des offsets");
  }
  if (storageKeys.length > 0 && (all || controlValue !== undefined)) {
    throw new Error("--storage-key est exclusif de --all et --control");
  }
  const control = storageKeys.length > 0 || ocrStage !== null ? null : (controlValue === undefined ? 20 : Number(controlValue));
  if (control !== null && (!Number.isInteger(control) || control < 1)) throw new Error("--control doit être un entier positif");
  if (all && values("control").length > 0) throw new Error("--all et --control sont exclusifs");
  const batchSizeValue = values("batch-size").at(-1);
  const batchIndexValue = values("batch-index").at(-1);
  const dedupeSnapshotValues = values("dedupe-snapshot");
  if (dedupeSnapshotValues.length > 1) throw new Error("--dedupe-snapshot ne peut apparaître qu'une fois");
  const dedupeSnapshot = dedupeSnapshotValues[0] === undefined ? null : resolve(ROOT, dedupeSnapshotValues[0]);
  if (dedupeSnapshot !== null && !dedupeSnapshot.startsWith(`${ROOT}/`)) {
    throw new Error("--dedupe-snapshot doit rester dans le dépôt");
  }
  const batchSize = batchSizeValue === undefined ? null : Number(batchSizeValue);
  const batchIndex = batchIndexValue === undefined ? null : Number(batchIndexValue);
  if (batchSize !== null && (!all || !Number.isInteger(batchSize) || batchSize < 1)) {
    throw new Error("--batch-size exige --all et un entier positif");
  }
  if (batchIndex !== null && (batchSize === null || !Number.isInteger(batchIndex) || batchIndex < 1)) {
    throw new Error("--batch-index exige --batch-size et un entier positif");
  }
  const outputValue = values("out").at(-1);
  const timestamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..+/u, "Z");
  return {
    classifications: values("classification").map((path) => resolve(ROOT, path)),
    universe,
    unverdictList,
    ocrStage,
    universeOffset,
    universeLimit,
    unverdictOffset,
    unverdictLimit,
    concurrency,
    control: universe === null && unverdictList === null && ocrStage === null ? (all ? null : control) : null,
    all,
    storageKeys,
    batchSize,
    batchIndex,
    dedupeSnapshot,
    output: resolve(ROOT, outputValue ?? `work/coverage/pv-graphify-semantic-${timestamp}.json`),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}.${key} doit être une chaîne non vide`);
  return value.trim();
}

function readClassificationLines(path: string): ClassificationLine[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw) || !Array.isArray(raw.lines)) throw new Error(`rapport de classification invalide: ${path}`);
  const eligible: ClassificationLine[] = [];
  for (const [index, value] of raw.lines.entries()) {
    if (!isRecord(value) || value.classification !== "PV_LISIBLE_PROPRIETAIRE_CONFIRME") continue;
    const where = `${path}.lines[${index}]`;
    eligible.push({
      slug: requiredString(value, "slug", where),
      municipality_name: requiredString(value, "municipality_name", where),
      url: requiredString(value, "url", where),
      storage_key: requiredString(value, "storage_key", where),
      classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME",
    });
  }
  return eligible;
}

/**
 * An OCR stage is an explicit, bounded list of immutable CAS keys.  It is not
 * a new eligibility classification: a document reaches this branch only after
 * the separately authorised OCR runner wrote its durable S3 text artefact.
 */
function readOcrStage(path: string): ClassificationLine[] {
  const raw = readSmallJson(path);
  if (!isRecord(raw) || raw.contract !== "pv-ocr-stage/v1" || !Array.isArray(raw.documents)) {
    throw new Error(`stage OCR invalide: ${path}`);
  }
  const selected: ClassificationLine[] = [];
  for (const [index, value] of raw.documents.entries()) {
    if (!isRecord(value)) throw new Error(`${path}.documents[${index}] invalide`);
    const outcome = requiredString(value, "outcome", `${path}.documents[${index}]`);
    if (outcome !== "OCR_COMPLETED" && outcome !== "ALREADY_OCRD") continue;
    selected.push({
      slug: requiredString(value, "slug", `${path}.documents[${index}]`),
      municipality_name: requiredString(value, "municipality_name", `${path}.documents[${index}]`),
      url: requiredString(value, "url", `${path}.documents[${index}]`),
      storage_key: requiredString(value, "storage_key", `${path}.documents[${index}]`),
      classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME",
      ocr_artifact_key: requiredString(value, "ocr_artifact_key", `${path}.documents[${index}]`),
    });
  }
  if (selected.length === 0) throw new Error(`stage OCR sans document complété: ${path}`);
  return selected;
}

/** Read the committed S3-CAS universe without treating it as a classification. */
function readSmallJson(path: string): unknown {
  const { size } = statSync(path);
  if (size > MAX_REPORT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture ${MAX_REPORT_BYTES}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function readRealUniverseBatch(path: string): RealUniverseSelection {
  const raw = readSmallJson(path);
  const candidates = readReadyPvRealUniverse(raw, path).map((document) => ({
    ...document,
    classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME" as const,
  }));
  if (!isRecord(raw)) throw new Error(`univers PV réel invalide: ${path}`);
  const indexedGraph = raw.indexed_graph;
  if (!isRecord(indexedGraph) || !Array.isArray(indexedGraph.storage_keys)) {
    throw new Error(`univers PV réel sans clés déjà indexées: ${path}`);
  }
  const initiallyIndexedStorageKeys = new Set<string>();
  for (const [index, value] of indexedGraph.storage_keys.entries()) {
    if (typeof value !== "string" || !value) throw new Error(`${path}.indexed_graph.storage_keys[${index}] invalide`);
    initiallyIndexedStorageKeys.add(value);
  }
  const realUniverse = raw.real_universe;
  if (!isRecord(realUniverse) || !Array.isArray(realUniverse.documents)) {
    throw new Error(`univers PV réel sans documents: ${path}`);
  }
  const populationStorageKeys = new Set(initiallyIndexedStorageKeys);
  for (const [index, value] of realUniverse.documents.entries()) {
    if (!isRecord(value)) throw new Error(`${path}.real_universe.documents[${index}] invalide`);
    populationStorageKeys.add(requiredString(value, "storage_key", `${path}.real_universe.documents[${index}]`));
  }
  const population = raw.population;
  if (!isRecord(population) || typeof population.unique_cas_keys !== "number" || !Number.isInteger(population.unique_cas_keys) || population.unique_cas_keys < 1) {
    throw new Error(`population CAS invalide: ${path}`);
  }
  if (populationStorageKeys.size !== population.unique_cas_keys) {
    throw new Error(`population CAS non réconciliée: ${populationStorageKeys.size}/${population.unique_cas_keys} dans ${path}`);
  }
  return {
    candidates,
    initiallyIndexedStorageKeys,
    populationStorageKeys: [...populationStorageKeys].sort((left, right) => left.localeCompare(right)),
  };
}

function isUnverdictReadyDocument(document: UnverdictDocument): document is UnverdictReadyDocument {
  return document.source_status === "READY";
}

/**
 * Read the committed, CAS-keyed queue left after the initial universe sweep.
 * Non-READY keys deliberately remain in the selection so the report can give
 * their documented lack of municipal scope an explicit terminal verdict.
 */
function readUnverdictList(path: string): UnverdictList {
  const raw = readSmallJson(path);
  if (!isRecord(raw) || raw.contract !== "pv-graphify-semantic-unverdict-list/v1") {
    throw new Error(`liste sans verdict invalide: ${path}`);
  }
  const documents = raw.documents;
  if (!Array.isArray(documents) || documents.length === 0) throw new Error(`liste sans verdict vide: ${path}`);
  const seen = new Set<string>();
  const selected: UnverdictDocument[] = [];
  for (const [index, rawDocument] of documents.entries()) {
    if (!isRecord(rawDocument)) throw new Error(`${path}.documents[${index}] invalide`);
    const where = `${path}.documents[${index}]`;
    const storageKey = requiredString(rawDocument, "storage_key", where);
    if (!/^raw\/pv-index\/cas\/[a-f0-9]{64}\.pdf$/u.test(storageKey)) throw new Error(`${where}.storage_key invalide`);
    if (seen.has(storageKey)) throw new Error(`${path}: clé CAS dupliquée ${storageKey}`);
    seen.add(storageKey);
    const sourceStatus = requiredString(rawDocument, "source_status", where);
    const sourceObservations = rawDocument.source_observations;
    if (!Number.isInteger(sourceObservations) || typeof sourceObservations !== "number" || sourceObservations < 0) {
      throw new Error(`${where}.source_observations invalide`);
    }
    if (sourceStatus === "READY") {
      selected.push({
        storage_key: storageKey,
        slug: requiredString(rawDocument, "slug", where),
        municipality_name: requiredString(rawDocument, "municipality_name", where),
        url: requiredString(rawDocument, "url", where),
        classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME",
        source_status: "READY",
        source_observations: sourceObservations,
      });
      continue;
    }
    if (sourceStatus === "NO_TERMINAL_PV_MANIFEST" || sourceStatus === "AMBIGUOUS_MANIFEST_SCOPE") {
      selected.push({ storage_key: storageKey, source_status: sourceStatus, source_observations: sourceObservations });
      continue;
    }
    throw new Error(`${where}.source_status invalide: ${sourceStatus}`);
  }
  return { documents: selected };
}

function explicitScopeAbsence(document: UnverdictAbsentScopeDocument): ControlDocumentReport {
  const noTerminalManifest = document.source_status === "NO_TERMINAL_PV_MANIFEST";
  return {
    slug: null,
    municipality_name: null,
    url: null,
    storage_key: document.storage_key,
    source_file: null,
    text_provenance: "UNAVAILABLE",
    entity_counts: {},
    entities: {},
    graphify: {
      exit_code: 2,
      stdout: "",
      stderr: noTerminalManifest
        ? "Aucun manifeste PV terminal ne donne de scope municipal; lecture du PDF interdite."
        : "Les manifestes PV donnent des scopes municipaux incompatibles; lecture du PDF hors scope interdite.",
      nodes: 0,
      edges: 0,
    },
    outcome: noTerminalManifest ? "UNKNOWN_NO_TERMINAL_PV_MANIFEST" : "UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE",
    owner_scope: { status: "UNAVAILABLE_NO_MUNICIPAL_SCOPE", printed_owner_slugs: [] },
    failure_reason: noTerminalManifest
      ? `Aucun manifeste PV terminal (observations: ${document.source_observations}); aucun scope municipal n'est prouvé.`
      : `Scope municipal ambigu entre manifestes terminaux (observations: ${document.source_observations}); aucun scope municipal n'est prouvé.`,
    manual_verification: "UNVERIFIED",
  };
}

function indexedStorageKeysFromExistingReports(): Set<string> {
  const indexed = new Set<string>();
  const reports = readdirSync(COVERAGE)
    .filter((name) => REAL_BATCH_REPORT.test(name))
    .sort((left, right) => left.localeCompare(right));
  for (const name of reports) {
    const path = resolve(COVERAGE, name);
    const value = readSmallJson(path);
    if (!isRecord(value) || value.contract !== "pv-graphify-semantic-control/v1" || !Array.isArray(value.documents)) {
      throw new Error(`rapport Graphify réel invalide: ${path}`);
    }
    for (const [index, document] of value.documents.entries()) {
      if (!isRecord(document) || document.outcome !== "INDEXED") continue;
      indexed.add(requiredString(document, "storage_key", `${path}.documents[${index}]`));
    }
  }
  return indexed;
}

/**
 * A capture campaign added after the durable CAS snapshot must still reject
 * every key already indexed by either of the two complete historical sources:
 * the snapshot's indexed graph and every real-universe batch report.
 */
function indexedStorageKeysForExternalCampaign(snapshotPath: string): Set<string> {
  const snapshot = readSmallJson(snapshotPath);
  if (!isRecord(snapshot) || snapshot.contract !== "pv-graphify-semantic-real-universe/v1") {
    throw new Error(`snapshot de dédoublage invalide: ${snapshotPath}`);
  }
  const indexedGraph = snapshot.indexed_graph;
  if (!isRecord(indexedGraph) || !Array.isArray(indexedGraph.storage_keys)) {
    throw new Error(`snapshot de dédoublage sans indexed_graph.storage_keys: ${snapshotPath}`);
  }
  const indexed = new Set<string>();
  for (const [index, value] of indexedGraph.storage_keys.entries()) {
    if (typeof value !== "string" || !/^raw\/pv-index\/cas\/[a-f0-9]{64}\.(?:pdf|html|bin)$/u.test(value)) {
      throw new Error(`${snapshotPath}.indexed_graph.storage_keys[${index}] invalide`);
    }
    indexed.add(value);
  }
  for (const key of indexedStorageKeysFromExistingReports()) indexed.add(key);
  return indexed;
}

function uniqueEligible(lines: readonly ClassificationLine[]): ClassificationLine[] {
  const byObject = new Map<string, ClassificationLine>();
  for (const line of lines) {
    if (!byObject.has(line.storage_key)) byObject.set(line.storage_key, line);
  }
  return [...byObject.values()].sort((left, right) =>
    left.slug.localeCompare(right.slug) || left.storage_key.localeCompare(right.storage_key));
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
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

function selectControl(lines: readonly ClassificationLine[], count: number): ClassificationLine[] {
  return selectBalancedPvControl(lines, count);
}

function selectStorageKeys(lines: readonly ClassificationLine[], storageKeys: readonly string[]): ClassificationLine[] {
  const requested = new Set(storageKeys);
  const selected = lines.filter((line) => requested.has(line.storage_key));
  const found = new Set(selected.map((line) => line.storage_key));
  const missing = storageKeys.filter((storageKey) => !found.has(storageKey));
  if (missing.length > 0) throw new Error(`--storage-key absent de l'univers PV confirmé: ${missing.join(", ")}`);
  return selected;
}

function readMunicipalities(path: string): MunicipalityGazetteerEntry[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`gazetteer municipal invalide: ${path}`);
  return raw.map((value, index) => {
    if (!isRecord(value)) throw new Error(`gazetteer municipal invalide à l'index ${index}`);
    return {
      slug: requiredString(value, "slug", `gazetteer[${index}]`),
      name: requiredString(value, "name", `gazetteer[${index}]`),
    };
  });
}

function readZoneRegistry(path: string): ZoneRegistryEntry[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`registry de zones invalide: ${path}`);
  const entries: ZoneRegistryEntry[] = [];
  for (const [index, value] of raw.entries()) {
    if (!isRecord(value)) throw new Error(`registry de zones invalide à l'index ${index}`);
    entries.push({
      citySlug: requiredString(value, "citySlug", `registry[${index}]`),
      zoneCodeField: requiredString(value, "zoneCodeField", `registry[${index}]`),
    });
  }
  return entries;
}

function readZoneResolution(path: string): ReadonlyMap<string, ZoneResolutionEntry> {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`zonage-resolution invalide: ${path}`);
  const entries = new Map<string, ZoneResolutionEntry>();
  for (const [index, value] of raw.entries()) {
    if (!isRecord(value)) throw new Error(`zonage-resolution invalide à l'index ${index}`);
    const city = requiredString(value, "ville", `zonage-resolution[${index}]`);
    const collectionId = (() => {
      const rawCollectionId = value.collection_id;
      return rawCollectionId === null || rawCollectionId === undefined ? null : requiredString(value, "collection_id", `zonage-resolution[${index}]`);
    })();
    const couche = value.couche === null || value.couche === undefined
      ? null
      : requiredString(value, "couche", `zonage-resolution[${index}]`);
    const sampleAttr = value.sample_attr === undefined || value.sample_attr === null ? null : value.sample_attr;
    entries.set(city, {
      ville: city,
      collection_id: collectionId,
      couche: couche,
      sample_attr: sampleAttr,
    });
  }
  return entries;
}

function fieldCanonical(field: string): string {
  return field
    .normalize("NFKC")
    .toLocaleLowerCase("fr-CA")
    .replace(/[^a-z0-9]+/gu, "")
    .trim();
}

function zoneCodeLooksValid(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 50) return false;
  if (!/[A-Za-z]/u.test(trimmed)) return false;
  if (!/\d/u.test(trimmed)) return false;
  return true;
}

function zoneCodeFieldFromResolution(slug: string, resolutions: ReadonlyMap<string, ZoneResolutionEntry>): string | null {
  const entry = resolutions.get(slug);
  if (!entry || typeof entry.sample_attr !== "object" || entry.sample_attr === null) {
    return null;
  }
  const sample = entry.sample_attr as Record<string, unknown>;
  for (const [field, value] of Object.entries(sample)) {
    if (zoneCodeLooksValid(value) && fieldCanonical(field) !== "") {
      return field;
    }
  }
  return null;
}

function isZoneLikeField(field: string): boolean {
  const normalized = fieldCanonical(field);
  return normalized === "zonecode" || normalized === "zone"
    || normalized === "zonage" || normalized === "zonagemunicipal" || normalized === "zonagemunicipalid"
    || normalized === "nozone" || normalized === "numzone" || normalized === "codezone"
    || normalized === "zoneid" || normalized === "zonageid"
    || ZONE_FIELD_FALLBACKS.some((candidate) => normalized === fieldCanonical(candidate));
}

function assertS3RunEnvironment(): void {
  if (!process.env.NODE_OPTIONS?.split(/\s+/u).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env.AWS_MAX_ATTEMPTS !== "10") {
    throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

function isS3ReadUnavailable(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const metadata = error.$metadata;
  if (isRecord(metadata) && metadata.httpStatusCode === 403) return true;
  if (error.name === "UnknownError") return true;
  return error.$response !== undefined
    && isRecord(error.$response)
    && error.$response.statusCode === 403;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function emitDigits(value: string): string | null {
  const digits = value.replace(/\D/gu, "").trim();
  return digits ? digits : null;
}

async function* streamObjectParts(s3: S3Client, key: string): AsyncGenerator<Buffer> {
  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = response.Body as AsyncIterable<Buffer> | undefined;
  if (!body) return;
  for await (const chunk of body) {
    yield Buffer.from(chunk);
  }
}

/**
 * Parse a FeatureCollection stream and extract each feature's properties without
 * materialising the full object in memory.
 */
async function collectFeatureProperties(
  s3: S3Client,
  key: string,
  onFeature: (properties: Record<string, unknown>) => void,
): Promise<void> {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let expectingPropertyKey = false;
  let stringBuffer = "";
  let stringIsKey = false;
  let awaitingFeaturesColon = false;
  let awaitingFeaturesArray = false;
  let inFeatures = false;
  let featureDepth = 0;
  let featureBuffer = "";
  let featureInString = false;
  let featureEscaped = false;
  let started = false;

  for await (const chunk of streamObjectParts(s3, key)) {
    const text = chunk.toString("utf8");
    for (let index = 0; index < text.length; index++) {
      const char = text[index]!;

      if (!inFeatures) {
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === "\"") {
            inString = false;
            const token = stringBuffer;
            stringBuffer = "";
            if (stringIsKey && !awaitingFeaturesColon && !awaitingFeaturesArray && depth === 1 && token === "features") {
              awaitingFeaturesColon = true;
            }
            stringIsKey = false;
          } else {
            stringBuffer += char;
          }
          continue;
        }

        if (/^\s$/u.test(char)) {
          continue;
        }

        if (awaitingFeaturesColon) {
          if (char === ":") {
            awaitingFeaturesColon = false;
            awaitingFeaturesArray = true;
            continue;
          }
          if (!/\s/u.test(char)) awaitingFeaturesColon = false;
          else continue;
        }

        if (awaitingFeaturesArray) {
          if (char === "[") {
            awaitingFeaturesArray = false;
            inFeatures = true;
            featureDepth = 0;
            featureBuffer = "";
            started = true;
            continue;
          }
          if (!/\s/u.test(char)) awaitingFeaturesArray = false;
          continue;
        }

        if (char === "{") {
          depth++;
          expectingPropertyKey = true;
          continue;
        }
        if (char === "}") {
          if (depth > 0) depth--;
          expectingPropertyKey = depth > 0;
          continue;
        }
        if (char === ",") {
          expectingPropertyKey = depth > 0;
          continue;
        }
        if (char === ":") {
          expectingPropertyKey = false;
          continue;
        }
        if (char === "\"") {
          inString = true;
          stringIsKey = expectingPropertyKey;
          stringBuffer = "";
          escaped = false;
          continue;
        }
        continue;
      }

      if (featureDepth === 0) {
        if (/^\s$/u.test(char) || char === ",") {
          continue;
        }
        if (char === "]") {
          return;
        }
        if (char === "{") {
          featureDepth = 1;
          featureBuffer = "{";
          featureInString = false;
          featureEscaped = false;
          continue;
        }
        continue;
      }

      featureBuffer += char;
      if (featureInString) {
        if (featureEscaped) {
          featureEscaped = false;
          continue;
        }
        if (char === "\\") {
          featureEscaped = true;
          continue;
        }
        if (char === "\"") {
          featureInString = false;
          continue;
        }
        continue;
      }

      if (char === "\"") {
        featureInString = true;
        featureEscaped = false;
        continue;
      }
      if (char === "{") featureDepth++;
      else if (char === "}") {
        featureDepth--;
        if (featureDepth === 0) {
          const parsed = JSON.parse(featureBuffer) as unknown;
          const feature = isRecord(parsed) ? parsed : null;
          const props = isRecord(feature?.properties) ? feature.properties : null;
          if (props) onFeature(props);
          featureBuffer = "";
          continue;
        }
      }
    }
  }

  if (!started) {
    throw new Error(`Collection non reconnue (tableau de features introuvable): ${key}`);
  }
}

async function textFromCapturedDocument(document: ClassificationLine): Promise<string> {
  const s3 = s3Client();
  const head = await objectHead(s3, document.storage_key);
  if (!head.exists || head.contentLength === undefined || head.contentLength > MAX_REPORT_BYTES) {
    throw new Error(`${document.storage_key}: octets source absents, taille inconnue ou > 5 MiB`);
  }
  const native = extractNativeDocumentText(await getBytes(s3, document.storage_key), { sourceName: document.url });
  if (native.text === null) throw new Error(native.blocker ?? `${document.storage_key}: texte natif absent`);
  return native.text;
}

function servedZoneKeys(slug: string): string[] {
  const name = `qc-zonage-${slug}.geojson`;
  return [
    `normalized/ca-qc-zonage/qc-zonage-${slug}/${name}`,
    `normalized/ca-qc-zonage/${name}`,
  ];
}

function normalizeZoneCodeFromSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function normalizeLotFromSource(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    return String(value);
  }
  if (typeof value !== "string") return null;
  return value.trim() ? emitDigits(value) : null;
}

async function materializeZoneCodesByField(
  s3: S3Client,
  key: string,
  fields: ReadonlySet<string>,
): Promise<string[]> {
  const values = new Set<string>();
  await collectFeatureProperties(s3, key, (properties) => {
    for (const field of fields) {
      const value = normalizeZoneCodeFromSource(properties[field]);
      if (value) values.add(value);
    }
  });
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function materializeLotNumbers(s3: S3Client, key: string): Promise<string[]> {
  const lots = new Set<string>();
  await collectFeatureProperties(s3, key, (properties) => {
    for (const field of LOT_NUMBER_FIELDS) {
      const value = normalizeLotFromSource(properties[field]);
      if (!value) continue;
      lots.add(value);
    }
  });
  return [...lots].sort((left, right) => left.localeCompare(right));
}

async function materializeMunicipalZoneGazetteer(
  s3: S3Client,
  slug: string,
  registry: readonly ZoneRegistryEntry[],
  resolutions: ReadonlyMap<string, ZoneResolutionEntry>,
): Promise<{
  gazetteer: MunicipalZoneGazetteer | undefined;
  policy: ZoneGazetteerMatchPolicy | null;
}> {
  const fields = new Set(registry.filter((entry) => entry.citySlug === slug).map((entry) => entry.zoneCodeField));
  const resolvedByResolution = zoneCodeFieldFromResolution(slug, resolutions);
  if (fields.size === 0 && resolvedByResolution !== null) fields.add(resolvedByResolution);
  let key: string | null = null;
  for (const candidate of servedZoneKeys(slug)) {
    try {
      const ok = await exists(s3, candidate);
      if (ok) {
        key = candidate;
        break;
      }
    } catch {
      // HEAD-only availability probe may fail for transient network states.
    }
  }
  if (!key) return { gazetteer: undefined, policy: null };
  if (fields.size === 0) {
    const fallback = await inferZoneCodeFieldFromCollection(s3, key);
    if (!fallback) return { gazetteer: undefined, policy: null };
    fields.add(fallback);
  }
  let codes = await materializeZoneCodesByField(s3, key, fields);
  if (codes.length === 0 && fields.size > 0) {
    const fallback = await inferZoneCodeFieldFromCollection(s3, key);
    if (fallback) {
      fields.clear();
      fields.add(fallback);
      codes = await materializeZoneCodesByField(s3, key, fields);
    }
  }
  if (codes.length === 0) return { gazetteer: undefined, policy: null };
  const policy = analyzeZoneGazetteerMatchMode(codes);
  return {
    gazetteer: { municipality_slug: slug, codes, zone_code_matching: policy.mode },
    policy,
  };
}

async function inferZoneCodeFieldFromCollection(s3: S3Client, key: string): Promise<string | null> {
  const stats = new Map<string, { present: number; zoneLike: number }>();
  let features = 0;
  await collectFeatureProperties(s3, key, (properties) => {
    features += 1;
    for (const [field, raw] of Object.entries(properties)) {
      const value = normalizeZoneCodeFromSource(raw);
      if (!value) continue;
      const item = stats.get(field) ?? { present: 0, zoneLike: 0 };
      item.present += 1;
      if (zoneCodeLooksValid(value)) item.zoneLike += 1;
      stats.set(field, item);
    }
  });
  const candidates = [...stats.entries()]
    .filter(([, values]) => values.zoneLike > 0)
    .filter(([field]) => isZoneLikeField(field));
  if (candidates.length === 0) return null;
  if (stats.has("zone_code")) {
    const direct = "zone_code";
    const directStats = stats.get(direct);
    if (directStats && directStats.zoneLike > 0) return direct;
  }
  const prioritized = [...candidates]
    .map(([field, values]) => ({
      field,
      zoneLike: values.zoneLike,
      ratio: values.zoneLike / Math.max(features, 1),
      present: values.present,
    }))
    .sort((left, right) => (right.zoneLike - left.zoneLike) || (right.present - left.present) || left.field.localeCompare(right.field));
  return prioritized[0]?.field ?? null;
}

async function materializeMunicipalLotGazetteer(
  s3: S3Client,
  slug: string,
): Promise<{ gazetteer: MunicipalLotGazetteer | undefined; served: boolean }> {
  const key = `${LOTS_PREFIX}${slug}${LOTS_SUFFIX}`;
  const served = await exists(s3, key);
  if (!served) return { gazetteer: undefined, served: false };
  const lotNumbers = await materializeLotNumbers(s3, key);
  if (lotNumbers.length === 0) return { gazetteer: undefined, served: true };
  return { gazetteer: { municipality_slug: slug, lot_numbers: lotNumbers }, served: true };
}

async function runGraphify(inputDirectory: string, semanticPath: string, outputDirectory: string): Promise<GraphifyRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(GRAPHIFY_BIN, [
      "extract",
      "--semantic", semanticPath,
      "--out", outputDirectory,
      "--no-cluster",
      "--no-label",
      "--no-description",
      inputDirectory,
    ], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const count = /—\s+(\d+) nodes,\s+(\d+) edges/u.exec(stdout);
    return {
      exit_code: 0,
      stdout: stdout.slice(-4000),
      stderr: stderr.slice(-4000),
      nodes: count ? Number(count[1]) : 0,
      edges: count ? Number(count[2]) : 0,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { exit_code: 1, stdout: "", stderr: message.slice(-4000), nodes: 0, edges: 0 };
  }
}

function reportEntities(extraction: GraphifySemanticExtraction): ControlDocumentReport["entities"] {
  const byType: Record<string, Array<{
    label: string;
    legal_quality?: string;
    citation: { source_file: string; source_location: string; quote: string };
  }>> = {};
  for (const entity of extraction.nodes) {
    const first = entity.citations[0];
    if (!first) continue;
    const bucket = byType[entity.node_type] ?? [];
    bucket.push({
      label: entity.label,
      ...(entity.legal_quality ? { legal_quality: entity.legal_quality } : {}),
      citation: {
        source_file: first.source_file,
        source_location: first.source_location,
        quote: first.quote,
      },
    });
    byType[entity.node_type] = bucket;
  }
  return byType;
}

function reportCounts(extraction: GraphifySemanticExtraction): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entity of extraction.nodes) counts[entity.node_type] = (counts[entity.node_type] ?? 0) + 1;
  return counts;
}

interface MaterializedText {
  readonly text: string;
  readonly source_file: "document.txt" | "document.ocr.txt";
  readonly text_provenance: "NATIVE" | "OCR";
  readonly ocr?: ControlDocumentReport["ocr"];
}

async function textFromOcrArtifact(document: ClassificationLine): Promise<MaterializedText> {
  const artifactKey = document.ocr_artifact_key;
  if (!artifactKey) throw new Error("artefact OCR absent");
  const s3 = s3Client();
  const head = await objectHead(s3, artifactKey);
  if (!head.exists || head.contentLength === undefined || head.contentLength > MAX_REPORT_BYTES) {
    throw new Error(`${artifactKey}: artefact OCR absent, taille inconnue ou > 5 MiB`);
  }
  const artifact = parsePvOcrTextArtifact(JSON.parse((await getBytes(s3, artifactKey)).toString("utf8")), artifactKey);
  if (artifact.source.storage_key !== document.storage_key || artifact.source.slug !== document.slug) {
    throw new Error(`${artifactKey}: source OCR hors scope du document demandé`);
  }
  if (artifact.source.url !== document.url || artifact.source.municipality_name !== document.municipality_name) {
    throw new Error(`${artifactKey}: métadonnées source OCR non réconciliées`);
  }
  return {
    text: artifact.text,
    source_file: "document.ocr.txt",
    text_provenance: "OCR",
    ocr: {
      artifact_key: artifactKey,
      provider: "mistral-ocr",
      methode: artifact.ocr.methode,
      model: artifact.ocr.model,
      billed_pages: artifact.ocr.billed_pages,
      cost_usd: artifact.ocr.cost_usd,
    },
  };
}

async function processDocument(
  document: ClassificationLine,
  municipalities: readonly MunicipalityGazetteerEntry[],
  gazetteer: MunicipalizeResult,
  workspace: string,
): Promise<ControlDocumentReport> {
  try {
    const documentDirectory = resolve(workspace, document.slug, document.storage_key.slice(-16));
    const inputDirectory = resolve(documentDirectory, "input");
    mkdirSync(inputDirectory, { recursive: true });
    const materialized: MaterializedText = document.ocr_artifact_key === undefined
      ? await (async (): Promise<MaterializedText> => {
        return {
          text: await textFromCapturedDocument(document),
          source_file: "document.txt",
          text_provenance: "NATIVE",
        };
      })()
      : await textFromOcrArtifact(document);
    const textPath = resolve(inputDirectory, materialized.source_file);
    writeFileSync(textPath, materialized.text, "utf8");
    const printedOwnerSlugs = printedMunicipalityOwners(materialized.text, municipalities)
      .map((municipality) => municipality.slug)
      .sort((left, right) => left.localeCompare(right));
    const ownerScope: OwnerScopeReport = printedOwnerSlugs.includes(document.slug)
      ? { status: "CONFIRMED", printed_owner_slugs: printedOwnerSlugs }
      : printedOwnerSlugs.length > 0
        ? { status: "CONTAMINATION_OWNER_MISMATCH", printed_owner_slugs: printedOwnerSlugs }
        : { status: "NOT_CONFIRMED", printed_owner_slugs: [] };
    // Owner scope is a precondition, not a post-hoc label on a Graphify
    // result.  A foreign or unproven owner must never materialize semantic
    // entities, even locally, because a later aggregation could otherwise
    // mistake successful Graphify output for an indexed PV.
    if (ownerScope.status !== "CONFIRMED") {
      const outcome: DocumentOutcome = ownerScope.status === "CONTAMINATION_OWNER_MISMATCH"
        ? "CONTAMINATION_OWNER_MISMATCH"
        : "OWNER_NOT_CONFIRMED";
      return {
        slug: document.slug,
        municipality_name: document.municipality_name,
        url: document.url,
        storage_key: document.storage_key,
        source_file: materialized.source_file,
        text_provenance: materialized.text_provenance,
        ...(materialized.ocr ? { ocr: materialized.ocr } : {}),
        entity_counts: {},
        entities: {},
        graphify: {
          exit_code: 0,
          stdout: "",
          stderr: "Graphify non lancé: le propriétaire imprimé ne confirme pas le scope municipal.",
          nodes: 0,
          edges: 0,
        },
        outcome,
        owner_scope: ownerScope,
        failure_reason: null,
        manual_verification: "UNVERIFIED",
      };
    }
    const semantic = extractPvSemantic({
      source_file: materialized.source_file,
      source_id: document.storage_key,
      source_url: document.url,
      municipality_slug: document.slug,
      text: materialized.text,
    }, municipalities, gazetteer.zone, gazetteer.lot);
    const semanticPath = resolve(documentDirectory, "semantic.json");
    writeAtomic(semanticPath, semantic);
    const graphify = await runGraphify(inputDirectory, semanticPath, documentDirectory);
    const outcome: DocumentOutcome = graphify.exit_code !== 0
      ? "GRAPHIFY_FAILED"
      : graphify.nodes > 0
        ? "INDEXED"
        : "GRAPHIFY_FAILED";
    return {
      slug: document.slug,
      municipality_name: document.municipality_name,
      url: document.url,
      storage_key: document.storage_key,
      source_file: materialized.source_file,
      text_provenance: materialized.text_provenance,
      ...(materialized.ocr ? { ocr: materialized.ocr } : {}),
      entity_counts: reportCounts(semantic),
      entities: reportEntities(semantic),
      graphify,
      outcome,
      owner_scope: ownerScope,
      failure_reason: outcome === "GRAPHIFY_FAILED"
        ? (graphify.stderr || "Graphify a produit zéro nœud malgré un propriétaire confirmé")
        : null,
      manual_verification: "UNVERIFIED",
    };
  } catch (error: unknown) {
    if (isS3ReadUnavailable(error)) throw new S3CasReadUnavailableError(document.storage_key, error);
    const message = error instanceof Error ? error.message : String(error);
    return {
      slug: document.slug,
      municipality_name: document.municipality_name,
      url: document.url,
      storage_key: document.storage_key,
      source_file: document.ocr_artifact_key ? "document.ocr.txt" : "document.txt",
      text_provenance: document.ocr_artifact_key ? "OCR" : "NATIVE",
      entity_counts: {},
      entities: {},
      graphify: { exit_code: 1, stdout: "", stderr: message.slice(-4000), nodes: 0, edges: 0 },
      outcome: "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED",
      owner_scope: { status: "NOT_CONFIRMED", printed_owner_slugs: [] },
      failure_reason: message.slice(-4000),
      manual_verification: "UNVERIFIED",
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const realUniverse = args.universe === null ? null : readRealUniverseBatch(args.universe);
  const unverdictList = args.unverdictList === null ? null : readUnverdictList(args.unverdictList);
  const ocrStage = args.ocrStage === null ? null : readOcrStage(args.ocrStage);
  const paths = args.universe === null && args.unverdictList === null
    ? (args.ocrStage === null ? (args.classifications.length > 0 ? args.classifications : DEFAULT_CLASSIFICATIONS) : [])
    : [];
  const eligibleRecords = unverdictList !== null
    ? unverdictList.documents.filter(isUnverdictReadyDocument)
    : ocrStage ?? (args.universe === null ? paths.flatMap(readClassificationLines) : realUniverse!.candidates);
  const eligible = uniqueEligible(eligibleRecords);
  const batch = args.universe === null && args.unverdictList === null && args.ocrStage === null && args.all && args.batchSize !== null
    ? selectPvControlBatch(eligible, args.batchSize, args.batchIndex ?? 1)
    : null;
  const indexedStorageKeys = args.universe !== null
    ? new Set([...realUniverse!.initiallyIndexedStorageKeys, ...indexedStorageKeysFromExistingReports()])
    : args.dedupeSnapshot !== null
      ? indexedStorageKeysForExternalCampaign(args.dedupeSnapshot)
      : new Set<string>();
  const eligibleByStorageKey = new Map(eligible.map((document) => [document.storage_key, document]));
  const requestedStorageKeys = args.universe === null
    ? null
    : realUniverse!.populationStorageKeys.slice(
      args.universeOffset,
      args.universeLimit === null ? undefined : args.universeOffset + args.universeLimit,
    );
  const requested = unverdictList !== null
    ? unverdictList.documents.slice(
      args.unverdictOffset,
      args.unverdictLimit === null ? undefined : args.unverdictOffset + args.unverdictLimit,
    )
    : args.ocrStage !== null
    ? eligible
    : args.universe !== null
    ? requestedStorageKeys!.flatMap((storageKey) => {
      const document = eligibleByStorageKey.get(storageKey);
      return document === undefined ? [] : [document];
    })
    : args.storageKeys.length > 0
    ? selectStorageKeys(eligible, args.storageKeys)
    : batch?.candidates ?? (args.all ? eligible : selectControl(eligible, args.control!));
  const skippedIndexedStorageKeys = args.universe === null
    ? requested.map((document) => document.storage_key).filter((storageKey) => indexedStorageKeys.has(storageKey))
    : requestedStorageKeys!.filter((storageKey) => indexedStorageKeys.has(storageKey));
  const selected = unverdictList !== null
    ? requested
    : args.universe === null
    ? requested.filter((document) => !indexedStorageKeys.has(document.storage_key))
    : requested.filter((document) => !indexedStorageKeys.has(document.storage_key));
  assertS3RunEnvironment();
  if (args.universe !== null && requestedStorageKeys!.length === 0) {
    throw new Error(`fenêtre de l'univers vide: offset=${args.universeOffset}`);
  }
  if (unverdictList !== null && selected.length === 0) {
    throw new Error(`fenêtre de la liste sans verdict vide: offset=${args.unverdictOffset}`);
  }
  if (selected.length === 0 && args.universe === null && unverdictList === null) throw new Error("la sélection Graphify est vide");

  const municipalities = readMunicipalities(MUNICIPALITIES_PATH);
  const registry = readZoneRegistry(ZONE_REGISTRY_PATH);
  const resolutions = readZoneResolution(ZONAGE_RESOLUTION_PATH);
  const s3 = s3Client();
  const zoneCache = new Map<string, Promise<{ gazetteer: MunicipalZoneGazetteer | undefined; policy: ZoneGazetteerMatchPolicy | null }>>();
  const lotCache = new Map<string, Promise<{ gazetteer: MunicipalLotGazetteer | undefined; served: boolean }>>();
  const zoneReports = new Map<string, ZoneGazetteerReport>();
  const lotReports = new Map<string, LotGazetteerReport>();
  async function materializeForSlug(slug: string): Promise<MunicipalizeResult> {
    let zonePromise = zoneCache.get(slug);
    if (!zonePromise) {
      zonePromise = materializeMunicipalZoneGazetteer(s3, slug, registry, resolutions);
      zoneCache.set(slug, zonePromise);
    }
    let lotPromise = lotCache.get(slug);
    if (!lotPromise) {
      lotPromise = materializeMunicipalLotGazetteer(s3, slug);
      lotCache.set(slug, lotPromise);
    }
    const [zoneResult, lotResult] = await Promise.all([zonePromise, lotPromise]);
    if (!zoneReports.has(slug)) {
      zoneReports.set(slug, {
        municipality_slug: slug,
        matching_mode: zoneResult.policy?.mode ?? "normalized",
        zone_code_count: zoneResult.gazetteer?.codes.length ?? 0,
        collision_count: zoneResult.policy ? zoneResult.policy.collisions.length : 0,
        collision_examples: zoneResult.policy ? zoneResult.policy.collisions : [],
        codes: zoneResult.gazetteer?.codes ?? [],
      });
    }
    if (!lotReports.has(slug)) {
      lotReports.set(slug, {
        municipality_slug: slug,
        lot_count: lotResult.gazetteer ? lotResult.gazetteer.lot_numbers.length : 0,
        served: lotResult.served,
        lot_numbers: lotResult.gazetteer?.lot_numbers ?? [],
      });
    }
    return {
      // OCR never receives a separator/case-normalizing zone matcher.  A code
      // must occur literally in this municipality's closed gazetteer.
      zone: args.ocrStage !== null && zoneResult.gazetteer
        ? { ...zoneResult.gazetteer, zone_code_matching: "exact" }
        : zoneResult.gazetteer,
      lot: lotResult.gazetteer,
      zonePolicy: zoneResult.policy,
      lotServed: lotResult.served,
    };
  }
  const workspace = resolve(ROOT, "work", "graphify", `pv-semantic-${new Date().toISOString().replace(/[-:]/gu, "").replace(/\..+/u, "Z")}`);
  const documents = await mapConcurrent(selected, args.concurrency, async (document): Promise<ControlDocumentReport> => {
    if ("source_status" in document && document.source_status !== "READY") return explicitScopeAbsence(document);
    try {
      const gazetteer = await materializeForSlug(document.slug);
      return processDocument(document, municipalities, gazetteer, workspace);
    } catch (error: unknown) {
      if (error instanceof S3CasReadUnavailableError) throw error;
      if (isS3ReadUnavailable(error)) throw new S3CasReadUnavailableError(document.storage_key, error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        slug: document.slug,
        municipality_name: document.municipality_name,
        url: document.url,
        storage_key: document.storage_key,
        source_file: document.ocr_artifact_key ? "document.ocr.txt" : "document.txt",
        text_provenance: document.ocr_artifact_key ? "OCR" : "NATIVE",
        entity_counts: {},
        entities: {},
        graphify: { exit_code: 1, stdout: "", stderr: message.slice(-4000), nodes: 0, edges: 0 },
        outcome: "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED",
        owner_scope: { status: "NOT_CONFIRMED", printed_owner_slugs: [] },
        failure_reason: message.slice(-4000),
        manual_verification: "UNVERIFIED",
      };
    }
  });

  const entityCounts: Record<string, number> = {};
  let graphNodes = 0;
  let graphEdges = 0;
  let graphifyFailures = 0;
  let documentsWithZone = 0;
  let documentsWithLot = 0;
  let zoneEntities = 0;
  let lotEntities = 0;
  const matchDetails: MatchDetail[] = [];
  const outcomes: Record<DocumentOutcome, number> = {
    INDEXED: 0,
    OWNER_NOT_CONFIRMED: 0,
    CONTAMINATION_OWNER_MISMATCH: 0,
    GRAPHIFY_FAILED: 0,
    DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED: 0,
    UNKNOWN_NO_TERMINAL_PV_MANIFEST: 0,
    UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE: 0,
  };
  for (const document of documents) {
    outcomes[document.outcome]++;
    if (document.graphify.exit_code !== 0) {
      graphifyFailures++;
      continue;
    }
    if (document.slug === null) throw new Error(`document sans scope municipal mais graphify réussi: ${document.storage_key}`);
    for (const [type, count] of Object.entries(document.entity_counts)) entityCounts[type] = (entityCounts[type] ?? 0) + count;
    if ((document.entity_counts.Zone ?? 0) > 0) documentsWithZone += 1;
    if ((document.entity_counts.LotCadastre ?? 0) > 0) documentsWithLot += 1;
    zoneEntities += document.entity_counts.Zone ?? 0;
    lotEntities += document.entity_counts.LotCadastre ?? 0;
    graphNodes += document.graphify.nodes;
    graphEdges += document.graphify.edges;
    for (const zone of document.entities.Zone ?? []) {
      matchDetails.push({
        municipality_slug: document.slug,
        storage_key: document.storage_key,
        entity_type: "Zone",
        value: zone.label,
        source_file: zone.citation.source_file,
        source_location: zone.citation.source_location,
        quote: zone.citation.quote,
      });
    }
    for (const lot of document.entities.LotCadastre ?? []) {
      matchDetails.push({
        municipality_slug: document.slug,
        storage_key: document.storage_key,
        entity_type: "LotCadastre",
        value: lot.label,
        source_file: lot.citation.source_file,
        source_location: lot.citation.source_location,
        quote: lot.citation.quote,
      });
    }
  }
  const zoneGazetteer = {
    municipalities: zoneReports.size,
    zone_code_count: [...zoneReports.values()].reduce((total, value) => total + value.zone_code_count, 0),
    with_collisions: [...zoneReports.values()].filter((value) => value.collision_count > 0),
    entries: [...zoneReports.values()].sort((left, right) => left.municipality_slug.localeCompare(right.municipality_slug)),
  };
  const lotGazetteer = {
    municipalities: lotReports.size,
    served_municipalities: [...lotReports.values()].filter((value) => value.served).length,
    total_lot_numbers: [...lotReports.values()].reduce((total, value) => total + value.lot_count, 0),
    missing: [...lotReports.values()].filter((value) => !value.served).map((value) => value.municipality_slug).sort(),
    entries: [...lotReports.values()].sort((left, right) => left.municipality_slug.localeCompare(right.municipality_slug)),
  };
  const compactGazetteers = {
    zones: {
      municipalities: zoneGazetteer.municipalities,
      zone_code_count: zoneGazetteer.zone_code_count,
      municipalities_with_collisions: zoneGazetteer.with_collisions.map((entry) => entry.municipality_slug),
    },
    lots: {
      municipalities: lotGazetteer.municipalities,
      served_municipalities: lotGazetteer.served_municipalities,
      total_lot_numbers: lotGazetteer.total_lot_numbers,
      missing: lotGazetteer.missing,
    },
  };
  // An external campaign supplies its own frozen historical de-duplication
  // source.  It needs the per-document audit, not a second multi-megabyte
  // dump of every municipal lot gazetteer for each 20-document checkpoint.
  const includeFullGazetteerSidecars = args.universe === null && args.unverdictList === null && args.dedupeSnapshot === null;
  const report = {
    contract: "pv-graphify-semantic-control/v1",
    generated_at: new Date().toISOString(),
    mode: args.ocrStage !== null
      ? "ocr-artifact-stage"
      : args.unverdictList !== null
      ? "unverdict-cas-batch"
      : args.universe !== null
      ? "real-cas-universe-batch"
      : args.storageKeys.length > 0 ? "targeted-storage-keys" : (args.all ? "all-eligible" : "balanced-municipality-control"),
    ...(args.ocrStage === null ? {} : { ocr_stage: args.ocrStage.slice(ROOT.length + 1) }),
    ...(args.universe === null ? {} : { universe_report: args.universe.slice(ROOT.length + 1) }),
    ...(args.unverdictList === null ? {} : { unverdict_list: args.unverdictList.slice(ROOT.length + 1) }),
    ...(args.universe === null ? {} : {
      universe_selection: {
        offset: args.universeOffset,
        limit: args.universeLimit,
        requested: requestedStorageKeys!.length,
        selected: selected.length,
        skipped_indexed_cas_keys: skippedIndexedStorageKeys,
        concurrency: args.concurrency,
      },
    }),
    ...(args.dedupeSnapshot === null ? {} : {
      dedupe: {
        snapshot: args.dedupeSnapshot.slice(ROOT.length + 1),
        indexed_cas_keys_in_union: indexedStorageKeys.size,
        skipped_duplicate_cas_keys: skippedIndexedStorageKeys,
      },
    }),
    ...(args.unverdictList === null ? {} : {
      unverdict_selection: {
        offset: args.unverdictOffset,
        limit: args.unverdictLimit,
        requested: requested.length,
        selected: selected.length,
        concurrency: args.concurrency,
      },
    }),
    classification_reports: paths.map((path) => path.slice(ROOT.length + 1)),
    eligible_records: eligibleRecords.length,
    eligible_documents: eligible.length,
    duplicate_eligible_records: eligibleRecords.length - eligible.length,
    eligible_municipalities: new Set(eligible.map((document) => document.slug)).size,
    ...(batch ? { batch } : {}),
    ...(args.storageKeys.length > 0 ? { supersedes_storage_keys: selected.map((document) => document.storage_key) } : {}),
    selected_documents: documents.length,
    indexing: {
      indexed_pvs: outcomes.INDEXED,
      failed_pvs: documents.length - outcomes.INDEXED,
      outcomes,
      owner_contaminations: documents
        .filter((document) => document.outcome === "CONTAMINATION_OWNER_MISMATCH" && document.slug !== null)
        .map((document) => ({
          storage_key: document.storage_key,
          manifest_scope_slug: document.slug,
          printed_owner_slugs: document.owner_scope.printed_owner_slugs,
        })),
    },
    entity_counts: entityCounts,
    graphify: { nodes: graphNodes, edges: graphEdges, failures: graphifyFailures },
    matches: {
      zone_entities: zoneEntities,
      lot_entities: lotEntities,
      documents_with_zone: documentsWithZone,
      documents_with_lot: documentsWithLot,
    },
    match_details: matchDetails,
    gazetteers: {
      ...(includeFullGazetteerSidecars ? { zones: zoneGazetteer, lots: lotGazetteer } : compactGazetteers),
    },
    manual_verification: "UNVERIFIED",
    workspace,
    documents,
  };
  writeAtomic(args.output, report);
  if (includeFullGazetteerSidecars) {
    writeAtomic(args.output.replace(/\.json$/u, "-gazetteer-zones.json"), {
      generated_at: report.generated_at,
      municipalities: zoneGazetteer,
    });
    writeAtomic(args.output.replace(/\.json$/u, "-gazetteer-lots.json"), {
      generated_at: report.generated_at,
      municipalities: lotGazetteer,
    });
    writeAtomic(args.output.replace(/\.json$/u, "-match-details.json"), {
      generated_at: report.generated_at,
      details: matchDetails,
    });
  }
  console.log(JSON.stringify({
    report: args.output.slice(ROOT.length + 1),
    selected_documents: report.selected_documents,
    indexing: report.indexing,
    entity_counts: report.entity_counts,
    graphify: report.graphify,
    manual_verification: report.manual_verification,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
const execFileAsync = promisify(execFile);
