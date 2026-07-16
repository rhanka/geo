import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalFrozenExtractor } from "../zonage-norms-arcgis-zonepdf-stage.js";

import {
  RetryableStageError,
  adaptSerializedLot2Extraction,
  buildStageDiff,
  canonicalJson,
  conservativePreview,
  runLocalZonePdfStaging,
  sha256,
  type ArcgisPdfItemMetadata,
  type ArcgisZonePdfExtractorPort,
  type ArcgisZonePdfSourcePort,
  type MetadataPhase,
  type SourceFence,
  type SerializedLot2ZoneExtraction,
  type ZonePdfSourceRecord,
  type ZonePdfExtractInput,
  type ZoneVariantExtraction,
} from "./arcgis-zonepdf-stage-runner.js";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function outputDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zonepdf-stage-test-"));
  roots.push(root);
  return root;
}

function pdf(label: string): Uint8Array {
  return Buffer.from(`%PDF-1.7\n${label}\n%%EOF\n`);
}

function itemId(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function record(index: number, code: string): ZonePdfSourceRecord {
  const id = itemId(index);
  return {
    oid: index,
    zoneCode: code,
    canonicalZoneCode: code,
    group: "H | Résidentielle",
    pdfUrl: `https://mrcdemdy.maps.arcgis.com/sharing/rest/content/items/${id}/data`,
    itemId: id,
    expectedPdfSha256: sha256(pdf(code)),
    expectedOwner: "melement",
  };
}

function metadata(source: ZonePdfSourceRecord, bytes: Uint8Array): ArcgisPdfItemMetadata {
  return {
    id: source.itemId,
    title: source.canonicalZoneCode,
    type: "PDF",
    owner: "melement",
    access: "public",
    created: 1_700_000_000_000,
    modified: 1_780_000_000_000 + source.oid,
    size: bytes.byteLength,
  };
}

function fence(records: ZonePdfSourceRecord[]): SourceFence {
  return {
    serviceItemId: "8d02d8f25e9648de9972663e930d3b11",
    serviceModified: 1_781_099_362_000,
    layerUrl:
      "https://services3.arcgis.com/D6yGeV5bY0BWDvJi/arcgis/rest/services/Plan_de_zonage_WFL1/FeatureServer/0",
    objectIdField: "id",
    editing: {
      lastEditDate: 1_781_099_351_557,
      dataLastEditDate: 1_781_099_351_557,
      schemaLastEditDate: 1_781_099_351_557,
    },
    count: records.length,
    objectIds: records.map((source) => source.oid).reverse(),
  };
}

function extraction(code: string, max: number, secondMax = max): ZoneVariantExtraction {
  return {
    zoneCode: code,
    variants: [max, secondMax].map((height, columnIndex) => ({
      columnIndex,
      bbox: { x0: 100 + columnIndex * 20, y0: 0, x1: 120 + columnIndex * 20, y1: 700 },
      usages: ["h1", "p2"],
      structure: columnIndex === 0 ? ["isolée"] : ["jumelée"],
      footnotes: columnIndex === 0 ? [] : ["*27"],
      fields: { hauteur_min: 1, hauteur_max: height, marge_avant_min: 7.5 },
    })),
    provenance: { method: "native-bbox" },
  };
}

function serializedLot2Extraction(
  code: string,
  sourceSha256 = sha256(pdf(code)),
): SerializedLot2ZoneExtraction {
  return {
    zone_code: code,
    source_url: `https://mrcdemdy.maps.arcgis.com/source/${code}.pdf`,
    source_sha256: sourceSha256,
    snapshot: "source-fence-sha256",
    page: 1,
    header_observations: [
      { method: "pdftohtml-xml/native-bbox", raw_zone_codes: [code] },
      { method: "layout-text", raw_zone_codes: [code] },
    ],
    variants: [
      {
        column_index: 0,
        bbox: { x0: 100, y0: 10, x1: 200, y1: 700 },
        usages: ["h1", "p2"],
        structures: ["Isolée"],
        norms: {
          hauteur_etages: {
            raw: "1 / 2",
            value: null,
            min: 1,
            max: 2,
            unit: "etages",
            bbox: { x0: 110, y0: 400, x1: 150, y1: 420 },
            scope: "column",
          },
        },
        footnotes: ["*27"],
      },
    ],
  };
}

describe("adaptSerializedLot2Extraction", () => {
  it("should map the serialized Lot 2 contract without losing bbox, norms or provenance", () => {
    const source = serializedLot2Extraction("H-59");
    const before = JSON.stringify(source);

    const adapted = adaptSerializedLot2Extraction(source, {
      zoneCode: "H-59",
      pdfSha256: source.source_sha256,
    });

    expect(adapted).toMatchObject({
      zoneCode: "H-59",
      provenance: {
        source_url: source.source_url,
        source_sha256: source.source_sha256,
        snapshot: source.snapshot,
        page: 1,
        header_observations: source.header_observations,
      },
      variants: [
        {
          columnIndex: 0,
          bbox: source.variants[0]!.bbox,
          usages: ["h1", "p2"],
          structure: ["Isolée"],
          footnotes: ["*27"],
          fields: source.variants[0]!.norms,
        },
      ],
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("should reject a Lot 2 result whose source SHA differs from the staged PDF", () => {
    const source = serializedLot2Extraction("H-59", "a".repeat(64));

    expect(() =>
      adaptSerializedLot2Extraction(source, {
        zoneCode: "H-59",
        pdfSha256: "b".repeat(64),
      }),
    ).toThrow("Lot 2 source_sha256 does not match pinned PDF SHA-256 for H-59");
  });

  it("should reject string-coerced bbox coordinates from malformed Lot 2 JSON", () => {
    const source = serializedLot2Extraction("H-59") as unknown as {
      variants: Array<{ bbox: Record<string, unknown> }>;
      source_sha256: string;
    };
    source.variants[0]!.bbox["x0"] = "100";

    expect(() =>
      adaptSerializedLot2Extraction(source, {
        zoneCode: "H-59",
        pdfSha256: source.source_sha256,
      }),
    ).toThrow("Lot 2 variant 0 has a non-finite bbox");
  });

  it("should require two structured independent header observations and page one", () => {
    const badHeader = serializedLot2Extraction("H-59") as unknown as {
      header_observations: Array<Record<string, unknown>>;
      source_sha256: string;
    };
    badHeader.header_observations[1]!["method"] = "";
    expect(() =>
      adaptSerializedLot2Extraction(badHeader, {
        zoneCode: "H-59",
        pdfSha256: badHeader.source_sha256,
      }),
    ).toThrow("Lot 2 header observation 1 method must be a non-empty string");

    const wrongPage = serializedLot2Extraction("H-59") as unknown as {
      page: number;
      source_sha256: string;
    };
    wrongPage.page = 2;
    expect(() =>
      adaptSerializedLot2Extraction(wrongPage, {
        zoneCode: "H-59",
        pdfSha256: wrongPage.source_sha256,
      }),
    ).toThrow("Lot 2 page must equal the one-page Lot 1 evidence for H-59");
  });

  it("should reject duplicate methods, empty headers and foreign observed codes", () => {
    const sameMethod = serializedLot2Extraction("H-59");
    sameMethod.header_observations[1] = {
      method: "pdftohtml-xml/native-bbox",
      raw_zone_codes: ["H-59"],
    };
    expect(() =>
      adaptSerializedLot2Extraction(sameMethod, {
        zoneCode: "H-59",
        pdfSha256: sameMethod.source_sha256,
      }),
    ).toThrow("Lot 2 header observation methods must be distinct for H-59");

    const emptyHeader = serializedLot2Extraction("H-59");
    emptyHeader.header_observations[0] = {
      method: "pdftohtml-xml/native-bbox",
      raw_zone_codes: [],
    };
    expect(() =>
      adaptSerializedLot2Extraction(emptyHeader, {
        zoneCode: "H-59",
        pdfSha256: emptyHeader.source_sha256,
      }),
    ).toThrow("Lot 2 header observation 0 has no raw zone codes");

    const wrongCode = serializedLot2Extraction("H-59");
    wrongCode.header_observations[0] = {
      method: "pdftohtml-xml/native-bbox",
      raw_zone_codes: ["CEN-181"],
    };
    expect(() =>
      adaptSerializedLot2Extraction(wrongCode, {
        zoneCode: "H-59",
        pdfSha256: wrongCode.source_sha256,
      }),
    ).toThrow("Lot 2 header observation 0 code CEN-181 != pinned code H-59");
  });

  it("should preserve Lot 2 rejection of colliding raw header presentations", () => {
    const source = serializedLot2Extraction("H-59");
    source.header_observations[1] = {
      method: "layout-text",
      raw_zone_codes: ["H - 59"],
    };

    expect(() =>
      adaptSerializedLot2Extraction(source, {
        zoneCode: "H-59",
        pdfSha256: source.source_sha256,
      }),
    ).toThrow("Lot 2 header normalization collision for H-59");
  });

  it("should reject usages outside the closed Saint-Amable vocabulary", () => {
    const source = serializedLot2Extraction("H-59");
    source.variants[0]!.usages = ["Isolée"];

    expect(() =>
      adaptSerializedLot2Extraction(source, {
        zoneCode: "H-59",
        pdfSha256: source.source_sha256,
      }),
    ).toThrow("Lot 2 variant 0 contains an invalid authorized usage");
  });

  it("should require the Lot 2 zone code to match exact case and hyphen form", () => {
    const source = serializedLot2Extraction("h-59");
    expect(() =>
      adaptSerializedLot2Extraction(source, {
        zoneCode: "H-59",
        pdfSha256: source.source_sha256,
      }),
    ).toThrow("Lot 2 zone_code h-59 != pinned code H-59");
  });

  it("should reject unknown norm keys and non-exact norm cells", () => {
    const cases: Array<(source: SerializedLot2ZoneExtraction) => void> = [
      (source) => {
        source.variants[0]!.norms = { foreign_norm: 42 };
      },
      (source) => {
        const cell = source.variants[0]!.norms.hauteur_etages as Record<string, unknown>;
        cell.unit = "m";
      },
      (source) => {
        const cell = source.variants[0]!.norms.hauteur_etages as Record<string, unknown>;
        cell.scope = "global";
      },
      (source) => {
        const cell = source.variants[0]!.norms.hauteur_etages as Record<string, unknown>;
        delete cell.raw;
      },
      (source) => {
        const cell = source.variants[0]!.norms.hauteur_etages as Record<string, unknown>;
        (cell.bbox as Record<string, unknown>).extra = 1;
      },
      (source) => {
        const cell = source.variants[0]!.norms.hauteur_etages as Record<string, unknown>;
        (cell.bbox as Record<string, unknown>).x0 = -1;
      },
      (source) => {
        const cell = source.variants[0]!.norms.hauteur_etages as Record<string, unknown>;
        cell.min = "1";
      },
      (source) => {
        source.variants[0]!.norms = {
          marge_avant_min: {
            raw: "7.5",
            value: 7.5,
            min: 1,
            max: 2,
            unit: "m",
            bbox: { x0: 110, y0: 400, x1: 150, y1: 420 },
            scope: "column",
          },
        };
      },
    ];

    for (const mutate of cases) {
      const source = serializedLot2Extraction("H-59");
      mutate(source);
      expect(() =>
        adaptSerializedLot2Extraction(source, {
          zoneCode: "H-59",
          pdfSha256: source.source_sha256,
        }),
      ).toThrow(/Lot 2 norm/);
    }
  });
});

class MockSource implements ArcgisZonePdfSourcePort {
  readonly records: ZonePdfSourceRecord[];
  readonly bodies = new Map<string, Uint8Array>();
  readonly metadataByCode = new Map<string, ArcgisPdfItemMetadata>();
  fenceAfter?: SourceFence;
  metadataAfterByCode = new Map<string, ArcgisPdfItemMetadata>();
  downloadCalls = 0;
  activeDownloads = 0;
  maxActiveDownloads = 0;
  transientDownloadFailures = new Map<string, number>();
  permanentDownloadFailure?: string;
  pageCountByCode = new Map<string, number>();
  finalUrlByCode = new Map<string, string>();

  constructor(records: ZonePdfSourceRecord[]) {
    this.records = records;
    for (const source of records) {
      const bytes = pdf(source.zoneCode);
      this.bodies.set(source.zoneCode, bytes);
      this.metadataByCode.set(source.zoneCode, metadata(source, bytes));
    }
  }

  async readSnapshot(): Promise<{ fence: SourceFence; records: ZonePdfSourceRecord[] }> {
    return { fence: fence(this.records), records: this.records };
  }

  async readFence(): Promise<SourceFence> {
    return this.fenceAfter ?? fence(this.records);
  }

  async readItemMetadata(
    source: ZonePdfSourceRecord,
    phase: MetadataPhase,
  ): Promise<ArcgisPdfItemMetadata> {
    const value =
      phase === "after-download"
        ? this.metadataAfterByCode.get(source.zoneCode) ?? this.metadataByCode.get(source.zoneCode)
        : this.metadataByCode.get(source.zoneCode);
    if (!value) throw new Error(`missing metadata ${source.zoneCode}`);
    return value;
  }

  async downloadPdf(source: ZonePdfSourceRecord): Promise<{
    bytes: Uint8Array;
    finalUrl: string;
    contentType: string;
    contentLength: number;
    pageCount: number;
  }> {
    this.downloadCalls += 1;
    this.activeDownloads += 1;
    this.maxActiveDownloads = Math.max(this.maxActiveDownloads, this.activeDownloads);
    try {
      await Promise.resolve();
      if (this.permanentDownloadFailure === source.zoneCode) {
        throw new RetryableStageError("upstream 503", 11);
      }
      const failures = this.transientDownloadFailures.get(source.zoneCode) ?? 0;
      if (failures > 0) {
        this.transientDownloadFailures.set(source.zoneCode, failures - 1);
        throw new RetryableStageError("upstream 429", 17);
      }
      const bytes = this.bodies.get(source.zoneCode)!;
      return {
        bytes,
        finalUrl: this.finalUrlByCode.get(source.zoneCode) ?? source.pdfUrl,
        contentType: "application/pdf",
        contentLength: bytes.byteLength,
        pageCount: this.pageCountByCode.get(source.zoneCode) ?? 1,
      };
    } finally {
      this.activeDownloads -= 1;
    }
  }
}

class MockExtractor implements ArcgisZonePdfExtractorPort {
  readonly version = "native-variants-test-v1";
  calls = 0;
  readonly extractions: Map<string, ZoneVariantExtraction>;
  onParse?: (code: string) => void;
  expectedVisionEnabled = false;
  visionReservation?: { pages: number; usd: number };

  constructor(extractions: ZoneVariantExtraction[]) {
    this.extractions = new Map(extractions.map((value) => [value.zoneCode, value]));
  }

  async parse(input: ZonePdfExtractInput): Promise<ZoneVariantExtraction> {
    this.calls += 1;
    expect(input.vision.enabled).toBe(this.expectedVisionEnabled);
    this.onParse?.(input.record.zoneCode);
    if (this.visionReservation) {
      input.vision.reserve(this.visionReservation.pages, this.visionReservation.usd);
    }
    const value = this.extractions.get(input.record.zoneCode);
    if (!value) throw new Error(`missing extraction ${input.record.zoneCode}`);
    return value;
  }
}

describe("runLocalZonePdfStaging", () => {
  it("should reproduce one canonical manifest and resume from validated local caches", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59"), record(2, "HCV-187")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([extraction("H-59", 2), extraction("HCV-187", 2, 3)]);

    const first = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "first",
      now: (() => {
        const values = ["2026-07-15T00:00:00.000Z", "2026-07-15T00:00:01.000Z"];
        return () => values.shift() ?? "2026-07-15T00:00:01.000Z";
      })(),
      config: { expectedRecords: 2 },
    });
    const second = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "second",
      now: (() => {
        const values = ["2026-07-16T00:00:00.000Z", "2026-07-16T00:00:01.000Z"];
        return () => values.shift() ?? "2026-07-16T00:00:01.000Z";
      })(),
      config: { expectedRecords: 2 },
    });

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect(source.downloadCalls).toBe(2);
    expect(extractor.calls).toBe(2);
    const runDir = first.runDir!;
    const files = (await readdir(runDir)).sort();
    expect(files).toEqual([
      "READY_STAGING",
      "STAGING_REPORT.md",
      "candidate.parquet",
      "content-manifest.json",
      "diff.json",
      "mono-preview.json",
      "variants.json",
    ]);
    expect((await readFile(join(runDir, "candidate.parquet"))).subarray(0, 4).toString()).toBe("PAR1");
    const manifestText = await readFile(join(runDir, "content-manifest.json"), "utf8");
    expect(manifestText).not.toContain("startedAt");
    expect(manifestText).not.toContain("finishedAt");
    const secondReceipt = JSON.parse(await readFile(second.receiptPath, "utf8")) as {
      records: Array<{ cacheHit: boolean; parseCacheHit: boolean }>;
    };
    expect(secondReceipt.records.every((row) => row.cacheHit && row.parseCacheHit)).toBe(true);
  });

  it("should cap PDF concurrency and honor Retry-After before succeeding", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59"), record(2, "CEN-181"), record(3, "TR-184")];
    const source = new MockSource(records);
    source.transientDownloadFailures.set("CEN-181", 1);
    const extractor = new MockExtractor(records.map((sourceRecord) => extraction(sourceRecord.zoneCode, 2)));
    const delays: number[] = [];

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "retry",
      config: { expectedRecords: 3, pdfConcurrency: 2, maxAttempts: 3 },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result.status).toBe("ready");
    expect(source.maxActiveDownloads).toBeLessThanOrEqual(2);
    expect(source.downloadCalls).toBe(4);
    expect(delays).toEqual([17]);
  });

  it("should re-download and atomically heal a corrupt local CAS entry", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([extraction("H-59", 2)]);
    const first = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "cache-seed",
      config: { expectedRecords: 1 },
    });
    expect(first.status).toBe("ready");
    const [casName] = await readdir(join(outDir, "cache", "cas"));
    const casPath = join(outDir, "cache", "cas", casName!);
    await writeFile(casPath, "%PDF-corrupt");

    const second = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "cache-heal",
      config: { expectedRecords: 1 },
    });

    expect(second.status).toBe("ready");
    expect(source.downloadCalls).toBe(2);
    expect((await readFile(casPath)).toString()).toContain("H-59");
  });

  it("should reject a coherently forged CAS and index not anchored to the Lot 1 SHA", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([extraction("H-59", 2)]);
    const first = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "cache-anchor-seed",
      config: { expectedRecords: 1 },
    });
    expect(first.status).toBe("ready");

    const [indexName] = await readdir(join(outDir, "cache", "index"));
    const indexPath = join(outDir, "cache", "index", indexName!);
    const index = JSON.parse(await readFile(indexPath, "utf8")) as { sha256: string };
    const forged = Buffer.from(pdf("H-58"));
    expect(forged.byteLength).toBe(source.bodies.get("H-59")!.byteLength);
    const forgedSha = sha256(forged);
    await writeFile(join(outDir, "cache", "cas", `${forgedSha}.pdf`), forged);
    index.sha256 = forgedSha;
    await writeFile(indexPath, JSON.stringify(index));

    const second = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "cache-anchor-check",
      config: { expectedRecords: 1 },
    });

    expect(second.status).toBe("ready");
    expect(source.downloadCalls).toBe(2);
    expect((await readFile(join(outDir, "CURRENT"), "utf8")).trim()).toBe(first.manifestSha256);
  });

  it("should reject a cached PDF when a later run lowers the configured size cap", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([extraction("H-59", 2)]);
    const first = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "large-cap",
      config: { expectedRecords: 1, maxPdfBytes: 1_024 },
    });
    expect(first.status).toBe("ready");

    const second = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "small-cap",
      config: { expectedRecords: 1, maxPdfBytes: 8 },
    });

    expect(second.status).toBe("failed");
    expect(second.errors.join(" ")).toContain("item exceeds configured PDF size limit");
    expect(source.downloadCalls).toBe(1);
  });

  it("should emit a failure receipt and no READY marker after a capped partial failure", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59"), record(2, "CEN-181")];
    const source = new MockSource(records);
    source.permanentDownloadFailure = "CEN-181";
    const extractor = new MockExtractor(records.map((sourceRecord) => extraction(sourceRecord.zoneCode, 2)));

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "partial-failure",
      config: { expectedRecords: 2, maxAttempts: 2 },
      sleep: async () => undefined,
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("PDF acquisition failed");
    expect(await readdir(outDir)).not.toContain("READY_STAGING");
    await expect(readdir(join(outDir, "runs"))).rejects.toThrow();
    const receipt = JSON.parse(await readFile(result.receiptPath, "utf8")) as {
      status: string;
      records: Array<{ zoneCode: string; status: string; error?: string }>;
    };
    expect(receipt.status).toBe("failed");
    expect(receipt.records.find((row) => row.zoneCode === "CEN-181")).toMatchObject({
      status: "failed",
      error: "upstream 503",
    });
  });

  it("should reject an unsafe runId without cleaning any path outside outDir", async () => {
    const root = await outputDir();
    const outDir = join(root, "stage", "nested");
    const victim = join(root, "victim");
    await mkdir(victim, { recursive: true });
    await writeFile(join(victim, "sentinel.txt"), "keep");
    const records = [record(1, "H-59")];

    const result = await runLocalZonePdfStaging({
      outDir,
      source: new MockSource(records),
      extractor: new MockExtractor([extraction("H-59", 2)]),
      runId: "../../../../victim",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors).toContain("runId contains unsafe path characters");
    expect(await readFile(join(victim, "sentinel.txt"), "utf8")).toBe("keep");
  });

  it("should reject duplicate canonical codes before downloading", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59"), { ...record(2, "CEN-181"), canonicalZoneCode: "H-59" }];
    const source = new MockSource(records);
    const extractor = new MockExtractor([]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "duplicate",
      config: { expectedRecords: 2 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors).toContain("duplicate canonical zone code");
    expect(source.downloadCalls).toBe(0);
  });

  it("should reject missing or extra prepared extraction codes", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59"), record(2, "CEN-181")];
    const source = new MockSource(records);
    const extractor = new LocalFrozenExtractor({
      version: "saint-amable-native-variants-v1",
      zones: [serializedLot2Extraction("H-59"), serializedLot2Extraction("TR-184")],
    });

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "prepared-set-mismatch",
      config: { expectedRecords: 2 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors).toContain("prepared extraction codes do not exactly match source records");
    expect(source.downloadCalls).toBe(0);
  });

  it("should reject a LocalFrozenExtractor SHA mismatch against the acquired PDF", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new LocalFrozenExtractor({
      version: "saint-amable-native-variants-v1",
      zones: [serializedLot2Extraction("H-59", "a".repeat(64))],
    });

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "lot2-sha-mismatch",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain(
      "Lot 2 source_sha256 does not match pinned PDF SHA-256 for H-59",
    );
    expect(source.downloadCalls).toBe(1);
  });

  it("should fail without READY for negative or overlapping Lot 2 variant bboxes", async () => {
    const invalidExtractions: SerializedLot2ZoneExtraction[] = [];
    const negative = serializedLot2Extraction("H-59");
    negative.variants[0]!.bbox.x0 = -1;
    invalidExtractions.push(negative);

    const overlapping = serializedLot2Extraction("H-59");
    overlapping.variants.push({
      ...overlapping.variants[0]!,
      column_index: 1,
      bbox: { x0: 150, y0: 10, x1: 250, y1: 700 },
      norms: {},
    });
    for (const observation of overlapping.header_observations as Array<{
      raw_zone_codes: string[];
    }>) {
      observation.raw_zone_codes.push("H-59");
    }
    invalidExtractions.push(overlapping);

    for (const [index, invalid] of invalidExtractions.entries()) {
      const outDir = await outputDir();
      const records = [record(1, "H-59")];
      invalid.source_url = records[0]!.pdfUrl;
      const result = await runLocalZonePdfStaging({
        outDir,
        source: new MockSource(records),
        extractor: new LocalFrozenExtractor({
          version: "saint-amable-native-variants-v1",
          zones: [invalid],
        }),
        runId: `invalid-lot2-bbox-${index}`,
        config: { expectedRecords: 1 },
      });

      expect(result.status).toBe("failed");
      expect(result.errors.join(" ")).toMatch(/bbox|overlap/);
      await expect(readdir(join(outDir, "runs"))).rejects.toThrow();
    }
  });

  it("should fail without READY for a Lot 2 norm outside the exact schema", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const invalid = serializedLot2Extraction("H-59");
    invalid.source_url = records[0]!.pdfUrl;
    invalid.variants[0]!.norms = { foreign_norm: 42 };

    const result = await runLocalZonePdfStaging({
      outDir,
      source: new MockSource(records),
      extractor: new LocalFrozenExtractor({
        version: "saint-amable-native-variants-v1",
        zones: [invalid],
      }),
      runId: "invalid-lot2-norm",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("unknown norm key foreign_norm");
    await expect(readdir(join(outDir, "runs"))).rejects.toThrow();
  });

  it("should require an explicit source-owner fence", async () => {
    const outDir = await outputDir();
    const missingOwner = { ...record(1, "H-59"), expectedOwner: "" };
    const source = new MockSource([missingOwner]);
    const extractor = new MockExtractor([extraction("H-59", 2)]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "missing-owner",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors).toContain("unpinned expected owner for H-59");
    expect(source.downloadCalls).toBe(0);
  });

  it("should reject a source fence that is no longer stable after extraction", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    source.fenceAfter = {
      ...fence(records),
      editing: {
        ...fence(records).editing,
        dataLastEditDate: fence(records).editing.dataLastEditDate + 1,
      },
    };
    const extractor = new MockExtractor([extraction("H-59", 2)]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "moving-fence",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors).toContain("source fence moved between T0 and T1");
    expect(extractor.calls).toBe(1);
  });

  it("should re-read the source fence after parsing and reject parse-time drift", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([extraction("H-59", 2)]);
    extractor.onParse = () => {
      source.fenceAfter = {
        ...fence(records),
        editing: {
          ...fence(records).editing,
          dataLastEditDate: fence(records).editing.dataLastEditDate + 1,
        },
      };
    };

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "parse-time-drift",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors).toContain("source fence moved between T0 and T1");
    expect(extractor.calls).toBe(1);
    await expect(readdir(join(outDir, "runs"))).rejects.toThrow();
  });

  it("should re-read every item fence after parsing and reject parse-time item drift", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([extraction("H-59", 2)]);
    extractor.onParse = () => {
      source.metadataAfterByCode.set("H-59", {
        ...source.metadataByCode.get("H-59")!,
        modified: source.metadataByCode.get("H-59")!.modified + 1,
      });
    };

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "parse-time-item-drift",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("final item metadata fence failed");
    await expect(readdir(join(outDir, "runs"))).rejects.toThrow();
  });

  it("should reject item metadata that changes around a download", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    source.metadataAfterByCode.set("H-59", {
      ...source.metadataByCode.get("H-59")!,
      modified: source.metadataByCode.get("H-59")!.modified + 1,
    });
    const extractor = new MockExtractor([extraction("H-59", 2)]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "moving-item",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("item metadata moved during download");
    expect(extractor.calls).toBe(0);
  });

  it("should accept the same narrow title normalization as the Lot 1 manifest", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    source.metadataByCode.set("H-59", {
      ...source.metadataByCode.get("H-59")!,
      title: " h – 59 ",
    });
    const extractor = new MockExtractor([extraction("H-59", 2)]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "lot1-title-normalization",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("ready");
  });

  it("should require a one-page PDF integrity attestation", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    source.pageCountByCode.set("H-59", 2);
    const extractor = new MockExtractor([extraction("H-59", 2)]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "two-pages",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("PDF page count 2 != 1");
    expect(extractor.calls).toBe(0);
  });

  it("should accept the exact Lot 1 pinned ArcGIS itemdata redirect", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    source.finalUrlByCode.set(
      "H-59",
      `https://www.arcgis.com/itemdata/92d347a7683b26a11dab76ccf9a5cac2/${records[0]!.itemId}/H-59.pdf`,
    );
    const extractor = new MockExtractor([extraction("H-59", 2)]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "pinned-itemdata-redirect",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("ready");
  });

  it("should reject an extractor code that differs from the pinned source code", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([{ ...extraction("H-59", 2), zoneCode: "H-59 *27" }]);
    extractor.extractions.set("H-59", { ...extraction("H-59", 2), zoneCode: "H-59 *27" });

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "synthetic-code",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("extracted code H-59 *27 != pinned code H-59");
  });

  it("should reject a synthetic code even when source and extractor collude on it", async () => {
    const outDir = await outputDir();
    const synthetic = { ...record(1, "H-59"), zoneCode: "H-59 *27", canonicalZoneCode: "H-59 *27" };
    const source = new MockSource([synthetic]);
    const extractor = new MockExtractor([extraction("H-59 *27", 2)]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "source-synthetic-code",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("non-canonical or conflicting Saint-Amable zone code");
    expect(source.downloadCalls).toBe(0);
  });

  it("should reject invalid negative or non-finite vision accounting", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const invalid = { ...extraction("H-59", 2), visionPagesUsed: -1, visionUsd: 0 };
    const extractor = new MockExtractor([invalid]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "invalid-vision-accounting",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("invalid vision page usage");
  });

  it("should require explicit usage accounting from a vision-enabled extractor", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([extraction("H-59", 2)]);
    extractor.expectedVisionEnabled = true;

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "missing-vision-accounting",
      config: {
        expectedRecords: 1,
        visionEnabled: true,
        maxVisionPages: 1,
        maxVisionUsd: 0.5,
      },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("vision-enabled extraction omitted usage accounting");
  });

  it("should reject an over-budget vision reservation before extraction can return", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([
      { ...extraction("H-59", 2), visionPagesUsed: 2, visionUsd: 0.25 },
    ]);
    extractor.expectedVisionEnabled = true;
    extractor.visionReservation = { pages: 2, usd: 0.25 };

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "vision-reservation-over-cap",
      config: {
        expectedRecords: 1,
        visionEnabled: true,
        maxVisionPages: 1,
        maxVisionUsd: 0.5,
      },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("vision reservation exceeds budget");
  });

  it("should reject variants that are not emitted in deterministic column order", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const reversed = extraction("H-59", 2);
    reversed.variants.reverse();
    const extractor = new MockExtractor([reversed]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "variant-order",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("variant indices must be ordered and contiguous");
  });

  it("should roll back a newly renamed READY run when CURRENT cannot be updated", async () => {
    const outDir = await outputDir();
    await mkdir(join(outDir, "CURRENT"));
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([extraction("H-59", 2)]);

    const result = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "current-write-failure",
      config: { expectedRecords: 1 },
    });

    expect(result.status).toBe("failed");
    await expect(readdir(join(outDir, "runs"))).rejects.toThrow();
    expect(await readdir(join(outDir, "CURRENT"))).toEqual([]);
  });

  it("should hash the parquet artifact and revoke READY when an existing run is altered", async () => {
    const outDir = await outputDir();
    const records = [record(1, "H-59")];
    const source = new MockSource(records);
    const extractor = new MockExtractor([extraction("H-59", 2)]);
    const first = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "parquet-seed",
      config: { expectedRecords: 1 },
    });
    expect(first.status).toBe("ready");
    const parquetPath = join(first.runDir!, "candidate.parquet");
    const altered = await readFile(parquetPath);
    altered[Math.floor(altered.byteLength / 2)] ^= 1;
    await writeFile(parquetPath, altered);

    const second = await runLocalZonePdfStaging({
      outDir,
      source,
      extractor,
      runId: "parquet-verify",
      config: { expectedRecords: 1 },
    });

    expect(second.status).toBe("failed");
    expect(second.errors.join(" ")).toContain("artifact hash mismatch: candidate.parquet");
    await expect(readFile(join(first.runDir!, "READY_STAGING"))).rejects.toThrow();
    await expect(readFile(join(outDir, "CURRENT"))).rejects.toThrow();
  });
});

