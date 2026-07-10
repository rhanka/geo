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
