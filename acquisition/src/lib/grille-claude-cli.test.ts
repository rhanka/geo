import { describe, it, expect } from "vitest";

import {
  parseClaudeContent,
  mapClaudeExtractionToZones,
  buildClaudePrompt,
  type ClaudeRawExtraction,
} from "./grille-claude-cli.js";

const OPTS = { source_url: "https://example.test/grille.pdf", snapshot: "2026-06-29" };

describe("buildClaudePrompt", () => {
  it("lists every norm field and forbids invention", () => {
    const p = buildClaudePrompt();
    expect(p).toContain("marge_avant_min");
    expect(p).toContain("superficie_min");
    expect(p).toContain("densite");
    expect(p).toMatch(/null/);
    expect(p).toMatch(/VERBATIM/);
    // must request the strict zones JSON shape
    expect(p).toContain('"zones"');
  });
});

describe("parseClaudeContent", () => {
  it("parses a plain JSON object", () => {
    const r = parseClaudeContent(
      '{"zones":[{"zone_code":"A 14","fields":{"marge_avant_min":"9","hauteur_metres":"10"}}]}',
    );
    expect(r.zones).toHaveLength(1);
    expect(r.zones[0]!.zone_code).toBe("A 14");
    expect(r.zones[0]!.fields.marge_avant_min).toBe("9");
    // unspecified fields normalise to null (never fabricated)
    expect(r.zones[0]!.fields.superficie_min).toBeNull();
  });

  it("strips ```json fences", () => {
    const r = parseClaudeContent(
      '```json\n{"zones":[{"zone_code":"R-1","fields":{}}]}\n```',
    );
    expect(r.zones[0]!.zone_code).toBe("R-1");
  });

  it("isolates JSON wrapped in prose", () => {
    const r = parseClaudeContent(
      'Voici le résultat:\n{"zones":[{"zone_code":"C-2","fields":{"densite":"0,3"}}]}\nFin.',
    );
    expect(r.zones[0]!.fields.densite).toBe("0,3");
  });

  it("coerces a null cell to null, not the string 'null'", () => {
    const r = parseClaudeContent('{"zones":[{"zone_code":"X","fields":{"marge_avant_min":null}}]}');
    expect(r.zones[0]!.fields.marge_avant_min).toBeNull();
  });

  it("throws on non-JSON output", () => {
    expect(() => parseClaudeContent("the model refused")).toThrow(/did not return JSON/);
  });
});

