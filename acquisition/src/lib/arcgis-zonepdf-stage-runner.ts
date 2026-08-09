import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

import {
  SAINT_AMABLE_ZONEPDF_SOURCE,
  assertPinnedArcgisPdfRedirect,
  assertStableSourceFence,
  canonicalZoneCode,
  type ArcgisItemMetadata,
  type SourceFence as Lot1SourceFence,
} from "./arcgis-zonepdf-stage.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SourceFence = Lot1SourceFence;

export interface ZonePdfSourceRecord {
  oid: number;
  zoneCode: string;
  canonicalZoneCode: string;
  group: string;
  pdfUrl: string;
  itemId: string;
  /** Authoritative digest from the validated Lot 1 content manifest. */
  expectedPdfSha256: string;
  expectedOwner: string;
}

export type ArcgisPdfItemMetadata = ArcgisItemMetadata;

export interface PdfDownload {
  bytes: Uint8Array;
  finalUrl: string;
  contentType: string;
  contentLength?: number;
  /** Integrity attestation produced by the Lot 1 PDF validator. */
  pageCount: number;
}

export interface SourceSnapshot {
  fence: SourceFence;
  records: ZonePdfSourceRecord[];
}

export type MetadataPhase = "before-download" | "after-download";

/**
 * Adapter boundary implemented by Lot 1. It deliberately exposes reads only: the Lot 3
 * runner has no object-storage or publication port to call by accident.
 */
export interface ArcgisZonePdfSourcePort {
  readSnapshot(): Promise<SourceSnapshot>;
  readFence(): Promise<SourceFence>;
  readItemMetadata(
    record: ZonePdfSourceRecord,
    phase: MetadataPhase,
  ): Promise<ArcgisPdfItemMetadata>;
  downloadPdf(record: ZonePdfSourceRecord): Promise<PdfDownload>;
}

export interface VariantBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ZoneVariant {
  columnIndex: number;
  bbox: VariantBoundingBox;
  usages: string[];
  structure: string[];
  footnotes: string[];
  fields: Record<string, JsonValue>;
}

export interface ZoneVariantExtraction {
  zoneCode: string;
  variants: ZoneVariant[];
  unresolvedInvariants?: string[];
  visionPagesUsed?: number;
  visionUsd?: number;
  provenance?: Record<string, JsonValue>;
}

/** Serialized contract emitted by Lot 2. Kept local to avoid a package dependency. */
export interface SerializedLot2ZoneVariant {
  column_index: number;
  bbox: VariantBoundingBox;
  usages: string[];
  structures: string[];
  norms: Record<string, JsonValue>;
  footnotes: string[];
}

export interface SerializedLot2ZoneExtraction {
  zone_code: string;
  source_url: string;
  source_sha256: string;
  snapshot: string;
  page: number;
  header_observations: JsonValue[];
  variants: SerializedLot2ZoneVariant[];
}

const SERIALIZED_LOT2_USAGE_CODES = new Set([
  "h1", "h2", "h3", "h4", "h5",
  "c1", "c2", "c3", "c4", "c5", "c6",
  "p1", "p2", "p3",
  "i1", "i2", "i3",
  "a1",
]);
const SERIALIZED_LOT2_STRUCTURES = new Set(["Isolée", "Jumelée", "Contiguë"]);
const SERIALIZED_LOT2_NORMS = new Map<string, { unit: string; kind: "scalar" | "range" }>([
  ["marge_avant_min", { unit: "m", kind: "scalar" }],
  ["marge_laterale_min", { unit: "m", kind: "scalar" }],
  ["marge_laterale_totale_min", { unit: "m", kind: "scalar" }],
  ["marge_arriere_min", { unit: "m", kind: "scalar" }],
  ["largeur_min", { unit: "m", kind: "scalar" }],
  ["profondeur_min", { unit: "m", kind: "scalar" }],
  ["superficie_implantation_min", { unit: "m2", kind: "scalar" }],
  ["hauteur_etages", { unit: "etages", kind: "range" }],
  ["locaux_commerciaux_max", { unit: "nombre", kind: "scalar" }],
  ["cos_max", { unit: "ratio", kind: "scalar" }],
]);
const SERIALIZED_LOT2_BBOX_KEYS = ["x0", "y0", "x1", "y1"] as const;
const SERIALIZED_LOT2_NORM_CELL_KEYS = [
  "raw",
  "value",
  "min",
  "max",
  "unit",
  "bbox",
  "scope",
] as const;

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requiredJsonString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function jsonStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return [...value] as string[];
}

function exactJsonObject(
  value: unknown,
  label: string,
  requiredKeys: readonly string[],
): Record<string, unknown> {
  const object = jsonObject(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...requiredKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} must contain exactly ${expected.join(", ")}`);
  }
  return object;
}

function jsonNumberOrNull(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number or null`);
  }
  return value;
}

function serializedLot2Bbox(value: unknown, label: string): VariantBoundingBox {
  const bbox = exactJsonObject(value, label, SERIALIZED_LOT2_BBOX_KEYS);
  for (const coordinate of SERIALIZED_LOT2_BBOX_KEYS) {
    if (typeof bbox[coordinate] !== "number" || !Number.isFinite(bbox[coordinate])) {
      const owner = label.endsWith(" bbox") ? label.slice(0, -5) : label;
      throw new Error(`${owner} has a non-finite bbox`);
    }
  }
  const mapped: VariantBoundingBox = {
    x0: bbox.x0 as number,
    y0: bbox.y0 as number,
    x1: bbox.x1 as number,
    y1: bbox.y1 as number,
  };
  if (mapped.x0 < 0 || mapped.y0 < 0 || mapped.x1 <= mapped.x0 || mapped.y1 <= mapped.y0) {
    throw new Error(`${label} must be non-negative with positive area`);
  }
  return mapped;
}

function serializedLot2Norms(value: unknown, variantIndex: number): Record<string, JsonValue> {
  const label = `Lot 2 norms for variant ${variantIndex}`;
  const norms = jsonObject(value, label);
  for (const [key, rawCell] of Object.entries(norms)) {
    const spec = SERIALIZED_LOT2_NORMS.get(key);
    if (!spec) throw new Error(`${label} contains unknown norm key ${key}`);
    const cellLabel = `Lot 2 norm ${key}`;
    const cell = exactJsonObject(rawCell, cellLabel, SERIALIZED_LOT2_NORM_CELL_KEYS);
    requiredJsonString(cell.raw, `${cellLabel} raw`);
    const scalar = jsonNumberOrNull(cell.value, `${cellLabel} value`);
    const min = jsonNumberOrNull(cell.min, `${cellLabel} min`);
    const max = jsonNumberOrNull(cell.max, `${cellLabel} max`);
    if (cell.unit !== spec.unit) {
      throw new Error(`${cellLabel} unit must be ${spec.unit}`);
    }
    if (cell.scope !== "column" && cell.scope !== "merged") {
      throw new Error(`${cellLabel} scope must be column or merged`);
    }
    serializedLot2Bbox(cell.bbox, `${cellLabel} bbox`);
    if (spec.kind === "scalar") {
      if (min !== null || max !== null) {
        throw new Error(`${cellLabel} scalar bounds must be null`);
      }
    } else {
      if (scalar !== null || (min === null) !== (max === null) || (min !== null && max! < min)) {
        throw new Error(`${cellLabel} range values are inconsistent`);
      }
    }
  }
  return canonicalize(norms as JsonValue) as Record<string, JsonValue>;
}

