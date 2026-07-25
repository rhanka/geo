/**
 * Generic, declarative normalizer driven by a {@link FieldMap} (ADR-0017).
 *
 * Most sources can be normalized without bespoke code by naming which raw
 * GeoJSON property feeds each standard {@link AdminProperties} field. This
 * factory turns a {@link FieldMap} into a {@link Normalizer}: it validates the
 * raw payload is a FeatureCollection, reads the named properties (first
 * non-empty wins), derives a canonical `geoId` from the source jurisdiction +
 * dataset level + code (unless the map supplies one), and preserves every
 * original property.
 *
 * NOTE (packages-v2, de-risked mode): the factory is implemented and tested,
 * but the migration deliberately keeps the existing bespoke recipes verbatim —
 * the per-source *conversion* to `fieldMap` is deferred (see ADR-0017 / the
 * migration plan). New simple sources may adopt this factory directly.
 */

import type {
  AdminFeature,
  AdminLevel,
  AdminProperties,
  Feature,
  FieldMap,
  Geometry,
  GeoJsonProperties,
  NormalizeContext,
  Normalizer,
} from "@sentropic/geo-core";
import {
  featuresToCollection,
  isFeatureCollection,
  makeGeoId,
} from "@sentropic/geo-core";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Normalize a `FieldMap` entry (a single key or a list) into an array of keys. */
function keysOf(spec: string | readonly string[] | undefined): readonly string[] {
  if (spec === undefined) return [];
  return typeof spec === "string" ? [spec] : spec;
}

/** First string-valued property among `keys`, trimmed and non-empty. */
function pickString(
  props: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = props[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/**
 * Build a {@link Normalizer} from a {@link FieldMap}. The dataset's
 * `adminLevel` (or `"locality"`) sets the level; the source country sets
 * `country`; `geoId` is taken from the mapped property or derived as
 * `makeGeoId(country, dataset.id, level, code ?? name ?? index)`.
 */
export function makeFieldMapNormalizer(fieldMap: FieldMap): Normalizer {
  const nameKeys = keysOf(fieldMap.name);
  const codeKeys = keysOf(fieldMap.code);
  const isoKeys = keysOf(fieldMap.iso);
  const geoIdKeys = keysOf(fieldMap.geoId);
  const parentKeys = keysOf(fieldMap.parentGeoId);

  return (raw: unknown, ctx: NormalizeContext) => {
    if (!isFeatureCollection(raw)) {
      throw new Error(
        `field-map normalize: expected a GeoJSON FeatureCollection from source ` +
          `"${ctx.manifest.id}" dataset "${ctx.dataset.id}".`,
      );
    }

    const country = (ctx.manifest.jurisdiction.country || "ZZ").toUpperCase();
    const level: AdminLevel = ctx.dataset.adminLevel ?? "locality";

    const features: AdminFeature[] = raw.features.map(
      (feature: Feature<Geometry | null, GeoJsonProperties>, index): AdminFeature => {
        const source = asRecord(feature.properties) ?? {};
        const code = pickString(source, codeKeys);
        const name = pickString(source, nameKeys) ?? code ?? `feature-${index}`;
        const iso = pickString(source, isoKeys);
        const geoId =
          pickString(source, geoIdKeys) ??
          makeGeoId(country, ctx.dataset.id, level, code ?? name ?? String(index));
        const parentGeoId = pickString(source, parentKeys);

        const props: AdminProperties = { ...source, geoId, name, level, country };
        if (code !== undefined) props.code = code;
        if (iso !== undefined) props.iso = iso;
        if (parentGeoId !== undefined) props.parentGeoId = parentGeoId;

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
}
