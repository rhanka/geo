/**
 * MapLibre 2D tool-context binding — SPEC_GEO_MAP_ENGINE §1.3.5.
 *
 * The public `GeoToolContext` remains renderer-neutral. This seam owns the
 * MapLibre layer, pointer, and base-interaction details for one active tool.
 */

import type { GeoLayerSpec } from "./layers.js";
import type { MaplibreLayerDefinition } from "./layer-reconciler.js";
import type { GeoToolContext } from "./tool-context.js";

export type MaplibreToolPointerEventName = "click" | "mousemove";

/** Minimal part of a MapLibre pointer event needed by the neutral context. */
export interface MaplibreToolPointerEvent {
  readonly lngLat: {
    readonly lng: number;
    readonly lat: number;
  };
}

/** Hover/select state owned by the engine's base-map interaction binding. */
export interface MaplibreToolInteractionState {
  readonly hover: boolean;
  readonly select: boolean;
}

/** Minimal 2D seam; MapLibre types never cross into `GeoToolContext`. */
export interface MaplibreToolTarget {
  addLayer(layer: MaplibreLayerDefinition): void;
  removeLayer(id: string): void;
  getLayer(id: string): unknown | undefined;
  on(event: MaplibreToolPointerEventName, listener: (event: MaplibreToolPointerEvent) => void): void;
  off(event: MaplibreToolPointerEventName, listener: (event: MaplibreToolPointerEvent) => void): void;
  getInteractionState(): MaplibreToolInteractionState;
  setInteractionState(state: MaplibreToolInteractionState): void;
}

export interface MaplibreToolContextOptions {
  /** Stable tool identifier; it becomes the isolated `tools/<id>/` namespace. */
  readonly toolId: string;
  /** Compiles one neutral scratch layer to its 2D MapLibre sub-layers. */
  readonly projectScratchLayer: (layer: GeoLayerSpec) => readonly MaplibreLayerDefinition[];
}

type PointerListener = Parameters<GeoToolContext["onPointerEvent"]>[0];

/**
 * Activates a single tool against a MapLibre map. Its `destroy` method is the
 * tool deactivation boundary: only this tool's scratch layers are removed and
 * the exact base interaction state captured at activation is restored.
 */
export class MaplibreToolContext implements GeoToolContext {
  readonly layerIdPrefix: string;
  readonly #map: MaplibreToolTarget;
  readonly #projectScratchLayer: (layer: GeoLayerSpec) => readonly MaplibreLayerDefinition[];
  readonly #baseInteractionState: MaplibreToolInteractionState;
  readonly #pointerListeners = new Set<PointerListener>();
  #scratchLayers = new Map<string, readonly MaplibreLayerDefinition[]>();
  #destroyed = false;

  readonly #onClick = (event: MaplibreToolPointerEvent): void => this.#emitPointerEvent("click", event);
  readonly #onMove = (event: MaplibreToolPointerEvent): void => this.#emitPointerEvent("move", event);

  constructor(map: MaplibreToolTarget, options: MaplibreToolContextOptions) {
    assertToolId(options.toolId);

    this.#map = map;
    this.#projectScratchLayer = options.projectScratchLayer;
    this.layerIdPrefix = `tools/${options.toolId}/`;
    this.#baseInteractionState = copyInteractionState(this.#map.getInteractionState());

    this.#map.setInteractionState({ hover: false, select: false });
    this.#map.on("click", this.#onClick);
    this.#map.on("mousemove", this.#onMove);
  }

  setScratchLayers(layers: readonly GeoLayerSpec[]): void {
    this.#assertActive();
    const next = this.#materialize(layers);

    for (const [id, previousLayers] of this.#scratchLayers) {
      if (!next.has(id)) this.#removeLayers(previousLayers);
    }

    for (const [id, nextLayers] of next) {
      const previousLayers = this.#scratchLayers.get(id);
      if (previousLayers) this.#removeLayers(previousLayers);
      this.#addLayers(nextLayers);
    }

    this.#scratchLayers = next;
  }

  onPointerEvent(listener: PointerListener): () => void {
    this.#assertActive();
    this.#pointerListeners.add(listener);

    let subscribed = true;
    return (): void => {
      if (!subscribed) return;
      subscribed = false;
      this.#pointerListeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    try {
      this.#map.off("click", this.#onClick);
      this.#map.off("mousemove", this.#onMove);
      for (const layers of this.#scratchLayers.values()) this.#removeLayers(layers);
      this.#scratchLayers.clear();
    } finally {
      this.#pointerListeners.clear();
      this.#map.setInteractionState(copyInteractionState(this.#baseInteractionState));
    }
  }

  #materialize(layers: readonly GeoLayerSpec[]): Map<string, readonly MaplibreLayerDefinition[]> {
    const next = new Map<string, readonly MaplibreLayerDefinition[]>();
    const projectedIds = new Set<string>();

    for (const layer of layers) {
      if (!layer.id.startsWith(this.layerIdPrefix)) {
        throw new Error(`Scratch layer id must stay within tool namespace: ${layer.id}`);
      }
      if (next.has(layer.id)) {
        throw new Error(`Duplicate scratch layer id: ${layer.id}`);
      }

      const projectedLayers = this.#projectScratchLayer(layer);
      if (projectedLayers.length === 0) {
        throw new Error(`Projected scratch layer must contain at least one sub-layer: ${layer.id}`);
      }
      for (const projectedLayer of projectedLayers) {
        if (!isDerivedLayerId(layer.id, projectedLayer.id)) {
          throw new Error(`Projected scratch layer must stay within layer id: ${layer.id}`);
        }
        if (projectedIds.has(projectedLayer.id)) {
          throw new Error(`Duplicate projected scratch layer id: ${projectedLayer.id}`);
        }
        projectedIds.add(projectedLayer.id);
      }
      next.set(layer.id, projectedLayers);
    }

    return next;
  }

  #addLayers(layers: readonly MaplibreLayerDefinition[]): void {
    for (const layer of layers) {
      if (this.#map.getLayer(layer.id) !== undefined) {
        throw new Error(`Scratch layer id collides with an existing map layer: ${layer.id}`);
      }
    }
    for (const layer of layers) this.#map.addLayer(layer);
  }

  #removeLayers(layers: readonly MaplibreLayerDefinition[]): void {
    for (const layer of layers) {
      if (this.#map.getLayer(layer.id) !== undefined) this.#map.removeLayer(layer.id);
    }
  }

  #emitPointerEvent(type: "click" | "move", event: MaplibreToolPointerEvent): void {
    if (this.#destroyed) return;

    const pointerEvent = {
      type,
      coordinate: [event.lngLat.lng, event.lngLat.lat] as const,
    };
    for (const listener of this.#pointerListeners) listener(pointerEvent);
  }

  #assertActive(): void {
    if (this.#destroyed) throw new Error("Tool context is inactive");
  }
}

function assertToolId(toolId: string): void {
  if (toolId.trim().length === 0 || toolId.includes("/")) {
    throw new Error("A non-empty slash-free tool id is required");
  }
}

function copyInteractionState(state: MaplibreToolInteractionState): MaplibreToolInteractionState {
  return { hover: state.hover, select: state.select };
}

/** A generated sub-layer is either the parent or explicitly scoped beneath it. */
function isDerivedLayerId(parentId: string, id: string): boolean {
  return id === parentId || id.startsWith(`${parentId}::`);
}
