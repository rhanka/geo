/**
 * Referential normalizer mapping raw Statistics Canada FSA boundary GeoJSON
 * (reprojected from the zipped shapefile by GDAL) onto the
 * {@link ReferentialProperties} model — **geometry is kept** (each FSA is a
 * polygon), so the emitted collection is a {@link ReferentialFeatureCollection}.
 *
 * Per feature the normalizer:
 *   - validates the raw payload is a GeoJSON FeatureCollection,
 *   - reads the pinned FSA field names (see ./manifest.ts): `CFSAUID` (the
 *     3-character FSA, the natural key) and `PRUID` (parent province/territory),
 *   - sets `country:"CA"`, `fsa` (CFSAUID), `province` (PRUID),
 *   - derives a stable `geoId = makeGeoId("ca","fsa",<CFSAUID>)`,
 *   - sets `iso` (ISO 3166-2 `CA-<abbrev>`) from the PRUID when known,
 *   - preserves all original FSA attributes (CFSAUID, DGUID, PRUID, PRNAME,
 *     LANDAREA, …) and the polygon geometry.
 *
 * Unlike an administrative {@link Normalizer}, this returns a
 * {@link ReferentialFeatureCollection}: FSAs are a postal geography, not an
 * administrative unit, so they carry no `name`/`level`. geo-acquire wires this via
 * its `referentialNormalizer` option (geometry-bearing referential path).
 */

import type {
  Feature,
  Geometry,
  GeoJsonProperties,
  ReferentialFeature,
  ReferentialFeatureCollection,
  ReferentialProperties,
} from "@sentropic/geo-core";
import { isFeatureCollection, makeGeoId } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-core";

/**
 * PRUID → ISO 3166-2 postal abbreviation. The ISO subdivision code is
 * `CA-<abbrev>`. Statistics Canada PRUIDs are stable 2-digit codes (mirrors the
 * map pinned in `@sentropic/geo-source-ca`; inlined here so this postal package
 * stays self-contained, depending only on geo-core + geo-acquire).
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

/** geoId for a Forward Sortation Area: `ca/fsa/<CFSAUID>`. */
export function fsaGeoId(cfsauid: string): string {
  return makeGeoId("ca", "fsa", cfsauid);
}

/**
 * Referential normalizer for the FSA layer. Maps the StatCan FSA fields onto
 * {@link ReferentialProperties}, preserving the original attributes **and the
 * polygon geometry**. Returns a {@link ReferentialFeatureCollection}, wired into
 * `acquire(..., { referentialNormalizer })`.
 */
export const fsaReferentialNormalizer = (
  raw: unknown,
  ctx: NormalizeContext,
): ReferentialFeatureCollection => {
  if (!isFeatureCollection(raw)) {
    throw new Error(
      `ca/statcan-fsa normalize: expected a GeoJSON FeatureCollection for ` +
        `dataset "${ctx.dataset.id}", got ${typeof raw}.`,
    );
  }

  const features: ReferentialFeature[] = raw.features.map(
    (feature: Feature<Geometry | null, GeoJsonProperties>, index): ReferentialFeature => {
      const source = asRecord(feature.properties) ?? {};

      const fsa = str(source, "CFSAUID");
      const province = str(source, "PRUID");
      const geoId = fsaGeoId(fsa ?? `feature-${index}`);

      // Preserve all original FSA attributes, then layer the referential keys.
      const props: ReferentialProperties = {
        ...source,
        geoId,
        country: "CA",
      };
      if (fsa !== undefined) props.fsa = fsa;
      if (province !== undefined) {
        props.province = province;
        const iso = isoForPruid(province);
        if (iso !== undefined) props.iso = iso;
      }

      const out: ReferentialFeature = {
        type: "Feature",
        geometry: feature.geometry,
        properties: props,
      };
      if (feature.id !== undefined) out.id = feature.id;
      else out.id = geoId;
      if (feature.bbox !== undefined) out.bbox = feature.bbox;
      return out;
    },
  );

  return { type: "FeatureCollection", features };
};
