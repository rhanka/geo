import { buildInventory } from "@sentropic/geo/catalog";
import { registry as americas } from "@sentropic/geo-sources-americas";
import { registry as europe } from "@sentropic/geo-sources-europe";
import type { PageLoad } from "./$types";

/**
 * Source catalog page data. Built via `buildInventory(registries)` from the
 * continent source libraries (ADR-0017) — static, denormalized metadata (no
 * API, no network), so the page prerenders with no live backend. Projects each
 * {@link InventoryEntry} onto a serializable view model for the FR catalogue
 * page.
 */
export const load: PageLoad = () => {
  const inventory = buildInventory([americas, europe]);
  const sources = inventory.map((entry) => ({
    sourceId: entry.sourceId,
    title: entry.title,
    kind: entry.kind,
    country: entry.jurisdiction.country,
    subdivision: entry.jurisdiction.subdivision,
    level: entry.jurisdiction.level,
    license: {
      id: entry.license.id,
      title: entry.license.title,
      url: entry.license.url,
      redistributable: entry.license.redistributable,
    },
    attribution: entry.attribution,
    datasets: entry.datasets.map((d) => ({
      id: d.id,
      title: d.title,
      format: d.format,
      adminLevel: d.adminLevel,
    })),
  }));
  return { sources };
};
