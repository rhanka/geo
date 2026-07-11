/**
 * @sentropic/geo/georef — page→ground georeferencing for zoning plans.
 *
 * The recalage (georeferencing) compute behind the pipeline:
 *   - {@link fitAffine}: the least-squares affine solver reused by every path;
 *   - {@link wktToProj4}: parse an ESRI/OGC WKT PROJCS (TM/MTM/UTM) into a proj4 def;
 *   - {@link buildGeoRefFromGcps}: rebuild a {@link GeoRef} from ≥3 Ground Control
 *     Points, plus the independence/collinearity gates used to reject bbox-corner
 *     "controls";
 *   - {@link deriveAutonomousGcpsFromPoints}: match already-extracted page
 *     vector points to WGS84 cadastre vertices, then residual/holdout-gate the
 *     independent controls;
 *   - {@link extractGeoRef}: pull a T1 GeoPDF's EMBEDDED registration (the
 *     `/VP /Measure /GEO /GPTS` viewport) straight from the PDF buffer and fit
 *     page→WGS84 via proj4 — pure-Node, no GDAL.
 *
 * Network-free and GDAL-free. `extractGeoRef` uses `proj4` (a runtime dep) and,
 * only when handed a file path, an OPTIONAL `pdfinfo` page-size probe — consistent
 * with the package's existing subprocess surface (e.g. the GDAL adapter). The
 * pdftocairo/pdftoppm/tesseract raster runners stay in the acquisition app layer;
 * proj4-backed GCP reprojection remains pure and is exposed here.
 */

export const VERSION = "0.1.0";

// Shared georef contract + least-squares affine solver.
export { fitAffine, type GeoRef } from "./affine.js";

// WKT PROJCS → proj4 definition string (Transverse Mercator / MTM / UTM family).
export { wktToProj4 } from "./wkt.js";

// Embedded-GeoPDF (T1) registration extraction: buffer → GeoRef, pure-Node.
export { extractGeoRef, inflatePdfText, type InflateOptions } from "./geopdf.js";

// Manual N-point (≥3) GCP georeferencing + independence/collinearity gates.
export {
  assertIndependentGcps,
  buildGeoRefFromGcps,
  buildGeoRefFromGcpsCrs,
  checkIndependentGcps,
  gcpLooksBboxDerived,
  type BuildGeoRefResult,
  type Gcp,
  type GcpFile,
  type IndependentGcpCheck,
  type NeatlineFrac,
} from "./gcp.js";

// Autonomous T2 cadastre/linework matching core: in-memory points + cadastre in,
// independent GCPs out. PDF rendering, OCR, S3 and CRS reprojection stay outside.
export {
  buildGcpFileFromAutoMatches,
  deriveAutonomousGcpsFromPoints,
  extractSvgVectorPointsFromString,
  matchPagePointsToCadastre,
  type AutoGcpCoreOptions,
  type AutoGcpCoreReport,
  type AutoGcpMatch,
  type FitMode,
  type PagePoint,
} from "./autogcp.js";

// Affine/similarity decomposition + orientation/isotropy/mirror gate: refuse to
// serve a residual-clean but geometrically-wrong (stretched/mirrored/flipped) fit.
export {
  DEFAULT_AFFINE_GATE,
  DEFAULT_ANISO_ARBITRATE_MAX_ANISOTROPY,
  decomposeGcpAffine,
  decomposeGcpSimilarity,
  evaluateAffineGate,
  type AffineDecomposition,
  type AffineGateOptions,
  type AffineGateResult,
} from "./gate.js";

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
