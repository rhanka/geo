/**
 * Basemap contract — SPEC_GEO_MAP_ENGINE §1.3.2 (FROZEN v1).
 *
 * Attribution is MANDATORY for tiled basemaps; URLs are never hardcoded in the engine —
 * they are carried by the spec the consumer provides.
 */

import type { TokenRole } from "./encodings.js";

export type BasemapSpec =
  | { kind: "blank"; background: TokenRole }
  | { kind: "raster"; tiles: readonly string[]; attribution: string; saturation?: number }
  | { kind: "vector"; style?: string; pmtiles?: string; attribution: string };

/** Discriminants of {@link BasemapSpec}. Forward 3D fields (`terrain`, `sky`) are added additively (non-breaking, §1.1 principle 4). */
export const BASEMAP_KINDS = ["blank", "raster", "vector"] as const;
export type BasemapKind = (typeof BASEMAP_KINDS)[number];
