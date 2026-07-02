/**
 * Unit tests for the --auto-seed orientation / isotropy gate (t2-autogcp.ts).
 *
 * Pure, network-free. The gate is the anti-invention safety net that stops the
 * auto-seed serving a residual-clean but GEOMETRICALLY WRONG affine (stretched,
 * mirrored, or rotated/flipped). We:
 *   1. sample GCPs from KNOWN affines (exact control of scale/rotation/mirror)
 *      and assert the decomposition recovers them and the gate verdict is right;
 *   2. replay the PROVEN-correct served coteau-du-lac control points and assert
 *      they clear the gate (page-right≈East, page-down≈South, anisotropy≈1.02);
 *   3. reproduce each real reject's failure mode (saint-cesaire/sainte-brigide =
 *      anisotropy; prevost = isometric-but-flipped orientation) and assert fail.
 */
import { describe, it, expect } from "vitest";

import { decomposeGcpAffine, decomposeGcpSimilarity, evaluateAffineGate } from "./t2-autogcp.js";
import type { Gcp } from "./t2-georef.js";

const PAGE_W = 3370;
const PAGE_H = 2384;
const M_PER_DEG_LAT = 111320;
const LAT0 = 45.4;
const LON0 = -74.19;
const M_PER_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

/**
 * Sample GCPs from a KNOWN page→ground linear map. `bearingRightDeg` is the
 * compass-math bearing of page +x (East=0, CCW). `mirror` flips handedness
 * (det < 0). Page +y is up (fy is top-down, so we use 1-fy).
 */
function sampleGcps(opts: {
  scaleRightM: number;
  scaleUpM: number;
  bearingRightDeg: number;
  mirror?: boolean;
}): Gcp[] {
  const t = (opts.bearingRightDeg * Math.PI) / 180;
  // page-right image (East,North):
  const rx = opts.scaleRightM * Math.cos(t);
  const ry = opts.scaleRightM * Math.sin(t);
  // page-up image: +90° from right for a proper (non-mirror) map; mirror ⇒ −90°.
  const up = t + (opts.mirror ? -Math.PI / 2 : Math.PI / 2);
  const ux = opts.scaleUpM * Math.cos(up);
  const uy = opts.scaleUpM * Math.sin(up);
  const fracs: Array<[number, number]> = [
    [0.15, 0.12],
    [0.85, 0.18],
    [0.9, 0.82],
    [0.12, 0.88],
    [0.5, 0.5],
    [0.3, 0.7],
    [0.7, 0.35],
    [0.55, 0.6],
  ];
  return fracs.map(([fx, fy], i) => {
    const px = fx * PAGE_W;
    const pyUp = (1 - fy) * PAGE_H;
    const eastM = rx * px + ux * pyUp;
    const northM = ry * px + uy * pyUp;
    return {
      fx,
      fy,
      lon: LON0 + eastM / M_PER_LON,
      lat: LAT0 + northM / M_PER_DEG_LAT,
      note: `synthetic #${i}`,
    };
  });
}

describe("decomposeGcpAffine", () => {
  it("recovers scale, orientation and non-mirror of a north-up isotropic map", () => {
    const d = decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!;
    expect(d).not.toBeNull();
    // Scale magnitude carries a small latitude-dependent offset (mPerLon is
    // taken at the mean GCP latitude); anisotropy/orientation are exact ratios.
    expect(d.scaleRightM).toBeCloseTo(6, 1);
    expect(d.scaleUpM).toBeCloseTo(6, 1);
    expect(d.anisotropy).toBeCloseTo(1, 2);
    expect(d.mirror).toBe(false);
    expect(d.bearingRightDeg).toBeCloseTo(0, 1);
    expect(d.bearingDownDeg).toBeCloseTo(-90, 1);
    expect(d.shearDeg).toBeLessThan(0.5);
  });

  it("measures anisotropy as max/min of the two axis scales", () => {
    const d = decomposeGcpAffine(sampleGcps({ scaleRightM: 3, scaleUpM: 7, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!;
    expect(d.anisotropy).toBeCloseTo(7 / 3, 2);
  });

  it("flags a reflected (mirror) map with a negative determinant", () => {
    const d = decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 0, mirror: true }), PAGE_W, PAGE_H)!;
    expect(d.determinant).toBeLessThan(0);
    expect(d.mirror).toBe(true);
  });

  it("returns null for too few points", () => {
    expect(decomposeGcpAffine([], PAGE_W, PAGE_H)).toBeNull();
  });
});

