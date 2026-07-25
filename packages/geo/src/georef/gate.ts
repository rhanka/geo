/**
 * georef/gate.ts — the orientation / isotropy / mirror gate that keeps an
 * auto-derived georeferencing from serving a residual-clean but GEOMETRICALLY
 * WRONG map.
 *
 * A parcel/linework matcher can lock onto a set of control points that is
 * mutually consistent (low residual + holdout) yet globally wrong: the page→
 * ground affine comes out anisotropically stretched (bbox forced to fill a
 * mismatched extent), mirrored, or rotated/flipped 90°/180°. Those pass the
 * residual gate but encode false geometry. This module decomposes the fitted
 * map into interpretable scale / orientation / shear / mirror terms
 * ({@link decomposeGcpAffine} for the free 6-parameter affine,
 * {@link decomposeGcpSimilarity} for the isotropic-by-construction 4-parameter
 * similarity) and {@link evaluateAffineGate} refuses to serve unless the geometry
 * is a near-isometric, non-mirrored, north-up map — matching the PROVEN-correct
 * reference (coteau-du-lac: page-right≈East, page-down≈South, anisotropy≈1.02).
 *
 * Ported (pure compute, zero I/O) from the acquisition recalage pipeline
 * (`acquisition/src/lib/t2-autogcp.ts`). Reuses {@link fitAffine} and the
 * {@link Gcp} contract from this same `georef` module; the pdftocairo/cadastre
 * matching that PRODUCES the control points stays in the acquisition app layer.
 */
import { fitAffine } from "./affine.js";
import type { Gcp } from "./gcp.js";

const M_PER_DEG_LAT = 111320;

/* ------------------------------------------------------------------------- *
 * Least-squares 2D similarity (Umeyama/Procrustes) — closed form, no SVD.
 *
 * For centred source x_i (page, y-up) and target y_i (ground metres), the proper
 * rotation that maximises Σ y_i·(R x_i) is θ = atan2(B, A) with A = Σ (x·y dot),
 * B = Σ (x→y cross); this ALWAYS yields det(R)=+1 (no reflection representable),
 * the uniform scale is s = √(A²+B²)/Σ‖x_i‖², and t = μy − s R μx.
 * ------------------------------------------------------------------------- */
interface Similarity2D {
  /** Uniform scale (ground metres per page unit). */
  s: number;
  /** Rotation cos/sin: R = [[cos, −sin], [sin, cos]] (proper, det=+1). */
  cos: number;
  sin: number;
  /** Translation (ground metres). */
  tx: number;
  ty: number;
}

/** Least-squares 2D similarity mapping `src`→`dst`; null when degenerate. */
function fitSimilarity2D(src: Array<[number, number]>, dst: Array<[number, number]>): Similarity2D | null {
  const n = src.length;
  if (n < 2 || dst.length !== n) return null;
  let mux = 0;
  let muy = 0;
  let mvx = 0;
  let mvy = 0;
  for (let i = 0; i < n; i++) {
    mux += src[i]![0];
    muy += src[i]![1];
    mvx += dst[i]![0];
    mvy += dst[i]![1];
  }
  mux /= n;
  muy /= n;
  mvx /= n;
  mvy /= n;
  let A = 0; // Σ (src·dst)  → cosθ term
  let B = 0; // Σ (src→dst cross) → sinθ term
  let sxx = 0; // Σ ‖src_centred‖²
  for (let i = 0; i < n; i++) {
    const ax = src[i]![0] - mux;
    const ay = src[i]![1] - muy;
    const bx = dst[i]![0] - mvx;
    const by = dst[i]![1] - mvy;
    A += bx * ax + by * ay;
    B += by * ax - bx * ay;
    sxx += ax * ax + ay * ay;
  }
  if (sxx === 0) return null;
  const norm = Math.hypot(A, B);
  if (norm === 0) return null; // no correlated rotation (degenerate/collinear)
  const cos = A / norm;
  const sin = B / norm;
  const s = norm / sxx;
  const tx = mvx - s * (cos * mux - sin * muy);
  const ty = mvy - s * (sin * mux + cos * muy);
  if (![s, cos, sin, tx, ty].every(Number.isFinite)) return null;
  return { s, cos, sin, tx, ty };
}

