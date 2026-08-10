import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  isZonesArcgisReplacementWorklistKey,
  parseReplacementRunId,
  parseVerifiedReplacementWorklist,
} from "./zones-arcgis-replacement-capture-run.js";
import {
  assertReplacementTargetMatchesMunicipalityRegister,
  parseZonesArcgisReplacementWorklist,
  serializeZonesArcgisReplacementWorklist,
} from "./lib/zones-arcgis-replacement-worklist.js";

const worklist = parseZonesArcgisReplacementWorklist({
  contract: "zones-arcgis-replacement/v1",
  targets: [{
    slug: "audet",
    source: "zones-arcgis",
    layer: "https://services.example/FeatureServer/0",
    municipality_filter: { field: "MUNICIPAL", value: "Audet" },
    zone_field: "ZONE",
    max_distance_km: 8,
  }],
});

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("zones ArcGIS replacement capture runner", () => {
  it("accepts only the exact canonical S3 worklist body", () => {
    const body = Buffer.from(serializeZonesArcgisReplacementWorklist(worklist));
    expect(parseVerifiedReplacementWorklist(body, sha256(body))).toEqual(worklist);
    expect(() => parseVerifiedReplacementWorklist(Buffer.from(`${body.toString()} `), sha256(body))).toThrow(/divergente/);
    const reordered = Buffer.from(JSON.stringify({ targets: worklist.targets, contract: worklist.contract }));
    expect(() => parseVerifiedReplacementWorklist(reordered, sha256(reordered))).toThrow(/non canonique/);
  });

  it("requires a dedicated replacement prefix and a per-city run identifier", () => {
    expect(isZonesArcgisReplacementWorklistKey("registry/capture-worklists/zones-arcgis-replacement/audet-20260810T010203Z.json")).toBe(true);
    expect(isZonesArcgisReplacementWorklistKey("registry/capture-worklists/zones-20260810T010203Z.json")).toBe(false);
    expect(parseReplacementRunId("zones-20260810T010203Z-audet")).toBe("zones-20260810T010203Z-audet");
    expect(() => parseReplacementRunId("zones-20260810T010203Z-audet/other")).toThrow(/RUN_ID/);
  });

  it("binds the filter value to the registered municipality behind the slug", () => {
    expect(() => assertReplacementTargetMatchesMunicipalityRegister(worklist.targets[0], [
      { slug: "audet", name: "Another city" },
    ])).toThrow(/ne correspond pas/);
    expect(() => assertReplacementTargetMatchesMunicipalityRegister(worklist.targets[0], [])).toThrow(/absent du registre/);
    expect(() => assertReplacementTargetMatchesMunicipalityRegister(worklist.targets[0], [
      { slug: "audet", name: "Audet" },
    ])).not.toThrow();
  });
});
