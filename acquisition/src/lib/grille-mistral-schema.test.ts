import { describe, it, expect, vi } from "vitest";

import {
  buildAnnotationSchema,
  extractionFromAnnotationZones,
  extractGrilleSchemaFromPdf,
  createMistralSchemaAnnotateCall,
  parseMistralSchemaAnnotation,
  assertMistralSchemaConfig,
  MISTRAL_SCHEMA_USD_PER_PAGE,
  SCHEMA_METHODE,
  type SchemaAnnotateCall,
  type SlicePdfImpl,
} from "./grille-mistral-schema.js";
import { FIELD_SPECS } from "../../../packages/qc-sources/src/sources/grille-vision-extractor.js";

const OPTS = { source_url: "https://example.test/grille.pdf", snapshot: "2026-07-05" };

function annotationZone(zoneCode: string, values: Record<string, string | null> = {}): Record<string, string | null> {
  const zone: Record<string, string | null> = { zone_code: zoneCode };
  for (const spec of FIELD_SPECS) {
    zone[spec.id] = values[spec.id] ?? null;
    zone[`${spec.id}__libelle`] = values[`${spec.id}__libelle`] ?? null;
    zone[`${spec.id}__colonnes`] = values[`${spec.id}__colonnes`] ?? null;
  }
  return zone;
}

// A slice seam that never touches disk; records the pages it was asked to slice
// and how many times cleanup ran.
function fakeSlice(): { slice: SlicePdfImpl; calls: number[][]; cleanupCount: () => number } {
  const calls: number[][] = [];
  let cleanups = 0;
  const slice: SlicePdfImpl = async (_pdf, pages) => {
    calls.push([...pages]);
    return {
      path: `/tmp/fake-slice-${pages[0]}.pdf`,
      cleanup: async () => {
        cleanups += 1;
      },
    };
  };
  return { slice, calls, cleanupCount: () => cleanups };
}

describe("buildAnnotationSchema", () => {
  it("declares one nullable property per FROZEN norm field plus a required zone_code", () => {
    const schema = buildAnnotationSchema() as {
      properties: { zones: { items: { properties: Record<string, unknown>; required: string[] } } };
      required: string[];
    };
    const items = schema.properties.zones.items;
    // zone_code + every FIELD_SPECS id is a property AND required (strict → explicit null).
    expect(items.properties["zone_code"]).toBeTruthy();
    for (const spec of FIELD_SPECS) {
      expect(items.properties[spec.id]).toBeTruthy();
      expect(items.required).toContain(spec.id);
    }
    expect(items.required).toContain("zone_code");
    expect(schema.required).toContain("zones");
    // norm fields are nullable strings (verbatim-or-null contract).
    const marge = items.properties["marge_avant_min"] as { type: unknown };
    expect(marge.type).toEqual(["string", "null"]);
  });
});

describe("extractionFromAnnotationZones — verbatim-or-null", () => {
  it("keeps a verbatim string cell and coerces empty/missing/non-string cells to null", () => {
    const raw = {
      zones: [
        {
          zone_code: "COM-01",
          marge_avant_min: "7,5",
          marge_laterale_min: "", // empty → null
          superficie_min: 2000, // defensive: non-string → null
          // densite missing → null
        },
      ],
    };
    const ext = extractionFromAnnotationZones(raw);
    expect(ext.zones).toHaveLength(1);
    expect(ext.zones[0]!.zone_code).toBe("COM-01");
    expect(ext.zones[0]!.fields.marge_avant_min).toBe("7,5");
    expect(ext.zones[0]!.fields.marge_laterale_min).toBeNull();
    expect(ext.zones[0]!.fields.superficie_min).toBeNull();
    expect(ext.zones[0]!.fields.densite).toBeNull();
  });

  it("nulls a blank zone_code (dropped downstream, never invented)", () => {
    const ext = extractionFromAnnotationZones({ zones: [{ zone_code: "  ", marge_avant_min: "9" }] });
    expect(ext.zones[0]!.zone_code).toBeNull();
  });

  it("tolerates a missing/!array zones field", () => {
    expect(extractionFromAnnotationZones({}).zones).toEqual([]);
    expect(extractionFromAnnotationZones(null).zones).toEqual([]);
  });
});

