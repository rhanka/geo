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
