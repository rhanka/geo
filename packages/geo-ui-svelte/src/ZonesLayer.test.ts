import { describe, expect, it } from "vitest";
import {
  toZonesLayerHit,
  zoneCodeFromProperties,
  zoneUsageFromProperties,
} from "./ZonesLayer.svelte";
import type { GeoFeatureHit } from "./GeoMap.svelte";

const uiHit: GeoFeatureHit = {
  id: "zone-1",
  properties: {
    zoneCode: "H-203",
    zoneUsage: "Habitation",
    category: "rezonage",
    citySlug: "longueuil",
  },
  geometry: { type: "Point", coordinates: [-73.5, 45.5] },
};

const acquisitionHit: GeoFeatureHit = {
  id: "zone-2",
  properties: {
    // raw acquisition / cadastre-clip GeoJSON shapes
    zone_code: "RM-12",
    usage_dominant: "Mixte",
  },
  geometry: null,
};

describe("ZonesLayer helpers", () => {
  it("reads the UI zone code + usage shape", () => {
    expect(zoneCodeFromProperties(uiHit.properties)).toBe("H-203");
    expect(zoneUsageFromProperties(uiHit.properties)).toBe("Habitation");
  });

  it("falls back to acquisition GeoJSON keys (zone_code / usage_dominant)", () => {
    expect(zoneCodeFromProperties(acquisitionHit.properties)).toBe("RM-12");
    expect(zoneUsageFromProperties(acquisitionHit.properties)).toBe("Mixte");
  });

  it("honours an explicit idKey before the fallback chain", () => {
    expect(
      zoneCodeFromProperties({ code: "C-9", zone_code: "ignored" }, "code"),
    ).toBe("C-9");
  });

  it("returns undefined when no code or usage is present", () => {
    expect(zoneCodeFromProperties({})).toBeUndefined();
    expect(zoneUsageFromProperties({})).toBeUndefined();
  });

  it("wraps a GeoMap hit into a zone-aware hit", () => {
    const hit = toZonesLayerHit(uiHit);
    expect(hit.zoneCode).toBe("H-203");
    expect(hit.zoneUsage).toBe("Habitation");
    expect(hit.properties).toBe(uiHit.properties);
  });
});
