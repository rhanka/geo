/**
 * t3-chamfer-seed.ts — derive a COARSE seed registration for a RASTER zoning
 * plan by matching the real cadastre against the plan's own drawn linework.
 *
 * ## Why this exists
 *
 * The escalation ladder has a structural hole. For a vector plan, T2
 * (`deriveAutoSeedGcps`) seeds itself: it pairs `extractSvgVectorPoints` corners
 * against real cadastre parcel corners. For a plan that is a pasted IMAGE
 * (`svg_points = 0` — the dominant residue motif: a plan glued into a Word /
 * "Print To PDF" body), that seeding is impossible. T3
 * (`deriveRasterRegistration`) is the right refiner for such a plan, but it
 * REFINES a prior — its `maxCandidateDistanceM` default is 18 m, i.e. it needs a
 * seed that is already nearly correct — and nothing produces that seed. So a
 * raster plan is unreachable, not because it lacks the information, but because
 * no step bootstraps the search. This module is that step.
 *
 * ## The idea
 *
 * A municipal zoning plan DRAWS the cadastre (legend: "Cadastre") — the lot
 * lines are printed on the sheet. We already own the real cadastre as vectors.
 * So the plan's own ink is a registration target: find the (rotation, scale,
 * translation) that lays the real lot outlines onto the printed ones.
 *
 * Scoring is asymmetric chamfer matching on an exact Euclidean distance
 * transform (Felzenszwalb–Huttenlocher) of the plan's edge mask: each sampled
 * model point reads its distance to the NEAREST printed ink. Asymmetric is the
 * point — the sheet also prints roads, hydrography and the neighbouring munis'
 * lots, and ink with no model behind it must not be penalised. Truncation caps
 * the influence of any single outlier point.
 *
 * ## What this does NOT claim (anti-invention)
 *
 * The output is a SEED, never a served registration:
 *   - every emitted GCP is `independent: false` and tagged
 *     `cadastre-chamfer-seed`, so `checkIndependentGcps` refuses to count it as
 *     evidence — a seed can never be mistaken for a calibration;
 *   - the proof stays downstream and unchanged: T3 must re-derive INDEPENDENT
 *     controls by patch-verifying plan corners against real cadastre vertices
 *     under residual + holdout gates, and lot-coverage arbitrates the serve
 *     (spec §8). A seed that is subtly wrong dies there.
 *
 * ## The degeneracy this must not fall into
 *
 * Asymmetric chamfer has a trivial optimum: shrink the scale toward zero, every
 * model point collapses onto a single ink pixel, mean distance → 0. The search
 * is therefore bounded to a scale band expressed as a ratio of the
 * "fit-to-frame" scale (real cadastre bbox vs the map frame), which is a
 * measured quantity, not a guess. `scale_ratio` is reported so a run that locks
 * at a band edge is visible as suspicious rather than silently accepted.
 *
 * $0: poppler render + pure TS. No model, no network, no OCR.
 */
import type { FeatureCollection, Geometry, Position } from "geojson";

import { edgeMaskFromGray, renderPdfPagePgm, type EdgeImage, type GrayImage } from "./t2-raster-register.js";
import type { Gcp, GcpFile, NeatlineFrac } from "./t2-georef.js";

const M_PER_DEG_LAT = 111320;

export interface ChamferSeedOptions {
  slug: string;
  pdfPath: string;
  page: number;
  /** Page width in PDF points (MediaBox). */
  pageW: number;
  /** Page height in PDF points (MediaBox). */
  pageH: number;
  cadastre: FeatureCollection;
  /** Render DPI for the search. Default 150. */
  dpi?: number;
  /**
   * Map frame in page fractions. STRONGLY recommended: a sheet often carries an
   * inset map at a DIFFERENT scale; without a frame the search may lock onto it.
   */
  neatline?: NeatlineFrac;
  /** Map rotations to try, degrees clockwise from north-up. Default [0]. */
  rotationsDeg?: number[];
  /** Lower bound of the scale band, as a ratio of fit-to-frame scale. Default 0.30. */
  minScaleRatio?: number;
  /** Upper bound of the scale band, as a ratio of fit-to-frame scale. Default 1.20. */
  maxScaleRatio?: number;
  /** Target number of sampled model points. Default 2500. */
  modelPoints?: number;
  /** Outlier cap AND off-frame penalty, ground metres. Default 300. */
  truncM?: number;
  /** Distance under which a model point counts as landing on ink, metres. Default 25. */
  inlierM?: number;
  /** Number of seed GCPs to emit. Default 12. */
  seedGcps?: number;
}

