/**
 * MapLibre 2D viewport binding — SPEC_GEO_MAP_ENGINE §1.4 / §1.5.1.
 *
 * This remains an engine-internal seam. The frozen public surface carries
 * `GeoViewport`; this controller only translates it to and from MapLibre's
 * camera and guards the controlled echo path.
 */

import type { GeoViewport } from "./viewport.js";

const DEFAULT_EPSILON = 1e-7;
const DEFAULT_THROTTLE_MS = 100;

/** The part of a MapLibre `LngLat` needed to read the normalized viewport. */
export interface MaplibreViewportCenter {
  readonly lng: number;
  readonly lat: number;
}

/** Minimal 2D camera/event seam, kept free of MapLibre's public types. */
export interface MaplibreViewportTarget {
  getCenter(): MaplibreViewportCenter;
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  jumpTo(viewport: GeoViewport): void;
  flyTo(viewport: GeoViewport): void;
  on(event: "moveend", listener: () => void): void;
  off(event: "moveend", listener: () => void): void;
}

export interface ViewportControllerOptions {
  /** Baseline for the non-controlled map; construction never reapplies it. */
  readonly initialViewport: GeoViewport;
  readonly onViewportChange?: (viewport: GeoViewport) => void;
  /** Per-component tolerance in the frozen viewport units. */
  readonly epsilon?: number;
  /** Leading `moveend` throttle window. */
  readonly throttleMs?: number;
  /** Internal clock seam for deterministic tests. */
  readonly now?: () => number;
}

/**
 * Owns the MapLibre 2D viewport event binding. User moves are reported by
 * default; callers opt into control only by invoking {@link setViewport}.
 */
export class MaplibreViewportController {
  readonly initialViewport: GeoViewport;
  readonly #map: MaplibreViewportTarget;
  readonly #onViewportChange: ((viewport: GeoViewport) => void) | undefined;
  readonly #epsilon: number;
  readonly #throttleMs: number;
  readonly #now: () => number;
  readonly #onMoveend = (): void => this.#handleMoveend();
  #lastViewport: GeoViewport;
  #lastEmittedAt: number | undefined;
  #engineTarget: GeoViewport | undefined;
  #isApplyingEngineViewport = false;

  constructor(map: MaplibreViewportTarget, options: ViewportControllerOptions) {
    const epsilon = options.epsilon ?? DEFAULT_EPSILON;
    const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
    if (!Number.isFinite(epsilon) || epsilon <= 0) {
      throw new Error("Viewport epsilon must be a positive finite number");
    }
    if (!Number.isFinite(throttleMs) || throttleMs < 0) {
      throw new Error("Viewport throttleMs must be a non-negative finite number");
    }

    this.#map = map;
    this.initialViewport = copyViewport(options.initialViewport);
    this.#lastViewport = copyViewport(options.initialViewport);
    this.#onViewportChange = options.onViewportChange;
    this.#epsilon = epsilon;
    this.#throttleMs = throttleMs;
    this.#now = options.now ?? Date.now;
    this.#map.on("moveend", this.#onMoveend);
  }

  /** Applies a controlled viewport without turning its resulting `moveend` into an echo. */
  setViewport(viewport: GeoViewport): void {
    this.#applyViewport(viewport, (target) => this.#map.jumpTo(target));
  }

  /** Applies an imperative camera transition with the same echo guard. */
  flyTo(viewport: GeoViewport): void {
    this.#applyViewport(viewport, (target) => this.#map.flyTo(target));
  }

  /** Detaches the controller from the map before its renderer is discarded. */
  destroy(): void {
    this.#map.off("moveend", this.#onMoveend);
  }

  #applyViewport(viewport: GeoViewport, apply: (target: GeoViewport) => void): void {
    const target = copyViewport(viewport);
    if (sameViewport(this.#lastViewport, target, this.#epsilon)) return;

    const current = this.#readViewport();
    if (sameViewport(current, target, this.#epsilon)) {
      this.#lastViewport = current;
      this.#engineTarget = undefined;
      return;
    }

    // Arm before MapLibre is called: `jumpTo` may synchronously fire `moveend`.
    this.#lastViewport = target;
    this.#engineTarget = target;
    this.#isApplyingEngineViewport = true;
    try {
      apply(target);
    } finally {
      this.#isApplyingEngineViewport = false;
      const actual = this.#readViewport();
      if (sameViewport(actual, target, this.#epsilon)) {
        this.#lastViewport = actual;
        this.#engineTarget = undefined;
      }
    }
  }

  #handleMoveend(): void {
    const viewport = this.#readViewport();
    if (this.#isApplyingEngineViewport) return;

    if (this.#engineTarget) {
      if (sameViewport(viewport, this.#engineTarget, this.#epsilon)) {
        this.#lastViewport = viewport;
        this.#engineTarget = undefined;
        return;
      }
      // A command with no matching moveend must not swallow the next user move.
      this.#engineTarget = undefined;
    }

    if (sameViewport(this.#lastViewport, viewport, this.#epsilon)) return;

    const now = this.#now();
    if (
      this.#lastEmittedAt !== undefined &&
      now - this.#lastEmittedAt < this.#throttleMs
    ) {
      return;
    }

    // Update before the callback: consumer code may synchronously call setViewport.
    this.#lastViewport = viewport;
    this.#lastEmittedAt = now;
    this.#onViewportChange?.(viewport);
  }

  #readViewport(): GeoViewport {
    const center = this.#map.getCenter();
    return {
      center: [center.lng, center.lat],
      zoom: this.#map.getZoom(),
      bearing: normalizeBearing(this.#map.getBearing()),
      pitch: this.#map.getPitch(),
    };
  }
}

function copyViewport(viewport: GeoViewport): GeoViewport {
  return {
    center: [viewport.center[0], viewport.center[1]],
    zoom: viewport.zoom,
    bearing: normalizeBearing(viewport.bearing),
    pitch: viewport.pitch,
  };
}

function sameViewport(left: GeoViewport, right: GeoViewport, epsilon: number): boolean {
  return (
    Math.abs(left.center[0] - right.center[0]) < epsilon &&
    Math.abs(left.center[1] - right.center[1]) < epsilon &&
    Math.abs(left.zoom - right.zoom) < epsilon &&
    bearingDistance(left.bearing, right.bearing) < epsilon &&
    Math.abs(left.pitch - right.pitch) < epsilon
  );
}

function normalizeBearing(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

function bearingDistance(left: number, right: number): number {
  const difference = Math.abs(normalizeBearing(left) - normalizeBearing(right));
  return Math.min(difference, 360 - difference);
}
