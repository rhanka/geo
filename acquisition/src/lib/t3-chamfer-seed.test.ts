import type { FeatureCollection } from "geojson";
import { describe, expect, it } from "vitest";

import {
  distanceTransform,
  sampleCadastreModel,
  searchChamferPose,
  type ModelPoint,
} from "./t3-chamfer-seed.js";

/** Brute-force Euclidean distance to the nearest ink pixel — the oracle. */
function bruteForceDistance(mask: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const ink: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] !== 0) ink.push([x, y]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      for (const [ix, iy] of ink) {
        const d = Math.hypot(ix - x, iy - y);
        if (d < best) best = d;
      }
      out[y * w + x] = best;
    }
  }
  return out;
}

function drawLine(mask: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): void {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
  }
}

/** A grid of rectangular "lots" around a real-ish Quebec location. */
function gridCadastre(cols: number, rows: number): FeatureCollection {
  const lon0 = -73.68;
  const lat0 = 45.83;
  const dLon = 0.004;
  const dLat = 0.0025;
  const features: FeatureCollection["features"] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = lon0 + c * dLon;
      const b = lat0 + r * dLat;
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [a, b],
              [a + dLon, b],
              [a + dLon, b + dLat],
              [a, b + dLat],
              [a, b],
            ],
          ],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** Render model points through a known pose, exactly as `scorePose` projects them. */
function renderModel(
  model: ModelPoint[],
  w: number,
  h: number,
  rotDeg: number,
  scalePxPerM: number,
  cx: number,
  cy: number,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const cos = Math.cos((rotDeg * Math.PI) / 180);
  const sin = Math.sin((rotDeg * Math.PI) / 180);
  let prev: [number, number] | null = null;
  for (const m of model) {
    const px = cx + scalePxPerM * (m.dx * cos + m.dy * sin);
    const py = cy + scalePxPerM * (m.dx * sin - m.dy * cos);
    if (px >= 0 && py >= 0 && px < w && py < h) mask[Math.round(py) * w + Math.round(px)] = 1;
    // Join consecutive samples so the synthetic sheet carries continuous ink,
    // the way a printed lot line actually looks.
    if (prev && Math.hypot(px - prev[0], py - prev[1]) < 30) drawLine(mask, w, h, prev[0], prev[1], px, py);
    prev = [px, py];
  }
  return mask;
}

describe("distanceTransform", () => {
  it("matches a brute-force Euclidean distance field exactly", () => {
    const w = 40;
    const h = 30;
    const mask = new Uint8Array(w * h);
    mask[5 * w + 7] = 1;
    mask[20 * w + 33] = 1;
    drawLine(mask, w, h, 2, 25, 30, 28);

    const got = distanceTransform(mask, w, h);
    const want = bruteForceDistance(mask, w, h);
    for (let i = 0; i < got.length; i++) {
      expect(got[i]!).toBeCloseTo(want[i]!, 6);
    }
  });

  it("reports zero on ink and grows away from it", () => {
    const w = 9;
    const h = 9;
    const mask = new Uint8Array(w * h);
    mask[4 * w + 4] = 1;
    const d = distanceTransform(mask, w, h);
    expect(d[4 * w + 4]).toBe(0);
    expect(d[4 * w + 5]).toBeCloseTo(1, 6);
    expect(d[0]).toBeCloseTo(Math.hypot(4, 4), 6);
  });
});

describe("sampleCadastreModel", () => {
  it("samples outlines at roughly uniform ground spacing", () => {
    const { points, bboxM } = sampleCadastreModel(gridCadastre(4, 4), 800);
    expect(points.length).toBeGreaterThan(200);
    // A 4x4 grid of ~310m x ~280m lots spans roughly 1.2km x 1.1km.
    expect(bboxM[0]).toBeGreaterThan(800);
    expect(bboxM[0]).toBeLessThan(2500);
    // Offsets are centred on the model centroid, so they straddle zero.
    expect(Math.min(...points.map((p) => p.dx))).toBeLessThan(0);
    expect(Math.max(...points.map((p) => p.dx))).toBeGreaterThan(0);
  });

  it("throws rather than guessing when the cadastre has no polygons", () => {
    expect(() => sampleCadastreModel({ type: "FeatureCollection", features: [] }, 100)).toThrow(/no polygon/i);
  });
});

