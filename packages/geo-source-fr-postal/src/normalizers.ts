/**
 * CSV normalizer mapping La Poste « Base officielle des codes postaux » rows onto
 * the {@link ReferentialProperties} model (all features carry `geometry: null`).
 *
 * Each row is a (postal code × INSEE commune) pair. The normalizer:
 *   - reads `Code_commune_INSEE` (tolerating the upstream leading `#` on the
 *     header), `Code_postal`, `Nom_de_la_commune`, `Libellé_d_acheminement`,
 *     `Ligne_5`,
 *   - sets `country:"FR"`, `postalCode`, `inseeCode`, `communeName`, and
 *     `libelle` / `ligne5` when present,
 *   - derives a stable, unique `geoId = makeGeoId("fr","cp",<postalCode>,
 *     <inseeCode>)`,
 *   - preserves all original CSV columns,
 *   - skips blank rows (no postal code and no INSEE code).
 */

import type {
  ReferentialFeature,
  ReferentialFeatureCollection,
} from "@sentropic/geo-core";
import { makeGeoId } from "@sentropic/geo-core";
import type { CsvNormalizer } from "@sentropic/geo-acquire";

import { CP_COLUMNS } from "./manifest.js";

/** Read a trimmed, non-empty value from the first matching source column. */
function pick(row: Record<string, string>, ...columns: string[]): string | undefined {
  for (const column of columns) {
    const value = row[column];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

/** geoId for a (postal code × INSEE commune) pair: `fr/cp/<postal>/<insee>`. */
export function postalGeoId(postalCode: string, inseeCode: string): string {
  return makeGeoId("fr", "cp", postalCode, inseeCode);
}

/**
 * Normalize parsed La Poste codes-postaux rows into a
 * {@link ReferentialFeatureCollection} of null-geometry features. Blank rows
 * (missing both a postal code and an INSEE code) are dropped.
 */
export const codesPostauxNormalizer: CsvNormalizer = (
  rows,
): ReferentialFeatureCollection => {
  const features: ReferentialFeature[] = [];

  for (const row of rows) {
    const inseeCode = pick(row, CP_COLUMNS.inseeCode, CP_COLUMNS.inseeCodeHash);
    const postalCode = pick(row, CP_COLUMNS.postalCode);

    // Skip structurally empty rows (e.g. a trailing blank line).
    if (inseeCode === undefined && postalCode === undefined) continue;

    const communeName = pick(row, CP_COLUMNS.communeName);
    const libelle = pick(row, CP_COLUMNS.libelle);
    const ligne5 = pick(row, CP_COLUMNS.ligne5);

    // Preserve all original columns, then layer the normalized keys on top.
    const properties: ReferentialFeature["properties"] = {
      ...row,
      country: "FR",
    };
    if (postalCode !== undefined) properties.postalCode = postalCode;
    if (inseeCode !== undefined) properties.inseeCode = inseeCode;
    if (communeName !== undefined) properties.communeName = communeName;
    if (libelle !== undefined) properties.libelle = libelle;
    if (ligne5 !== undefined) properties.ligne5 = ligne5;

    const geoId = postalGeoId(postalCode ?? "", inseeCode ?? "");
    properties.geoId = geoId;

    const feature: ReferentialFeature = {
      type: "Feature",
      id: geoId,
      geometry: null,
      properties,
    };
    features.push(feature);
  }

  return { type: "FeatureCollection", features };
};
