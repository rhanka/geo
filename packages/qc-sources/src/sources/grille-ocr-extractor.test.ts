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
  mapZoneHeaderGrillePage,
  parseNumberedGrilleNativePage,
  parseNumeroDominanceGrillePage,
  parseNumeroDominanceHeader,
  parseNormeGeneraleGrillePage,
  parseZoneBannerCode,
  looksLikeNormeGeneraleGrille,
  parseTransposedGrilleNativePage,
  looksLikeTransposedGrille,
  parseTransposedColumnsGrille,
  looksLikeTransposedColumnsGrille,
  parseAffectationMatrixGrille,
  looksLikeAffectationMatrixGrille,
  columnsHeaderZones,
  parseZoneHeader,
  isNumberedGrilleSpec,
  zonePrefixFromRow,
  asTextLineZoneHeader,
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

// ───────────────────────────────────────────────────────────────────────────
//  5. HARDENING — recover the multi-zone markdown shapes mistral-ocr-4-0 emits
//     that the first parser dropped (measured on the live corpus, see
//     work/delegation-mass/NORMES-OCR-HARDEN.md). Every fixture below is a
//     VERBATIM excerpt of real mistral-ocr-4-0 output. Anti-invention is intact:
//     these fixes only recover zone CODES; cell VALUES still flow through
//     buildVisionField unchanged.
// ───────────────────────────────────────────────────────────────────────────

const OPTS2 = { source_url: "local://muni/grille.pdf", snapshot: "2026-06-29" };

/**
 * MRC-Portneuf "FEUILLETS DES USAGES" feuillet (portneuf p.38, verbatim): the zone
 * PREFIX ("Zones Ra") sits one row above a BARE-NUMBER header (101…108). The parser
 * used to read bare "101", which is the wrong code AND collides every feuillet's
 * "101" into one zone (portneuf collapsed 161→36). Must yield Ra-101…Ra-108.
 */
const PORTNEUF_USAGES_MD = `Ville de Portneuf

|  GRILLE DES SPÉCIFICATIONS : FEUILLETS DES USAGES |   |   | Section II, feuillet A-1  |   |   |   |   |   |   |   |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  GROUPES D'USAGE | CLASSES D'USAGES | RÉFÉRENCE AU RÈGLEMENT | Zones Ra  |   |   |   |   |   |   |   |
|   |   |   |  101 | 102 | 103 | 104 | 105 | 106 | 107 | 108  |
|  HABITATION (H) | 1° Faible densité | 4.4.1 | • | • | • | • | • | • | • | •  |
`;

/**
 * MRC-Portneuf "FEUILLETS DES NORMES" feuillet (saint-raymond p.2, verbatim): the
 * prefix is buried in prose ("Zones agricoles dynamiques AD"), suffixes 1…8 below,
 * and the data rows carry real dimensional values. Must yield AD-1…AD-8 AND publish
 * the verbatim margin value (8 m) for every zone.
 */
const SAINTRAYMOND_NORMES_MD = `|  GRILLE DES SPÉCIFICATIONS : FEUILLETS DES NORMES |   |   | Feuillet B-1  |   |   |   |   |   |   |   |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  DISPOSITIONS APPLICABLES |   | RÉFÉRENCE AU RÈGLEMENT | Zones agricoles dynamiques AD  |   |   |   |   |   |   |   |
|   |  |  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8  |
|  IMPLANTATION DU BÂTIMENT PRINCIPAL | Marge de recul avant minimale (mètre) | 7.1 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8  |
`;

/**
 * Stratford feuillet 7 (verbatim): mistral-ocr lifted the zone header OUT of the
 * grid onto its own text line ("B1 B2 … M10"), so findGrilleTables saw a table with
 * no in-grid header and dropped all 15 zones.
 */
const STRATFORD_TEXTLINE_MD = `# Municipalité de Stratford (Périmètre d'urbanisation)

B1 B2 B3 B4 B5 M1 M2 M3 M4 M5 M6 M7 M8 M9 M10

|  CHASSES D USAGES | HABITATION | résidence | 6.4 | ● | ● | ● | ● | ● | ● | ● | ● | ● | ●  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|   |   | nombre de logements (max) | 6.4 | 3 | 3 | 3 | 1 | 3 | — | — | — | — | —  |
`;

/**
 * Stratford feuillet 8 (verbatim): a lone mono-letter zone "Q" rode in the header
 * "| P 1 |  | I 1 | I 2 | Q |…", dragging the ratio below the old 80 % bar and
 * rejecting the WHOLE header (4 zones lost). Must yield P 1, I 1, I 2, Q.
 */
const STRATFORD_MONO_MD = `| GRILLE DES SPÉCIFICATIONS | Réf. au règle. zonage | Municipalité de Stratford (Périmètre d'urbanisation) |
| --- | --- | --- |
| P 1 |  | I 1 | I 2 | Q |  |  |  |
| **CLASSES D USAGES** | HABITATION | résidence | 6.4 |  |  |  |  |  |  |  |  |
`;

describe("zonePrefixFromRow", () => {
  it("extracts the trailing zone prefix from a 'Zones …' label cell", () => {
    expect(zonePrefixFromRow(["GROUPES", "CLASSES", "RÉF", "Zones Ra"])).toBe("Ra");
    expect(zonePrefixFromRow(["x", "Zones agricoles dynamiques AD"])).toBe("AD");
    expect(zonePrefixFromRow(["Zones résidentielles de moyenne densité **Rb**"])).toBe("Rb");
    expect(zonePrefixFromRow(["Zones M"])).toBe("M");
  });
  it("returns null when no 'Zones <code>' cell is present (never invents one)", () => {
    expect(zonePrefixFromRow(["GROUPES D'USAGE", "CLASSES", "RÉFÉRENCE"])).toBeNull();
    expect(zonePrefixFromRow(["Zones résidentielles de faible densité"])).toBeNull();
  });
});

describe("asTextLineZoneHeader", () => {
  it("reads a standalone space-separated zone-code line", () => {
    expect(asTextLineZoneHeader("B1 B2 B3 M1 M2")).toEqual(["B1", "B2", "B3", "M1", "M2"]);
  });
  it("rejects prose / non-zone lines (no guessing)", () => {
    expect(asTextLineZoneHeader("Municipalité de Stratford (Périmètre)")).toBeNull();
    expect(asTextLineZoneHeader("Section I du règlement de zonage")).toBeNull();
    expect(asTextLineZoneHeader("Ra-1 only")).toBeNull(); // a prose word disqualifies
  });
});

describe("hardening — MRC-Portneuf numeric+prefix feuillets", () => {
  it("prefixes a bare-number header with the 'Zones Ra' row above (Ra-101…Ra-108)", () => {
    const t = findGrilleTables(PORTNEUF_USAGES_MD);
    expect(t.length).toBe(1);
    expect(t[0]!.zoneCodes).toEqual([
      "Ra-101", "Ra-102", "Ra-103", "Ra-104", "Ra-105", "Ra-106", "Ra-107", "Ra-108",
    ]);
  });

  it("de-collides identical suffixes across feuillets (Ra-101 ≠ M-101)", () => {
    const ra = mapMarkdownPageToZones(PORTNEUF_USAGES_MD, 38, OPTS2);
    const m = mapMarkdownPageToZones(PORTNEUF_USAGES_MD.replace("Zones Ra", "Zones M"), 52, OPTS2);
    const codes = new Set([...ra, ...m].map((z) => z.zone_code.toUpperCase()));
    expect(codes.has("RA-101")).toBe(true);
    expect(codes.has("M-101")).toBe(true);
    expect(codes.size).toBe(16); // 8 Ra + 8 M, no collision
  });

  it("publishes verbatim NORMES values under prefixed codes (AD-1 marge avant = 8)", () => {
    const zones = mapMarkdownPageToZones(SAINTRAYMOND_NORMES_MD, 2, OPTS2);
    expect(zones.map((z) => z.zone_code)).toEqual([
      "AD-1", "AD-2", "AD-3", "AD-4", "AD-5", "AD-6", "AD-7", "AD-8",
    ]);
    const ad1 = zones.find((z) => z.zone_code === "AD-1")!;
    expect(ad1.marges.avant_min?.value).toBe(8);
    expect(ad1.marges.avant_min?.unit).toBe("m");
  });

  it("bare numbers WITHOUT a 'Zones' prefix row are NOT prefixed (no invention)", () => {
    const md = PORTNEUF_USAGES_MD.replace("Zones Ra", "Référence");
    const t = findGrilleTables(md);
    // falls back to the plain numeric header → bare codes, never an invented prefix
    expect(t[0]!.zoneCodes.every((c) => /^\d+$/.test(c))).toBe(true);
  });
});

describe("hardening — header lifted out of the grid (text line)", () => {
  it("recovers all 15 zones from a standalone header line above the table", () => {
    const zones = mapMarkdownPageToZones(STRATFORD_TEXTLINE_MD, 7, OPTS2);
    expect(zones.map((z) => z.zone_code)).toEqual([
      "B1", "B2", "B3", "B4", "B5", "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10",
    ]);
  });
});

