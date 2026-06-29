import { describe, it, expect } from "vitest";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  labelToFieldId,
  splitRow,
  looksLikeZoneCode,
  findGrilleTables,
  mapMarkdownPageToZones,
  mapOcrResultToZones,
  resolveOcrConfig,
  ocrMethodeTag,
  parseOcrHttpResponse,
  createMistralOcrHttpCall,
  OcrExtractorError,
  DEFAULT_OCR_MODEL,
  MISTRAL_OCR_USD_PER_PAGE,
  type OcrResult,
} from "./grille-ocr-extractor.js";
import { PUBLISH_THRESHOLD, type ZoneNormsT } from "./grille-specifications-parser.js";

const OPTS = { source_url: "local://muni/grille.pdf", snapshot: "2026-06-28" };

/**
 * A TRANSPOSED "grille des spécifications" markdown page (zones in columns), as
 * mistral-ocr emits it: a standalone zone-header row (empty leading label cell),
 * then one norm-label row per line. Crafted to also exercise the anti-invention
 * guards: X-9 carries a prose cell, an out-of-range superficie; Ra-2 carries an
 * m² value on a length (margin) field.
 */
const GRILLE_MD = `# GRILLE DES SPÉCIFICATIONS

|  | Ra-1 | Ra-2 | Ra-3 | X-9 |
| --- | --- | --- | --- | --- |
| Marge avant minimale (m) | 7,5 | 6 | 7,5 | voir art. 5 |
| Marge latérale minimale (m) | 3 | 415 m² | 3 | 4 |
| Marge arrière minimale (m) | 9 | 7,5 | 9 | 6 |
| Largeur minimale du lot (m) | 50 | 45 | 50 | 30 |
| Superficie minimale du lot (m²) | 2787 | 1500 | 2787 | 2 |
| Hauteur maximale (étages) | 2 | 2 | 2 | 3 |
| Coefficient d'occupation au sol max | 0,3 | 0,4 | 0,3 | 0,5 |
| Note | voir art. 12 | — | (1) | — |
`;

function byCode(zones: ZoneNormsT[], code: string): ZoneNormsT {
  const z = zones.find((x) => x.zone_code === code);
  if (!z) throw new Error(`no zone ${code}`);
  return z;
}

// ───────────────────────────────────────────────────────────────────────────
//  1. Pure markdown helpers.
// ───────────────────────────────────────────────────────────────────────────

describe("labelToFieldId", () => {
  it("maps French norm labels to the canonical FieldId", () => {
    expect(labelToFieldId("Marge avant minimale (m)")).toBe("marge_avant_min");
    expect(labelToFieldId("Marge latérale minimale (m)")).toBe("marge_laterale_min");
    expect(labelToFieldId("Marge arrière minimale (m)")).toBe("marge_arriere_min");
    expect(labelToFieldId("Largeur minimale du lot (m)")).toBe("frontage_min");
    expect(labelToFieldId("Superficie minimale du lot (m²)")).toBe("superficie_min");
    expect(labelToFieldId("Hauteur maximale (étages)")).toBe("hauteur_etages");
    expect(labelToFieldId("Coefficient d'occupation au sol max")).toBe("densite");
  });
  it("returns null for a non-norm label (no guessing)", () => {
    expect(labelToFieldId("Note")).toBeNull();
    expect(labelToFieldId("Usages permis")).toBeNull();
    expect(labelToFieldId("")).toBeNull();
  });
});

describe("splitRow / looksLikeZoneCode", () => {
  it("splits a github table row into trimmed cells", () => {
    expect(splitRow("| a | b | c |")).toEqual(["a", "b", "c"]);
    expect(splitRow("|  | Ra-1 | Ra-2 |")).toEqual(["", "Ra-1", "Ra-2"]);
  });
  it("recognises zone-code-looking cells, rejects prose", () => {
    expect(looksLikeZoneCode("Ra-1")).toBe(true);
    expect(looksLikeZoneCode("A.2")).toBe(true);
    expect(looksLikeZoneCode("X-9")).toBe(true);
    expect(looksLikeZoneCode("Normes")).toBe(false);
    expect(looksLikeZoneCode("Marge avant minimale")).toBe(false);
  });
});

