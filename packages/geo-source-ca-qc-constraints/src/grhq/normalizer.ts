/**
 * Normalizer for the **GRHQ hydrography** source (`ca-qc/grhq-hydrography`).
 * Maps each hydrographic feature (ArcGIS REST layers 104/101, `f=geojson`,
 * `outSR=4326`) onto the standard {@link AdminProperties} model. The same
 * normalizer serves both the waterbody-surface and the linear-network datasets.
 *
 * Per feature it sets:
 *   - `geoId      = makeGeoId("ca","qc","grhq-hydrography", OBJECTID)` (the ArcGIS
 *     object id is the only stable per-feature key; falls back to `feature.id`
 *     then to a positional id),
 *   - `name       = TOPONYME` / `NOM` when present (most GRHQ elements are
 *     unnamed), else the id,
 *   - `code       = OBJECTID` (the surrogate id used in the geoId tail),
 *   - `level      = "locality"`, `country = "CA"`,
 *   - `constraint = "grhq-hydrography"`.
 *
 * Observed fields (spike Field Inventory + Phase-3 codes): `TYPECE`
 * (hydrographic-element type), `PERENNITE` (P/I). All original attributes are
 * preserved (including `TYPECE`/`PERENNITE`, which downstream riparian-buffer
 * scoring reads).
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

/** Constraint tag stamped on every GRHQ feature. */
export const GRHQ_CONSTRAINT = "grhq-hydrography";

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
 * Normalizer for GRHQ hydrographic features (waterbodies + linear network).
 * Validates the raw payload is a GeoJSON FeatureCollection (ArcGIS `f=geojson`)
 * and maps each feature onto {@link AdminProperties}, tagging it
 * `constraint: "grhq-hydrography"`.
 */
export const grhqNormalizer: Normalizer = (raw, ctx): AdminFeatureCollection => {
  if (!isFeatureCollection(raw)) {
    throw new Error(
      `ca-qc/grhq-hydrography normalize: expected a GeoJSON FeatureCollection ` +
        `for dataset "${ctx.dataset.id}", got ${typeof raw}.`,
    );
  }

  const features: AdminFeature[] = raw.features.map(
    (feature: Feature<Geometry | null, GeoJsonProperties>, index): AdminFeature => {
      const source = asRecord(feature.properties) ?? {};

      const objectId =
        str(source, "OBJECTID") ??
        (feature.id !== undefined ? String(feature.id) : `feature-${index}`);
      const name = str(source, "TOPONYME") ?? str(source, "NOM") ?? objectId;

      const geoId = makeGeoId("ca", "qc", GRHQ_CONSTRAINT, objectId);

      const props: AdminProperties = {
        ...source,
        geoId,
        name,
        code: objectId,
        level: "locality",
        country: "CA",
        constraint: GRHQ_CONSTRAINT,
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
