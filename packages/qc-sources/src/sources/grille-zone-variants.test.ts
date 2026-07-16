import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SAINT_AMABLE_USAGE_CODES,
  ZoneVariantExtractionError,
  nativeTextPageFromPdftohtmlXml,
  parseSaintAmableZoneVariants,
  type NativePageVerification,
  type ZoneVariantExtraction,
} from "./grille-zone-variants.js";

const FIXTURE_META = {
  sourceUrl:
    "https://saintamable-site.s3.ca-central-1.amazonaws.com/wp-content/uploads/2026/06/saint-amable-712-47-2026-codification-zonage.pdf",
  sourceSha256: "d1879faf883383c259ef5c28ff4a2ee83db3e24fa3c6de6ea8ec2862c53181e2",
  snapshot: "2026-07-15",
};

interface Golden {
  fixture: string;
  expectedZone: string;
  variantCount: number;
  heights: ReadonlyArray<readonly [number, number]>;
  usages: ReadonlyArray<ReadonlyArray<string>>;
}

const GOLDENS: Record<string, Golden> = {
  "H-59": {
    fixture: "h-59.xml",
    expectedZone: "H-59",
    variantCount: 3,
    heights: [[1, 2], [1, 2], [1, 2]],
    usages: [["h1", "p2"], ["h1", "p2"], ["h4", "p2"]],
  },
  "CEN-181": {
    fixture: "cen-181.xml",
    expectedZone: "CEN-181",
    variantCount: 3,
    heights: [[3, 4], [3, 4], [3, 4]],
    usages: [
      ["h3", "h4", "p2"],
      ["h3", "h4", "p2"],
      ["h3", "h4", "p2"],
    ],
  },
  "HCV-187": {
    fixture: "hcv-187.xml",
    expectedZone: "HCV-187",
    variantCount: 7,
    heights: [[2, 2], [2, 2], [2, 2], [2, 2], [2, 3], [2, 3], [2, 3]],
    usages: [
      ["h1", "p2"],
      ["h2", "p2"],
      ["h2", "p2"],
      ["h2", "p2"],
      ["h2", "h3", "c2", "c4", "p2"],
      ["h2", "h3", "c2", "c4", "p2"],
      ["h2", "h3", "c2", "c4", "p2"],
    ],
  },
  "PCV-197": {
    fixture: "pcv-197.xml",
    expectedZone: "PCV-197",
    variantCount: 1,
    heights: [[1, 5]],
    usages: [["h5", "p1", "p2", "p3"]],
  },
  "TR-184": {
    fixture: "tr-184.xml",
    expectedZone: "TR-184",
    variantCount: 6,
    heights: [[2, 3], [2, 3], [2, 3], [2, 3], [2, 3], [2, 3]],
    usages: [
      ["h3", "h4", "p2"],
      ["h3", "h4", "p2"],
      ["h3", "h4", "p2"],
      ["h3", "h4", "c1", "c2", "c3", "c4", "p2"],
      ["h3", "h4", "c1", "c2", "c3", "c4", "p2"],
      ["h3", "h4", "c1", "c2", "c3", "c4", "p2"],
    ],
  },
};

function fixtureXml(name: string): string {
  return readFileSync(new URL(`./fixtures/saint-amable/${name}`, import.meta.url), "utf8");
}

function verification(golden: Golden): NativePageVerification {
  return {
    method: "pdftotext-layout/independent",
    rawZoneCodes: Array.from({ length: golden.variantCount }, () => golden.expectedZone),
    authorizedUsagesByColumn: golden.usages,
    mergedNormKeys:
      golden.expectedZone === "H-59"
        ? [
            "marge_avant_min",
            "marge_laterale_min",
            "marge_laterale_totale_min",
            "marge_arriere_min",
            "largeur_min",
            "hauteur_etages",
            "cos_max",
          ]
        : [],
  };
}

function parseGolden(golden: Golden): ZoneVariantExtraction {
  return parseSaintAmableZoneVariants({
    expectedZone: golden.expectedZone,
    primary: nativeTextPageFromPdftohtmlXml(
      fixtureXml(golden.fixture),
      "pdftohtml-xml/native-bbox",
    ),
    verification: verification(golden),
    ...FIXTURE_META,
  });
}