describe("conservative preview and diff", () => {
  it("should preserve __proto__ as ordinary canonical JSON data", () => {
    const value = JSON.parse('{"z":1,"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const parsed = JSON.parse(canonicalJson(value as never)) as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
    expect(parsed["__proto__"]).toEqual({ polluted: true });
  });

  it("should preserve variant conflicts as null instead of choosing a richer row", () => {
    const source = record(1, "HCV-187");
    const preview = conservativePreview(source, extraction("HCV-187", 2, 3));

    expect(preview.fields).toMatchObject({ hauteur_min: 1, hauteur_max: null, marge_avant_min: 7.5 });
    expect(preview.conflictingFields).toEqual(["hauteur_max"]);
    expect(preview.structure).toEqual([]);
    expect(preview.usages).toEqual(["h1", "p2"]);
  });

  it("should classify added, removed, changed and unchanged zones deterministically", () => {
    const h59 = conservativePreview(record(1, "H-59"), extraction("H-59", 2));
    const hcv = conservativePreview(record(2, "HCV-187"), extraction("HCV-187", 2, 3));
    const changed = { ...h59, fields: { ...h59.fields, hauteur_max: 3 } };

    const diff = buildStageDiff([h59, hcv], [changed, conservativePreview(record(3, "TR-184"), extraction("TR-184", 3))]);

    expect(diff.added.map((entry) => entry.zoneCode)).toEqual(["TR-184"]);
    expect(diff.removed.map((entry) => entry.zoneCode)).toEqual(["HCV-187"]);
    expect(diff.changed.map((entry) => entry.zoneCode)).toEqual(["H-59"]);
    expect(diff.unchanged).toEqual([]);
  });
});
