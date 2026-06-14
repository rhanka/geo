/**
 * @sentropic/geo/catalog — the aggregated source inventory.
 *
 * `buildInventory(registries)` projects continent {@link SourceRegistry}s onto a
 * stable, denormalized {@link InventoryEntry} list (ADR-0017). The engine never
 * statically imports source packages; the inventory is injected.
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
