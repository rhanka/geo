/**
 * Unit tests for the PURE rotation-disambiguation decision (decideRotation).
 *
 * These lock the anti-invention contract: an orientation-ambiguity reject is
 * only re-opened when the cadastre lot-assignment DECISIVELY prefers one
 * rotation. The decisive signal is TIGHT-cutoff coverage (labels close to lots);
 * a 180° flip collapses it. Fixtures replay the empirically-measured windsor
 * (decisive rot0) and hudson (genuinely ambiguous → skip) cases plus guards.
 */
import { describe, it, expect } from "vitest";

import { decideAnisoArbitration, decideRotation, type MeasuredRotation } from "./t2-rotation-disambig.js";
import type { GcpFile } from "./t2-georef.js";

const GCP_STUB: GcpFile = { slug: "x", pdf: "", gcps: [] };

/** tightCov = discrimination coverage (300 m); servingCov = 1500 m coverage. */
function m(
  rotation: number,
  tightCov: number,
  servingCov: number,
  n_distinct_codes: number,
  extra: Partial<MeasuredRotation> = {},
): MeasuredRotation {
  return {
    extent: "density+20%",
    rotation,
    bearing_right_deg: rotation === 180 ? 180 : rotation === 90 ? 90 : rotation === 270 ? -90 : 0,
    selected_gcps: 20,
    residual_max_m: 9,
    holdout_max_m: 10,
    coverage_pct: tightCov,
    serving_coverage_pct: servingCov,
    n_distinct_codes,
    n_empty_labels: 5,
    n_served_features: n_distinct_codes,
    spatial_km: 1,
    gcp_file: GCP_STUB,
    ...extra,
  };
}

describe("decideRotation", () => {
  it("needs at least two candidate orientations", () => {
    const d = decideRotation([m(0, 96, 99, 40)]);
    expect(d.decisive).toBe(false);
    expect(d.reason).toMatch(/≥2/);
  });

  it("SERVES windsor: rot0 96.67% vs rot180 30.95% at the tight cutoff (65pt gap)", () => {
    // Serving coverage saturates (~99% both) — only the tight cutoff separates them.
    const d = decideRotation([m(0, 96.67, 99.84, 139), m(180, 30.95, 99.53, 140)]);
    expect(d.decisive).toBe(true);
    expect(d.winner?.rotation).toBe(0);
    expect(d.coverage_margin_pct).toBeCloseTo(65.72, 1);
  });

  it("does NOT let the distinct-code count flip the winner (scatter reads more codes)", () => {
    // rot180 reads MORE codes (140) yet is the wrong flip — tight coverage decides.
    const d = decideRotation([m(0, 96.67, 99.84, 139), m(180, 30.95, 99.53, 140)]);
    expect(d.winner?.rotation).toBe(0);
  });

  it("SKIPS hudson: rot0 50.29% vs rot180 52.69% at tight cutoff — near tie", () => {
    const d = decideRotation([m(0, 50.29, 98.05, 46), m(180, 52.69, 96.7, 46)]);
    expect(d.decisive).toBe(false);
    expect(d.reason).toMatch(/ambiguous|not decisive/);
  });

  it("SKIPS when the decisive winner's serving coverage is below the floor", () => {
    // Big tight-cutoff gap, but neither orientation covers ≥70% of lots when served.
    const d = decideRotation([m(90, 57.5, 61, 14), m(0, 33.7, 40, 8)]);
    expect(d.decisive).toBe(false);
    expect(d.reason).toMatch(/floor/);
  });

  it("SERVES with a custom looser floor when the gap is decisive", () => {
    const d = decideRotation([m(90, 57.5, 66, 14), m(0, 33.7, 40, 8)], { coverageFloorPct: 60 });
    expect(d.decisive).toBe(true);
    expect(d.winner?.rotation).toBe(90);
  });

  it("SKIPS a near-tie even when serving coverage is high", () => {
    const d = decideRotation([m(0, 90, 99, 40), m(180, 82, 98, 40)]);
    expect(d.decisive).toBe(false);
    expect(d.reason).toMatch(/ambiguous|not decisive/);
  });

  it("SKIPS a decisive gap that places too few distinct codes (anti-#74)", () => {
    const d = decideRotation([m(0, 95, 98, 2), m(180, 20, 90, 1)]);
    expect(d.decisive).toBe(false);
    expect(d.reason).toMatch(/distinct codes/);
  });
});

describe("decideAnisoArbitration (moderate-anisotropy stretch confirmation)", () => {
  it("SERVES arundel: a moderate-aniso north-up fit serving 99% of lots with 47 codes (tight only 17%)", () => {
    // Empirically arundel serves ~89–99% of lots; the tight-300m cutoff is only
    // ~8–17% even for the CORRECT georef (sparse rural zone labels) → serving decides.
    const d = decideAnisoArbitration([m(0, 16.98, 99.29, 47)]);
    expect(d.serve).toBe(true);
    expect(d.winner?.rotation).toBe(0);
    expect(d.reason).toMatch(/CONFIRMED/);
  });

  it("picks the best-SERVING candidate among several moderate-aniso north-up fits", () => {
    const d = decideAnisoArbitration([
      m(0, 7.78, 89.62, 30, { extent: "density", residual_max_m: 11 }),
      m(0, 16.98, 99.29, 47, { extent: "full", residual_max_m: 28 }),
    ]);
    expect(d.serve).toBe(true);
    expect(d.winner?.serving_coverage_pct).toBe(99.29);
    expect(d.winner?.extent).toBe("full");
  });

  it("SKIPS when serving coverage is below the floor (stretch NOT confirmed real)", () => {
    // A spurious stretch scatters the independent labels: serving coverage collapses.
    const d = decideAnisoArbitration([m(0, 20, 55, 25)]);
    expect(d.serve).toBe(false);
    expect(d.reason).toMatch(/NOT confirmed real/);
  });

  it("SKIPS when too few distinct codes (anti-#74)", () => {
    const d = decideAnisoArbitration([m(0, 40, 98, 2)]);
    expect(d.serve).toBe(false);
    expect(d.reason).toMatch(/distinct codes/);
  });

  it("SKIPS an empty candidate set", () => {
    const d = decideAnisoArbitration([]);
    expect(d.serve).toBe(false);
    expect(d.reason).toMatch(/no moderate-anisotropy candidate/);
  });

  it("honours a custom serving-coverage floor", () => {
    const d = decideAnisoArbitration([m(0, 10, 80, 20)], { servingCoverageFloorPct: 75 });
    expect(d.serve).toBe(true);
  });
});