// ---------------------------------------------------------------------------
// Decomposition + gate.
// ---------------------------------------------------------------------------

export interface AffineDecomposition {
  /** QR scale of the page +x (right) axis, in metres per page unit. */
  sx: number;
  /** QR signed scale of the page +y axis (= det/sx); negative ⇒ reflection. */
  sy: number;
  /** Euclidean length of the page-right column vector (m/page-unit). */
  scaleRightM: number;
  /** Euclidean length of the page-up column vector (m/page-unit). */
  scaleUpM: number;
  /** max(|sx|,|sy|)/min(|sx|,|sy|) — the mission's scale-anisotropy metric. */
  anisotropy: number;
  /** Ratio of singular values (condition number): catches stretch AND shear. */
  singularRatio: number;
  /** Signed determinant of the page→ground linear map. */
  determinant: number;
  /** true when det < 0 ⇒ the map is mirrored/reflected. */
  mirror: boolean;
  /** Compass-math bearing of page +x (right); East=0°, North=+90°, CCW. */
  bearingRightDeg: number;
  /** Compass-math bearing of page +y-down; South is −90° for a north-up map. */
  bearingDownDeg: number;
  /** Signed angle page-right→page-up; +90° north-up, −90° mirrored. */
  axisAngleDeg: number;
  /** |90 − |axisAngle||: deviation from orthogonal axes (shear/skew), degrees. */
  shearDeg: number;
}

export interface AffineGateOptions {
  /** Reject when the scale/singular anisotropy exceeds this ratio. */
  maxAnisotropy?: number;
  /** Reject when page-right/page-down deviate from East/South by more (deg). */
  orientationToleranceDeg?: number;
  /** Reject when the page axes are non-orthogonal by more than this (deg). */
  maxShearDeg?: number;
  /**
   * Anisotropy at/above which stretch is a HARD reject (big stretch = suspect,
   * e.g. saint-cesaire 2.6, sainte-brigide 2.3). Anisotropy in the MODERATE band
   * `(maxAnisotropy, hardAnisotropy]` is NOT clean but is not hard-rejected
   * either: it is flagged `anisoArbitrate` so the caller can confirm the stretch
   * is REAL via tight lot-coverage before serving (arundel ≈1.2). Defaults to
   * `maxAnisotropy` — i.e. no band, legacy behaviour (aniso > maxAnisotropy hard).
   */
  hardAnisotropy?: number;
}

export interface AffineGateResult {
  pass: boolean;
  reasons: string[];
  decomposition: AffineDecomposition;
  /**
   * true when the fit clears every HARD criterion (non-mirror, non-shear,
   * north-up, anisotropy ≤ hardAnisotropy) and the ONLY thing keeping it from a
   * clean pass is a MODERATE anisotropy in `(maxAnisotropy, hardAnisotropy]`.
   * Such a fit must be confirmed by tight lot-coverage before serving; it is
   * never served on geometry alone. Always false when hardAnisotropy is unset.
   */
  anisoArbitrate: boolean;
}

export const DEFAULT_AFFINE_GATE: Required<AffineGateOptions> = {
  maxAnisotropy: 1.1,
  orientationToleranceDeg: 15,
  maxShearDeg: 10,
  hardAnisotropy: 1.1,
};

/** Default upper anisotropy bound of the lot-arbitration band (hard reject above). */
export const DEFAULT_ANISO_ARBITRATE_MAX_ANISOTROPY = 1.5;

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Shortest absolute angular distance (deg) between two bearings. */
function angularDistDeg(a: number, b: number): number {
  return Math.abs(normalizeDeg(a - b));
}

/**
 * Decompose the least-squares page→ground affine implied by a set of control
 * points into interpretable scale / orientation / shear / mirror terms.
 *
 * Page space uses PDF units with y pointing UP (fy is top-down, so we flip it).
 * Ground space is local metres (East = +x via lon·m/deg at the mean latitude,
 * North = +y via lat·m/deg). Returns null when there are too few points or the
 * fit is degenerate (no usable geometry).
 */