/** Losslessly adapt one frozen Lot 2 JSON result to the Lot 3 extraction port. */
export function adaptSerializedLot2Extraction(
  value: unknown,
  expected: { zoneCode: string; pdfSha256: string; sourceUrl?: string },
): ZoneVariantExtraction {
  assertJsonValue(value, "serialized Lot 2 extraction");
  const input = jsonObject(value, "serialized Lot 2 extraction");
  const zoneCode = requiredJsonString(input.zone_code, "Lot 2 zone_code");
  if (zoneCode !== expected.zoneCode) {
    throw new Error(`Lot 2 zone_code ${zoneCode} != pinned code ${expected.zoneCode}`);
  }
  const sourceSha256 = requiredJsonString(input.source_sha256, "Lot 2 source_sha256");
  if (!SHA256_RE.test(sourceSha256) || sourceSha256 !== expected.pdfSha256) {
    throw new Error(`Lot 2 source_sha256 does not match pinned PDF SHA-256 for ${zoneCode}`);
  }
  const sourceUrl = requiredJsonString(input.source_url, "Lot 2 source_url");
  if (expected.sourceUrl !== undefined && sourceUrl !== expected.sourceUrl) {
    throw new Error(`Lot 2 source_url does not match pinned source URL for ${zoneCode}`);
  }
  const snapshot = requiredJsonString(input.snapshot, "Lot 2 snapshot");
  if (input.page !== 1) {
    throw new Error(`Lot 2 page must equal the one-page Lot 1 evidence for ${zoneCode}`);
  }
  if (!Array.isArray(input.header_observations) || input.header_observations.length !== 2) {
    throw new Error(`Lot 2 header_observations must contain two reads for ${zoneCode}`);
  }
  const observationMethods = new Set<string>();
  const observationCodes: string[][] = [];
  const rawHeaderPresentations = new Set<string>();
  for (const [index, rawObservation] of input.header_observations.entries()) {
    const observation = jsonObject(rawObservation, `Lot 2 header observation ${index}`);
    const method = requiredJsonString(
      observation.method,
      `Lot 2 header observation ${index} method`,
    );
    if (observationMethods.has(method)) {
      throw new Error(`Lot 2 header observation methods must be distinct for ${zoneCode}`);
    }
    observationMethods.add(method);
    const rawCodes = jsonStringArray(
      observation.raw_zone_codes,
      `Lot 2 header observation ${index} raw_zone_codes`,
    );
    if (rawCodes.length === 0) {
      throw new Error(`Lot 2 header observation ${index} has no raw zone codes`);
    }
    for (const rawCode of rawCodes) {
      rawHeaderPresentations.add(rawCode.trim());
      let canonical: string | null = null;
      try {
        canonical = canonicalZoneCode(rawCode);
      } catch {
        // Report the adapter boundary, not the lower-level source parser error.
      }
      if (canonical !== zoneCode) {
        throw new Error(
          `Lot 2 header observation ${index} code ${rawCode} != pinned code ${zoneCode}`,
        );
      }
    }
    observationCodes.push(rawCodes);
  }
  if (rawHeaderPresentations.size !== 1) {
    throw new Error(`Lot 2 header normalization collision for ${zoneCode}`);
  }
  if (!Array.isArray(input.variants) || input.variants.length === 0) {
    throw new Error(`Lot 2 variants must be a non-empty array for ${zoneCode}`);
  }

  const variants = input.variants.map((rawVariant, index): ZoneVariant => {
    const variant = jsonObject(rawVariant, `Lot 2 variant ${index}`);
    if (!Number.isSafeInteger(variant.column_index) || (variant.column_index as number) < 0) {
      throw new Error(`Lot 2 variant ${index} has an invalid column_index`);
    }
    const mappedBbox = serializedLot2Bbox(variant.bbox, `Lot 2 variant ${index} bbox`);
    const norms = serializedLot2Norms(variant.norms, index);
    const usages = jsonStringArray(variant.usages, `Lot 2 variant ${index} usages`);
    if (usages.some((usage) => !SERIALIZED_LOT2_USAGE_CODES.has(usage))) {
      throw new Error(`Lot 2 variant ${index} contains an invalid authorized usage`);
    }
    const structures = jsonStringArray(
      variant.structures,
      `Lot 2 variant ${index} structures`,
    );
    if (structures.some((structure) => !SERIALIZED_LOT2_STRUCTURES.has(structure))) {
      throw new Error(`Lot 2 variant ${index} contains an invalid structure label`);
    }
    const footnotes = jsonStringArray(variant.footnotes, `Lot 2 variant ${index} footnotes`);
    if (footnotes.some((footnote) => !/^\*\d+$/.test(footnote))) {
      throw new Error(`Lot 2 variant ${index} contains an invalid footnote reference`);
    }
    return {
      columnIndex: variant.column_index as number,
      bbox: mappedBbox,
      usages,
      structure: structures,
      footnotes,
      fields: norms,
    };
  });
  for (const [index, variant] of variants.entries()) {
    if (variant.columnIndex !== index) {
      throw new Error(`Lot 2 variant columns must be ordered contiguously from zero for ${zoneCode}`);
    }
    const previous = variants[index - 1];
    if (previous && previous.bbox.x1 > variant.bbox.x0) {
      throw new Error(`Lot 2 variant columns overlap or are out of order for ${zoneCode}`);
    }
  }
  if (observationCodes.some((codes) => codes.length !== variants.length)) {
    throw new Error(`Lot 2 header multiplicity does not match variant count for ${zoneCode}`);
  }

  return {
    zoneCode,
    variants,
    provenance: {
      source_url: sourceUrl,
      source_sha256: sourceSha256,
      snapshot,
      page: input.page as number,
      header_observations: canonicalize(input.header_observations as JsonValue) as JsonValue[],
    },
  };
}

export interface ZonePdfExtractInput {
  record: ZonePdfSourceRecord;
  pdfPath: string;
  pdfSha256: string;
  vision: {
    enabled: boolean;
    maxPages: number;
    maxUsd: number;
    /** Reserve the worst-case spend before any costed provider call. */
    reserve(pages: number, usd: number): void;
  };
}

/** Boundary implemented by Lot 2. */
export interface ArcgisZonePdfExtractorPort {
  version: string;
  /** Frozen adapters expose their exact prepared set; dynamic parsers may omit it. */
  preparedZoneCodes?: readonly string[];
  parse(input: ZonePdfExtractInput): Promise<ZoneVariantExtraction>;
}

export interface ConservativeZonePreview {
  zoneCode: string;
  canonicalZoneCode: string;
  variantCount: number;
  usages: string[];
  structure: string[];
  fields: Record<string, JsonValue>;
  conflictingFields: string[];
}

export interface StageDiffEntry {
  zoneCode: string;
  before: ConservativeZonePreview | null;
  after: ConservativeZonePreview | null;
}

export interface StageDiff {
  added: StageDiffEntry[];
  removed: StageDiffEntry[];
  changed: StageDiffEntry[];
  unchanged: string[];
}

export interface StageRunConfig {
  expectedRecords: number;
  metadataConcurrency: number;
  pdfConcurrency: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  maxPdfBytes: number;
  visionEnabled: boolean;
  maxVisionPages: number;
  maxVisionUsd: number;
}

