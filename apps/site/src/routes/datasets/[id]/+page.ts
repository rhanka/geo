import { error } from "@sveltejs/kit";
import { isFeatureCollection, type FeatureCollection } from "@sentropic/geo-core";
import { catalogIds, getCatalogEntry } from "$lib/catalog";
import type { EntryGenerator, PageLoad } from "./$types";

export const prerender = true;

/** Enumerate dataset ids so adapter-static can prerender each page. */
export const entries: EntryGenerator = () => catalogIds().map((id) => ({ id }));

/**
 * Load a dataset's metadata + its GeoJSON. The data is served as a static file
 * (`/data/<id>.geojson`); when set, `PUBLIC_GEO_API_URL` is used to fetch live
 * from the geo-api OGC endpoint instead. Either source may be absent — the page
 * degrades gracefully (no map, "données en cours d'acquisition" empty-state).
 */
export const load: PageLoad = async ({ params, fetch }) => {
  const entry = getCatalogEntry(params.id);
  if (!entry) {
    throw error(404, `Jeu de données inconnu : ${params.id}`);
  }

  const apiBase = import.meta.env.PUBLIC_GEO_API_URL as string | undefined;
  const url = apiBase
    ? `${apiBase.replace(/\/$/, "")}/collections/${entry.id}/items`
    : `/data/${entry.id}.geojson`;

  let collection: FeatureCollection | null = null;
  let dataError: string | null = null;

  try {
    const res = await fetch(url);
    if (res.ok) {
      const json: unknown = await res.json();
      if (isFeatureCollection(json)) {
        collection = json;
      } else {
        dataError = "Le fichier de données n'est pas une FeatureCollection GeoJSON valide.";
      }
    } else if (res.status !== 404) {
      dataError = `Le service de données a répondu ${res.status}.`;
    }
    // 404 → collection stays null → graceful empty-state, no error surfaced.
  } catch {
    // Network/parse failure: degrade gracefully, never fail the build.
    dataError = null;
    collection = null;
  }

  return {
    entry: {
      id: entry.id,
      title: entry.title,
      license: entry.license,
      provider: entry.provider,
      providerUrl: entry.providerUrl,
      attribution: entry.attribution,
      count: entry.count,
      level: entry.level,
      description: entry.description,
    },
    collection,
    dataError,
    source: apiBase ? "api" : "static",
  };
};
