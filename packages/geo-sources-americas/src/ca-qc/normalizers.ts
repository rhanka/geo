/**
 * Per-dataset {@link Normalizer}s mapping raw SDA ArcGIS GeoJSON onto the
 * standard {@link AdminProperties} model.
 *
 * Each normalizer:
 *   - validates the raw payload is a GeoJSON FeatureCollection,
 *   - reads the pinned SDA field names (see ./manifest.ts) for code/name,
 *   - sets `name`, `code`, `level`, `country:"CA"`, and a canonical
 *     `geoId = makeGeoId("ca","qc",<level>,<code>)`,
 *   - sets `iso = "CA-QC"` for régions (ISO 3166-2 subdivision),
 *   - derives `parentGeoId` where the parent code is present
 *     (municipality → MRC, MRC → région),
 *   - preserves all original SDA properties.
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
import { featuresToCollection, type Normalizer } from "@sentropic/geo-core";

/** ISO 3166-2 subdivision code for Québec. */
const QC_ISO = "CA-QC";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read a non-empty string (trimmed) or stringified number from `props[key]`. */
function str(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** geoId for a Québec administrative unit at `level` with local `code`. */
function qcGeoId(level: AdminLevel, code: string): string {
  return makeGeoId("ca", "qc", level, code);
}

interface FieldSpec {
  level: AdminLevel;
  /** Field holding this unit's own code. */
  codeField: string;
  /** Field holding this unit's display name. */
  nameField: string;
  /** Parent's level + code field, when derivable. */
  parent?: { level: AdminLevel; codeField: string };
  /** Whether to stamp `iso = "CA-QC"` (true for régions). */
  iso?: boolean;
}

/**
 * Build a SDA normalizer for one layer. Maps the layer's pinned fields onto
 * {@link AdminProperties}, preserving the original SDA attributes.
 */
function makeSdaNormalizer(spec: FieldSpec): Normalizer {
  return (raw, ctx): AdminFeatureCollection => {
    if (!isFeatureCollection(raw)) {
      throw new Error(
        `ca-qc/sda normalize: expected a GeoJSON FeatureCollection for dataset ` +
          `"${ctx.dataset.id}", got ${typeof raw}.`,
      );
    }

    const features: AdminFeature[] = raw.features.map(
      (feature: Feature<Geometry | null, GeoJsonProperties>, index): AdminFeature => {
        const source = asRecord(feature.properties) ?? {};

        const code = str(source, spec.codeField);
        const name = str(source, spec.nameField) ?? code ?? `feature-${index}`;

        const geoId = qcGeoId(spec.level, code ?? name);

        const props: AdminProperties = {
          ...source,
          geoId,
          name,
          level: spec.level,
          country: "CA",
        };
        if (code !== undefined) props.code = code;
        if (spec.iso) props.iso = QC_ISO;

        if (spec.parent) {
          const parentCode = str(source, spec.parent.codeField);
          if (parentCode !== undefined) {
            props.parentGeoId = qcGeoId(spec.parent.level, parentCode);
          }
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
}

/** Normalizer for régions administratives (layer 0). Stamps `iso = "CA-QC"`. */
export const regionsNormalizer: Normalizer = makeSdaNormalizer({
  level: "region",
  codeField: "RES_CO_REG",
  nameField: "RES_NM_REG",
  iso: true,
});

/** Normalizer for MRC (layer 1). Parent = région via `MRS_CO_REG`. */
export const mrcNormalizer: Normalizer = makeSdaNormalizer({
  level: "mrc",
  codeField: "MRS_CO_MRC",
  nameField: "MRS_NM_MRC",
  parent: { level: "region", codeField: "MRS_CO_REG" },
});

/** Normalizer for municipalités (layer 2). Parent = MRC via `MUS_CO_MRC`. */
export const municipalitesNormalizer: Normalizer = makeSdaNormalizer({
  level: "municipality",
  codeField: "MUS_CO_GEO",
  nameField: "MUS_NM_MUN",
  parent: { level: "mrc", codeField: "MUS_CO_MRC" },
});
