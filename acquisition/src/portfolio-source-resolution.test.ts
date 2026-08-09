import { describe, expect, it } from "vitest";

// The production resolver is JavaScript; Vitest executes it directly.
// @ts-expect-error -- the repository has no declaration file for scripts/*.mjs.
import { latestZoneProvenanceQualityMatrix } from "../../scripts/lib/latest-coverage-matrix.mjs";

describe("portfolio provenance matrix resolution", () => {
  it("chooses the latest matching matrix lexicographically and ignores non-matrices", () => {
    expect(latestZoneProvenanceQualityMatrix([
      "zone-provenance-quality-matrix-20260726-0a.json",
      "zone-provenance-quality-matrix-20260725-ffff.json",
      "zone-provenance-quality-matrix-20260726-ff.json",
      "zone-provenance-quality-matrix-20260726-ff.md",
      "zone-provenance-quality-matrix-current.json",
      "another.json",
    ])).toBe("zone-provenance-quality-matrix-20260726-ff.json");
  });

  it("returns null when no valid provenance matrix exists", () => {
    expect(latestZoneProvenanceQualityMatrix(["zone-provenance-quality-matrix-current.json"])).toBeNull();
  });

  it("orders on the stamp, never on the content hash", () => {
    // Régression : le suffixe est un sha de CONTENU. Trier les noms entiers le
    // laissait départager deux runs du même jour, et le rapport a lu 23 v2 quand
    // la mesure la plus récente en comptait 36.
    expect(latestZoneProvenanceQualityMatrix([
      "zone-provenance-quality-matrix-20260726T090000Z-fe36df91.json",
      "zone-provenance-quality-matrix-20260726T133000Z-49ebdaa1.json",
    ])).toBe("zone-provenance-quality-matrix-20260726T133000Z-49ebdaa1.json");
    // Une date seule vaut le DÉBUT de sa journée : un run horodaté du même jour gagne.
    expect(latestZoneProvenanceQualityMatrix([
      "zone-provenance-quality-matrix-20260726-ffffffff.json",
      "zone-provenance-quality-matrix-20260726T000001Z-00000000.json",
    ])).toBe("zone-provenance-quality-matrix-20260726T000001Z-00000000.json");
    // Et une date plus récente bat un horodatage plus ancien.
    expect(latestZoneProvenanceQualityMatrix([
      "zone-provenance-quality-matrix-20260726T235959Z-ffffffff.json",
      "zone-provenance-quality-matrix-20260727-00000000.json",
    ])).toBe("zone-provenance-quality-matrix-20260727-00000000.json");
  });

  it("never picks a PARTIAL run, however recent", () => {
    // Un run dont des lectures S3 ont échoué sort sous ce nom : il n'a pas
    // mesuré la provenance. Le plus récent l'emporte SAUF celui-là, sinon un
    // timeout se publierait comme un effondrement de la qualité mesurée.
    expect(latestZoneProvenanceQualityMatrix([
      "zone-provenance-quality-matrix-20260725-abc.json",
      "zone-provenance-quality-PARTIAL-20260726-def.json",
    ])).toBe("zone-provenance-quality-matrix-20260725-abc.json");
    expect(latestZoneProvenanceQualityMatrix(["zone-provenance-quality-PARTIAL-20260726-def.json"])).toBeNull();
  });
});