export interface ChamferPose {
  rotation_deg: number;
  /** Pixels per metre. */
  scale_px_per_m: number;
  /** Scale as a ratio of the fit-to-frame scale (band-edge lock detector). */
  scale_ratio: number;
  /** Model centroid position in pixels. */
  cx_px: number;
  cy_px: number;
  /** Mean truncated model→ink distance in GROUND METRES — the score, lower is better. */
  mean_dist_m: number;
  /** Same, expressed on the sheet via this pose's own scale (diagnostic only). */
  mean_dist_px: number;
  /** Share of model points landing within `inlierM` of printed ink. */
  inlier_pct: number;
}

export interface ChamferSeedReport {
  slug: string;
  method: "cadastre-chamfer-seed";
  pass: boolean;
  reason?: string;
  dpi: number;
  page: number;
  model_points: number;
  plan_edge_pixels: number;
  frame_px: [number, number, number, number];
  fit_to_frame_px_per_m: number;
  best: ChamferPose | null;
  runner_up: ChamferPose | null;
  /** Relative score margin of best over the best DISTINCT-pose runner-up, %. */
  margin_pct: number | null;
  scale_band: [number, number];
  gcp_file?: GcpFile;
}

export interface ModelPoint {
  /** Local metric offset from the model centroid. */
  dx: number;
  dy: number;
  lon: number;
  lat: number;
}

export interface PoseSearchOptions {
  model: ModelPoint[];
  /** Distance-to-ink field, pixels, row-major `width * height`. */
  dist: Float64Array;
  width: number;
  height: number;
  /** Map frame in pixels: [x0, y0, x1, y1]. */
  frame: [number, number, number, number];
  /** Pixels per metre that makes the model bbox fit the frame. */
  fitToFrame: number;
  rotationsDeg: number[];
  minScaleRatio: number;
  maxScaleRatio: number;
  /** Outlier cap AND off-frame penalty, ground metres. */
  truncM: number;
  /** Distance under which a model point counts as landing on printed ink, metres. */
  inlierM: number;
}

/** Exact squared 1D distance transform (Felzenszwalb & Huttenlocher, 2012). */
function dt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const d = q - v[k]!;
    out[q] = d * d + f[v[k]!]!;
  }
}

/**
 * Exact Euclidean distance transform (in pixels) of an edge mask.
 * `mask[i] !== 0` marks ink; the result holds the distance to the nearest ink.
 */
export function distanceTransform(mask: Uint8Array, width: number, height: number): Float64Array {
  const INF = 1e12;
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] !== 0 ? 0 : INF;

  const maxDim = Math.max(width, height);
  const f = new Float64Array(maxDim);
  const out = new Float64Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float64Array(maxDim + 1);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!;
    dt1d(f, height, out, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = out[y]!;
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x]!;
    dt1d(f, width, out, v, z);
    for (let x = 0; x < width; x++) grid[row + x] = Math.sqrt(out[x]!);
  }
  return grid;
}

function scanRings(geom: Geometry | null | undefined, cb: (ring: Position[]) => void): void {
  if (!geom) return;
  if (geom.type === "Polygon") for (const ring of geom.coordinates) cb(ring);
  else if (geom.type === "MultiPolygon") for (const poly of geom.coordinates) for (const ring of poly) cb(ring);
}

/**
 * Sample the cadastre outlines at a roughly uniform ground spacing.
 *
 * Uniform ARC-LENGTH sampling matters: raw vertices cluster where surveyors
 * happened to break a line, which would silently weight the score toward
 * whichever corner of town has the busiest geometry.
 */
