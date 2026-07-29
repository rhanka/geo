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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
import { BUCKET, exists, getBytes, s3Client } from "./lib/s3.js";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
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
  readonly universeOffset: number;
  readonly universeLimit: number | null;
  readonly concurrency: number;
  readonly control: number | null;
  readonly all: boolean;
  readonly storageKeys: readonly string[];
  readonly batchSize: number | null;
  readonly batchIndex: number | null;
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
  | "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED";

interface OwnerScopeReport {
  readonly status: "CONFIRMED" | "NOT_CONFIRMED" | "CONTAMINATION_OWNER_MISMATCH";
  readonly printed_owner_slugs: readonly string[];
}

interface ControlDocumentReport {
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
  readonly storage_key: string;
  readonly source_file: string;
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

function usage(): never {
  console.log("Usage: NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 npx tsx src/pv-graphify-semantic-run.ts [--control=N | --all | --storage-key=CAS_KEY] [--classification=PATH] [--universe=PATH --universe-offset=N --universe-limit=N] [--concurrency=1..4] [--out=PATH]");
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
  if (universeValues.length > 1) throw new Error("--universe ne peut apparaître qu'une fois");
  const universe = universeValues[0] === undefined ? null : resolve(ROOT, universeValues[0]);
  if (universe !== null && !universe.startsWith(`${ROOT}/`)) throw new Error("--universe doit rester dans le dépôt");
  const universeOffsetValue = values("universe-offset").at(-1);
  const universeLimitValue = values("universe-limit").at(-1);
  const universeOffset = universeOffsetValue === undefined ? 0 : Number(universeOffsetValue);
  const universeLimit = universeLimitValue === undefined ? null : Number(universeLimitValue);
  const concurrency = Number(values("concurrency").at(-1) ?? "1");
  if (!Number.isInteger(universeOffset) || universeOffset < 0) throw new Error("--universe-offset doit être un entier positif ou nul");
  if (universeLimit !== null && (!Number.isInteger(universeLimit) || universeLimit < 1)) {
    throw new Error("--universe-limit doit être un entier positif");
  }
  if (universe === null && (universeOffsetValue !== undefined || universeLimitValue !== undefined)) {
    throw new Error("--universe-offset et --universe-limit exigent --universe");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("--concurrency doit être un entier de 1 à 4");
  }
  if (storageKeys.some((key) => !key)) throw new Error("--storage-key doit être une clé CAS non vide");
  if (new Set(storageKeys).size !== storageKeys.length) throw new Error("--storage-key ne peut pas être répété");
  if (universe !== null && (values("classification").length > 0 || storageKeys.length > 0 || all || controlValue !== undefined)) {
    throw new Error("--universe est exclusif de --classification, --storage-key, --all et --control");
  }
  if (storageKeys.length > 0 && (all || controlValue !== undefined)) {
    throw new Error("--storage-key est exclusif de --all et --control");
  }
  const control = storageKeys.length > 0 ? null : (controlValue === undefined ? 20 : Number(controlValue));
  if (control !== null && (!Number.isInteger(control) || control < 1)) throw new Error("--control doit être un entier positif");
  if (all && values("control").length > 0) throw new Error("--all et --control sont exclusifs");
  const batchSizeValue = values("batch-size").at(-1);
  const batchIndexValue = values("batch-index").at(-1);
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
    universeOffset,
    universeLimit,
    concurrency,
    control: universe === null ? (all ? null : control) : null,
    all,
    storageKeys,
    batchSize,
    batchIndex,
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

/** Read the committed S3-CAS universe without treating it as a classification. */
function readRealUniverseBatch(path: string): ClassificationLine[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw) || raw.contract !== "pv-graphify-semantic-real-universe/v1") {
    throw new Error(`univers PV réel invalide: ${path}`);
  }
  const batch = raw.batch;
  if (!isRecord(batch) || !Array.isArray(batch.selected_documents)) {
    throw new Error(`univers PV réel sans batch sélectionné: ${path}`);
  }
  const selected: ClassificationLine[] = [];
  for (const [index, value] of batch.selected_documents.entries()) {
    if (!isRecord(value)) throw new Error(`${path}.batch.selected_documents[${index}] invalide`);
    selected.push({
      slug: requiredString(value, "slug", `${path}.batch.selected_documents[${index}]`),
      municipality_name: requiredString(value, "municipality_name", `${path}.batch.selected_documents[${index}]`),
      url: requiredString(value, "url", `${path}.batch.selected_documents[${index}]`),
      storage_key: requiredString(value, "storage_key", `${path}.batch.selected_documents[${index}]`),
      classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME",
    });
  }
  if (selected.length === 0) throw new Error(`univers PV réel sans document indexable: ${path}`);
  if (new Set(selected.map((document) => document.storage_key)).size !== selected.length) {
    throw new Error(`univers PV réel avec clé CAS dupliquée: ${path}`);
  }
  return selected;
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

async function textFromCapturedPdf(path: string): Promise<string> {
  const { stdout } = await execFileAsync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", path, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!stdout.trim()) throw new Error(`pas de couche texte: ${path}`);
  return stdout;
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
    const pdfPath = resolve(inputDirectory, "captured.pdf");
    const textPath = resolve(inputDirectory, "document.txt");
    writeFileSync(pdfPath, await getBytes(s3Client(), document.storage_key));
    const text = await textFromCapturedPdf(pdfPath);
    writeFileSync(textPath, text, "utf8");
    const printedOwnerSlugs = printedMunicipalityOwners(text, municipalities)
      .map((municipality) => municipality.slug)
      .sort((left, right) => left.localeCompare(right));
    const ownerScope: OwnerScopeReport = printedOwnerSlugs.includes(document.slug)
      ? { status: "CONFIRMED", printed_owner_slugs: printedOwnerSlugs }
      : printedOwnerSlugs.length > 0
        ? { status: "CONTAMINATION_OWNER_MISMATCH", printed_owner_slugs: printedOwnerSlugs }
        : { status: "NOT_CONFIRMED", printed_owner_slugs: [] };
    const semantic = extractPvSemantic({
      source_file: "document.txt",
      source_id: document.storage_key,
      source_url: document.url,
      municipality_slug: document.slug,
      text,
    }, municipalities, gazetteer.zone, gazetteer.lot);
    const semanticPath = resolve(documentDirectory, "semantic.json");
    writeAtomic(semanticPath, semantic);
    const graphify = await runGraphify(inputDirectory, semanticPath, documentDirectory);
    const outcome: DocumentOutcome = graphify.exit_code !== 0
      ? "GRAPHIFY_FAILED"
      : ownerScope.status === "CONTAMINATION_OWNER_MISMATCH"
        ? "CONTAMINATION_OWNER_MISMATCH"
        : ownerScope.status === "NOT_CONFIRMED"
          ? "OWNER_NOT_CONFIRMED"
          : graphify.nodes > 0
            ? "INDEXED"
            : "GRAPHIFY_FAILED";
    return {
      slug: document.slug,
      municipality_name: document.municipality_name,
      url: document.url,
      storage_key: document.storage_key,
      source_file: "document.txt",
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
    const message = error instanceof Error ? error.message : String(error);
    return {
      slug: document.slug,
      municipality_name: document.municipality_name,
      url: document.url,
      storage_key: document.storage_key,
      source_file: "document.txt",
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
  const paths = args.universe === null
    ? (args.classifications.length > 0 ? args.classifications : DEFAULT_CLASSIFICATIONS)
    : [];
  const eligibleRecords = args.universe === null ? paths.flatMap(readClassificationLines) : readRealUniverseBatch(args.universe);
  const eligible = uniqueEligible(eligibleRecords);
  const batch = args.universe === null && args.all && args.batchSize !== null
    ? selectPvControlBatch(eligible, args.batchSize, args.batchIndex ?? 1)
    : null;
  const selected = args.universe !== null
    ? eligible.slice(args.universeOffset, args.universeLimit === null ? undefined : args.universeOffset + args.universeLimit)
    : args.storageKeys.length > 0
    ? selectStorageKeys(eligible, args.storageKeys)
    : batch?.candidates ?? (args.all ? eligible : selectControl(eligible, args.control!));
  assertS3RunEnvironment();
  if (selected.length === 0) throw new Error("la sélection Graphify est vide");

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
      zone: zoneResult.gazetteer,
      lot: lotResult.gazetteer,
      zonePolicy: zoneResult.policy,
      lotServed: lotResult.served,
    };
  }
  const workspace = resolve(ROOT, "work", "graphify", `pv-semantic-${new Date().toISOString().replace(/[-:]/gu, "").replace(/\..+/u, "Z")}`);
  const documents = await mapConcurrent(selected, args.concurrency, async (document): Promise<ControlDocumentReport> => {
    try {
      const gazetteer = await materializeForSlug(document.slug);
      return processDocument(document, municipalities, gazetteer, workspace);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        slug: document.slug,
        municipality_name: document.municipality_name,
        url: document.url,
        storage_key: document.storage_key,
        source_file: "document.txt",
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
  };
  for (const document of documents) {
    outcomes[document.outcome]++;
    if (document.graphify.exit_code !== 0) {
      graphifyFailures++;
      continue;
    }
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
  const report = {
    contract: "pv-graphify-semantic-control/v1",
    generated_at: new Date().toISOString(),
    mode: args.universe !== null
      ? "real-cas-universe-batch"
      : args.storageKeys.length > 0 ? "targeted-storage-keys" : (args.all ? "all-eligible" : "balanced-municipality-control"),
    ...(args.universe === null ? {} : { universe_report: args.universe.slice(ROOT.length + 1) }),
    ...(args.universe === null ? {} : {
      universe_selection: { offset: args.universeOffset, limit: args.universeLimit, selected: selected.length, concurrency: args.concurrency },
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
        .filter((document) => document.outcome === "CONTAMINATION_OWNER_MISMATCH")
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
      zones: zoneGazetteer,
      lots: lotGazetteer,
    },
    manual_verification: "UNVERIFIED",
    workspace,
    documents,
  };
  writeAtomic(args.output, report);
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
