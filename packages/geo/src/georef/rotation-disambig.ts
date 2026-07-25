/**
 * georef/rotation-disambig.ts — the PURE decisions that resolve an orientation
 * ambiguity (or confirm a moderate stretch) by cadastre lot-assignment evidence.
 *
 * On point-symmetric single-sheet vector plans several page rotations yield
 * non-mirror, isometric affines that all clear the residual+holdout gate but
 * disagree on page-right bearing by ~180°, so the orientation gate
 * ({@link evaluateAffineGate}) cannot pick one and rejects the slug. Yet the DATA
 * settles it: only the TRUE rotation lands the printed zone-code labels on the
 * lots they annotate, so it assigns the most lots at a TIGHT cutoff. This module
 * holds the two anti-invention decisions on that per-rotation evidence:
 *   - {@link decideRotation}: pick a rotation ONLY when it decisively dominates on
 *     tight-cutoff lot coverage (margin + serving floor + min distinct codes);
 *   - {@link decideAnisoArbitration}: confirm a moderate-anisotropy stretch is real
 *     ONLY when the best candidate serves enough lots (absolute serving floor).
 * Anything short of decisive → SKIP (better no geometry than a guess).
 *
 * Ported (pure compute, zero I/O) from the acquisition recalage pipeline
 * (`acquisition/src/lib/t2-rotation-disambig.ts`). The MEASUREMENT that produces
 * a {@link MeasuredRotation} — `measureRotationLotAssignment`, which runs the
 * pdftotext-label → cadastre-aggregation serve pipeline — stays in the acquisition
 * app layer; only the decisions on the measured evidence live here.
 */
import type { GcpFile } from "./gcp.js";

/** Per-rotation lot-assignment measurement (the disambiguation evidence). */
export interface MeasuredRotation {
  extent: string;
  rotation: number;
  bearing_right_deg: number;
  selected_gcps: number;
  residual_max_m: number | null;
  holdout_max_m: number | null;
  /**
   * DISCRIMINATION coverage: % of lots with a label within the TIGHT
   * discrimination cutoff. This is the orientation signal — a 180° flip
   * displaces labels by ~the map diameter, so its close-attachment collapses
   * (windsor: rot0 96.7% vs rot180 30.9% at 300 m) even where the loose serving
   * cutoff saturates both to ~99% and hides the difference.
   */
  coverage_pct: number;
  /** SERVING coverage: % of lots labelled within 1500 m (the usefulness floor). */
  serving_coverage_pct: number;
  /**
   * Distinct lettered zone codes among the read labels. NOTE: this is NOT a
   * reliable orientation discriminator (a wrong flip can SCATTER labels onto
   * more distinct far lots and read MORE codes — windsor rot180=140 > rot0=139);
   * used only as a min-count sanity floor, never as the decisive margin.
   */
  n_distinct_codes: number;
  /** Labels that attached to no lot within the tight cutoff (a wrong flip inflates this). */
  n_empty_labels: number;
  /** Distinct-code features that would be served for this rotation. */
  n_served_features: number;
  /** Label-centroid ↔ cadastre-centroid distance (km); a sanity signal. */
  spatial_km: number;
  gcp_file: GcpFile;
}

export interface RotationDecisionOptions {
  /** The winner's SERVING coverage (1500 m) must reach this (%) to serve. Default 70. */
  coverageFloorPct?: number;
  /** The winner must beat the runner-up by ≥ this on TIGHT-cutoff coverage (the
   * orientation signal) to be decisive. Default 15. */
  marginPct?: number;
  /** The winner must place at least this many distinct codes (anti-#74 sanity). Default 3. */
  minDistinctCodes?: number;
}

export const DEFAULT_ROTATION_DECISION: Required<RotationDecisionOptions> = {
  coverageFloorPct: 70,
  marginPct: 15,
  minDistinctCodes: 3,
};