describe("evaluateAffineGate", () => {
  it("PASSES a north-up, isotropic, non-mirror affine", () => {
    const g = evaluateAffineGate(
      decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!,
    );
    expect(g.pass).toBe(true);
    expect(g.reasons).toHaveLength(0);
  });

  it("REJECTS an anisotropic fit (saint-cesaire / sainte-brigide failure mode)", () => {
    const g = evaluateAffineGate(
      decomposeGcpAffine(sampleGcps({ scaleRightM: 3, scaleUpM: 7, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!,
    );
    expect(g.pass).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/anisotropy/);
  });

  it("REJECTS a mirrored fit", () => {
    const g = evaluateAffineGate(
      decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 0, mirror: true }), PAGE_W, PAGE_H)!,
    );
    expect(g.pass).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/mirror|reflection/);
  });

  it("REJECTS an isometric but 180°-flipped fit (prevost failure mode)", () => {
    const d = decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 180 }), PAGE_W, PAGE_H)!;
    // Isotropic + non-mirror, so ONLY the orientation gate can catch it.
    expect(d.anisotropy).toBeCloseTo(1, 2);
    expect(d.mirror).toBe(false);
    const g = evaluateAffineGate(d);
    expect(g.pass).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/orientation not north-up/);
  });

  it("REJECTS a 90°-rotated fit", () => {
    const g = evaluateAffineGate(
      decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 90 }), PAGE_W, PAGE_H)!,
    );
    expect(g.pass).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/orientation not north-up/);
  });

  it("does NOT flag anisoArbitrate by default (legacy: empty band)", () => {
    // aniso 7/3 ≈ 2.33, north-up: reject with no hardAnisotropy → not arbitrable.
    const g = evaluateAffineGate(
      decomposeGcpAffine(sampleGcps({ scaleRightM: 3, scaleUpM: 7, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!,
    );
    expect(g.pass).toBe(false);
    expect(g.anisoArbitrate).toBe(false);
  });
});

describe("evaluateAffineGate — moderate-anisotropy arbitration band (arundel lever)", () => {
  it("FLAGS anisoArbitrate for a north-up, non-mirror fit with aniso in (max, hard] (arundel ≈1.2)", () => {
    // scaleRight 6 vs scaleUp 7.2 → aniso 1.2: still pass:false (not clean) but
    // arbitrable, because it is north-up, non-mirror and within the 1.5 band.
    const d = decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 7.2, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!;
    expect(d.anisotropy).toBeCloseTo(1.2, 1);
    const g = evaluateAffineGate(d, { hardAnisotropy: 1.5 });
    expect(g.pass).toBe(false); // never clean on geometry alone
    expect(g.anisoArbitrate).toBe(true);
  });

  it("HARD-rejects (not arbitrable) anisotropy above the band (saint-cesaire 2.6 / sainte-brigide 2.3)", () => {
    for (const aniso of [2.3, 2.6, 2.9]) {
      const d = decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 6 * aniso, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!;
      const g = evaluateAffineGate(d, { hardAnisotropy: 1.5 });
      expect(g.pass).toBe(false);
      expect(g.anisoArbitrate).toBe(false); // above 1.5 → never re-opened by lot-coverage
    }
  });

  it("does NOT flag arbitrate for a moderate-aniso but WRONG-orientation fit (orientation stays hard)", () => {
    // aniso 1.3 but 180°-flipped: orientation is a hard reject, so NOT arbitrable.
    const d = decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 7.8, bearingRightDeg: 180 }), PAGE_W, PAGE_H)!;
    const g = evaluateAffineGate(d, { hardAnisotropy: 1.5 });
    expect(g.pass).toBe(false);
    expect(g.anisoArbitrate).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/orientation not north-up/);
  });

  it("does NOT flag arbitrate for a clean isotropic fit (aniso ≤ max → no arbitration needed)", () => {
    const d = decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!;
    const g = evaluateAffineGate(d, { hardAnisotropy: 1.5 });
    expect(g.pass).toBe(true);
    expect(g.anisoArbitrate).toBe(false);
  });
});

