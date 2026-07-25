/**
 * Normalizer for the **BDZI flood-zones** source (`ca-qc/bdzi-flood-zones`).
 * Maps each flood-zone polygon (ArcGIS REST layer 22, `f=geojson`, `outSR=4326`)
 * onto the standard {@link AdminProperties} model.
 *
 * Per feature it sets:
 *   - `geoId      = makeGeoId("ca","qc","bdzi-flood-zones", OBJECTID)` (the ArcGIS
 *     object id is the only stable per-feature key; falls back to `feature.id`
 *     then to a positional id),
 *   - `name       = Description` (the flood-zone class, e.g. "Zone de grand
 *     courant") or the report name `Nm_rapport`, else the id,
 *   - `code       = OBJECTID` (the surrogate id used in the geoId tail),
 *   - `level      = "locality"`, `country = "CA"`,
 *   - `constraint = "bdzi-flood-zones"`.
 *
 * Observed REST fields (spike Field Inventory + Phase-3 polygon table):
 *   `OBJECTID`, `Description`, `No_rapport`, `Nm_rapport`. All original
 *   attributes are preserved.
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
import { featuresToCollection, type Normalizer } from "@sentropic/geo-core";

/** Constraint tag stamped on every BDZI feature. */
export const BDZI_CONSTRAINT = "bdzi-flood-zones";

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
 * Normalizer for BDZI flood-zone polygons. Validates the raw payload is a GeoJSON
 * FeatureCollection (ArcGIS `f=geojson`) and maps each feature onto
 * {@link AdminProperties}, tagging it `constraint: "bdzi-flood-zones"`.
 */
export const bdziNormalizer: Normalizer = (raw, ctx): AdminFeatureCollection => {
  if (!isFeatureCollection(raw)) {
    throw new Error(
      `ca-qc/bdzi-flood-zones normalize: expected a GeoJSON FeatureCollection ` +
        `for dataset "${ctx.dataset.id}", got ${typeof raw}.`,
    );
  }

  const features: AdminFeature[] = raw.features.map(
    (feature: Feature<Geometry | null, GeoJsonProperties>, index): AdminFeature => {
      const source = asRecord(feature.properties) ?? {};

      const objectId =
        str(source, "OBJECTID") ??
        (feature.id !== undefined ? String(feature.id) : `feature-${index}`);
      const name =
        str(source, "Description") ?? str(source, "Nm_rapport") ?? objectId;

      const geoId = makeGeoId("ca", "qc", BDZI_CONSTRAINT, objectId);

      const props: AdminProperties = {
        ...source,
        geoId,
        name,
        code: objectId,
        level: "locality",
        country: "CA",
        constraint: BDZI_CONSTRAINT,
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
