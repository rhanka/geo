/**
 * @sentropic/geo/georef — page→ground georeferencing for zoning plans.
 *
 * The recalage (georeferencing) compute behind the pipeline:
 *   - {@link fitAffine}: the least-squares affine solver reused by every path;
 *   - {@link wktToProj4}: parse an ESRI/OGC WKT PROJCS (TM/MTM/UTM) into a proj4 def;
 *   - {@link buildGeoRefFromGcps}: rebuild a {@link GeoRef} from ≥3 Ground Control
 *     Points, plus the independence/collinearity gates used to reject bbox-corner
 *     "controls";
 *   - {@link extractGeoRef}: pull a T1 GeoPDF's EMBEDDED registration (the
 *     `/VP /Measure /GEO /GPTS` viewport) straight from the PDF buffer and fit
 *     page→WGS84 via proj4 — pure-Node, no GDAL.
 *
 * Network-free and GDAL-free. `extractGeoRef` uses `proj4` (a runtime dep) and,
 * only when handed a file path, an OPTIONAL `pdfinfo` page-size probe — consistent
 * with the package's existing subprocess surface (e.g. the GDAL adapter). The
 * pdftocairo/pdftoppm/tesseract raster runners and the proj4-CRS GCP reprojection
 * stay in the acquisition app layer that consumes this surface.
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
  checkIndependentGcps,
  gcpLooksBboxDerived,
  type BuildGeoRefResult,
  type Gcp,
  type GcpFile,
  type IndependentGcpCheck,
  type NeatlineFrac,
} from "./gcp.js";

// T1 positioned-text label compute. pdftotext and file access stay in acquisition.
export {
  extractLabelsFromWords,
  filterExtractedLabelsByDict,
  kindForPrefix,
  looksLikeZoneCode,
  normalizeZoneCodeText,
  splitCode,
  zoneLabelCandidatesFromWords,
  type CodePoint,
  type ExtractLabelsResult,
  type LabelComputeOptions,
  type LabelRegionFrac,
  type RawLabel,
  type ZoneCodeOptions,
} from "./labels.js";

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

// Pure vector/cadastre auto-GCP discovery: parse SVG vector linework already
// rendered by the app layer, match it to in-memory WGS84 cadastre, and emit
// independently-derived GCPs without PDF/OCR/filesystem/network concerns.
export {
  buildGcpFileFromMatches,
  deriveAutoSeedGcpsFromVectors,
  deriveAutonomousGcpsFromVectors,
  parseSvgVectorPoints,
  type AutoGcpFitMode,
  type AutoGcpMatch,
  type AutoGcpVectorOptions,
  type AutoGcpVectorReport,
  type AutoSeedAttempt,
  type AutoSeedOrientationCandidate,
  type AutoSeedVectorOptions,
  type AutoSeedVectorReport,
  type ParseSvgVectorPointOptions,
  type Pt,
} from "./autogcp.js";

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

// Pure PGM/gray-image edge, corner, and patch evidence. PDF rendering and
// cadastre registration orchestration stay in the acquisition app layer.
export {
  detectRasterCorners,
  edgeMaskFromGray,
  parsePgm,
  patchEdgeScore,
  type EdgeImage,
  type GrayImage,
  type RasterCorner,
} from "./raster.js";
