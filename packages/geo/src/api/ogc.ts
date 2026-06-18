/**
 * OGC API – Features (Part 1: Core) constants and small rendering helpers.
 *
 * References:
 *   - OGC API – Features – Part 1: Core (OGC 17-069r4)
 *   - RFC 7946 (GeoJSON)
 */

import type { CollectionInfo } from "./provider.js";

/** Conformance classes this server implements. */
export const CONFORMANCE_CLASSES = [
  "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core",
  "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/oas30",
  "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson",
] as const;

/** Canonical CRS84 URI — the default (and only) CRS for GeoJSON output. */
export const CRS84_URI = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";

/** OGC media types. */
export const MEDIA_GEOJSON = "application/geo+json";
export const MEDIA_JSON = "application/json";
export const MEDIA_OPENAPI = "application/vnd.oai.openapi+json;version=3.0";

/** An OGC/Atom-style link object. */
export interface Link {
  href: string;
  rel: string;
  type?: string;
  title?: string;
}

/**
 * Resolve the public base URL (scheme + host, no trailing slash) from the
 * request URL, so generated links are absolute and host-accurate behind any
 * mount point.
 */
export function baseUrlOf(requestUrl: string): string {
  const u = new URL(requestUrl);
  return `${u.origin}`;
}

/** OGC collection object rendered for the API from a {@link CollectionInfo}. */
export interface OgcCollection {
  id: string;
  title: string;
  description?: string;
  attribution: string;
  extent?: {
    spatial: { bbox: number[][]; crs: string };
  };
  crs: string[];
  storageCrs: string;
  license?: { title: string; href?: string };
  rights?: CollectionInfo["rights"];
  links: Link[];
}

/** Render a {@link CollectionInfo} into an OGC collection object with links. */
export function renderCollection(info: CollectionInfo, base: string): OgcCollection {
  const self = `${base}/collections/${encodeURIComponent(info.id)}`;
  const links: Link[] = [
    { href: self, rel: "self", type: MEDIA_JSON, title: info.title },
    {
      href: `${self}/items`,
      rel: "items",
      type: MEDIA_GEOJSON,
      title: `${info.title} — features`,
    },
  ];
  if (info.license.url) {
    links.push({
      href: info.license.url,
      rel: "license",
      type: "text/html",
      title: info.license.title,
    });
  }

  return {
    id: info.id,
    title: info.title,
    ...(info.description !== undefined ? { description: info.description } : {}),
    attribution: info.attribution,
    ...(info.extent
      ? {
          extent: {
            spatial: {
              bbox: [[info.extent.bbox[0], info.extent.bbox[1], info.extent.bbox[2], info.extent.bbox[3]]],
              crs: CRS84_URI,
            },
          },
        }
      : {}),
    crs: [CRS84_URI],
    storageCrs: CRS84_URI,
    license: {
      title: info.license.title,
      ...(info.license.url !== undefined ? { href: info.license.url } : {}),
    },
    ...(info.rights ? { rights: info.rights } : {}),
    links,
  };
}
