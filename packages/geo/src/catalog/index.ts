/**
 * @sentropic/geo/catalog — the aggregated source inventory.
 *
 * `buildInventory(registries)` projects continent {@link SourceRegistry}s onto a
 * stable, denormalized {@link InventoryEntry} list (ADR-0017). The engine never
 * statically imports source packages; the inventory is injected.
 *
 * ## GeoSourceInventory (Lot D)
 * `GeoSourceInventory` / `recenseCkanZonage` / `recensePlatform` :
 * inventaire des sources par ville (zonage + lots) et recensement automatique
 * via CKAN Données Québec.
 */

export type { InventoryDataset, InventoryEntry } from "./inventory.js";
export {
  buildInventory,
  allSources,
  byCountry,
  byKind,
  bySourceId,
  datasetsFor,
  redistributableSources,
} from "./inventory.js";

// ── GeoSourceInventory (Lot D) ─────────────────────────────────────────────

export type {
  GeoLayerDescriptor,
  GeoSourceInventory,
  SourcePlatform,
  ZonageAvailability,
  ZonageQuality,
} from "./source-inventory.js";
export {
  isGeoSourceInventory,
  validateInventories,
} from "./source-inventory.js";

export type {
  CityRef,
  CoverageReport,
  RecenseCkanOptions,
  RecenseCkanResult,
} from "./recense-ckan.js";
export { recenseCkanZonage } from "./recense-ckan.js";

export type {
  PlatformDetectionResult,
  RecensePlatformOptions,
} from "./recense-platform.js";
export { recensePlatform } from "./recense-platform.js";
