/**
 * Per-dataset {@link Normalizer}s mapping raw Statistics Canada boundary
 * GeoJSON (reprojected from the zipped shapefiles by GDAL) onto the standard
 * {@link AdminProperties} model.
 *
 * The provinces normalizer:
 *   - validates the raw payload is a GeoJSON FeatureCollection,
 *   - reads the pinned PR field names (see ./manifest.ts) for code/name,
 *   - sets `name` (English), `names:{en,fr}`, `code` (PRUID),
 *     `level` (`"territory"` for the 3 territories, else `"province"`),
 *     `country:"CA"`, `iso` (ISO 3166-2 `CA-XX` from the PRUID), and a canonical
 *     `geoId = makeGeoId("ca","province",<PRUID>)`,
 *   - preserves all original PR attributes (PRUID, DGUID, PRNAME, …).
 *
 * NOTE — census divisions (`ca-census-divisions`) are declared in the manifest
 * for follow-up; {@link censusDivisionsNormalizer} is a best-effort mapping over
 * the CD field names (CDUID/CDNAME/PRUID) but the dataset has not yet been
 * acquired, so the CD normalizer is unverified against real data.
 */

import type {
  AdminFeature,
  AdminFeatureCollection,
  AdminLevel,
  AdminProperties,
  Feature,
  Geometry,
  GeoJsonProperties,
} from "@sentropic/geo-core";
import { isFeatureCollection, makeGeoId } from "@sentropic/geo-core";
import { featuresToCollection, type Normalizer } from "@sentropic/geo-acquire";

/**
 * PRUID → ISO 3166-2 postal abbreviation. The ISO subdivision code is
 * `CA-<abbrev>`. Statistics Canada PRUIDs are stable 2-digit codes.
 */
const PRUID_TO_POSTAL: Readonly<Record<string, string>> = {
  "10": "NL",
  "11": "PE",
  "12": "NS",
  "13": "NB",
  "24": "QC",
  "35": "ON",
  "46": "MB",
  "47": "SK",
  "48": "AB",
  "59": "BC",
  "60": "YT",
  "61": "NT",
  "62": "NU",
};

/** PRUIDs that are territories (not provinces): Yukon, NWT, Nunavut. */
const TERRITORY_PRUIDS: ReadonlySet<string> = new Set(["60", "61", "62"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read a non-empty string (trimmed) or stringified finite number from `props[key]`. */
function str(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** ISO 3166-2 subdivision code for a PRUID, or `undefined` if unknown. */
export function isoForPruid(pruid: string): string | undefined {
  const postal = PRUID_TO_POSTAL[pruid];
  return postal ? `CA-${postal}` : undefined;
}

/** Admin level for a PRUID: `"territory"` for YT/NT/NU, else `"province"`. */
export function levelForPruid(pruid: string): AdminLevel {
  return TERRITORY_PRUIDS.has(pruid) ? "territory" : "province";
}

/**
 * Normalizer for the provinces & territories (PR) layer. Maps the StatCan PR
 * fields onto {@link AdminProperties}, preserving the original attributes.
 */
export const provincesNormalizer: Normalizer = (raw, ctx): AdminFeatureCollection => {
  if (!isFeatureCollection(raw)) {
    throw new Error(
      `ca/statcan-boundaries normalize: expected a GeoJSON FeatureCollection for ` +
        `dataset "${ctx.dataset.id}", got ${typeof raw}.`,
    );
  }

  const features: AdminFeature[] = raw.features.map(
    (feature: Feature<Geometry | null, GeoJsonProperties>, index): AdminFeature => {
      const source = asRecord(feature.properties) ?? {};

      const pruid = str(source, "PRUID");
      const nameEn = str(source, "PRENAME");
      const nameFr = str(source, "PRFNAME");
      const name = nameEn ?? str(source, "PRNAME") ?? pruid ?? `feature-${index}`;

      // `province` is the geoId namespace for all PR units (provinces AND
      // territories) so the federal hierarchy is uniform; `level` distinguishes
      // territories semantically.
      const geoId = makeGeoId("ca", "province", pruid ?? name);
      const level = pruid ? levelForPruid(pruid) : "province";

      const props: AdminProperties = {
        ...source,
        geoId,
        name,
        level,
        country: "CA",
      };
      if (pruid !== undefined) props.code = pruid;
      if (nameEn !== undefined || nameFr !== undefined) {
        const names: Record<string, string> = {};
        if (nameEn !== undefined) names.en = nameEn;
        if (nameFr !== undefined) names.fr = nameFr;
        props.names = names;
      }
      const iso = pruid ? isoForPruid(pruid) : undefined;
      if (iso !== undefined) props.iso = iso;

      const out: AdminFeature = {
        type: "Feature",
        geometry: feature.geometry as Geometry,
        properties: props,
      };
      if (feature.id !== undefined) out.id = feature.id;
      if (feature.bbox !== undefined) out.bbox = feature.bbox;
      return out;
    },
  );

  return featuresToCollection(features);
};

/**
 * Best-effort normalizer for the census divisions (CD) layer. CD fields are
 * `CDUID` (4-digit, PRUID-prefixed), `CDNAME`/`CDNAMEE`/`CDNAMEF`, and `PRUID`
 * (parent). `geoId = makeGeoId("ca","county",<CDUID>)`; parent province geoId is
 * derived from PRUID. Unverified against real data — the CD dataset is declared
 * for follow-up (see ./manifest.ts).
 */
export const censusDivisionsNormalizer: Normalizer = (raw, ctx): AdminFeatureCollection => {
  if (!isFeatureCollection(raw)) {
    throw new Error(
      `ca/statcan-boundaries normalize: expected a GeoJSON FeatureCollection for ` +
        `dataset "${ctx.dataset.id}", got ${typeof raw}.`,
    );
  }

  const features: AdminFeature[] = raw.features.map(
    (feature: Feature<Geometry | null, GeoJsonProperties>, index): AdminFeature => {
      const source = asRecord(feature.properties) ?? {};

      const cduid = str(source, "CDUID");
      const nameEn = str(source, "CDNAMEE") ?? str(source, "CDNAME");
      const nameFr = str(source, "CDNAMEF");
      const name = nameEn ?? str(source, "CDNAME") ?? cduid ?? `feature-${index}`;
      const pruid = str(source, "PRUID");

      const geoId = makeGeoId("ca", "county", cduid ?? name);

      const props: AdminProperties = {
        ...source,
        geoId,
        name,
        level: "county",
        country: "CA",
      };
      if (cduid !== undefined) props.code = cduid;
      if (nameEn !== undefined || nameFr !== undefined) {
        const names: Record<string, string> = {};
        if (nameEn !== undefined) names.en = nameEn;
        if (nameFr !== undefined) names.fr = nameFr;
        props.names = names;
      }
      if (pruid !== undefined) {
        props.parentGeoId = makeGeoId("ca", "province", pruid);
        const iso = isoForPruid(pruid);
        if (iso !== undefined) props.iso = iso;
      }

      const out: AdminFeature = {
        type: "Feature",
        geometry: feature.geometry as Geometry,
        properties: props,
      };
      if (feature.id !== undefined) out.id = feature.id;
      if (feature.bbox !== undefined) out.bbox = feature.bbox;
      return out;
    },
  );

  return featuresToCollection(features);
};
