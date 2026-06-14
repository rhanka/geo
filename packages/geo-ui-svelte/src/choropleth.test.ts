/**
 * Unit tests for the choropleth bin helper. Pure functions, no DOM — these
 * assert quantile boundaries, equal-interval boundaries, the `step` expression
 * shape, and the degenerate cases (no values / single value).
 */

import { describe, expect, it } from "vitest";
import {
  binsToStepExpression,
  computeChoroplethBins,
  formatBinRangeFr,
  numericValues,
} from "./choropleth.js";

/** Wrap raw numbers as minimal feature-like objects for the helper. */
function feats(...values: Array<number | null | string>) {
  return values.map((value) => ({ properties: { value } }));
}

const RAMP = ["c0", "c1", "c2", "c3", "c4"];

describe("numericValues", () => {
  it("extracts finite numbers ascending, dropping non-numerics", () => {
    const out = numericValues(feats(3, "x", 1, null, 2, "5"), "value");
    expect(out).toEqual([1, 2, 3, 5]);
  });

  it("returns [] when nothing is numeric", () => {
    expect(numericValues(feats("a", null), "value")).toEqual([]);
  });
});

describe("computeChoroplethBins — quantile", () => {
  it("splits 1..10 into 5 equal-count quantile bins with contiguous bounds", () => {
    const data = feats(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    const bins = computeChoroplethBins(data, "value", {
      count: 5,
      method: "quantile",
      ramp: RAMP,
    });
    expect(bins).toBeDefined();
    expect(bins).toHaveLength(5);
    // Endpoints are exact min/max.
    expect(bins![0]!.min).toBe(1);
    expect(bins![bins!.length - 1]!.max).toBe(10);
    // Quantile edges of [1..10] at 0,.2,.4,.6,.8,1 → 1, 2.8, 4.6, 6.4, 8.2, 10.
    const mins = bins!.map((b) => b.min);
    [1, 2.8, 4.6, 6.4, 8.2].forEach((expected, i) => {
      expect(mins[i]).toBeCloseTo(expected, 10);
    });
    // Bins are contiguous: each max equals the next min.
    for (let i = 0; i < bins!.length - 1; i++) {
      expect(bins![i]!.max).toBe(bins![i + 1]!.min);
    }
    // Ramp spans lo→hi across the bins.
    expect(bins!.map((b) => b.color)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("dedupes boundaries on skewed data → fewer bins than requested", () => {
    // Mostly zeros: several quantile edges collapse to 0.
    const data = feats(0, 0, 0, 0, 0, 0, 0, 0, 10, 100);
    const bins = computeChoroplethBins(data, "value", {
      count: 5,
      method: "quantile",
      ramp: RAMP,
    });
    expect(bins).toBeDefined();
    expect(bins!.length).toBeLessThan(5);
    // Strictly increasing boundaries.
    for (let i = 0; i < bins!.length - 1; i++) {
      expect(bins![i]!.max).toBeLessThanOrEqual(bins![i + 1]!.min);
      expect(bins![i]!.min).toBeLessThan(bins![i]!.max);
    }
  });
});

describe("computeChoroplethBins — equal interval", () => {
  it("splits 0..100 into 4 equal-width bins", () => {
    const data = feats(0, 10, 50, 90, 100);
    const bins = computeChoroplethBins(data, "value", {
      count: 4,
      method: "equal",
      ramp: RAMP,
    });
    expect(bins).toBeDefined();
    expect(bins!.map((b) => b.min)).toEqual([0, 25, 50, 75]);
    expect(bins!.map((b) => b.max)).toEqual([25, 50, 75, 100]);
  });
});

describe("computeChoroplethBins — degenerate", () => {
  it("returns undefined when there are no finite values", () => {
    expect(
      computeChoroplethBins(feats("a", null), "value", { ramp: RAMP }),
    ).toBeUndefined();
  });

  it("returns undefined when every value is equal (no gradient)", () => {
    expect(
      computeChoroplethBins(feats(7, 7, 7), "value", { ramp: RAMP }),
    ).toBeUndefined();
  });

  it("clamps the bin count to the ramp length", () => {
    const data = feats(1, 2, 3, 4, 5, 6, 7, 8);
    const bins = computeChoroplethBins(data, "value", {
      count: 99,
      ramp: RAMP,
    });
    expect(bins!.length).toBeLessThanOrEqual(RAMP.length);
  });
});

describe("binsToStepExpression", () => {
  it("builds a MapLibre `step` keyed on the bins' lower bounds", () => {
    const data = feats(0, 25, 50, 75, 100);
    const bins = computeChoroplethBins(data, "value", {
      count: 4,
      method: "equal",
      ramp: RAMP,
    })!;
    const expr = binsToStepExpression(bins, "value") as unknown[];
    expect(expr[0]).toBe("step");
    expect(expr[1]).toEqual(["to-number", ["get", "value"], 0]);
    // First colour, then (boundary, colour) pairs for the remaining bins.
    expect(expr.slice(2)).toEqual([
      bins[0]!.color,
      25,
      bins[1]!.color,
      50,
      bins[2]!.color,
      75,
      bins[3]!.color,
    ]);
  });

  it("returns a flat colour for a single bin", () => {
    expect(
      binsToStepExpression([{ min: 0, max: 1, color: "c0" }], "value"),
    ).toBe("c0");
  });
});

describe("formatBinRangeFr", () => {
  it("formats bounds with FR grouping and an en-dash", () => {
    const label = formatBinRangeFr({ min: 1000, max: 5000, color: "c0" });
    // fr-CA groups thousands with a (narrow) no-break space; assert structure.
    expect(label).toContain("–");
    expect(label.replace(/\s/g, "")).toBe("1000–5000");
  });
});