export interface StageRunOptions {
  outDir: string;
  source: ArcgisZonePdfSourcePort;
  extractor: ArcgisZonePdfExtractorPort;
  baseline?: ConservativeZonePreview[];
  config?: Partial<StageRunConfig>;
  now?: () => string;
  runId?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface StageRecordReceipt {
  zoneCode: string;
  metadataAttempts: number;
  downloadAttempts: number;
  cacheHit: boolean;
  parseCacheHit: boolean;
  status: "ok" | "failed";
  error?: string;
}

export interface StageRunReceipt {
  schema: "geo.arcgis-zonepdf-stage-receipt.v1";
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: "ready" | "failed";
  configHash?: string;
  fenceHash?: string;
  manifestSha256?: string;
  runDir?: string;
  records: StageRecordReceipt[];
  errors: string[];
}

export interface StageRunResult {
  status: "ready" | "failed";
  manifestSha256?: string;
  runDir?: string;
  receiptPath: string;
  errors: string[];
}

interface DownloadedPdf {
  record: ZonePdfSourceRecord;
  metadata: ArcgisPdfItemMetadata;
  sha256: string;
  bytesLen: number;
  pageCount: number;
  cachePath: string;
  cacheHit: boolean;
}

interface ExtractedRecord extends DownloadedPdf {
  extraction: ZoneVariantExtraction;
  parseCacheHit: boolean;
}

interface RetryStats {
  attempts: number;
}

interface CachedPdfIndex {
  schema: "geo.arcgis-zonepdf-cache-index.v1";
  itemId: string;
  itemModified: number;
  itemSize: number;
  pageCount: number;
  sha256: string;
}

interface CachedExtraction {
  schema: "geo.arcgis-zonepdf-parse-cache.v1";
  cacheKey: string;
  extractionSha256: string;
  extraction: ZoneVariantExtraction;
}

export class RetryableStageError extends Error {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "RetryableStageError";
    this.retryAfterMs = retryAfterMs;
  }
}

const DEFAULT_CONFIG: StageRunConfig = {
  expectedRecords: 109,
  metadataConcurrency: 4,
  pdfConcurrency: 3,
  maxAttempts: 4,
  retryBaseMs: 250,
  retryMaxMs: 30_000,
  maxPdfBytes: 10 * 1024 * 1024,
  visionEnabled: false,
  maxVisionPages: 0,
  maxVisionUsd: 0,
};

const PDF_ITEM_RE = /^https:\/\/([a-z0-9-]+\.)*arcgis\.com\/sharing\/rest\/content\/items\/([a-f0-9]{32})\/data$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SAINT_AMABLE_ZONE_RE = /^[A-Z][A-Z0-9]{0,3}-\d{1,3}$/;
let atomicCounter = 0;

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function resolveStageConfig(input: Partial<StageRunConfig> = {}): StageRunConfig {
  const config = { ...DEFAULT_CONFIG, ...input };
  assertPositiveInteger(config.expectedRecords, "expectedRecords");
  assertPositiveInteger(config.metadataConcurrency, "metadataConcurrency");
  assertPositiveInteger(config.pdfConcurrency, "pdfConcurrency");
  assertPositiveInteger(config.maxAttempts, "maxAttempts");
  assertPositiveInteger(config.retryBaseMs, "retryBaseMs");
  assertPositiveInteger(config.retryMaxMs, "retryMaxMs");
  assertPositiveInteger(config.maxPdfBytes, "maxPdfBytes");
  if (config.visionEnabled) {
    assertPositiveInteger(config.maxVisionPages, "maxVisionPages");
    if (!(config.maxVisionUsd > 0) || !Number.isFinite(config.maxVisionUsd)) {
      throw new Error("maxVisionUsd must be finite and > 0 when vision is enabled");
    }
  } else if (config.maxVisionPages !== 0 || config.maxVisionUsd !== 0) {
    throw new Error("vision budgets must be zero unless visionEnabled is true");
  }
  return config;
}