export function sampleCadastreModel(
  cadastre: FeatureCollection,
  targetPoints: number,
): { points: ModelPoint[]; lat0: number; bboxM: [number, number]; centroid: { lon: number; lat: number } } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const feat of cadastre.features) {
    scanRings(feat.geometry, (ring) => {
      for (const p of ring) {
        const lon = p[0]!;
        const lat = p[1]!;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
    });
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) {
    throw new Error("cadastre carries no polygon coordinates");
  }
  const lat0 = (minLat + maxLat) / 2;
  const mPerLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const toM = (lon: number, lat: number): [number, number] => [lon * mPerLon, lat * M_PER_DEG_LAT];

  const [minXm, minYm] = toM(minLon, minLat);
  const [maxXm, maxYm] = toM(maxLon, maxLat);
  const bboxM: [number, number] = [maxXm - minXm, maxYm - minYm];
  const centroid = { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 };
  const [cxm, cym] = toM(centroid.lon, centroid.lat);

  let totalLenM = 0;
  for (const feat of cadastre.features) {
    scanRings(feat.geometry, (ring) => {
      for (let i = 1; i < ring.length; i++) {
        const a = toM(ring[i - 1]![0]!, ring[i - 1]![1]!);
        const b = toM(ring[i]![0]!, ring[i]![1]!);
        totalLenM += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    });
  }
  const stepM = Math.max(1, totalLenM / Math.max(1, targetPoints));

  const points: ModelPoint[] = [];
  let carry = 0;
  for (const feat of cadastre.features) {
    scanRings(feat.geometry, (ring) => {
      for (let i = 1; i < ring.length; i++) {
        const aLon = ring[i - 1]![0]!;
        const aLat = ring[i - 1]![1]!;
        const bLon = ring[i]![0]!;
        const bLat = ring[i]![1]!;
        const a = toM(aLon, aLat);
        const b = toM(bLon, bLat);
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen <= 0) continue;
        let t = carry;
        while (t < segLen) {
          const r = t / segLen;
          const xm = a[0] + (b[0] - a[0]) * r;
          const ym = a[1] + (b[1] - a[1]) * r;
          points.push({
            dx: xm - cxm,
            dy: ym - cym,
            lon: aLon + (bLon - aLon) * r,
            lat: aLat + (bLat - aLat) * r,
          });
          t += stepM;
        }
        carry = t - segLen;
      }
    });
  }
  return { points, lat0, bboxM, centroid };
}

function frameBounds(
  neatline: NeatlineFrac | undefined,
  pageW: number,
  pageH: number,
  scale: number,
  width: number,
  height: number,
): [number, number, number, number] {
  if (!neatline) return [0, 0, width - 1, height - 1];
  const x0 = Math.max(0, Math.floor(Math.min(neatline.fx0, neatline.fx1) * pageW * scale));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(neatline.fx0, neatline.fx1) * pageW * scale));
  const y0 = Math.max(0, Math.floor(Math.min(neatline.fy0, neatline.fy1) * pageH * scale));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(neatline.fy0, neatline.fy1) * pageH * scale));
  return [x0, y0, x1, y1];
}

/** Zero every edge pixel outside the map frame, so insets/legends cannot attract the fit. */
function maskToFrame(edges: EdgeImage, frame: [number, number, number, number]): { mask: Uint8Array; count: number } {
  const [x0, y0, x1, y1] = frame;
  const mask = new Uint8Array(edges.width * edges.height);
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * edges.width + x;
      if (edges.data[i] !== 0) {
        mask[i] = 1;
        count++;
      }
    }
  }
  return { mask, count };
}

/**
 * Mean truncated model→ink distance, IN GROUND METRES.
 *
 * The unit is the whole point. Scoring in PIXELS makes the search degenerate:
 * shrinking the scale shrinks every pixel error with it, so the optimum runs
 * away to a tiny model agglutinated on a blob of ink (measured: it locked at
 * scale_ratio 0.287 with a 36 m ground error, and reported a confident 1.2 px).
 * Ground metres are scale-invariant, which removes the reward:
 *   - scale → 0 : dist_px/scale explodes, every point saturates at truncM;
 *   - scale → ∞ : the model leaves the frame, every point saturates at truncM;
 *   - true pose : lot lines land on printed lot lines, a few metres out.
 * So both degeneracies score WORSE than the honest fit instead of beating it.
 *
 * Points outside the map frame are charged the full truncM: the sheet draws the
 * whole municipality, so a pose pushing the cadastre off-frame is wrong.
 */
function scorePose(
  model: ModelPoint[],
  dist: Float64Array,
  width: number,
  height: number,
  frame: [number, number, number, number],
  rotRad: number,
  scalePxPerM: number,
  cxPx: number,
  cyPx: number,
  truncM: number,
  inlierM: number,
): { meanM: number; inlierPct: number } {
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  const [fx0, fy0, fx1, fy1] = frame;
  const invScale = 1 / Math.max(scalePxPerM, 1e-9);
  let sum = 0;
  let inliers = 0;
  for (let i = 0; i < model.length; i++) {
    const m = model[i]!;
    const px = cxPx + scalePxPerM * (m.dx * cos + m.dy * sin);
    const py = cyPx + scalePxPerM * (m.dx * sin - m.dy * cos);
    const ix = px | 0;
    const iy = py | 0;
    if (ix < fx0 || iy < fy0 || ix > fx1 || iy > fy1 || ix < 0 || iy < 0 || ix >= width || iy >= height) {
      sum += truncM;
      continue;
    }
    let dM = dist[iy * width + ix]! * invScale;
    if (dM > truncM) dM = truncM;
    else if (dM <= inlierM) inliers++;
    sum += dM;
  }
  return { meanM: sum / model.length, inlierPct: (inliers / model.length) * 100 };
}

