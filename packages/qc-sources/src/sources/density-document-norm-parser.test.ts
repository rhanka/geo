import { describe, expect, it } from "vitest";

import {
  parseSaintDominiqueDensityDocument,
  parseStonehamDensityDocument,
} from "./density-document-norm-parser.js";

const SAINT_DOMINIQUE = [
  "MUNICIPALITÉ DE SAINT-DOMINIQUE",
  "RÈGLEMENT DE ZONAGE NUMÉRO 2017-324",
  "ZONE A-1",
  "nombre de logements / terrain (max.)       1",
  "\f",
  "ZONE H-7",
  "nombre de logements / terrain (max.)       4",
].join("\n");

const STONEHAM = [
  "Annexe 2 : Grille des spécifications – Version intégrée, Règlement de zonage numéro 09-591",
  "Zone : CP-145",
  "Densité nette (logement / hectare)  Minimum 9  Maximum 25",
  "\f",
  "Zone : F-601",
  "Densité nette (logement / hectare)  Minimum  Maximum 1/50 hectares",
].join("\n");

describe("parseSaintDominiqueDensityDocument", () => {
  it("binds the printed maximum to the zone on the same page", () => {
    const result = parseSaintDominiqueDensityDocument(SAINT_DOMINIQUE);
    expect(result.documentAnchored).toBe(true);
    expect(result.projectExcluded).toBe(false);
    expect(result.norms).toEqual([
      expect.objectContaining({
        zoneCode: "A-1",
        value: 1,
        unit: "logements/terrain",
        raw: "1",
        page: 1,
      }),
      expect.objectContaining({
        zoneCode: "H-7",
        value: 4,
        unit: "logements/terrain",
        raw: "4",
        page: 2,
      }),
    ]);
  });

  it("refuses a project and a page without a zone", () => {
    expect(parseSaintDominiqueDensityDocument(`1er projet de règlement\n${SAINT_DOMINIQUE}`).norms).toEqual([]);
    const missing = parseSaintDominiqueDensityDocument(
      SAINT_DOMINIQUE.replace("ZONE A-1", "FICHE A"),
    );
    expect(missing.refusals).toContainEqual(
      expect.objectContaining({ page: 1, reason: "zone-absente-sur-la-page" }),
    );
  });
});

describe("parseStonehamDensityDocument", () => {
  it("publishes only the printed numeric maximum and documents an unconverted ratio", () => {
    const result = parseStonehamDensityDocument(STONEHAM);
    expect(result.norms).toEqual([
      expect.objectContaining({
        zoneCode: "CP-145",
        value: 25,
        unit: "log/ha",
        raw: "25",
        page: 1,
      }),
    ]);
    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        zoneCode: "F-601",
        reason: "ratio-hectares-non-converti",
      }),
    );
  });

  it("refuses every reading when the integrated-bylaw anchor is absent", () => {
    const result = parseStonehamDensityDocument(
      STONEHAM.replace("Règlement de zonage numéro 09-591", "Document municipal"),
    );
    expect(result.documentAnchored).toBe(false);
    expect(result.norms).toEqual([]);
  });

  it("refuses a repeated zone carrying divergent maximums", () => {
    const result = parseStonehamDensityDocument(
      `${STONEHAM}\fZone : CP-145\nDensité nette (logement / hectare) Minimum 9 Maximum 30`,
    );
    expect(result.norms.find((norm) => norm.zoneCode === "CP-145")).toBeUndefined();
    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        zoneCode: "CP-145",
        reason: "valeurs-divergentes-pour-la-zone",
      }),
    );
  });
});