/** Recursively sort object keys while preserving array order. */
export function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, canonicalize(value[key]!)]),
    ) as { [key: string]: JsonValue };
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonHash(value: JsonValue): string {
  return sha256(canonicalJson(value));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.part-${process.pid}-${atomicCounter++}`;
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function atomicWriteJson(path: string, value: JsonValue): Promise<void> {
  await atomicWrite(path, canonicalJson(value));
}

function fenceValue(fence: SourceFence): JsonValue {
  return {
    serviceItemId: fence.serviceItemId,
    serviceModified: fence.serviceModified,
    layerUrl: fence.layerUrl,
    objectIdField: fence.objectIdField,
    editing: {
      lastEditDate: fence.editing.lastEditDate,
      dataLastEditDate: fence.editing.dataLastEditDate,
      schemaLastEditDate: fence.editing.schemaLastEditDate,
    },
    count: fence.count,
    objectIds: [...fence.objectIds].sort((a, b) => a - b),
  };
}

function assertFenceStable(before: SourceFence, after: SourceFence): void {
  try {
    assertStableSourceFence(before, after);
  } catch {
    throw new Error("source fence moved between T0 and T1");
  }
}

function validateSourceRecords(snapshot: SourceSnapshot, expectedRecords: number): ZonePdfSourceRecord[] {
  const { fence } = snapshot;
  const records = [...snapshot.records].sort(
    (a, b) => compareText(a.canonicalZoneCode, b.canonicalZoneCode) || a.oid - b.oid,
  );
  if (records.length !== expectedRecords) {
    throw new Error(`source cardinality ${records.length} != expected ${expectedRecords}`);
  }
  if (fence.count !== expectedRecords) {
    throw new Error(`fence count ${fence.count} != expected ${expectedRecords}`);
  }
  if (
    fence.serviceItemId.toLowerCase() !== SAINT_AMABLE_ZONEPDF_SOURCE.serviceItemId.toLowerCase() ||
    fence.layerUrl !== SAINT_AMABLE_ZONEPDF_SOURCE.layerUrl ||
    fence.objectIdField !== "id"
  ) {
    throw new Error("source fence is not the pinned Saint-Amable FeatureService layer");
  }
  const fenceIds = [...fence.objectIds].sort((a, b) => a - b);
  const recordIds = records.map((record) => record.oid).sort((a, b) => a - b);
  if (new Set(fenceIds).size !== expectedRecords || canonicalJson(fenceIds) !== canonicalJson(recordIds)) {
    throw new Error("fence OID set does not exactly match source records");
  }

  const dimensions: Array<[string, string[]]> = [
    ["OID", records.map((record) => String(record.oid))],
    ["canonical zone code", records.map((record) => record.canonicalZoneCode)],
    ["PDF URL", records.map((record) => record.pdfUrl)],
    ["item ID", records.map((record) => record.itemId)],
  ];
  for (const [label, values] of dimensions) {
    if (new Set(values).size !== records.length) throw new Error(`duplicate ${label}`);
  }

  for (const record of records) {
    if (!Number.isInteger(record.oid) || record.oid < 0) throw new Error(`invalid OID for ${record.zoneCode}`);
    if (
      !SAINT_AMABLE_ZONE_RE.test(record.zoneCode) ||
      record.zoneCode !== record.canonicalZoneCode ||
      canonicalZoneCode(record.zoneCode) !== record.zoneCode
    ) {
      throw new Error(
        `non-canonical or conflicting Saint-Amable zone code for OID ${record.oid}: ` +
          `${record.zoneCode}/${record.canonicalZoneCode}`,
      );
    }
    if (!/^[a-f0-9]{32}$/i.test(record.itemId)) {
      throw new Error(`invalid ArcGIS item ID for ${record.zoneCode}`);
    }
    if (!SHA256_RE.test(record.expectedPdfSha256)) {
      throw new Error(`invalid pinned PDF SHA-256 for ${record.zoneCode}`);
    }
    const urlMatch = record.pdfUrl.match(PDF_ITEM_RE);
    if (!urlMatch || urlMatch[2]?.toLowerCase() !== record.itemId.toLowerCase()) {
      throw new Error(`invalid or mismatched ArcGIS PDF URL for ${record.zoneCode}`);
    }
    if (record.expectedOwner !== SAINT_AMABLE_ZONEPDF_SOURCE.expectedItemOwner) {
      throw new Error(`unpinned expected owner for ${record.zoneCode}`);
    }
  }
  return records;
}

function validateMetadata(
  record: ZonePdfSourceRecord,
  metadata: ArcgisPdfItemMetadata,
  config: StageRunConfig,
): void {
  if (metadata.id.toLowerCase() !== record.itemId.toLowerCase()) {
    throw new Error(`item ID mismatch for ${record.zoneCode}`);
  }
  if (metadata.type.toLowerCase() !== "pdf") throw new Error(`item type is not PDF for ${record.zoneCode}`);
  if (metadata.access.toLowerCase() !== "public") throw new Error(`item is not public for ${record.zoneCode}`);
  if (metadata.owner !== record.expectedOwner) {
    throw new Error(`item owner mismatch for ${record.zoneCode}`);
  }
  let titleCode: string | null = null;
  try {
    titleCode = canonicalZoneCode(metadata.title);
  } catch {
    // Normalize through the exact Lot 1 authority; any invalid title remains a mismatch.
  }
  if (titleCode !== record.canonicalZoneCode) {
    throw new Error(`item title mismatch for ${record.zoneCode}: ${metadata.title}`);
  }
  if (!Number.isInteger(metadata.created) || metadata.created <= 0) {
    throw new Error(`invalid item creation time for ${record.zoneCode}`);
  }
  if (!Number.isInteger(metadata.modified) || metadata.modified <= 0) {
    throw new Error(`invalid item revision for ${record.zoneCode}`);
  }
  if (!Number.isInteger(metadata.size) || metadata.size <= 0) {
    throw new Error(`invalid item size for ${record.zoneCode}`);
  }
  if (metadata.size > config.maxPdfBytes) {
    throw new Error(`item exceeds configured PDF size limit for ${record.zoneCode}`);
  }
}

function assertMetadataStable(
  record: ZonePdfSourceRecord,
  before: ArcgisPdfItemMetadata,
  after: ArcgisPdfItemMetadata,
  config: StageRunConfig,
): void {
  validateMetadata(record, before, config);
  validateMetadata(record, after, config);
  if (canonicalJson(before as unknown as JsonValue) !== canonicalJson(after as unknown as JsonValue)) {
    throw new Error(`item metadata moved during download for ${record.zoneCode}`);
  }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  config: StageRunConfig,
  sleep: (ms: number) => Promise<void>,
  stats: RetryStats,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    stats.attempts += 1;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!(error instanceof RetryableStageError) || attempt === config.maxAttempts) throw error;
      const exponential = config.retryBaseMs * 2 ** (attempt - 1);
      const requested = error.retryAfterMs ?? exponential;
      await sleep(Math.min(config.retryMaxMs, Math.max(0, requested)));
    }
  }
  throw lastError;
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: Error }>> {
  const results = new Array<{ ok: true; value: R } | { ok: false; error: Error }>(values.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      try {
        results[index] = { ok: true, value: await worker(values[index]!, index) };
      } catch (error) {
        results[index] = {
          ok: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }
  });
  await Promise.all(lanes);
  return results;
}

function itemCacheKey(metadata: ArcgisPdfItemMetadata): string {
  return sha256(`${metadata.id}:${metadata.modified}:${metadata.size}`);
}

async function loadCachedPdf(
  cacheDir: string,
  metadata: ArcgisPdfItemMetadata,
  maxPdfBytes: number,
  expectedPdfSha256: string,
): Promise<{ bytes: Uint8Array; sha256: string; path: string; pageCount: number } | null> {
  const indexPath = join(cacheDir, "index", `${itemCacheKey(metadata)}.json`);
  if (!(await pathExists(indexPath))) return null;
  try {
    const index = JSON.parse(await readFile(indexPath, "utf8")) as CachedPdfIndex;
    if (
      index.schema !== "geo.arcgis-zonepdf-cache-index.v1" ||
      index.itemId !== metadata.id ||
      index.itemModified !== metadata.modified ||
      index.itemSize !== metadata.size ||
      index.pageCount !== 1 ||
      index.sha256 !== expectedPdfSha256
    ) {
      return null;
    }
    const path = join(cacheDir, "cas", `${index.sha256}.pdf`);
    const bytes = await readFile(path);
    if (
      bytes.byteLength !== metadata.size ||
      bytes.byteLength > maxPdfBytes ||
      sha256(bytes) !== index.sha256
    ) return null;
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) return null;
    return { bytes, sha256: index.sha256, path, pageCount: index.pageCount };
  } catch {
    return null;
  }
}

async function cachePdf(
  cacheDir: string,
  metadata: ArcgisPdfItemMetadata,
  bytes: Uint8Array,
  pageCount: number,
  expectedPdfSha256: string,
): Promise<{ sha256: string; path: string; pageCount: number }> {
  const digest = sha256(bytes);
  if (digest !== expectedPdfSha256) {
    throw new Error(`downloaded PDF SHA-256 does not match the Lot 1 manifest for ${metadata.id}`);
  }
  const path = join(cacheDir, "cas", `${digest}.pdf`);
  if (await pathExists(path)) {
    const existing = await readFile(path);
    if (existing.byteLength !== bytes.byteLength || sha256(existing) !== digest) {
      // The item/revision index already failed validation, so a fresh official
      // download is authoritative and can atomically heal a truncated local CAS.
      await atomicWrite(path, bytes);
    }
  } else await atomicWrite(path, bytes);
  const index: CachedPdfIndex = {
    schema: "geo.arcgis-zonepdf-cache-index.v1",
    itemId: metadata.id,
    itemModified: metadata.modified,
    itemSize: metadata.size,
    pageCount,
    sha256: digest,
  };
  await atomicWriteJson(
    join(cacheDir, "index", `${itemCacheKey(metadata)}.json`),
    index as unknown as JsonValue,
  );
  return { sha256: digest, path, pageCount };
}

async function loadCachedExtraction(
  path: string,
  cacheKey: string,
): Promise<ZoneVariantExtraction | null> {
  if (!(await pathExists(path))) return null;
  try {
    const cached = JSON.parse(await readFile(path, "utf8")) as CachedExtraction;
    if (
      cached.schema !== "geo.arcgis-zonepdf-parse-cache.v1" ||
      cached.cacheKey !== cacheKey ||
      !SHA256_RE.test(cached.extractionSha256) ||
      jsonHash(cached.extraction as unknown as JsonValue) !== cached.extractionSha256
    ) {
      throw new Error("invalid parse-cache envelope");
    }
    return cached.extraction;
  } catch {
    await rm(path, { force: true }).catch(() => undefined);
    return null;
  }
}

async function cacheExtraction(
  path: string,
  cacheKey: string,
  extraction: ZoneVariantExtraction,
): Promise<void> {
  await atomicWriteJson(path, {
    schema: "geo.arcgis-zonepdf-parse-cache.v1",
    cacheKey,
    extractionSha256: jsonHash(extraction as unknown as JsonValue),
    extraction,
  } as unknown as JsonValue);
}

function validatePdfDownload(
  record: ZonePdfSourceRecord,
  metadata: ArcgisPdfItemMetadata,
  download: PdfDownload,
  config: StageRunConfig,
): void {
  const bytes = Buffer.from(download.bytes);
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error(`invalid PDF magic for ${record.zoneCode}`);
  }
  if (bytes.byteLength !== metadata.size) {
    throw new Error(`PDF size ${bytes.byteLength} != item size ${metadata.size} for ${record.zoneCode}`);
  }
  if (sha256(bytes) !== record.expectedPdfSha256) {
    throw new Error(`PDF SHA-256 mismatch for ${record.zoneCode}`);
  }
  if (download.contentLength !== undefined && download.contentLength !== bytes.byteLength) {
    throw new Error(`truncated HTTP body for ${record.zoneCode}`);
  }
  if (bytes.byteLength > config.maxPdfBytes) throw new Error(`PDF exceeds size limit for ${record.zoneCode}`);
  if (!download.contentType.toLowerCase().startsWith("application/pdf")) {
    throw new Error(`unexpected content type for ${record.zoneCode}`);
  }
  if (!Number.isInteger(download.pageCount) || download.pageCount !== 1) {
    throw new Error(`PDF page count ${download.pageCount} != 1 for ${record.zoneCode}`);
  }
  const finalMatch = download.finalUrl.match(PDF_ITEM_RE);
  const sourceDataUrlMatches =
    finalMatch?.[2]?.toLowerCase() === record.itemId.toLowerCase();
  if (!sourceDataUrlMatches) {
    try {
      assertPinnedArcgisPdfRedirect(download.finalUrl, {
        redirectHost: SAINT_AMABLE_ZONEPDF_SOURCE.pdfRedirectHost,
        itemDataPathPrefix: SAINT_AMABLE_ZONEPDF_SOURCE.pdfItemDataPathPrefix,
        expectedItemId: record.itemId,
        expectedCode: record.zoneCode,
      });
    } catch {
      throw new Error(`redirect escaped ArcGIS PDF allowlist for ${record.zoneCode}`);
    }
  }
}

function validateExtraction(record: ZonePdfSourceRecord, extraction: ZoneVariantExtraction): void {
  assertJsonValue(extraction, `extraction ${record.zoneCode}`);
  if (extraction.zoneCode !== record.zoneCode) {
    throw new Error(`extracted code ${extraction.zoneCode} != pinned code ${record.zoneCode}`);
  }
  if ((extraction.unresolvedInvariants ?? []).length > 0) {
    throw new Error(
      `unresolved extraction invariants for ${record.zoneCode}: ${extraction.unresolvedInvariants!.join(", ")}`,
    );
  }
  if (extraction.variants.length === 0) throw new Error(`no variants for ${record.zoneCode}`);
  const indices = extraction.variants.map((variant) => variant.columnIndex);
  if (new Set(indices).size !== indices.length) throw new Error(`duplicate variant index for ${record.zoneCode}`);
  if (indices.some((value, index) => value !== index)) {
    throw new Error(`variant indices must be ordered and contiguous from zero for ${record.zoneCode}`);
  }
  for (const variant of extraction.variants) {
    const { x0, y0, x1, y1 } = variant.bbox;
    if (![x0, y0, x1, y1].every(Number.isFinite) || !(x0 < x1) || !(y0 < y1)) {
      throw new Error(`invalid variant bounding box for ${record.zoneCode}`);
    }
    for (const [label, values] of [
      ["usages", variant.usages],
      ["structure", variant.structure],
      ["footnotes", variant.footnotes],
    ] as const) {
      if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
        throw new Error(`invalid ${label} array for ${record.zoneCode}`);
      }
    }
  }
}

function assertJsonValue(value: unknown, path: string, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${path} contains a non-JSON value`);
  if (seen.has(value)) throw new Error(`${path} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertJsonValue(child, `${path}[${index}]`, seen));
  } else {
    for (const key of Object.keys(value)) {
      assertJsonValue((value as Record<string, unknown>)[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function intersectOrdered(values: string[][]): string[] {
  if (values.length === 0) return [];
  const rest = values.slice(1).map((row) => new Set(row));
  return values[0]!.filter((value) => rest.every((set) => set.has(value)));
}

export function conservativePreview(
  record: ZonePdfSourceRecord,
  extraction: ZoneVariantExtraction,
): ConservativeZonePreview {
  const fieldNames = [...new Set(extraction.variants.flatMap((variant) => Object.keys(variant.fields)))].sort();
  const fields: Record<string, JsonValue> = {};
  const conflictingFields: string[] = [];
  for (const field of fieldNames) {
    const values = extraction.variants.map((variant) => variant.fields[field] ?? null);
    const first = canonicalJson(values[0] ?? null);
    if (values.every((value) => canonicalJson(value) === first)) fields[field] = values[0] ?? null;
    else {
      fields[field] = null;
      conflictingFields.push(field);
    }
  }
  return {
    zoneCode: record.zoneCode,
    canonicalZoneCode: record.canonicalZoneCode,
    variantCount: extraction.variants.length,
    usages: intersectOrdered(extraction.variants.map((variant) => variant.usages)),
    structure: intersectOrdered(extraction.variants.map((variant) => variant.structure)),
    fields,
    conflictingFields,
  };
}

export function buildStageDiff(
  baseline: ConservativeZonePreview[],
  candidate: ConservativeZonePreview[],
): StageDiff {
  const before = new Map(baseline.map((row) => [row.canonicalZoneCode, row]));
  const after = new Map(candidate.map((row) => [row.canonicalZoneCode, row]));
  const added: StageDiffEntry[] = [];
  const removed: StageDiffEntry[] = [];
  const changed: StageDiffEntry[] = [];
  const unchanged: string[] = [];
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const key of keys) {
    const left = before.get(key) ?? null;
    const right = after.get(key) ?? null;
    const entry = { zoneCode: right?.zoneCode ?? left?.zoneCode ?? key, before: left, after: right };
    if (!left) added.push(entry);
    else if (!right) removed.push(entry);
    else if (canonicalJson(left as unknown as JsonValue) !== canonicalJson(right as unknown as JsonValue)) {
      changed.push(entry);
    } else unchanged.push(right.zoneCode);
  }
  return { added, removed, changed, unchanged };
}

function candidateRows(records: ExtractedRecord[]): Array<Record<string, string | number>> {
  return records.flatMap((record) =>
    record.extraction.variants.map((variant) => ({
      zone_code: record.record.zoneCode,
      canonical_zone_code: record.record.canonicalZoneCode,
      variant_index: variant.columnIndex,
      bbox_json: canonicalJson(variant.bbox as unknown as JsonValue).trim(),
      usages_json: canonicalJson(variant.usages).trim(),
      structure_json: canonicalJson(variant.structure).trim(),
      footnotes_json: canonicalJson(variant.footnotes).trim(),
      fields_json: canonicalJson(variant.fields as unknown as JsonValue).trim(),
      pdf_sha256: record.sha256,
      source_item_id: record.record.itemId,
    })),
  );
}

const CANDIDATE_SCHEMA = new ParquetSchema({
  zone_code: { type: "UTF8" },
  canonical_zone_code: { type: "UTF8" },
  variant_index: { type: "INT32" },
  bbox_json: { type: "UTF8" },
  usages_json: { type: "UTF8" },
  structure_json: { type: "UTF8" },
  footnotes_json: { type: "UTF8" },
  fields_json: { type: "UTF8" },
  pdf_sha256: { type: "UTF8" },
  source_item_id: { type: "UTF8" },
});

async function writeCandidateParquet(path: string, rows: Array<Record<string, string | number>>): Promise<void> {
  const writer = await ParquetWriter.openFile(CANDIDATE_SCHEMA, path);
  try {
    for (const row of rows) await writer.appendRow(row);
  } finally {
    await writer.close();
  }
}

function contentConfig(config: StageRunConfig, extractorVersion: string): JsonValue {
  return {
    schema: "geo.arcgis-zonepdf-stage-config.v1",
    expectedRecords: config.expectedRecords,
    maxPdfBytes: config.maxPdfBytes,
    visionEnabled: config.visionEnabled,
    maxVisionPages: config.maxVisionPages,
    maxVisionUsd: config.maxVisionUsd,
    extractorVersion,
  };
}

function stageReport(
  manifestSha: string,
  records: ExtractedRecord[],
  previews: ConservativeZonePreview[],
  diff: StageDiff,
): string {
  const variants = records.reduce((sum, record) => sum + record.extraction.variants.length, 0);
  const conflicts = previews.reduce((sum, row) => sum + row.conflictingFields.length, 0);
  return [
    "# Saint-Amable official zoning PDF staging",
    "",
    "Result: `READY_STAGING` (local candidate only; never a production approval).",
    "",
    `- Content manifest SHA-256: \`${manifestSha}\``,
    `- Official zone/PDF records: ${records.length}`,
    `- Preserved regulatory variants: ${variants}`,
    `- Conservative preview conflicts: ${conflicts}`,
    `- Diff: +${diff.added.length} / -${diff.removed.length} / changed ${diff.changed.length} / unchanged ${diff.unchanged.length}`,
    "- Vision fallback: recorded in the content manifest; disabled unless explicitly budgeted.",
    "- Publication capability: none.",
    "",
  ].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newReceipt(runId: string, startedAt: string): StageRunReceipt {
  return {
    schema: "geo.arcgis-zonepdf-stage-receipt.v1",
    runId,
    startedAt,
    finishedAt: startedAt,
    status: "failed",
    records: [],
    errors: [],
  };
}

