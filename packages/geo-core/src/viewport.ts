/**
 * Normalized viewport + 2D↔3D camera equivalence — the canonical home per
 * SPEC_GEO_MAP_ENGINE §1.5 / §1.5.1 (FROZEN v1, validated 7/7 at the freeze gate §9,
 * re-run `b67eb222`). Promoted from the 3D spike into geo-core (W9) so the 2D (maplibre)
 * and 3D (deck) renderers share ONE viewport + camera math. Dependency-free, pure
 * arithmetic. `@sentropic/geo-map-engine` re-exports these (consumers may import from either).
 */
import type { Position } from "./geojson.js";

/** SPEC_GEO_MAP_ENGINE §1.5.1 revision the frozen convention was graved at. */
export const SPEC_REVISION = "ce1edb99";

/**
 * Viewport common to the 2D and 3D renderers. A `GeoViewport` round-trips 2D↔3D WITHOUT
 * contract change (§1.5): `center` = CRS84 `[longitude, latitude]` (WGS84 decimal degrees);
 * projection WebMercator, world = `tileSize · 2^zoom` CSS px; `bearing`/`pitch` in degrees
 * (`bearing ∈ [0, 360)` mod 360, `pitch ∈ [0, pitchMax]`). Round-trip preserves the CURRENT
 * viewport (§1.1.5), never restores an earlier one.
 */
export interface GeoViewport {
  center: readonly [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

/** Frozen normalized-zoom constants (§1.5.1): world = `tileSize · 2^zoom`; 3D relative altitude. */
export const NORMALIZED_ZOOM = {
  /** tile size, CSS px: world = tileSize · 2^zoom. */
  tileSize: 512,
  /** relative camera altitude for the 3D equivalence. */
  relativeAltitude: 1.5,
} as const;

/** Default 2D pitch ceiling (degrees); the effective `pitchMax` is a per-renderer capability (§1.5.1). */
export const DEFAULT_PITCH_MAX_DEG = 60;

/** 3D camera FOV, derived from the relative altitude so 2D and 3D share one projection (§1.5.1). */
export const CAMERA_FOV_RADIANS = 2 * Math.atan(0.5 / NORMALIZED_ZOOM.relativeAltitude);
export const CAMERA_FOV_DEGREES = (CAMERA_FOV_RADIANS * 180) / Math.PI;

/** The graved 2D↔3D equivalence convention (§1.5.1 @ SPEC_REVISION). */
export const NORMALIZED_CAMERA_CONVENTION = Object.freeze({
  authority: `docs/spec/SPEC_GEO_MAP_ENGINE.md §1.5.1 @${SPEC_REVISION}`,
  center: "CRS84 [longitude, latitude], WGS84, degrés décimaux",
  projection: "WebMercator (EPSG:3857)",
  zoom: `worldSizeCssPx = ${NORMALIZED_ZOOM.tileSize} * 2^zoom`,
  angles: "bearing/pitch en degrés",
  bearingDomain: "[0, 360), normalisé mod 360",
  pitchDomain: `[0, ${DEFAULT_PITCH_MAX_DEG}] exposé par le seam commun`,
  altitude: NORMALIZED_ZOOM.relativeAltitude,
  fovRadians: CAMERA_FOV_RADIANS,
  neutralState: "terrain absent, padding=0, roll=0, wrap horizontal absent",
  commonDomain: "center/zoom/bearing/pitch identiques en 2D et 3D",
});

/** Deterministic projection-equivalence probes (QC extent) for the 2D/3D round-trip validation. */
export const PROJECTION_PROBES: readonly Position[] = Object.freeze([
  [-72.05, 46.78],
  [-71.08, 46.84],
  [-71.92, 47.26],
  [-70.9, 47.2],
]);

/** World size in CSS pixels at a zoom (WebMercator, `tileSize · 2^zoom`). */
export function worldSizeCssPx(zoom: number): number {
  return NORMALIZED_ZOOM.tileSize * 2 ** zoom;
}

/** Normalize a bearing into `[0, 360)`. */
export function normalizeBearing(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

/** Validate + normalize a GeoViewport (finite numbers, pitch in the common domain, bearing mod 360). */
export function normalizeViewport(viewport: GeoViewport): GeoViewport {
  const values = [viewport.center[0], viewport.center[1], viewport.zoom, viewport.bearing, viewport.pitch];
  if (!values.every(Number.isFinite)) {
    throw new Error("GeoViewport requiert uniquement des nombres finis");
  }
  if (viewport.pitch < 0 || viewport.pitch > DEFAULT_PITCH_MAX_DEG) {
    throw new Error(`pitch hors domaine commun [0, ${DEFAULT_PITCH_MAX_DEG}] : ${viewport.pitch}`);
  }
  return {
    center: [viewport.center[0], viewport.center[1]],
    zoom: viewport.zoom,
    bearing: normalizeBearing(viewport.bearing),
    pitch: viewport.pitch,
  };
}

/** A probe one CSS pixel east of center (drives the projection round-trip check). */
export function oneCssPixelLongitudeProbe(viewport: GeoViewport): Position {
  return [viewport.center[0] + 360 / worldSizeCssPx(viewport.zoom), viewport.center[1]];
}

function angularDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Per-axis error between two viewports (`bearing` compared as an angular distance). */
export interface ViewportError {
  readonly centerDegrees: number;
  readonly zoom: number;
  readonly bearingDegrees: number;
  readonly pitchDegrees: number;
}

export function viewportError(actual: GeoViewport, expected: GeoViewport): ViewportError {
  return {
    centerDegrees: Math.max(
      Math.abs(actual.center[0] - expected.center[0]),
      Math.abs(actual.center[1] - expected.center[1]),
    ),
    zoom: Math.abs(actual.zoom - expected.zoom),
    bearingDegrees: angularDistance(actual.bearing, expected.bearing),
    pitchDegrees: Math.abs(actual.pitch - expected.pitch),
  };
}

/** Max Euclidean error between two equal-length projection point lists. */
export function maxProjectionError(
  left: readonly (readonly [number, number])[],
  right: readonly (readonly [number, number])[],
): number {
  if (left.length !== right.length) {
    throw new Error("Comparaison de projections de tailles différentes");
  }
  return left.reduce((maximum, point, index) => {
    const other = right[index];
    if (!other) throw new Error(`Projection manquante à l'index ${index}`);
    return Math.max(maximum, Math.hypot(point[0] - other[0], point[1] - other[1]));
  }, 0);
}
