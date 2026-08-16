/**
 * Renderer-neutral tool context — SPEC_GEO_MAP_ENGINE §1.3.5.
 *
 * A deep tool (for example, measurement) receives this active context from
 * the engine. Its scratch layers stay inside the supplied `tools/<id>/`
 * namespace; MapLibre-specific layer and pointer types remain in the 2D
 * binding.
 */

import type { GeoLayerSpec } from "./layers.js";

/**
 * Active, renderer-neutral context supplied by the engine to one tool.
 * `destroy` is called when that tool deactivates: it removes scratch layers,
 * detaches pointer interception, and restores base-map interactions.
 */
export interface GeoToolContext {
  /** Namespace owned exclusively by this active tool, e.g. `tools/measure/`. */
  readonly layerIdPrefix: string;
  /** Reconciles the complete scratch layer set owned by this tool. */
  setScratchLayers(layers: readonly GeoLayerSpec[]): void;
  /** Receives normalized pointer coordinates while this tool is active. */
  onPointerEvent(
    listener: (event: Readonly<{
      type: "click" | "move";
      coordinate: readonly [number, number];
    }>) => void,
  ): () => void;
  /** Deactivates this context and releases every resource it owns. */
  destroy(): void;
}
