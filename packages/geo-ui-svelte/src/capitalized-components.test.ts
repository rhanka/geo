import { describe, expect, it } from "vitest";
import {
  citiesToFeatureCollection,
  citySlugFromFeature,
  type CitySearchCity,
} from "./CitySearch.svelte";
import { lotIdFromProperties, toLotsLayerHit } from "./LotsLayer.svelte";
import {
  signalIdFromProperties,
  toSignalsLayerHit,
} from "./SignalsLayer.svelte";
import {
  sourceIdFromProperties,
  sourceStateFromProperties,
  sourceStatesToCategories,
  toSourceViewHit,
} from "./SourceView.svelte";
import type { GeoFeatureHit } from "./GeoMap.svelte";

const baseHit: GeoFeatureHit = {
  id: "feature-1",
  properties: {
    noLot: "1 234 567",
    signalId: "sig-1",
    citySlug: "longueuil",
    state: "verified",
  },
  geometry: { type: "Point", coordinates: [-73.5, 45.5] },
};

describe("CitySearch helpers", () => {
  it("maps city records to searchable GeoJSON features", () => {
    const cities: CitySearchCity[] = [
      {
        slug: "quebec",
        labelFr: "Québec",
        code: "23027",
        mrc: "Capitale-Nationale",
        lon: -71.2,
        lat: 46.8,
      },
      {
        slug: "ville-sans-centroide",
        labelFr: "Ville sans centroïde",
      },
    ];

    const fc = citiesToFeatureCollection(cities);

    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]?.properties?.["name"]).toBe("Québec");
    expect(fc.features[0]?.geometry).toEqual({
      type: "Point",
      coordinates: [-71.2, 46.8],
    });
    expect(fc.features[1]?.properties?.["hasCoordinates"]).toBe(false);
    expect(citySlugFromFeature(fc.features[0]!)).toBe("quebec");
  });
});

describe("LotsLayer helpers", () => {
  it("extracts stable lot ids and wraps GeoMap hits", () => {
    expect(lotIdFromProperties(baseHit.properties)).toBe("1 234 567");
    expect(lotIdFromProperties({ lotNumber: 123 })).toBe(123);
    expect(toLotsLayerHit(baseHit).lotId).toBe("1 234 567");
  });
});

describe("SignalsLayer helpers", () => {
  it("extracts stable signal ids and wraps GeoMap hits", () => {
    expect(signalIdFromProperties(baseHit.properties)).toBe("sig-1");
    expect(signalIdFromProperties({ nodeId: "gn-longueuil-1" })).toBe(
      "gn-longueuil-1",
    );
    expect(toSignalsLayerHit(baseHit).signalId).toBe("sig-1");
  });
});

describe("SourceView helpers", () => {
  it("maps source states to categories and wraps GeoMap hits", () => {
    expect(
      sourceStatesToCategories([
        { id: "verified", labelFr: "Vérifié", color: "var(--st-color-green-60)" },
      ]),
    ).toEqual([
      { id: "verified", labelFr: "Vérifié", color: "var(--st-color-green-60)" },
    ]);
    expect(sourceIdFromProperties(baseHit.properties)).toBe("longueuil");
    expect(sourceStateFromProperties(baseHit.properties)).toBe("verified");
    expect(toSourceViewHit(baseHit).sourceId).toBe("longueuil");
    expect(toSourceViewHit(baseHit).state).toBe("verified");
  });
});
