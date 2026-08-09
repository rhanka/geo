/** Construction déterministe d'une requête ArcGIS dont l'URL peut être une preuve. */
export interface ArcGisGeoJsonQueryOptions {
  /** Clause SQL ArcGIS. Omettre conserve le comportement mono-muni (`1=1`). */
  where?: string;
  resultOffset?: number;
  resultRecordCount?: number;
}

/**
 * Normalise la clause avant de la mettre dans l'URL. Une clause vide serait
 * indistinguable d'un filtre involontairement omis : c'est un refus dur.
 */
export function normalizeArcGisWhere(where: string | undefined): string {
  if (where === undefined) return "1=1";
  const normalized = where.trim();
  if (!normalized) throw new Error("--where ne peut pas être vide");
  return normalized;
}

/** Encodage de composant strict : l'apostrophe fait partie des octets de l'URL prouvée. */
function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * URL ArcGIS GeoJSON stable. Cette même URL est passée à capturedFetch et,
 * pour une capture mono-page, devient `proof.geometry_source.url`.
 */
export function buildArcGisGeoJsonQueryUrl(
  layer: string,
  fields: readonly string[],
  options: ArcGisGeoJsonQueryOptions = {},
): string {
  const outFields = [...new Set(fields)].join(",");
  const where = normalizeArcGisWhere(options.where);
  const page = options.resultOffset === undefined && options.resultRecordCount === undefined
    ? ""
    : `&resultOffset=${options.resultOffset ?? 0}&resultRecordCount=${options.resultRecordCount ?? 1000}`;
  return `${layer}/query?where=${encodeQueryComponent(where)}&outFields=${encodeQueryComponent(outFields)}&outSR=4326&geometryPrecision=6${page}&f=geojson`;
}
