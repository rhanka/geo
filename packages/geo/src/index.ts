/**
 * @sentropic/geo — the Node geographic data engine.
 *
 * Consolidates acquisition (download/GDAL/CSV/arcgis), storage (S3/fs, ADR-0012),
 * the OGC API – Features server, the source catalog, the generic normalizer, and
 * the `geo` CLI into a single Node-only package (ADR-0017). Sub-path entry points
 * (`@sentropic/geo/acquire`, `/storage`, `/api`, `/api/app`, `/cli`, `/catalog`,
 * `/normalize`, `/georef`, `/zonage`) expose each subsystem; this root barrel
 * re-exports the stable acquisition + storage surface most consumers reach for.
 *
 * The dependency-free domain model lives in `@sentropic/geo-core`; the browser
 * map component in `@sentropic/geo-ui-svelte`; the source manifests/recipes in
 * `@sentropic/geo-sources-<continent>`.
 *
 * NOTE (merge main ↔ acquisition): the pure lot/zone join used by the QC
 * acquisition chain lives in `./zonage/lotZoneJoin.ts`. It is reachable three ways
 * and ALL THREE must agree, because different resolvers pick different ones:
 *   - `@sentropic/geo/zonage` (package.json sub-path export → dist/zonage/…),
 *   - the acquisition workspace `@sentropic/geo` tsconfig path mapping (→ src),
 *   - this root barrel (what Node/vitest actually resolve `@sentropic/geo` to,
 *     via package.json `exports["."]` → dist/index.js).
 * Dropping it from the barrel does NOT save the acquisition workspace any
 * dependency — `export *` of acquire/storage below already pulls those in on the
 * very same module — it only makes `import { canonicalizeZoneCodeForJoin } from
 * "@sentropic/geo"` type-check (via the path mapping) and then evaluate to
 * `undefined` at runtime. The named re-export below is therefore load-bearing:
 * it is the join key served to Immo. Keep it explicit (not `export *`) so a name
 * collision with acquire/storage fails the build instead of silently shadowing.
 */

export const VERSION = "0.1.0";

export * from "./acquire/index.js";
export * from "./storage/index.js";
export {
  assignLotZones,
  canonicalizeZoneCodeForJoin,
  enrichWithNorms,
  normalizeZoneCode,
  zoneNumberOf,
  type LotZoneAssignment,
  type LotZoneAssignmentMethod,
  type LotZoneJoinOptions,
  type LotZoneNormAssignment,
  type NormsRecord,
  type PolygonalFeature,
  type PolygonalGeometry,
} from "./zonage/lotZoneJoin.js";
export {
  parseMontLaurierZonesHDensityDocument,
  type DensityDocumentParseResult,
  type DensityNormRefusal,
  type VerbatimDensityNorm,
} from "./zonage/densityDocument.js";
