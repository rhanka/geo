/**
 * Choropleth bin computation for `GeoMap`'s value-driven fill.
 *
 * When a `valueKey` is set and no explicit `categories` are given, `GeoMap`
 * derives N graduated bins from the feature values and drives the fill with a
 * MapLibre `step` expression. The same bins feed `GeoMapLegend` (value mode) so
 * the map and the legend always agree. Pure functions, no DOM — unit-testable
 * in isolation.
 */

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

/** Linear-interpolated quantile of an ascending-sorted array (`q` in [0,1]). */
function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const vLo = sorted[lo] ?? Number.NaN;
  if (lo === hi) return vLo;
  const vHi = sorted[hi] ?? vLo;
  return vLo + (vHi - vLo) * (pos - lo);
}

/**
 * Compute graduated choropleth bins from a set of features.
 *
 * Returns `undefined` when there are no finite values or every value is equal
 * (a single value has no gradient to show). Bin boundaries are deduplicated, so
 * skewed `quantile` data may yield fewer bins than requested — callers should
 * treat the result length as authoritative.
 */
export function computeChoroplethBins(
  features: ReadonlyArray<{ properties?: Record<string, unknown> | null }>,
  key: string,
  options: ChoroplethOptions = {},
): ChoroplethBin[] | undefined {
  const ramp = options.ramp ?? DEFAULT_CHOROPLETH_RAMP;
  const method = options.method ?? "quantile";
  const requested = options.count ?? 5;
  const count = Math.max(1, Math.min(requested, ramp.length));

  const values = numericValues(features, key);
  const min = values[0];
  const max = values[values.length - 1];
  if (min === undefined || max === undefined) return undefined;
  if (min === max) return undefined; // no gradient

  // Boundaries: count+1 edges from min..max, then deduped to keep bins distinct.
  const edges: number[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    // Force exact endpoints (guards against fp drift in quantile interpolation).
    if (i === 0) edges.push(min);
    else if (i === count) edges.push(max);
    else
      edges.push(
        method === "equal" ? min + (max - min) * t : quantileSorted(values, t),
      );
  }

  const uniqueEdges: number[] = [];
  for (const e of edges) {
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
