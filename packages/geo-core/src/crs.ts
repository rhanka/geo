/**
 * Coordinate Reference System helpers. GeoJSON output is always WGS84 (RFC 7946);
 * source datasets frequently use other CRS and must be reprojected on acquisition.
 */

export type CrsCode = `EPSG:${number}`;

/** GeoJSON / WGS84 — the only CRS valid in emitted GeoJSON (RFC 7946 §4). */
export const WGS84: CrsCode = "EPSG:4326";
/** Web Mercator — common for web/tiles and ArcGIS services. */
export const WEB_MERCATOR: CrsCode = "EPSG:3857";
/** NAD83 geographic — common base for Canadian datasets. */
export const NAD83: CrsCode = "EPSG:4269";
/** NAD83 / Québec Lambert — projection of Données Québec SDA files. */
export const QUEBEC_LAMBERT: CrsCode = "EPSG:32198";

/**
 * Normalize a CRS identifier to canonical `EPSG:<code>` form.
 * Accepts `"EPSG:4326"`, `"4326"`, `"urn:ogc:def:crs:EPSG::4326"`,
 * `"http://www.opengis.net/def/crs/EPSG/0/4326"`, and the GeoJSON aliases
 * `"CRS84"` / `"OGC:CRS84"` (→ EPSG:4326). Returns `null` if unrecognized.
 */
export function normalizeCrsCode(input: string): CrsCode | null {
  const value = input.trim();
  if (/^(ogc:)?crs84$/i.test(value)) return WGS84;
  if (/^\d+$/.test(value)) return `EPSG:${Number(value)}`;
  const epsg = value.match(/^epsg:(\d+)$/i);
  if (epsg?.[1]) return `EPSG:${Number(epsg[1])}`;
  const urn = value.match(/(?:urn:ogc:def:crs:)?epsg:?:?(\d+)$/i);
  if (urn?.[1]) return `EPSG:${Number(urn[1])}`;
  const url = value.match(/\/crs\/epsg\/\d+\/(\d+)$/i);
  if (url?.[1]) return `EPSG:${Number(url[1])}`;
  return null;
}

/** True when the CRS is WGS84 (the GeoJSON default), under any accepted spelling. */
export function isWgs84(input: string): boolean {
  return normalizeCrsCode(input) === WGS84;
}