describe("searchChamferPose", () => {
  const W = 420;
  const H = 380;
  const FRAME: [number, number, number, number] = [0, 0, W - 1, H - 1];

  function setup(truthRatio: number, truthCx: number, truthCy: number, rotDeg = 0) {
    const cadastre = gridCadastre(5, 5);
    const { points, bboxM } = sampleCadastreModel(cadastre, 1200);
    const fitToFrame = Math.min((W - 1) / bboxM[0], (H - 1) / bboxM[1]);
    const mask = renderModel(points, W, H, rotDeg, truthRatio * fitToFrame, truthCx, truthCy);
    return { points, fitToFrame, mask };
  }

  it("recovers a known pose from a synthetic plan", () => {
    const truthRatio = 0.8;
    const truthCx = W / 2;
    const truthCy = H / 2;
    const { points, fitToFrame, mask } = setup(truthRatio, truthCx, truthCy);
    const dist = distanceTransform(mask, W, H);

    const { best } = searchChamferPose({
      model: points,
      dist,
      width: W,
      height: H,
      frame: FRAME,
      fitToFrame,
      rotationsDeg: [0],
      minScaleRatio: 0.3,
      maxScaleRatio: 1.2,
      truncM: 300,
      inlierM: 25,
    });

    expect(best).not.toBeNull();
    expect(best!.scale_ratio).toBeCloseTo(truthRatio, 1);
    expect(Math.abs(best!.cx_px - truthCx)).toBeLessThan(5);
    expect(Math.abs(best!.cy_px - truthCy)).toBeLessThan(5);
    expect(best!.mean_dist_px).toBeLessThan(1.5);
    expect(best!.inlier_pct).toBeGreaterThan(90);
  });

  it("still recovers the pose when the sheet prints unrelated ink (roads, neighbours)", () => {
    const truthRatio = 0.7;
    const truthCx = W / 2 + 18;
    const truthCy = H / 2 - 12;
    const { points, fitToFrame, mask } = setup(truthRatio, truthCx, truthCy);
    // Ink the model cannot explain: an asymmetric score must not be dragged by it.
    for (let i = 0; i < 12; i++) drawLine(mask, W, H, 0, i * 31, W - 1, i * 27 + 40);
    drawLine(mask, W, H, 5, 5, 5, H - 5);
    const dist = distanceTransform(mask, W, H);

    const { best } = searchChamferPose({
      model: points,
      dist,
      width: W,
      height: H,
      frame: FRAME,
      fitToFrame,
      rotationsDeg: [0],
      minScaleRatio: 0.3,
      maxScaleRatio: 1.2,
      truncM: 300,
      inlierM: 25,
    });

    expect(best).not.toBeNull();
    expect(best!.scale_ratio).toBeCloseTo(truthRatio, 1);
    expect(Math.abs(best!.cx_px - truthCx)).toBeLessThan(6);
    expect(Math.abs(best!.cy_px - truthCy)).toBeLessThan(6);
  });

  it("resists the shrink degeneracy even when the scale band is left wide open", () => {
    // The regression this guards. Scored in PIXELS, the search collapses toward
    // a tiny agglutinated model (measured on saint-roch-ouest: it locked at
    // ratio 0.287 and reported a confident 1.2 px while being 36 m out on the
    // ground). Scored in GROUND METRES the shrink is self-defeating, so the true
    // pose must win here WITHOUT the band being the thing that saves it.
    const truthRatio = 0.8;
    const { points, fitToFrame, mask } = setup(truthRatio, W / 2, H / 2);
    const dist = distanceTransform(mask, W, H);

    const { best } = searchChamferPose({
      model: points,
      dist,
      width: W,
      height: H,
      frame: FRAME,
      fitToFrame,
      rotationsDeg: [0],
      minScaleRatio: 0.1,
      maxScaleRatio: 1.2,
      truncM: 300,
      inlierM: 25,
    });

    expect(best).not.toBeNull();
    expect(best!.scale_ratio).toBeGreaterThan(0.5);
    expect(best!.scale_ratio).toBeCloseTo(truthRatio, 1);
  });

  it("scores a blank sheet at the truncation floor instead of inventing a fit", () => {
    const { points, fitToFrame } = setup(0.8, W / 2, H / 2);
    const mask = new Uint8Array(W * H);
    mask[Math.round(H / 2) * W + Math.round(W / 2)] = 1;
    const dist = distanceTransform(mask, W, H);

    const { best } = searchChamferPose({
      model: points,
      dist,
      width: W,
      height: H,
      frame: FRAME,
      fitToFrame,
      rotationsDeg: [0],
      minScaleRatio: 0.3,
      maxScaleRatio: 1.2,
      truncM: 300,
      inlierM: 25,
    });

    expect(best).not.toBeNull();
    // No ink to explain: the run must look obviously bad rather than confident.
    expect(best!.mean_dist_m).toBeGreaterThan(200);
    expect(best!.inlier_pct).toBeLessThan(5);
  });
});
