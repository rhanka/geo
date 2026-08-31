/**
 * Renderer kind (engine-local) + a RE-EXPORT of the normalized viewport & camera
 * equivalence, which now live in `@sentropic/geo-core` (W9 release, geo-core 0.6.0) per
 * SPEC_GEO_MAP_ENGINE §1.5 / §1.5.1 (FROZEN v1, validated at the freeze gate §9, `b67eb222`).
 * Consumers SHOULD keep importing `GeoViewport` & the camera helpers from
 * `@sentropic/geo-map-engine` — this module re-exports them unchanged.
 */

export {
  type GeoViewport,
  type ViewportError,
  NORMALIZED_ZOOM,
  DEFAULT_PITCH_MAX_DEG,
  CAMERA_FOV_RADIANS,
  CAMERA_FOV_DEGREES,
  NORMALIZED_CAMERA_CONVENTION,
  PROJECTION_PROBES,
  SPEC_REVISION,
  worldSizeCssPx,
  normalizeBearing,
  normalizeViewport,
  oneCssPixelLongitudeProbe,
  viewportError,
  maxProjectionError,
} from "@sentropic/geo-core";

/** The active renderer of the engine (§1.3.4). Switched in-place within a stable host (§1.1.5). */
export type RendererKind = "2d" | "3d";

/** Both renderer kinds (§1.3.4). */
export const RENDERER_KINDS = ["2d", "3d"] as const;
