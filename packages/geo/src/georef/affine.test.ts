/**
 * Unit tests for the shared least-squares affine solver (georef/affine.ts).
 *
 * Pure, network-free. `fitAffine` is the single solver reused by both the
 * embedded-GeoPDF path and the manual-GCP path; here we pin it directly on a
 * KNOWN linear map v = a·x + b·y + c, proving exact recovery from 3 non-collinear
 * correspondences and least-squares averaging over an over-determined noisy set.
 */
import { describe, it, expect } from "vitest";

import { fitAffine } from "./affine.js";

describe("georef/affine — fitAffine least-squares solver", () => {
  it("recovers the exact coefficients of a known linear map from 3 points", () => {
    const [a, b, c] = [2.0, -3.0, 5.0];
    const pts: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [0, 10],
    ];
    const vals = pts.map(([x, y]) => a * x + b * y + c);
    const [ga, gb, gc] = fitAffine(pts, vals);
    expect(ga).toBeCloseTo(a, 9);
    expect(gb).toBeCloseTo(b, 9);
    expect(gc).toBeCloseTo(c, 9);
  });

  it("is exact on an over-determined consistent system", () => {
    const [a, b, c] = [1.9e-5, 1.0e-6, -73.53];
    const pts: Array<[number, number]> = [
      [100, 200],
      [3000, 400],
      [1500, 2200],
      [500, 1800],
    ];
    const vals = pts.map(([x, y]) => a * x + b * y + c);
    const [ga, gb, gc] = fitAffine(pts, vals);
    for (const [x, y] of pts) {
      expect(ga * x + gb * y + gc).toBeCloseTo(a * x + b * y + c, 9);
    }
    expect(ga).toBeCloseTo(a, 12);
    expect(gb).toBeCloseTo(b, 12);
    expect(gc).toBeCloseTo(c, 6);
  });

  it("returns the least-squares solution (residuals orthogonal to the design) on a noisy system", () => {
    const [a, b, c] = [2, 3, 1];
    const pts: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [0, 10],
      [10, 10],
    ];
    // Inconsistent (noisy) values → no exact fit; fitAffine minimises Σ residual².
    const eps = [0.5, -0.4, 0.3, -0.6];
    const vals = pts.map(([x, y], i) => a * x + b * y + c + eps[i]!);
    const [ga, gb, gc] = fitAffine(pts, vals);
    // Defining property of the LS solution: residuals orthogonal to each design
    // column (the normal equations) → Σr = 0, Σr·x = 0, Σr·y = 0.
    const res = pts.map(([x, y], i) => vals[i]! - (ga * x + gb * y + gc));
    const sum = res.reduce((s, r) => s + r, 0);
    const sumX = pts.reduce((s, [x], i) => s + res[i]! * x, 0);
    const sumY = pts.reduce((s, [, y], i) => s + res[i]! * y, 0);
    expect(sum).toBeCloseTo(0, 9);
    expect(sumX).toBeCloseTo(0, 9);
    expect(sumY).toBeCloseTo(0, 9);
  });
});
