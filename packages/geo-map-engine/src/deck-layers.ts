/**
 * Deck.gl layer bridge (W10, Phase 0) — turns a neutral {@link GeoLayerSpec} + {@link TokenMap}
 * into deck.gl `GeoJsonLayer` PROPS (accessors from {@link ./deck-compiler.js}), and maps the
 * shared {@link GeoViewport} to/from a deck `MapView` view state (the 2D↔3D round-trip, §1.5).
 *
 * PURE-TS + renderer-neutral on purpose: this module imports NEITHER `@deck.gl/*` NOR the DOM.
 * It emits plain config objects; the 3D mount ({@link ./mount-3d.js}) does `new GeoJsonLayer(config)`
 * and owns the actual deck.gl runtime. So the bridge + the view-state math are unit-testable
 * without a GL context (the WebGL render is exercised by the e2e / the demo page).
 */
import { compileColorEncodingDeck, compileNumberEncodingDeck, type DeckColorAccessor } from "./deck-compiler.js";
import type { NumberEncoding, TokenMap } from "./encodings.js";
import type { GeoLayerSpec, LayerData } from "./layers.js";
import { type GeoViewport, normalizeViewport } from "./viewport.js";

/** A deck `MapView` view state — the same common domain as {@link GeoViewport} (§1.5). */
export interface DeckViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

/** Map a shared viewport to a deck view state (identical common domain — center/zoom/bearing/pitch). */
export function toDeckViewState(viewport: GeoViewport): DeckViewState {
  const v = normalizeViewport(viewport);
  return { longitude: v.center[0], latitude: v.center[1], zoom: v.zoom, bearing: v.bearing, pitch: v.pitch };
}

/** Map a deck view state back to a shared viewport (the round-trip half, §1.5) — normalized. */
export function fromDeckViewState(state: DeckViewState): GeoViewport {
  return normalizeViewport({
    center: [state.longitude, state.latitude],
    zoom: state.zoom,
    bearing: state.bearing,
    pitch: state.pitch,
  });
}

/** Props of ONE deck `GeoJsonLayer` — the subset the bridge sets (structurally compatible with GeoJsonLayerProps). */
export interface DeckLayerConfig {
  id: string;
  data: LayerData;
  visible: boolean;
  pickable: boolean;
  filled: boolean;
  stroked: boolean;
  extruded: boolean;
  opacity: number;
  getFillColor: DeckColorAccessor;
  getLineColor?: DeckColorAccessor;
  getLineWidth?: number | ((feature: { properties: Readonly<Record<string, unknown>> | null }) => number);
  getPointRadius?: number | ((feature: { properties: Readonly<Record<string, unknown>> | null }) => number);
  getElevation?: (feature: { properties: Readonly<Record<string, unknown>> | null }) => number;
  pointType?: "circle";
  lineWidthUnits?: "pixels";
  pointRadiusUnits?: "pixels";
  /** re-compile trigger: paint accessors are rebuilt when the resolved TokenMap changes (F7b). */
  updateTriggers: Readonly<Record<string, string>>;
}

/** A single scalar value for a layer-level number prop: a constant encoding's value, else the fallback. */
function scalar(encoding: NumberEncoding | undefined, fallback: number): number {
  return encoding && encoding.by === "constant" ? encoding.value : fallback;
}

/** Stable token trigger — layers recompile their paint when the resolved TokenMap changes (F7b). */
function tokenTrigger(tokens: TokenMap): string {
  return JSON.stringify(Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b)));
}

function elevationAccessor(field: string): (feature: { properties: Readonly<Record<string, unknown>> | null }) => number {
  return (feature) => {
    const value = feature.properties?.[field];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
}

/**
 * Compile neutral layer specs to deck `GeoJsonLayer` configs. Fill/outline/points collapse into
 * ONE `GeoJsonLayer` per spec (deck's model), with the paint compiled to accessors by the frozen
 * deck-compiler. `extrusion` drives `extruded`+`getElevation` (the 3D height), ignored by 2D.
 */
export function buildDeckLayerConfigs(
  specs: readonly GeoLayerSpec[],
  tokens: TokenMap,
): DeckLayerConfig[] {
  const trigger = tokenTrigger(tokens);
  return specs.map((spec): DeckLayerConfig => {
    const pickable = Boolean(spec.interactivity?.hover || spec.interactivity?.select);
    const base = {
      id: spec.id,
      data: spec.data,
      visible: spec.visible !== false,
      pickable,
      lineWidthUnits: "pixels" as const,
    };
    if (spec.kind === "choropleth") {
      const config: DeckLayerConfig = {
        ...base,
        filled: true,
        stroked: Boolean(spec.outline),
        extruded: Boolean(spec.extrusion),
        opacity: scalar(spec.fill.opacity ?? spec.opacity, 1),
        getFillColor: compileColorEncodingDeck(spec.fill.color, tokens),
        updateTriggers: { getFillColor: trigger, getLineColor: trigger },
      };
      if (spec.outline) {
        config.getLineColor = compileColorEncodingDeck(spec.outline.color, tokens);
        if (spec.outline.width) config.getLineWidth = compileNumberEncodingDeck(spec.outline.width);
      }
      if (spec.extrusion) config.getElevation = elevationAccessor(spec.extrusion.heightField);
      return config;
    }
    if (spec.kind === "points") {
      return {
        ...base,
        filled: true,
        stroked: false,
        extruded: false,
        opacity: scalar(spec.opacity, 1),
        pointType: "circle",
        pointRadiusUnits: "pixels",
        getFillColor: compileColorEncodingDeck(spec.color, tokens),
        getPointRadius: compileNumberEncodingDeck(spec.radius),
        updateTriggers: { getFillColor: trigger },
      };
    }
    // geojson: fill (+ optional outline + points), one GeoJsonLayer.
    if (!spec.fill && !spec.outline && !spec.points && !spec.label) {
      throw new Error("A geojson layer requires at least one renderable sub-spec");
    }
    const config: DeckLayerConfig = {
      ...base,
      filled: Boolean(spec.fill),
      stroked: Boolean(spec.outline),
      extruded: Boolean(spec.extrusion),
      opacity: scalar(spec.opacity, 1),
      getFillColor: compileColorEncodingDeck((spec.fill?.color ?? spec.points?.color ?? spec.outline!.color), tokens),
      updateTriggers: { getFillColor: trigger, getLineColor: trigger },
    };
    if (spec.outline) {
      config.getLineColor = compileColorEncodingDeck(spec.outline.color, tokens);
      if (spec.outline.width) config.getLineWidth = compileNumberEncodingDeck(spec.outline.width);
    }
    if (spec.points) {
      config.pointType = "circle";
      config.pointRadiusUnits = "pixels";
      config.getPointRadius = compileNumberEncodingDeck(spec.points.radius);
    }
    if (spec.extrusion) config.getElevation = elevationAccessor(spec.extrusion.heightField);
    return config;
  });
}
