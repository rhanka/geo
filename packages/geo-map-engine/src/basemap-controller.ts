/**
 * MapLibre 2D basemap binding — SPEC_GEO_MAP_ENGINE §1.3.2 / §1.4 + V2_BASEMAP_2D §2.5.
 *
 * This remains an engine-internal seam. The frozen public contract carries a
 * neutral `BasemapSpec`; this controller compiles it to the narrow MapLibre
 * style surface and restores declarative overlays after a style replacement.
 *
 * The v2 `raster-source` member (ADR-0029) resolves through the adapter-supplied
 * `resolveRasterSource` (mount option) to concrete tiles + a DYNAMIC per-viewport
 * attribution: the controller owns the host (§S8), so it renders the attribution
 * DOM-visibly and refreshes it on `moveend`. The minted session/key NEVER reach
 * this seam — they live in the adapter's per-tile `transformRequest` closure.
 */

import type { BasemapSpec, RasterSource } from "./basemap.js";
import type { TokenMap, TokenRole } from "./encodings.js";
import type { GeoMapError, ResolvedRasterSource } from "./surface.js";
import type { GeoViewport } from "./viewport.js";

/** Minimal MapLibre style/event seam, kept free of public MapLibre types. */
export interface MaplibreBasemapTarget {
  setStyle(style: MaplibreBasemapStyle): void;
  on(event: MaplibreStyleReadyEvent | "moveend", listener: () => void): void;
  off(event: MaplibreStyleReadyEvent | "moveend", listener: () => void): void;
  /** Current camera — fed to the dynamic per-viewport attribution resolver (§2.5). */
  getViewport(): GeoViewport;
  /**
   * DOM-VISIBLE dynamic-attribution sink (§3.1/§S8). A non-empty string renders/updates the on-screen
   * notice; `null` clears it (used when leaving a dynamic basemap). NEVER suppressed to render tiles
   * without live attribution.
   */
  setDynamicAttribution(text: string | null): void;
}

export type MaplibreStyleReadyEvent = "styledata" | "load";

/** Internal compiled MapLibre style shape required by the basemap controller. */
export interface MaplibreBasemapStyle {
  readonly version: 8;
  readonly sources: Readonly<Record<string, MaplibreRasterSource>>;
  readonly layers: readonly MaplibreBasemapLayer[];
}

export interface MaplibreRasterSource {
  readonly type: "raster";
  readonly tiles: readonly string[];
  readonly attribution: string;
  /** Square tile edge in px (provider tiles, e.g. Google 2D = 256). Omitted for the v1 `raster` kind. */
  readonly tileSize?: number;
}

export type MaplibreBasemapLayer =
  | {
    readonly id: string;
    readonly type: "background";
    readonly paint: Readonly<{ "background-color": string }>;
  }
  | {
    readonly id: string;
    readonly type: "raster";
    readonly source: string;
    readonly paint?: Readonly<{ "raster-saturation": number }>;
  };

export interface BasemapControllerOptions {
  readonly tokens: TokenMap;
  /** Re-adds declarative overlays removed by MapLibre's `setStyle`. */
  readonly reinjectOverlays: () => void;
  /**
   * Resolves a `raster-source` spec's logical id to concrete render inputs (§2.5, mount option). Absent ⇒
   * a `raster-source` basemap fail-closes to {@link onError} + the declared fallback (never a silent blank).
   */
  readonly resolveRasterSource?: (source: RasterSource) => ResolvedRasterSource;
  /** Runtime-error sink (§2.4). The engine ALSO renders a declared fallback — `onError` is never the only signal. */
  readonly onError?: (error: GeoMapError) => void;
}

/** The declared fallback shown when a `raster-source` fails to resolve/attribute (§2.4): a blank style. */
const FALLBACK_STYLE: MaplibreBasemapStyle = { version: 8, sources: {}, layers: [] };
/** DOM-visible notice paired with {@link FALLBACK_STYLE} — the "never a SILENT blank" guarantee (#313, §2.4). */
const BASEMAP_UNAVAILABLE_NOTICE = "Basemap imagery unavailable";