describe("decomposeGcpSimilarity (Umeyama/Procrustes 2D fit)", () => {
  it("recovers scale + rotation of a pure north-up similarity, anisotropy exactly 1", () => {
    const d = decomposeGcpSimilarity(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!;
    expect(d).not.toBeNull();
    expect(d.anisotropy).toBe(1); // isotropic BY CONSTRUCTION
    expect(d.singularRatio).toBe(1);
    expect(d.shearDeg).toBe(0);
    expect(d.mirror).toBe(false);
    expect(d.scaleRightM).toBeCloseTo(6, 1);
    expect(d.bearingRightDeg).toBeCloseTo(0, 1);
    expect(d.bearingDownDeg).toBeCloseTo(-90, 1);
  });

  it("recovers an arbitrary rotation of a pure similarity", () => {
    const d = decomposeGcpSimilarity(sampleGcps({ scaleRightM: 5, scaleUpM: 5, bearingRightDeg: 30 }), PAGE_W, PAGE_H)!;
    expect(d.bearingRightDeg).toBeCloseTo(30, 1);
    expect(d.anisotropy).toBe(1);
    expect(d.mirror).toBe(false);
  });

  it("NEVER reports a reflection: a mirrored sample still decomposes to det>0 (no reflection representable)", () => {
    // A similarity has 4 DOF and cannot encode a reflection; the closed-form
    // solution always yields a PROPER rotation (det(R)=+1). This is the mission's
    // structural anti-mirror guarantee (vs the affine path, which must gate det<0).
    const affine = decomposeGcpAffine(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 0, mirror: true }), PAGE_W, PAGE_H)!;
    expect(affine.mirror).toBe(true); // affine SEES the reflection
    const sim = decomposeGcpSimilarity(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 0, mirror: true }), PAGE_W, PAGE_H)!;
    expect(sim.mirror).toBe(false); // similarity cannot represent it
    expect(sim.determinant).toBeGreaterThan(0);
  });

  it("is isotropic even on genuinely anisotropic data (the residual gate, not the decomposition, must reject that)", () => {
    // scaleRight 3 vs scaleUp 7: the AFFINE decomposition trips the iso-gate…
    const aff = decomposeGcpAffine(sampleGcps({ scaleRightM: 3, scaleUpM: 7, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!;
    expect(evaluateAffineGate(aff).pass).toBe(false);
    expect(evaluateAffineGate(aff).reasons.join(" ")).toMatch(/anisotropy/);
    // …while the SIMILARITY decomposition is isotropic by construction and would
    // clear the iso/orientation gate — it is the SEPARATE similarity-residual
    // gate (measured in deriveAutonomousGcps) that keeps such a stretch honest.
    const sim = decomposeGcpSimilarity(sampleGcps({ scaleRightM: 3, scaleUpM: 7, bearingRightDeg: 0 }), PAGE_W, PAGE_H)!;
    expect(sim.anisotropy).toBe(1);
    expect(evaluateAffineGate(sim).pass).toBe(true);
  });

  it("REJECTS a 180°-flipped similarity on orientation (isometric, non-mirror, wrong bearing)", () => {
    const d = decomposeGcpSimilarity(sampleGcps({ scaleRightM: 6, scaleUpM: 6, bearingRightDeg: 180 }), PAGE_W, PAGE_H)!;
    expect(d.mirror).toBe(false);
    expect(d.anisotropy).toBe(1);
    const g = evaluateAffineGate(d);
    expect(g.pass).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/orientation not north-up/);
  });

  it("returns null for too few points", () => {
    expect(decomposeGcpSimilarity([{ fx: 0.1, fy: 0.1, lon: LON0, lat: LAT0 }], PAGE_W, PAGE_H)).toBeNull();
  });
});

