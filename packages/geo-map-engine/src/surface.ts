/**
 * Thin surface (adapter ↔ engine) — SPEC_GEO_MAP_ENGINE §1.3.4 / §1.3.5 (FROZEN v1).
 *
 * The engine is framework-agnostic and DOM-free in its internals (reconciliation, paint,
 * camera): the adapter only BINDS props→calls, reactivity→engine, events→framework, and
 * resolves theme tokens → {@link TokenMap}. Zero duplicated logic across the N adapters.
 */

import type { BasemapSpec, RasterSource } from "./basemap.js";
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

/**
 * The adapter's resolution of a {@link RasterSource} logical id to concrete render inputs
 * (SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D §2.5, ADR-0029). Produced by the (framework-neutral) adapter at
 * mount and consumed by the engine when it compiles a `raster-source` basemap.
 *
 * §3.3 NO-SECRET INVARIANT: this descriptor carries the tile URL TEMPLATE BASE only (`{z}/{x}/{y}`,
 * NEVER `?session=&key=`). The minted session + restricted key live SOLELY in the adapter's closures
 * — the per-tile `transformRequest` (passed via {@link GeoMapMountOptions.options}) and the
 * `attributionResolver` below — so the engine NEVER sees them.
 */
export interface ResolvedRasterSource {
  /** `{z}/{x}/{y}` template WITHOUT session/key — the adapter injects those per-tile (transformRequest). */
  readonly tileUrlTemplateBase: string;
  readonly tileSize: { readonly width: number; readonly height: number };
  readonly imageFormat: string;
  /**
   * The DYNAMIC per-viewport copyright resolver (§3.1/§S8). REQUIRED at runtime when the spec's
   * {@link RasterSource.attribution} is `{ mode: "dynamic" }` — the engine fail-closes to `onError` if
   * a dynamic source resolves without it (never renders tiles with no live attribution, fable B4).
   */
  readonly attributionResolver?: (viewport: GeoViewport) => Promise<string>;
}

/** Options passed to {@link MountGeoMap}. */
export interface GeoMapMountOptions {
  basemap: BasemapSpec;
  layers: readonly GeoLayerSpec[];
  viewport: GeoViewport;
  renderer: RendererKind;
  tokens: TokenMap;
  /**
   * Resolves a `raster-source` basemap's logical id to its concrete render inputs (§2.5, ADR-0029). A
   * FIRST-CLASS TYPED contract member (geo-archi ruling): it is load-bearing — the engine invokes it and
   * the §3.1 fail-closed depends on it — so it is NOT smuggled through the untyped {@link options}
   * escape-hatch. Additive-optional to the frozen surface (non-breaking; the v2 MAJOR is ADR-0029's
   * `raster-source` union member). Absent ⇒ a `raster-source` spec fail-closes to `onError`.
   */
  resolveRasterSource?: (source: RasterSource) => ResolvedRasterSource;
  options?: Readonly<Record<string, unknown>>;
}

/**
 * A runtime error surfaced by the engine (SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D §2.4, fable B3). A
 * live-embed provider makes runtime refusal a NORMAL mode (session expired, quota, revoked key,
 * network). `kind` is EXTENSIBLE: new kinds may be added additively (MINOR, non-breaking) — a
 * consumer MUST NOT `switch` exhaustively on it and MUST carry a `default` branch.
 */
export interface GeoMapError {
  source: "basemap" | "layer";
  sourceId?: string;
  kind: "resolve-failed" | "session-expired" | "quota" | "forbidden" | "network";
  recoverable: boolean;
  message: string;
}

/** Event callbacks (§1.3.4). Viewport is non-controlled by default (`onViewportChange`). */
export interface GeoMapEvents {
  onReady?: () => void;
  onHover?: (hit: GeoFeatureHit | null) => void;
  onSelect?: (hit: GeoFeatureHit) => void;
  onViewportChange?: (viewport: GeoViewport) => void;
  /**
   * v2.0 additive (§2.4). The engine MUST emit this AND render a DECLARED fallback (blank basemap +
   * attribution notice) on a runtime source failure — never a silent blank (green-by-omission = red).
   */
  onError?: (err: GeoMapError) => void;
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
