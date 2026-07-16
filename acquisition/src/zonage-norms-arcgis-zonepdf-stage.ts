#!/usr/bin/env node

/**
 * Local-only Saint-Amable zoning-PDF staging runner.
 *
 * This CLI intentionally consumes frozen local Lot 1/Lot 2 JSON adapters. It
 * has no network client, no S3 import and no publication flag. Production
 * adapters can implement the library ports later without widening this CLI.
 */
import { open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  SAINT_AMABLE_ZONEPDF_SOURCE,
  assertStableSourceFence,
  canonicalJson as canonicalSourceJson,
  type ZonePdfContentManifest,
  type ZonePdfManifestRecord,
} from "./lib/arcgis-zonepdf-stage.js";
import {
  adaptSerializedLot2Extraction,
  runLocalZonePdfStaging,
  sha256,
  type ArcgisPdfItemMetadata,
  type ArcgisZonePdfExtractorPort,
  type ArcgisZonePdfSourcePort,
  type ConservativeZonePreview,
  type MetadataPhase,
  type SourceFence,
  type SerializedLot2ZoneExtraction,
  type ZonePdfExtractInput,
  type ZonePdfSourceRecord,
  type ZoneVariantExtraction,
} from "./lib/arcgis-zonepdf-stage-runner.js";

interface LocalSourceManifest {
  contentManifest: ZonePdfContentManifest;
  /** Local PDF paths keyed by the Lot 1 ArcGIS item ID. */
  pdfPaths: Record<string, string>;
}

interface LocalExtractions {
  version: string;
  zones: SerializedLot2ZoneExtraction[];
}

export interface StageCliArgs {
  sourceManifest: string;
  extractions: string;
  outDir: string;
  baseline?: string;
  expectedRecords: number;
  metadataConcurrency: number;
  pdfConcurrency: number;
  maxAttempts: number;
  maxPdfBytes: number;
  visionEnabled: boolean;
  maxVisionPages: number;
  maxVisionUsd: number;
}

const VALUE_FLAGS = new Set([
  "source-manifest",
  "extractions",
  "out",
  "baseline",
  "metadata-concurrency",
  "pdf-concurrency",
  "max-attempts",
  "max-pdf-bytes",
  "max-vision-pages",
  "max-vision-usd",
]);
const BOOLEAN_FLAGS = new Set(["allow-vision"]);

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

