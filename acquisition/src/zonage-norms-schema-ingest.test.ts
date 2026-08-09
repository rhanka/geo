import { describe, it, expect } from "vitest";

import { mergeNormField, mergeZonesFieldWise } from "./zonage-norms-schema-ingest.js";
import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

const PROV = {
  source_url: "https://example.test/annexe-b.pdf",
  methode: "ocr/mistral-schema",
  snapshot: "2026-07-19",
};

function field(value: number | null, raw: string, unit: "m" | "m2" | "etages" | null = "m") {
  return { value, raw, unit, confidence: value === null ? 0 : 0.92, _provenance: PROV };
}

function zone(over: Partial<ZoneNormsT> = {}): ZoneNormsT {
  return {
    zone_code: "AD-102",
    zone_page: "PAGE 3 ZONE AD-102",
    usages: [],
    densite: null,
    hauteur_min: null,
    hauteur_max: null,
    frontage_min: null,
    superficie_min: null,
    marges: { avant_min: null, laterale_min: null, arriere_min: null },
    ...over,
  } as ZoneNormsT;
}

// La grille « 1 zone par page » de Saint-André-Avellin (Annexe B du 353-21) donne
// UNE COLONNE PAR CLASSE D'USAGES : marge avant 6 m pour la colonne 1 (habitation),
// 10 m pour la colonne 2 (agricole). Garder la lecture « la plus riche » servirait
// la norme d'UNE classe comme la norme DE LA ZONE.
describe("mergeNormField — concordance entre colonnes de classes d'usages", () => {
  it("refuse la valeur quand les deux colonnes divergent (jamais de choix arbitraire)", () => {
    const m = mergeNormField(field(6, "6"), field(10, "10"));
    expect(m!.value).toBeNull();
    expect(m!.flag).toBe("divergence-colonnes");
    expect(m!.raw).toBe("6"); // verbatim conservé
  });

  it("garde la valeur quand les deux colonnes concordent", () => {
    expect(mergeNormField(field(45, "45"), field(45, "45"))!.value).toBe(45);
  });

  it("une valeur lue d'un seul côté est gardée (l'autre n'a rien lu)", () => {
    expect(mergeNormField(null, field(2786, "2786", "m2"))!.value).toBe(2786);
    expect(mergeNormField(field(2786, "2786", "m2"), null)!.value).toBe(2786);
    expect(mergeNormField(field(null, "—"), field(7.2, "7,2"))!.value).toBe(7.2);
  });

  it("des unités différentes pour un même nombre = divergence", () => {
    const m = mergeNormField(field(2, "2", "etages"), field(2, "2 m", "m"));
    expect(m!.value).toBeNull();
    expect(m!.flag).toBe("divergence-colonnes");
  });
});

describe("mergeZonesFieldWise", () => {
  it("réconcilie champ par champ : concordants publiés, divergents refusés", () => {
    const a = zone({
      marges: { avant_min: field(6, "6"), laterale_min: field(2, "2"), arriere_min: null },
      superficie_min: field(2786, "2786", "m2"),
    });
    const b = zone({
      marges: { avant_min: field(10, "10"), laterale_min: field(2, "2"), arriere_min: field(6, "6") },
      superficie_min: field(2786, "2786", "m2"),
    });
    const m = mergeZonesFieldWise(a, b);
    expect(m.marges.avant_min!.value).toBeNull(); // 6 ≠ 10 → refus
    expect(m.marges.laterale_min!.value).toBe(2); // concordant
    expect(m.marges.arriere_min!.value).toBe(6); // lu d'un seul côté
    expect(m.superficie_min!.value).toBe(2786);
    expect(m.zone_code).toBe("AD-102");
  });
});
