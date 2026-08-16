/**
 * Thin surface (adapter ↔ engine) — SPEC_GEO_MAP_ENGINE §1.3.4 / §1.3.5 (FROZEN v1).
 *
 * The engine is framework-agnostic and DOM-free in its internals (reconciliation, paint,
 * camera): the adapter only BINDS props→calls, reactivity→engine, events→framework, and
 * resolves theme tokens → {@link TokenMap}. Zero duplicated logic across the N adapters.
 */

import type { BasemapSpec } from "./basemap.js";
import type { GeoLayerSpec } from "./layers.js";
import type { TokenMap } from "./encodings.js";
import type { GeoViewport, RendererKind } from "./viewport.js";

/** A picked feature (§1.3.4 events). The engine carries no consumer node-id/graph projection (§6 served contract). */
export interface GeoFeatureHit {
  layerId: string;
  featureId: string | number;
  properties: Readonly<Record<string, unknown>>;
}

/** Geographic bounds in CRS84 degrees (`fitBounds` / `getFeatureBoundary`). */
export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Options passed to {@link MountGeoMap}. */
export interface GeoMapMountOptions {
  basemap: BasemapSpec;
  layers: readonly GeoLayerSpec[];
  viewport: GeoViewport;
  renderer: RendererKind;
  tokens: TokenMap;
  options?: Readonly<Record<string, unknown>>;
}

/** Event callbacks (§1.3.4). Viewport is non-controlled by default (`onViewportChange`). */
export interface GeoMapEvents {
  onReady?: () => void;
  onHover?: (hit: GeoFeatureHit | null) => void;
  onSelect?: (hit: GeoFeatureHit) => void;
  onViewportChange?: (viewport: GeoViewport) => void;
}

/**
 * Imperative handle returned by {@link MountGeoMap} (§1.3.4). The host container mounted by
 * `mount` is NEVER unmounted/reparented; `setRenderer` switches the renderer IN the stable host
 * (the internal renderer canvas may be replaced at a 2D↔3D switch — §1.1.5). `setTokens`
 * re-applies paint across ALL layers AND ALL renderers (fix F7b).
 */
export interface GeoMapHandle {
  // declarative
  setLayers(layers: readonly GeoLayerSpec[]): void;
  setBasemap(basemap: BasemapSpec): void;
  setViewport(viewport: GeoViewport): void;
  setRenderer(renderer: RendererKind): void;
  setTokens(tokens: TokenMap): void;
  // imperative
  flyTo(viewport: Partial<GeoViewport>): void;
  fitBounds(bounds: GeoBounds, opts?: { maxZoom?: number; padding?: number }): void;
  recenterKeepZoom(center: readonly [number, number]): void;
  resetToInitialView(): void;
  /** high-frequency ownership-partitioned escape-hatch; never traverses a foreign namespace (§1.4). */
  syncLayers(namespacedInput: readonly GeoLayerSpec[]): void;
  queryRenderedFeatures(): readonly GeoFeatureHit[];
  getFeatureBoundary(layerId: string, featureId: string | number): GeoBounds | null;
  destroy(): void;
}

/**
 * The mount surface (§1.3.4): `mount(host, opts) → handle`. Generic over the host container
 * type so the engine contract stays DOM-lib-free; adapters instantiate `THost` with their
 * concrete container (e.g. `HTMLElement`). The engine owns everything inside the host; the
 * adapter never touches the renderer directly (fix F6c).
 */
export type MountGeoMap<THost = unknown> = (
  host: THost,
  opts: GeoMapMountOptions & GeoMapEvents,
) => GeoMapHandle;
