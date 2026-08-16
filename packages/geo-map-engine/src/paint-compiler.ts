/**
 * Compilation interne des encodages renderer-neutres vers MapLibre 2D.
 *
 * Le contrat public reste entièrement renderer-neutre ; les expressions
 * MapLibre ne sortent jamais de ce module (il n'est pas ré-exporté par
 * `index.ts`).
 */

import type { ColorEncoding, NumberEncoding, TokenMap, TokenRole } from "./encodings.js";
import type { GeoLayerSpec, LayerData } from "./layers.js";
import type {
  MaplibreLayerDefinition,
  MaplibreLayerProjection,
  MaplibreSubLayer,
} from "./layer-reconciler.js";

/** Compile a neutral colour channel to a concrete MapLibre paint value. */
export function compileColorEncoding(encoding: ColorEncoding, tokens: TokenMap): unknown {
  switch (encoding.by) {
    case "constant":
      return resolveToken(tokens, encoding.token);

    case "category": {
      const entries = Object.entries(encoding.map);
      if (entries.length === 0) {
        throw new Error("A category color encoding requires at least one token mapping");
      }

      const [first] = entries;
      if (!first) throw new Error("A category color encoding requires at least one token mapping");
      const expression: unknown[] = ["match", ["get", encoding.field]];
      for (const [value, token] of entries) {
        expression.push(value, resolveToken(tokens, token));
      }
      // `match` requires a fallback, while the frozen neutral contract deliberately
      // carries no renderer-specific fallback channel. The first semantic mapping is
      // deterministic and still resolves through TokenMap.
      expression.push(resolveToken(tokens, first[1]));
      return expression;
    }

    case "valueStep": {
      if (encoding.stops.length === 0) {
        throw new Error("A valueStep color encoding requires at least one stop");
      }

      let previous = Number.NEGATIVE_INFINITY;
      const resolved = encoding.stops.map((stop) => {
        if (stop.upTo <= previous) {
          throw new Error("A valueStep color encoding must have strictly increasing stops");
        }
        previous = stop.upTo;
        return resolveToken(tokens, stop.token);
      });
      const [first] = resolved;
      if (!first) throw new Error("A valueStep color encoding requires at least one stop");
      if (encoding.stops.length === 1) return first;

      const expression: unknown[] = ["step", ["get", encoding.field], first];
      // `{ upTo, token }` describes a bin. MapLibre `step` changes its output
      // at each preceding upper bound, so the terminal `Infinity` is never an
      // expression stop.
      for (let index = 0; index < encoding.stops.length - 1; index += 1) {
        const stop = encoding.stops[index];
        const next = resolved[index + 1];
        if (!stop || next === undefined) continue;
        expression.push(stop.upTo, next);
      }
      return expression;
    }

    case "valueRamp": {
      assertIncreasingDomain(encoding.domain, "valueRamp color encoding");
      if (encoding.ramp.length === 0) {
        throw new Error("A valueRamp color encoding requires at least one token");
      }

      const resolved = encoding.ramp.map((token) => resolveToken(tokens, token));
      const [min, max] = encoding.domain;
      const intervalCount = Math.max(1, resolved.length - 1);
      const expression: unknown[] = ["interpolate", ["linear"], ["get", encoding.field]];
      for (let index = 0; index < resolved.length; index += 1) {
        const value = min + ((max - min) * index) / intervalCount;
        const color = resolved[index];
        if (color === undefined) continue;
        expression.push(value, color);
      }
      // A one-token ramp remains a valid, explicit interpolation instead of
      // smuggling a constant through a distinct encoding kind.
      if (resolved.length === 1) expression.push(max, resolved[0]);
      return expression;
    }
  }
}

/** Compile a neutral numeric channel to a concrete MapLibre paint value. */
export function compileNumberEncoding(encoding: NumberEncoding): unknown {
  if (encoding.by === "constant") return encoding.value;

  assertIncreasingDomain(encoding.domain, "value number encoding");
  return [
    "interpolate",
    ["linear"],
    ["get", encoding.field],
    encoding.domain[0],
    encoding.range[0],
    encoding.domain[1],
    encoding.range[1],
  ];
}

/**
 * Builds W1's injected `project` function for one resolved theme. Rebuilding it
 * with a new TokenMap produces new concrete paint without retaining any DOM or
 * renderer state.
 */
export function createMaplibreLayerProjector(
  tokens: TokenMap,
): (layer: GeoLayerSpec) => MaplibreLayerProjection {
  return (layer) => projectMaplibreLayer(layer, tokens);
}

/** Compile one neutral layer to the internal, ordered projection consumed by W1. */
export function projectMaplibreLayer(
  layer: GeoLayerSpec,
  tokens: TokenMap,
): MaplibreLayerProjection {
  switch (layer.kind) {
    case "choropleth":
      return projectChoropleth(layer, tokens);
    case "points":
      return makeProjection([
        makeSubLayer(layer, layer.id, "circle", {
          "circle-color": compileColorEncoding(layer.color, tokens),
          "circle-radius": compileNumberEncoding(layer.radius),
          ...opacityPaint("circle-opacity", layer.opacity),
        }),
      ]);
    case "geojson":
      return projectGeojson(layer, tokens);
  }
}