export function decomposeGcpAffine(gcps: Gcp[], pageW: number, pageH: number): AffineDecomposition | null {
  if (gcps.length < 3) return null;
  const pagePts = gcps.map((g) => [g.fx * pageW, (1 - g.fy) * pageH] as [number, number]);
  const lons = gcps.map((g) => g.lon);
  const lats = gcps.map((g) => g.lat);
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const mPerLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  const cLon = fitAffine(pagePts, lons);
  const cLat = fitAffine(pagePts, lats);
  // Linear map (page +x, page +y-up) → (East m, North m); matrix columns are
  // the images of the page basis vectors: right=(a,b), up=(c,d).
  const a = cLon[0] * mPerLon; // ∂East/∂px
  const c = cLon[1] * mPerLon; // ∂East/∂py_up
  const b = cLat[0] * M_PER_DEG_LAT; // ∂North/∂px
  const d = cLat[1] * M_PER_DEG_LAT; // ∂North/∂py_up
  if (![a, b, c, d].every(Number.isFinite)) return null;
  const determinant = a * d - b * c;
  const sx = Math.hypot(a, b);
  if (sx === 0) return null;
  const sy = determinant / sx;
  const scaleRightM = Math.hypot(a, b);
  const scaleUpM = Math.hypot(c, d);
  const absSx = Math.abs(sx);
  const absSy = Math.abs(sy);
  const anisotropy = Math.min(absSx, absSy) === 0 ? Infinity : Math.max(absSx, absSy) / Math.min(absSx, absSy);
  // Singular values of [[a,c],[b,d]] (condition number = stretch incl. shear).
  const eAvg = (a * a + b * b + c * c + d * d) / 2;
  const fRad = Math.hypot((a * a + b * b - c * c - d * d) / 2, a * c + b * d);
  const s1 = Math.sqrt(Math.max(0, eAvg + fRad));
  const s2 = Math.sqrt(Math.max(0, eAvg - fRad));
  const singularRatio = s2 === 0 ? Infinity : s1 / s2;
  const bearingRightDeg = (Math.atan2(b, a) * 180) / Math.PI; // page +x
  const bearingDownDeg = (Math.atan2(-d, -c) * 180) / Math.PI; // page +y-down = −(up)
  const angRight = Math.atan2(b, a);
  const angUp = Math.atan2(d, c);
  const axisAngleDeg = normalizeDeg(((angUp - angRight) * 180) / Math.PI);
  const shearDeg = Math.abs(Math.abs(axisAngleDeg) - 90);
  return {
    sx,
    sy,
    scaleRightM,
    scaleUpM,
    anisotropy,
    singularRatio,
    determinant,
    mirror: determinant < 0,
    bearingRightDeg,
    bearingDownDeg,
    axisAngleDeg,
    shearDeg,
  };
}

/**
 * Decompose the least-squares page→ground SIMILARITY implied by a set of control
 * points, returned in the SAME `AffineDecomposition` shape so the auto-seed
 * loop, orientation-candidate set and lot-disambig plumbing are model-agnostic.
 *
 * By construction a similarity has anisotropy = 1, singularRatio = 1, shear = 0
 * and det = s² > 0 (never a reflection), so the shared `evaluateAffineGate` only
 * exercises its ORIENTATION check on this — which is exactly the intent: on a
 * partial-extent plan the free affine trips the anisotropy gate, but the honest
 * similarity geometry is isotropic and is judged solely on being north-up (or,
 * failing that, disambiguated by cadastre lot-assignment like the affine path).
 */
export function decomposeGcpSimilarity(gcps: Gcp[], pageW: number, pageH: number): AffineDecomposition | null {
  if (gcps.length < 2) return null;
  const lats = gcps.map((g) => g.lat);
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const mPerLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  const src = gcps.map((g) => [g.fx * pageW, (1 - g.fy) * pageH] as [number, number]);
  const dst = gcps.map((g) => [g.lon * mPerLon, g.lat * M_PER_DEG_LAT] as [number, number]);
  const sim = fitSimilarity2D(src, dst);
  if (!sim || sim.s <= 0 || !Number.isFinite(sim.s)) return null;
  const s = sim.s;
  // page-right (1,0) → s·(cos, sin); page-up (0,1) → s·(−sin, cos); page-down = −up.
  const bearingRightDeg = (Math.atan2(sim.sin, sim.cos) * 180) / Math.PI;
  const bearingDownDeg = (Math.atan2(-sim.cos, sim.sin) * 180) / Math.PI;
  const angRight = Math.atan2(sim.sin, sim.cos);
  const angUp = Math.atan2(sim.cos, -sim.sin);
  const axisAngleDeg = normalizeDeg(((angUp - angRight) * 180) / Math.PI); // +90 (proper rotation)
  return {
    sx: s,
    sy: s,
    scaleRightM: s,
    scaleUpM: s,
    anisotropy: 1,
    singularRatio: 1,
    determinant: s * s,
    mirror: false,
    bearingRightDeg,
    bearingDownDeg,
    axisAngleDeg,
    shearDeg: 0,
  };
}

