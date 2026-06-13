/**
 * Per-dataset {@link Normalizer}s mapping raw ADMIN EXPRESS GeoJSON (emitted by
 * `ogr2ogr` from the GPKG) onto the standard {@link AdminProperties} model.
 *
 * Each normalizer:
 *   - validates the raw payload is a GeoJSON FeatureCollection,
 *   - reads the pinned ADMIN EXPRESS field names (see ./manifest.ts) for
 *     code/name,
 *   - sets `name`, `code` (INSEE code), `level`, `country:"FR"`, and a canonical
 *     `geoId = makeGeoId("fr", <level>, <code>)`,
 *   - sets `iso` (ISO 3166-2 `FR-xxx`) for régions, from the INSEE→ISO table,
 *   - derives `parentGeoId` where the parent code is present
 *     (commune → département via `code_insee_du_departement`, also derivable
 *     from the first chars of the INSEE code; département → région via
 *     `code_insee_de_la_region`),
 *   - preserves all original ADMIN EXPRESS properties.
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
 * INSEE région code → ISO 3166-2:FR subdivision code. The 13 metropolitan
 * régions use three-letter codes; the 5 overseas régions reuse the overseas
 * collectivity two-letter codes assigned by ISO 3166-2:FR.
 */
export const REGION_INSEE_TO_ISO: Readonly<Record<string, string>> = {
  // Outre-mer
  "01": "FR-GP", // Guadeloupe
  "02": "FR-MQ", // Martinique
  "03": "FR-GF", // Guyane
  "04": "FR-RE", // La Réunion
  "06": "FR-YT", // Mayotte
  // Métropole
  "11": "FR-IDF", // Île-de-France
  "24": "FR-CVL", // Centre-Val de Loire
  "27": "FR-BFC", // Bourgogne-Franche-Comté
  "28": "FR-NOR", // Normandie
  "32": "FR-HDF", // Hauts-de-France
  "44": "FR-GES", // Grand Est
  "52": "FR-PDL", // Pays de la Loire
  "53": "FR-BRE", // Bretagne
  "75": "FR-NAQ", // Nouvelle-Aquitaine
  "76": "FR-OCC", // Occitanie
  "84": "FR-ARA", // Auvergne-Rhône-Alpes
  "93": "FR-PAC", // Provence-Alpes-Côte d'Azur
  "94": "FR-COR", // Corse
};

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

/** geoId for a French administrative unit at `level` with local INSEE `code`. */
function frGeoId(level: AdminLevel, code: string): string {
  return makeGeoId("fr", level, code);
}

interface FieldSpec {
  level: AdminLevel;
  /** Field holding this unit's own INSEE code. */
  codeField: string;
  /** Field holding this unit's display name. */
  nameField: string;
  /** Parent's level + code field, when present in the source. */
  parent?: { level: AdminLevel; codeField: string };
  /** Stamp `iso = FR-xxx` from {@link REGION_INSEE_TO_ISO} (régions only). */
  iso?: boolean;
}

/**
 * Build an ADMIN EXPRESS normalizer for one layer. Maps the layer's pinned
 * fields onto {@link AdminProperties}, preserving the original attributes.
 */
function makeAdeNormalizer(spec: FieldSpec): Normalizer {
  return (raw, ctx): AdminFeatureCollection => {
    if (!isFeatureCollection(raw)) {
      throw new Error(
        `fr/admin-express normalize: expected a GeoJSON FeatureCollection for dataset ` +
          `"${ctx.dataset.id}", got ${typeof raw}.`,
      );
    }

    const features: AdminFeature[] = raw.features.map(
      (feature: Feature<Geometry | null, GeoJsonProperties>, index): AdminFeature => {
        const source = asRecord(feature.properties) ?? {};

        const code = str(source, spec.codeField);
        const name = str(source, spec.nameField) ?? code ?? `feature-${index}`;

        const geoId = frGeoId(spec.level, code ?? name);

        const props: AdminProperties = {
          ...source,
          geoId,
          name,
          level: spec.level,
          country: "FR",
        };
        if (code !== undefined) props.code = code;
        if (spec.iso && code !== undefined) {
          const iso = REGION_INSEE_TO_ISO[code];
          if (iso !== undefined) props.iso = iso;
        }

        if (spec.parent) {
          const parentCode = str(source, spec.parent.codeField);
          if (parentCode !== undefined) {
            props.parentGeoId = frGeoId(spec.parent.level, parentCode);
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

/** Normalizer for régions. Stamps `iso = FR-xxx` from the INSEE→ISO table. */
export const regionsNormalizer: Normalizer = makeAdeNormalizer({
  level: "region",
  codeField: "code_insee",
  nameField: "nom_officiel",
  iso: true,
});

/** Normalizer for départements. Parent = région via `code_insee_de_la_region`. */
export const departementsNormalizer: Normalizer = makeAdeNormalizer({
  level: "department",
  codeField: "code_insee",
  nameField: "nom_officiel",
  parent: { level: "region", codeField: "code_insee_de_la_region" },
});

/** Normalizer for communes. Parent = département via `code_insee_du_departement`. */
export const communesNormalizer: Normalizer = makeAdeNormalizer({
  level: "municipality",
  codeField: "code_insee",
  nameField: "nom_officiel",
  parent: { level: "department", codeField: "code_insee_du_departement" },
});
