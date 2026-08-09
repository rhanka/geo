/**
 * t2-georef.ts — manual N-point (≥3) georeferencing for T2 zoning PDFs.
 *
 * A T2 plan (AutoCAD / PScript / Acrobat export) carries the zone-code labels
 * but NO embedded geographic registration — only `/Subtype/RL` rectilinear
 * scale-bar measures (CAD units), which have no CRS anchor. So the T1 auto path
 * (`t1-georef.extractGeoRef`) returns null. This module rebuilds the SAME
 * `GeoRef` contract from a handful of human-placed Ground Control Points (GCPs):
 * a point on the rasterised PDF ↔ its real-world [lon,lat]. With ≥3 spread GCPs
 * we fit an affine page→WGS84 transform (least squares, the exact same
 * `fitAffine` solver as the embedded path) and expose `pageToLonLat` /
 * `topLeftToLonLat`, so the downstream `extractLabels` + `buildZones` pipeline
 * runs UNCHANGED. This is the "vérité Steve" sainte-catherine recipe, generalised.
 *
 * Why a direct page→(lon,lat) affine is correct here: the plan is a single
 * planar map projection over one municipality (a few km). An affine fit (per-
 * axis least squares on lon and lat) absorbs the projection's scale, rotation
 * and the cos(lat) longitude factor at the centroid; the residual is only the
 * projection's second-order curvature — decimetres to a couple of metres at
 * 45°N over ~10 km. This is exactly GDAL's order-1 GCP georeferencing, with zero
 * native deps. ZERO geometry or codes are invented by this step: the GCPs only
 * register WHERE the existing PDF labels land on Earth.
 *
 * GCP coordinate convention (resolution-independent, image-friendly):
 *   fx ∈ [0,1] left→right, fy ∈ [0,1] TOP→bottom (raster/image convention).
 * The builder converts (fx,fy) → PDF user-space (origin bottom-left, y up)
 * using the page size in points, so the produced GeoRef is interchangeable with
 * the embedded one consumed by t1-labels.ts.
 */
import proj4 from "proj4";

import { fitAffine, type GeoRef } from "./t1-georef.js";

/** One ground control point: a page fraction ↔ a real-world [lon,lat]. */
export interface Gcp {
  /** Fraction of page width, 0=left … 1=right. */
  fx: number;
  /** Fraction of page height, 0=TOP … 1=bottom (image/raster convention). */
  fy: number;
  /** Real-world longitude (WGS84). */
  lon: number;
  /** Real-world latitude (WGS84). */
  lat: number;
  /** Optional human note (landmark name) — informational only. */
  note?: string;
  /** Optional machine-readable source tag for QA gates. */
  source?: string;
  /** True when this point was derived from a real visible feature, not a bbox/extent corner. */
  independent?: boolean;
}

/** Optional neatline (map frame) in page-fraction coords, to drop legend/title labels. */
export interface NeatlineFrac {
  fx0: number;
  fy0: number;
  fx1: number;
  fy1: number;
}

/** A `<slug>.gcp.json` calibration file (what the UI writes / the CLI reads). */
export interface GcpFile {
  slug: string;
  pdf: string;
  /** 1-based page index (default 1). */
  page?: number;
  /** Page size in PDF points (MediaBox). Optional — the CLI fills it from pdfinfo. */
  pageW?: number;
  pageH?: number;
  gcps: Gcp[];
  /** Optional map-frame rectangle (page fractions) to restrict in-frame labels. */
  neatline?: NeatlineFrac;
  /** Optional page-fraction masks for title boxes / legends inside the map frame. */
  excludeRegions?: NeatlineFrac[];
  /** Optional CRS the GCP lon/lat are in (default WGS84 / epsg:4326). */
  crs?: string;
}

const M_PER_DEG_LAT = 111320;

export interface BuildGeoRefResult {
  geo: GeoRef;
  /** Per-GCP residual in metres after the affine fit (calibration quality). */
  residualsM: number[];
  /** Worst per-GCP residual, metres. */
  maxResidualM: number;
  /** RMS residual, metres. */
  rmsResidualM: number;
}

export interface IndependentGcpCheck {
  independentCount: number;
  bboxDerivedCount: number;
  maxTriangleArea2Pt: number;
}

export function gcpLooksBboxDerived(g: Gcp): boolean {
  const text = `${g.source ?? ""} ${g.note ?? ""}`.toLowerCase();
  return (
    /\bbox\b/.test(text) ||
    text.includes("cadastre bbox") ||
    text.includes("map bbox") ||
    text.includes("extent matched to cadastre") ||
    text.includes("rectangular extent") ||
    text.includes("diagnostic main-frame")
  );
}

export function checkIndependentGcps(gcps: Gcp[], pageW: number, pageH: number): IndependentGcpCheck {
  const independent = gcps.filter((g) => g.independent !== false && !gcpLooksBboxDerived(g));
  let maxArea2 = 0;
  const pts = independent.map((g) => [g.fx * pageW, (1 - g.fy) * pageH] as [number, number]);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        const a = pts[i]!;
        const b = pts[j]!;
        const c = pts[k]!;
        const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
        if (area2 > maxArea2) maxArea2 = area2;
      }
    }
  }
  return {
    independentCount: independent.length,
    bboxDerivedCount: gcps.length - independent.length,
    maxTriangleArea2Pt: maxArea2,
  };
}