/** Owns MapLibre style replacement, the post-style overlay reinjection seam, and dynamic attribution. */
export class MaplibreBasemapController {
  readonly #map: MaplibreBasemapTarget;
  readonly #tokens: TokenMap;
  readonly #reinjectOverlays: () => void;
  readonly #resolveRasterSource: ((source: RasterSource) => ResolvedRasterSource) | undefined;
  readonly #onError: ((error: GeoMapError) => void) | undefined;
  /** The live dynamic-attribution resolver, or `undefined` when no dynamic basemap is active. */
  #attributionResolver: ((viewport: GeoViewport) => Promise<string>) | undefined;
  #attributionSourceId: string | undefined;

  constructor(map: MaplibreBasemapTarget, options: BasemapControllerOptions) {
    this.#map = map;
    this.#tokens = options.tokens;
    this.#reinjectOverlays = options.reinjectOverlays;
    this.#resolveRasterSource = options.resolveRasterSource;
    this.#onError = options.onError;
  }

  setBasemap(spec: BasemapSpec): void {
    // Leaving any previously-active dynamic basemap: stop refreshing + clear its on-screen notice.
    this.#teardownDynamicAttribution();

    if (spec.kind === "raster-source") {
      this.#setRasterSourceBasemap(spec.source, spec.saturation);
      return;
    }

    const compiled = compileBasemap(spec, this.#tokens);
    this.#applyStyle(compiled);
  }

  /** Resolves + applies a v2 `raster-source` basemap, fail-closing to a declared fallback (§2.5). */
  #setRasterSourceBasemap(source: RasterSource, saturation: number | undefined): void {
    if (!this.#resolveRasterSource) {
      this.#failClosed(source.id, "resolve-failed", false, "no resolveRasterSource for a raster-source basemap");
      return;
    }
    let resolved: ResolvedRasterSource;
    try {
      resolved = this.#resolveRasterSource(source);
    } catch (error) {
      this.#failClosed(source.id, "resolve-failed", false, `resolveRasterSource threw: ${errorMessage(error)}`);
      return;
    }
    // Dynamic attribution REQUIRES a resolver — fail-closed at runtime, never render tiles unattributed (B4).
    if (source.attribution.mode === "dynamic" && !resolved.attributionResolver) {
      this.#failClosed(source.id, "resolve-failed", false, "dynamic attribution without an attributionResolver");
      return;
    }

    this.#applyStyle(compileRasterSource(source, resolved, saturation));

    if (source.attribution.mode === "dynamic" && resolved.attributionResolver) {
      this.#attributionResolver = resolved.attributionResolver;
      this.#attributionSourceId = source.id;
      this.#map.on("moveend", this.#onMoveend);
      void this.#refreshAttribution(); // seed the on-screen copyright immediately after style-ready
    }
  }

  /** Arms the style-ready listeners and swaps the MapLibre style (shared by every basemap kind). */
  #applyStyle(style: MaplibreBasemapStyle): void {
    this.#detachStyleReadyListeners();
    this.#map.on("styledata", this.#onStyleReady);
    this.#map.on("load", this.#onStyleReady);
    try {
      this.#map.setStyle(style);
    } catch (error) {
      this.#detachStyleReadyListeners();
      throw error;
    }
  }

  /** Emits `onError` AND renders the declared blank+notice fallback — never one without the other (§2.4). */
  #failClosed(
    sourceId: string,
    kind: GeoMapError["kind"],
    recoverable: boolean,
    message: string,
  ): void {
    this.#teardownDynamicAttribution();
    this.#onError?.({ source: "basemap", sourceId, kind, recoverable, message });
    this.#applyStyle(FALLBACK_STYLE);
    this.#map.setDynamicAttribution(BASEMAP_UNAVAILABLE_NOTICE);
  }

  readonly #onMoveend = (): void => {
    void this.#refreshAttribution();
  };

  /** Resolves the per-viewport copyright and renders it; a genuine failure fail-closes to the fallback. */
  async #refreshAttribution(): Promise<void> {
    const resolver = this.#attributionResolver;
    const sourceId = this.#attributionSourceId;
    if (!resolver || sourceId === undefined) return;
    const viewport = this.#map.getViewport();
    try {
      const text = await resolver(viewport);
      if (this.#attributionResolver === resolver) this.#map.setDynamicAttribution(text);
    } catch (error) {
      // Stale rejection after a basemap change / teardown — ignore.
      if (this.#attributionResolver !== resolver) return;
      this.#failClosed(sourceId, classifyResolverError(error), true, `attributionResolver failed: ${errorMessage(error)}`);
    }
  }

  // Arm before `setStyle`: MapLibre can synchronously emit `styledata` while
  // applying the style, but reinjection remains strictly post-style event.
  readonly #onStyleReady = (): void => {
    this.#detachStyleReadyListeners();
    this.#reinjectOverlays();
  };

  #detachStyleReadyListeners(): void {
    this.#map.off("styledata", this.#onStyleReady);
    this.#map.off("load", this.#onStyleReady);
  }

  #teardownDynamicAttribution(): void {
    if (!this.#attributionResolver) return;
    this.#map.off("moveend", this.#onMoveend);
    this.#attributionResolver = undefined;
    this.#attributionSourceId = undefined;
    this.#map.setDynamicAttribution(null);
  }
}

