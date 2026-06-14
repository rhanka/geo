/**
 * @sentropic/geo-sources — aggregated, typed inventory of every geo source.
 *
 * A pure aggregation of each source package's declarative `SourceManifest`
 * (no network, no data): one {@link InventoryEntry} per source with its
 * jurisdiction, resolved license, redistribution flag, attribution and dataset
 * list, plus filtering helpers. Capitalized from immo's GeoSourceInventory
 * (ADR-0013).
 */

export const VERSION = "0.1.0";

export type { InventoryDataset, InventoryEntry } from "./inventory.js";
export {
  INVENTORY,
  allSources,
  byCountry,
  byKind,
  bySourceId,
  datasetsFor,
  redistributableSources,
} from "./inventory.js";
