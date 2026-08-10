import { describe, expect, it } from "vitest";
import {
  stampAncienFromReadiness,
  stripAncienFields,
} from "./reglement-stamp-ancien-from-readiness";

function fixtureReadiness() {
  const ancien_verbatim = [
    {
      slug: "alpha",
      ancien_numero_verbatim: "A-01 / tel quel",
      _note_span: { text: "REMPLACE LE REGLEMENT NUMERO A-01 / tel quel" },
    },
    {
      slug: "beta",
      ancien_numero_verbatim: "B°2",
      _note_span: { text: "ABROGE LE REGLEMENT NUMERO B°2" },
    },
  ];
  return {
    partition: { counts: { ANCIEN_VERBATIM: ancien_verbatim.length } },
    ancien_verbatim,
  };
}

function fixtureRegistry(): { $comment: string; slugs: Record<string, Record<string, unknown>> } {
  return {
    $comment: "fixture only",
    slugs: {
      alpha: { reglement_numero: "A-02", _note: "keep alpha note" },
      beta: {
        reglement_numero: "B-03",
        _note: "keep beta note",
        reglement_ancien_millesime: 1999,
      },
      hors_artefact: {
        reglement_numero: "H-01",
        _note: "this slug must not be stamped",
      },
    },
  };
}

describe("stampAncienFromReadiness", () => {
  it("stamps all three fields verbatim and derives N from the two-entry fixture", () => {
    const registry = fixtureRegistry();
    const readiness = fixtureReadiness();
    const result = stampAncienFromReadiness(registry, readiness);

    expect(result.expectedCount).toBe(readiness.ancien_verbatim.length);
    expect(result.actualCount).toBe(readiness.ancien_verbatim.length);
    expect(registry.slugs.alpha).toMatchObject({
      reglement_ancien_numero: "A-01 / tel quel",
      reglement_ancien_millesime: null,
      reglement_ancien_source: "REMPLACE LE REGLEMENT NUMERO A-01 / tel quel",
      _note: "keep alpha note",
    });
    expect(registry.slugs.beta).toMatchObject({
      reglement_ancien_numero: "B°2",
      reglement_ancien_millesime: null,
      reglement_ancien_source: "ABROGE LE REGLEMENT NUMERO B°2",
      _note: "keep beta note",
    });
  });

  it("is idempotent, including after a partial prior pass", () => {
    const registry = fixtureRegistry();
    registry.slugs.alpha.reglement_ancien_numero = "A-01 / tel quel";
    const first = stampAncienFromReadiness(registry, fixtureReadiness());
    const afterFirst = JSON.stringify(registry);
    const second = stampAncienFromReadiness(registry, fixtureReadiness());

    expect(first.changedSlugs).toBe(2);
    expect(second.changedSlugs).toBe(0);
    expect(JSON.stringify(registry)).toBe(afterFirst);
  });

  it("strips all three fields from every slug", () => {
    const registry = fixtureRegistry();
    stampAncienFromReadiness(registry, fixtureReadiness());
    registry.slugs.hors_artefact.reglement_ancien_source = "partial field";

    expect(stripAncienFields(registry)).toBe(3);
    for (const entry of Object.values(registry.slugs)) {
      expect(entry).not.toHaveProperty("reglement_ancien_numero");
      expect(entry).not.toHaveProperty("reglement_ancien_millesime");
      expect(entry).not.toHaveProperty("reglement_ancien_source");
    }
  });

  it("refuses a readiness slug absent from the registry", () => {
    const registry = fixtureRegistry();
    delete registry.slugs.beta;

    expect(() => stampAncienFromReadiness(registry, fixtureReadiness())).toThrow("registre.slugs.beta");
  });

  it("refuses a different pre-existing prior number", () => {
    const registry = fixtureRegistry();
    registry.slugs.beta.reglement_ancien_numero = "B-different";

    expect(() => stampAncienFromReadiness(registry, fixtureReadiness())).toThrow("anti-drift");
  });

  it("does not modify any slug outside the readiness artefact", () => {
    const registry = fixtureRegistry();
    const before = JSON.stringify(registry.slugs.hors_artefact);

    stampAncienFromReadiness(registry, fixtureReadiness());

    expect(JSON.stringify(registry.slugs.hors_artefact)).toBe(before);
  });
});
