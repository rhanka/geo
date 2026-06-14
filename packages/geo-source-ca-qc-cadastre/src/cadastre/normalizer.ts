/**
 * Normalizer for the **Cadastre allégé du Québec** source (`ca-qc/cadastre`).
 * Maps each cadastral-lot polygon (acquired from MapServer layer 0, reprojected
 * to WGS84 GeoJSON) onto the standard {@link AdminProperties} model.
 *
 * Per feature it sets:
 *   - `geoId = makeGeoId("ca","qc","lot", <noLot>)` — the canonical lot id, e.g.
 *     `NO_LOT "4 516 943"` → `"ca/qc/lot/4-516-943"` (makeGeoId slugifies the
 *     spaces). `NO_LOT` is the sole verified field on the cadastre allégé layer.
 *   - `name  = <noLot>` (the lot number, preserved verbatim incl. spaces),
 *   - `code  = <noLot>` (the public cadastral lot code),
 *   - `level = "locality"` (a lot is the finest public parcel referential),
 *     `country = "CA"`,
 *   - `noLot = <noLot>` (explicit, verbatim, matching immo's `lots.ts` output),
 *   - `municipalityCode` — set **only** when the feature genuinely carries a
 *     municipality attribute (anti-invention: the cadastre allégé layer is not
 *     known to expose one, so this never fabricates a value; it is mapped
 *     opportunistically if a `CO_MUNCP`/`NO_MUNCP`/`MUNICIPALITE` field appears).
 *
 * Loi 25 / anti-PII: the cadastre allégé carries no owner data; only the public
 * lot identifier (and, when present, a municipality code) is mapped. All
 * original feature attributes are preserved on the output properties.
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

/** geoId segment for a cadastral lot (`ca/qc/lot/<noLot>`). */
export const CADASTRE_GEOID_KIND = "lot";

/** Field carrying the public cadastral lot number on the cadastre allégé layer. */
export const NO_LOT_FIELD = "NO_LOT";

/**
 * Candidate municipality-code fields, in priority order. The cadastre allégé
 * layer is not known to expose any of these — they are probed defensively so a
 * municipality code is carried through *iff* the upstream payload actually has
 * one, never invented.
 */
export const MUNICIPALITY_CODE_FIELDS = [
  "CO_MUNCP",
  "NO_MUNCP",
  "MUNICIPALITE",
  "CODE_MUN",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Trimmed non-empty string (or stringified finite number) at `props[key]`. */
function str(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** First present municipality code among the candidate fields, if any. */
function pickMunicipalityCode(props: Record<string, unknown>): string | undefined {
  for (const field of MUNICIPALITY_CODE_FIELDS) {
    const value = str(props, field);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Normalizer for cadastre-allégé lot polygons. Validates the raw payload is a
 * GeoJSON FeatureCollection (ArcGIS `f=geojson` / ogr2ogr emit one) and maps each
 * feature onto {@link AdminProperties}, keyed by `NO_LOT`.
 */
export const cadastreNormalizer: Normalizer = (
  raw,
  ctx,
): AdminFeatureCollection => {
  if (!isFeatureCollection(raw)) {
    throw new Error(
      `ca-qc/cadastre normalize: expected a GeoJSON FeatureCollection for ` +
        `dataset "${ctx.dataset.id}", got ${typeof raw}.`,
    );
  }

  const features: AdminFeature[] = raw.features.map(
    (
      feature: Feature<Geometry | null, GeoJsonProperties>,
      index,
    ): AdminFeature => {
      const source = asRecord(feature.properties) ?? {};

      // NO_LOT is the canonical lot id (verbatim, spaces preserved). Fall back to
      // the GeoJSON feature id then position so a malformed feature still maps.
      const noLot =
        str(source, NO_LOT_FIELD) ??
        (feature.id !== undefined ? String(feature.id) : `lot-${index}`);

      const geoId = makeGeoId("ca", "qc", CADASTRE_GEOID_KIND, noLot);
      const municipalityCode = pickMunicipalityCode(source);

      const props: AdminProperties = {
        ...source,
        geoId,
        name: noLot,
        code: noLot,
        level: "locality",
        country: "CA",
        noLot,
      };
      if (municipalityCode !== undefined) props.municipalityCode = municipalityCode;

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
