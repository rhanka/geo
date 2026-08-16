/**
 * MapLibre mount integration — SPEC_GEO_MAP_ENGINE §1.3.4.
 *
 * The renderer-neutral contract remains in `surface.ts`; this module is its
 * 2D binding and owns the MapLibre instance mounted inside the stable host.
 */

import maplibregl, { type MapOptions } from "maplibre-gl";

import type { GeoBounds, GeoMapHandle, MountGeoMap } from "./surface.js";
import type { GeoViewport } from "./viewport.js";

const PENDING_3D = "integration-pending — 3d renderer";
const PENDING_W8 = "integration-pending — W8";
type MapContainer = Exclude<MapOptions["container"], string>;

/**
 * Mounts a real MapLibre 2D renderer. The public surface deliberately stays
 * generic; the concrete 2D implementation requires a MapLibre container host.
 */
export const mount: MountGeoMap<MapContainer> = (host, options): GeoMapHandle => {
  if (options.renderer === "3d") throw new Error(PENDING_3D);

  const map = new maplibregl.Map({
    container: host,
    style: { version: 8, sources: {}, layers: [] },
    center: [options.viewport.center[0], options.viewport.center[1]],
    zoom: options.viewport.zoom,
    bearing: options.viewport.bearing,
    pitch: options.viewport.pitch,
  });
  const initialViewport = copyViewport(options.viewport);
  let destroyed = false;

  const assertActive = (): void => {
    if (destroyed) throw new Error("Geo map handle is destroyed");
  };
  const rejectW8 = (): never => {
    throw new Error(PENDING_W8);
  };

  return {
    setLayers: () => assertActive(),
    setBasemap: () => assertActive(),
    setViewport: () => assertActive(),
    setRenderer: (renderer) => {
      assertActive();
      if (renderer === "3d") throw new Error(PENDING_3D);
    },
    setTokens: () => assertActive(),
    flyTo: () => assertActive(),
    fitBounds: (_bounds: GeoBounds) => assertActive(),
    recenterKeepZoom: () => assertActive(),
    resetToInitialView: () => {
      assertActive();
      void initialViewport;
    },
    syncLayers: () => rejectW8(),
    queryRenderedFeatures: () => rejectW8(),
    getFeatureBoundary: () => rejectW8(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      map.remove();
    },
  };
};

function copyViewport(viewport: GeoViewport): GeoViewport {
  return {
    center: [viewport.center[0], viewport.center[1]],
    zoom: viewport.zoom,
    bearing: viewport.bearing,
    pitch: viewport.pitch,
  };
}
