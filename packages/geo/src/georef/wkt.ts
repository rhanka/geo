/**
 * georef/wkt.ts — parse an ESRI/OGC WKT `PROJCS` (Transverse Mercator / MTM /
 * UTM family) into a proj4 definition string. Pure string/regex work, no I/O.
 *
 * Ported from the acquisition recalage pipeline (`acquisition/src/lib/t1-georef.ts`).
 */

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