// PROVEN-correct served control points for coteau-du-lac (work/gcp/
// coteau-du-lac.autogcp.json) — the reference "servi correct" plan. Columns:
// [fx, fy, lon, lat]. Must clear the gate: near-isometric, north-up, non-mirror.
const COTEAU_SERVED: Array<[number, number, number, number]> = [
  [0.348823, 0.51119, -74.200985, 45.299588],
  [0.458377, 0.554972, -74.17456, 45.294249],
  [0.282407, 0.643138, -74.217, 45.283495],
  [0.544227, 0.463784, -74.153851, 45.305362],
  [0.379789, 0.608716, -74.193516, 45.287688],
  [0.421219, 0.491562, -74.183518, 45.301984],
  [0.542947, 0.518738, -74.154157, 45.29866],
  [0.378935, 0.710774, -74.193715, 45.275258],
  [0.424636, 0.713491, -74.182715, 45.274917],
  [0.284543, 0.49096, -74.216525, 45.302059],
  [0.433391, 0.585468, -74.180559, 45.290507],
  [0.561952, 0.407322, -74.149544, 45.312281],
  [0.358006, 0.480392, -74.198819, 45.303362],
  [0.331739, 0.580938, -74.205047, 45.291095],
  [0.265749, 0.696583, -74.221006, 45.276931],
  [0.391535, 0.40702, -74.19067, 45.312236],
  [0.590997, 0.46469, -74.142469, 45.305253],
  [0.561098, 0.285941, -74.149709, 45.326991],
  [0.379361, 0.755159, -74.193623, 45.269917],
  [0.244821, 0.658236, -74.22598, 45.281722],
  [0.423355, 0.305567, -74.182921, 45.324578],
  [0.420791, 0.396451, -74.183524, 45.313674],
  [0.195276, 0.425135, -74.237836, 45.310085],
  [0.444924, 0.163351, -74.177568, 45.342222],
];

describe("evaluateAffineGate — coteau-du-lac reference (servi correct)", () => {
  const COTEAU_PAGE_W = 3370.51;
  const COTEAU_PAGE_H = 2384.25;
  const gcps: Gcp[] = COTEAU_SERVED.map(([fx, fy, lon, lat]) => ({ fx, fy, lon, lat }));

  it("decomposes to a near-isometric, north-up, non-mirror affine", () => {
    const d = decomposeGcpAffine(gcps, COTEAU_PAGE_W, COTEAU_PAGE_H)!;
    expect(d.mirror).toBe(false);
    expect(d.anisotropy).toBeLessThan(1.05); // ≈1.02 measured
    expect(Math.abs(d.bearingRightDeg)).toBeLessThan(5); // ≈0° East
    expect(Math.abs(d.bearingDownDeg + 90)).toBeLessThan(5); // ≈-90° South
  });

  it("PASSES the gate (must not reject a proven-correct served plan)", () => {
    const g = evaluateAffineGate(decomposeGcpAffine(gcps, COTEAU_PAGE_W, COTEAU_PAGE_H)!);
    expect(g.pass).toBe(true);
  });

  it("similarity decomposition is also north-up, non-mirror and PASSES the gate", () => {
    const d = decomposeGcpSimilarity(gcps, COTEAU_PAGE_W, COTEAU_PAGE_H)!;
    expect(d.mirror).toBe(false);
    expect(d.anisotropy).toBe(1);
    expect(Math.abs(d.bearingRightDeg)).toBeLessThan(5); // ≈0° East
    expect(Math.abs(d.bearingDownDeg + 90)).toBeLessThan(5); // ≈-90° South
    expect(evaluateAffineGate(d).pass).toBe(true);
  });
});
