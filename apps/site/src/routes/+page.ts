import { loadCatalog } from "$lib/catalog";
import type { PageLoad } from "./$types";

/**
 * Catalogue page data. Reads the OGC API `/collections` (via `loadCatalog`),
 * falling back to the bundled snapshot when the API is unreachable — so the
 * page prerenders cleanly with no live backend.
 */
export const load: PageLoad = async ({ fetch }) => {
  const { datasets, source } = await loadCatalog(fetch);
  return {
    source,
    datasets: datasets.map((entry) => ({
      id: entry.id,
      title: entry.title,
      license: entry.license,
      attribution: entry.attribution,
      count: entry.count,
    })),
  };
};
