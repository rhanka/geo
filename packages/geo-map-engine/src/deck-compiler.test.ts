import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "@sentropic/geo-core";

import type { ColorEncoding, TokenMap } from "./encodings.js";
import type { GeoLayerSpec } from "./layers.js";
import { compileColorEncoding, compileNumberEncoding } from "./paint-compiler.js";
import {
  type AccessorFeature,
  type DeckColor,
  compileColorEncodingDeck,
  compileNumberEncodingDeck,
  createDeckLayerProjector,
  parseTokenColor,
  projectDeckLayer,
} from "./deck-compiler.js";

const tokens: TokenMap = {
  category1: "#4e79a7",
  category2: "#f28e2b",
  category3: "#59a14f",
  "border-subtle": "#e2e8f0",
};

function feat(properties: Record<string, unknown>): AccessorFeature {
  return { properties };
}

function color(accessor: ReturnType<typeof compileColorEncodingDeck>, feature: AccessorFeature): DeckColor {
  return typeof accessor === "function" ? accessor(feature) : accessor;
}

function num(accessor: ReturnType<typeof compileNumberEncodingDeck>, feature: AccessorFeature): number {
  return typeof accessor === "function" ? accessor(feature) : accessor;
}

function lerpByte(a: number, b: number, t: number): number {
  return Math.round(Math.min(255, Math.max(0, a + (b - a) * t)));
}

/**
 * Tiny pure-TS evaluator of the MapLibre expression subset `paint-compiler` emits
 * (`get` / `match` / `step` / `interpolate linear`). It is the PARITY oracle: the deck
 * accessor must resolve to the same color/number the MapLibre expression evaluates to.
 */
function evalMaplibre(expr: unknown, feature: AccessorFeature): unknown {
  if (!Array.isArray(expr)) return expr;
  const [op] = expr as unknown[];
  if (op === "get") return feature.properties?.[(expr as unknown[])[1] as string];
  if (op === "match") {
    const input = evalMaplibre((expr as unknown[])[1], feature);
    for (let i = 2; i < expr.length - 1; i += 2) if ((expr as unknown[])[i] === input) return (expr as unknown[])[i + 1];
    return (expr as unknown[])[expr.length - 1];
  }
  if (op === "step") {
    const input = evalMaplibre((expr as unknown[])[1], feature) as number;
    let out = (expr as unknown[])[2];
    for (let i = 3; i < expr.length; i += 2) {
      if (input < ((expr as unknown[])[i] as number)) return out;
      out = (expr as unknown[])[i + 1];
    }
    return out;
  }
  if (op === "interpolate") {
    const input = evalMaplibre((expr as unknown[])[2], feature) as number;
    const stops: Array<[number, unknown]> = [];
    for (let i = 3; i < expr.length; i += 2) stops.push([(expr as unknown[])[i] as number, (expr as unknown[])[i + 1]]);
    if (input <= stops[0]![0]) return stops[0]![1];
    if (input >= stops[stops.length - 1]![0]) return stops[stops.length - 1]![1];
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [s0, v0] = stops[i]!;
      const [s1, v1] = stops[i + 1]!;
      if (input >= s0 && input <= s1) {
        const t = (input - s0) / (s1 - s0);
        if (typeof v0 === "number" && typeof v1 === "number") return v0 + (v1 - v0) * t;
        const [a, b] = [parseTokenColor(v0 as string), parseTokenColor(v1 as string)];
        return [lerpByte(a[0], b[0], t), lerpByte(a[1], b[1], t), lerpByte(a[2], b[2], t), lerpByte(a[3], b[3], t)] as DeckColor;
      }
    }
    return stops[stops.length - 1]![1];
  }
  return expr;
}

function maplibreColor(encoding: ColorEncoding, feature: AccessorFeature): DeckColor {
  const resolved = evalMaplibre(compileColorEncoding(encoding, tokens), feature);
  return typeof resolved === "string" ? parseTokenColor(resolved) : (resolved as DeckColor);
}

describe("parseTokenColor (pure-TS, replaces colorjs.io)", () => {
  it("parses #rgb / #rrggbb / #rrggbbaa and rgb()/rgba()", () => {
    expect(parseTokenColor("#4e79a7")).toEqual([78, 121, 167, 255]);
    expect(parseTokenColor("#abc")).toEqual([170, 187, 204, 255]);
    expect(parseTokenColor("#4e79a780")).toEqual([78, 121, 167, 128]);
    expect(parseTokenColor("rgb(78, 121, 167)")).toEqual([78, 121, 167, 255]);
    expect(parseTokenColor("rgba(78, 121, 167, 0.5)")).toEqual([78, 121, 167, 128]);
  });

  it("hard-fails on an unrecognized color (never guesses)", () => {
    expect(() => parseTokenColor("rebeccapurple")).toThrow(/Unsupported token color/);
    expect(() => parseTokenColor("#xyz")).toThrow(/Unsupported hex color/);
  });
});

