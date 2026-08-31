import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "@sentropic/geo-core";

import type { TokenMap } from "./encodings.js";
import type { GeoLayerSpec } from "./layers.js";
import type { GeoViewport } from "./viewport.js";
import type { AccessorFeature, DeckColor } from "./deck-compiler.js";
import { buildDeckLayerConfigs, fromDeckViewState, toDeckViewState } from "./deck-layers.js";

const tokens: TokenMap = {
  category1: "#4e79a7",
  category2: "#f28e2b",
  category3: "#59a14f",
  "border-subtle": "#e2e8f0",
};

const polygons: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { density: 12, category: "commercial", size: 8 },
      geometry: { type: "Polygon", coordinates: [[[-71.2, 46.8], [-71.1, 46.8], [-71.1, 46.9], [-71.2, 46.8]]] },
    },
  ],
};

const payload: readonly GeoLayerSpec[] = [
  {
    id: "layers/density",
    kind: "choropleth",
    data: polygons,
    fill: {
      color: { by: "valueStep", field: "density", stops: [{ upTo: 10, token: "category1" }, { upTo: Number.POSITIVE_INFINITY, token: "category2" }] },
      opacity: { by: "constant", value: 0.72 },
    },
    outline: { color: { by: "constant", token: "border-subtle" }, width: { by: "constant", value: 1 } },
    extrusion: { heightField: "density", unit: "m" },
  },
  { id: "layers/signals", kind: "points", data: { sourceRef: "signals" }, color: { by: "constant", token: "category2" }, radius: { by: "value", field: "size", domain: [0, 10], range: [4, 18] } },
];

const sample: AccessorFeature = { properties: { density: 12, category: "commercial", size: 8 } };
const evalColor = (a: unknown): DeckColor => (typeof a === "function" ? (a as (f: AccessorFeature) => DeckColor)(sample) : (a as DeckColor));
const evalNum = (a: unknown): number => (typeof a === "function" ? (a as (f: AccessorFeature) => number)(sample) : (a as number));

describe("buildDeckLayerConfigs — neutral spec → deck GeoJsonLayer config", () => {
  const configs = buildDeckLayerConfigs(payload, tokens);

  it("collapses choropleth fill + outline + extrusion into ONE layer config", () => {
    const density = configs[0]!;
    expect(density).toMatchObject({ id: "layers/density", filled: true, stroked: true, extruded: true, opacity: 0.72 });
    expect(evalColor(density.getFillColor)).toEqual([242, 142, 43, 255]); // density=12 → category2 (parity)
    expect(evalColor(density.getLineColor)).toEqual([226, 232, 240, 255]); // border-subtle
    expect(evalNum(density.getLineWidth)).toBe(1);
    expect(density.getElevation!(sample)).toBe(12); // heightField=density
  });

  it("maps points to a circle GeoJsonLayer config with color + radius accessors", () => {
    const signals = configs[1]!;
    expect(signals).toMatchObject({ id: "layers/signals", filled: true, stroked: false, extruded: false, pointType: "circle" });
    expect(evalColor(signals.getFillColor)).toEqual([242, 142, 43, 255]); // category2
    expect(evalNum(signals.getPointRadius)).toBeCloseTo(15.2, 10); // size 8 → 4 + 14·0.8
  });

  it("carries a token trigger that changes with the resolved TokenMap (F7b recompile)", () => {
    const t1 = buildDeckLayerConfigs(payload, tokens)[0]!.updateTriggers.getFillColor;
    const t2 = buildDeckLayerConfigs(payload, { ...tokens, category2: "#1d4ed8" })[0]!.updateTriggers.getFillColor;
    expect(t1).not.toBe(t2);
  });
});

describe("toDeckViewState / fromDeckViewState — 2D↔3D round-trip (§1.5)", () => {
  const vp: GeoViewport = { center: [-71.2, 46.8], zoom: 8.5, bearing: 30, pitch: 45 };

  it("maps a viewport to a deck view state on the common domain", () => {
    expect(toDeckViewState(vp)).toEqual({ longitude: -71.2, latitude: 46.8, zoom: 8.5, bearing: 30, pitch: 45 });
  });

  it("round-trips viewport → deck view state → viewport WITHOUT drift", () => {
    expect(fromDeckViewState(toDeckViewState(vp))).toEqual({ center: [-71.2, 46.8], zoom: 8.5, bearing: 30, pitch: 45 });
  });

  it("normalizes bearing on the round-trip (450° → 90°)", () => {
    expect(fromDeckViewState(toDeckViewState({ ...vp, bearing: 450 })).bearing).toBe(90);
  });
});
