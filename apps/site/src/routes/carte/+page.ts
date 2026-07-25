import { isFeatureCollection } from "@sentropic/geo-core";
import type { AdminFeatureCollection } from "@sentropic/geo-core";
import { itemsUrlWithLimit, loadCatalog, type CatalogEntry } from "$lib/catalog";
import type { PageLoad } from "./$types";

// Client-only: the map needs WebGL and the GeoJSON is fetched live from the OGC
// API at runtime. With adapter-static's SPA fallback (200.html), /carte resolves
// client-side, so the build succeeds with no live API and no data files present.
export const prerender = false;
export const ssr = false;

/** Collection chosen by default when no `?collection=` is supplied. */
const DEFAULT_COLLECTION = "qc-regions";

/** Pick the entry to map: the `?collection=` one, else the default, else first. */
function pickEntry(
  datasets: CatalogEntry[],
  requested: string | null,
): CatalogEntry | undefined {
  if (requested) {
    const found = datasets.find((d) => d.id === requested);
    if (found) return found;
  }
  return datasets.find((d) => d.id === DEFAULT_COLLECTION) ?? datasets[0];
}

/**
 * Load the catalog (for the collection picker) and the selected collection's
 * GeoJSON items, fetched with an EXPLICIT `?limit` (ADR-0015 — avoids the OGC
 * `/items` default-100 truncation). Degrades gracefully: an unreachable API
 * leaves `collection` null and the page shows the empty-state.
 */
export const load: PageLoad = async ({ url, fetch }) => {
  const { datasets } = await loadCatalog(fetch);
  const requested = url.searchParams.get("collection");
  const entry = pickEntry(datasets, requested);

  // Datasets the picker offers (all that advertise a spatial extent / geometry).
  const choices = datasets.map((d) => ({ id: d.id, title: d.title }));

  let collection: AdminFeatureCollection | null = null;
  let dataError: string | null = null;

  if (entry) {
    try {
      const res = await fetch(itemsUrlWithLimit(entry.itemsUrl), {
        headers: { accept: "application/geo+json, application/json" },
      });
      if (res.ok) {
        const json: unknown = await res.json();
        if (isFeatureCollection(json)) {
          collection = json as AdminFeatureCollection;
        } else {
          dataError = "La réponse du service n'est pas une FeatureCollection GeoJSON valide.";
        }
      } else if (res.status !== 404) {
        dataError = `Le service de données a répondu ${res.status}.`;
      }
    } catch {
      // Network/parse failure (no live API): degrade to the empty-state.
      collection = null;
      dataError = null;
    }
  }

  return {
    choices,
    selected: entry ? { id: entry.id, title: entry.title, attribution: entry.attribution } : null,
    collection,
    dataError,
  };
};
