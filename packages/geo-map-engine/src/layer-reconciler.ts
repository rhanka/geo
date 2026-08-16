/**
 * Declarative layer reconciliation — SPEC_GEO_MAP_ENGINE §1.4.
 *
 * This is an engine-internal seam. The frozen public contract deliberately has
 * no MapLibre type or raw paint expression: the 2D renderer will provide the
 * projection from a `GeoLayerSpec` to this reconciler in a later work item.
 */

import type { LayerData, GeoLayerSpec } from "./layers.js";

/** The minimal map operations the reconciler needs from the 2D renderer. */
export interface MaplibreLayerTarget {
  addLayer(layer: MaplibreLayerDefinition, beforeId?: string): void;
  removeLayer(id: string): void;
  getLayer(id: string): unknown | undefined;
  setPaintProperty(id: string, property: string, value: unknown): void;
  /** Updates the GeoJSON source associated with the named layer. */
  setData(id: string, data: LayerData): void;
}

/** Opaque, renderer-produced MapLibre layer definition. */
export interface MaplibreLayerDefinition {
  readonly id: string;
  readonly [property: string]: unknown;
}

/**
 * The renderer separates immutable layer structure from the two pieces which
 * MapLibre can mutate in place. `layer` must contain the initial complete
 * definition used by `addLayer`; `structure` must exclude `paint` and source
 * data so that those changes do not force a recreation.
 */
export interface MaplibreSubLayer {
  readonly layer: MaplibreLayerDefinition;
  readonly structure: unknown;
  readonly paint: Readonly<Record<string, unknown>>;
  readonly data: LayerData;
}

/**
 * One neutral layer can materialize as several ordered MapLibre layers. The
 * order is the renderer stack order and is preserved by the reconciler.
 */
export interface MaplibreLayerProjection {
  readonly layers: readonly MaplibreSubLayer[];
}

export interface DeclarativeLayerReconcilerOptions {
  /** Namespace owned exclusively by this reconciler, e.g. `layers/`. */
  readonly layerIdPrefix: string;
  /** Compiles the frozen neutral layer contract to the renderer's 2D projection. */
  readonly project: (layer: GeoLayerSpec) => MaplibreLayerProjection;
}

/**
 * Applies `setLayers` as a declarative diff without inspecting unrelated map
 * layers. Only IDs beginning with `layerIdPrefix` are ever retained or passed
 * to the target, so declarative and imperative namespaces cannot collide.
 */
export class DeclarativeLayerReconciler {
  readonly #map: MaplibreLayerTarget;
  readonly #layerIdPrefix: string;
  readonly #project: (layer: GeoLayerSpec) => MaplibreLayerProjection;
  #layers = new Map<string, MaplibreSubLayer>();

  constructor(map: MaplibreLayerTarget, options: DeclarativeLayerReconcilerOptions) {
    if (options.layerIdPrefix.length === 0) {
      throw new Error("A declarative layer namespace prefix is required");
    }

    this.#map = map;
    this.#layerIdPrefix = options.layerIdPrefix;
    this.#project = options.project;
  }

  /** Reconciles only the declarative layers in this instance's namespace. */
  setLayers(layers: readonly GeoLayerSpec[]): void {
    const next = this.#materialize(layers);

    for (const id of this.#layers.keys()) {
      if (!next.has(id)) this.#remove(id);
    }

    for (const [id, nextLayer] of next) {
      const previousLayer = this.#layers.get(id);
      if (!previousLayer) {
        this.#add(id, nextLayer, this.#nextPresentLayerId(id, next));
        continue;
      }

      if (sameValue(previousLayer.structure, nextLayer.structure)) {
        this.#update(id, previousLayer, nextLayer, next);
      } else {
        this.#replace(id, nextLayer, this.#nextPresentLayerId(id, next));
      }
    }

    this.#layers = next;
  }

  /**
   * Re-adds overlays destroyed by MapLibre's `setStyle` in their declared
   * order. The 2D renderer calls this from its post-style hook; `setLayers`
   * remains a strict no-op for an unchanged declaration.
   */
  reinjectAfterStyle(): void {
    for (const [id, layer] of this.#layers) {
      if (this.#map.getLayer(id) === undefined) {
        this.#add(id, layer, this.#nextPresentLayerId(id, this.#layers));
      }
    }
  }

