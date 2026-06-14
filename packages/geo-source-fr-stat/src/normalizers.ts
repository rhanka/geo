/**
 * CSV normalizer mapping raw INSEE COG commune rows onto the standard
 * {@link ReferentialProperties} model (null-geometry referential features).
 *
 * Each kept row (`TYPECOM === "COM"`):
 *   - sets `country: "FR"`, `code: <COM>`, `name: <LIBELLE>`,
 *   - keeps `departement: <DEP>` and `region: <REG>`,
 *   - sets a canonical `geoId = makeGeoId("fr","commune",<COM>)`,
 *   - derives `parentGeoId = makeGeoId("fr","department",<DEP>)` when DEP present,
 *   - preserves every original COG column (TYPECOM, NCC, NCCENR, CAN, …).
 *
 * Rows whose TYPECOM is not `COM` (ARM municipal arrondissements, COMA/COMD
 * associated/delegated communes) are filtered out: they are sub-commune entries
 * with empty REG/DEP, not communes proper.
 */

import type {
  ReferentialFeature,
  ReferentialFeatureCollection,
} from "@sentropic/geo-core";
import { makeGeoId } from "@sentropic/geo-core";
import type { CsvNormalizer } from "@sentropic/geo-acquire";

/** Trim a CSV cell and return it only when non-empty. */
function cell(row: Record<string, string>, key: string): string | undefined {
  const value = row[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

/** geoId for a French commune by its INSEE code. */
function communeGeoId(code: string): string {
  return makeGeoId("fr", "commune", code);
}

/** geoId for a French département by its code. */
function departmentGeoId(dep: string): string {
  return makeGeoId("fr", "department", dep);
}

/**
 * Normalizer for the INSEE COG `fr-cog-communes` CSV. Filters to actual
 * communes (`TYPECOM === "COM"`) and maps each onto a null-geometry
 * {@link ReferentialFeature}, preserving the original COG columns.
 */
export const communesNormalizer: CsvNormalizer = (
  rows: Record<string, string>[],
): ReferentialFeatureCollection => {
  const features: ReferentialFeature[] = [];

  for (const row of rows) {
    if (cell(row, "TYPECOM") !== "COM") continue;

    const code = cell(row, "COM");
    if (code === undefined) continue;

    const name = cell(row, "LIBELLE") ?? cell(row, "NCCENR") ?? code;
    const dep = cell(row, "DEP");
    const reg = cell(row, "REG");
    const geoId = communeGeoId(code);

    const properties: ReferentialFeature["properties"] = {
      ...row,
      country: "FR",
      code,
      name,
      geoId,
    };
    if (dep !== undefined) {
      properties["departement"] = dep;
      properties["parentGeoId"] = departmentGeoId(dep);
    }
    if (reg !== undefined) properties["region"] = reg;

    features.push({ type: "Feature", id: geoId, geometry: null, properties });
  }

  return { type: "FeatureCollection", features };
};

/** Normalizers keyed by dataset id, ready to pass to `acquire(..., { csvNormalizer })`. */
export const normalizers = {
  "fr-cog-communes": communesNormalizer,
} as const;
