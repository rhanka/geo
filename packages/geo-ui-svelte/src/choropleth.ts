/**
 * Choropleth bin computation for `GeoMap`'s value-driven fill.
 *
 * When a `valueKey` is set and no explicit `categories` are given, `GeoMap`
 * derives N graduated bins from the feature values and drives the fill with a
 * MapLibre `step` expression. The same bins feed `GeoMapLegend` (value mode) so
 * the map and the legend always agree. Pure functions, no DOM — unit-testable
 * in isolation.
 *
 * Both the aggregation (group-by region + measure rollup) AND the graduated
 * CLASSIFICATION (quantile / equal-interval breaks) are delegated to
 * `@sentropic/dataviz-core` as of 0.4.37: {@link computeChoroplethBinsFromModel}
 * passes `classification: { method, count }` to `buildChoroplethModel` and reads
 * the resulting `model.breaks`. Only the classes → colour ramp MAPPING (a
 * rendering concern) and the degenerate-case / dedup handling stay local.
 * {@link classifyValues} delegates the break math to dataviz-core's `classify`.
 */

import type { Aggregation } from "@sentropic/dataviz-core";
import { buildChoroplethModel, classify } from "@sentropic/dataviz-core";
import type { FeatureCollection } from "@sentropic/geo-core";
import { choroplethInput } from "./dataviz-adapter.js";

/** Default sequential colour ramp (5 stops), tokenized with hex fallbacks. */
export const DEFAULT_CHOROPLETH_RAMP: readonly string[] = [
  "var(--st-color-blue-10, #eff6ff)",
  "var(--st-color-blue-20, #bfdbfe)",
  "var(--st-color-blue-40, #60a5fa)",
  "var(--st-color-blue-60, #2563eb)",
  "var(--st-color-blue-80, #1e3a8a)",
];

/** Binning method. `quantile` = equal feature counts; `equal` = equal width. */
export type ChoroplethMethod = "quantile" | "equal";

/** A single graduated bin: a half-open value range `[min, max)` and its colour. */
export interface ChoroplethBin {
  /** Inclusive lower bound. */
  min: number;
  /** Exclusive upper bound (inclusive for the last bin). */
  max: number;
  /** Resolved colour for features whose value falls in this bin. */
  color: string;
}

/** Options for {@link computeChoroplethBins}. */
export interface ChoroplethOptions {
  /** Number of bins to produce. Default `5`. Clamped to `[1, ramp.length]`. */
  count?: number;
  /** Binning method. Default `"quantile"`. */
  method?: ChoroplethMethod;
  /** Colour ramp (lo→hi). Default {@link DEFAULT_CHOROPLETH_RAMP}. */
  ramp?: readonly string[];
}

/**
 * Coerce a raw property value to a finite number, or `undefined`.
 *
 * Deliberately stricter than `Number()`: `null`, `""`, booleans and other
 * non-numeric junk must NOT silently become `0` (that would inject a phantom
 * value into the distribution and skew the bins). Only real numbers and
 * non-empty numeric strings count.
 */
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

/** Extract the finite numeric values of `key` across the data, ascending-sorted. */
export function numericValues(
  features: ReadonlyArray<{ properties?: Record<string, unknown> | null }>,
  key: string,
): number[] {
  const values: number[] = [];
  for (const f of features) {
    const v = toFiniteNumber(f.properties?.[key]);
    if (v !== undefined) values.push(v);
  }
  values.sort((a, b) => a - b);
  return values;
}

/**
 * Map a set of classification breaks (`count + 1` ascending edges, min..max
 * inclusive — the convention returned by dataviz-core's `classify`) to graduated
 * colour bins. Boundaries are deduplicated (skewed `quantile` data may collapse
 * edges → fewer bins than requested) and the ramp is spread evenly across the
 * realized bins. Returns `undefined` when there is no usable gradient.
 *
 * This is the rendering-side mapping kept local per ADR-0016; the break math
 * itself lives in dataviz-core.
 */
function breaksToBins(
  breaks: readonly number[],
  ramp: readonly string[],
): ChoroplethBin[] | undefined {
  // Dedupe edges to keep bins distinct (ascending-monotonic input from classify).
  const uniqueEdges: number[] = [];
  for (const e of breaks) {
    const last = uniqueEdges[uniqueEdges.length - 1];
    if (last === undefined || e > last) uniqueEdges.push(e);
  }
  if (uniqueEdges.length < 2) return undefined;

  const binCount = uniqueEdges.length - 1;
  const lastColor = ramp[ramp.length - 1] ?? "#2563eb";
  const bins: ChoroplethBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const lo = uniqueEdges[i];
    const hi = uniqueEdges[i + 1];
    if (lo === undefined || hi === undefined) continue;
    // Spread the ramp evenly across the realized bins (which may be < count).
    const colorIdx =
      binCount === 1
        ? ramp.length - 1
        : Math.round((i / (binCount - 1)) * (ramp.length - 1));
    bins.push({ min: lo, max: hi, color: ramp[colorIdx] ?? lastColor });
  }
  return bins;
}

