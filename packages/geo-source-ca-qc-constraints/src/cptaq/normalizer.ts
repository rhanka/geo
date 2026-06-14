/**
 * Normalizer for the **CPTAQ zone agricole** source (`ca-qc/cptaq-zone-agricole`).
 * Maps each agricultural-zone polygon (acquired from the transposed SHP layer
 * `zone_agricole_s`, reprojected to WGS84 GeoJSON) onto the standard
 * {@link AdminProperties} model.
 *
 * Per feature it sets:
 *   - `geoId      = makeGeoId("ca","qc","cptaq-zone-agricole", <id>)` where `<id>`
 *     is the feature id (the SHP layer carries no stable code; we fall back to the
 *     GeoJSON `feature.id` then to a positional id),
 *   - `name       = Mrc` (the only descriptive field on `zone_agricole_s`) or the id,
 *   - `code       = <id>` (the same surrogate id used in the geoId tail),
 *   - `level      = "locality"` (geo-core has no thematic-constraint level; the
 *     constraint nature is carried by `constraint`), `country = "CA"`,
 *   - `constraint = "cptaq-zone-agricole"` — tags the feature as a thematic
 *     constraint surface rather than an administrative unit.
 *
 * Observed `zone_agricole_s` fields (spike Field Inventory): `Mrc`, `Date_maj`,
 * `Zonage`. All original attributes are preserved.
 */

import type {
  AdminFeature,
  AdminFeatureCollection,
  AdminProperties,
  Feature,
  Geometry,
  GeoJsonProperties,
} from "@sentropic/geo-core";
import { isFeatureCollection, makeGeoId } from "@sentropic/geo-core";
import { featuresToCollection, type Normalizer } from "@sentropic/geo-acquire";

/** Constraint tag stamped on every CPTAQ feature. */
export const CPTAQ_CONSTRAINT = "cptaq-zone-agricole";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Non-empty trimmed string (or stringified finite number) at `props[key]`. */
function str(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Normalizer for CPTAQ agricultural-zone polygons. Validates the raw payload is a
 * GeoJSON FeatureCollection (ogr2ogr emits one from the SHP) and maps each feature
 * onto {@link AdminProperties}, tagging it `constraint: "cptaq-zone-agricole"`.
 */
export const cptaqNormalizer: Normalizer = (raw, ctx): AdminFeatureCollection => {
  if (!isFeatureCollection(raw)) {
    throw new Error(
      `ca-qc/cptaq-zone-agricole normalize: expected a GeoJSON FeatureCollection ` +
        `for dataset "${ctx.dataset.id}", got ${typeof raw}.`,
    );
  }

  const features: AdminFeature[] = raw.features.map(
    (feature: Feature<Geometry | null, GeoJsonProperties>, index): AdminFeature => {
      const source = asRecord(feature.properties) ?? {};

      // The transposed layer carries no stable code; derive a surrogate id from
      // the GeoJSON feature id (when present) then from the position.
      const featureId =
        feature.id !== undefined ? String(feature.id) : `feature-${index}`;
      const code = str(source, "Id") ?? featureId;
      const name = str(source, "Mrc") ?? code;

      const geoId = makeGeoId("ca", "qc", CPTAQ_CONSTRAINT, code);

      const props: AdminProperties = {
        ...source,
        geoId,
        name,
        code,
        level: "locality",
        country: "CA",
        constraint: CPTAQ_CONSTRAINT,
      };

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
