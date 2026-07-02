/**
 * Rotation disambiguation by cadastre LOT-ASSIGNMENT for --auto-seed.
 *
 * PROBLEM. On point-symmetric single-sheet vector plans (ascot-corner, richmond,
 * lacolle, lac-beauport …), several page rotations yield non-mirror, isometric
 * affines that ALL clear the residual+holdout gate but disagree on page-right
 * bearing by ~180°. The --auto-seed orientation gate (evaluateAffineGate + the
 * cross-candidate convergence check) cannot tell which rotation is north-up and
 * therefore REJECTS the whole slug (0 deposit). Yet the DATA settles it: only the
 * TRUE rotation lands the printed zone-code labels on the lots they actually
 * annotate, so it assigns the most lots AND recovers the most distinct coherent
 * codes. This is exactly what the manual T2MASS2 pass proved on windsor / arundel
 * / hudson (each served on the lot-assignment-max rotation, not the residual-max
 * one), and it skipped sainte-seraphine when no rotation dominated.
 *
 * This module (a) MEASURES that lot-assignment per candidate rotation by running
 * the EXACT serve pipeline (verbatim pdftotext labels → nearest-label cadastre
 * aggregation, identical to t2-build) and (b) DECIDES the winner ONLY when it is
 * decisive: coverage ≥ floor AND a net margin over the runner-up (on lot % OR on
 * distinct coherent codes). It NEVER invents — an inconclusive field → SKIP.
 *
 * Scope: this only RE-OPENS the pure-orientation reject. The hard mirror /
 * anisotropy / shear gate is untouched (those stay hard-rejected upstream), and
 * the chosen rotation is still served through t2-build's own anti-invention gates
 * (verbatim ≥min-codes, no affectation/CMM, spatial, residual). The rotation is
 * chosen by the CADASTRE DATA, never arbitrarily.
 */
import type { FeatureCollection } from "geojson";

import { extractLabels } from "./t1-labels.js";
import { buildZones } from "./t1-zones.js";
import { buildGeoRefFromGcpsCrs } from "./t2-georef.js";
import type { OrientationCandidate } from "./t2-autogcp.js";
import { bboxCenter, haversineKm, mergeByZoneCode } from "./zone-serve.js";

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
   * `discriminationCutoffM`. This is the orientation signal — a 180° flip
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
  gcp_file: OrientationCandidate["gcp_file"];
}

export interface MeasureContext {
  pdfPath: string;
  page: number;
  pageW: number;
  pageH: number;
  cadastre: FeatureCollection;
  /**
   * TIGHT cutoff (m) for the discrimination coverage. Default 300 — loose enough
   * that the true orientation keeps most labels on-lot, tight enough that a 180°
   * flip's displaced labels fail to attach. NOT the serving cutoff.
   */
  discriminationCutoffM?: number;
}

export const DEFAULT_DISCRIMINATION_CUTOFF_M = 300;

/**
 * Run the serve pipeline for ONE candidate rotation and measure how coherently
 * its labels attach to the real cadastre — at BOTH a tight discrimination cutoff
 * (the orientation signal) and the 1500 m serving cutoff (the usefulness floor),
 * from a single aggregation pass. Pure of any I/O beyond reading the
 * (already-cached) PDF; the cadastre is passed in.
 */
export function measureRotationLotAssignment(cand: OrientationCandidate, ctx: MeasureContext): MeasuredRotation {
  const gf = cand.gcp_file;
  const { geo } = buildGeoRefFromGcpsCrs(gf.gcps, ctx.pageW, ctx.pageH, gf.crs, gf.neatline);
  const lab = extractLabels(ctx.pdfPath, geo, { page: ctx.page, excludeRegions: gf.excludeRegions });

  const { center: cadCenter, bbox: cadBbox } = bboxCenter(ctx.cadastre);
  const lat0 = (cadBbox[1] + cadBbox[3]) / 2;

  const tightCutoff = ctx.discriminationCutoffM ?? DEFAULT_DISCRIMINATION_CUTOFF_M;
  const { featureCollection, stats } = buildZones(ctx.cadastre, lab.codePoints, {
    lat0,
    cutoffM: tightCutoff,
    source: "t2-autogcp-rotation-disambig",
    confidence: "auto-seed-lot-disambig",
    dissolve: true,
  });
  const served = mergeByZoneCode(featureCollection);
  const total = stats.n_lots_total;
  // Discrimination coverage at the tight cutoff; serving coverage from the same
  // pass via the 1500 m unassigned tally (buildZones reports it regardless of cutoff).
  const coverage = total > 0 ? (100 * stats.n_lots_assigned) / total : 0;
  const servingCoverage = total > 0 ? (100 * (total - stats.n_lots_unassigned_1500m)) / total : 0;

  let spatialKm = NaN;
  if (lab.codePoints.length > 0) {
    const labCenter: [number, number] = lab.codePoints.reduce(
      (acc, c) => [acc[0] + c.lon / lab.codePoints.length, acc[1] + c.lat / lab.codePoints.length],
      [0, 0] as [number, number],
    );
    spatialKm = haversineKm(labCenter, cadCenter);
  }

  return {
    extent: cand.extent,
    rotation: cand.rotation,
    bearing_right_deg: cand.bearing_right_deg,
    selected_gcps: cand.selected_gcps,
    residual_max_m: cand.residual_max_m,
    holdout_max_m: cand.holdout_max_m,
    coverage_pct: Number(coverage.toFixed(2)),
    serving_coverage_pct: Number(servingCoverage.toFixed(2)),
    n_distinct_codes: stats.n_distinct_codes,
    n_empty_labels: stats.n_empty_labels,
    n_served_features: served.features.length,
    spatial_km: Number.isFinite(spatialKm) ? Number(spatialKm.toFixed(3)) : spatialKm,
    gcp_file: gf,
  };
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
