/**
 * Normalized viewport & renderer kind — SPEC_GEO_MAP_ENGINE §1.5 / §1.5.1 (FROZEN v1).
 *
 * Canonical home of `GeoViewport` per §1.5 is `@sentropic/geo-core` (a cross-repo
 * release, ownership owner-confirmed). It is defined here in the engine contract until
 * that release, after which geo-core owns it and this module re-exports it. Consumers
 * SHOULD import it from `@sentropic/geo-map-engine` regardless.
 */

/**
 * Viewport common to the 2D and 3D renderers. A `GeoViewport` round-trips 2D↔3D WITHOUT
 * contract change (§1.5), under the GRAVÉE convention below (§1.5.1, validated 7/7 at the
 * freeze gate §9, re-run `b67eb222`):
 *
 * - `center`: CRS84 `[longitude, latitude]` — WGS84 decimal degrees, lon/lat order.
 * - projection: WebMercator (EPSG:3857); world size = **512 · 2^zoom** CSS pixels
 *   (identical maplibre 2D and deck `MapView` 3D).
 * - `bearing` / `pitch`: degrees. `bearing ∈ [0, 360)` (normalized mod 360);
 *   `pitch ∈ [0, pitchMax]` where `pitchMax` is the renderer capability exposed by the seam
 *   (≈ 60° maplibre 2D).
 * - 3D-camera equivalence (deterministic): relative altitude 1.5, FOV = 2·atan(0.5/1.5).
 * - neutralized in v1 (never implicit): no terrain, padding, roll, nor horizontal wrap.
 *
 * Round-trip semantics (§1.1.5): a renderer switch preserves the CURRENT viewport (no drift),
 * it NEVER restores an earlier one (e.g. an initial viewport).
 */
export interface GeoViewport {
  center: readonly [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

/** The active renderer of the engine (§1.3.4). Switched in-place within a stable host (§1.1.5). */
export type RendererKind = "2d" | "3d";

/** Both renderer kinds (§1.3.4). */
export const RENDERER_KINDS = ["2d", "3d"] as const;

/** Frozen normalized-zoom constants (§1.5.1), validated at the gate. */
export const NORMALIZED_ZOOM = {
  /** tile size, CSS px: world = tileSize · 2^zoom. */
  tileSize: 512,
  /** relative camera altitude for the 3D equivalence. */
  relativeAltitude: 1.5,
} as const;

/** Default 2D pitch ceiling (degrees); the effective `pitchMax` is a per-renderer capability (§1.5.1). */
export const DEFAULT_PITCH_MAX_DEG = 60;