function projectChoropleth(
  layer: Extract<GeoLayerSpec, { kind: "choropleth" }>,
  tokens: TokenMap,
): MaplibreLayerProjection {
  const paint: Record<string, unknown> = {
    "fill-color": compileColorEncoding(layer.fill.color, tokens),
    ...opacityPaint("fill-opacity", layer.fill.opacity ?? layer.opacity),
  };
  if (layer.outline && !layer.outline.width) {
    paint["fill-outline-color"] = compileColorEncoding(layer.outline.color, tokens);
  }

  // `extrusion` is intentionally 3D-only in the frozen contract. The 2D
  // compiler preserves the regular fill projection and ignores it.
  const layers: MaplibreSubLayer[] = [makeSubLayer(layer, layer.id, "fill", paint)];
  if (layer.outline?.width) {
    layers.push(
      makeSubLayer(layer, `${layer.id}::outline`, "line", {
        "line-color": compileColorEncoding(layer.outline.color, tokens),
        "line-width": compileNumberEncoding(layer.outline.width),
        ...opacityPaint("line-opacity", layer.opacity),
      }),
    );
  }
  return makeProjection(layers);
}

function projectGeojson(
  layer: Extract<GeoLayerSpec, { kind: "geojson" }>,
  tokens: TokenMap,
): MaplibreLayerProjection {
  if (!layer.fill && !layer.outline && !layer.points && !layer.label) {
    throw new Error("A geojson layer requires at least one renderable sub-spec");
  }

  const layers: MaplibreSubLayer[] = [];
  if (layer.fill) {
    const paint: Record<string, unknown> = {
      "fill-color": compileColorEncoding(layer.fill.color, tokens),
      ...opacityPaint("fill-opacity", layer.fill.opacity ?? layer.opacity),
    };
    layers.push(makeSubLayer(layer, layer.id, "fill", paint));
  }
  if (layer.outline) {
    layers.push(makeSubLayer(layer, `${layer.id}::outline`, "line", {
      "line-color": compileColorEncoding(layer.outline.color, tokens),
      ...opacityPaint("line-opacity", layer.opacity),
      ...(layer.outline.width ? { "line-width": compileNumberEncoding(layer.outline.width) } : {}),
    }));
  }
  if (layer.points) {
    layers.push(makeSubLayer(layer, layer.fill ? `${layer.id}::points` : layer.id, "circle", {
      "circle-color": compileColorEncoding(layer.points.color, tokens),
      "circle-radius": compileNumberEncoding(layer.points.radius),
      ...opacityPaint("circle-opacity", layer.opacity),
    }));
  }
  if (layer.label) {
    const primaryLabel = !layer.fill && !layer.points;
    layers.push(makeSubLayer(layer, primaryLabel ? layer.id : `${layer.id}::label`, "symbol", {
      ...(layer.label.color
        ? { "text-color": compileColorEncoding(layer.label.color, tokens) }
        : {}),
      ...opacityPaint("text-opacity", layer.opacity),
    },
    { "text-field": ["get", layer.label.field] }));
  }
  return makeProjection(layers);
}

function makeProjection(
  layers: readonly MaplibreSubLayer[],
): MaplibreLayerProjection {
  return { layers };
}

function makeSubLayer(
  layer: GeoLayerSpec,
  id: string,
  type: "fill" | "circle" | "line" | "symbol",
  paint: Readonly<Record<string, unknown>>,
  layout?: Readonly<Record<string, unknown>>,
): MaplibreSubLayer {
  const visibility = layer.visible === false ? "none" : undefined;
  const resolvedLayout = visibility ? { ...layout, visibility } : layout;
  const source = maplibreSource(layer.data);
  const definition: MaplibreLayerDefinition = {
    id,
    type,
    source,
    ...(resolvedLayout ? { layout: resolvedLayout } : {}),
    paint,
  };
  return {
    layer: definition,
    structure: {
      type,
      source: sourceStructure(layer.data),
      ...(resolvedLayout ? { layout: resolvedLayout } : {}),
    },
    paint,
    data: layer.data,
  };
}

function opacityPaint(property: string, encoding: NumberEncoding | undefined): Record<string, unknown> {
  return encoding ? { [property]: compileNumberEncoding(encoding) } : {};
}

function maplibreSource(data: LayerData): unknown {
  return isSourceReference(data) ? data.sourceRef : { type: "geojson", data };
}

function sourceStructure(data: LayerData): Readonly<Record<string, unknown>> {
  return isSourceReference(data)
    ? { kind: "reference", sourceRef: data.sourceRef }
    : { kind: "inline-geojson" };
}

function isSourceReference(data: LayerData): data is Extract<LayerData, { sourceRef: string }> {
  return "sourceRef" in data;
}

function resolveToken(tokens: TokenMap, role: TokenRole): string {
  if (!Object.hasOwn(tokens, role) || tokens[role] === undefined) {
    throw new Error(`Missing resolved token for role: ${role}`);
  }
  return tokens[role];
}

function assertIncreasingDomain(
  domain: readonly [number, number],
  subject: string,
): void {
  if (!(domain[0] < domain[1])) {
    throw new Error(`The ${subject} domain must be strictly increasing`);
  }
}