export function assertIndependentGcps(gcps: Gcp[], pageW: number, pageH: number): IndependentGcpCheck {
  const check = checkIndependentGcps(gcps, pageW, pageH);
  if (check.independentCount < 3) {
    throw new Error(
      `need >=3 independent non-bbox GCPs, got ${check.independentCount} ` +
        `(${check.bboxDerivedCount} bbox/extent-derived)`,
    );
  }
  if (check.maxTriangleArea2Pt < 1e-6 * pageW * pageH) {
    throw new Error("independent GCPs are (near-)collinear");
  }
  return check;
}

/**
 * Build a `GeoRef` from ≥3 GCPs. Throws on < 3 GCPs or a degenerate
 * (collinear) configuration that makes the affine non-invertible.
 */
export function buildGeoRefFromGcps(
  gcps: Gcp[],
  pageW: number,
  pageH: number,
  neatline?: NeatlineFrac,
): BuildGeoRefResult {
  if (gcps.length < 3) {
    throw new Error(`need ≥3 GCPs for an affine fit, got ${gcps.length}`);
  }
  if (!(pageW > 0) || !(pageH > 0)) {
    throw new Error(`invalid page size ${pageW}×${pageH} pt`);
  }

  // page fraction (fy top-down) → PDF user-space points (origin bottom-left).
  const userPts: Array<[number, number]> = gcps.map((g) => [g.fx * pageW, (1 - g.fy) * pageH]);
  const lons = gcps.map((g) => g.lon);
  const lats = gcps.map((g) => g.lat);

  // Guard against a collinear GCP layout (zero-area triangle → singular fit).
  const area2 = Math.abs(
    (userPts[1]![0] - userPts[0]![0]) * (userPts[2]![1] - userPts[0]![1]) -
      (userPts[2]![0] - userPts[0]![0]) * (userPts[1]![1] - userPts[0]![1]),
  );
  if (area2 < 1e-6 * pageW * pageH) {
    throw new Error("GCPs are (near-)collinear — spread them across the plan (avoid a line)");
  }

  const cLon = fitAffine(userPts, lons);
  const cLat = fitAffine(userPts, lats);

  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const mPerDegLat = M_PER_DEG_LAT;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);

  const pageToLonLat = (x: number, y: number): [number, number] => [
    cLon[0] * x + cLon[1] * y + cLon[2],
    cLat[0] * x + cLat[1] * y + cLat[2],
  ];

  // residuals (metres) at each GCP.
  const residualsM: number[] = [];
  let sumSq = 0;
  let maxRes = 0;
  for (let i = 0; i < userPts.length; i++) {
    const [lon, lat] = pageToLonLat(userPts[i]![0], userPts[i]![1]);
    const dm = Math.hypot((lon - lons[i]!) * mPerDegLon, (lat - lats[i]!) * mPerDegLat);
    residualsM.push(dm);
    sumSq += dm * dm;
    if (dm > maxRes) maxRes = dm;
  }
  const rms = Math.sqrt(sumSq / userPts.length);

  // neatline bbox in user-space (default = full page → reject nothing).
  let bbox: [number, number, number, number];
  if (neatline) {
    bbox = [
      neatline.fx0 * pageW,
      (1 - neatline.fy1) * pageH,
      neatline.fx1 * pageW,
      (1 - neatline.fy0) * pageH,
    ];
  } else {
    bbox = [0, 0, pageW, pageH];
  }

  // ground scale (m per page point) from the affine x-gradient.
  const scale = Math.hypot(cLon[0] * mPerDegLon, cLat[0] * mPerDegLat);

  const corners = gcps.map((g, i) => ({
    pageX: userPts[i]![0],
    pageY: userPts[i]![1],
    lon: g.lon,
    lat: g.lat,
  }));

  const geo: GeoRef = {
    bbox,
    pageW,
    pageH,
    proj4def: "epsg:4326 (gcp-affine, manual T2 calibration)",
    crsName: `manual ${gcps.length}-GCP affine (WGS84)`,
    corners,
    maxResidualM: maxRes,
    scaleMPerPt: scale,
    pageToLonLat,
    topLeftToLonLat: (x, yTopDown) => pageToLonLat(x, pageH - yTopDown),
  };

  return { geo, residualsM, maxResidualM: maxRes, rmsResidualM: rms };
}

/**
 * Convenience: accept GCPs whose lon/lat are in a non-WGS84 CRS (proj4 def) and
 * convert them to WGS84 first, then build the GeoRef. The UI always works in
 * WGS84 (Leaflet), so this is mostly for CLI/expert use.
 */
export function buildGeoRefFromGcpsCrs(
  gcps: Gcp[],
  pageW: number,
  pageH: number,
  crs: string | undefined,
  neatline?: NeatlineFrac,
): BuildGeoRefResult {
  if (!crs || /4326|wgs ?84|crs84/i.test(crs)) {
    return buildGeoRefFromGcps(gcps, pageW, pageH, neatline);
  }
  const fwd = proj4(crs, "WGS84");
  const wgs = gcps.map((g) => {
    const [lon, lat] = fwd.forward([g.lon, g.lat]) as [number, number];
    return { ...g, lon, lat };
  });
  return buildGeoRefFromGcps(wgs, pageW, pageH, neatline);
}
