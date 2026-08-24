/**
 * MapLibre 2D basemap binding — SPEC_GEO_MAP_ENGINE §1.3.2 / §1.4.
 *
 * This remains an engine-internal seam. The frozen public contract carries a
 * neutral `BasemapSpec`; this controller compiles it to the narrow MapLibre
 * style surface and restores declarative overlays after a style replacement.
 */

import type { BasemapSpec } from "./basemap.js";
import type { TokenMap, TokenRole } from "./encodings.js";

/** Minimal MapLibre style/event seam, kept free of public MapLibre types. */
export interface MaplibreBasemapTarget {
  setStyle(style: MaplibreBasemapStyle): void;
  on(event: MaplibreStyleReadyEvent, listener: () => void): void;
  off(event: MaplibreStyleReadyEvent, listener: () => void): void;
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
}

/** Owns MapLibre style replacement and the post-style overlay reinjection seam. */
export class MaplibreBasemapController {
  readonly #map: MaplibreBasemapTarget;
  readonly #tokens: TokenMap;
  readonly #reinjectOverlays: () => void;

  constructor(map: MaplibreBasemapTarget, options: BasemapControllerOptions) {
    this.#map = map;
    this.#tokens = options.tokens;
    this.#reinjectOverlays = options.reinjectOverlays;
  }

  setBasemap(spec: BasemapSpec): void {
    const compiled = compileBasemap(spec, this.#tokens);

    this.#detachStyleReadyListeners();
    this.#map.on("styledata", this.#onStyleReady);
    this.#map.on("load", this.#onStyleReady);
    try {
      this.#map.setStyle(compiled);
    } catch (error) {
      this.#detachStyleReadyListeners();
      throw error;
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
}

function compileBasemap(spec: BasemapSpec, tokens: TokenMap): MaplibreBasemapStyle {
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
        layers: [{
          id: "basemap/raster",
          type: "raster",
          source: "basemap/raster",
          ...(spec.saturation === undefined
            ? {}
            : { paint: { "raster-saturation": spec.saturation } }),
        }],
      };

    case "vector":
      throw new Error("vector basemap not yet supported — pending contract ratification");
  }
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
