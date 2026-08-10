/**
 * @sentropic/geo/zones — zoning-producer serving compute.
 *
 * The pure assembly step that turns per-lot, zone-code-assigned cadastre into
 * the served "one feature per distinct zone_code" contract shared by the T1
 * (embedded-GeoPDF) and T2 (manual N-GCP) recalage producers:
 *   - {@link mergeByZoneCode}: collapse assigned lots into 1 feature per code,
 *     unioning their real geometry and summing `n_lots`;
 *   - {@link bboxCenter}: centre + bbox of a FeatureCollection's polygons;
 *   - {@link haversineKm}: great-circle distance between two [lon,lat] points.
 *
 * Network-free and GDAL-free. Polygon unions use `polyclip-ts` (a runtime dep);
 * the georeferencing that PLACES the lots lives in `@sentropic/geo/georef`.
 */

export const VERSION = "0.1.0";

export { bboxCenter, haversineKm, mergeByZoneCode } from "./serve.js";
