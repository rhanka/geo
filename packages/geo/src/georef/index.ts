/**
 * @sentropic/geo/georef — pure-compute page→ground georeferencing primitives.
 *
 * The shared, dependency-free math behind the recalage (georeferencing) pipeline:
 *   - {@link fitAffine}: the least-squares affine solver reused by every path;
 *   - {@link wktToProj4}: parse an ESRI/OGC WKT PROJCS (TM/MTM/UTM) into a proj4 def;
 *   - {@link buildGeoRefFromGcps}: rebuild a {@link GeoRef} from ≥3 Ground Control
 *     Points, plus the independence/collinearity gates used to reject bbox-corner
 *     "controls".
 *
 * Zero I/O, zero network, zero native deps — the PDF/pdfinfo/pdftocairo runners,
 * the embedded-GeoPDF stream inflater and the proj4-backed reprojection stay in
 * the acquisition app layer that consumes this surface.
 */

export const VERSION = "0.1.0";

// Shared georef contract + least-squares affine solver.
export { fitAffine, type GeoRef } from "./affine.js";

// WKT PROJCS → proj4 definition string (Transverse Mercator / MTM / UTM family).
export { wktToProj4 } from "./wkt.js";

// Manual N-point (≥3) GCP georeferencing + independence/collinearity gates.
export {
  assertIndependentGcps,
  buildGeoRefFromGcps,
  checkIndependentGcps,
  gcpLooksBboxDerived,
  type BuildGeoRefResult,
  type Gcp,
  type GcpFile,
  type IndependentGcpCheck,
  type NeatlineFrac,
} from "./gcp.js";

// Orientation-ambiguity + moderate-stretch decisions from cadastre lot-coverage
// evidence: serve a rotation / confirm an anisotropic fit ONLY when the data is
// decisive (never invent an orientation).
export {
  DEFAULT_ANISO_ARBITRATION,
  DEFAULT_ROTATION_DECISION,
  decideAnisoArbitration,
  decideRotation,
  type AnisoArbitrationDecision,
  type AnisoArbitrationOptions,
  type MeasuredRotation,
  type RotationDecision,
  type RotationDecisionOptions,
} from "./rotation-disambig.js";