/**
 * Classify a set of numeric values into graduated colour bins.
 *
 * Delegates the break math to `@sentropic/dataviz-core`'s `classify`
 * (quantile / equal-interval, returning `count + 1` edges min..max) and keeps
 * only the rendering-side concerns local: clamping the class count to the ramp,
 * the degenerate-case guard (no values / single value → `undefined`), boundary
 * dedup and the class → colour mapping.
 *
 * Returns `undefined` when there are no values or every value is equal (no
 * gradient). Bin boundaries are deduplicated, so skewed `quantile` data may
 * yield fewer bins than requested — callers should treat the result length as
 * authoritative.
 */
export function classifyValues(
  values: readonly number[],
  options: ChoroplethOptions = {},
): ChoroplethBin[] | undefined {
  const ramp = options.ramp ?? DEFAULT_CHOROPLETH_RAMP;
  const method = options.method ?? "quantile";
  const requested = options.count ?? 5;
  const count = Math.max(1, Math.min(requested, ramp.length));

  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return undefined;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return undefined; // no gradient

  const breaks = classify([...finite], { method, count });
  return breaksToBins(breaks, ramp);
}

/**
 * Compute graduated choropleth bins from a set of features (per-feature values).
 *
 * Backwards-compatible wrapper: extracts the numeric values of `key` across the
 * features and classifies them. Used directly when every feature already carries
 * its own value (no per-region rollup needed). For region-aggregated inputs,
 * prefer {@link computeChoroplethBinsFromModel}, which delegates the aggregation
 * to dataviz-core's `buildChoroplethModel`.
 */
export function computeChoroplethBins(
  features: ReadonlyArray<{ properties?: Record<string, unknown> | null }>,
  key: string,
  options: ChoroplethOptions = {},
): ChoroplethBin[] | undefined {
  return classifyValues(numericValues(features, key), options);
}

/** Options for {@link computeChoroplethBinsFromModel}. */
export interface ChoroplethModelOptions extends ChoroplethOptions {
  /**
   * Property carrying each feature's region join id. The dataviz builder groups
   * features by this and aggregates `valueKey` within each group. When omitted,
   * each feature is its own region (an identity pass-through, matching the
   * pre-builder per-feature behaviour).
   */
  regionKey?: string;
  /** Rollup applied per region. Default `"sum"`. */
  aggregation?: Aggregation;
}

/**
 * Compute graduated choropleth bins by AGGREGATING per region AND CLASSIFYING the
 * per-region values via dataviz-core's `buildChoroplethModel` (0.4.37).
 *
 * This is the builder-backed path (ADR-0016): both the group-by + rollup and the
 * classification breaks are owned by dataviz-core — we pass
 * `classification: { method, count }` and read `model.breaks`. Only the
 * rendering-side class → colour mapping (and the no-gradient guard) stays local
 * via {@link breaksToBins}. The returned bins / step-expression / legend are
 * identical in shape to {@link computeChoroplethBins}. Returns `undefined` for
 * no-gradient inputs.
 */
export function computeChoroplethBinsFromModel(
  data: FeatureCollection,
  valueKey: string,
  options: ChoroplethModelOptions = {},
): ChoroplethBin[] | undefined {
  const aggregation = options.aggregation ?? "sum";
  const ramp = options.ramp ?? DEFAULT_CHOROPLETH_RAMP;
  // Clamp the requested class count to the ramp length (rendering concern), then
  // let dataviz-core compute the breaks over the aggregated region values.
  const count = Math.max(1, Math.min(options.count ?? 5, ramp.length));
  const method = options.method ?? "quantile";
  const { model, rows } = choroplethInput(
    data,
    options.regionKey,
    valueKey,
    aggregation,
  );
  // The adapter owns the actual region dimension id (it may differ from
  // `regionKey` to avoid clashing with the measure id).
  const region = model.dimensions[0]?.id ?? valueKey;
  const result = buildChoroplethModel(model, rows, {
    region,
    measure: valueKey,
    classification: { method, count },
  });
  const breaks = result.breaks ?? [];
  // No-gradient guard: classify returns [] for empty input and [min, max] with
  // min === max for a single distinct value — both collapse to < 2 unique edges.
  return breaksToBins(breaks, ramp);
}

/**
 * Build a MapLibre `step` fill-color expression from computed bins.
 *
 * `step` maps `value < bins[1].min → bins[0].color`, etc. Returned as `unknown`
 * because `maplibre-gl` does not export `ExpressionSpecification`; the caller
 * casts it at the paint property. Returns the first colour as a flat fill when a
 * single bin exists.
 */
export function binsToStepExpression(
  bins: ChoroplethBin[],
  valueKey: string,
): unknown {
  const first = bins[0];
  if (!first) return "#2563eb";
  if (bins.length === 1) return first.color;
  const expr: unknown[] = [
    "step",
    ["to-number", ["get", valueKey], first.min],
    first.color,
  ];
  for (let i = 1; i < bins.length; i++) {
    const bin = bins[i];
    if (bin) expr.push(bin.min, bin.color);
  }
  return expr;
}

/** FR number formatter for legend bounds (no fixed decimals; locale grouping). */
const frNumber = new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 2 });

/** Format a bin's range as an FR label, e.g. "1 000 – 5 000". */
export function formatBinRangeFr(bin: ChoroplethBin): string {
  return `${frNumber.format(bin.min)} – ${frNumber.format(bin.max)}`;
}
