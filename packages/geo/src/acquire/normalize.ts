/**
 * Normalizer plumbing. A {@link Normalizer} turns a source's raw payload into a
 * standard {@link AdminFeatureCollection}. The built-in {@link geojsonPassthrough}
 * handles sources that already emit GeoJSON (including ArcGIS `f=geojson`),
 * validating the FeatureCollection and coercing feature properties toward
 * {@link AdminProperties} on a best-effort basis.
 */

import type {
  AdminFeature,
  AdminLevel,
  AdminProperties,
  Feature,
  Geometry,
  GeoJsonProperties,
  NormalizeContext,
  Normalizer,
} from "@sentropic/geo-core";
import {
  featuresToCollection,
  isAdminLevel,
  isFeatureCollection,
  makeGeoId,
} from "@sentropic/geo-core";

// `featuresToCollection`, the `Normalizer`/`NormalizeContext` types now live in
// geo-core (so continent source recipes depend on geo-core alone, breaking the
// cycle). Re-exported here for back-compat with existing `@sentropic/geo-acquire`
// importers.
export { featuresToCollection };
export type { NormalizeContext, Normalizer };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** First string-valued property among `keys`, trimmed and non-empty. */
function pickString(
  props: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = props[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

const NAME_KEYS = ["name", "nom", "NAME", "NOM", "title", "label", "libelle"] as const;
const CODE_KEYS = ["code", "CODE", "id", "ID", "gid", "GID"] as const;
const ISO_KEYS = ["iso", "ISO", "iso3166", "ISO3166"] as const;

/**
 * Best-effort coercion of an arbitrary feature's properties toward
 * {@link AdminProperties}. Original keys are preserved; standard fields
 * (`geoId`, `name`, `level`, `code`, `iso`, `country`) are derived from common
 * spellings or from the dataset/manifest context, then stable defaults.
 */
function coerceProperties(
  raw: GeoJsonProperties,
  index: number,
  ctx: NormalizeContext,
): AdminProperties {
  const source = asRecord(raw) ?? {};
  const country = (ctx.manifest.jurisdiction.country || "ZZ").toUpperCase();

  const level: AdminLevel = (() => {
    const candidate = pickString(source, ["level", "LEVEL"]);
    if (candidate && isAdminLevel(candidate)) return candidate;
    if (ctx.dataset.adminLevel) return ctx.dataset.adminLevel;
    return "locality";
  })();

  const code = pickString(source, CODE_KEYS);
  const name = pickString(source, NAME_KEYS) ?? code ?? `feature-${index}`;
  const iso = pickString(source, ISO_KEYS);

  const existingGeoId = pickString(source, ["geoId", "geoid", "GEOID"]);
  const geoId =
    existingGeoId ??
    makeGeoId(country, ctx.dataset.id, level, code ?? name ?? String(index));

  // Preserve all original keys, then overlay the standard fields.
  const props: AdminProperties = {
    ...source,
    geoId,
    name,
    level,
    country,
  };
  if (code !== undefined) props.code = code;
  if (iso !== undefined) props.iso = iso;
  return props;
}

/**
 * Built-in normalizer for sources that already emit GeoJSON. Validates the raw
 * value is a FeatureCollection and coerces each feature's properties toward
 * {@link AdminProperties}. Geometry is passed through unchanged (callers must
 * ensure WGS84 — ArcGIS `outSR=4326` and `geojson` sources satisfy this).
 */
export const geojsonPassthrough: Normalizer = (raw, ctx) => {
  if (!isFeatureCollection(raw)) {
    throw new Error(
      `normalize: expected a GeoJSON FeatureCollection from source "${ctx.manifest.id}" ` +
        `dataset "${ctx.dataset.id}", got ${describe(raw)}.`,
    );
  }

  const features: AdminFeature[] = raw.features.map(
    (feature: Feature<Geometry | null, GeoJsonProperties>, index): AdminFeature => {
      const properties = coerceProperties(feature.properties, index, ctx);
      const out: AdminFeature = {
        type: "Feature",
        geometry: feature.geometry as Geometry,
        properties,
      };
      if (feature.id !== undefined) out.id = feature.id;
      if (feature.bbox !== undefined) out.bbox = feature.bbox;
      return out;
    },
  );

  return featuresToCollection(features);
};

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const record = asRecord(value);
  if (record && typeof record["type"] === "string") {
    return `an object with type="${record["type"]}"`;
  }
  return typeof value;
}
