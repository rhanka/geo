import { error } from "@sveltejs/kit";
import { isFeatureCollection } from "@sentropic/geo-core";
import type { AdminFeatureCollection } from "@sentropic/geo-core";
import { loadCatalogEntry } from "$lib/catalog";
import type { PageLoad } from "./$types";

// This route is NOT prerendered: the dataset GeoJSON is fetched at runtime in
// the browser from the live OGC API. With adapter-static's SPA fallback
// (200.html), any /datasets/<id> resolves client-side, so the build succeeds
// with no live API and no data files present.
export const prerender = false;
export const ssr = false;

/**
 * Load a dataset's metadata (from the catalog / OGC `/collections`) and its
 * GeoJSON features (from `GET {API}/collections/{id}/items`). The items fetch
 * runs in the browser and degrades gracefully: a missing/unreachable API leaves
 * `collection` null and the page shows an empty-state. Never fails the build.
 */
export const load: PageLoad = async ({ params, fetch }) => {
  const entry = await loadCatalogEntry(params.id, fetch);
  if (!entry) {
    throw error(404, `Jeu de données inconnu : ${params.id}`);
  }

  let collection: AdminFeatureCollection | null = null;
  let dataError: string | null = null;

  try {
    const res = await fetch(entry.itemsUrl, {
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
    // 404 → collection stays null → graceful empty-state, no error surfaced.
  } catch {
    // Network/parse failure (no live API): degrade to the empty-state.
    dataError = null;
    collection = null;
  }

  const count = collection?.features.length ?? entry.count;

  return {
    entry: {
      id: entry.id,
      title: entry.title,
      license: entry.license,
      attribution: entry.attribution,
      count,
      description: entry.description,
    },
    collection,
    dataError,
  };
};
