/**
 * ArcGIS REST FeatureService helpers. Builds a `query` URL that asks the server
 * for WGS84 GeoJSON (`outSR=4326&f=geojson`), so no client-side reprojection is
 * needed for ArcGIS sources.
 */

/** Default query parameters for an ArcGIS `query` request. */
export const ARCGIS_QUERY_DEFAULTS: Record<string, string> = {
  where: "1=1",
  outFields: "*",
  outSR: "4326",
  f: "geojson",
};

/**
 * Build the `query` URL for an ArcGIS REST layer.
 *
 * `<serviceUrl>/<layer>/query?<defaults merged with params>`. Defaults are
 * `where=1=1&outFields=*&outSR=4326&f=geojson`; `params` (typically a dataset's
 * `query`) override them. A trailing slash on `serviceUrl` is tolerated.
 */
export function arcgisQueryUrl(
  serviceUrl: string,
  layer: string | number,
  params: Record<string, string | number | boolean> = {},
): string {
  const base = serviceUrl.replace(/\/+$/, "");
  const search = new URLSearchParams(ARCGIS_QUERY_DEFAULTS);
  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }
  return `${base}/${layer}/query?${search.toString()}`;
}
