/**
 * MapLibre mount integration — SPEC_GEO_MAP_ENGINE §1.3.4.
 *
 * The renderer-neutral contract remains in `surface.ts`; this module is its
 * 2D binding and owns the MapLibre instance mounted inside the stable host.
 */

import maplibregl, {
  type AddLayerObject,
  type GeoJSONSource,
  type Map,
  type MapMouseEvent,
  type MapOptions,
} from "maplibre-gl";

import {
  MaplibreBasemapController,
  type MaplibreBasemapStyle,
  type MaplibreBasemapTarget,
  type MaplibreStyleReadyEvent,
} from "./basemap-controller.js";
import type { BasemapSpec } from "./basemap.js";
import type { TokenMap } from "./encodings.js";
import {
  DeclarativeLayerReconciler,
  type MaplibreLayerDefinition,
  type MaplibreLayerTarget,
} from "./layer-reconciler.js";
import type {
  MaplibreToolInteractionState,
  MaplibreToolPointerEvent,
  MaplibreToolPointerEventName,
  MaplibreToolTarget,
} from "./maplibre-tool-context.js";
import { createMaplibreLayerProjector } from "./paint-compiler.js";
import type { GeoLayerSpec, LayerData } from "./layers.js";
import type { GeoBounds, GeoFeatureHit, GeoMapHandle, MountGeoMap } from "./surface.js";
import {
  MaplibreViewportController,
  type MaplibreViewportTarget,
} from "./viewport-controller.js";
import type { GeoViewport } from "./viewport.js";

const PENDING_3D = "integration-pending — 3d renderer";
const PENDING_W8 = "integration-pending — W8";
type MapContainer = Exclude<MapOptions["container"], string>;
type InlineLayerData = Exclude<LayerData, { sourceRef: string }>;
type MountRendererOptions = Omit<
  MapOptions,
  "container" | "style" | "center" | "zoom" | "bearing" | "pitch"
> & {
  /** Data for `LayerData.sourceRef`, supplied by the consuming adapter. */
  readonly sources?: Readonly<Record<string, InlineLayerData>>;
};

/**
 * Mounts a real MapLibre 2D renderer. The public surface deliberately stays
 * generic; the concrete 2D implementation requires a MapLibre container host.
 */
