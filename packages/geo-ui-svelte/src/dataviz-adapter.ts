/**
 * Bridge between this package's RFC-7946 GeoJSON inputs and the rendering-neutral
 * geo builders in `@sentropic/dataviz-core`.
 *
 * The dataviz-core builders are PURE DATA: they take a {@link DataModel} (the BI
 * shape of a dataset — dimensions/measures) plus flat {@link Row}s and return
 * aggregated/binned models with NO rendering. They do not know about GeoJSON.
 * This module owns the smallest possible adaptation in both directions:
 *
 *  - INPUT  — flatten a `FeatureCollection` to `Row[]` (one row per feature) and
 *             synthesize the matching `DataModel`. Polygon choropleths key on
 *             `properties[regionKey]`; point layers read `lat`/`lng` columns
 *             projected out of each feature's `Point` geometry.
 *  - OUTPUT — each consumer (`choropleth.ts`, the hexbin/cluster/density layer
 *             builders) maps the builder's model to a MapLibre layer/legend.
 *
 * Keeping this in one file means there is exactly one place that understands
 * both vocabularies, and it documents (in `BUILDER_NOTES`) where the builder
 * I/O does not map cleanly to GeoJSON so we can ask dataviz to adjust upstream.
 */

import type { FeatureCollection, Position } from "@sentropic/geo-core";
import type {
  Aggregation,
  DataModel,
  Row,
} from "@sentropic/dataviz-core";

/**
 * Notes for the dataviz-core maintainers, surfaced from this integration.
 * Documented here (not forked) per the "don't fork the math" rule.
 */
export const BUILDER_NOTES = {
  /**
   * `buildChoroplethModel` AGGREGATES one value per region (group-by + rollup)
   * but does NOT CLASSIFY those region values into graduated bins. A geographic
   * choropleth needs the second step (quantile / equal-interval breaks driving a
   * colour ramp). We keep the classification local (`choropleth.ts`) and only
   * delegate the aggregation. ASK: expose a `classify(values, {method,count})`
   * helper (or a `breaks` option on `ChoroplethModel`) so the binning math lives
   * in dataviz-core too.
   */
  choroplethHasNoClassification: true,
  /**
   * The point builders (`buildGeoHexbinModel`, `buildGeoDensityModel`,
   * `buildGeoClusterModel`) take `latitude`/`longitude` as flat column ids, not
   * geometry. We project each `Point` feature's `coordinates` into synthetic
   * `lat`/`lng` columns. ASK: a `geometry`-aware point config (like
   * `GeoJsonLayerConfig.geometry`) would remove this projection step.
   */
  pointBuildersNeedFlatLatLng: true,
  /**
   * `GeoHexbin`/`GeoDensityCell` carry a `center` (and density a `bounds`) but
   * NOT a ready polygon ring, so we synthesize the hexagon / rectangle rings
   * here for MapLibre fills. ASK: an optional `polygon: Position[]` on the cell
   * models would let consumers render without re-deriving cell geometry.
   */
  cellsHaveNoPolygonRing: true,
} as const;

/** Column id we project a point feature's longitude into. */
export const LNG_KEY = "__lng";
/** Column id we project a point feature's latitude into. */
export const LAT_KEY = "__lat";

/** Coerce a raw cell to a finite number, or `undefined` (stricter than `Number`). */
function toFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    const v = Number(trimmed);
    return Number.isFinite(v) ? v : undefined;
  }
  return undefined;
}

/** A scalar safe to place in a dataviz {@link Row} cell. */
function toCell(raw: unknown): string | number | boolean | null {
  if (
    raw === null ||
    typeof raw === "number" ||
    typeof raw === "string" ||
    typeof raw === "boolean"
  ) {
    return raw;
  }
  return raw === undefined ? null : String(raw);
}

/**
 * Flatten a `FeatureCollection`'s `properties` into dataviz {@link Row}s — one
 * row per feature. Only scalar property values survive (objects/arrays are
 * stringified) so the rows satisfy dataviz's `Row = Record<string, Cell>`.
 */
export function featuresToRows(fc: FeatureCollection): Row[] {
  return fc.features.map((feature) => {
    const row: Row = {};
    const props = feature.properties ?? {};
    for (const [key, value] of Object.entries(props)) {
      row[key] = toCell(value);
    }
    return row;
  });
}

/** Synthetic region column when no domain region key is given (identity rollup). */
export const REGION_KEY = "__region";

/**
 * Build the rows + model for a **value-driven choropleth** over polygon features.
 *
 * Each feature becomes a row keyed by a region dimension (`regionKey`) and
 * carrying the numeric `valueKey` measure, so
 * `buildChoroplethModel(model, rows, {region, measure})` groups and aggregates by
 * region. When `regionKey` is omitted, a unique synthetic id per feature is used
 * so the aggregation is an identity pass-through (one region per feature) — the
 * pre-builder behaviour. `regionKey === valueKey` is handled by routing the
 * region through {@link REGION_KEY} so the measure cell is never clobbered.
 */
export function choroplethInput(
  fc: FeatureCollection,
  regionKey: string | undefined,
  valueKey: string,
  aggregation: Aggregation = "sum",
): { model: DataModel; rows: Row[] } {
  // The region dimension id must be distinct from the measure id (dataviz
  // forbids a dimension and measure sharing an id), and from the props when the
  // caller asked to group on the value column itself.
  const regionId =
    regionKey === undefined || regionKey === valueKey ? REGION_KEY : regionKey;
  const rows: Row[] = fc.features.map((feature, index) => {
    const props = feature.properties ?? {};
    const region = regionKey === undefined ? undefined : props[regionKey];
    return {
      [regionId]:
        region === undefined || region === null
          ? `__feature_${index}`
          : toCell(region),
      [valueKey]: toFiniteNumber(props[valueKey]) ?? null,
    };
  });
  const model: DataModel = {
    dimensions: [{ id: regionId, label: regionId, type: "discrete" }],
    measures: [{ id: valueKey, label: valueKey, aggregation }],
  };
  return { model, rows };
}

/**
 * Build the rows + model for the **point-aggregation** builders (hexbin /
 * cluster / density).
 *
 * Each `Point` feature is projected to `{ [LNG_KEY], [LAT_KEY], ...props }`. The
 * lat/lng become continuous dimensions (the builders read them as raw columns,
 * not as measures); an optional numeric `valueKey` becomes a `sum` measure so
 * the builders can weight cells/clusters by it. Non-point geometries are
 * dropped — these layer kinds are defined over POINT inputs (immo signals).
 */
export function pointInput(
  fc: FeatureCollection,
  valueKey?: string,
): { model: DataModel; rows: Row[] } {
  const rows: Row[] = [];
  for (const feature of fc.features) {
    const geom = feature.geometry;
    if (!geom || geom.type !== "Point") continue;
    const [lng, lat] = geom.coordinates as Position;
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    const props = feature.properties ?? {};
    const row: Row = { [LNG_KEY]: lng, [LAT_KEY]: lat };
    if (valueKey !== undefined) {
      row[valueKey] = toFiniteNumber(props[valueKey]) ?? 0;
    }
    rows.push(row);
  }
  const model: DataModel = {
    dimensions: [
      { id: LNG_KEY, label: "Longitude", type: "continuous" },
      { id: LAT_KEY, label: "Latitude", type: "continuous" },
    ],
    measures:
      valueKey === undefined
        ? []
        : [{ id: valueKey, label: valueKey, aggregation: "sum" }],
  };
  return { model, rows };
}
