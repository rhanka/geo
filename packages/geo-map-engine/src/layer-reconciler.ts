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
  addLayer(layer: MaplibreLayerDefinition): void;
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
export interface MaplibreLayerProjection {
  readonly layer: MaplibreLayerDefinition;
  readonly structure: unknown;
  readonly paint: Readonly<Record<string, unknown>>;
  readonly data: LayerData;
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
  #layers = new Map<string, MaplibreLayerProjection>();

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
        this.#add(id, nextLayer);
        continue;
      }

      if (sameValue(previousLayer.structure, nextLayer.structure)) {
        this.#update(id, previousLayer, nextLayer);
      } else {
        this.#replace(id, nextLayer);
      }
    }

    this.#layers = next;
  }

  #materialize(layers: readonly GeoLayerSpec[]): Map<string, MaplibreLayerProjection> {
    const next = new Map<string, MaplibreLayerProjection>();

    for (const layer of layers) {
      if (!layer.id.startsWith(this.#layerIdPrefix)) continue;
      if (next.has(layer.id)) {
        throw new Error(`Duplicate declarative layer id: ${layer.id}`);
      }

      const projection = this.#project(layer);
      if (projection.layer.id !== layer.id) {
        throw new Error(`Projected layer id must match declarative layer id: ${layer.id}`);
      }
      next.set(layer.id, projection);
    }

    return next;
  }

  #add(id: string, layer: MaplibreLayerProjection): void {
    if (this.#map.getLayer(id) === undefined) {
      this.#map.addLayer(layer.layer);
      return;
    }

    // The prefix makes this layer ours. Bringing an already-present layer in
    // this namespace up to date does not recreate it unnecessarily.
    this.#applyDataAndPaint(id, undefined, layer);
  }

  #remove(id: string): void {
    if (this.#map.getLayer(id) !== undefined) this.#map.removeLayer(id);
  }

  #replace(id: string, layer: MaplibreLayerProjection): void {
    if (this.#map.getLayer(id) !== undefined) this.#map.removeLayer(id);
    this.#map.addLayer(layer.layer);
  }

  #update(
    id: string,
    previousLayer: MaplibreLayerProjection,
    nextLayer: MaplibreLayerProjection,
  ): void {
    if (!hasDynamicChange(previousLayer, nextLayer)) return;

    // A renderer/style reset can remove our overlay. Re-add it only when the
    // desired declaration changed; an identical `setLayers` remains a no-op.
    if (this.#map.getLayer(id) === undefined) {
      this.#map.addLayer(nextLayer.layer);
      return;
    }

    this.#applyDataAndPaint(id, previousLayer, nextLayer);
  }

  #applyDataAndPaint(
    id: string,
    previousLayer: MaplibreLayerProjection | undefined,
    nextLayer: MaplibreLayerProjection,
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
}

function hasDynamicChange(
  previousLayer: MaplibreLayerProjection,
  nextLayer: MaplibreLayerProjection,
): boolean {
  return (
    !sameValue(previousLayer.data, nextLayer.data) ||
    !sameValue(previousLayer.paint, nextLayer.paint)
  );
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
