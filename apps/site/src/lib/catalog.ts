/**
 * Typed catalog of geographic datasets published on geo.sent-tech.ca.
 *
 * This is the data contract for the catalogue and dataset pages. It is
 * statically defined for V1 and may later be generated from the acquisition
 * pipeline's collection metadata (`@sentropic/geo-core` `CollectionMeta`).
 */

import { LICENSES, attributionLine, type License } from "@sentropic/geo-core";

export interface CatalogEntry {
  /** Stable dataset id; also the GeoJSON filename (`static/data/<id>.geojson`). */
  id: string;
  title: string;
  /** Resolved license (carries redistributable / attribution flags). */
  license: License;
  /** Upstream data provider. */
  provider: string;
  /** Ready-to-display attribution line. */
  attribution: string;
  /** Feature count (0 when data is not yet acquired). */
  count: number;
  /** Administrative level label. */
  level: string;
  /** Optional human description. */
  description?: string;
  /** Optional provider homepage. */
  providerUrl?: string;
}

const qcProvider = "Gouvernement du Québec";

export const CATALOG: CatalogEntry[] = [
  {
    id: "ca-qc-regions",
    title: "Régions administratives du Québec",
    license: LICENSES["cc-by-4.0"],
    provider: qcProvider,
    attribution: attributionLine(qcProvider, LICENSES["cc-by-4.0"]),
    count: 17,
    level: "region",
    description:
      "Les 17 régions administratives du Québec, découpage de premier niveau de la hiérarchie infranationale (Canada, ISO CA-QC).",
    providerUrl: "https://www.donneesquebec.ca/",
  },
];

/** Find a catalog entry by its id. */
export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}

/** All dataset ids — used to enumerate prerender entries for `/datasets/[id]`. */
export function catalogIds(): string[] {
  return CATALOG.map((entry) => entry.id);
}