describe("mapClaudeExtractionToZones — frozen guard reuse, anti-invention", () => {
  it("publishes a verbatim, plausible cell", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: "A 14", fields: { marge_avant_min: "9", hauteur_metres: "10" } }],
    };
    const zones = mapClaudeExtractionToZones(ext, 2, OPTS);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.zone_code).toBe("A 14");
    expect(zones[0]!.marges.avant_min!.value).toBe(9);
    expect(zones[0]!.hauteur_max!.value).toBe(10);
    expect(zones[0]!.marges.avant_min!._provenance.methode).toBe("claude-cli/opus-4-8");
  });

  // ── Régression famille "fiche par zone" (Saint-Justin, 1 zone/page, métrique
  // suivi de l'équivalent impérial). Deux défauts observés en production sur le
  // dépôt purgé du 2026-07-18 :
  //   (a) "Nombre d'étage (min./max.) : 1 / 2" publiait hauteur_max = 1 (le MIN),
  //       une valeur plausible mais FAUSSE qui passait tous les gates ;
  //   (b) "9,2 m (30,1 pi)" était refusé (garde anti-prose mordant sur "pi"),
  //       donc les 3 marges réelles ressortaient null sur toutes les zones.
  it("fiche-par-zone: publishes the MAX bound of an étage range and the metric of an imperial echo", () => {
    const ext: ClaudeRawExtraction = {
      zones: [
        {
          zone_code: "704 Af2",
          fields: {
            hauteur_etages: "1 / 2",
            hauteur_metres: null,
            marge_avant_min: "9,2 m (30,1 pi)",
            marge_laterale_min: "2,0 m (6,6 pi)",
            marge_arriere_min: "2,0 m (6,6 pi)",
          },
        },
      ],
    };
    const [zn] = mapClaudeExtractionToZones(ext, 45, OPTS);
    // (a) MAX bound published, verbatim cell kept — never the minimum.
    expect(zn!.hauteur_max!.value).toBe(2);
    expect(zn!.hauteur_max!.raw).toBe("1 / 2");
    expect(zn!.hauteur_max!.unit).toBe("etages");
    // (b) the three marges publish their METRIC reading.
    expect(zn!.marges.avant_min!.value).toBe(9.2);
    expect(zn!.marges.avant_min!.unit).toBe("m");
    expect(zn!.marges.laterale_min!.value).toBe(2);
    expect(zn!.marges.arriere_min!.value).toBe(2);
  });

  // ── Garde ROUND-TRIP (design §6b). Sur la fiche-par-zone, Mistral lit
  // "Dimension minimum (façade) : 7,6 m" — une dimension du BÂTIMENT — et la
  // range dans frontage_min (largeur du LOT). 7,6 m est une largeur de lot
  // plausible : aucun gate numérique ne peut la refuser. Seul le LIBELLÉ imprimé
  // trahit la mauvaise ligne.
  it("refuses a numerically-plausible cell whose PRINTED LABEL names another object", () => {
    const ext: ClaudeRawExtraction = {
      zones: [
        {
          zone_code: "704 Af2",
          fields: { frontage_min: "7,6 m (24,9 pi)", marge_avant_min: "9,2 m (30,1 pi)" },
          labels: {
            frontage_min: "Dimension minimum (façade)",
            marge_avant_min: "Marge de recul avant",
          },
        },
      ],
    };
    const [zn] = mapClaudeExtractionToZones(ext, 45, OPTS);
    expect(zn!.frontage_min!.value).toBeNull();
    expect(zn!.frontage_min!.flag).toBe("libelle-hors-champ");
    expect(zn!.frontage_min!.raw).toBe("7,6 m (24,9 pi)"); // verbatim gardé
    // le champ dont le libellé concorde publie normalement
    expect(zn!.marges.avant_min!.value).toBe(9.2);
  });

  // ── Garde MULTI-COLONNES. Grille « 1 zone / page » dont les colonnes sont des
  // CLASSES D'USAGES (saint-andre-avellin, Annexe B du 353-21) : marge avant 6 m
  // pour l'habitation, 10 m pour l'agricole. Aucune valeur unique n'est « la norme
  // de la zone » ; servir la 1re colonne serait faux pour l'autre classe.
  it("refuses a norm whose per-column readings diverge, keeps the concordant ones", () => {
    const ext: ClaudeRawExtraction = {
      zones: [
        {
          zone_code: "AD-102",
          fields: { marge_avant_min: "6", superficie_min: "2786", marge_laterale_min: "2" },
          columns: {
            marge_avant_min: "6 | 10",
            superficie_min: "2786 | 2786",
            marge_laterale_min: "2 | ",
          },
        },
      ],
    };
    const [zn] = mapClaudeExtractionToZones(ext, 3, OPTS);
    expect(zn!.marges.avant_min!.value).toBeNull();
    expect(zn!.marges.avant_min!.flag).toBe("divergence-colonnes");
    expect(zn!.marges.avant_min!.raw).toBe("6 | 10"); // les deux lectures gardées
    // colonnes concordantes → publiées
    expect(zn!.superficie_min!.value).toBe(2786);
    // colonne vide ≠ norme concurrente
    expect(zn!.marges.laterale_min!.value).toBe(2);
  });

  it("an ABSENT label is not a rejection (engines that cannot report labels keep publishing)", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: "A-1", fields: { frontage_min: "45 m" } }],
    };
    const [zn] = mapClaudeExtractionToZones(ext, 1, OPTS);
    expect(zn!.frontage_min!.value).toBe(45);
  });

  it("fiche-par-zone: a cross-reference height cell stays null (never a digit lifted from prose)", () => {
    const ext: ClaudeRawExtraction = {
      zones: [
        { zone_code: "704 Af2", fields: { hauteur_metres: "article 28.4", hauteur_etages: null } },
      ],
    };
    const [zn] = mapClaudeExtractionToZones(ext, 45, OPTS);
    expect(zn!.hauteur_max!.value).toBeNull();
    expect(zn!.hauteur_max!.raw).toBe("article 28.4");
  });

  it("refuses an OUT-OF-RANGE value (plausibility window) → value null", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: "Z1", fields: { marge_avant_min: "999" } }],
    };
    const zones = mapClaudeExtractionToZones(ext, 1, OPTS);
    expect(zones[0]!.marges.avant_min!.value).toBeNull();
    expect(zones[0]!.marges.avant_min!.flag).toBe("hors-plage");
    // raw is preserved (never discarded)
    expect(zones[0]!.marges.avant_min!.raw).toBe("999");
  });

  it("refuses a WRONG-UNIT cell (semantic type-check) → value null", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: "Z2", fields: { marge_avant_min: "415 m²" } }],
    };
    const zones = mapClaudeExtractionToZones(ext, 1, OPTS);
    expect(zones[0]!.marges.avant_min!.value).toBeNull();
    expect(zones[0]!.marges.avant_min!.flag).toBe("unite-incoherente");
  });

  it("keeps a null cell as null (absent), never 0", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: "Z3", fields: { marge_avant_min: null } }],
    };
    const zones = mapClaudeExtractionToZones(ext, 1, OPTS);
    expect(zones[0]!.marges.avant_min!.value).toBeNull();
  });

  it("drops a zone with no readable code (never invents one)", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: null, fields: { marge_avant_min: "9" } }],
    };
    expect(mapClaudeExtractionToZones(ext, 1, OPTS)).toHaveLength(0);
  });

  it("dedups repeated zone codes within a page (whitespace-insensitive, like the OCR mapper)", () => {
    const ext: ClaudeRawExtraction = {
      zones: [
        { zone_code: "A 14", fields: { marge_avant_min: "9" } },
        { zone_code: "A  14", fields: { marge_avant_min: "11" } },
      ],
    };
    // dedup key strips whitespace → "A14" collides; only the first read survives.
    const zones = mapClaudeExtractionToZones(ext, 1, OPTS);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.marges.avant_min!.value).toBe(9);
  });
});

describe("multizone read — many zones in one page", () => {
  it("maps every column to its own guarded ZoneNorms row", () => {
    // Mirrors the Stratford feuillet read (zones in columns).
    const ext: ClaudeRawExtraction = {
      zones: [
        { zone_code: "A 14", fields: { marge_avant_min: "9", hauteur_metres: "10" } },
        { zone_code: "A 15", fields: { marge_avant_min: "11", hauteur_metres: "10" } },
        { zone_code: "AFT1-8", fields: { marge_avant_min: "9", hauteur_metres: "10" } },
      ],
    };
    const zones = mapClaudeExtractionToZones(ext, 2, OPTS);
    expect(zones.map((z) => z.zone_code)).toEqual(["A 14", "A 15", "AFT1-8"]);
    expect(zones.every((z) => z.hauteur_max!.value === 10)).toBe(true);
    expect(zones[0]!.marges.avant_min!.value).toBe(9);
    expect(zones[1]!.marges.avant_min!.value).toBe(11);
  });
});
