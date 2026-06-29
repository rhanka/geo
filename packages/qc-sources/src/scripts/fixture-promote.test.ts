/**
 * Tests for the `fixture promote` script (Lot L5, SPEC_PERSISTENCE_S3_FIRST §3).
 *
 * The script turns a real S3 raw object (HTML index + extracted PV text) into a
 * minimal GOLDEN fixture with an honest provenance header. Per the spec, "the
 * golden fixture is born from a parser FAILURE, not from onboarding": the script
 * runs the real pure parser (`parsePvIndex` + `detectZonageChange`) against the
 * candidate and records the observed outcome verbatim in the generated header.
 *
 * These tests cover the pure, deterministic helpers; the CLI wrapper around them
 * is a thin shell (file IO + argv) that is exercised manually via `make
 * fixture-promote`.
 */
import { describe, expect, it } from "vitest";
import {
  STRUCTURAL_FAMILIES,
  buildGoldenFixture,
  detectStructuralFamily,
  slugToConstPrefix,
  summarizeParserOutcome,
} from "./fixture-promote.js";

const SAMPLE_INDEX_HTML = `
<div class="elementor-accordion">
  <div class="elementor-accordion-item">
    <a class="elementor-accordion-title" href="https://example.ca/wp-content/uploads/2026/05/pv-2026-05-12.pdf">Procès-verbal du 12 mai 2026</a>
  </div>
  <div class="elementor-accordion-item">
    <a class="elementor-accordion-title" href="https://example.ca/wp-content/uploads/2026/04/pv-2026-04-14.pdf">Procès-verbal du 14 avril 2026</a>
  </div>
</div>
`;

const SAMPLE_PV_TEXT = `
SÉANCE ORDINAIRE DU 12 MAI 2026

AVIS DE MOTION - RÈGLEMENT 100-42 MODIFIANT LE RÈGLEMENT DE ZONAGE NUMÉRO 100
Avis de motion est donné par le conseiller, qu'il présentera pour adoption le
règlement numéro 100-42 modifiant le règlement de zonage afin de permettre
l'habitation multifamiliale dans la zone H-12.
`;

describe("detectStructuralFamily", () => {
  it("recognises the Elementor accordion family from the index HTML", () => {
    const fam = detectStructuralFamily(SAMPLE_INDEX_HTML);
    expect(fam.id).toBe("wordpress-elementor-accordion");
  });

  it("falls back to the flat-html family when no known marker is present", () => {
    const fam = detectStructuralFamily(`<ul><li><a href="x.pdf">PV</a></li></ul>`);
    expect(fam.id).toBe("flat-html-list");
  });

  it("every known family carries a non-empty human description", () => {
    for (const fam of STRUCTURAL_FAMILIES) {
      expect(fam.id.length).toBeGreaterThan(0);
      expect(fam.label.length).toBeGreaterThan(0);
    }
  });
});

describe("slugToConstPrefix", () => {
  it("maps a city slug to an upper snake-case const prefix", () => {
    expect(slugToConstPrefix("vaudreuil-dorion")).toBe("PV_VAUDREUIL_DORION");
    expect(slugToConstPrefix("saint-jacques-le-mineur")).toBe(
      "PV_SAINT_JACQUES_LE_MINEUR",
    );
  });
});

describe("summarizeParserOutcome", () => {
  it("runs the REAL parser and reports index + detection results verbatim", () => {
    const outcome = summarizeParserOutcome({
      indexHtml: SAMPLE_INDEX_HTML,
      baseUrl: "https://example.ca/pv/",
      pvText: SAMPLE_PV_TEXT,
    });
    // parsePvIndex must have found the two accordion PDF links.
    expect(outcome.indexItemCount).toBe(2);
    // detectZonageChange must have fired on the real text.
    expect(outcome.detection.avisDeMotion).toBe(true);
    expect(outcome.detection.changementZonage).toBe(true);
    expect(outcome.detection.reglementNumbers).toContain("100-42");
  });

  it("marks a parser FAILURE when the index yields zero items", () => {
    const outcome = summarizeParserOutcome({
      indexHtml: `<div>no links here</div>`,
      baseUrl: "https://example.ca/pv/",
      pvText: "néant",
    });
    expect(outcome.indexItemCount).toBe(0);
    expect(outcome.parserFailed).toBe(true);
  });
});

describe("buildGoldenFixture", () => {
  const fixture = buildGoldenFixture({
    citySlug: "example-ville",
    cityLabel: "Example-Ville",
    family: detectStructuralFamily(SAMPLE_INDEX_HTML),
    indexUrl: "https://example.ca/pv/",
    indexHtml: SAMPLE_INDEX_HTML,
    pvUrl: "https://example.ca/wp-content/uploads/2026/05/pv-2026-05-12.pdf",
    pvText: SAMPLE_PV_TEXT,
    rawMeta: {
      indexSha256: "a".repeat(64),
      pvSha256: "b".repeat(64),
      fetchedAt: "2026-06-11T00:00:00.000Z",
    },
  });

  it("emits an honest provenance header naming the source URLs and SHA256", () => {
    expect(fixture).toContain("HONESTY");
    expect(fixture).toContain("https://example.ca/pv/");
    expect(fixture).toContain("a".repeat(64));
    expect(fixture).toContain("b".repeat(64));
    expect(fixture).toContain("Fetched: 2026-06-11");
  });

  it("declares the structural family in the header (golden-set taxonomy)", () => {
    expect(fixture).toContain("STRUCTURAL FAMILY:");
    expect(fixture).toContain("wordpress-elementor-accordion");
  });

  it("records the OBSERVED parser outcome (born from a parser failure)", () => {
    expect(fixture).toContain("OBSERVED PARSER OUTCOME");
    expect(fixture).toContain("avisDeMotion");
  });

  it("exports the two expected fixture constants with the slug-derived prefix", () => {
    expect(fixture).toContain("export const PV_EXAMPLE_VILLE_INDEX_HTML");
    expect(fixture).toContain("export const PV_EXAMPLE_VILLE_TEXT");
  });

  it("never fabricates: the emitted HTML/text are the verbatim inputs", () => {
    expect(fixture).toContain("elementor-accordion-title");
    expect(fixture).toContain("RÈGLEMENT 100-42");
  });

  it("escapes backticks/${} so the generated template literals stay valid", () => {
    const tricky = buildGoldenFixture({
      citySlug: "x",
      cityLabel: "X",
      family: detectStructuralFamily("<ul></ul>"),
      indexUrl: "https://x.ca/",
      indexHtml: "a `backtick` and ${injection}",
      pvUrl: "https://x.ca/pv.pdf",
      pvText: "text with ` and ${x}",
      rawMeta: {
        indexSha256: "c".repeat(64),
        pvSha256: "d".repeat(64),
        fetchedAt: "2026-06-11T00:00:00.000Z",
      },
    });
    expect(tricky).toContain("\\`backtick\\`");
    expect(tricky).toContain("\\${injection}");
  });
});
