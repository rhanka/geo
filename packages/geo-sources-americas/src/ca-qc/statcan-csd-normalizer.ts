/**
 * Normalizer for the StatCan CSD 2025 municipal-polygon source
 * (`ca-qc/statcan-csd`). Maps each CSD GeoJSON feature onto the standard
 * {@link AdminProperties} model and joins it to the QC municipality registry,
 * reproducing immo's `radar/data-prep/fetch-municipal-polygons.ts` join.
 *
 * Per feature it sets:
 *   - `geoId  = makeGeoId("ca","qc","municipality", CSDUID)`
 *   - `code   = CSDUID` (7-digit StatCan code — MUS_CO_GEO surrogate)
 *   - `name   = CSDNAME`, `level = "municipality"`, `country = "CA"`
 *   - registry join (by NFD-normalized CSDNAME, CDNAME≈MRC tiebreak):
 *       `citySlug` (registry slug) and `mrc` (registry MRC) when matched.
 *
 * The join is name-based (NFD-normalized): the registry has no native StatCan
 * code, and immo reports ~99.8% coverage this way. Original CSD attributes are
 * preserved.
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

import {
  QC_MUNICIPALITIES,
  normalizeName,
  type Municipality,
} from "./municipalities/municipalities.js";

// ── registry index (name → entries, name|mrc → entry) ────────────────────────

interface RegistryIndex {
  byName: Map<string, Municipality[]>;
  byNameMrc: Map<string, Municipality>;
}

function buildRegistryIndex(entries: readonly Municipality[]): RegistryIndex {
  const byName = new Map<string, Municipality[]>();
  const byNameMrc = new Map<string, Municipality>();
  for (const entry of entries) {
    const normName = normalizeName(entry.name);
    const list = byName.get(normName);
    if (list) list.push(entry);
    else byName.set(normName, [entry]);
    if (entry.mrc !== null) {
      byNameMrc.set(`${normName}|${normalizeName(entry.mrc)}`, entry);
    }
  }
  return { byName, byNameMrc };
}

/** Default index over the embedded QC registry (built once). */
const DEFAULT_REGISTRY_INDEX = buildRegistryIndex(QC_MUNICIPALITIES);

/**
 * Resolve the registry entry for a CSD feature by NFD-normalized name, then by
 * `name|MRC` (CDNAME ≈ MRC). With several same-name registry candidates, prefer
 * the one whose MRC matches CDNAME, else the first. Mirrors immo's join passes
 * (immo's extra CSDTYPE tiebreak applies to the *StatCan* side — see
 * {@link CSDTYPE_PRIORITY} in ./statcan-csd.ts — and is moot here, as registry
 * entries carry no subdivision type).
 */
function joinToRegistry(
  index: RegistryIndex,
  csdName: string,
  cdName: string,
): Municipality | undefined {
  const normName = normalizeName(csdName);
  const normMrc = cdName ? normalizeName(cdName) : "";

  // Strategy 1: name + MRC exact.
  if (normMrc) {
    const exact = index.byNameMrc.get(`${normName}|${normMrc}`);
    if (exact) return exact;
  }

  // Strategy 2: name only.
  const candidates = index.byName.get(normName);
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Prefer a candidate whose MRC matches CDNAME, else the first.
  if (normMrc) {
    const mrcMatch = candidates.find(
      (c) => c.mrc !== null && normalizeName(c.mrc) === normMrc,
    );
    if (mrcMatch) return mrcMatch;
  }
  return candidates[0];
}

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
 * Build the StatCan CSD normalizer. Pass a custom registry to override the
 * embedded one (used by tests); defaults to {@link QC_MUNICIPALITIES}.
 */
export function makeStatCanCsdNormalizer(
  registry: readonly Municipality[] = QC_MUNICIPALITIES,
): Normalizer {
  const index =
    registry === QC_MUNICIPALITIES
      ? DEFAULT_REGISTRY_INDEX
      : buildRegistryIndex(registry);

  return (raw, ctx): AdminFeatureCollection => {
    if (!isFeatureCollection(raw)) {
      throw new Error(
        `ca-qc/statcan-csd normalize: expected a GeoJSON FeatureCollection for ` +
          `dataset "${ctx.dataset.id}", got ${typeof raw}.`,
      );
    }

    const features: AdminFeature[] = raw.features.map(
      (
        feature: Feature<Geometry | null, GeoJsonProperties>,
        featureIndex,
      ): AdminFeature => {
        const source = asRecord(feature.properties) ?? {};

        const csduid = str(source, "CSDUID");
        const csdname = str(source, "CSDNAME") ?? csduid ?? `feature-${featureIndex}`;
        const cdname = str(source, "CDNAME") ?? "";

        const geoId = makeGeoId("ca", "qc", "municipality", csduid ?? csdname);

        const props: AdminProperties = {
          ...source,
          geoId,
          name: csdname,
          level: "municipality",
          country: "CA",
        };
        if (csduid !== undefined) props.code = csduid;

        const matched = joinToRegistry(index, csdname, cdname);
        if (matched) {
          props.citySlug = matched.slug;
          props.mrc = matched.mrc;
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

/** Normalizer for the StatCan CSD municipal polygons, joined to the QC registry. */
export const statcanCsdNormalizer: Normalizer = makeStatCanCsdNormalizer();
