import type { SourceManifest } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import { LicenseError, assertRedistributable } from "./license-gate.js";

function manifest(license: SourceManifest["license"]): SourceManifest {
  return {
    id: "ca-qc/test",
    title: "Test source",
    jurisdiction: { country: "CA", subdivision: "CA-QC" },
    provider: { name: "Test Provider" },
    license,
    datasets: [{ id: "regions", title: "Regions", format: "geojson", url: "https://x/y.geojson" }],
  };
}

describe("assertRedistributable", () => {
  it("throws LicenseError for a proprietary manifest", () => {
    expect(() => assertRedistributable(manifest("proprietary"))).toThrow(LicenseError);
    expect(() => assertRedistributable(manifest("proprietary"))).toThrow(/redistribut/i);
  });

  it("throws LicenseError for an unknown license", () => {
    expect(() => assertRedistributable(manifest("unknown"))).toThrow(LicenseError);
  });

  it("passes for cc-by-4.0", () => {
    expect(() => assertRedistributable(manifest("cc-by-4.0"))).not.toThrow();
  });

  it("passes for ogl-ca (a redistributable open-government license)", () => {
    expect(() => assertRedistributable(manifest("ogl-ca"))).not.toThrow();
  });
});