function compileBasemap(spec: Exclude<BasemapSpec, { kind: "raster-source" }>, tokens: TokenMap): MaplibreBasemapStyle {
  switch (spec.kind) {
    case "blank":
      return {
        version: 8,
        sources: {},
        layers: [{
          id: "basemap/background",
          type: "background",
          paint: { "background-color": resolveToken(tokens, spec.background) },
        }],
      };

    case "raster":
      assertRasterAttribution(spec.attribution);
      return {
        version: 8,
        sources: {
          "basemap/raster": {
            type: "raster",
            tiles: spec.tiles,
            attribution: spec.attribution,
          },
        },
        layers: [rasterLayer(spec.saturation)],
      };

    case "vector":
      throw new Error("vector basemap not yet supported — pending contract ratification");
  }
}

/**
 * Compiles a resolved v2 `raster-source` (§2.5). The source URL is the resolved TEMPLATE BASE (`{z}/{x}/{y}`
 * WITHOUT session/key — those are injected per-tile by the adapter's transformRequest). A STATIC attribution
 * rides the MapLibre source string; a DYNAMIC one is rendered by the controller's on-screen control, so the
 * source string is left empty to avoid a doubled credit.
 */
function compileRasterSource(
  source: RasterSource,
  resolved: ResolvedRasterSource,
  saturation: number | undefined,
): MaplibreBasemapStyle {
  const attribution = source.attribution.mode === "static" ? source.attribution.text : "";
  if (source.attribution.mode === "static") assertRasterAttribution(attribution);
  return {
    version: 8,
    sources: {
      "basemap/raster": {
        type: "raster",
        tiles: [resolved.tileUrlTemplateBase],
        attribution,
        tileSize: resolved.tileSize.width,
      },
    },
    layers: [rasterLayer(saturation)],
  };
}

function rasterLayer(saturation: number | undefined): MaplibreBasemapLayer {
  return {
    id: "basemap/raster",
    type: "raster",
    source: "basemap/raster",
    ...(saturation === undefined ? {} : { paint: { "raster-saturation": saturation } }),
  };
}

/** Maps a genuine attributionResolver rejection to a `GeoMapError` kind (adapter may tag `.kind`; §2.4). */
function classifyResolverError(error: unknown): GeoMapError["kind"] {
  const kind = (error as { kind?: unknown } | null)?.kind;
  if (kind === "session-expired" || kind === "quota" || kind === "forbidden" || kind === "network") return kind;
  return "network";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveToken(tokens: TokenMap, role: TokenRole): string {
  if (!Object.hasOwn(tokens, role) || tokens[role] === undefined) {
    throw new Error(`Missing resolved token for role: ${role}`);
  }
  return tokens[role];
}

function assertRasterAttribution(attribution: unknown): asserts attribution is string {
  if (typeof attribution !== "string" || attribution.trim().length === 0) {
    throw new Error("A raster basemap requires attribution");
  }
}
