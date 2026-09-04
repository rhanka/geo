/**
 * @sentropic/geo-map-engine — geo-owned renderer-neutral map engine.
 *
 * FROZEN v1 CONTRACT (ADR-0026, ratified owner 2026-08-16 on gate §9 VERT, re-run `b67eb222`).
 * This package materializes the public contract of SPEC_GEO_MAP_ENGINE §1.3 as code
 * (types-first, zero logic beyond frozen constants). The engine IMPLEMENTATION lands
 * incrementally in Phase 0 (W1–W10) against these frozen types; the DS adapters bind against
 * them (a contract-conformant mock swaps to the real engine at its landing).
 *
 * Any change to the frozen public types = a new major version (semver) + an ADR — never silent.
 */

/**
 * Contract version (§1, ADR-0026). **v2.0.0** (SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D) adds ONE additive
 * basemap member (`raster-source`) + its support types (`RasterSource`/`AttributionSpec`/
 * `SourcePolicy`) + the `onError`/`GeoMapError` channel + the additive-optional mount member
 * `resolveRasterSource`/`ResolvedRasterSource` seam (§2.5, ADR-0029) that resolves a `raster-source`
 * logical id to concrete tiles + dynamic attribution. A new union member of a frozen type = MAJOR + ADR
 * (§2.1); an additive-OPTIONAL member is non-breaking; the three v1 basemap members and every other v1
 * type are unchanged.
 */
export const CONTRACT_VERSION = "2.0.0" as const;

export * from "./encodings.js";
export * from "./basemap.js";
export * from "./layers.js";
export * from "./viewport.js";
export * from "./surface.js";
export * from "./tool-context.js";
export * from "./basemap-google2d-adapter.js";
export { mount } from "./mount.js";