async function writeReceipt(outDir: string, receipt: StageRunReceipt): Promise<string> {
  const fileId = /^[a-zA-Z0-9._-]+$/.test(receipt.runId)
    ? receipt.runId
    : `invalid-${sha256(receipt.runId).slice(0, 16)}`;
  const path = join(outDir, "receipts", `${fileId}.json`);
  await atomicWriteJson(path, receipt as unknown as JsonValue);
  return path;
}

async function verifyExistingRun(runDir: string, expectedManifestSha: string): Promise<void> {
  const wrapper = JSON.parse(await readFile(join(runDir, "content-manifest.json"), "utf8")) as {
    manifestSha256?: string;
    manifest?: JsonValue;
  };
  if (
    wrapper.manifestSha256 !== expectedManifestSha ||
    wrapper.manifest === undefined ||
    jsonHash(wrapper.manifest) !== expectedManifestSha
  ) {
    throw new Error(`existing run directory has mismatched manifest: ${runDir}`);
  }
  const manifest = wrapper.manifest as {
    logicalOutputs?: {
      variantsSha256?: string;
      previewSha256?: string;
      diffSha256?: string;
      candidateParquetSha256?: string;
    };
  };
  const checks: Array<[string, string | undefined]> = [
    ["variants.json", manifest.logicalOutputs?.variantsSha256],
    ["mono-preview.json", manifest.logicalOutputs?.previewSha256],
    ["diff.json", manifest.logicalOutputs?.diffSha256],
  ];
  for (const [file, expected] of checks) {
    const value = JSON.parse(await readFile(join(runDir, file), "utf8")) as JsonValue;
    if (!expected || jsonHash(value) !== expected) throw new Error(`existing run artifact is corrupt: ${file}`);
  }
  const parquet = await readFile(join(runDir, "candidate.parquet"));
  if (
    parquet.byteLength < 8 ||
    parquet.subarray(0, 4).toString() !== "PAR1" ||
    parquet.subarray(-4).toString() !== "PAR1"
  ) {
    throw new Error("existing run artifact is corrupt: candidate.parquet");
  }
  if (!manifest.logicalOutputs?.candidateParquetSha256 || sha256(parquet) !== manifest.logicalOutputs.candidateParquetSha256) {
    throw new Error("existing run artifact hash mismatch: candidate.parquet");
  }
  const ready = (await readFile(join(runDir, "READY_STAGING"), "utf8")).trim();
  if (ready !== expectedManifestSha) throw new Error("existing READY_STAGING does not match manifest");
}

