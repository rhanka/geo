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
 *             `properties[regionKey]`; point layers carry each feature's `Point`
 *             geometry in a single column the builders read via their
 *             `geometry` config (dataviz-core 0.4.37).
 *  - OUTPUT — each consumer (`choropleth.ts`, the hexbin/cluster/density layer
 *             builders) maps the builder's model to a MapLibre layer/legend.
 *
 * Keeping this in one file means there is exactly one place that understands
 * both vocabularies. As of dataviz-core 0.4.37 all three previously-local maths
 * (choropleth classification, point lat/lng projection, cell polygon rings) are
 * provided by the builders — see `BUILDER_NOTES` for the resolution record.
 */

import type { FeatureCollection, Position } from "@sentropic/geo-core";
import type {
  Aggregation,
  Cell,
  DataModel,
  Row,
} from "@sentropic/dataviz-core";

/**
 * Resolution record for the three asks this integration raised against
 * dataviz-core — all delivered additively in 0.4.37 (ADR-0016). Kept as a public
 * marker; the local glue that worked around each gap has been removed.
 */
export const BUILDER_NOTES = {
  /**
   * RESOLVED in 0.4.37: `ChoroplethConfig.classification = { method, count }`
   * populates `ChoroplethModel.breaks` (and `classify(values, {method,count})`
   * is exported). `choropleth.ts` now reads `model.breaks` instead of
   * classifying locally; only the class → colour mapping stays in geo (rendering).
   */
  choroplethHasNoClassification: false,
  /**
   * RESOLVED in 0.4.37: the point builders accept `geometry: '<column>'` (a
   * GeoJSON `Point` object column), so we pass the feature geometry directly
   * instead of projecting synthetic `__lat`/`__lng` columns.
   */
  pointBuildersNeedFlatLatLng: false,
  /**
   * RESOLVED in 0.4.37: `GeoHexbin.polygon` (6 pointy-top vertices) and
   * `GeoDensityCell.polygon` (4 corners SW/SE/NE/NW) are provided by the
   * builders. `point-layers.ts` renders those instead of synthesizing rings.
   */
  cellsHaveNoPolygonRing: false,
} as const;

/**
 * Column id under which each point feature's GeoJSON `Point` geometry is carried,
 * so the dataviz-core point builders can read it via their `geometry` config.
 */
export const GEOMETRY_KEY = "__geometry";

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
 * Each `Point` feature's geometry is carried verbatim in the {@link GEOMETRY_KEY}
 * column so the builders read it via their `geometry` config (dataviz-core
 * 0.4.37). An optional numeric `valueKey` becomes a `sum` measure so the builders
 * can weight cells/clusters by it. Non-point geometries are dropped — these layer
 * kinds are defined over POINT inputs (immo signals).
 *
 * NOTE (dataviz divergence): the builders read the geometry column as a GeoJSON
 * `Point` OBJECT at runtime, but the published `Cell` type is
 * `string | number | boolean | null` and does not admit objects. We cast the
 * geometry into the cell; see the report's "divergences" section.
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
    // Carry the GeoJSON Point object as-is; the builder's `geometry` reader
    // expects { type:'Point', coordinates:[lng,lat] }. Cast around the scalar-only
    // `Cell` type (runtime contract is wider than the published type — see report).
    const row: Row = {
      [GEOMETRY_KEY]: { type: "Point", coordinates: [lng, lat] } as unknown as Cell,
    };
    if (valueKey !== undefined) {
      row[valueKey] = toFiniteNumber(props[valueKey]) ?? 0;
    }
    rows.push(row);
  }
  const model: DataModel = {
    dimensions: [{ id: GEOMETRY_KEY, label: "Geometry", type: "discrete" }],
    measures:
      valueKey === undefined
        ? []
        : [{ id: valueKey, label: valueKey, aggregation: "sum" }],
  };
  return { model, rows };
}
