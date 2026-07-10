/**
 * georef/affine.ts — the shared page→ground georeferencing contract and the
 * least-squares affine solver reused by every georef path.
 *
 * A zoning plan is a single planar map projection over one municipality (a few
 * km), so the page→projected map is AFFINE. Both the embedded-GeoPDF path
 * (`./geopdf`) and the manual ground-control-point path (`./gcp`) fit this same
 * 6-parameter map with the exact same `fitAffine` least-squares solver — no
 * reinvention — and expose the same `GeoRef` interface downstream.
 *
 * Ported (pure compute, zero I/O) from the acquisition recalage pipeline
 * (`acquisition/src/lib/t1-georef.ts`, `t2-georef.ts`).
 */

export interface GeoRef {
  /** Page user-space [x0,y0,x1,y1] of the map neatline (Viewport BBox). */
  bbox: [number, number, number, number];
  /** Page width/height (MediaBox), points. */
  pageW: number;
  pageH: number;
  /** proj4 definition string of the embedded CRS. */
  proj4def: string;
  /** Human CRS name (from WKT) when available. */
  crsName: string;
  /** Corner correspondences used for the fit. */
  corners: Array<{ pageX: number; pageY: number; lon: number; lat: number }>;
  /** Max corner residual of the affine page→projected fit, meters. */
  maxResidualM: number;
  /** Approx ground scale, meters per page point. */
  scaleMPerPt: number;
  /**
   * Map a PDF user-space point (origin BOTTOM-left, y up) to [lon, lat] WGS84.
   */
  pageToLonLat(x: number, y: number): [number, number];
  /**
   * Map a pdftotext bbox point (origin TOP-left, y down) to [lon, lat]. This is
   * the convenience used by label extraction (pdftotext reports y downward).
   */
  topLeftToLonLat(x: number, yTopDown: number): [number, number];
}

// ---------------------------------------------------------------------------
// Affine fit page(x,y) → value, least squares (≥3 correspondences).
// Shared by the embedded-GeoPDF path and the manual-GCP path so both reuse the
// exact same least-squares solver — no reinvention.
// ---------------------------------------------------------------------------
export function fitAffine(pts: Array<[number, number]>, vals: number[]): [number, number, number] {
  let Sxx = 0;
  let Sxy = 0;
  let Sx = 0;
  let Syy = 0;
  let Sy = 0;
  let S1 = 0;
  let Svx = 0;
  let Svy = 0;
  let Sv = 0;
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i]![0];
    const y = pts[i]![1];
    const v = vals[i]!;
    Sxx += x * x;
    Sxy += x * y;
    Sx += x;
    Syy += y * y;
    Sy += y;
    S1 += 1;
    Svx += v * x;
    Svy += v * y;
    Sv += v;
  }
  const A = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, S1],
  ];
  const b = [Svx, Svy, Sv];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [b[c], b[piv]] = [b[piv]!, b[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < 3; k++) A[r]![k]! -= f * A[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  return [b[0]! / A[0]![0]!, b[1]! / A[1]![1]!, b[2]! / A[2]![2]!];
}
