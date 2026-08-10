import { describe, it, expect } from "vitest";

// @ts-expect-error Script executable MJS sans déclaration TypeScript publique.
const mod = await import("../../scripts/recalage-attestation.mjs");
const { attestFromMetrics, BANC } = mod as any;

// Métriques d'un recalage sain (belcourt-like) : residual < 30, marge large,
// scale_ratio au milieu de bande, mean_dist non nul, lot-zone < 5.
const CLEAN = {
  chamfer_mean_dist_m: 2.0, inlier_pct: 97, scale_ratio: 0.685, scale_band: [0.676, 0.694],
  margin_pct: 64.8, rotation_deg: 0.5, gcp_residual_max_m: 27.08, gcp_holdout_max_m: 21.5,
  selected_gcps: 11, anisotropy: null, shear_deg: null, lot_zone_mismatch_pct: 3.2, pipeline_pass: true,
};

describe("recalage-attestation banc", () => {
  it("cas sain -> PASS-BANC", () => {
    const a = attestFromMetrics(CLEAN, { slug: "x" });
    expect(a.verdict).toBe("PASS-BANC");
    expect(a.degenerate).toBe(false);
  });

  it("residual > 30 m -> FAIL-BANC gcp_residual", () => {
    const a = attestFromMetrics({ ...CLEAN, gcp_residual_max_m: 41 }, { slug: "x" });
    expect(a.verdict).toBe("FAIL-BANC");
    expect(a.gates.gcp_residual).toBe("FAIL");
    expect(a.motif).toContain("gcp_residual");
  });

  it("holdout > 30 m -> FAIL-BANC", () => {
    const a = attestFromMetrics({ ...CLEAN, gcp_holdout_max_m: 33 }, { slug: "x" });
    expect(a.gates.gcp_residual).toBe("FAIL");
  });

  it("lot-zone mismatch >= 5% -> FAIL-BANC lot_zone", () => {
    const a = attestFromMetrics({ ...CLEAN, lot_zone_mismatch_pct: 7.4 }, { slug: "x" });
    expect(a.verdict).toBe("FAIL-BANC");
    expect(a.gates.lot_zone).toBe("FAIL");
  });

  it("dégénérescence échelle imprimée (mean_dist≈0 + verrou bord de bande) -> FAIL-BANC degenerate", () => {
    const deg = { ...CLEAN, chamfer_mean_dist_m: 0.02, scale_ratio: 0.677, margin_pct: 3 };
    const a = attestFromMetrics(deg, { slug: "x" });
    expect(a.degenerate).toBe(true);
    expect(a.verdict).toBe("FAIL-BANC");
    expect(a.motif).toContain("dégénérescence");
  });

  it("orientation : anisotropy > 1.1 -> FAIL", () => {
    const a = attestFromMetrics({ ...CLEAN, anisotropy: 1.35 }, { slug: "x" });
    expect(a.gates.orientation).toBe("FAIL");
    expect(a.verdict).toBe("FAIL-BANC");
  });

  it("métrique absente (residual null) -> FAIL-INDET, jamais PASS par défaut", () => {
    const a = attestFromMetrics({ ...CLEAN, gcp_residual_max_m: null }, { slug: "x" });
    expect(a.gates.gcp_residual).toBe("INDET");
    expect(a.verdict).toBe("FAIL-INDET");
  });

  it("seuils du banc gravés (résidu 30, aniso 1.1, shear 10, lot-zone 5)", () => {
    expect(BANC.residual_max_m).toBe(30);
    expect(BANC.anisotropy_max).toBe(1.1);
    expect(BANC.shear_max_deg).toBe(10);
    expect(BANC.lot_zone_mismatch_max_pct).toBe(5);
  });
});