/**
 * Run the complete local staging transaction. Content outputs are assembled in
 * a temporary directory and atomically renamed to runs/<manifest-sha>. A failed
 * run emits only its receipt and never a READY_STAGING marker.
 */
export async function runLocalZonePdfStaging(options: StageRunOptions): Promise<StageRunResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const runId = options.runId ?? `${Date.now()}-${process.pid}`;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const receipt = newReceipt(runId, now());
  const receiptByCode = new Map<string, StageRecordReceipt>();
  const cacheDir = join(options.outDir, "cache");
  const lockDir = join(options.outDir, ".stage-lock");
  let lockHeld = false;
  let createdRunDir: string | null = null;
  let currentUpdated = false;
  let previousCurrent: string | null = null;
  let receiptPath = join(options.outDir, "receipts", `${runId}.json`);
  let buildDirPath: string | null = null;

  try {
    if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error("runId contains unsafe path characters");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(options.outDir)) {
      throw new Error("outDir must be a local filesystem path");
    }
    buildDirPath = join(options.outDir, `.build-${runId}`);
    const config = resolveStageConfig(options.config);
    await mkdir(options.outDir, { recursive: true });
    try {
      await mkdir(lockDir);
      lockHeld = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") throw new Error(`staging output is locked by another writer: ${options.outDir}`);
      throw error;
    }
    const snapshot = await options.source.readSnapshot();
    const records = validateSourceRecords(snapshot, config.expectedRecords);
    if (options.extractor.preparedZoneCodes) {
      const prepared = [...options.extractor.preparedZoneCodes];
      const expected = records.map((record) => record.zoneCode);
      if (
        new Set(prepared).size !== prepared.length ||
        canonicalJson(prepared.sort(compareText)) !== canonicalJson(expected.sort(compareText))
      ) {
        throw new Error("prepared extraction codes do not exactly match source records");
      }
    }
    const fenceHash = jsonHash(fenceValue(snapshot.fence));
    const configHash = jsonHash(contentConfig(config, options.extractor.version));
    receipt.fenceHash = fenceHash;
    receipt.configHash = configHash;
    for (const record of records) {
      const row: StageRecordReceipt = {
        zoneCode: record.zoneCode,
        metadataAttempts: 0,
        downloadAttempts: 0,
        cacheHit: false,
        parseCacheHit: false,
        status: "failed",
      };
      receipt.records.push(row);
      receiptByCode.set(record.zoneCode, row);
    }

    const beforeResults = await mapLimit(records, config.metadataConcurrency, async (record) => {
      const row = receiptByCode.get(record.zoneCode)!;
      const stats = { attempts: 0 };
      let metadata: ArcgisPdfItemMetadata;
      try {
        metadata = await withRetry(
          () => options.source.readItemMetadata(record, "before-download"),
          config,
          sleep,
          stats,
        );
      } finally {
        row.metadataAttempts += stats.attempts;
      }
      validateMetadata(record, metadata, config);
      return metadata;
    });
    const phaseErrors: string[] = [];
    for (let index = 0; index < beforeResults.length; index += 1) {
      const result = beforeResults[index]!;
      if (!result.ok) {
        const code = records[index]!.zoneCode;
        receiptByCode.get(code)!.error = result.error.message;
        phaseErrors.push(`${code}: ${result.error.message}`);
      }
    }
    if (phaseErrors.length > 0) throw new Error(`metadata preflight failed: ${phaseErrors.join("; ")}`);
    const before = beforeResults.map((result) => (result as { ok: true; value: ArcgisPdfItemMetadata }).value);

    const downloadResults = await mapLimit(records, config.pdfConcurrency, async (record, index) => {
      const metadata = before[index]!;
      const row = receiptByCode.get(record.zoneCode)!;
      const cached = await loadCachedPdf(
        cacheDir,
        metadata,
        config.maxPdfBytes,
        record.expectedPdfSha256,
      );
      if (cached) {
        row.cacheHit = true;
        return {
          record,
          metadata,
          sha256: cached.sha256,
          bytesLen: cached.bytes.byteLength,
          pageCount: cached.pageCount,
          cachePath: cached.path,
          cacheHit: true,
        } satisfies DownloadedPdf;
      }
      const stats = { attempts: 0 };
      let download: PdfDownload;
      try {
        download = await withRetry(() => options.source.downloadPdf(record), config, sleep, stats);
      } finally {
        row.downloadAttempts += stats.attempts;
      }
      validatePdfDownload(record, metadata, download, config);
      const cachedResult = await cachePdf(
        cacheDir,
        metadata,
        download.bytes,
        download.pageCount,
        record.expectedPdfSha256,
      );
      return {
        record,
        metadata,
        sha256: cachedResult.sha256,
        bytesLen: download.bytes.byteLength,
        pageCount: cachedResult.pageCount,
        cachePath: cachedResult.path,
        cacheHit: false,
      } satisfies DownloadedPdf;
    });
    phaseErrors.length = 0;
    for (let index = 0; index < downloadResults.length; index += 1) {
      const result = downloadResults[index]!;
      if (!result.ok) {
        const code = records[index]!.zoneCode;
        receiptByCode.get(code)!.error = result.error.message;
        phaseErrors.push(`${code}: ${result.error.message}`);
      }
    }
    if (phaseErrors.length > 0) throw new Error(`PDF acquisition failed: ${phaseErrors.join("; ")}`);
    const downloads = downloadResults.map((result) => (result as { ok: true; value: DownloadedPdf }).value);

    const afterResults = await mapLimit(records, config.metadataConcurrency, async (record, index) => {
      const row = receiptByCode.get(record.zoneCode)!;
      const stats = { attempts: 0 };
      let metadata: ArcgisPdfItemMetadata;
      try {
        metadata = await withRetry(
          () => options.source.readItemMetadata(record, "after-download"),
          config,
          sleep,
          stats,
        );
      } finally {
        row.metadataAttempts += stats.attempts;
      }
      assertMetadataStable(record, before[index]!, metadata, config);
      return metadata;
    });
    phaseErrors.length = 0;
    for (let index = 0; index < afterResults.length; index += 1) {
      const result = afterResults[index]!;
      if (!result.ok) {
        const code = records[index]!.zoneCode;
        receiptByCode.get(code)!.error = result.error.message;
        phaseErrors.push(`${code}: ${result.error.message}`);
      }
    }
    if (phaseErrors.length > 0) throw new Error(`metadata postflight failed: ${phaseErrors.join("; ")}`);

    let visionPagesUsed = 0;
    let visionUsd = 0;
    const parseConcurrency = config.visionEnabled ? 1 : config.pdfConcurrency;
    const parseResults = await mapLimit(downloads, parseConcurrency, async (downloaded) => {
      const row = receiptByCode.get(downloaded.record.zoneCode)!;
      const parseCachePath = join(
        cacheDir,
        "parse",
        fenceHash,
        configHash,
        `${downloaded.record.itemId}-${downloaded.sha256}.json`,
      );
      const parseCacheKey = sha256(
        `${fenceHash}:${configHash}:${downloaded.record.itemId}:${downloaded.sha256}`,
      );
      let extraction: ZoneVariantExtraction;
      const cachedExtraction = await loadCachedExtraction(parseCachePath, parseCacheKey);
      if (cachedExtraction) {
        extraction = cachedExtraction;
        row.parseCacheHit = true;
      } else {
        const remainingPages = config.maxVisionPages - visionPagesUsed;
        const remainingUsd = config.maxVisionUsd - visionUsd;
        let reservedPages = 0;
        let reservedUsd = 0;
        extraction = await options.extractor.parse({
          record: downloaded.record,
          pdfPath: downloaded.cachePath,
          pdfSha256: downloaded.sha256,
          vision: {
            enabled: config.visionEnabled,
            maxPages: config.visionEnabled ? remainingPages : 0,
            maxUsd: config.visionEnabled ? remainingUsd : 0,
            reserve: (pages, usd) => {
              if (!config.visionEnabled) {
                throw new Error(`vision reservation attempted while disabled for ${downloaded.record.zoneCode}`);
              }
              if (!Number.isInteger(pages) || pages < 0 || !Number.isFinite(usd) || usd < 0) {
                throw new Error(`invalid vision reservation for ${downloaded.record.zoneCode}`);
              }
              if (
                reservedPages + pages > remainingPages ||
                reservedUsd + usd > remainingUsd + Number.EPSILON
              ) {
                throw new Error(`vision reservation exceeds budget for ${downloaded.record.zoneCode}`);
              }
              reservedPages += pages;
              reservedUsd += usd;
            },
          },
        });
        validateExtraction(downloaded.record, extraction);
        if (
          config.visionEnabled &&
          (extraction.visionPagesUsed === undefined || extraction.visionUsd === undefined)
        ) {
          throw new Error(`vision-enabled extraction omitted usage accounting for ${downloaded.record.zoneCode}`);
        }
        if (
          config.visionEnabled &&
          (extraction.visionPagesUsed !== reservedPages ||
            Math.abs((extraction.visionUsd ?? Number.NaN) - reservedUsd) > Number.EPSILON)
        ) {
          throw new Error(`vision usage differs from pre-call reservation for ${downloaded.record.zoneCode}`);
        }
        await cacheExtraction(parseCachePath, parseCacheKey, extraction);
      }
      validateExtraction(downloaded.record, extraction);
      if (
        config.visionEnabled &&
        (extraction.visionPagesUsed === undefined || extraction.visionUsd === undefined)
      ) {
        throw new Error(`vision-enabled extraction omitted usage accounting for ${downloaded.record.zoneCode}`);
      }
      const extractionVisionPages = extraction.visionPagesUsed ?? 0;
      const extractionVisionUsd = extraction.visionUsd ?? 0;
      if (!Number.isInteger(extractionVisionPages) || extractionVisionPages < 0) {
        throw new Error(`invalid vision page usage for ${downloaded.record.zoneCode}`);
      }
      if (!Number.isFinite(extractionVisionUsd) || extractionVisionUsd < 0) {
        throw new Error(`invalid vision USD usage for ${downloaded.record.zoneCode}`);
      }
      if (!config.visionEnabled && (extractionVisionPages !== 0 || extractionVisionUsd !== 0)) {
        throw new Error(`vision usage reported while vision is disabled for ${downloaded.record.zoneCode}`);
      }
      visionPagesUsed += extractionVisionPages;
      visionUsd += extractionVisionUsd;
      if (visionPagesUsed > config.maxVisionPages || visionUsd > config.maxVisionUsd + Number.EPSILON) {
        throw new Error(`vision budget exceeded while parsing ${downloaded.record.zoneCode}`);
      }
      return { ...downloaded, extraction, parseCacheHit: row.parseCacheHit } satisfies ExtractedRecord;
    });
    phaseErrors.length = 0;
    for (let index = 0; index < parseResults.length; index += 1) {
      const result = parseResults[index]!;
      if (!result.ok) {
        const code = records[index]!.zoneCode;
        receiptByCode.get(code)!.error = result.error.message;
        phaseErrors.push(`${code}: ${result.error.message}`);
      }
    }
    if (phaseErrors.length > 0) throw new Error(`variant extraction failed: ${phaseErrors.join("; ")}`);
    const extracted = parseResults
      .map((result) => (result as { ok: true; value: ExtractedRecord }).value)
      .sort((a, b) => compareText(a.record.canonicalZoneCode, b.record.canonicalZoneCode));

    const extractedCodes = extracted.map((record) => record.record.canonicalZoneCode);
    if (new Set(extractedCodes).size !== config.expectedRecords) {
      throw new Error("candidate contains duplicate canonical zone codes");
    }
    const previews = extracted.map((record) => conservativePreview(record.record, record.extraction));
    const diff = buildStageDiff(options.baseline ?? [], previews);
    const rows = candidateRows(extracted);
    const buildDir = buildDirPath;
    await rm(buildDir, { recursive: true, force: true });
    await mkdir(buildDir, { recursive: true });
    const parquetPath = join(buildDir, "candidate.parquet");
    await writeCandidateParquet(parquetPath, rows);
    const candidateParquetSha256 = sha256(await readFile(parquetPath));
    const variantsDocument: JsonValue = {
      schema: "geo.arcgis-zonepdf-variants.v1",
      zones: extracted.map((record) => ({
        zoneCode: record.record.zoneCode,
        canonicalZoneCode: record.record.canonicalZoneCode,
        itemId: record.record.itemId,
        pdfSha256: record.sha256,
        variants: record.extraction.variants,
        provenance: record.extraction.provenance ?? {},
      })) as unknown as JsonValue,
    };
    const previewDocument: JsonValue = {
      schema: "geo.arcgis-zonepdf-conservative-preview.v1",
      zones: previews as unknown as JsonValue,
    };
    const diffDocument: JsonValue = {
      schema: "geo.arcgis-zonepdf-stage-diff.v1",
      ...diff,
    } as unknown as JsonValue;
    const contentManifest: JsonValue = {
      schema: "geo.arcgis-zonepdf-stage-content.v1",
      municipality: "saint-amable",
      sourceFence: fenceValue(snapshot.fence),
      fenceHash,
      config: contentConfig(config, options.extractor.version),
      configHash,
      records: extracted.map((record) => ({
        oid: record.record.oid,
        zoneCode: record.record.zoneCode,
        canonicalZoneCode: record.record.canonicalZoneCode,
        group: record.record.group,
        pdfUrl: record.record.pdfUrl,
        item: record.metadata,
        pdfSha256: record.sha256,
        bytesLen: record.bytesLen,
        pageCount: record.pageCount,
        variantCount: record.extraction.variants.length,
        extractionSha256: jsonHash(record.extraction as unknown as JsonValue),
      })) as unknown as JsonValue,
      totals: {
        records: extracted.length,
        variants: rows.length,
        visionPagesUsed,
        visionUsd,
      },
      logicalOutputs: {
        variantsSha256: jsonHash(variantsDocument),
        previewSha256: jsonHash(previewDocument),
        diffSha256: jsonHash(diffDocument),
        candidateRowsSha256: jsonHash(rows as unknown as JsonValue),
        candidateParquetSha256,
      },
    };
    const manifestSha256 = jsonHash(contentManifest);
    const runDir = join(options.outDir, "runs", manifestSha256);
    await atomicWriteJson(
      join(buildDir, "content-manifest.json"),
      { manifestSha256, manifest: contentManifest },
    );
    await atomicWriteJson(join(buildDir, "variants.json"), variantsDocument);
    await atomicWriteJson(join(buildDir, "mono-preview.json"), previewDocument);
    await atomicWriteJson(join(buildDir, "diff.json"), diffDocument);
    await atomicWrite(join(buildDir, "STAGING_REPORT.md"), stageReport(manifestSha256, extracted, previews, diff));
    await atomicWrite(join(buildDir, "READY_STAGING"), `${manifestSha256}\n`);

    // Re-fence every ArcGIS item after parsing/materialization: a PDF item can
    // revise independently of the FeatureService editing fence.
    const finalMetadataResults = await mapLimit(records, config.metadataConcurrency, async (record, index) => {
      const row = receiptByCode.get(record.zoneCode)!;
      const stats = { attempts: 0 };
      let metadata: ArcgisPdfItemMetadata;
      try {
        metadata = await withRetry(
          () => options.source.readItemMetadata(record, "after-download"),
          config,
          sleep,
          stats,
        );
      } finally {
        row.metadataAttempts += stats.attempts;
      }
      assertMetadataStable(record, before[index]!, metadata, config);
      return metadata;
    });
    phaseErrors.length = 0;
    for (let index = 0; index < finalMetadataResults.length; index += 1) {
      const result = finalMetadataResults[index]!;
      if (!result.ok) {
        const code = records[index]!.zoneCode;
        receiptByCode.get(code)!.error = result.error.message;
        phaseErrors.push(`${code}: ${result.error.message}`);
      }
    }
    if (phaseErrors.length > 0) {
      throw new Error(`final item metadata fence failed: ${phaseErrors.join("; ")}`);
    }

    // Last remote read before the local atomic commit. This fences the complete
    // acquisition, parse and candidate materialization transaction.
    const fenceT1 = await options.source.readFence();
    assertFenceStable(snapshot.fence, fenceT1);

    previousCurrent = await readOptionalText(join(options.outDir, "CURRENT"));
    await mkdir(dirname(runDir), { recursive: true });
    if (await pathExists(runDir)) {
      try {
        await verifyExistingRun(runDir, manifestSha256);
      } catch (error) {
        const current = await readOptionalText(join(options.outDir, "CURRENT")).catch(() => null);
        if (current?.trim() === manifestSha256) {
          await rm(join(options.outDir, "CURRENT"), { force: true }).catch(() => undefined);
        }
        await rm(join(runDir, "READY_STAGING"), { force: true }).catch(() => undefined);
        throw error;
      }
      await rm(buildDir, { recursive: true, force: true });
    } else {
      await rename(buildDir, runDir);
      createdRunDir = runDir;
    }

    for (const row of receipt.records) {
      row.status = "ok";
      delete row.error;
    }
    receipt.status = "ready";
    receipt.finishedAt = now();
    receipt.manifestSha256 = manifestSha256;
    receipt.runDir = runDir;
    receiptPath = await writeReceipt(options.outDir, receipt);
    // CURRENT is the final commit point: no fallible filesystem work follows it.
    await atomicWrite(join(options.outDir, "CURRENT"), `${manifestSha256}\n`);
    currentUpdated = true;
    return { status: "ready", manifestSha256, runDir, receiptPath, errors: [] };
  } catch (error) {
    const message = errorMessage(error);
    if (currentUpdated) {
      if (previousCurrent === null) {
        await rm(join(options.outDir, "CURRENT"), { force: true }).catch(() => undefined);
      } else {
        await atomicWrite(join(options.outDir, "CURRENT"), previousCurrent).catch(() => undefined);
      }
      currentUpdated = false;
    }
    if (createdRunDir) {
      await rm(createdRunDir, { recursive: true, force: true }).catch(() => undefined);
      createdRunDir = null;
    }
    receipt.errors.push(message);
    receipt.finishedAt = now();
    receipt.status = "failed";
    delete receipt.manifestSha256;
    delete receipt.runDir;
    if (buildDirPath) {
      await rm(buildDirPath, { recursive: true, force: true }).catch(() => undefined);
    }
    receiptPath = await writeReceipt(options.outDir, receipt);
    return { status: "failed", receiptPath, errors: [...receipt.errors] };
  } finally {
    if (lockHeld) await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