function posesAreDistinct(a: ChamferPose, b: ChamferPose, framePx: number): boolean {
  if (a.rotation_deg !== b.rotation_deg) return true;
  const dc = Math.hypot(a.cx_px - b.cx_px, a.cy_px - b.cy_px);
  const ds = Math.abs(a.scale_ratio - b.scale_ratio) / Math.max(a.scale_ratio, 1e-9);
  return dc > framePx * 0.05 || ds > 0.05;
}

/**
 * Search (rotation × scale × translation) for the pose laying the real cadastre
 * onto the plan's printed linework: a coarse grid sweep, then a local
 * refinement that also opens a small rotation window (a sheet pasted as an
 * image is rarely exactly square).
 *
 * Pure: takes a distance field, touches no PDF and no disk, so it can be
 * exercised against a synthetic plan with a known ground-truth pose.
 */
export function searchChamferPose(opts: PoseSearchOptions): {
  best: ChamferPose | null;
  runnerUp: ChamferPose | null;
  margin: number | null;
} {
  const { model, dist, width, height, frame, fitToFrame, truncM, inlierM } = opts;
  const [fx0, fy0, fx1, fy1] = frame;
  const frameW = fx1 - fx0;
  const frameH = fy1 - fy0;

  const evaluate = (rotDeg: number, ratio: number, cx: number, cy: number): ChamferPose => {
    const s = ratio * fitToFrame;
    const { meanM, inlierPct } = scorePose(
      model,
      dist,
      width,
      height,
      frame,
      (rotDeg * Math.PI) / 180,
      s,
      cx,
      cy,
      truncM,
      inlierM,
    );
    return {
      rotation_deg: rotDeg,
      scale_px_per_m: s,
      scale_ratio: ratio,
      cx_px: cx,
      cy_px: cy,
      mean_dist_m: meanM,
      mean_dist_px: meanM * s,
      inlier_pct: inlierPct,
    };
  };

  // Coarse sweep. Translation steps stay well under the model footprint so no
  // plausible pose falls between samples.
  const poses: ChamferPose[] = [];
  const ratioStep = 0.05;
  const transStep = Math.max(6, Math.min(frameW, frameH) / 28);
  for (const rotDeg of opts.rotationsDeg) {
    for (let ratio = opts.minScaleRatio; ratio <= opts.maxScaleRatio + 1e-9; ratio += ratioStep) {
      for (let cy = fy0; cy <= fy1; cy += transStep) {
        for (let cx = fx0; cx <= fx1; cx += transStep) {
          poses.push(evaluate(rotDeg, ratio, cx, cy));
        }
      }
    }
  }
  if (poses.length === 0) return { best: null, runnerUp: null, margin: null };
  poses.sort((a, b) => a.mean_dist_m - b.mean_dist_m);

  let best = poses[0]!;
  let step = transStep;
  let rStep = ratioStep;
  for (let iter = 0; iter < 5; iter++) {
    step /= 2.5;
    rStep /= 2.5;
    let improved = best;
    for (const dRot of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
      for (let ratio = best.scale_ratio - rStep * 2; ratio <= best.scale_ratio + rStep * 2 + 1e-9; ratio += rStep) {
        // The band is a hard bound, not a hint: never let the refinement walk
        // outside the scale range the caller declared plausible.
        if (ratio < opts.minScaleRatio || ratio > opts.maxScaleRatio) continue;
        for (let cy = best.cy_px - step * 2; cy <= best.cy_px + step * 2 + 1e-9; cy += step) {
          for (let cx = best.cx_px - step * 2; cx <= best.cx_px + step * 2 + 1e-9; cx += step) {
            const p = evaluate(best.rotation_deg + dRot, ratio, cx, cy);
            if (p.mean_dist_m < improved.mean_dist_m) improved = p;
          }
        }
      }
    }
    best = improved;
  }

  const runnerUp = poses.find((p) => posesAreDistinct(p, best, Math.min(frameW, frameH))) ?? null;
  const margin = runnerUp
    ? Number((((runnerUp.mean_dist_m - best.mean_dist_m) / Math.max(runnerUp.mean_dist_m, 1e-9)) * 100).toFixed(2))
    : null;
  return { best, runnerUp, margin };
}

/**
 * End-to-end: render the plan page, build its edge distance field, sample the
 * real cadastre, search the pose, and emit a coarse seed `GcpFile`.
 */