export const mount: MountGeoMap<MapContainer> = (host, options): GeoMapHandle => {
  if (options.renderer === "3d") throw new Error(PENDING_3D);

  const { sources = {}, ...rendererOptions } = (options.options ?? {}) as MountRendererOptions;
  const map = new maplibregl.Map({
    ...rendererOptions,
    container: host,
    style: { version: 8, sources: {}, layers: [] },
    center: [options.viewport.center[0], options.viewport.center[1]],
    zoom: options.viewport.zoom,
    bearing: options.viewport.bearing,
    pitch: options.viewport.pitch,
  });
  const target = new MaplibreMountTarget(map, sources);
  const initialViewport = copyViewport(options.viewport);
  let currentBasemap = options.basemap;
  let currentLayers = options.layers;
  let currentTokens = options.tokens;
  let currentViewport = copyViewport(options.viewport);
  let reconciler: DeclarativeLayerReconciler | undefined;
  let basemapController: MaplibreBasemapController | undefined;
  let viewportController: MaplibreViewportController | undefined;
  let ready = false;
  let destroyed = false;

  const assertActive = (): void => {
    if (destroyed) throw new Error("Geo map handle is destroyed");
  };
  const rejectW8 = (): never => {
    throw new Error(PENDING_W8);
  };
  const makeReconciler = (): DeclarativeLayerReconciler => new DeclarativeLayerReconciler(target, {
    layerIdPrefix: "layers/",
    project: createMaplibreLayerProjector(currentTokens),
  });
  const makeBasemapController = (): MaplibreBasemapController => new MaplibreBasemapController(target, {
    tokens: currentTokens,
    reinjectOverlays: () => reconciler?.reinjectAfterStyle(),
  });
  const applyInitialState = (): void => {
    if (destroyed) return;

    ready = true;
    reconciler = makeReconciler();
    basemapController = makeBasemapController();
    viewportController = new MaplibreViewportController(target, {
      initialViewport,
      onViewportChange: (viewport) => {
        currentViewport = copyViewport(viewport);
        options.onViewportChange?.(viewport);
      },
    });
    reconciler.setLayers(currentLayers);
    map.once("idle", () => {
      if (!destroyed) options.onReady?.();
    });
    basemapController.setBasemap(currentBasemap);
  };
  const onHover = (event: MapMouseEvent): void => {
    if (destroyed || !target.getInteractionState().hover) return;
    options.onHover?.(readInteractiveHit(map, currentLayers, event, "hover"));
  };
  const onSelect = (event: MapMouseEvent): void => {
    if (destroyed || !target.getInteractionState().select) return;
    const hit = readInteractiveHit(map, currentLayers, event, "select");
    if (hit) options.onSelect?.(hit);
  };

  map.once("load", applyInitialState);
  map.on("mousemove", onHover);
  map.on("click", onSelect);

  return {
    setLayers: (layers) => {
      assertActive();
      currentLayers = layers;
      if (ready) reconciler?.setLayers(currentLayers);
    },
    setBasemap: (basemap) => {
      assertActive();
      currentBasemap = basemap;
      if (ready) basemapController?.setBasemap(currentBasemap);
    },
    setViewport: (viewport) => {
      assertActive();
      currentViewport = copyViewport(viewport);
      if (ready) viewportController?.setViewport(currentViewport);
    },
    setRenderer: (renderer) => {
      assertActive();
      if (renderer === "3d") throw new Error(PENDING_3D);
    },
    setTokens: (tokens) => {
      assertActive();
      currentTokens = tokens;
      if (!ready) return;

      // W1 deliberately owns an immutable projector. Reconstructing it is the
      // W2 recompile boundary, then the same declaration reapplies all paint.
      reconciler = makeReconciler();
      basemapController = makeBasemapController();
      reconciler.setLayers(currentLayers);
      basemapController.setBasemap(currentBasemap);
    },
    flyTo: (viewport) => {
      assertActive();
      currentViewport = { ...readCurrentViewport(map, currentViewport), ...viewport };
      currentViewport = copyViewport(currentViewport);
      if (ready) viewportController?.flyTo(currentViewport);
    },
    fitBounds: (bounds, fitOptions) => {
      assertActive();
      if (!ready) return;
      map.fitBounds(
        [[bounds.west, bounds.south], [bounds.east, bounds.north]],
        {
          ...(fitOptions?.maxZoom === undefined ? {} : { maxZoom: fitOptions.maxZoom }),
          ...(fitOptions?.padding === undefined ? {} : { padding: fitOptions.padding }),
        },
      );
    },
    recenterKeepZoom: (center) => {
      assertActive();
      currentViewport = { ...readCurrentViewport(map, currentViewport), center };
      currentViewport = copyViewport(currentViewport);
      if (ready) viewportController?.setViewport(currentViewport);
    },
    resetToInitialView: () => {
      assertActive();
      currentViewport = copyViewport(initialViewport);
      if (ready) viewportController?.setViewport(currentViewport);
    },
    syncLayers: () => rejectW8(),
    queryRenderedFeatures: () => rejectW8(),
    getFeatureBoundary: () => rejectW8(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      viewportController?.destroy();
      map.off("mousemove", onHover);
      map.off("click", onSelect);
      map.remove();
    },
  };
};

/**
 * Real MapLibre adapter shared by the W1 reconciler, W5 style controller and
 * the W6 tool target. The internal target keeps those MapLibre types out of
 * every frozen public surface.
 */