export interface RotationDecision {
  decisive: boolean;
  reason: string;
  winner?: MeasuredRotation;
  /** Candidates sorted best-first (tight-cutoff coverage desc, then serving desc). */
  ranking: MeasuredRotation[];
  /** Winner − runner-up gap on the TIGHT-cutoff (discrimination) coverage. */
  coverage_margin_pct?: number;
}

/**
 * PURE decision: given the measured rotations, is one DECISIVELY the true
 * orientation? The discriminator is TIGHT-cutoff coverage (how many lots have a
 * label CLOSE by): a 180° flip collapses it while the true orientation keeps it
 * high. Anti-invention rules (ALL must hold to serve):
 *   1. ≥2 candidate orientations to disambiguate between;
 *   2. the winner (max tight-coverage) beats the runner-up by ≥ marginPct on
 *      tight-cutoff coverage — a NET, unmistakable orientation gap;
 *   3. the winner's SERVING coverage (1500 m) ≥ coverageFloorPct (useful serve);
 *   4. the winner places ≥ minDistinctCodes (anti-#74 sanity).
 * Distinct-code COUNT is deliberately NOT a discriminator (a wrong flip scatters
 * labels onto more far lots and can read MORE codes). Anything short of a decisive
 * gap → decisive:false and the caller SKIPs (better no geometry than a guess).
 */
export function decideRotation(measured: MeasuredRotation[], options: RotationDecisionOptions = {}): RotationDecision {
  const o = { ...DEFAULT_ROTATION_DECISION, ...options };
  const ranking = [...measured].sort(
    (a, b) => b.coverage_pct - a.coverage_pct || b.serving_coverage_pct - a.serving_coverage_pct,
  );
  if (ranking.length < 2) {
    return { decisive: false, reason: `only ${ranking.length} candidate orientation(s); need ≥2 to disambiguate`, ranking };
  }
  const top = ranking[0]!;
  const second = ranking[1]!;
  const covMargin = Number((top.coverage_pct - second.coverage_pct).toFixed(2));

  if (covMargin < o.marginPct) {
    return {
      decisive: false,
      reason:
        `winner ${top.rotation}° not decisive over runner-up ${second.rotation}°: tight-cutoff coverage gap ` +
        `${covMargin}pt (${top.coverage_pct}% vs ${second.coverage_pct}%) < ${o.marginPct}pt — orientation ambiguous → SKIP`,
      ranking,
      coverage_margin_pct: covMargin,
    };
  }
  if (top.serving_coverage_pct < o.coverageFloorPct) {
    return {
      decisive: false,
      reason: `winner ${top.rotation}° serving coverage ${top.serving_coverage_pct}% < floor ${o.coverageFloorPct}% — not a useful serve → SKIP`,
      ranking,
      coverage_margin_pct: covMargin,
    };
  }
  if (top.n_distinct_codes < o.minDistinctCodes) {
    return {
      decisive: false,
      reason: `winner ${top.rotation}° places only ${top.n_distinct_codes} distinct codes (< ${o.minDistinctCodes}) → SKIP`,
      ranking,
      coverage_margin_pct: covMargin,
    };
  }
  return {
    decisive: true,
    reason:
      `rotation ${top.rotation}° wins decisively on lot-assignment: tight-cutoff ${top.coverage_pct}% vs runner-up ` +
      `${second.rotation}° ${second.coverage_pct}% (+${covMargin}pt); serving coverage ${top.serving_coverage_pct}%, ` +
      `${top.n_distinct_codes} codes, ${top.n_empty_labels} empty labels`,
    winner: top,
    ranking,
    coverage_margin_pct: covMargin,
  };
}