  #materialize(layers: readonly GeoLayerSpec[]): Map<string, MaplibreSubLayer> {
    const next = new Map<string, MaplibreSubLayer>();
    const declarativeIds = new Set<string>();

    for (const layer of layers) {
      if (!layer.id.startsWith(this.#layerIdPrefix)) continue;
      if (declarativeIds.has(layer.id)) {
        throw new Error(`Duplicate declarative layer id: ${layer.id}`);
      }
      declarativeIds.add(layer.id);

      const projection = this.#project(layer);
      if (projection.layers.length === 0) {
        throw new Error(`Projected declarative layer must contain at least one sub-layer: ${layer.id}`);
      }
      for (const subLayer of projection.layers) {
        const id = subLayer.layer.id;
        if (!isDerivedLayerId(layer.id, id)) {
          throw new Error(`Projected layer id must stay within declarative layer id: ${layer.id}`);
        }
        if (next.has(id)) {
          throw new Error(`Duplicate projected layer id: ${id}`);
        }
        next.set(id, subLayer);
      }
    }

    return next;
  }

  #add(id: string, layer: MaplibreSubLayer, beforeId?: string): void {
    if (this.#map.getLayer(id) === undefined) {
      this.#map.addLayer(layer.layer, beforeId);
      return;
    }

    // The prefix makes this layer ours. Bringing an already-present layer in
    // this namespace up to date does not recreate it unnecessarily.
    this.#applyDataAndPaint(id, undefined, layer);
  }

  #remove(id: string): void {
    if (this.#map.getLayer(id) !== undefined) this.#map.removeLayer(id);
  }

  #replace(id: string, layer: MaplibreSubLayer, beforeId?: string): void {
    if (this.#map.getLayer(id) !== undefined) this.#map.removeLayer(id);
    this.#map.addLayer(layer.layer, beforeId);
  }

  #update(
    id: string,
    previousLayer: MaplibreSubLayer,
    nextLayer: MaplibreSubLayer,
    layers: ReadonlyMap<string, MaplibreSubLayer>,
  ): void {
    if (!hasDynamicChange(previousLayer, nextLayer)) return;

    // A renderer/style reset can remove our overlay. Re-add it only when the
    // desired declaration changed; an identical `setLayers` remains a no-op.
    if (this.#map.getLayer(id) === undefined) {
      this.#map.addLayer(nextLayer.layer, this.#nextPresentLayerId(id, layers));
      return;
    }

    this.#applyDataAndPaint(id, previousLayer, nextLayer);
  }

  #applyDataAndPaint(
    id: string,
    previousLayer: MaplibreSubLayer | undefined,
    nextLayer: MaplibreSubLayer,
  ): void {
    if (!previousLayer || !sameValue(previousLayer.data, nextLayer.data)) {
      this.#map.setData(id, nextLayer.data);
    }

    const propertyNames = new Set([
      ...Object.keys(previousLayer?.paint ?? {}),
      ...Object.keys(nextLayer.paint),
    ]);
    for (const property of propertyNames) {
      const previousValue = previousLayer?.paint[property];
      const nextValue = nextLayer.paint[property];
      if (!previousLayer || !sameValue(previousValue, nextValue)) {
        // `null` is MapLibre's reset-to-default value for a removed paint key.
        this.#map.setPaintProperty(id, property, nextValue ?? null);
      }
    }
  }

  /** Finds the next currently rendered sibling without inspecting foreign IDs. */
  #nextPresentLayerId(
    id: string,
    layers: ReadonlyMap<string, MaplibreSubLayer>,
  ): string | undefined {
    let found = false;
    for (const candidateId of layers.keys()) {
      if (!found) {
        found = candidateId === id;
        continue;
      }
      if (this.#map.getLayer(candidateId) !== undefined) return candidateId;
    }
    return undefined;
  }
}

function hasDynamicChange(
  previousLayer: MaplibreSubLayer,
  nextLayer: MaplibreSubLayer,
): boolean {
  return (
    !sameValue(previousLayer.data, nextLayer.data) ||
    !sameValue(previousLayer.paint, nextLayer.paint)
  );
}

/** A generated layer is either the parent or explicitly scoped beneath it. */
function isDerivedLayerId(parentId: string, id: string): boolean {
  return id === parentId || id.startsWith(`${parentId}::`);
}

/** GeoLayerSpec and MapLibre paint projections are JSON-shaped values. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && sameValue(left[key], right[key]),
    )
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