describe("parseSaintAmableZoneVariants — official native-text goldens", () => {
  it.each(Object.values(GOLDENS))(
    "preserves the exact variant count and height ranges for $expectedZone",
    (golden) => {
      const result = parseGolden(golden);

      expect(result.zone_code).toBe(golden.expectedZone);
      expect(result.variants).toHaveLength(golden.variantCount);
      expect(
        result.variants.map((variant) => [
          variant.norms.hauteur_etages?.min,
          variant.norms.hauteur_etages?.max,
        ]),
      ).toEqual(golden.heights);
      expect(result.variants.map((variant) => variant.usages)).toEqual(golden.usages);
    },
  );

  it("keeps H-59 as three ordered bbox-keyed variants", () => {
    const result = parseGolden(GOLDENS["H-59"]!);

    expect(result.variants.map((variant) => variant.column_index)).toEqual([0, 1, 2]);
    expect(result.variants[0]!.bbox.x1).toBeLessThanOrEqual(result.variants[1]!.bbox.x0);
    expect(result.variants[1]!.bbox.x1).toBeLessThanOrEqual(result.variants[2]!.bbox.x0);
    expect(result.variants.every((variant) => variant.bbox.y1 > variant.bbox.y0)).toBe(true);
  });

  it("keeps structure labels and note references outside the closed usage vocabulary", () => {
    const result = parseGolden(GOLDENS["H-59"]!);
    const usages = result.variants.flatMap((variant) => variant.usages);

    expect(result.variants.map((variant) => variant.structures)).toEqual([
      ["Contiguë"],
      ["Isolée", "Jumelée", "Contiguë"],
      ["Isolée"],
    ]);
    expect(result.variants[1]!.footnotes).toContain("*27");
    expect(result.variants[2]!.footnotes).toContain("*6");
    expect(usages).not.toContain("Isolée");
    expect(usages.some((usage) => /^\*\d+$/.test(usage))).toBe(false);
    expect(usages.every((usage) => SAINT_AMABLE_USAGE_CODES.has(usage))).toBe(true);
  });

  it("preserves HCV-187's per-column norm conflict instead of keeping one rich row", () => {
    const result = parseGolden(GOLDENS["HCV-187"]!);

    expect(result.variants.slice(0, 4).map((variant) => variant.norms.hauteur_etages?.raw)).toEqual([
      "2\\2",
      "2\\2",
      "2\\2",
      "2\\2",
    ]);
    expect(result.variants.slice(4).map((variant) => variant.norms.hauteur_etages?.raw)).toEqual([
      "2\\3",
      "2\\3",
      "2\\3",
    ]);
  });

  it("does not spread a lone cell across columns without independent merged-cell evidence", () => {
    const h59 = GOLDENS["H-59"]!;
    const result = parseSaintAmableZoneVariants({
      expectedZone: h59.expectedZone,
      primary: nativeTextPageFromPdftohtmlXml(
        fixtureXml(h59.fixture),
        "pdftohtml-xml/native-bbox",
      ),
      verification: { ...verification(h59), mergedNormKeys: [] },
      ...FIXTURE_META,
    });

    expect(result.variants[0]!.norms.hauteur_etages).toMatchObject({ min: 1, max: 2 });
    expect(result.variants[1]!.norms.hauteur_etages).toBeUndefined();
    expect(result.variants[2]!.norms.hauteur_etages).toBeUndefined();
  });

  it("handles a mono-variant page without synthesizing extra columns", () => {
    const result = parseGolden(GOLDENS["PCV-197"]!);

    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({
      column_index: 0,
      usages: ["h5", "p1", "p2", "p3"],
      norms: { hauteur_etages: { min: 1, max: 5, unit: "etages" } },
    });
  });

  it("accepts an official alphanumeric Saint-Amable prefix without changing it", () => {
    const h59 = GOLDENS["H-59"]!;
    const xml = fixtureXml(h59.fixture).replaceAll("H-59", "A1-105");
    const result = parseSaintAmableZoneVariants({
      expectedZone: "A1-105",
      primary: nativeTextPageFromPdftohtmlXml(xml, "pdftohtml-xml/native-bbox"),
      verification: {
        ...verification(h59),
        rawZoneCodes: ["A1-105", "A1-105", "A1-105"],
      },
      ...FIXTURE_META,
    });

    expect(result.zone_code).toBe("A1-105");
    expect(result.variants).toHaveLength(3);
  });

  it("ignores a parenthetical usage-looking row outside the bounded usage-class section", () => {
    const h59 = GOLDENS["H-59"]!;
    const primary = nativeTextPageFromPdftohtmlXml(
      fixtureXml(h59.fixture),
      "pdftohtml-xml/native-bbox",
    );
    primary.items.push(
      { text: "annotation hors section (h1)", bbox: { x0: 700, y0: 862, x1: 1000, y1: 880 } },
      { text: "●", bbox: { x0: 1310, y0: 862, x1: 1320, y1: 880 } },
    );

    const result = parseSaintAmableZoneVariants({
      expectedZone: h59.expectedZone,
      primary,
      verification: verification(h59),
      ...FIXTURE_META,
    });

    expect(result.variants.map((variant) => variant.usages)).toEqual(h59.usages);
  });

  it("rejects a second physical row for a merged norm instead of overwriting it", () => {
    const h59 = GOLDENS["H-59"]!;
    const primary = nativeTextPageFromPdftohtmlXml(
      fixtureXml(h59.fixture),
      "pdftohtml-xml/native-bbox",
    );
    primary.items.push(
      { text: "Avant (m)", bbox: { x0: 863, y0: 1320, x1: 935, y1: 1338 } },
      { text: "99", bbox: { x0: 1308, y0: 1320, x1: 1331, y1: 1338 } },
    );

    expect(() =>
      parseSaintAmableZoneVariants({
        expectedZone: h59.expectedZone,
        primary,
        verification: verification(h59),
        ...FIXTURE_META,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({ code: "norm-conflict" }),
    );
  });

  it("rejects a second physical row for a column norm instead of overwriting it", () => {
    const cen = GOLDENS["CEN-181"]!;
    const primary = nativeTextPageFromPdftohtmlXml(
      fixtureXml(cen.fixture),
      "pdftohtml-xml/native-bbox",
    );
    primary.items.push(
      { text: "Avant (m)", bbox: { x0: 825, y0: 1348, x1: 900, y1: 1366 } },
      { text: "99", bbox: { x0: 1110, y0: 1348, x1: 1130, y1: 1366 } },
    );

    expect(() =>
      parseSaintAmableZoneVariants({
        expectedZone: cen.expectedZone,
        primary,
        verification: verification(cen),
        ...FIXTURE_META,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({ code: "norm-conflict" }),
    );
  });
});

describe("parseSaintAmableZoneVariants — strict evidence gates", () => {
  const h59 = GOLDENS["H-59"]!;
  const primary = nativeTextPageFromPdftohtmlXml(
    fixtureXml(h59.fixture),
    "pdftohtml-xml/native-bbox",
  );

  function parseWith(overrides: {
    expectedZone?: string;
    verification?: NativePageVerification;
  }): ZoneVariantExtraction {
    return parseSaintAmableZoneVariants({
      expectedZone: overrides.expectedZone ?? h59.expectedZone,
      primary,
      verification: overrides.verification ?? verification(h59),
      ...FIXTURE_META,
    });
  }

  it.each(["h-59", "H59", "H-59 *27"])(
    "rejects a non-canonical authoritative expected code: %s",
    (expectedZone) => {
      expect(() => parseWith({ expectedZone })).toThrowError(
        expect.objectContaining<Partial<ZoneVariantExtractionError>>({
          code: "invalid-expected-zone",
        }),
      );
    },
  );

  it("rejects a swapped PDF whose independently observed header does not match the manifest", () => {
    expect(() =>
      parseWith({
        verification: {
          ...verification(h59),
          rawZoneCodes: ["H-60", "H-60", "H-60"],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "header-mismatch",
      }),
    );
  });

  it.each(["H-59 *27", "A1-105 *27"])(
    "rejects a footnote suffix masquerading as a zone header: %s",
    (pseudoZone) => {
      expect(() =>
        parseWith({
          verification: {
            ...verification(h59),
            rawZoneCodes: ["H-59", pseudoZone, "H-59"],
          },
        }),
      ).toThrowError(
        expect.objectContaining<Partial<ZoneVariantExtractionError>>({
          code: "pseudo-zone-suffix",
        }),
      );
    },
  );

  it("rejects two raw spellings that normalize to the same zone", () => {
    expect(() =>
      parseWith({
        verification: {
          ...verification(h59),
          rawZoneCodes: ["H-59", "H – 59", "H-59"],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "normalization-collision",
      }),
    );
  });

  it("rejects authorization markers that are not concordant across the two reads", () => {
    expect(() =>
      parseWith({
        verification: {
          ...verification(h59),
          authorizedUsagesByColumn: [["h1", "p2"], ["h1"], ["h4", "p2"]],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "usage-marker-mismatch",
      }),
    );
  });

  it("requires independent reader method labels", () => {
    expect(() =>
      parseWith({
        verification: {
          ...verification(h59),
          method: primary.method,
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "non-independent-read",
      }),
    );
  });

  it("rejects a pdftohtml document containing more than one page", () => {
    const secondPage = [
      '<page number="999" position="absolute" top="0" left="0" height="3286" width="1995">',
      '<text top="1000" left="863" width="72" height="18" font="1">Avant (m)</text>',
      '<text top="1000" left="1308" width="23" height="18" font="1">99</text>',
      "</page>",
    ].join("\n");
    const xml = fixtureXml(h59.fixture).replace("</pdf2xml>", `${secondPage}\n</pdf2xml>`);

    expect(() => nativeTextPageFromPdftohtmlXml(xml, "pdftohtml-xml/native-bbox")).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "invalid-native-page",
      }),
    );
  });

  it("rejects degenerate or out-of-page native bboxes", () => {
    const xml = fixtureXml(h59.fixture).replace(/width="\d+" height="/, 'width="0" height="');
    expect(() => nativeTextPageFromPdftohtmlXml(xml, "pdftohtml-xml/native-bbox")).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "invalid-native-page",
      }),
    );

    const primary = nativeTextPageFromPdftohtmlXml(
      fixtureXml(h59.fixture),
      "pdftohtml-xml/native-bbox",
    );
    primary.items[0]!.bbox.x1 = primary.items[0]!.bbox.x0;
    expect(() =>
      parseSaintAmableZoneVariants({
        expectedZone: h59.expectedZone,
        primary,
        verification: verification(h59),
        ...FIXTURE_META,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "invalid-native-page",
      }),
    );
  });

  it("rejects overlapping zone headers with non-increasing centers", () => {
    const primary = nativeTextPageFromPdftohtmlXml(
      fixtureXml(h59.fixture),
      "pdftohtml-xml/native-bbox",
    );
    const headers = primary.items.filter((item) => item.text === h59.expectedZone);
    headers[1]!.bbox = { ...headers[0]!.bbox };

    expect(() =>
      parseSaintAmableZoneVariants({
        expectedZone: h59.expectedZone,
        primary,
        verification: verification(h59),
        ...FIXTURE_META,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "invalid-native-page",
      }),
    );
  });

  it("rejects derived variant columns extending beyond the native page", () => {
    const primary = nativeTextPageFromPdftohtmlXml(
      fixtureXml(h59.fixture),
      "pdftohtml-xml/native-bbox",
    );
    const headers = primary.items.filter((item) => item.text === h59.expectedZone);
    headers.forEach((header, index) => {
      header.bbox = { ...header.bbox, x0: index * 1.1, x1: index * 1.1 + 1 };
    });

    expect(() =>
      parseSaintAmableZoneVariants({
        expectedZone: h59.expectedZone,
        primary,
        verification: verification(h59),
        ...FIXTURE_META,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "invalid-native-page",
      }),
    );
  });

  it("rejects a note boundary preceding the zone headers", () => {
    const primary = nativeTextPageFromPdftohtmlXml(
      fixtureXml(h59.fixture),
      "pdftohtml-xml/native-bbox",
    );
    primary.items.push({
      text: "*999 : note déplacée",
      bbox: { x0: 10, y0: 300, x1: 150, y1: 318 },
    });

    expect(() =>
      parseSaintAmableZoneVariants({
        expectedZone: h59.expectedZone,
        primary,
        verification: verification(h59),
        ...FIXTURE_META,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ZoneVariantExtractionError>>({
        code: "invalid-native-page",
      }),
    );
  });
});