function numberArg(values: Map<string, string>, name: string, fallback: number): number {
  const raw = values.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be numeric`);
  return value;
}

function localPath(raw: string, name: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    throw new Error(`--${name} must be a local filesystem path`);
  }
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

export function parseStageCliArgs(argv: string[]): StageCliArgs {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) throw new Error(`unexpected positional argument: ${token}`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      booleans.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new Error(`unknown flag --${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${name}`);
    values.set(name, value);
    index += 1;
  }

  const visionEnabled = booleans.has("allow-vision");
  const args: StageCliArgs = {
    sourceManifest: localPath(required(values, "source-manifest"), "source-manifest"),
    extractions: localPath(required(values, "extractions"), "extractions"),
    outDir: localPath(required(values, "out"), "out"),
    expectedRecords: SAINT_AMABLE_ZONEPDF_SOURCE.expectedCount,
    metadataConcurrency: numberArg(values, "metadata-concurrency", 4),
    pdfConcurrency: numberArg(values, "pdf-concurrency", 3),
    maxAttempts: numberArg(values, "max-attempts", 4),
    maxPdfBytes: numberArg(values, "max-pdf-bytes", SAINT_AMABLE_ZONEPDF_SOURCE.maxPdfBytes),
    visionEnabled,
    maxVisionPages: numberArg(values, "max-vision-pages", 0),
    maxVisionUsd: numberArg(values, "max-vision-usd", 0),
  };
  const baseline = values.get("baseline");
  if (baseline) args.baseline = localPath(baseline, "baseline");
  if (!visionEnabled && (args.maxVisionPages !== 0 || args.maxVisionUsd !== 0)) {
    throw new Error("vision budgets require --allow-vision");
  }
  if (visionEnabled && (args.maxVisionPages <= 0 || args.maxVisionUsd <= 0)) {
    throw new Error("--allow-vision requires positive --max-vision-pages and --max-vision-usd");
  }
  if (args.maxPdfBytes > SAINT_AMABLE_ZONEPDF_SOURCE.maxPdfBytes) {
    throw new Error("--max-pdf-bytes cannot exceed the pinned Lot 1 source bound");
  }
  return args;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Open one regular local file and read exactly the already-fenced byte count. */
export async function readLocalPdfBounded(
  path: string,
  expectedBytes: number,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) {
    throw new Error("Lot 1 PDF byte count must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || expectedBytes > maxBytes) {
    throw new Error("Lot 1 PDF exceeds the configured local byte cap");
  }
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size !== expectedBytes) {
      throw new Error(`local PDF size ${before.size} differs from Lot 1 evidence ${expectedBytes}`);
    }
    const bytes = Buffer.allocUnsafe(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const read = await handle.read(bytes, offset, expectedBytes - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (offset !== expectedBytes || after.size !== before.size) {
      throw new Error("local PDF changed or truncated during bounded read");
    }
    const probe = Buffer.allocUnsafe(1);
    const trailing = await handle.read(probe, 0, 1, expectedBytes);
    if (trailing.bytesRead !== 0) throw new Error("local PDF grew during bounded read");
    return bytes;
  } finally {
    await handle.close();
  }
}

class LocalFrozenSource implements ArcgisZonePdfSourcePort {
  readonly manifest: LocalSourceManifest;
  readonly rootDir: string;
  readonly maxPdfBytes: number;
  readonly records: ZonePdfSourceRecord[];
  readonly sourceByOid: Map<number, ZonePdfManifestRecord>;

  constructor(manifest: LocalSourceManifest, manifestPath: string, maxPdfBytes: number) {
    this.manifest = manifest;
    this.rootDir = dirname(manifestPath);
    this.maxPdfBytes = maxPdfBytes;
    const content = manifest.contentManifest;
    const payload = {
      schemaVersion: content.schemaVersion,
      sourceT0: content.sourceT0,
      sourceT1: content.sourceT1,
      records: content.records,
    };
    if (sha256(canonicalSourceJson(payload)) !== content.manifestSha256) {
      throw new Error("Lot 1 content manifest SHA-256 mismatch");
    }
    assertStableSourceFence(content.sourceT0, content.sourceT1);
    if (
      content.sourceT0.serviceItemId.toLowerCase() !==
        SAINT_AMABLE_ZONEPDF_SOURCE.serviceItemId.toLowerCase() ||
      content.sourceT0.layerUrl !== SAINT_AMABLE_ZONEPDF_SOURCE.layerUrl ||
      content.sourceT0.count !== SAINT_AMABLE_ZONEPDF_SOURCE.expectedCount ||
      content.records.length !== SAINT_AMABLE_ZONEPDF_SOURCE.expectedCount
    ) {
      throw new Error("Lot 1 manifest is not the pinned 109-record Saint-Amable source");
    }
    const expectedPathKeys = content.records.map((record) => record.itemId).sort();
    if (canonicalSourceJson(Object.keys(manifest.pdfPaths).sort()) !== canonicalSourceJson(expectedPathKeys)) {
      throw new Error("local PDF path set does not exactly match the Lot 1 manifest");
    }
    this.sourceByOid = new Map(content.records.map((record) => [record.oid, record]));
    this.records = content.records.map((record) => ({
      oid: record.oid,
      zoneCode: record.code,
      canonicalZoneCode: record.code,
      group: record.group,
      pdfUrl: record.pdfUrl,
      itemId: record.itemId,
      expectedPdfSha256: record.pdf.sha256,
      expectedOwner: SAINT_AMABLE_ZONEPDF_SOURCE.expectedItemOwner,
    }));
  }

  async readSnapshot(): Promise<{ fence: SourceFence; records: ZonePdfSourceRecord[] }> {
    return { fence: this.manifest.contentManifest.sourceT0, records: this.records };
  }

  async readFence(): Promise<SourceFence> {
    return this.manifest.contentManifest.sourceT1;
  }

  async readItemMetadata(
    record: ZonePdfSourceRecord,
    phase: MetadataPhase,
  ): Promise<ArcgisPdfItemMetadata> {
    const local = this.sourceByOid.get(record.oid);
    if (!local) throw new Error(`missing local source record for OID ${record.oid}`);
    return phase === "after-download" ? local.itemT1 : local.itemT0;
  }

  async downloadPdf(record: ZonePdfSourceRecord): Promise<{
    bytes: Uint8Array;
    finalUrl: string;
    contentType: string;
    contentLength: number;
    pageCount: number;
  }> {
    const local = this.sourceByOid.get(record.oid);
    if (!local) throw new Error(`missing local PDF for OID ${record.oid}`);
    const pdfPath = this.manifest.pdfPaths[record.itemId];
    if (!pdfPath) throw new Error(`missing local PDF path for ${record.zoneCode}`);
    const path = isAbsolute(pdfPath) ? pdfPath : resolve(this.rootDir, pdfPath);
    const bytes = await readLocalPdfBounded(path, local.pdf.byteLength, this.maxPdfBytes);
    if (sha256(bytes) !== local.pdf.sha256) {
      throw new Error(`local PDF SHA-256 differs from Lot 1 manifest for ${record.zoneCode}`);
    }
    return {
      bytes,
      finalUrl: local.pdf.finalUrl,
      contentType: local.pdf.contentType,
      contentLength: local.pdf.contentLength,
      pageCount: local.pdf.pageCount,
    };
  }
}

export class LocalFrozenExtractor implements ArcgisZonePdfExtractorPort {
  readonly version: string;
  readonly preparedZoneCodes: readonly string[];
  readonly byCode: Map<string, SerializedLot2ZoneExtraction>;

  constructor(extractions: LocalExtractions) {
    if (typeof extractions.version !== "string" || extractions.version.trim() === "") {
      throw new Error("frozen Lot 2 extraction version must be non-empty");
    }
    if (!Array.isArray(extractions.zones)) {
      throw new Error("frozen Lot 2 extractions must contain a zones array");
    }
    this.version = extractions.version;
    this.preparedZoneCodes = extractions.zones.map((zone, index) => {
      if (zone === null || typeof zone !== "object" || typeof zone.zone_code !== "string") {
        throw new Error(`frozen Lot 2 extraction ${index} has no zone_code`);
      }
      return zone.zone_code;
    });
    if (new Set(this.preparedZoneCodes).size !== this.preparedZoneCodes.length) {
      throw new Error("frozen extractions contain duplicate zone codes");
    }
    this.byCode = new Map(extractions.zones.map((zone) => [zone.zone_code, zone]));
  }

  async parse(input: ZonePdfExtractInput): Promise<ZoneVariantExtraction> {
    const extraction = this.byCode.get(input.record.zoneCode);
    if (!extraction) throw new Error(`missing frozen extraction for ${input.record.zoneCode}`);
    return adaptSerializedLot2Extraction(extraction, {
      zoneCode: input.record.zoneCode,
      pdfSha256: input.pdfSha256,
      sourceUrl: input.record.pdfUrl,
    });
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseStageCliArgs(argv);
    const manifest = await readJson<LocalSourceManifest>(args.sourceManifest);
    const extractions = await readJson<LocalExtractions>(args.extractions);
    const baseline = args.baseline
      ? await readJson<ConservativeZonePreview[]>(args.baseline)
      : undefined;
    const result = await runLocalZonePdfStaging({
      outDir: args.outDir,
      source: new LocalFrozenSource(manifest, args.sourceManifest, args.maxPdfBytes),
      extractor: new LocalFrozenExtractor(extractions),
      ...(baseline ? { baseline } : {}),
      config: {
        expectedRecords: args.expectedRecords,
        metadataConcurrency: args.metadataConcurrency,
        pdfConcurrency: args.pdfConcurrency,
        maxAttempts: args.maxAttempts,
        maxPdfBytes: args.maxPdfBytes,
        visionEnabled: args.visionEnabled,
        maxVisionPages: args.maxVisionPages,
        maxVisionUsd: args.maxVisionUsd,
      },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "ready" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = await main();
}