describe("hardening — mono-letter zone code in the header", () => {
  it("keeps a lone 'Q' instead of rejecting the whole header", () => {
    const zones = mapMarkdownPageToZones(STRATFORD_MONO_MD, 8, OPTS2);
    expect(zones.map((z) => z.zone_code)).toEqual(["P 1", "I 1", "I 2", "Q"]);
  });
  it("does NOT manufacture a header from mono-letters alone (≥2 strong codes required)", () => {
    // "Total | A | B" — two mono-letters but no strong (prefix+digit) code → no table.
    expect(findGrilleTables("| Total | A | B |\n| --- | --- | --- |\n| x | y | z |")).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  6. TWO-TIER "implantation" grilles (valcourt family) — the norm LABEL sits on
//     its own row with EMPTY cells, VALUES follow under "bâtiment principal" /
//     "- maximum"; wide sheets STACK a second zone-band ("AG-1…AF-1" then "AF-2…")
//     in ONE OCR block and pad each data row with a TRAILING empty cell. This
//     whole family used to publish at 0% fields (labels mapped to nothing, the
//     values sat on unmapped sub-rows) → rejected by the 0%-fields gate despite
//     carrying real 12/3/6 m margins, 1–3 étages, 30/10 % occupation. The fixture
//     below is a VERBATIM mistral-ocr-4-0 excerpt (valcourt, 200-…-par-zone.pdf).
// ───────────────────────────────────────────────────────────────────────────

const VALCOURT_2TIER_MD = `## Grille des normes relatives à l'implantation des bâtiments par zones

|  Normes d'implantation et dimensions | ZONES  |   |   |   |   |   |   |   |   |   |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|   |  AG-1 | AG-2 | AG-3 | AG-4 | AG-5 | AG-6 | AG-7 | AG-8 | AF-1 |   |
|  **Marge de recul avant minimale (mètres):**  |   |   |   |   |   |   |   |   |   |   |
|  bâtiment principal | 12^{1} | 12^{1} | 12 | 12 | 12^{1} | 12^{1} | 12^{1} | 12 | 12 |   |
|  bâtiments accessoires | 12^{1} | 12^{1} | 12 | 12 | 12^{1} | 12^{1} | 12^{1} | 12 | 12 |   |
|  **Marge de recul arrière minimale (mètres):**  |   |   |   |   |   |   |   |   |   |   |
|  bâtiment principal | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 |   |
|  bâtiments accessoires | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} |   |
|  **Marge de recul latérale minimale (mètres):**  |   |   |   |   |   |   |   |   |   |   |
|  bâtiment principal | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |   |
|  bâtiments accessoires | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} | 1^{2} |   |
|  **Somme minimale des marges de recul latérales**  |   |   |   |   |   |   |   |   |   |   |
|  bâtiment principal | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 |   |
|  **Hauteur du bâtiment principal:**  |   |   |   |   |   |   |   |   |   |   |
|  Nombre d'étages du bâtiment principal: |  |  |  |  |  |  |  |  |  |   |
|  - minimum | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |   |
|  - maximum | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |   |
|  hauteur en mètres (m): |  |  |  |  |  |  |  |  |  |   |
|  - minimum | - | - | - | - | - | - | - | - | - |   |
|  - maximum | - | - | - | - | - | - | - | - | - |   |
|  **Pourcentage maximal d'occupation du sol:**  |   |   |   |   |   |   |   |   |   |   |
|  bâtiment principal | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30 |   |
|  bâtiments accessoires | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |   |
|  Normes d'implantation et dimensions | ZONES  |   |   |   |   |   |   |   |   |   |
|   |  AF-2 | AF-3 | AF-4 | AF-5 | AFD-1 | AFD-2 | AFD-3 | AFD-4 | AFD-5 | AFD-6  |
|  **Marge de recul avant minimale (mètres):**  |   |   |   |   |   |   |   |   |   |   |
|  bâtiment principal | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12^{1} | 12 | 12^{1}  |
|  **Hauteur du bâtiment principal:**  |   |   |   |   |   |   |   |   |   |   |
|  Nombre d'étages du bâtiment principal: |  |  |  |  |  |  |  |  |  |   |
|  - minimum | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1  |
|  - maximum | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3  |
|  **Pourcentage maximal d'occupation du sol:**  |   |   |   |   |   |   |   |   |   |   |
|  bâtiment principal | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30  |
`;

describe("widened mapper — valcourt 2-tier / stacked-band 'implantation' grille", () => {
  it("maps the widened QC vocabulary to the 8 fields", () => {
    expect(labelToFieldId("Marge de recul avant minimale (mètres):")).toBe("marge_avant_min");
    expect(labelToFieldId("Marge de recul latérale minimale (mètres):")).toBe("marge_laterale_min");
    expect(labelToFieldId("Marge de recul arrière minimale (mètres):")).toBe("marge_arriere_min");
    expect(labelToFieldId("Nombre d'étages du bâtiment principal:")).toBe("hauteur_etages");
    expect(labelToFieldId("hauteur en mètres (m):")).toBe("hauteur_metres");
    expect(labelToFieldId("Pourcentage maximal d'occupation du sol:")).toBe("densite");
    expect(labelToFieldId("Superficie minimale du terrain")).toBe("superficie_min");
    expect(labelToFieldId("Largeur minimale du terrain (m)")).toBe("frontage_min");
    expect(labelToFieldId("Coefficient d'emprise au sol")).toBe("densite");
  });

  it("does NOT over-map a SUM of margins or a floor-area ratio (anti-over-mapping)", () => {
    expect(labelToFieldId("Somme minimale des marges de recul latérales")).toBeNull();
    expect(labelToFieldId("Rapport plancher/terrain maximal")).toBeNull();
  });

  it("splits the two stacked zone-bands in one OCR block (9 + 10 zones)", () => {
    const t = findGrilleTables(VALCOURT_2TIER_MD);
    expect(t.length).toBe(2);
    expect(t[0]!.zoneCodes).toEqual(["AG-1", "AG-2", "AG-3", "AG-4", "AG-5", "AG-6", "AG-7", "AG-8", "AF-1"]);
    expect(t[1]!.zoneCodes).toEqual(["AF-2", "AF-3", "AF-4", "AF-5", "AFD-1", "AFD-2", "AFD-3", "AFD-4", "AFD-5", "AFD-6"]);
  });

  it("carries the section label down to 'bâtiment principal' value rows (0% → >0%)", () => {
    const zones = mapMarkdownPageToZones(VALCOURT_2TIER_MD, 1, OPTS2);
    expect(zones.length).toBe(19);
    const ag1 = byCode(zones, "AG-1");
    // Column-index aligned despite the trailing padding cell → AG-1 gets AG-1's value.
    expect(ag1.marges.avant_min?.value).toBe(12);
    expect(ag1.marges.avant_min?.unit).toBe("m");
    expect(ag1.marges.avant_min?.raw).toBe("12^{1}"); // verbatim, footnote glyph kept
    expect(ag1.marges.laterale_min?.value).toBe(3); // NOT the "somme" (6)
    expect(ag1.marges.arriere_min?.value).toBe(12);
    expect(ag1.densite?.value).toBe(30);
    // hauteur split into "- minimum"(1) / "- maximum"(3) → we publish the MAX.
    expect(ag1.hauteur_max?.value).toBe(3);
    expect(ag1.hauteur_max?.unit).toBe("etages");
    // A zone from the SECOND band publishes too (was entirely lost before).
    expect(byCode(zones, "AFD-6").marges.avant_min?.value).toBe(12);
    expect(byCode(zones, "AFD-6").hauteur_max?.value).toBe(3);
  });

  it("prefers the 'principal' row over 'accessoires' for margins (first-seen)", () => {
    const zones = mapMarkdownPageToZones(VALCOURT_2TIER_MD, 1, OPTS2);
    // arrière: principal=12, accessoires=1 → we keep the principal (12).
    expect(byCode(zones, "AG-2").marges.arriere_min?.value).toBe(12);
  });

  it("METRIC — every published value is verbatim in its raw cell (0 fausse valeur)", () => {
    const zones = mapMarkdownPageToZones(VALCOURT_2TIER_MD, 1, OPTS2);
    let published = 0;
    for (const z of zones) {
      const served = [
        z.densite, z.hauteur_max, z.frontage_min, z.superficie_min,
        z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min,
      ].filter((f) => f && f.value !== null);
      published += served.length;
      for (const f of served) {
        const raw = (f!.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
        expect(raw.includes(String(f!.value))).toBe(true);
        expect(f!.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
      }
    }
    expect(published).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  7. SINGLE-ZONE-per-page "grille des spécifications" (Nicolet-family). The whole
//     page is ONE zone named in a "ZONE: <code>" header; the norm matrix is the
//     numbered NORMES-PRESCRITES rows grouped under section titles, each with a
//     "min."/"max." bound and one value column per intra-zone use-case. We publish
//     the LEFTMOST value column as the zone's representative norm. The fixture
//     below is a VERBATIM mistral-ocr-4-0 excerpt of Nicolet g-2807 page 1
//     (zone I01-132) — note the OCR misreads the serif "I" prefix as "1"
//     ("ZONE: 101-132"), which is why the runner overrides the code from the
//     reliable native text layer. Anti-invention is intact: values stay verbatim
//     and flow through the frozen buildVisionField guard.
// ───────────────────────────────────────────────────────────────────────────

const NICOLET_I01_132_MD = `41 - 2018.12

# CATEGORIES D'USAGES

ZONE: 101-132

|  1 | HABITATION | H |  |  |  |  |  |  |  |   |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  4 | multifamiliale | h3 | * | * |  |  |  |  |  |   |
|  13 | INDUSTRIEL | I |  |  |  |  |  |  |  |   |

# NORMES PRESCRITES

|  33 | STRUCTURE |  |  |  |  |  |  |  |  |   |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  34 | isolée |  | * |  | * |  | * | * | * | *  |
|  37 | TERRAIN DESSERVI (AQUEDUC ET EGOUT) |  |  |  |  |  |  |  |  |   |
|  38 | Terrain d'angle |  |  |  |  |  |  |  |  |   |
|  39 | superficie (m²) | min. | 702 | 486 | 702 | 486 | 594 | 594 | 594 | 810  |
|  40 | profondeur (m) | min. | 27 | 27 | 27 | 27 | 27 | 27 | 27 | 27  |
|  41 | largeur (m) | min. | 26 | 18 | 26 | 18 | 22 | 22 | 22 | 30  |
|  42 | Terrain intérieur |  |  |  |  |  |  |  |  |   |
|  43 | superficie (m²) | min. | 594 | 405 | 594 | 405 | 540 | 540 | 540 | 810  |
|  45 | largeur (m) | min. | 22 | 15 | 22 | 15 | 20 | 20 | 20 | 30  |
|  46 | MARGES |  |  |  |  |  |  |  |  |   |
|  47 | avant (m) | min. | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8  |
|  48 | latérale (m) | min. | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1  |
|  49 | latérale sur rue (m) | min. | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6  |
|  50 | arrière (m) | min. |  |  |  |  |  |  |  |   |
|  51 | BATIMENT |  |  |  |  |  |  |  |  |   |
|  52 | hauteur (étages) | min. | 2 | 2 | 2 | 2 |  |  |  |   |
|  53 | hauteur (étages) | max. | 3 | 3 | 3 | 3 |  |  |  |   |
|  54 | hauteur (m) | max. | 10 | 10 | 10 | 10 | 16 | 16 | 16 | 16  |
|  55 | superficie d'implantation (m²) | min. | 50 | 50 | 50 | 50 | 50 | 50 | 50 | 50  |
|  56 | largeur (m) | min. | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7  |
|  57 | RAPPORTS |  |  |  |  |  |  |  |  |   |
|  58 | logement/bâtiment | max. |  |  |  |  |  |  |  |   |
|  60 | plancher/terrain (C.O.S.) | max. |  |  |  |  |  |  |  |   |

# DISPOSITIONS PARTICULIERES

|   |  |  |  |  |  |  |  | a. 282 a. 288 a. 297 | a. 282 a. 288 a. 297  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Ville de Nicolet
Règlement de zonage numéro 77-2004
Annexe A: Grille des spécifications`;

describe("parseZoneHeader", () => {
  it("reads a 'ZONE: <code>' header verbatim (native + OCR-misread forms)", () => {
    expect(parseZoneHeader("ZONE: I01-132")).toBe("I01-132");
    expect(parseZoneHeader("CATÉGORIES D'USAGES        ZONE: 101-132")).toBe("101-132");
    expect(parseZoneHeader("ZONE:C01-181")).toBe("C01-181");
    expect(parseZoneHeader("ZONE  H01-104")).toBe("H01-104");
    expect(parseZoneHeader("ZONE: A-4-402")).toBe("A-4-402");
  });
  it("does NOT match a bare 'ZONES' band header or prose (no invention)", () => {
    expect(parseZoneHeader("| Normes | ZONES |   |   |")).toBeNull();
    expect(parseZoneHeader("Municipalité de Stratford (zone urbaine)")).toBeNull();
    expect(parseZoneHeader("no zone here")).toBeNull();
  });
});

describe("isNumberedGrilleSpec", () => {
  it("flags the numbered NORMES-PRESCRITES layout, not the transposed grids", () => {
    expect(isNumberedGrilleSpec(NICOLET_I01_132_MD)).toBe(true);
    expect(isNumberedGrilleSpec(GRILLE_MD)).toBe(false);
    expect(isNumberedGrilleSpec(VALCOURT_2TIER_MD)).toBe(false);
    expect(isNumberedGrilleSpec(PORTNEUF_USAGES_MD)).toBe(false);
  });
});

describe("mapZoneHeaderGrillePage — single-zone Nicolet-family grille", () => {
  // The runner overrides the OCR-misread "101-132" with the native-text "I01-132".
  const zones = mapZoneHeaderGrillePage(NICOLET_I01_132_MD, 1, {
    ...OPTS2,
    zoneCode: "I01-132",
  });

  it("emits exactly ONE zone, code taken verbatim from the override header", () => {
    expect(zones.length).toBe(1);
    expect(zones[0]!.zone_code).toBe("I01-132");
    expect(zones[0]!.zone_page).toBe("PAGE 1 ZONE I01-132");
  });

  it("reads the LEFTMOST value column, section-disambiguated", () => {
    const z = zones[0]!;
    expect(z.marges.avant_min?.value).toBe(8);
    expect(z.marges.avant_min?.unit).toBe("m");
    // "latérale (m)" (1) — NOT "latérale sur rue" (6), which stays unmapped.
    expect(z.marges.laterale_min?.value).toBe(1);
    // arrière is blank on this zone → honest null (never borrowed from a column).
    expect(z.marges.arriere_min?.value).toBeNull();
    // terrain superficie/largeur (frontage), first-seen "terrain d'angle" column.
    expect(z.superficie_min?.value).toBe(702);
    expect(z.superficie_min?.unit).toBe("m2");
    expect(z.frontage_min?.value).toBe(26); // NOT the BÂTIMENT "largeur (m)" (7)
    // hauteur: étages min 2 / max 3, mètres max 10 → publish the metres max.
    expect(z.hauteur_max?.value).toBe(10);
    expect(z.hauteur_max?.unit).toBe("m");
    // RAPPORTS rows are empty on this zone → densité null (no fabrication).
    expect(z.densite?.value).toBeNull();
  });

  it("METRIC — every published value is verbatim in its leftmost raw cell", () => {
    for (const z of zones) {
      const served = [
        z.densite, z.hauteur_max, z.frontage_min, z.superficie_min,
        z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min,
      ].filter((f) => f && f.value !== null);
      for (const f of served) {
        const raw = (f!.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
        expect(raw.includes(String(f!.value))).toBe(true);
        expect(f!.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
      }
    }
  });

  it("REJECTS a page with no ZONE header and no override (anti-invention)", () => {
    const noHeader = NICOLET_I01_132_MD.replace("ZONE: 101-132", "").trim();
    expect(mapZoneHeaderGrillePage(noHeader, 1, OPTS2)).toEqual([]);
  });

  it("without an override, uses the page's own header VERBATIM (the OCR misread)", () => {
    const z = mapZoneHeaderGrillePage(NICOLET_I01_132_MD, 1, OPTS2);
    expect(z.length).toBe(1);
    expect(z[0]!.zone_code).toBe("101-132"); // documents why the native override matters
  });
});

describe("mapMarkdownPageToZones auto-routes the Nicolet single-zone layout", () => {
  it("delegates to the single-zone mapper when a ZONE header + NORMES PRESCRITES", () => {
    const zones = mapMarkdownPageToZones(NICOLET_I01_132_MD, 1, { ...OPTS2, zoneCode: "I01-132" });
    expect(zones.map((z) => z.zone_code)).toEqual(["I01-132"]);
    expect(zones[0]!.marges.avant_min?.value).toBe(8);
  });
  it("mapOcrResultToZones threads a per-page native zone code override", () => {
    const result: OcrResult = { pages: [{ markdown: NICOLET_I01_132_MD }], pagesProcessed: 1 };
    const zones = mapOcrResultToZones(result, [1], OPTS2, ["I01-132"]);
    expect(zones.map((z) => z.zone_code)).toEqual(["I01-132"]);
  });
  it("the transposed multi-zone grids are UNAFFECTED (no ZONE header / NORMES band)", () => {
    // valcourt still splits into its two stacked bands (19 zones) — not single-zone.
    expect(mapMarkdownPageToZones(VALCOURT_2TIER_MD, 1, OPTS2).length).toBe(19);
    // the classic Ra-1…X-9 grid still yields its 4 zones.
    expect(mapMarkdownPageToZones(GRILLE_MD, 5, OPTS).map((z) => z.zone_code).sort()).toEqual([
      "Ra-1", "Ra-2", "Ra-3", "X-9",
    ]);
  });
});

// A VERBATIM `pdftotext -layout` excerpt of Nicolet g-2807 page 1 (zone I01-132):
// the whitespace-aligned native text layer — the code is CORRECT here ("I01-132",
// not the OCR "101-132"), and every norm value is present. This is the $0 path.
const NICOLET_I01_132_LAYOUT = `41 - 2018.12
CATÉGORIES D'USAGES                                                    ZONE: I01-132
   1    HABITATION                                                  H
   4         multifamiliale                                         h3     *     *
  13 INDUSTRIEL                                                     I
NORMES PRESCRITES
  33 STRUCTURE
  34      isolée                                                            *           *
  37 TERRAIN DESSERVI (AQUEDUC ET EGOUT)
  38 Terrain d'angle
  39      superficie (m2)                                           min.   702   486   702   486   594   594   594   810
  40      profondeur (m)                                            min.   27    27    27    27    27    27    27    27
  41      largeur (m)                                               min.   26    18    26    18    22    22    22    30
  42 Terrain intérieur
  43      superficie (m2)                                           min.   594   405   594   405   540   540   540   810
  45      largeur (m)                                               min.   22    15    22    15    20    20    20    30
  46 MARGES
  47      avant (m)                                                 min.   8     8     8     8     8     8     8     8
  48      latérale (m)                                              min.   1     1     1     1     1     1     1     1
  49      latérale sur rue (m)                                      min.   6     6     6     6     6     6     6     6
  50      arrière (m)                                               min.
  51 BÂTIMENT
  52      hauteur (étages)                                          min.    2     2     2     2
  53      hauteur (étages)                                          max.    3     3     3     3
  54      hauteur (m)                                               max.   10    10    10    10    16    16    16    16
  55      superficie d'implantation (m2)                            min.   50    50    50    50    50    50    50    50
  56      largeur (m)                                               min.    7     7     7     7     7     7     7     7
  57 RAPPORTS
  58      logement/bâtiment                                         max.
  60      plancher/terrain (C.O.S.)                                 max.
DISPOSITIONS PARTICULIÈRES
Ville de Nicolet`;

const PETITE_RIVIERE_U24_SOURCE_URL =
  "https://www.petiteriviere.com/wp-content/uploads/2020/12/RE%CC%80GLEMENT-603-RELATIF-AU-ZONAGE.pdf";
const PETITE_RIVIERE_U24_OPTS = {
  source_url: PETITE_RIVIERE_U24_SOURCE_URL,
  snapshot: "2026-07-06",
};

// Petite-Rivière-Saint-François, Règlement 603, PDF page 87, zone U-24: the
// grid's storey cell is a min/max RANGE, not the arithmetic fraction one-half.
// Reproducible derivation: `pdftotext -f 87 -l 87 -layout <pdf> -`, then retain
// the literal ZONE/NORMES/BÂTIMENT/hauteur rows below without normalising `1/2`.
const PETITE_RIVIERE_U24_HEIGHT_RANGE_LAYOUT = `
CATÉGORIES D'USAGES                                      ZONE: U-24
NORMES PRESCRITES
  51 BÂTIMENT
  52      hauteur (étages)                         max.   1/2
`;

describe("parseNumberedGrilleNativePage — deterministic $0 native-text path", () => {
  const zones = parseNumberedGrilleNativePage(NICOLET_I01_132_LAYOUT, 1, OPTS2);

  it("reads the CORRECT code from the native text layer (no OCR I→1 misread)", () => {
    expect(zones.length).toBe(1);
    expect(zones[0]!.zone_code).toBe("I01-132");
  });

  it("reads the LEFTMOST value column verbatim, section-disambiguated", () => {
    const z = zones[0]!;
    expect(z.marges.avant_min?.value).toBe(8);
    expect(z.marges.laterale_min?.value).toBe(1); // "latérale (m)", not "latérale sur rue" (6)
    expect(z.marges.arriere_min?.value).toBeNull(); // blank → honest null
    expect(z.superficie_min?.value).toBe(702);
    expect(z.frontage_min?.value).toBe(26); // terrain d'angle largeur, not BÂTIMENT (7)
    expect(z.hauteur_max?.value).toBe(10); // hauteur (m) max
    expect(z.hauteur_max?.unit).toBe("m");
  });

  it("represents U-24 height 1/2 as the 1-to-2 storey range", () => {
    const z = parseNumberedGrilleNativePage(
      PETITE_RIVIERE_U24_HEIGHT_RANGE_LAYOUT,
      87,
      PETITE_RIVIERE_U24_OPTS,
    )[0]!;

    expect(z.hauteur_min).toMatchObject({
      value: 1,
      raw: "1/2",
      unit: "etages",
    });
    expect(z.hauteur_max).toMatchObject({
      value: 2,
      raw: "1/2",
      unit: "etages",
    });
  });

  it("routes U-24 through the native parser and never enqueues its page for vision/OCR", () => {
    // This mirrors the exact native-first gate in acquisition/zonage-norms-run:
    // header + NORMES band + at least one published norm => merge + `continue`.
    const eligible =
      parseZoneHeader(PETITE_RIVIERE_U24_HEIGHT_RANGE_LAYOUT) !== null &&
      isNumberedGrilleSpec(PETITE_RIVIERE_U24_HEIGHT_RANGE_LAYOUT);
    const nativeZones = eligible
      ? parseNumberedGrilleNativePage(
          PETITE_RIVIERE_U24_HEIGHT_RANGE_LAYOUT,
          87,
          PETITE_RIVIERE_U24_OPTS,
        )
      : [];
    const z = nativeZones[0];
    const publishedCount = z
      ? [
          z.densite,
          z.hauteur_min,
          z.hauteur_max,
          z.frontage_min,
          z.superficie_min,
          z.marges.avant_min,
          z.marges.laterale_min,
          z.marges.arriere_min,
        ].filter((f) => f && f.value !== null).length
      : 0;
    const wouldEnqueueOcr = !(eligible && nativeZones.length > 0 && publishedCount > 0);

    expect(parseZoneHeader(PETITE_RIVIERE_U24_HEIGHT_RANGE_LAYOUT)).toBe("U-24");
    expect(eligible).toBe(true);
    expect(publishedCount).toBe(2);
    expect(z?.hauteur_max?._provenance.methode).toBe("native-text/grille-spec");
    expect(wouldEnqueueOcr).toBe(false);
  });

  it("matches the OCR path's values (native ⇔ OCR agreement, $0 preferred)", () => {
    const ocrZone = mapZoneHeaderGrillePage(NICOLET_I01_132_MD, 1, { ...OPTS2, zoneCode: "I01-132" })[0]!;
    expect(zones[0]!.superficie_min?.value).toBe(ocrZone.superficie_min?.value);
    expect(zones[0]!.marges.avant_min?.value).toBe(ocrZone.marges.avant_min?.value);
    expect(zones[0]!.frontage_min?.value).toBe(ocrZone.frontage_min?.value);
    expect(zones[0]!.hauteur_max?.value).toBe(ocrZone.hauteur_max?.value);
  });

  it("REJECTS a page with no ZONE header (anti-invention: no header, no zone)", () => {
    const noHeader = NICOLET_I01_132_LAYOUT.replace("ZONE: I01-132", "");
    expect(parseNumberedGrilleNativePage(noHeader, 1, OPTS2)).toEqual([]);
  });

  it("METRIC — every published value is verbatim in its raw cell", () => {
    for (const f of [
      zones[0]!.superficie_min, zones[0]!.frontage_min, zones[0]!.hauteur_max,
      zones[0]!.marges.avant_min, zones[0]!.marges.laterale_min,
    ].filter((x) => x && x.value !== null)) {
      const raw = (f!.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
      expect(raw.includes(String(f!.value))).toBe(true);
      expect(f!.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
    }
  });
});

describe("hardening — anti-invention preserved end-to-end", () => {
  it("every published value across the hardened fixtures is verbatim in its raw cell", () => {
    const all = [
      ...mapMarkdownPageToZones(PORTNEUF_USAGES_MD, 38, OPTS2),
      ...mapMarkdownPageToZones(SAINTRAYMOND_NORMES_MD, 2, OPTS2),
      ...mapMarkdownPageToZones(STRATFORD_TEXTLINE_MD, 7, OPTS2),
      ...mapMarkdownPageToZones(STRATFORD_MONO_MD, 8, OPTS2),
      ...mapMarkdownPageToZones(VALCOURT_2TIER_MD, 1, OPTS2),
    ];
    for (const z of all) {
      const served = [
        z.densite, z.hauteur_max, z.frontage_min, z.superficie_min,
        z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min,
      ].filter((f) => f && f.value !== null);
      for (const f of served) {
        const raw = (f!.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
        expect(raw.includes(String(f!.value))).toBe(true);
        expect(f!.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  TRANSPOSED native-text grille (MRC de La Matapédia / Mitis family).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Place `tokens` at the given LEFT-edge character columns, reproducing the
 * column-aligned `pdftotext -layout` projection of a transposed grille (each
 * cell begins at its zone column; blanks are simply absent tokens). A cell may
 * be "" to leave a genuinely blank column.
 */
function placeCols(positions: number[], tokens: string[]): string {
  let s = "";
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) continue;
    const p = positions[i]!;
    if (p > s.length) s += " ".repeat(p - s.length);
    s += tokens[i];
  }
  return s;
}

// Four zone columns (numbers 1, 2, 3, 20; usages Cp, Hb, Cc, Ha → codes
// "1 Cp"…"20 Ha"), laid out at left-edge columns 50/57/64/71 — the same ragged,
// column-aligned shape the real Matapédia grilles emit. The row labels end well
// before the value region (col 44). Zone "3" (col 64) carries a BLANK hauteur
// cell (an honest empty column, not a shift-fill).
const TZONE_COLS = [50, 57, 64, 71];
const TRANSPOSED_LAYOUT = [
  placeCols([0, ...TZONE_COLS], ["TABLEAU 5.1   Numéro de zone", "1", "2", "3", "20"]),
  placeCols([0, ...TZONE_COLS], ["LA GRILLE     Usage dominant", "Cp", "Hb", "Cc", "Ha"]),
  "                IMPLANTATION",
  placeCols([4, ...TZONE_COLS], ["Hauteur maximum (en étages)", "2", "3", "", "2"]),
  placeCols([4, ...TZONE_COLS], ["Coefficient d'emprise au sol maximum", "0.4", "0.4", "0.5", "0,25"]),
  "                MARGES",
  placeCols([4, ...TZONE_COLS], ["Marge de recul avant", "8", "8", "8", "9"]),
  placeCols([4, ...TZONE_COLS], ["Marge de recul arrière", "6", "6", "5", "8"]),
  placeCols([4, ...TZONE_COLS], ["Marge de recul latérale", "3", "3", "2", "3"]),
  placeCols([4, ...TZONE_COLS], ["Largeur combinée des cours latérales", "7", "7", "5", "8"]),
  "    USAGES SPÉCIFIQUEMENT PERMIS",
  "Note 1 : usages 5512 (vente au détail de véhicules usagers)",
].join("\n");

function tByCode(zones: ZoneNormsT[], code: string): ZoneNormsT {
  const z = zones.find((x) => x.zone_code === code);
  if (!z) throw new Error(`no zone ${code} in [${zones.map((x) => x.zone_code).join(", ")}]`);
  return z;
}

describe("looksLikeTransposedGrille — detection", () => {
  it("fires only when BOTH literal label rows are present", () => {
    expect(looksLikeTransposedGrille(TRANSPOSED_LAYOUT)).toBe(true);
    expect(looksLikeTransposedGrille("Numéro de zone   1  2  3")).toBe(false); // no usage row
    expect(looksLikeTransposedGrille("Usage dominant   Cp Hb")).toBe(false); // no number row
    expect(looksLikeTransposedGrille(NICOLET_I01_132_LAYOUT)).toBe(false); // Nicolet single-zone
    expect(looksLikeTransposedGrille(GRILLE_MD)).toBe(false); // horizontal markdown grid
  });
});

describe("parseTransposedGrilleNativePage — column-aligned number+usage pairing", () => {
  const zones = parseTransposedGrilleNativePage(TRANSPOSED_LAYOUT, 84, OPTS2);

  it("pairs number+usage per column → the REAL code ('20 Ha', canon HA-20)", () => {
    expect(zones.map((z) => z.zone_code).sort()).toEqual(["1 Cp", "2 Hb", "20 Ha", "3 Cc"]);
    // canonZone(digit-first) collapses "20 Ha" ⇔ the SIG "HA-20".
    const canon = (c: string): string =>
      c.toUpperCase().replace(/\s+/g, "").replace(/^0*(\d+)-?([A-Z]+)$/, "$2-$1");
    expect(zones.map((z) => canon(z.zone_code)).sort()).toContain("HA-20");
  });

  it("reads the transposed norm fields by COLUMN (hauteur, densité, marges)", () => {
    const z20 = tByCode(zones, "20 Ha");
    expect(z20.hauteur_max?.value).toBe(2); // "Hauteur maximum (en étages)"
    expect(z20.densite?.value).toBe(0.25); // "0,25" FR comma
    expect(z20.marges.avant_min?.value).toBe(9);
    expect(z20.marges.arriere_min?.value).toBe(8);
    expect(z20.marges.laterale_min?.value).toBe(3);
    // "Largeur combinée des cours latérales" is NOT a frontage → never mapped.
    expect(z20.frontage_min?.value).toBeNull();
    expect(z20.superficie_min?.value).toBeNull();
  });

  it("honours a BLANK column cell as an honest null (no shift-fill)", () => {
    const z3 = tByCode(zones, "3 Cc");
    expect(z3.hauteur_max?.value).toBeNull(); // blank hauteur cell for zone 3
    expect(z3.marges.avant_min?.value).toBe(8); // other cells still read
    expect(z3.densite?.value).toBe(0.5);
  });

  it("every published value is VERBATIM in its raw cell (anti-invention)", () => {
    for (const z of zones) {
      for (const f of [z.densite, z.hauteur_max, z.marges.avant_min, z.marges.arriere_min, z.marges.laterale_min].filter(
        (x) => x && x.value !== null,
      )) {
        const raw = (f!.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
        expect(raw.includes(String(f!.value))).toBe(true);
        expect(f!.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
      }
    }
  });
});

// Ragueneau "Cahier des spécifications" (Côte-Nord family, règl. 2015-03): the same
// transposed number+usage shape, but the usage row is labelled "Affectation
// dominante" rather than "Usage dominant". Labels/values are verbatim from p.12 of
// reglement_2015-03_zonage_cahier_specifications.pdf; "33 H" canonicalises to the
// SIG code "H-33".
const RZONE_COLS = [50, 57, 64, 71];
const RAGUENEAU_LAYOUT = [
  placeCols([0, ...RZONE_COLS], ["GROUPE ET     Numéro de zone", "33", "34", "35", "36"]),
  placeCols([0, ...RZONE_COLS], ["CLASSE        Affectation dominante", "H", "H", "H", "H"]),
  placeCols([4, ...RZONE_COLS], ["Hauteur maximale (en mètres)", "9,00", "9,00", "9,00", "9,00"]),
  placeCols([4, ...RZONE_COLS], ["Marge de recul avant", "6", "6", "6", "6"]),
].join("\n");

describe("parseTransposedGrilleNativePage — 'Affectation dominante' usage label", () => {
  it("detects the transposed signature when the usage row says 'Affectation dominante'", () => {
    expect(looksLikeTransposedGrille(RAGUENEAU_LAYOUT)).toBe(true);
  });

  it("pairs number+affectation per column → the REAL code ('33 H', canon H-33)", () => {
    const zones = parseTransposedGrilleNativePage(RAGUENEAU_LAYOUT, 12, OPTS2);
    expect(zones.map((z) => z.zone_code).sort()).toEqual(["33 H", "34 H", "35 H", "36 H"]);
  });

  it("reads the transposed norm fields by COLUMN (hauteur en mètres, marge avant)", () => {
    const zones = parseTransposedGrilleNativePage(RAGUENEAU_LAYOUT, 12, OPTS2);
    const z33 = tByCode(zones, "33 H");
    expect(z33.hauteur_max?.value).toBe(9); // "9,00" FR comma
    expect(z33.marges.avant_min?.value).toBe(6);
  });

  it("still requires BOTH literal rows (an affectation row alone proves nothing)", () => {
    expect(looksLikeTransposedGrille("Affectation dominante   H  H  H")).toBe(false);
  });
});

describe("parseTransposedGrilleNativePage — anti-invention on ragged / absent rows", () => {
  it("DROPS a number column that has no usage aligned to it (never fabricates)", () => {
    // Remove zone 3's usage token → its number column is unpaired → not emitted.
    const raggedUsage = placeCols([0, TZONE_COLS[0]!, TZONE_COLS[1]!, TZONE_COLS[3]!], [
      "LA GRILLE     Usage dominant",
      "Cp",
      "Hb",
      "Ha",
    ]);
    const layout = TRANSPOSED_LAYOUT.split("\n")
      .map((l) => (/Usage dominant/.test(l) ? raggedUsage : l))
      .join("\n");
    const zones = parseTransposedGrilleNativePage(layout, 84, OPTS2);
    expect(zones.map((z) => z.zone_code).sort()).toEqual(["1 Cp", "2 Hb", "20 Ha"]);
    expect(zones.find((z) => z.zone_code.startsWith("3 "))).toBeUndefined();
  });

  it("REFUSES a block with no 'Usage dominant' row (no paired literals → [])", () => {
    const noUsage = TRANSPOSED_LAYOUT.split("\n")
      .filter((l) => !/Usage dominant/.test(l))
      .join("\n");
    expect(parseTransposedGrilleNativePage(noUsage, 84, OPTS2)).toEqual([]);
  });

  it("REFUSES text with no 'Numéro de zone' anchor row", () => {
    expect(parseTransposedGrilleNativePage("just some prose\nUsage dominant Cp Hb", 1, OPTS2)).toEqual([]);
    expect(parseTransposedGrilleNativePage(NICOLET_I01_132_LAYOUT, 1, OPTS2)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  TRANSPOSED native-text grille — zones as COLUMNS (Sept-Îles / Saint-Tite /
//  Valcourt family). The header row carries the zone CODES DIRECTLY as columns;
//  the norm labels are ROWS below, one VALUE per zone COLUMN. Distinct from the
//  Matapédia number+usage split header above. Fixtures below reproduce, via the
//  column-placement helper, the exact codes + verbatim values read from the real
//  `pdftotext -layout` projections (Sept-Îles Grille de spécifications p.3;
//  Saint-Tite Annexe D p.2).
// ───────────────────────────────────────────────────────────────────────────

// Sept-Îles page 3 (VERBATIM codes + values): the header emits each zone as a
// "<number> <class-letter>" pair ("107 R", "110 I"), two tokens the parser merges
// into one column code. The unit "(m)" / "(%)" sits in the LABEL region (left of
// the value columns). "Largeur combinée des marges latérales minimales" is a SUM →
// never mapped to frontage (anti-over-mapping); "(2)" in parens is a note → null.
const SI_COLS = [64, 80, 96, 112, 128];
const SEPTILES_COLS_LAYOUT = [
  placeCols(SI_COLS, ["107 R", "108 R", "108-1 R", "109 R", "110 I"]),
  placeCols([0, ...SI_COLS], ["Hauteur maximale (m)", "7.5", "7.5", "7.5", "7.5", "20"]),
  placeCols([0, ...SI_COLS], ["Marge de recul avant minimale (m)", "7.5", "7.5", "7.5", "7.5", "10"]),
  placeCols([0, ...SI_COLS], ["Marge de recul arrière minimale (m)", "8", "8", "8", "8", "20"]),
  placeCols([0, ...SI_COLS], ["Marge de recul latérale minimale (m)", "2-4", "2-4", "(2)", "2-4", "10"]),
  placeCols([0, ...SI_COLS], ["Largeur combinée des marges latérales minimales (m)", "6", "6", "(2)", "6", "20"]),
  placeCols([0, ...SI_COLS], ["Coefficient d'implantation au sol (%)", "30", "30", "30", "30", "50"]),
].join("\n");

// Saint-Tite Annexe D page 2 (VERBATIM codes): the wide zone header STAGGERS across
// two adjacent lines (odd/even bands) that TOGETHER form the full column set —
// "9-Ag 11-Af 13-Af" up, "1-F 3-F 5-VB" down. The parser groups the two adjacent
// header lines into ONE band and unions their codes. Codes are digit-letter form.
const SAINTTITE_STAGGERED_LAYOUT = [
  placeCols([72, 92, 112], ["9-Ag", "11-Af", "13-Af"]),
  placeCols([60, 80, 100], ["1-F", "3-F", "5-VB"]),
  placeCols([0, 60, 72, 80, 92, 100, 112], ["Marge de recul avant minimale (m)", "7.6", "5", "7.6", "5", "7.6", "5"]),
].join("\n");

// Saint-Tite page 1 is a NOTES page, NOT a grille. N.B.20 lists CUBF code RANGES
// ("…2011 à 2020 et 2041 à 2051") — the old suffix rule fabricated the zone codes
// "2011 à" / "2020 et" / "2041 à" (a number + a lowercase connector word). The
// uppercase-initial suffix anchor rejects them, so this page yields NO zone.
const SAINTTITE_NOTE_LINE =
  "N.B.20   Industrie d'aliments et de boissons seulement à l'exception des CUBF 2011 à 2020 et 2041 à 2051.";
const SAINTTITE_NOTES_PAGE = [
  "                     NOTES DE LA GRILLE DES SPÉCIFICATIONS",
  "N.B.4    Lorsque le terrain est adjacent aux routes 153, la marge de recul avant minimale est de 10 mètres.",
  SAINTTITE_NOTE_LINE,
].join("\n");

function cByCode(zones: ZoneNormsT[], code: string): ZoneNormsT {
  const z = zones.find((x) => x.zone_code === code);
  if (!z) throw new Error(`no zone ${code} in [${zones.map((x) => x.zone_code).join(", ")}]`);
  return z;
}

describe("columnsHeaderZones — zones-in-columns header parsing", () => {
  it("merges a '<number> <class-letter>' pair into one column code (Sept-Îles)", () => {
    const header = placeCols(SI_COLS, ["107 R", "108 R", "108-1 R", "109 R", "110 I"]);
    const zs = columnsHeaderZones(header);
    expect(zs.map((z) => z.code)).toEqual(["107 R", "108 R", "108-1 R", "109 R", "110 I"]);
    // Each code is anchored at the NUMBER's left column.
    expect(zs[0]!.start).toBe(64);
  });

  it("reads digit-letter codes directly (Saint-Tite '1-F', '9-Ag')", () => {
    const zs = columnsHeaderZones(placeCols([60, 80, 100], ["1-F", "3-F", "5-VB"]));
    expect(zs.map((z) => z.code)).toEqual(["1-F", "3-F", "5-VB"]);
  });

  it("ANTI-INVENTION: a range NOTE never fabricates '<number> <connector>' codes", () => {
    // "…CUBF 2011 à 2020 et 2041 à 2051" — the lowercase connectors à/et are NOT
    // class-letters, so no "2011 à" / "2020 et" / "2041 à" is ever emitted.
    expect(columnsHeaderZones(SAINTTITE_NOTE_LINE)).toEqual([]);
  });

  it("a row of bare numeric VALUES yields no header code (no letter-bearing token)", () => {
    expect(columnsHeaderZones(placeCols([64, 80, 96], ["12", "12", "30"]))).toEqual([]);
  });
});

describe("looksLikeTransposedColumnsGrille — detection", () => {
  it("fires on a real zones-in-columns page (≥3 codes + a norm keyword)", () => {
    expect(looksLikeTransposedColumnsGrille(SEPTILES_COLS_LAYOUT)).toBe(true);
    expect(looksLikeTransposedColumnsGrille(SAINTTITE_STAGGERED_LAYOUT)).toBe(true);
  });
  it("does NOT fire on the Matapédia number+usage grille (no code-per-column header)", () => {
    expect(looksLikeTransposedColumnsGrille(TRANSPOSED_LAYOUT)).toBe(false);
  });
  it("does NOT fire on a NOTES page whose only 'codes' were fabricated ranges", () => {
    expect(looksLikeTransposedColumnsGrille(SAINTTITE_NOTES_PAGE)).toBe(false);
  });
});

// ── Affectation MATRIX (MRC de Papineau / ripon) ────────────────────────────
// The zone code is NEVER printed: the header stacks a column-number row over an
// affectation-letter row, and the code is the per-column pair ("20"+"AD" → "AD-20",
// the SIG's own spelling). Reproduced from the real ripon sheet, INCLUDING the two
// traits that broke naive readers:
//   • DRIFT — `pdftotext -layout` cannot hold a wide matrix in register, so the
//     value cells sit LEFT of their header numbers (here up to 6 chars) and
//     nearest-column pairing alone mis-binds. Value rows carry one token per column.
//   • REPEATED headers — the sheet reprints the header above each block (usages,
//     then marges). Only the LAST block carries values; binding them to an earlier
//     block's anchors would attribute one zone's norms to another.
// Columns sit well right of the row labels (as on the real sheet, where the label
// ends near col 80 and the first zone column starts at 155).
const AM_NUM_COLS = [100, 106, 112, 118, 124, 130];
const AM_LET_COLS = [100, 106, 112, 118, 124, 130];
// Value cells drift progressively left of their header number (0,-1,-2,-3,-4,-5).
const AM_VAL_COLS = [100, 105, 110, 115, 120, 125];
const AFFECTATION_MATRIX_LAYOUT = [
  "                    GRILLE DES USAGES ET NORMES",
  placeCols(AM_NUM_COLS, ["1", "2", "3", "4", "5", "6"]),
  placeCols(AM_LET_COLS, ["V", "F", "V", "AD", "AF", "iN"]),
  placeCols([4, ...AM_VAL_COLS], ["Résidence unifamiliale isolée (HAB9)", "", "*", "", "", "", ""]),
  // The header is REPRINTED above the norms block, with the amendment gutter that
  // shares the letter row (it sits outside the number run's span).
  placeCols(AM_NUM_COLS, ["1", "2", "3", "4", "5", "6"]),
  placeCols([...AM_LET_COLS, 160], ["V", "F", "V", "AD", "AF", "iN", "2022-06-400-B, 24 mars 2023"]),
  placeCols([4, ...AM_VAL_COLS], ["MARGE AVANT - Lots de 3715 mètres carrés et moins", "6m", "10m", "6m", "10m", "10m", "-"]),
  placeCols([4, ...AM_VAL_COLS], ["MARGE LATÉRALE - Lots de 3715 mètres carrés et moins", "3m", "4m", "3m", "4m", "4m", "-"]),
].join("\n");

describe("parseAffectationMatrixGrille — stacked number/letter header (MRC de Papineau)", () => {
  it("pairs each column number with its affectation → the SIG's own code", () => {
    const zones = parseAffectationMatrixGrille(AFFECTATION_MATRIX_LAYOUT, 1, OPTS2);
    expect(zones.map((z) => z.zone_code)).toEqual(["V-1", "F-2", "V-3", "AD-4", "AF-5", "iN-6"]);
  });

  it("binds each value to ITS OWN column despite the layout drift", () => {
    const zones = parseAffectationMatrixGrille(AFFECTATION_MATRIX_LAYOUT, 1, OPTS2);
    const avant = Object.fromEntries(zones.map((z) => [z.zone_code, z.marges.avant_min?.raw ?? null]));
    // Verbatim row: 6m 10m 6m 10m 10m - — zone-for-zone, no shift.
    expect(avant).toEqual({
      "V-1": "6m",
      "F-2": "10m",
      "V-3": "6m",
      "AD-4": "10m",
      "AF-5": "10m",
      "iN-6": "-",
    });
    const lat = Object.fromEntries(zones.map((z) => [z.zone_code, z.marges.laterale_min?.raw ?? null]));
    expect(lat["V-1"]).toBe("3m");
    expect(lat["AD-4"]).toBe("4m");
  });

  it("REFUSES a number row with no affectation row stacked under it", () => {
    const noLetters = [
      "                    GRILLE DES USAGES ET NORMES",
      placeCols(AM_NUM_COLS, ["1", "2", "3", "4", "5", "6"]),
      placeCols([4, ...AM_VAL_COLS], ["MARGE AVANT", "6m", "10m", "6m", "10m", "10m", "-"]),
    ].join("\n");
    expect(parseAffectationMatrixGrille(noLetters, 1, OPTS2)).toEqual([]);
  });

  it("REFUSES a numeric row that is not the run 1,2,3,… (a note/year never anchors)", () => {
    const notARun = [
      placeCols(AM_NUM_COLS, ["12", "17", "23", "31", "44", "52"]),
      placeCols(AM_LET_COLS, ["V", "F", "V", "AD", "AF", "iN"]),
      placeCols([4, ...AM_VAL_COLS], ["MARGE AVANT", "6m", "10m", "6m", "10m", "10m", "-"]),
    ].join("\n");
    expect(parseAffectationMatrixGrille(notARun, 1, OPTS2)).toEqual([]);
  });

  it("does NOT fire on the Matapédia or Sept-Îles families (exclusive signatures)", () => {
    expect(looksLikeAffectationMatrixGrille(TRANSPOSED_LAYOUT)).toBe(false);
    expect(looksLikeAffectationMatrixGrille(SEPTILES_COLS_LAYOUT)).toBe(false);
  });
});

describe("parseTransposedColumnsGrille — Sept-Îles single-line header", () => {
  const zones = parseTransposedColumnsGrille(SEPTILES_COLS_LAYOUT, 3, OPTS2);

  it("emits one ZoneNorms per column code, verbatim", () => {
    expect(zones.map((z) => z.zone_code)).toEqual(["107 R", "108 R", "108-1 R", "109 R", "110 I"]);
  });

  it("reads each zone's norm values by COLUMN (107 R)", () => {
    const z = cByCode(zones, "107 R");
    expect(z.marges.avant_min?.value).toBe(7.5);
    expect(z.marges.avant_min?.unit).toBe("m");
    expect(z.marges.arriere_min?.value).toBe(8);
    expect(z.densite?.value).toBe(30);
    expect(z.hauteur_max?.value).toBe(7.5);
    expect(z.hauteur_max?.unit).toBe("m");
  });

  it("reads a distinct column independently (110 I — industrial)", () => {
    const z = cByCode(zones, "110 I");
    expect(z.marges.avant_min?.value).toBe(10);
    expect(z.densite?.value).toBe(50);
  });

  it("ANTI-OVER-MAPPING: a 'Largeur combinée … latérales' SUM is NOT a frontage", () => {
    // frontage stays null even though the combinée row carries a value column.
    expect(cByCode(zones, "107 R").frontage_min?.value).toBeNull();
    expect(cByCode(zones, "108 R").frontage_min?.value).toBeNull();
  });

  it("reads a mid-band column independently (109 R)", () => {
    const z = cByCode(zones, "109 R");
    expect(z.marges.avant_min?.value).toBe(7.5);
    expect(z.marges.arriere_min?.value).toBe(8);
    expect(z.densite?.value).toBe(30);
  });

  it("METRIC — every published value is verbatim in its raw cell (0 fausse valeur)", () => {
    let published = 0;
    for (const z of zones) {
      const served = [
        z.densite, z.hauteur_max, z.frontage_min, z.superficie_min,
        z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min,
      ].filter((f) => f && f.value !== null);
      published += served.length;
      for (const f of served) {
        const raw = (f!.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
        expect(raw.includes(String(f!.value))).toBe(true);
        expect(f!.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
      }
    }
    expect(published).toBeGreaterThan(0);
  });

  it("stamps the zones-in-columns provenance methode", () => {
    expect(cByCode(zones, "107 R").marges.avant_min?._provenance.methode).toBe(
      "native-text/grille-transposee-colonnes",
    );
  });
});

describe("parseTransposedColumnsGrille — Saint-Tite staggered two-line header", () => {
  const zones = parseTransposedColumnsGrille(SAINTTITE_STAGGERED_LAYOUT, 2, OPTS2);

  it("unions the codes across BOTH staggered header lines into one band", () => {
    expect(zones.map((z) => z.zone_code).sort()).toEqual(
      ["1-F", "11-Af", "13-Af", "3-F", "5-VB", "9-Ag"].sort(),
    );
  });

  it("reads a norm value per column across the merged band", () => {
    expect(cByCode(zones, "1-F").marges.avant_min?.value).toBe(7.6); // lower-line zone
    expect(cByCode(zones, "9-Ag").marges.avant_min?.value).toBe(5); // upper-line zone
  });
});

describe("parseTransposedColumnsGrille — anti-invention on a NOTES page", () => {
  it("returns [] for a notes page (no real column header after the fix)", () => {
    expect(parseTransposedColumnsGrille(SAINTTITE_NOTES_PAGE, 1, OPTS2)).toEqual([]);
  });
  it("does NOT bleed into the Matapédia number+usage layout", () => {
    expect(parseTransposedColumnsGrille(NICOLET_I01_132_LAYOUT, 1, OPTS2)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  BAIE-COMEAU / Côte-Nord family — the SAME zone columns appear on a page under
//  TWO header bands (a USAGES band then a MARGE/NORMES band, identical codes at
//  identical columns), and the MARGE section splits into one-word directional
//  sub-titles ("Avant" / "Arrière" / "Latérales") each ABOVE a numbered "Générale"
//  value row. This whole muni (260 zones, SIG overlap 220/237) published at ~0%
//  fields for TWO compounding reasons the fixture below reproduces from the real
//  `pdftotext -layout` projection (baie-comeau feuillet 1, verbatim columns):
//    1. the empty USAGES-band zone SHADOWED the value-bearing NORMES-band zone
//       (per-page first-band-wins) → every real value dropped;
//    2. the "Avant/Arrière/Latérales" sub-titles mapped to nothing → the "Générale"
//       value rows had no field to bind to;
//  and a THIRD anti-invention hazard: the "Riveraine → Générale" row is filled with
//  the annex-note reference "N-2", whose shape matches a zone code — it must NOT be
//  read as a header band (no bogus "N-2" zone) NOR mapped to a margin.
const BC_COLS = [50, 66, 82, 98];
const BAIECOMEAU_MARGES_LAYOUT = [
  placeCols([0, ...BC_COLS], ["RÉSIDENTIEL", "1 CO", "8 CO", "11 V", "15 I"]),
  " 1    unifamilial isolé et jumelé",
  " 2    bifamilial isolé",
  " 7    multifamilial",
  placeCols([0, ...BC_COLS], ["MARGE", "1 CO", "8 CO", "11 V", "15 I"]),
  "Avant",
  placeCols([1, 4, ...BC_COLS], ["39", "Générale", "12.0", "12.0", "10.0", "12.0"]),
  "Arrière",
  placeCols([1, 4, ...BC_COLS], ["42", "Générale", "10.0", "10.0", "10.0", "10.0"]),
  "Latérales",
  placeCols([1, 4, ...BC_COLS], ["45", "Générale", "10.0-10.0", "10.0-10.0", "6.0-6.0", "10.0-10.0"]),
  "Riveraine",
  placeCols([1, 4, ...BC_COLS], ["51", "Générale", "N-2", "N-2", "N-2", "N-2"]),
  "DENSITE",
  placeCols([1, 4, ...BC_COLS], ["57", "indice maximal d'occupation au sol", "0.1", "0.5", "", "0.25"]),
  "AUTRES NORMES",
  placeCols([1, 4, BC_COLS[2]!, BC_COLS[3]!], ["58", "Hauteur en étages (maximum)", "2", "3"]),
].join("\n");

describe("labelToFieldId — bare directional MARGE sub-section titles (baie-comeau)", () => {
  it("maps a one-word margin sub-title to the right margin field", () => {
    expect(labelToFieldId("Avant")).toBe("marge_avant_min");
    expect(labelToFieldId("Arrière")).toBe("marge_arriere_min");
    expect(labelToFieldId("Latérales")).toBe("marge_laterale_min");
    expect(labelToFieldId("Latérale")).toBe("marge_laterale_min");
  });
  it("does NOT map 'Riveraine' (a distinct shoreline setback) nor a value-row label", () => {
    expect(labelToFieldId("Riveraine")).toBeNull(); // anti-over-mapping
    expect(labelToFieldId("39 Générale")).toBeNull(); // value-row label, not a direction
    expect(labelToFieldId("Générale")).toBeNull();
  });
});

describe("parseTransposedColumnsGrille — baie-comeau USAGES+MARGE two-band merge", () => {
  const zones = parseTransposedColumnsGrille(BAIECOMEAU_MARGES_LAYOUT, 1, OPTS2);

  it("emits one zone per column ONCE — the empty usages band never shadows the norms", () => {
    expect(zones.map((z) => z.zone_code)).toEqual(["1 CO", "8 CO", "11 V", "15 I"]);
  });

  it("binds the 'Avant/Arrière/Latérales' → 'Générale' value rows to the margins (0% → >0%)", () => {
    const z = cByCode(zones, "1 CO");
    expect(z.marges.avant_min?.value).toBe(12); // "Avant" → "39 Générale" 12.0
    expect(z.marges.arriere_min?.value).toBe(10); // "Arrière" → "42 Générale" 10.0
    expect(z.marges.laterale_min?.value).toBe(10); // "Latérales" → "45 Générale" 10.0-10.0
    expect(z.marges.laterale_min?.raw).toBe("10.0-10.0"); // verbatim (both sides kept)
    expect(z.densite?.value).toBe(0.1); // "indice maximal d'occupation au sol"
  });

  it("reads a distinct column independently (11 V — hauteur, latérale 6, blank densité)", () => {
    const z = cByCode(zones, "11 V");
    expect(z.marges.avant_min?.value).toBe(10);
    expect(z.marges.laterale_min?.value).toBe(6); // "6.0-6.0"
    expect(z.hauteur_max?.value).toBe(2); // "Hauteur en étages (maximum)"
    expect(z.hauteur_max?.unit).toBe("etages");
    expect(z.densite?.value).toBeNull(); // honest blank column (no shift-fill)
  });

  it("reads the last column (15 I — densité 0.25, hauteur 3 étages)", () => {
    const z = cByCode(zones, "15 I");
    expect(z.densite?.value).toBe(0.25);
    expect(z.hauteur_max?.value).toBe(3);
    expect(z.marges.avant_min?.value).toBe(12);
  });

  it("ANTI-INVENTION: the annex note 'N-2' is neither a zone NOR a mapped margin", () => {
    expect(zones.some((z) => /N-?2/i.test(z.zone_code))).toBe(false);
    // The "Riveraine → Générale" N-2 row maps to nothing → no margin borrows it.
    for (const z of zones) {
      for (const f of [z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min]) {
        if (f?.raw) expect(f.raw).not.toMatch(/N-?2/i);
      }
    }
  });

  it("METRIC — every published value is verbatim in its raw cell (0 fausse valeur)", () => {
    let published = 0;
    for (const z of zones) {
      const served = [
        z.densite, z.hauteur_max, z.frontage_min, z.superficie_min,
        z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min,
      ].filter((f) => f && f.value !== null);
      published += served.length;
      for (const f of served) {
        const raw = (f!.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
        expect(raw.includes(String(f!.value))).toBe(true);
        expect(f!.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
      }
    }
    expect(published).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  parseNumeroDominanceGrillePage — "Numéro de zone:" / "Dominance:" split header
//  (Béloeil / Saint-Félicien family). Column-aligned layout reproduced with
//  `placeCols`: label col 4, bound col 40, value cols 47/52/57, far note col 75.
//  Exercises: the split header, section-INDEPENDENT terse labels with the section
//  bands ("Marges"/"Bâtiment") ROTATED mid-block, CENTRED hauteur (min. above /
//  max. below the label), the value window (a far-right note number is NOT a value),
//  and every anti-over-mapping exclusion.
// ───────────────────────────────────────────────────────────────────────────

const ND_LAYOUT = [
  placeCols([0, 40, 70], ["VILLE DE TEST", "Numéro de zone:", "317"]),
  placeCols([0, 40, 70], ["GRILLE DES SPÉCIFICATIONS", "Dominance:", "R bd"]),
  "  USAGE PRINCIPAUX",
  placeCols([4, 40, 47, 52, 57], ["avant (m) : générale", "min.", "6", "6", "6"]),
  placeCols([4, 40], ["avant (m) : Réseau sup.", "min."]), // empty variant → keeps 6
  "                 Marges", // ROTATED section title, lands mid-block (AFTER avant)
  placeCols([4, 40, 47, 52, 57], ["latérale 1 (m)", "min.", "2", "0", "2"]),
  placeCols([4, 40, 47, 52, 57], ["latérale 2 (m)", "min.", "4", "4", "4"]), // 2nd → keeps first (2)
  placeCols([4, 40, 47], ["latérale sur rue (m)", "min.", "5"]), // "sur rue" → UNMAPPED
  placeCols([4, 40, 47, 52, 57], ["arrière (m)", "min.", "8", "8", "8"]),
  placeCols([4, 40], ["riveraine (voir note générale)", "min."]), // "riveraine" → UNMAPPED
  placeCols([40, 75], ["min.", "7491 Camping"]), // hauteur étages MIN (empty; far note number)
  placeCols([4], ["hauteur (étages)"]),
  placeCols([40, 47, 52, 57, 75], ["max.", "2", "2", "2", "7491 Camping"]), // hauteur étages MAX → 2
  placeCols([40], ["min."]), // hauteur m MIN (empty)
  "                 Bâtiment", // ROTATED, BETWEEN the two hauteur rows
  placeCols([4], ["hauteur (m)"]),
  placeCols([40], ["max."]), // hauteur m MAX (empty)
  placeCols([4, 40], ["largeur du(des) mur(s) avant (m)", "max."]), // wall WIDTH, not the avant margin
  "                 Rapports",
  placeCols([4, 40, 47], ["espace bâti/terrain (%)", "max.", "30"]), // densité (emprise) → 30
  placeCols([4, 40, 47], ["logement / bâtiment", "max.", "1"]), // dwelling ratio → UNMAPPED
].join("\n");

describe("parseNumeroDominanceHeader — split number/dominance header", () => {
  it("emits '<Dominance>-<Numéro>' from a same-line header (Saint-Félicien)", () => {
    expect(parseNumeroDominanceHeader(ND_LAYOUT)).toBe("R bd-317");
  });

  it("reads a number STACKED on the line above the label (Béloeil)", () => {
    const beloeil = [
      "     Grille des spécifications",
      placeCols([115], ["1001"]), // value stacked above, right of the label
      placeCols([90], ["Numéro de zone :"]),
      "",
      placeCols([70, 92], ["Dominance d'usage :", "Co"]), // "d'usage" tail skipped
    ].join("\n");
    expect(parseNumeroDominanceHeader(beloeil)).toBe("Co-1001");
  });

  it("returns null with no number or no dominance (anti-invention)", () => {
    expect(parseNumeroDominanceHeader("Numéro de zone: 12")).toBeNull(); // no dominance row
    expect(parseNumeroDominanceHeader("Dominance: Co")).toBeNull(); // no number row
    expect(parseNumeroDominanceHeader("just some prose")).toBeNull();
  });
});

describe("parseNumeroDominanceGrillePage — Béloeil / Saint-Félicien split-header grille", () => {
  const zones = parseNumeroDominanceGrillePage(ND_LAYOUT, 220, OPTS2);
  const z = zones[0]!;

  it("emits exactly one zone with the paired code 'R bd-317'", () => {
    expect(zones).toHaveLength(1);
    expect(z.zone_code).toBe("R bd-317"); // canonZone → "RBD-317", matches SIG "317 R bd"
  });

  it("maps terse directional margins despite the ROTATED mid-block section titles", () => {
    expect(z.marges.avant_min?.value).toBe(6); // "générale" wins; empty "Réseau sup." never overwrites
    expect(z.marges.laterale_min?.value).toBe(2); // leftmost value of "latérale 1"; "latérale 2" (4) never overrides
    expect(z.marges.arriere_min?.value).toBe(8);
  });

  it("binds the CENTRED hauteur: the 'max.' value under the label above/below it", () => {
    expect(z.hauteur_max?.value).toBe(2); // "hauteur (étages)" max row, borrowed across the blank label
  });

  it("maps 'espace bâti/terrain (%)' → densité (30)", () => {
    expect(z.densite?.value).toBe(30);
  });

  it("does NOT read the far-right note number as a value (value window)", () => {
    expect(z.hauteur_max?.value).toBe(2); // never 7491
  });

  it("anti-over-mapping: 'sur rue', 'riveraine', wall-width 'avant', dwelling ratio → null", () => {
    // "latérale sur rue" (5) must NOT become the latérale margin (=2), and
    // "largeur du(des) mur(s) avant" must NOT become the avant margin (=6) — both
    // asserted via the exact margin values above. Unmapped fields stay null:
    expect(z.frontage_min?.value).toBeNull();
    expect(z.superficie_min?.value).toBeNull();
    expect(z.hauteur_min).toBeNull();
  });

  it("returns [] on a page with no split header (anti-invention: no header, no zone)", () => {
    expect(parseNumeroDominanceGrillePage("just some prose with a 10 value", 1, OPTS2)).toEqual([]);
    expect(parseNumeroDominanceGrillePage(GRILLE_MD, 1, OPTS2)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  parseNormeGeneraleGrillePage — one-zone-per-page "GRILLE DES SPÉCIFICATIONS"
//  with a "Norme générale" value column + a "Normes particulières" (override
//  prose) column, and a "Zone <code>" banner whose code has NO dash (Kamouraska /
//  Bas-Saint-Laurent family). Reproduced with `placeCols`: label col 0, générale
//  value col 45, a particulières note at col 58 (BEFORE its own header col 70 — the
//  real left-aligned overflow), the sub-header "Normes particulières" at col 70.
//  Exercises: the no-dash banner (top + footer), the générale-column-only value
//  (the particulières note is never absorbed), a glued unit ("8m") vs a spaced one
//  ("10 m") vs an area ("65 m²"), and the anti-over-mapping of the BÂTIMENT
//  dimensions (Largeur / Profondeur / Superficie au sol) + "Somme des marges".
// ───────────────────────────────────────────────────────────────────────────

const KAMOURASKA_NG = [
  placeCols([0, 60], ["ANNEXE B - GRILLES DES SPÉCIFICATIONS", "Zone 5A"]),
  "",
  "USAGES AUTORISÉS",
  "GROUPE D'USAGES / A - AGRICULTURE",
  "A1   Agriculture sans élevage",
  "",
  "IMPLANTATION ET DIMENSIONS DU BÂTIMENT PRINCIPAL",
  placeCols([0, 45, 70], ["Implantation", "Norme générale", "Normes particulières"]),
  placeCols([0, 45, 58], ["Marge de recul avant minimale", "8m", "6 m pour les résidentiels"]),
  placeCols([0, 45, 58], ["Marge de recul latérale minimale", "4m", "2 m pour les résidentiels"]),
  placeCols([0, 45, 58], ["Marge de recul arrière minimale", "9m", "5 m pour les résidentiels"]),
  placeCols([0, 45, 58], ["Somme des marges latérales", "6m", "Ne s'applique pas"]),
  placeCols([0, 45, 70], ["Dimensions", "Norme générale", "Normes particulières"]),
  placeCols([0, 45], ["Hauteur maximale", "10 m"]),
  placeCols([0, 45], ["Largeur minimale", "9m"]),
  placeCols([0, 45], ["Profondeur minimale", "6m"]),
  placeCols([0, 45], ["Superficie minimale au sol", "65 m²"]),
  placeCols([0, 45, 70], ["Densité d'occupation", "Norme générale", "Normes particulières"]),
  placeCols([0, 45], ["Coefficient d'emprise au sol maximal", "0,3"]),
  "",
  placeCols([0, 60], ["RÈGLEMENT SUR LE ZONAGE NUMÉRO 2025-04 DE LA MUNICIPALITÉ DE KAMOURASKA", "Zone 5A"]),
].join("\n");

// A conservation zone whose norm cells are all BLANK (honest empty page).
const KAMOURASKA_NG_EMPTY = [
  placeCols([0, 60], ["ANNEXE B - GRILLES DES SPÉCIFICATIONS", "Zone 2PI"]),
  "IMPLANTATION ET DIMENSIONS DU BÂTIMENT PRINCIPAL",
  placeCols([0, 45, 70], ["Implantation", "Norme générale", "Normes particulières"]),
  placeCols([0], ["Marge de recul avant minimale"]),
  placeCols([0], ["Hauteur maximale"]),
  placeCols([0, 60], ["RÈGLEMENT … DE KAMOURASKA", "Zone 2PI"]),
].join("\n");

// A TERRAIN-section variant: here "Largeur"/"Superficie" ARE lot dimensions.
const NG_TERRAIN = [
  placeCols([0, 60], ["GRILLE DES SPÉCIFICATIONS", "Zone 7R"]),
  "DIMENSIONS DU TERRAIN",
  placeCols([0, 45, 70], ["Lotissement", "Norme générale", "Normes particulières"]),
  placeCols([0, 45], ["Largeur minimale", "18 m"]),
  placeCols([0, 45], ["Superficie minimale", "560 m²"]),
  placeCols([0, 60], ["RÈGLEMENT — Zone 7R", "Zone 7R"]),
].join("\n");

describe("parseZoneBannerCode — 'Zone <code>' banner (no dash)", () => {
  it("reads the most-frequent digit+letter code (header + footer)", () => {
    expect(parseZoneBannerCode(KAMOURASKA_NG)).toBe("5A");
    expect(parseZoneBannerCode("   Zone 2PI\n\n… Zone 2PI")).toBe("2PI");
    expect(parseZoneBannerCode("Zone 17P")).toBe("17P");
  });
  it("ignores a prose 'Zone agricole' band (no digit) — anti-invention", () => {
    expect(parseZoneBannerCode("Zone agricole permanente")).toBeNull();
    expect(parseZoneBannerCode("aucune zone ici")).toBeNull();
  });
});

describe("looksLikeNormeGeneraleGrille — detection", () => {
  it("fires only with a banner AND the générale/particulières sub-header", () => {
    expect(looksLikeNormeGeneraleGrille(KAMOURASKA_NG)).toBe(true);
    expect(looksLikeNormeGeneraleGrille(NG_TERRAIN)).toBe(true);
    expect(looksLikeNormeGeneraleGrille("Zone 5A\nsome prose")).toBe(false); // no sub-header
    expect(looksLikeNormeGeneraleGrille(GRILLE_MD)).toBe(false);
    expect(looksLikeNormeGeneraleGrille(NICOLET_I01_132_LAYOUT)).toBe(false);
  });
});

describe("parseNormeGeneraleGrillePage — Kamouraska 'Norme générale' one-zone grille", () => {
  const zones = parseNormeGeneraleGrillePage(KAMOURASKA_NG, 5, OPTS2);
  const z = zones[0]!;

  it("emits exactly one zone with the verbatim no-dash banner code", () => {
    expect(zones).toHaveLength(1);
    expect(z.zone_code).toBe("5A");
    expect(z.zone_page).toBe("PAGE 5 ZONE 5A");
  });

  it("reads the 'Norme générale' column, NEVER the 'Normes particulières' note", () => {
    expect(z.marges.avant_min?.value).toBe(8); // générale 8m, NOT the note's "6 m"
    expect(z.marges.avant_min?.unit).toBe("m");
    expect(z.marges.laterale_min?.value).toBe(4);
    expect(z.marges.arriere_min?.value).toBe(9);
  });

  it("handles glued ('8m'), spaced ('10 m') and area ('65 m²') value forms", () => {
    expect(z.hauteur_max?.value).toBe(10);
    expect(z.hauteur_max?.unit).toBe("m");
    expect(z.densite?.value).toBe(0.3);
  });

  it("ANTI-OVER-MAPPING: BÂTIMENT dims + 'Somme' stay UNMAPPED (null)", () => {
    // "Largeur minimale" (9m) and "Superficie minimale au sol" (65 m²) are BUILDING
    // dimensions here → never folded into the LOT frontage / superficie.
    expect(z.frontage_min?.value).toBeNull();
    expect(z.superficie_min?.value).toBeNull();
    // "Somme des marges latérales" (6m) is never a margin minimum.
    expect(z.marges.laterale_min?.value).toBe(4); // 4, not the somme 6
    expect(z.hauteur_min).toBeNull();
  });

  it("METRIC — every published value is verbatim in its raw cell (0 fausse valeur)", () => {
    for (const f of [z.densite, z.hauteur_max, z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min].filter(
      (x) => x && x.value !== null,
    )) {
      const raw = (f!.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
      expect(raw.includes(String(f!.value))).toBe(true);
      expect(f!.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
    }
  });

  it("stamps the native provenance methode", () => {
    expect(z.marges.avant_min?._provenance.methode).toBe("native-text/grille-norme-generale");
  });

  it("an all-blank (conservation) zone emits the code with honest null norms", () => {
    const e = parseNormeGeneraleGrillePage(KAMOURASKA_NG_EMPTY, 2, OPTS2);
    expect(e).toHaveLength(1);
    expect(e[0]!.zone_code).toBe("2PI");
    expect(e[0]!.marges.avant_min?.value).toBeNull();
    expect(e[0]!.hauteur_max?.value).toBeNull();
  });

  it("maps Largeur/Superficie to the LOT fields ONLY under a terrain section", () => {
    const t = parseNormeGeneraleGrillePage(NG_TERRAIN, 1, OPTS2)[0]!;
    expect(t.zone_code).toBe("7R");
    expect(t.frontage_min?.value).toBe(18);
    expect(t.superficie_min?.value).toBe(560);
    expect(t.superficie_min?.unit).toBe("m2");
  });

  it("returns [] on a page with no 'Zone <code>' banner (anti-invention)", () => {
    expect(parseNormeGeneraleGrillePage(GRILLE_MD, 1, OPTS2)).toEqual([]);
    expect(parseNormeGeneraleGrillePage(NICOLET_I01_132_LAYOUT, 1, OPTS2)).toEqual([]);
    const noBanner = KAMOURASKA_NG.replace(/Zone 5A/g, "Zone agricole");
    expect(parseNormeGeneraleGrillePage(noBanner, 5, OPTS2)).toEqual([]);
  });
});