/**
 * Hard gate on a decomposed affine. Fails (with explicit reasons) on:
 *  - reflection/mirror (det < 0),
 *  - anisotropy — scale ratio OR singular-value ratio — above `maxAnisotropy`,
 *  - non-orthogonal (sheared) page axes above `maxShearDeg`,
 *  - orientation that is not coherent north-up: page-right must be East±tol and
 *    page-down must be South±tol. A merely-rotated (e.g. 90°/180°-flipped)
 *    affine is NOT trusted here even when isometric, because a single affine
 *    cannot distinguish a genuinely rotated sheet from a wrong-orientation lock;
 *    the auto-seed's cross-candidate convergence check is what would clear a
 *    truly rotated plan. This keeps the served geometry provably north-up.
 */
export function evaluateAffineGate(decomp: AffineDecomposition, options: AffineGateOptions = {}): AffineGateResult {
  const o = { ...DEFAULT_AFFINE_GATE, ...options };
  // Hard-reject anisotropy threshold: at/above it, stretch is refused outright.
  // Between o.maxAnisotropy (clean floor) and here is the arbitration band. When
  // no hardAnisotropy was supplied it equals maxAnisotropy → band is empty.
  const hardAniso = Math.max(o.maxAnisotropy, o.hardAnisotropy);
  const reasons: string[] = [];
  if (decomp.mirror) reasons.push(`mirror/reflection (det=${decomp.determinant.toFixed(2)} < 0)`);
  if (decomp.anisotropy > o.maxAnisotropy) {
    reasons.push(`scale anisotropy ${decomp.anisotropy.toFixed(3)} > ${o.maxAnisotropy}`);
  }
  if (decomp.singularRatio > o.maxAnisotropy) {
    reasons.push(`singular-value anisotropy ${decomp.singularRatio.toFixed(3)} > ${o.maxAnisotropy}`);
  }
  const shearOff = decomp.shearDeg > o.maxShearDeg;
  if (shearOff) {
    reasons.push(`sheared axes ${decomp.shearDeg.toFixed(1)}° from orthogonal > ${o.maxShearDeg}°`);
  }
  const rightOff = angularDistDeg(decomp.bearingRightDeg, 0); // East
  const downOff = angularDistDeg(decomp.bearingDownDeg, -90); // South
  const orientationOff = rightOff > o.orientationToleranceDeg || downOff > o.orientationToleranceDeg;
  if (orientationOff) {
    reasons.push(
      `orientation not north-up: page-right ${decomp.bearingRightDeg.toFixed(1)}° (Δ${rightOff.toFixed(1)}° from East), ` +
        `page-down ${decomp.bearingDownDeg.toFixed(1)}° (Δ${downOff.toFixed(1)}° from South), tol ${o.orientationToleranceDeg}°`,
    );
  }
  // Moderate-anisotropy arbitration band: mirror/shear/orientation all clean and
  // the sole blemish is a scale/singular anisotropy in (maxAnisotropy, hardAniso].
  // Anisotropy above hardAniso is a hard reject (never arbitrable). Empty band
  // (hardAniso == maxAnisotropy) ⇒ always false — no behavioural change.
  const anisoMetric = Math.max(decomp.anisotropy, decomp.singularRatio);
  const anisoArbitrate =
    !decomp.mirror && !shearOff && !orientationOff && anisoMetric > o.maxAnisotropy && anisoMetric <= hardAniso;
  return { pass: reasons.length === 0, reasons, decomposition: decomp, anisoArbitrate };
}
