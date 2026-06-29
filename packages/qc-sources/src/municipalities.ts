/**
 * Quebec municipality reference data and priority helper.
 *
 * Data sources:
 *   - Coordinates: GeoNames.org Canada dump (CC BY 4.0)
 *     http://download.geonames.org/export/dump/CA.zip
 *     (feature class A, feature code ADM3, admin1=10 for Québec;
 *      admin3Code joined to MAMH mcode for MRC and population)
 *   - Population + MRC: MAMH Répertoire des municipalités (CC BY 4.0)
 *     https://donneesouvertes.affmunqc.net/repertoire/MUN.csv
 *   - Distance: haversine from Montréal centre (45.5019, -73.5674)
 */

import type { MunicipalityT, PrioritizedCitiesOptionsT } from "./domain.js";
import rawData from "./geo/municipalities.qc.json" assert { type: "json" };

/**
 * Full sorted list of Québec municipalities (1 106 entries).
 * Ordered by priorityRank ascending (distance to Montréal),
 * with excluded municipalities (Montréal, Laval) appended last.
 *
 * Cast is safe: the JSON was generated from the same Zod schema fields.
 */
export const QC_MUNICIPALITIES: readonly MunicipalityT[] =
  rawData as unknown as MunicipalityT[];

/**
 * Return municipalities eligible for active scraping, ordered by
 * priority rank (closest to Montréal first).
 *
 * - Always excludes Montréal and Laval (excluded: true).
 * - Excludes deprioritized municipalities (pop > 100 000) unless
 *   `includeLargePop: true` is passed.
 * - Optionally constrains by `maxKm` radius from Montréal.
 *
 * @example
 * // All municipalities in the 50 km belt
 * const ring50 = prioritizedCities({ maxKm: 50 });
 *
 * @example
 * // All QC municipalities including large cities
 * const all = prioritizedCities({ includeLargePop: true });
 */
export function prioritizedCities(
  options: Partial<PrioritizedCitiesOptionsT> = {}
): MunicipalityT[] {
  const { maxKm, includeLargePop = false } = options;

  return QC_MUNICIPALITIES.filter((m) => {
    if (m.excluded) return false;
    if (!includeLargePop && m.deprioritized) return false;
    if (maxKm !== undefined && m.distanceToMtlKm > maxKm) return false;
    return true;
  });
  // Already sorted by priorityRank; filter preserves order.
}
