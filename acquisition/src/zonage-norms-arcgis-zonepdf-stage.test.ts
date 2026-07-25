import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalFrozenExtractor,
  parseStageCliArgs,
  readLocalPdfBounded,
} from "./zonage-norms-arcgis-zonepdf-stage.js";
import type {
  SerializedLot2ZoneExtraction,
  ZonePdfExtractInput,
} from "./lib/arcgis-zonepdf-stage-runner.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const REQUIRED = [
  "--source-manifest",
  "/tmp/source.json",
  "--extractions",
  "/tmp/extractions.json",
  "--out",
  "/tmp/stage",
];

function lot2Zone(code: string, sourceSha256: string): SerializedLot2ZoneExtraction {
  return {
    zone_code: code,
    source_url: `https://mrcdemdy.maps.arcgis.com/source/${code}.pdf`,
    source_sha256: sourceSha256,
    snapshot: "frozen-source-fence",
    page: 1,
    header_observations: [
      { method: "native-bbox", raw_zone_codes: [code] },
      { method: "layout-text", raw_zone_codes: [code] },
    ],
    variants: [
      {
        column_index: 0,
        bbox: { x0: 10, y0: 10, x1: 20, y1: 100 },
        usages: ["h1"],
        structures: ["Isolée"],
        norms: {
          hauteur_etages: {
            raw: "1 / 2",
            min: 1,
            max: 2,
            value: null,
            unit: "etages",
            bbox: { x0: 11, y0: 50, x1: 19, y1: 60 },
            scope: "column",
          },
        },
        footnotes: [],
      },
    ],
  };
}

describe("zonage-norms-arcgis-zonepdf-stage CLI", () => {
  it("should expose only local inputs and keep vision disabled by default", () => {
    const args = parseStageCliArgs(REQUIRED);

    expect(args).toMatchObject({
      sourceManifest: "/tmp/source.json",
      extractions: "/tmp/extractions.json",
      outDir: "/tmp/stage",
      expectedRecords: 109,
      visionEnabled: false,
      maxVisionPages: 0,
      maxVisionUsd: 0,
    });
  });

  it.each(["--publish", "--deposit", "--s3", "--upload", "--expected-records"])(
    "should reject publication-shaped flag %s",
    (flag) => {
      expect(() => parseStageCliArgs([...REQUIRED, flag])).toThrow(`unknown flag ${flag}`);
    },
  );

  it("should reject S3 and HTTP paths", () => {
    expect(() =>
      parseStageCliArgs([
        "--source-manifest",
        "s3://bucket/source.json",
        "--extractions",
        "/tmp/extractions.json",
        "--out",
        "/tmp/stage",
      ]),
    ).toThrow("must be a local filesystem path");
    expect(() =>
      parseStageCliArgs([
        "--source-manifest",
        "/tmp/source.json",
        "--extractions",
        "https://example.test/extractions.json",
        "--out",
        "/tmp/stage",
      ]),
    ).toThrow("must be a local filesystem path");
  });

  it("should require explicit positive page and USD caps for vision", () => {
    expect(() => parseStageCliArgs([...REQUIRED, "--allow-vision"])).toThrow(
      "requires positive --max-vision-pages and --max-vision-usd",
    );
    expect(() =>
      parseStageCliArgs([
        ...REQUIRED,
        "--allow-vision",
        "--max-vision-pages",
        "2",
        "--max-vision-usd",
        "0.40",
      ]),
    ).not.toThrow();
    expect(() => parseStageCliArgs([...REQUIRED, "--max-vision-pages", "2"])).toThrow(
      "vision budgets require --allow-vision",
    );
  });

  it("should consume serialized Lot 2 JSON and expose its exact prepared code set", async () => {
    const digest = "a".repeat(64);
    const h59 = lot2Zone("H-59", digest);
    const frozen = new LocalFrozenExtractor({
      version: "saint-amable-native-variants-v1",
      zones: [h59, lot2Zone("CEN-181", digest)],
    });

    expect(frozen.preparedZoneCodes).toEqual(["H-59", "CEN-181"]);
    const adapted = await frozen.parse({
      record: { zoneCode: "H-59", pdfUrl: h59.source_url },
      pdfSha256: digest,
    } as unknown as ZonePdfExtractInput);
    expect(adapted).toMatchObject({
      zoneCode: "H-59",
      variants: [{ columnIndex: 0, structure: ["Isolée"] }],
    });
  });

  it("should reject duplicate Lot 2 prepared zone codes", () => {
    const digest = "a".repeat(64);
    expect(
      () =>
        new LocalFrozenExtractor({
          version: "saint-amable-native-variants-v1",
          zones: [lot2Zone("H-59", digest), lot2Zone("H-59", digest)],
        }),
    ).toThrow("frozen extractions contain duplicate zone codes");
  });

  it("should reject an oversized sparse local PDF before allocating its contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "zonepdf-cli-bounded-"));
    tempRoots.push(root);
    const path = join(root, "oversized.pdf");
    const handle = await open(path, "w");
    try {
      await handle.truncate(1024 * 1024);
    } finally {
      await handle.close();
    }

    await expect(readLocalPdfBounded(path, 16, 1024)).rejects.toThrow(
      "local PDF size 1048576 differs from Lot 1 evidence 16",
    );
  });

  it("should read exactly one bounded local PDF", async () => {
    const root = await mkdtemp(join(tmpdir(), "zonepdf-cli-bounded-"));
    tempRoots.push(root);
    const path = join(root, "exact.pdf");
    const bytes = Buffer.from("%PDF-bounded\n%%EOF\n");
    await writeFile(path, bytes);

    expect(Buffer.from(await readLocalPdfBounded(path, bytes.byteLength, 1024))).toEqual(bytes);
  });
});
