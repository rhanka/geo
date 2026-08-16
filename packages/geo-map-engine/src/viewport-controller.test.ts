import { describe, expect, it } from "vitest";

import type { GeoViewport } from "./viewport.js";
import {
  MaplibreViewportController,
  type MaplibreViewportTarget,
} from "./viewport-controller.js";

type CameraCommand = {
  readonly method: "jumpTo" | "flyTo";
  readonly viewport: GeoViewport;
};

/** In-memory MapLibre camera seam: no canvas, WebGL, or browser runtime. */
class FakeViewportMap implements MaplibreViewportTarget {
  readonly commands: CameraCommand[] = [];
  readonly #moveendListeners = new Set<() => void>();
  #viewport: GeoViewport;
  readonly #emitCameraCommandMoveend: boolean;

  constructor(initialViewport: GeoViewport, emitCameraCommandMoveend = true) {
    this.#viewport = copyViewport(initialViewport);
    this.#emitCameraCommandMoveend = emitCameraCommandMoveend;
  }

  getCenter(): { readonly lng: number; readonly lat: number } {
    return { lng: this.#viewport.center[0], lat: this.#viewport.center[1] };
  }

  getZoom(): number {
    return this.#viewport.zoom;
  }

  getBearing(): number {
    return this.#viewport.bearing;
  }

  getPitch(): number {
    return this.#viewport.pitch;
  }

  jumpTo(viewport: GeoViewport): void {
    this.commands.push({ method: "jumpTo", viewport: copyViewport(viewport) });
    this.#setViewport(viewport);
  }

  flyTo(viewport: GeoViewport): void {
    this.commands.push({ method: "flyTo", viewport: copyViewport(viewport) });
    this.#setViewport(viewport);
  }

  on(_event: "moveend", listener: () => void): void {
    this.#moveendListeners.add(listener);
  }

  off(_event: "moveend", listener: () => void): void {
    this.#moveendListeners.delete(listener);
  }

  moveTo(viewport: GeoViewport): void {
    this.#viewport = copyViewport(viewport);
    this.emitMoveend();
  }

  emitMoveend(): void {
    for (const listener of this.#moveendListeners) listener();
  }

  #setViewport(viewport: GeoViewport): void {
    this.#viewport = copyViewport(viewport);
    if (this.#emitCameraCommandMoveend) this.emitMoveend();
  }
}

const initialViewport: GeoViewport = {
  center: [-71.5, 47],
  zoom: 6,
  bearing: 0,
  pitch: 0,
};

function copyViewport(viewport: GeoViewport): GeoViewport {
  return {
    center: [viewport.center[0], viewport.center[1]],
    zoom: viewport.zoom,
    bearing: viewport.bearing,
    pitch: viewport.pitch,
  };
}

describe("MaplibreViewportController", () => {
  it("should report an uncontrolled moveend in frozen CRS84 and degree units", () => {
    const map = new FakeViewportMap(initialViewport);
    const changes: GeoViewport[] = [];
    new MaplibreViewportController(map, {
      initialViewport,
      onViewportChange: (viewport) => changes.push(viewport),
    });

    expect(map.commands).toEqual([]);
    map.moveTo({
      center: [-73.612, 45.5017],
      zoom: 11.25,
      bearing: -15,
      pitch: 42.5,
    });

    expect(changes).toEqual([{
      center: [-73.612, 45.5017],
      zoom: 11.25,
      bearing: 345,
      pitch: 42.5,
    }]);
  });

  it("should suppress sub-epsilon moves and emit every component at the threshold", () => {
    const epsilon = 0.125;
    const changes: readonly [string, GeoViewport, GeoViewport][] = [
      [
        "longitude",
        { ...initialViewport, center: [initialViewport.center[0] + epsilon / 2, 47] },
        { ...initialViewport, center: [initialViewport.center[0] + epsilon, 47] },
      ],
      [
        "latitude",
        { ...initialViewport, center: [-71.5, initialViewport.center[1] + epsilon / 2] },
        { ...initialViewport, center: [-71.5, initialViewport.center[1] + epsilon] },
      ],
      [
        "zoom",
        { ...initialViewport, zoom: initialViewport.zoom + epsilon / 2 },
        { ...initialViewport, zoom: initialViewport.zoom + epsilon },
      ],
      [
        "bearing",
        { ...initialViewport, bearing: 360 - epsilon / 2 },
        { ...initialViewport, bearing: 360 - epsilon },
      ],
      [
        "pitch",
        { ...initialViewport, pitch: initialViewport.pitch + epsilon / 2 },
        { ...initialViewport, pitch: initialViewport.pitch + epsilon },
      ],
    ];

    for (const [component, underThreshold, atThreshold] of changes) {
      const map = new FakeViewportMap(initialViewport);
      const emitted: GeoViewport[] = [];
      new MaplibreViewportController(map, {
        initialViewport,
        epsilon,
        throttleMs: 0,
        onViewportChange: (viewport) => emitted.push(viewport),
      });

      map.moveTo(underThreshold);
      expect(emitted, component).toEqual([]);
      map.moveTo(atThreshold);
      expect(emitted, component).toEqual([atThreshold]);
    }
  });

  it("should emit at most once in each moveend throttle window", () => {
    let now = 0;
    const map = new FakeViewportMap(initialViewport);
    const emitted: GeoViewport[] = [];
    new MaplibreViewportController(map, {
      initialViewport,
      throttleMs: 100,
      now: () => now,
      onViewportChange: (viewport) => emitted.push(viewport),
    });
    const first: GeoViewport = { ...initialViewport, center: [-71.4, 47] };
    const suppressed: GeoViewport = { ...initialViewport, center: [-71.3, 47] };
    const nextWindow: GeoViewport = { ...initialViewport, center: [-71.2, 47] };

    map.moveTo(first);
    now = 99;
    map.moveTo(suppressed);
    now = 100;
    map.moveTo(nextWindow);

    expect(emitted).toEqual([first, nextWindow]);
  });

  it("should consume the engine moveend from setViewport without echoing it", () => {
    const map = new FakeViewportMap(initialViewport, false);
    const emitted: GeoViewport[] = [];
    const controller = new MaplibreViewportController(map, {
      initialViewport,
      onViewportChange: (viewport) => emitted.push(viewport),
    });
    const controlled = {
      center: [-73.5673, 45.5019] as const,
      zoom: 13,
      bearing: 25,
      pitch: 35,
    };

    controller.setViewport(controlled);
    expect(map.commands).toEqual([{ method: "jumpTo", viewport: controlled }]);
    map.emitMoveend();

    expect(emitted).toEqual([]);
    const userViewport = { ...controlled, center: [-73.56, 45.51] as const };
    map.moveTo(userViewport);
    expect(emitted).toEqual([userViewport]);
  });
});