describe("extractGrilleSchemaFromPdf — chunking, guard reuse, cost", () => {
  it("chunks by 8 pages, feeds 0-based page indices, and stamps the schema methode", async () => {
    const { slice, calls } = fakeSlice();
    const annotateCalls: number[][] = [];
    const annotate: SchemaAnnotateCall = async (_path, pageIdxs) => {
      annotateCalls.push([...pageIdxs]);
      // Return one plausible verbatim zone per chunk.
      return {
        annotation: {
          zones: [
            annotationZone(pageIdxs.length === 8 ? "COM-01" : "COM-99", { marge_avant_min: "7,5", hauteur_metres: "10" }),
          ],
        },
        pagesProcessed: pageIdxs.length,
      };
    };
    const pages = [186, 187, 188, 189, 190, 191, 192, 193, 194, 195]; // 10 → 8 + 2
    const res = await extractGrilleSchemaFromPdf("/x.pdf", pages, { ...OPTS, annotate, slice });

    // Two chunks: [186..193] and [194,195]; slice got the REAL 1-based pages…
    expect(calls).toEqual([[186, 187, 188, 189, 190, 191, 192, 193], [194, 195]]);
    // …but the OCR call got 0-based indices WITHIN each slice.
    expect(annotateCalls).toEqual([[0, 1, 2, 3, 4, 5, 6, 7], [0, 1]]);
    expect(res.chunksRead).toBe(2);
    expect(res.chunksFailed).toBe(0);
    expect(res.pagesProcessed).toBe(10);
    expect(res.usd).toBeCloseTo(10 * MISTRAL_SCHEMA_USD_PER_PAGE, 6);

    // Guarded ZoneNorms: verbatim plausible cell published, methode = schema tag.
    expect(res.zones.map((z) => z.zone_code).sort()).toEqual(["COM-01", "COM-99"]);
    const com01 = res.zones.find((z) => z.zone_code === "COM-01")!;
    expect(com01.marges.avant_min!.value).toBe(7.5);
    expect(com01.hauteur_max!.value).toBe(10);
    expect(com01.marges.avant_min!._provenance.methode).toBe(SCHEMA_METHODE);
  });

  it("gates an out-of-range / wrong-unit cell to null via the FROZEN buildVisionField", async () => {
    const { slice } = fakeSlice();
    const annotate: SchemaAnnotateCall = async () => ({
      annotation: {
        zones: [
          annotationZone("Z1", { marge_avant_min: "999" }), // out of plausibility window → null
          annotationZone("Z2", { marge_avant_min: "415 m²" }), // wrong unit (area for a length) → null
        ],
      },
      pagesProcessed: 1,
    });
    const res = await extractGrilleSchemaFromPdf("/x.pdf", [1], { ...OPTS, annotate, slice });
    const z1 = res.zones.find((z) => z.zone_code === "Z1")!;
    const z2 = res.zones.find((z) => z.zone_code === "Z2")!;
    expect(z1.marges.avant_min!.value).toBeNull();
    expect(z1.marges.avant_min!.raw).toBe("999"); // raw preserved, never discarded
    expect(z2.marges.avant_min!.value).toBeNull();
    expect(z2.marges.avant_min!.flag).toBe("unite-incoherente");
  });

  it("skips a failing chunk with a reason and still reads the healthy chunks", async () => {
    const { slice, cleanupCount } = fakeSlice();
    let n = 0;
    const annotate: SchemaAnnotateCall = async (_p, pageIdxs) => {
      n += 1;
      if (n === 1) throw new Error("HTTP 429 rate limited");
      return {
        annotation: { zones: [annotationZone("OK-1", { densite: "0,4" })] },
        pagesProcessed: pageIdxs.length,
      };
    };
    const pages = Array.from({ length: 16 }, (_, i) => 100 + i); // 2 chunks of 8
    const res = await extractGrilleSchemaFromPdf("/x.pdf", pages, { ...OPTS, annotate, slice });
    expect(res.chunksRead).toBe(1);
    expect(res.chunksFailed).toBe(1);
    expect(res.reasons[0]).toMatch(/429/);
    expect(res.zones.map((z) => z.zone_code)).toEqual(["OK-1"]);
    // slice cleanup ran for BOTH chunks (even the failed one).
    expect(cleanupCount()).toBe(2);
  });
});

describe("createMistralSchemaAnnotateCall — wire shape, key never logged", () => {
  it("POSTs document_annotation_format with the schema and parses document_annotation", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      // The document_annotation JSON-schema mode is requested with the built schema.
      expect(body.document_annotation_format.type).toBe("json_schema");
      expect(body.document_annotation_format.json_schema.strict).toBe(true);
      expect(body.document_annotation_format.json_schema.schema.required).toContain("zones");
      expect(body.pages).toEqual([0, 1]);
      // The Authorization header carries the key but we never assert its VALUE here.
      return new Response(
        JSON.stringify({
          document_annotation: JSON.stringify({ zones: [annotationZone("A-1", { densite: "0,3" })] }),
          usage_info: { pages_processed: 2 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const call = createMistralSchemaAnnotateCall(
      {
        provider: "mistral-ocr",
        model: "mistral-ocr-latest",
        apiBase: "https://api.mistral.ai",
        apiPath: "/v1/ocr",
        apiKey: "SECRET-should-not-appear",
        costPerPage: 0.003,
      },
      fetchImpl,
    );
    // Feed a tiny real file path (readFile must succeed) — reuse this test file.
    const res = await call(new URL(import.meta.url).pathname, [0, 1]);
    expect(res.pagesProcessed).toBe(2);
    expect((res.annotation as { zones: Array<{ zone_code: string }> }).zones[0]!.zone_code).toBe("A-1");
  });

  it("throws (without a network call) when no API key is configured", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const call = createMistralSchemaAnnotateCall(
      {
        provider: "mistral-ocr",
        model: "mistral-ocr-latest",
        apiBase: "https://api.mistral.ai",
        apiPath: "/v1/ocr",
        apiKey: "",
        costPerPage: 0.003,
      },
      fetchImpl,
    );
    await expect(call("/whatever.pdf", [0])).rejects.toThrow(/no API key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-Mistral provider configuration before any network call", () => {
    expect(() => assertMistralSchemaConfig({
      provider: "chandra", model: "mistral-ocr-latest", apiBase: "https://api.mistral.ai", apiPath: "/v1/ocr", apiKey: "x", costPerPage: 0.003,
    })).toThrow(/requires provider/);
  });

  it("rejects an incomplete annotation instead of coercing it", () => {
    expect(() => parseMistralSchemaAnnotation({ zones: [{ zone_code: "A-1" }] })).toThrow(/annotation invalid/);
  });
});
