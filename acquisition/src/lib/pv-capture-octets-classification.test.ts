import { describe, expect, it } from "vitest";

import { classifyReadablePvText } from "./pv-capture-octets-classification.js";

describe("PV captured-octet classification", () => {
  it("requires both a printed PV marker and the printed municipality owner", () => {
    expect(classifyReadablePvText("VILLE D’ALPHA\nPROCÈS-VERBAL DE LA SÉANCE ORDINAIRE", "Ville d'Alpha"))
      .toMatchObject({ classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME", owner_verbatim: "VILLE D’ALPHA" });
    expect(classifyReadablePvText("PROCÈS-VERBAL DE LA SÉANCE ORDINAIRE", "Ville d'Alpha"))
      .toMatchObject({ classification: "PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME" });
  });

  it("does not promote a readable non-PV document", () => {
    expect(classifyReadablePvText("VILLE D'ALPHA\nORDRE DU JOUR", "Ville d'Alpha"))
      .toMatchObject({ classification: "DOCUMENT_LISIBLE_NON_PV", pv_verbatim: null });
  });
});
