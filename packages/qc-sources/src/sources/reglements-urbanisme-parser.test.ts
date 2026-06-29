import { describe, expect, it } from "vitest";

import {
  extractPrimaryNumero,
  extractReglementBylaws,
  extractZones,
  parseReglementDocument,
  parseReglementListing,
  REGLEMENT_NON_DISPONIBLE,
  zoneKindOf,
} from "./reglements-urbanisme-parser.js";
import {
  REGLEMENT_150_51_TEXT,
  REGLEMENT_450_02_TEXT,
} from "./reglements-urbanisme-valleyfield.fixture.js";

/**
 * REAL parser tests. Every value asserted is verbatim from the committed
 * pdftotext output of a public Valleyfield bylaw PDF (anti-invention).
 */
describe("parseReglementDocument — REAL zoning règlement 150-51 (Bylaw + Zone)", () => {
  const doc = parseReglementDocument(REGLEMENT_150_51_TEXT);

  it("reads the document's own bylaw number from the header", () => {
    expect(doc.primaryNumero).toBe("150-51");
  });

  it("keeps the verbatim title line", () => {
    expect(doc.titre).toBe(
      "Règlement modifiant le Règlement 150 concernant le zonage afin de modifier certaines zones et normes",
    );
  });

  it("extracts ONLY the real bylaw numbers (150-51 primary + 150 base), never article ids or zone tails", () => {
    expect(doc.bylaws).toEqual([
      { numero: "150-51", role: "primary" },
      { numero: "150", role: "referenced" },
    ]);
    // Anti-invention guard: an article id ("17") or a zone-code tail ("521")
    // must NOT appear as a bylaw.
    const nums = doc.bylaws.map((b) => b.numero);
    expect(nums).not.toContain("17");
    expect(nums).not.toContain("521");
    expect(nums).not.toContain("334");
  });

  it("extracts every REAL zone code named in the articles, verbatim", () => {
    const codes = doc.zones.map((z) => z.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "H-334",
        "U-521",
        "H-521",
        "H-535",
        "C-566",
        "H-627-2",
        "C-627-3",
        "H-801",
        "I-918",
        "C-534",
        "H-561",
        "P-571",
        "C-627",
        "REC-137",
      ]),
    );
    // De-duplicated in order of first appearance.
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("maps each zone code to its coarse land-use kind (REC → autre)", () => {
    const byCode = new Map(doc.zones.map((z) => [z.code, z.kind]));
    expect(byCode.get("H-334")).toBe("H");
    expect(byCode.get("C-566")).toBe("C");
    expect(byCode.get("U-521")).toBe("U");
    expect(byCode.get("I-918")).toBe("I");
    expect(byCode.get("P-571")).toBe("P");
    // Multi-letter family is real but coarse-classified "autre".
    expect(byCode.get("REC-137")).toBe("autre");
  });
});

describe("parseReglementDocument — REAL plan-d'urbanisme amendment 450-02 (Bylaw only)", () => {
  const doc = parseReglementDocument(REGLEMENT_450_02_TEXT);

  it("reads bylaw numbers 450-02 (primary) + 450 (base)", () => {
    expect(doc.primaryNumero).toBe("450-02");
    expect(doc.bylaws.map((b) => b.numero)).toEqual(["450-02", "450"]);
  });

  it("HONESTY: a plan-d'urbanisme amendment names NO zone codes ⇒ zero Zone entities", () => {
    expect(doc.zones).toEqual([]);
  });
});

describe("extractors — unit-level anti-invention", () => {
  it("extractPrimaryNumero returns NON_DISPONIBLE when no header is present", () => {
    expect(extractPrimaryNumero("aucun en-tête ici")).toBe(
      REGLEMENT_NON_DISPONIBLE,
    );
  });

  it("extractReglementBylaws only captures numbers introduced by 'Règlement'", () => {
    const bylaws = extractReglementBylaws(
      "RÈGLEMENT 150-51\nArticle 17 ... la zone H-521 ... du Règlement 150",
    );
    expect(bylaws.map((b) => b.numero)).toEqual(["150-51", "150"]);
  });

  it("extractZones never captures a bare bylaw number (no letter prefix)", () => {
    expect(extractZones("Règlement 150-51 modifie la zone H-521").map((z) => z.code)).toEqual([
      "H-521",
    ]);
  });

  it("zoneKindOf maps the known single-letter prefixes and falls back to autre", () => {
    expect(zoneKindOf("H-521")).toBe("H");
    expect(zoneKindOf("A-135")).toBe("A");
    expect(zoneKindOf("REC-137")).toBe("autre");
    expect(zoneKindOf("XYZ-9")).toBe("autre");
  });
});

describe("parseReglementListing — REAL public listing markup", () => {
  const html = `
    <a href="/reglements-municipaux/projet-de-reglement-149-08-modifiant-le-reglement-149-concernant-le-lotissement">149-08</a>
    <a href="https://www.ville.valleyfield.qc.ca/reglements-municipaux/projet-de-reglement-151-03-modifiant-le-reglement-151-concernant-la-construction">151-03</a>
    <a href="/reglements-municipaux/projet-de-reglement-450-02-modifiant-le-reglement-450-concernant-le-plan-durbanisme">450-02</a>
    <a href="/reglements-municipaux/p2">pagination, no number</a>
  `;
  const entries = parseReglementListing(html);

  it("extracts each detail-page entry with its bylaw number from the slug", () => {
    const byNum = new Map(entries.map((e) => [e.numero, e.url]));
    expect(byNum.get("149-08")).toContain(
      "/reglements-municipaux/projet-de-reglement-149-08",
    );
    expect(byNum.get("151-03")).toBeDefined();
    expect(byNum.get("450-02")).toBeDefined();
  });

  it("resolves relative hrefs to absolute URLs and de-duplicates", () => {
    for (const e of entries) expect(e.url).toMatch(/^https:\/\//);
    const urls = entries.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("keeps a pagination entry with no extractable number as NON_DISPONIBLE", () => {
    const p2 = entries.find((e) => e.slug === "p2");
    expect(p2?.numero).toBe(REGLEMENT_NON_DISPONIBLE);
  });
});