describe("findGrilleTables", () => {
  it("detects the standalone zone-header row + body rows", () => {
    const tables = findGrilleTables(GRILLE_MD);
    expect(tables.length).toBe(1);
    expect(tables[0]!.zoneCodes).toEqual(["Ra-1", "Ra-2", "Ra-3", "X-9"]);
    // 8 data rows below the header (7 norms + the Note row).
    expect(tables[0]!.rows.length).toBe(8);
  });
  it("returns no table when there is no zone header", () => {
    expect(
      findGrilleTables("| Description | Total |\n| --- | --- |\n| Alpha | Beta |"),
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  2. mapMarkdownPageToZones — verbatim extraction + anti-invention guards.
// ───────────────────────────────────────────────────────────────────────────

describe("mapMarkdownPageToZones", () => {
  const zones = mapMarkdownPageToZones(GRILLE_MD, 5, OPTS);

  it("extracts one ZoneNorms per zone column", () => {
    expect(zones.map((z) => z.zone_code).sort()).toEqual(["Ra-1", "Ra-2", "Ra-3", "X-9"]);
  });

  it("publishes verbatim cell values for a clean zone (Ra-1)", () => {
    const z = byCode(zones, "Ra-1");
    expect(z.marges.avant_min?.value).toBe(7.5);
    expect(z.marges.avant_min?.unit).toBe("m");
    expect(z.marges.laterale_min?.value).toBe(3);
    expect(z.marges.arriere_min?.value).toBe(9);
    expect(z.frontage_min?.value).toBe(50);
    expect(z.superficie_min?.value).toBe(2787);
    expect(z.superficie_min?.unit).toBe("m2");
    expect(z.hauteur_max?.value).toBe(2);
    expect(z.densite?.value).toBe(0.3);
  });

  it("FR decimal comma is honoured (Ra-1 densité 0,3 → 0.3)", () => {
    expect(byCode(zones, "Ra-1").densite?.value).toBe(0.3);
    expect(byCode(zones, "Ra-1").densite?.raw).toBe("0,3");
  });

  it("ANTI-INVENTION: an m² value on a margin (length) field → null + flag", () => {
    const z = byCode(zones, "Ra-2");
    expect(z.marges.laterale_min?.value).toBeNull();
    expect(z.marges.laterale_min?.flag).toBe("unite-incoherente");
    expect(z.marges.laterale_min?.raw).toBe("415 m²");
  });

  it("ANTI-INVENTION: a prose cell → null + non-numerique (digit never lifted)", () => {
    const z = byCode(zones, "X-9");
    expect(z.marges.avant_min?.value).toBeNull();
    expect(z.marges.avant_min?.flag).toBe("non-numerique");
    expect(z.marges.avant_min?.raw).toBe("voir art. 5");
  });

  it("ANTI-INVENTION: an out-of-range superficie (2 m²) → null + hors-plage", () => {
    const z = byCode(zones, "X-9");
    expect(z.superficie_min?.value).toBeNull();
    expect(z.superficie_min?.flag).toBe("hors-plage");
  });

  it("METRIC — 0 fausse valeur: every published value is verbatim in its raw cell", () => {
    for (const z of zones) {
      const served = [
        z.densite,
        z.hauteur_max,
        z.frontage_min,
        z.superficie_min,
        z.marges.avant_min,
        z.marges.laterale_min,
        z.marges.arriere_min,
      ].filter((f) => f && f.value !== null);
      for (const f of served) {
        const raw = (f!.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
        expect(raw.includes(String(f!.value))).toBe(true);
        expect(f!.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
      }
    }
  });

  it("stamps the provenance methode (default + override)", () => {
    expect(byCode(zones, "Ra-1").densite?._provenance.methode).toBe("mistral-ocr");
    const z2 = mapMarkdownPageToZones(GRILLE_MD, 5, { ...OPTS, methode: "ocr/chandra" });
    expect(byCode(z2, "Ra-1").densite?._provenance.methode).toBe("ocr/chandra");
  });
});

describe("mapOcrResultToZones", () => {
  it("aligns OCR pages back to their original page numbers", () => {
    const result: OcrResult = { pages: [{ markdown: GRILLE_MD }], pagesProcessed: 1 };
    const zones = mapOcrResultToZones(result, [42], OPTS);
    expect(byCode(zones, "Ra-1").zone_page).toBe("PAGE 42 ZONE Ra-1");
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  3. Backend config (env-driven) + Chandra parametrability.
// ───────────────────────────────────────────────────────────────────────────

describe("resolveOcrConfig", () => {
  it("defaults to mistral-ocr against api.mistral.ai", () => {
    const c = resolveOcrConfig({ MISTRAL_API_KEY: "k" });
    expect(c.provider).toBe("mistral-ocr");
    expect(c.model).toBe(DEFAULT_OCR_MODEL);
    expect(c.apiBase).toBe("https://api.mistral.ai");
    expect(c.apiPath).toBe("/v1/ocr");
    expect(c.apiKey).toBe("k");
    expect(c.costPerPage).toBe(MISTRAL_OCR_USD_PER_PAGE);
    expect(ocrMethodeTag(c)).toBe("ocr/mistral-ocr");
  });

  it("branches to a self-hosted Chandra backend purely via env", () => {
    const c = resolveOcrConfig({
      OCR_PROVIDER: "chandra",
      OCR_MODEL: "chandra-ocr-2",
      OCR_API_BASE: "http://chandra.local:8080/",
      OCR_API_KEY: "secret",
      OCR_USD_PER_PAGE: "0.0004",
    });
    expect(c.provider).toBe("chandra");
    expect(c.model).toBe("chandra-ocr-2");
    expect(c.apiBase).toBe("http://chandra.local:8080"); // trailing slash trimmed
    expect(c.apiKey).toBe("secret");
    expect(c.costPerPage).toBe(0.0004);
    expect(ocrMethodeTag(c)).toBe("ocr/chandra");
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  4. /v1/ocr response parsing + the live HTTP call (offline, injected fetch).
// ───────────────────────────────────────────────────────────────────────────

describe("parseOcrHttpResponse", () => {
  it("reads snake_case usage_info.pages_processed", () => {
    const r = parseOcrHttpResponse({
      pages: [{ markdown: "a" }, { markdown: "b" }],
      usage_info: { pages_processed: 2 },
    });
    expect(r.pages.map((p) => p.markdown)).toEqual(["a", "b"]);
    expect(r.pagesProcessed).toBe(2);
  });
  it("reads camelCase usageInfo.pagesProcessed", () => {
    const r = parseOcrHttpResponse({ pages: [{ markdown: "a" }], usageInfo: { pagesProcessed: 7 } });
    expect(r.pagesProcessed).toBe(7);
  });
  it("falls back to page count + coerces null markdown to ''", () => {
    const r = parseOcrHttpResponse({ pages: [{ markdown: null }, {}] });
    expect(r.pagesProcessed).toBe(2);
    expect(r.pages[0]!.markdown).toBe("");
  });
});

describe("createMistralOcrHttpCall (injected fetch — no network)", () => {
  it("throws missing-api-key before any I/O when no key is configured", async () => {
    const call = createMistralOcrHttpCall(resolveOcrConfig({}));
    await expect(call("/nonexistent.pdf")).rejects.toBeInstanceOf(OcrExtractorError);
  });

  it("POSTs a base64 document to the configured endpoint and parses the result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ocr-test-"));
    const pdf = join(dir, "tiny.pdf");
    await writeFile(pdf, "%PDF-1.4 tiny");

    let seenUrl = "";
    let seenBody: unknown;
    const fakeFetch: typeof fetch = async (url, init) => {
      seenUrl = String(url);
      seenBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ pages: [{ markdown: GRILLE_MD }], usage_info: { pages_processed: 1 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const config = resolveOcrConfig({
      OCR_PROVIDER: "chandra",
      OCR_API_BASE: "http://chandra.local:8080",
      OCR_API_KEY: "k",
    });
    const call = createMistralOcrHttpCall(config, fakeFetch);
    const res = await call(pdf);

    expect(seenUrl).toBe("http://chandra.local:8080/v1/ocr");
    const body = seenBody as { model: string; document: { document_url: string } };
    expect(body.model).toBe(DEFAULT_OCR_MODEL);
    expect(body.document.document_url.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(res.pagesProcessed).toBe(1);
    expect(res.pages[0]!.markdown).toContain("GRILLE DES SPÉCIFICATIONS");
  });

  it("raises OcrExtractorError on a non-2xx response (key never echoed)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ocr-test-"));
    const pdf = join(dir, "tiny.pdf");
    await writeFile(pdf, "%PDF-1.4 tiny");
    const fakeFetch: typeof fetch = async () => new Response("unauthorized", { status: 401 });
    const call = createMistralOcrHttpCall(resolveOcrConfig({ OCR_API_KEY: "k" }), fakeFetch);
    await expect(call(pdf)).rejects.toThrow(/HTTP 401/);
  });
});
