import { describe, expect, it } from "vitest";

import { classifyMunicipalZoningEventType } from "./zoning-events-type-classification.js";

describe("classifyMunicipalZoningEventType", () => {
  it("should classify a minor variance only from its verbatim municipal label", () => {
    expect(classifyMunicipalZoningEventType("Demande de dérogation mineure pour le lot 3 515 446"))
      .toBe("derogation-mineure");
  });

  it("should keep a vague municipal label as autre", () => {
    expect(classifyMunicipalZoningEventType("Dépôt d'un document au conseil municipal"))
      .toBe("autre");
  });

  it.each([
    ["Avis de rezonage du secteur nord", "changement-de-zonage"],
    ["Amendement au règlement de zonage", "changement-de-zonage"],
    ["Projet particulier de construction d'un immeuble", "ppcmoi"],
    ["Aliénation d'une partie de la zone agricole", "cptaq"],
    ["Adoption du projet de règlement no 123", "projet-reglement"],
    ["Entrée en vigueur du règlement", "entree-en-vigueur"],
    ["Consultation publique sur le règlement", "consultation"],
  ] as const)("should classify the verbatim marker %s", (label, expected) => {
    expect(classifyMunicipalZoningEventType(label)).toBe(expected);
  });

  it("should retain a substantive zoning amendment over its first-project stage", () => {
    expect(classifyMunicipalZoningEventType(
      "Adoption du premier projet de règlement modifiant le règlement de zonage",
    )).toBe("changement-de-zonage");
  });
});