/* ------------------------------------------------------------------------- *
 * Moderate-anisotropy ARBITRATION by lot-coverage.
 *
 * The iso-gate hard-rejects any affine with anisotropy > ~1.1. But a partial-
 * extent / CAD-stretched zoning sheet (arundel ≈1.2) is LEGITIMATELY anisotropic:
 * its stretch is the true géoréf. Within the arbitration band the fit has ALREADY
 * cleared the hard proofs upstream (non-mirror, non-shear, NORTH-UP, real parcel-
 * corner control points passing residual+holdout at ≤30 m incl. held-out corners).
 *
 * The remaining confirmation is the CADASTRE serving the INDEPENDENT zone labels:
 * a real stretch lands the printed labels ON the lots they annotate, so serving
 * coverage stays high (arundel 89–99 %); a spurious stretch scatters them and
 * serving collapses. The tight-cutoff (300 m) coverage is NOT a usable anisotropy
 * signal on a large RURAL muni (one label covers many far lots), so it is a
 * diagnostic only. Serve the best-serving candidate ONLY if its serving coverage
 * ≥ servingCoverageFloorPct AND it places ≥ minDistinctCodes codes; else SKIP.
 * ------------------------------------------------------------------------- */
export interface AnisoArbitrationOptions {
  /**
   * Serving-cutoff (1500 m) lot-coverage (%) the winner must reach to confirm the
   * stretch is real (labels land on lots). This is arundel's proven ~97 %. Default 85.
   */
  servingCoverageFloorPct?: number;
  /** Distinct lettered codes the winner must place (anti-#74 sanity). Default 3. */
  minDistinctCodes?: number;
}

export const DEFAULT_ANISO_ARBITRATION: Required<AnisoArbitrationOptions> = {
  servingCoverageFloorPct: 85,
  minDistinctCodes: 3,
};

export interface AnisoArbitrationDecision {
  serve: boolean;
  reason: string;
  winner?: MeasuredRotation;
  /** Candidates sorted best-first (serving coverage desc, then residual asc). */
  ranking: MeasuredRotation[];
}

/**
 * PURE decision: given the measured moderate-anisotropy candidates (already
 * north-up, non-mirror, residual+holdout-gated on real parcel corners), is the
 * best one's stretch CONFIRMED real by the cadastre? Serve only when ALL hold:
 *   1. ≥1 candidate measured;
 *   2. the best serving coverage (1500 m) ≥ servingCoverageFloorPct — the
 *      independent labels land on the lots (arundel ~97 %);
 *   3. it places ≥ minDistinctCodes lettered codes (anti-#74).
 * Otherwise SKIP — an anisotropic fit is never served without label confirmation.
 */
export function decideAnisoArbitration(
  measured: MeasuredRotation[],
  options: AnisoArbitrationOptions = {},
): AnisoArbitrationDecision {
  const o = { ...DEFAULT_ANISO_ARBITRATION, ...options };
  const ranking = [...measured].sort(
    (a, b) =>
      b.serving_coverage_pct - a.serving_coverage_pct ||
      (a.residual_max_m ?? Infinity) - (b.residual_max_m ?? Infinity) ||
      b.n_distinct_codes - a.n_distinct_codes,
  );
  if (ranking.length === 0) {
    return { serve: false, reason: "no moderate-anisotropy candidate to arbitrate", ranking };
  }
  const top = ranking[0]!;
  if (top.serving_coverage_pct < o.servingCoverageFloorPct) {
    return {
      serve: false,
      reason:
        `best candidate ${top.extent}/rot${top.rotation}° serving coverage ${top.serving_coverage_pct}% ` +
        `< floor ${o.servingCoverageFloorPct}% — anisotropy NOT confirmed real (labels do not land on lots) → SKIP`,
      ranking,
    };
  }
  if (top.n_distinct_codes < o.minDistinctCodes) {
    return {
      serve: false,
      reason: `best candidate places only ${top.n_distinct_codes} distinct codes (< ${o.minDistinctCodes}) → SKIP`,
      ranking,
    };
  }
  return {
    serve: true,
    reason:
      `moderate anisotropy CONFIRMED real by cadastre: ${top.extent}/rot${top.rotation}° serving coverage ` +
      `${top.serving_coverage_pct}% (≥${o.servingCoverageFloorPct}%), tight-cutoff ${top.coverage_pct}% (diagnostic), ` +
      `${top.n_distinct_codes} codes, residual ${top.residual_max_m}m / holdout ${top.holdout_max_m}m on real parcel corners`,
    winner: top,
    ranking,
  };
}