describe("deck-compiler parity with the maplibre paint-compiler", () => {
  it("constant: same resolved token color", () => {
    const enc: ColorEncoding = { by: "constant", token: "category1" };
    expect(color(compileColorEncodingDeck(enc, tokens), feat({}))).toEqual([78, 121, 167, 255]);
    expect(color(compileColorEncodingDeck(enc, tokens), feat({}))).toEqual(maplibreColor(enc, feat({})));
  });

  it("category: mapped value AND the deterministic first-mapping fallback", () => {
    const enc: ColorEncoding = { by: "category", field: "category", map: { residential: "category1", commercial: "category2" } };
    for (const props of [{ category: "commercial" }, { category: "residential" }, { category: "industrial" }, {}]) {
      expect(color(compileColorEncodingDeck(enc, tokens), feat(props))).toEqual(maplibreColor(enc, feat(props)));
    }
  });

  it("valueStep: parity across bins AND at the exact boundary value", () => {
    const enc: ColorEncoding = {
      by: "valueStep",
      field: "density",
      stops: [
        { upTo: 10, token: "category1" },
        { upTo: 25, token: "category2" },
        { upTo: Number.POSITIVE_INFINITY, token: "category3" },
      ],
    };
    for (const density of [0, 9.999, 10, 10.001, 24, 25, 25.001, 1000]) {
      expect(color(compileColorEncodingDeck(enc, tokens), feat({ density }))).toEqual(maplibreColor(enc, feat({ density })));
    }
  });

  it("valueRamp: linear interpolation parity across the domain", () => {
    const enc: ColorEncoding = { by: "valueRamp", field: "density", domain: [0, 100], ramp: ["category1", "category2", "category3"] };
    for (const density of [-5, 0, 12, 50, 73, 100, 200]) {
      expect(color(compileColorEncodingDeck(enc, tokens), feat({ density }))).toEqual(maplibreColor(enc, feat({ density })));
    }
  });

  it("number: constant + clamped value interpolation parity", () => {
    expect(num(compileNumberEncodingDeck({ by: "constant", value: 3 }), feat({}))).toBe(3);
    const value = compileNumberEncodingDeck({ by: "value", field: "size", domain: [0, 10], range: [4, 18] });
    for (const size of [-3, 0, 5, 8, 10, 42]) {
      const got = num(value, feat({ size }));
      const maplibre = evalMaplibre(compileNumberEncoding({ by: "value", field: "size", domain: [0, 10], range: [4, 18] }), feat({ size })) as number;
      expect(got).toBeCloseTo(maplibre, 10);
    }
  });

  it("hard-fails when an encoding references an absent token role (same as maplibre)", () => {
    expect(() => compileColorEncodingDeck({ by: "constant", token: "missing" }, tokens)).toThrow(/Missing resolved token for role: missing/);
  });

  it("F7b: a replacement TokenMap produces fresh accessor output", () => {
    const enc: ColorEncoding = { by: "constant", token: "category1" };
    expect(color(compileColorEncodingDeck(enc, tokens), feat({}))).toEqual([78, 121, 167, 255]);
    expect(color(compileColorEncodingDeck(enc, { ...tokens, category1: "#1d4ed8" }), feat({}))).toEqual([29, 78, 216, 255]);
  });
});

describe("projectDeckLayer — the canonical DS payload (deck sub-layers + accessors)", () => {
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
  const canonicalDsPayload: readonly GeoLayerSpec[] = [
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

  it("decomposes into ordered deck sub-layers with parity-correct accessors", () => {
    const project = createDeckLayerProjector(tokens);
    const sample = feat({ density: 12, category: "commercial", size: 8 });

    const density = project(canonicalDsPayload[0]!);
    expect(density.layers.map((l) => [l.id, l.type])).toEqual([["layers/density", "fill"], ["layers/density::outline", "line"]]);
    // density=12 → the second bin (category2), parity with the maplibre step expr.
    expect(color(density.layers[0]!.getColor!, sample)).toEqual([242, 142, 43, 255]);
    expect(num(density.layers[0]!.opacity!, sample)).toBe(0.72);
    expect(color(density.layers[1]!.getColor!, sample)).toEqual([226, 232, 240, 255]); // border-subtle
    expect(num(density.layers[1]!.getWidth!, sample)).toBe(1);

    const signals = projectDeckLayer(canonicalDsPayload[1]!, tokens);
    expect(signals.layers.map((l) => [l.id, l.type])).toEqual([["layers/signals", "circle"]]);
    expect(color(signals.layers[0]!.getColor!, sample)).toEqual([242, 142, 43, 255]); // category2
    expect(num(signals.layers[0]!.getRadius!, sample)).toBeCloseTo(15.2, 10); // size 8 → 4 + 14*0.8
  });
});
