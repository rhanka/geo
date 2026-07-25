/**
 * @sentropic/geo-core — domain model & geographic standards.
 *
 * Dependency-free. Exposes the GeoJSON model (RFC 7946), the administrative
 * hierarchy (ISO 3166), CRS helpers, the license model, the Source Manifest
 * contract, and the normalized acquisition output type.
 */

export const VERSION = "0.1.0";

export * from "./geojson.js";
export * from "./crs.js";
export * from "./admin.js";
export * from "./license.js";
export * from "./source-manifest.js";
export * from "./feature.js";
export * from "./normalize.js";
