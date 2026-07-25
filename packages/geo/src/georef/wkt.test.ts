/**
 * Unit tests for the WKT PROJCS → proj4 parser (georef/wkt.ts).
 *
 * Pure, network-free. Pins `wktToProj4` on the exact ESRI/OGC WKT used by the
 * embedded-GeoPDF corpus (the "NAD83 / MTM 8" fixture from the acquisition
 * t1-georef test), plus the spheroid-resolution branches and the non-Transverse-
 * Mercator reject.
 */
import { describe, it, expect } from "vitest";

import { wktToProj4 } from "./wkt.js";

describe("georef/wkt — wktToProj4", () => {
  it("parses the NAD83 / MTM 8 fixture into the expected proj4 def", () => {
    const wkt =
      'PROJCS["NAD83 / MTM 8",PROJECTION["Transverse_Mercator"],' +
      'PARAMETER["Central_Meridian",-73.5],PARAMETER["Latitude_Of_Origin",0],' +
      'PARAMETER["Scale_Factor",0.9999],PARAMETER["False_Easting",304800],' +
      'PARAMETER["False_Northing",0]]';
    const got = wktToProj4(wkt);
    expect(got).not.toBeNull();
    expect(got!.name).toBe("NAD83 / MTM 8");
    // No SPHEROID in this fixture → defaults to GRS80.
    expect(got!.def).toBe(
      "+proj=tmerc +lat_0=0 +lon_0=-73.5 +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +units=m +no_defs",
    );
  });

  it("recognises a GRS 1980 spheroid as +ellps=GRS80", () => {
    const wkt =
      'PROJCS["NAD83 CSRS / MTM 7",' +
      'GEOGCS["GCS_North_American_1983_CSRS",DATUM["D_NAD83_CSRS",' +
      'SPHEROID["GRS_1980",6378137.0,298.257222101]]],' +
      'PROJECTION["Transverse_Mercator"],' +
      'PARAMETER["Central_Meridian",-70.5],PARAMETER["Latitude_Of_Origin",0],' +
      'PARAMETER["Scale_Factor",0.9999],PARAMETER["False_Easting",304800],' +
      'PARAMETER["False_Northing",0]]';
    const got = wktToProj4(wkt);
    expect(got).not.toBeNull();
    expect(got!.def).toContain("+ellps=GRS80");
    expect(got!.def).toContain("+lon_0=-70.5");
  });

  it("passes an unknown spheroid through as explicit +a / +rf (no invention)", () => {
    const wkt =
      'PROJCS["Custom TM",' +
      'GEOGCS["Custom",DATUM["D_Custom",SPHEROID["Clarke_1866",6378206.4,294.9786982]]],' +
      'PROJECTION["Transverse_Mercator"],' +
      'PARAMETER["Central_Meridian",-71.0],PARAMETER["Latitude_Of_Origin",0],' +
      'PARAMETER["Scale_Factor",1],PARAMETER["False_Easting",0],' +
      'PARAMETER["False_Northing",0]]';
    const got = wktToProj4(wkt);
    expect(got).not.toBeNull();
    expect(got!.def).toContain("+a=6378206.4 +rf=294.9786982");
  });

  it("returns null for a non-Transverse-Mercator projection", () => {
    const wkt =
      'PROJCS["Lambert",PROJECTION["Lambert_Conformal_Conic"],' +
      'PARAMETER["Central_Meridian",-68.5]]';
    expect(wktToProj4(wkt)).toBeNull();
  });
});
