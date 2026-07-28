import { describe, expect, it } from "vitest";

import { parseMontLaurierZonesHDensityDocument } from "./densityDocument.js";

const header = [
  "VILLE DE MONT-LAURIER",
  "GRILLE DES USAGES ET NORMES PAR ZONE",
  "ANNEXÉE AU RÈGLEMENT DE ZONAGE NUMÉRO: 134",
].join("\n");

describe("parseMontLaurierZonesHDensityDocument", () => {
  it("publishes a zone maximum when every printed use column agrees", () => {
    const parsed = parseMontLaurierZonesHDensityDocument([
      header,
      "ZONE: H-453",
      "Logement / Hectare maximum       25   25   25   25   25",
    ].join("\n"));

    expect(parsed).toMatchObject({
      documentAnchored: true,
      projectExcluded: false,
      refusals: [],
      norms: [{
        zoneCode: "H-453",
        value: 25,
        unit: "log/ha",
        raw: "25 | 25 | 25 | 25 | 25",
        page: 1,
      }],
    });
    expect(parsed.norms[0]?.proof).toContain("Logement / Hectare maximum");
  });

  it("refuses to choose among divergent use-class columns", () => {
    const parsed = parseMontLaurierZonesHDensityDocument([
      header,
      "ZONE: H-453",
      "Logement / Hectare maximum       25   30",
    ].join("\n"));

    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals).toEqual([expect.objectContaining({
      zoneCode: "H-453",
      reason: "valeurs-divergentes-entre-colonnes-usages",
    })]);
  });

  it("refuses a density row that has no zone on its page", () => {
    const parsed = parseMontLaurierZonesHDensityDocument([
      header,
      "Logement / Hectare maximum       25",
    ].join("\n"));

    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("zone-absente-sur-la-page");
  });

  it("excludes a project document even when its cells look complete", () => {
    const parsed = parseMontLaurierZonesHDensityDocument([
      header,
      "PREMIER PROJET DE RÈGLEMENT",
      "ZONE: H-453",
      "Logement / Hectare maximum       25",
    ].join("\n"));

    expect(parsed.projectExcluded).toBe(true);
    expect(parsed.norms).toEqual([]);
  });
});