class MaplibreMountTarget implements
  MaplibreLayerTarget,
  MaplibreBasemapTarget,
  MaplibreToolTarget,
  MaplibreViewportTarget
{
  readonly #map: Map;
  readonly #sourceData: ReadonlyMap<string, InlineLayerData>;
  #interactionState: MaplibreToolInteractionState = { hover: true, select: true };

  constructor(map: Map, sourceData: Readonly<Record<string, InlineLayerData>>) {
    this.#map = map;
    this.#sourceData = new globalThis.Map(Object.entries(sourceData));
  }

  addLayer(layer: MaplibreLayerDefinition, beforeId?: string): void {
    this.#ensureSource(layer);
    this.#map.addLayer(layer as AddLayerObject, beforeId);
  }

  removeLayer(id: string): void {
    this.#map.removeLayer(id);
  }

  getLayer(id: string): unknown | undefined {
    return this.#map.getLayer(id);
  }

  setPaintProperty(id: string, property: string, value: unknown): void {
    this.#map.setPaintProperty(id, property, value);
  }

  setStyle(style: MaplibreBasemapStyle): void {
    this.#map.setStyle(style as never);
  }

  setData(id: string, data: GeoLayerSpec["data"]): void {
    const layer = this.#map.getLayer(id);
    if (!layer) throw new Error(`Cannot update data for a missing MapLibre layer: ${id}`);
    const source = this.#map.getSource(layer.source);
    if (!isGeoJsonSource(source)) {
      throw new Error(`Layer does not own a GeoJSON source: ${id}`);
    }
    source.setData(data);
  }

  on(event: MaplibreToolPointerEventName, listener: (event: MaplibreToolPointerEvent) => void): void;
  on(event: MaplibreStyleReadyEvent | "moveend", listener: () => void): void;
  on(
    event: MaplibreToolPointerEventName | MaplibreStyleReadyEvent | "moveend",
    listener: ((event: MaplibreToolPointerEvent) => void) | (() => void),
  ): void {
    this.#map.on(event as never, listener as never);
  }

  off(event: MaplibreToolPointerEventName, listener: (event: MaplibreToolPointerEvent) => void): void;
  off(event: MaplibreStyleReadyEvent | "moveend", listener: () => void): void;
  off(
    event: MaplibreToolPointerEventName | MaplibreStyleReadyEvent | "moveend",
    listener: ((event: MaplibreToolPointerEvent) => void) | (() => void),
  ): void {
    this.#map.off(event as never, listener as never);
  }

  getInteractionState(): MaplibreToolInteractionState {
    return { ...this.#interactionState };
  }

  setInteractionState(state: MaplibreToolInteractionState): void {
    this.#interactionState = { ...state };
  }

  getCenter(): { readonly lng: number; readonly lat: number } {
    return this.#map.getCenter();
  }

  getZoom(): number {
    return this.#map.getZoom();
  }

  getBearing(): number {
    return this.#map.getBearing();
  }

  getPitch(): number {
    return this.#map.getPitch();
  }

  jumpTo(viewport: GeoViewport): void {
    this.#map.jumpTo(toMaplibreCamera(viewport));
  }

  flyTo(viewport: GeoViewport): void {
    this.#map.flyTo(toMaplibreCamera(viewport));
  }

  #ensureSource(layer: MaplibreLayerDefinition): void {
    const sourceId = layer["source"];
    if (typeof sourceId !== "string" || this.#map.getSource(sourceId)) return;

    const data = this.#sourceData.get(sourceId);
    if (!data) throw new Error(`Missing data for sourceRef: ${sourceId}`);
    this.#map.addSource(sourceId, { type: "geojson", data });
  }
}

function readInteractiveHit(
  map: Map,
  layers: readonly GeoLayerSpec[],
  event: MapMouseEvent,
  interaction: "hover" | "select",
): GeoFeatureHit | null {
  const layerById = new globalThis.Map<string, GeoLayerSpec>(layers.map((layer) => [layer.id, layer]));
  for (const feature of map.queryRenderedFeatures(event.point)) {
    const layer = layerById.get(parentLayerId(feature.layer.id));
    const interactivity = layer?.interactivity;
    if (!interactivity || !interactivity[interaction]) continue;

    const featureId = feature.properties?.[interactivity.idField];
    if (typeof featureId !== "string" && typeof featureId !== "number") continue;
    return {
      layerId: layer.id,
      featureId,
      properties: feature.properties ?? {},
    };
  }
  return null;
}

function parentLayerId(layerId: string): string {
  const separator = layerId.indexOf("::");
  return separator === -1 ? layerId : layerId.slice(0, separator);
}

function readCurrentViewport(map: Map, fallback: GeoViewport): GeoViewport {
  if (!map.loaded()) return fallback;
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function copyViewport(viewport: GeoViewport): GeoViewport {
  return {
    center: [viewport.center[0], viewport.center[1]],
    zoom: viewport.zoom,
    bearing: viewport.bearing,
    pitch: viewport.pitch,
  };
}

function toMaplibreCamera(viewport: GeoViewport): {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
} {
  return {
    center: [viewport.center[0], viewport.center[1]],
    zoom: viewport.zoom,
    bearing: viewport.bearing,
    pitch: viewport.pitch,
  };
}

function isGeoJsonSource(source: unknown): source is GeoJSONSource {
  return typeof source === "object" && source !== null && "setData" in source;
}
