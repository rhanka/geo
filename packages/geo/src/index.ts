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
 * acquisition chain lives in `./zonage/lotZoneJoin.ts` and is reached through the
 * `@sentropic/geo/zonage` sub-path (and, for the acquisition workspace, through
 * the `@sentropic/geo` tsconfig path mapping). It is deliberately NOT re-exported
 * from this root barrel: the barrel pulls in the acquire/storage subsystems whose
 * dependencies the acquisition workspace does not install.
 */

export const VERSION = "0.1.0";

export * from "./acquire/index.js";
export * from "./storage/index.js";
