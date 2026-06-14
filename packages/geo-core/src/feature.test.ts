/**
 * Tests for the referential feature model and the generic
 * {@link NormalizedDataset} envelope. These assert (a) a referential feature
 * may carry a null geometry and minimal properties, and (b) the generic default
 * keeps existing admin-typed `NormalizedDataset` usage compiling unchanged.
 */

import { describe, expect, it } from "vitest";

import type {
  AdminFeatureCollection,
  NormalizedDataset,
  ReferentialFeature,
  ReferentialFeatureCollection,
} from "./feature.js";
import { WGS84 } from "./crs.js";
import { LICENSES } from "./license.js";

describe("referential feature model", () => {
  it("allows a null-geometry feature with minimal properties", () => {
    const feature: ReferentialFeature = {
      type: "Feature",
      geometry: null,
      properties: { geoId: "FR/postal/75001", country: "FR", commune: "75056" },
    };
    expect(feature.geometry).toBeNull();
    expect(feature.properties.country).toBe("FR");
    expect(feature.properties["commune"]).toBe("75056");
  });

  it("carries referential features in a NormalizedDataset envelope", () => {
    const collection: ReferentialFeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: null, properties: { geoId: "75001" } },
      ],
    };
    const dataset: NormalizedDataset<ReferentialFeatureCollection> = {
      meta: {
        sourceId: "fr/postal",
        datasetId: "codes-postaux",
        title: "Codes postaux",
        license: LICENSES["cc-by-4.0"],
        attribution: "© Test",
        crs: WGS84,
        fetchedAt: "2026-06-13T00:00:00.000Z",
        count: 1,
      },
      collection,
    };
    expect(dataset.collection.features[0]!.geometry).toBeNull();
    expect(dataset.meta.count).toBe(1);
  });

  it("defaults the generic to AdminFeatureCollection (no type arg)", () => {
    // A bare `NormalizedDataset` must still resolve to the admin collection, so
    // existing call sites keep typechecking. This is a compile-time assertion
    // exercised via a typed local; the runtime check is incidental.
    const admin: AdminFeatureCollection = { type: "FeatureCollection", features: [] };
    const dataset: NormalizedDataset = {
      meta: {
        sourceId: "ca-qc",
        datasetId: "regions",
        title: "Régions",
        license: LICENSES["cc-by-4.0"],
        attribution: "© Test",
        crs: WGS84,
        fetchedAt: "2026-06-13T00:00:00.000Z",
        count: 0,
      },
      collection: admin,
    };
    expect(dataset.collection.type).toBe("FeatureCollection");
  });
});
