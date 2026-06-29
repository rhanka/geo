/**
 * t1-georef.ts — pure-Node (no GDAL) extraction of a GeoPDF's embedded
 * georeferencing → a page→WGS84 transform, for the T1 zoning recipe.
 *
 * A T1 GeoPDF (ISO 32000-2 / Adobe Geospatial, as exported by Esri ArcGIS Pro)
 * carries the geographic registration INSIDE the file: the page's `/VP`
 * (Viewport) array holds a `/BBox` (the map neatline in page user-space points)
 * and a `/Measure` of subtype `/GEO` with:
 *   - `/Bounds`  : points in [0,1] fractions of the BBox (the map corners),
 *   - `/GPTS`    : the same corners as geographic lat/lon pairs,
 *   - `/GCS`     : the coordinate system (ESRI WKT, e.g. NAD83 CSRS / MTM 8).
 * Because the map is a planar projection, page→projected is AFFINE; we fit it
 * from the corner correspondences (proj4 forward on GPTS), then invert the
 * projection (proj4) to obtain WGS84. This reproduces what GDAL's PDF driver
 * does, with zero native deps — only `proj4` (already a dependency) and the
 * pure-Node stream inflate the pilot's `zonage-georef-probe.mjs` proved works.
 *
 * Scope: the `/VP /Measure /GEO /GPTS` path (Esri ArcGIS Pro / many AutoCAD
 * exports). The older TerraGo `/LGIDict` OGC best-practice dict (some AutoCAD
 * Map 3D plans) is NOT parsed here — those are flagged for a dedicated path.
 */
import { execSync } from "node:child_process";
import zlib from "node:zlib";

import proj4 from "proj4";

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
// PDF stream inflate + marker scan (same technique as the pilot probe).
// ---------------------------------------------------------------------------
export function inflatePdfText(buf: Buffer): string {
  const STREAM = Buffer.from("stream");
  const ENDSTREAM = Buffer.from("endstream");
  let idx = 0;
  let all = "";
  while (true) {
    const i = buf.indexOf(STREAM, idx);
    if (i < 0) break;
    let p = i + 6;
    if (buf[p] === 0x0d) p++;
    if (buf[p] === 0x0a) p++;
    const j = buf.indexOf(ENDSTREAM, p);
    if (j < 0) break;
    const chunk = buf.subarray(p, j);
    let out: Buffer | null = null;
    try {
      out = zlib.inflateSync(chunk);
    } catch {
      try {
        out = zlib.inflateRawSync(chunk);
      } catch {
        out = null;
      }
    }
    if (out) all += "\n" + out.toString("latin1");
    idx = j + 9;
  }
  return all + "\n" + buf.toString("latin1");
}