export async function deriveChamferSeed(opts: ChamferSeedOptions): Promise<ChamferSeedReport> {
  const dpi = opts.dpi ?? 150;
  const rotations = opts.rotationsDeg ?? [0];
  const minScaleRatio = opts.minScaleRatio ?? 0.3;
  const maxScaleRatio = opts.maxScaleRatio ?? 1.2;
  const truncM = opts.truncM ?? 300;
  const inlierM = opts.inlierM ?? 25;
  const seedGcps = opts.seedGcps ?? 12;
  const scale = dpi / 72;

  const plan: GrayImage = renderPdfPagePgm(opts.pdfPath, opts.page, dpi);
  const edges = edgeMaskFromGray(plan);
  const frame = frameBounds(opts.neatline, opts.pageW, opts.pageH, scale, plan.width, plan.height);
  const { mask, count: edgePixels } = maskToFrame(edges, frame);

  const model = sampleCadastreModel(opts.cadastre, opts.modelPoints ?? 2500);
  const base: ChamferSeedReport = {
    slug: opts.slug,
    method: "cadastre-chamfer-seed",
    pass: false,
    dpi,
    page: opts.page,
    model_points: model.points.length,
    plan_edge_pixels: edgePixels,
    frame_px: frame,
    fit_to_frame_px_per_m: 0,
    best: null,
    runner_up: null,
    margin_pct: null,
    scale_band: [minScaleRatio, maxScaleRatio],
  };
  if (edgePixels < 500) {
    return { ...base, reason: `only ${edgePixels} edge pixels inside the map frame — nothing to register against` };
  }
  if (model.points.length < 50) {
    return { ...base, reason: `only ${model.points.length} sampled cadastre model points (< 50)` };
  }

  const dist = distanceTransform(mask, plan.width, plan.height);
  const [fx0, fy0, fx1, fy1] = frame;
  const frameW = fx1 - fx0;
  const frameH = fy1 - fy0;
  const fitToFrame = Math.min(frameW / Math.max(model.bboxM[0], 1), frameH / Math.max(model.bboxM[1], 1));
  base.fit_to_frame_px_per_m = Number(fitToFrame.toFixed(6));

  const { best, runnerUp, margin } = searchChamferPose({
    model: model.points,
    dist,
    width: plan.width,
    height: plan.height,
    frame,
    fitToFrame,
    rotationsDeg: rotations,
    minScaleRatio,
    maxScaleRatio,
    truncM,
    inlierM,
  });
  if (!best) return { ...base, reason: "empty search grid" };

  // Emit seed controls by projecting REAL cadastre points through the winning
  // pose, spread over the model so the downstream affine is well conditioned.
  const stride = Math.max(1, Math.floor(model.points.length / seedGcps));
  const cos = Math.cos((best.rotation_deg * Math.PI) / 180);
  const sin = Math.sin((best.rotation_deg * Math.PI) / 180);
  const gcps: Gcp[] = [];
  for (let i = 0; i < model.points.length && gcps.length < seedGcps; i += stride) {
    const m = model.points[i]!;
    const px = best.cx_px + best.scale_px_per_m * (m.dx * cos + m.dy * sin);
    const py = best.cy_px + best.scale_px_per_m * (m.dx * sin - m.dy * cos);
    gcps.push({
      fx: px / scale / opts.pageW,
      fy: py / scale / opts.pageH,
      lon: m.lon,
      lat: m.lat,
      source: "cadastre-chamfer-seed",
      independent: false,
      note:
        `COARSE SEED ONLY (never a calibration): chamfer pose rot=${best.rotation_deg.toFixed(2)}deg ` +
        `scale=${best.scale_px_per_m.toFixed(4)}px/m ratio=${best.scale_ratio.toFixed(3)} ` +
        `mean_ground_dist=${best.mean_dist_m.toFixed(1)}m inliers=${best.inlier_pct.toFixed(1)}%`,
    });
  }

  const gcpFile: GcpFile = {
    slug: opts.slug,
    pdf: opts.pdfPath,
    page: opts.page,
    pageW: opts.pageW,
    pageH: opts.pageH,
    gcps,
    ...(opts.neatline ? { neatline: opts.neatline } : {}),
  };

  return {
    ...base,
    pass: gcps.length >= 3,
    ...(gcps.length >= 3 ? {} : { reason: `only ${gcps.length} seed controls emitted (< 3)` }),
    best,
    runner_up: runnerUp,
    margin_pct: margin === null ? null : Number(margin.toFixed(2)),
    ...(gcps.length >= 3 ? { gcp_file: gcpFile } : {}),
  };
}