function numArray(s: string): number[] {
  return (s.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

/** Parse ESRI/OGC WKT PROJCS into a proj4 string (TM/MTM/UTM family). */
export function wktToProj4(wkt: string): { def: string; name: string } | null {
  const name = (wkt.match(/PROJCS\s*\[\s*"([^"]+)"/) || [, ""])[1] ?? "";
  const proj = (wkt.match(/PROJECTION\s*\[\s*"([^"]+)"/) || [, ""])[1] ?? "";
  const param = (key: string): number | undefined => {
    const m = wkt.match(new RegExp(`PARAMETER\\s*\\[\\s*"${key}"\\s*,\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
    return m ? Number(m[1]) : undefined;
  };
  const spheroid = (wkt.match(/SPHEROID\s*\[\s*"([^"]+)"\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/) ||
    null);
  let ellps = "+ellps=GRS80";
  if (spheroid) {
    const a = spheroid[2];
    const invf = spheroid[3];
    // GRS80 / WGS84 share a; otherwise pass explicit a/rf (anti-invention).
    if (/WGS[_ ]?84/i.test(spheroid[1]!)) ellps = "+ellps=WGS84";
    else if (/GRS[_ ]?1980|GRS80/i.test(spheroid[1]!)) ellps = "+ellps=GRS80";
    else ellps = `+a=${a} +rf=${invf}`;
  }
  if (/Transverse_Mercator/i.test(proj)) {
    const lon0 = param("Central_Meridian") ?? param("central_meridian");
    const lat0 = param("Latitude_Of_Origin") ?? param("latitude_of_origin") ?? 0;
    const k = param("Scale_Factor") ?? param("scale_factor") ?? 1;
    const x0 = param("False_Easting") ?? param("false_easting") ?? 0;
    const y0 = param("False_Northing") ?? param("false_northing") ?? 0;
    if (lon0 === undefined) return null;
    const def = `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=${k} +x_0=${x0} +y_0=${y0} ${ellps} +units=m +no_defs`;
    return { def, name };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Affine fit page(x,y) → value, least squares (≥3 correspondences).
// ---------------------------------------------------------------------------
function fitAffine(pts: Array<[number, number]>, vals: number[]): [number, number, number] {
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

// ---------------------------------------------------------------------------
// Extract georeferencing from a GeoPDF buffer.
// ---------------------------------------------------------------------------
export function extractGeoRef(pdf: Buffer, pdfPath?: string): GeoRef | null {
  const hay = inflatePdfText(pdf);

  // Enumerate every Viewport with a GEO Measure and pick the LARGEST BBox (the
  // main map, not an inset/legend). A single-VP plan (delson) is unaffected; a
  // multi-VP plan (saint-amable, 6 viewports) selects the municipal frame.
  type VP = { bbox: number[]; bounds: number[]; gpts: number[]; wkt: string; area: number };
  const vps: VP[] = [];
  const vpRe = /\/Type\s*\/Viewport/g;
  let vm: RegExpExecArray | null;
  while ((vm = vpRe.exec(hay)) !== null) {
    const win = hay.slice(vm.index, vm.index + 4000);
    if (!/\/Subtype\s*\/GEO/.test(win)) continue;
    const bbox = numArray((win.match(/\/BBox\s*\[([^\]]+)\]/) || [, ""])[1] ?? "");
    const bounds = numArray((win.match(/\/Bounds\s*\[([^\]]+)\]/) || [, ""])[1] ?? "");
    const gpts = numArray((win.match(/\/GPTS\s*\[([^\]]+)\]/) || [, ""])[1] ?? "");
    const wkt = (win.match(/\/WKT\s*\(([^)]+)\)/) || [, ""])[1] ?? "";
    if (bbox.length < 4 || bounds.length < 8 || gpts.length < 8) continue;
    const area = Math.abs((bbox[2]! - bbox[0]!) * (bbox[3]! - bbox[1]!));
    vps.push({ bbox, bounds, gpts, wkt, area });
  }
  if (vps.length === 0) return null;
  vps.sort((a, b) => b.area - a.area);
  const main = vps[0]!;
  const bboxArr = main.bbox;
  const bounds = main.bounds;
  const gpts = main.gpts;
  const wkt = main.wkt;

  // page MediaBox (for top-left conversion). Prefer pdfinfo; fall back to MediaBox.
  let pageW = 0;
  let pageH = 0;
  if (pdfPath) {
    try {
      const info = execSync(`pdfinfo ${JSON.stringify(pdfPath)}`, { encoding: "utf8" });
      const pm = info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
      if (pm) {
        pageW = Number(pm[1]);
        pageH = Number(pm[2]);
      }
    } catch {
      /* fall through */
    }
  }
  if (!pageW || !pageH) {
    const mb = numArray((hay.match(/\/MediaBox\s*\[([^\]]+)\]/) || [, ""])[1] ?? "");
    if (mb.length >= 4) {
      pageW = mb[2]! - mb[0]!;
      pageH = mb[3]! - mb[1]!;
    }
  }

  const [bx0, by0, bx1, by1] = bboxArr as [number, number, number, number];
  const nCorners = Math.min(Math.floor(bounds.length / 2), Math.floor(gpts.length / 2));
  const pagePts: Array<[number, number]> = [];
  const lons: number[] = [];
  const lats: number[] = [];
  for (let i = 0; i < nCorners; i++) {
    const bxf = bounds[2 * i]!;
    const byf = bounds[2 * i + 1]!;
    const px = bx0 + bxf * (bx1 - bx0);
    const py = by0 + byf * (by1 - by0);
    const lat = gpts[2 * i]!;
    const lon = gpts[2 * i + 1]!;
    pagePts.push([px, py]);
    lons.push(lon);
    lats.push(lat);
  }
  // Drop a closing duplicate corner if present.
  // (Bounds often repeats the first point to close the ring.)

  const parsed = wktToProj4(wkt);
  const corners = pagePts.map((p, i) => ({ pageX: p[0], pageY: p[1], lon: lons[i]!, lat: lats[i]! }));

  if (parsed) {
    // Affine page→projected, then proj4 inverse → WGS84.
    const proj = proj4(parsed.def);
    const proj4Pts = lons.map((lon, i) => proj.forward([lon, lats[i]!]) as [number, number]);
    const cE = fitAffine(pagePts, proj4Pts.map((m) => m[0]));
    const cN = fitAffine(pagePts, proj4Pts.map((m) => m[1]));
    let maxRes = 0;
    for (let i = 0; i < pagePts.length; i++) {
      const E = cE[0] * pagePts[i]![0] + cE[1] * pagePts[i]![1] + cE[2];
      const N = cN[0] * pagePts[i]![0] + cN[1] * pagePts[i]![1] + cN[2];
      maxRes = Math.max(maxRes, Math.hypot(E - proj4Pts[i]![0], N - proj4Pts[i]![1]));
    }
    const scale = Math.hypot(cE[0], cN[0]);
    const pageToLonLat = (x: number, y: number): [number, number] => {
      const E = cE[0] * x + cE[1] * y + cE[2];
      const N = cN[0] * x + cN[1] * y + cN[2];
      return proj.inverse([E, N]) as [number, number];
    };
    return {
      bbox: [bx0, by0, bx1, by1],
      pageW,
      pageH,
      proj4def: parsed.def,
      crsName: parsed.name,
      corners,
      maxResidualM: maxRes,
      scaleMPerPt: scale,
      pageToLonLat,
      topLeftToLonLat: (x, yTopDown) => pageToLonLat(x, pageH - yTopDown),
    };
  }

  // Fallback: direct bilinear/affine page→(lon,lat) from corners (no proj).
  const cLon = fitAffine(pagePts, lons);
  const cLat = fitAffine(pagePts, lats);
  // residual in meters at corner (approx, equirectangular at mean lat)
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((meanLat * Math.PI) / 180);
  let maxRes = 0;
  for (let i = 0; i < pagePts.length; i++) {
    const lon = cLon[0] * pagePts[i]![0] + cLon[1] * pagePts[i]![1] + cLon[2];
    const lat = cLat[0] * pagePts[i]![0] + cLat[1] * pagePts[i]![1] + cLat[2];
    maxRes = Math.max(
      maxRes,
      Math.hypot((lon - lons[i]!) * mPerDegLon, (lat - lats[i]!) * mPerDegLat),
    );
  }
  const pageToLonLat = (x: number, y: number): [number, number] => [
    cLon[0] * x + cLon[1] * y + cLon[2],
    cLat[0] * x + cLat[1] * y + cLat[2],
  ];
  const scale = Math.hypot(cLon[0] * mPerDegLon, cLat[0] * mPerDegLat);
  return {
    bbox: [bx0, by0, bx1, by1],
    pageW,
    pageH,
    proj4def: "epsg:4326 (corner-bilinear fallback)",
    crsName: "WGS84 (bilinear from GPTS corners)",
    corners,
    maxResidualM: maxRes,
    scaleMPerPt: scale,
    pageToLonLat,
    topLeftToLonLat: (x, yTopDown) => pageToLonLat(x, pageH - yTopDown),
  };
}
