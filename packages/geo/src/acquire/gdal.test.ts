import { describe, expect, it, vi } from "vitest";

import {
  archiveKindFromPath,
  build7zExtractArgs,
  buildOgr2OgrArgs,
  extractLayerToGeoJson,
  inspectLayerSourceCrs,
  listLayers,
  parseOgrinfoLayers,
  parseOgrinfoSourceCrs,
  run7zExtract,
  runOgr2Ogr,
  vsizipPath,
  type CommandRunner,
} from "./gdal.js";

describe("vsizipPath", () => {
  it("builds an archive-root path when no inner is given", () => {
    expect(vsizipPath("/tmp/a.zip")).toBe("/vsizip//tmp/a.zip");
  });
  it("builds an inner-dataset path", () => {
    expect(vsizipPath("/tmp/a.zip", "SDA.gpkg")).toBe("/vsizip//tmp/a.zip/SDA.gpkg");
  });
});

describe("buildOgr2OgrArgs", () => {
  it("reprojects to WGS84 GeoJSON with RFC7946 and a simplify tolerance", () => {
    const args = buildOgr2OgrArgs({
      source: "/vsizip//tmp/a.zip",
      layer: "regio_s",
      outPath: "/tmp/out.geojson",
      tolerance: 0.0008,
    });
    expect(args).toEqual([
      "-f",
      "GeoJSON",
      "-t_srs",
      "EPSG:4326",
      "-simplify",
      "0.0008",
      "-lco",
      "RFC7946=YES",
      "-lco",
      "COORDINATE_PRECISION=6",
      "/tmp/out.geojson",
      "/vsizip//tmp/a.zip",
      "regio_s",
    ]);
  });

  it("honors an explicit coordinatePrecision", () => {
    const args = buildOgr2OgrArgs({
      source: "/vsizip//tmp/a.zip",
      layer: "regio_s",
      outPath: "/tmp/out.geojson",
      tolerance: 0.001,
      coordinatePrecision: 5,
    });
    expect(args).toContain("COORDINATE_PRECISION=5");
  });

  it("reprojects to RFC7946 without any simplification when tolerance is null", () => {
    const args = buildOgr2OgrArgs({
      source: "/vsizip//tmp/ZA_transposee.zip",
      layer: "zone_agricole_s",
      outPath: "/tmp/out.geojson",
      tolerance: null,
    });
    expect(args).toContain("EPSG:4326");
    expect(args).toContain("RFC7946=YES");
    expect(args).not.toContain("-simplify");
  });

  it("can omit coordinate rounding for an EXACT_GEOM workflow", () => {
    const args = buildOgr2OgrArgs({
      source: "/vsizip//tmp/ZA_transposee.zip",
      layer: "zone_agricole_s",
      outPath: "/tmp/out.geojson",
      tolerance: null,
      coordinatePrecision: null,
    });
    expect(args).not.toContain("-simplify");
    expect(args.some((arg) => arg.startsWith("COORDINATE_PRECISION="))).toBe(false);
  });
});

describe("parseOgrinfoLayers", () => {
  it("parses numbered layer lines with and without a geometry type", () => {
    const out = [
      "INFO: Open of `/vsizip//tmp/a.zip'",
      "      using driver `GPKG' successful.",
      "1: arron_s (3D Multi Polygon)",
      "2: regio_s (3D Multi Polygon)",
      "3: regio_l",
      "",
    ].join("\n");
    expect(parseOgrinfoLayers(out)).toEqual([
      { name: "arron_s", geometryType: "3D Multi Polygon" },
      { name: "regio_s", geometryType: "3D Multi Polygon" },
      { name: "regio_l" },
    ]);
  });

  it("returns an empty array when there are no layer lines", () => {
    expect(parseOgrinfoLayers("no layers here")).toEqual([]);
  });
});

/** A runner that records calls and replies per-binary. */
function fakeRunner(
  replies: Partial<Record<string, { stdout?: string; stderr?: string }>>,
): CommandRunner & { calls: { file: string; args: string[] }[] } {
  const calls: { file: string; args: string[] }[] = [];
  const runner = vi.fn(async (file: string, args: readonly string[]) => {
    calls.push({ file, args: [...args] });
    const reply = replies[file];
    return { stdout: reply?.stdout ?? "", stderr: reply?.stderr ?? "" };
  }) as unknown as CommandRunner & { calls: typeof calls };
  runner.calls = calls;
  return runner;
}

/** A runner that throws an ENOENT (missing binary) for `missing`. */
function enoentRunner(missing: string): CommandRunner {
  return async (file: string) => {
    if (file === missing) {
      const err = new Error("spawn ENOENT") as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    }
    return { stdout: "", stderr: "" };
  };
}

/** A runner that exits non-zero (stderr populated) for `failing`. */
function failingRunner(failing: string, stderr: string): CommandRunner {
  return async (file: string) => {
    if (file === failing) {
      const err = new Error("exit 1") as Error & { stderr: string };
      err.stderr = stderr;
      throw err;
    }
    return { stdout: "", stderr: "" };
  };
}

describe("listLayers", () => {
  it("invokes ogrinfo -ro -so and parses its output", async () => {
    const runner = fakeRunner({ ogrinfo: { stdout: "1: regio_s (3D Multi Polygon)" } });
    const layers = await listLayers("/vsizip//tmp/a.zip", runner);
    expect(layers).toEqual([{ name: "regio_s", geometryType: "3D Multi Polygon" }]);
    expect(runner.calls[0]).toEqual({
      file: "ogrinfo",
      args: ["-ro", "-so", "/vsizip//tmp/a.zip"],
    });
  });

  it("throws a clear GDAL-required error when ogrinfo is absent (ENOENT)", async () => {
    await expect(listLayers("/vsizip//tmp/a.zip", enoentRunner("ogrinfo"))).rejects.toThrow(
      /GDAL\/ogrinfo required for bulk formats \(apt-get install gdal-bin\)/,
    );
  });

  it("surfaces stderr on a non-zero exit", async () => {
    await expect(
      listLayers("/vsizip//tmp/a.zip", failingRunner("ogrinfo", "boom: bad zip")),
    ).rejects.toThrow(/ogrinfo failed.*boom: bad zip/s);
  });
});

// REAL fixture — verbatim `ogrinfo -ro -so <raw> zone_agricole_s` from the PROD geo-api image
// (GDAL 3.6.2), captured by a k8s in-image pod-probe. This is the ACTUAL parse path GDAL emits;
// it is what makes this test exercise the real behaviour (not an invented shape) and closes the
// "green in CI / broken in image" REX for the CRS read.
const REAL_OGRINFO_SO_GDAL362 = [
  "INFO: Open of `/vsizip/{/vsis3/sentropic-geo-preprod/raw/cptaq/cas/<sha256>.bin}'",
  "      using driver `ESRI Shapefile' successful.",
  "",
  "Layer name: zone_agricole_s",
  "Metadata:",
  "  DBF_DATE_LAST_UPDATE=2026-05-01",
  "Geometry: Polygon",
  "Feature Count: 1446",
  "Extent: (-79.765324, 44.991358) - (-56.934927, 62.582466)",
  "Layer SRS WKT:",
  'GEOGCRS["NAD83",',
  '    DATUM["North American Datum 1983",',
  '        ELLIPSOID["GRS 1980",6378137,298.257222101,',
  '            LENGTHUNIT["metre",1]]],',
  '    PRIMEM["Greenwich",0,',
  '        ANGLEUNIT["degree",0.0174532925199433]],',
  "    CS[ellipsoidal,2],",
  '        AXIS["latitude",north,',
  "            ORDER[1],",
  '            ANGLEUNIT["degree",0.0174532925199433]],',
  '        AXIS["longitude",east,',
  "            ORDER[2],",
  '            ANGLEUNIT["degree",0.0174532925199433]],',
  '    ID["EPSG",4269]]',
  "Data axis to CRS axis mapping: 2,1",
  "id: Integer (9.0)",
  "mrc: String (100.0)",
  "zonage: String (25.0)",
  "date_maj: Date (10.0)",
].join("\n");

describe("parseOgrinfoSourceCrs (text, version-robust)", () => {
  it("extracts the WKT block from real GDAL 3.6.2 text output, stopping at the WKT close", () => {
    const wkt = parseOgrinfoSourceCrs(REAL_OGRINFO_SO_GDAL362);
    expect(wkt.startsWith('GEOGCRS["NAD83"')).toBe(true);
    expect(wkt).toContain('ID["EPSG",4269]]');
    expect(wkt).not.toContain("Data axis"); // terminated at the balanced-bracket close
    expect(wkt).not.toContain("Feature Count"); // did not slurp the pre-WKT header
    const open = (wkt.match(/\[/g) ?? []).length;
    const close = (wkt.match(/\]/g) ?? []).length;
    expect(open).toBe(close); // brackets balanced
  });

  it("tolerates WKT1 (GEOGCS[...]) as well as WKT2 (GEOGCRS[...])", () => {
    const wkt1 = [
      "Layer SRS WKT:",
      'GEOGCS["NAD83",',
      '    AUTHORITY["EPSG","4269"]]',
      "Data axis to CRS axis mapping: 2,1",
    ].join("\n");
    expect(parseOgrinfoSourceCrs(wkt1)).toBe('GEOGCS["NAD83",AUTHORITY["EPSG","4269"]]');
  });

  it("rejects an absent source CRS instead of guessing (no header, or (unknown))", () => {
    expect(() => parseOgrinfoSourceCrs("Layer name: x\nGeometry: Polygon\n")).toThrow(
      /internal \.prj must be readable/,
    );
    expect(() =>
      parseOgrinfoSourceCrs("Layer SRS WKT:\n(unknown)\nData axis to CRS axis mapping: 2,1"),
    ).toThrow(/internal \.prj must be readable/);
  });
});

describe("inspectLayerSourceCrs", () => {
  it("reads the layer CRS WKT via `ogrinfo -ro -so` TEXT (no -json; GDAL <3.7 compatible)", async () => {
    const runner = fakeRunner({ ogrinfo: { stdout: REAL_OGRINFO_SO_GDAL362 } });
    const wkt = await inspectLayerSourceCrs(
      "/vsizip//tmp/ZA_transposee.zip",
      "zone_agricole_s",
      runner,
    );
    expect(wkt).toContain('ID["EPSG",4269]]');
    expect(runner.calls[0]).toEqual({
      file: "ogrinfo",
      args: ["-ro", "-so", "/vsizip//tmp/ZA_transposee.zip", "zone_agricole_s"],
    });
    // Regression guard: `-json` (GDAL 3.7+) must NEVER be used — the prod image ships GDAL 3.6.2.
    expect(runner.calls[0]?.args).not.toContain("-json");
  });
});

describe("runOgr2Ogr", () => {
  it("invokes ogr2ogr with the built args", async () => {
    const runner = fakeRunner({ ogr2ogr: {} });
    await runOgr2Ogr(
      { source: "/vsizip//tmp/a.zip", layer: "regio_s", outPath: "/tmp/o.geojson", tolerance: 0.001 },
      runner,
    );
    expect(runner.calls[0]?.file).toBe("ogr2ogr");
    expect(runner.calls[0]?.args).toContain("regio_s");
    expect(runner.calls[0]?.args).toContain("0.001");
  });

  it("does not pass -simplify for an exact geometry run", async () => {
    const runner = fakeRunner({ ogr2ogr: {} });
    await runOgr2Ogr(
      { source: "/vsizip//tmp/a.zip", layer: "zone_agricole_s", outPath: "/tmp/o.geojson", tolerance: null },
      runner,
    );
    expect(runner.calls[0]?.args).not.toContain("-simplify");
  });

  it("throws a clear GDAL-required error when ogr2ogr is absent (ENOENT)", async () => {
    await expect(
      runOgr2Ogr(
        { source: "/vsizip//tmp/a.zip", layer: "x", outPath: "/tmp/o.geojson", tolerance: 1 },
        enoentRunner("ogr2ogr"),
      ),
    ).rejects.toThrow(/GDAL\/ogr2ogr required for bulk formats/);
  });

  it("surfaces stderr on a non-zero exit", async () => {
    await expect(
      runOgr2Ogr(
        { source: "/vsizip//tmp/a.zip", layer: "x", outPath: "/tmp/o.geojson", tolerance: 1 },
        failingRunner("ogr2ogr", "ERROR 1: layer not found"),
      ),
    ).rejects.toThrow(/ogr2ogr failed.*layer not found/s);
  });
});

describe("extractLayerToGeoJson", () => {
  it("discovers layers, runs ogr2ogr, and returns parsed GeoJSON (injected runner)", async () => {
    const runner = fakeRunner({
      ogrinfo: { stdout: "1: regio_s (3D Multi Polygon)" },
      ogr2ogr: {},
    });
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [-71, 46] }, properties: {} },
      ],
    };

    const result = await extractLayerToGeoJson({
      // Path need not exist: symlink() to a missing target still succeeds; the
      // injected runner never touches the filesystem and readJson is injected.
      archivePath: "/tmp/does-not-matter.bin",
      layer: "regio_s",
      tolerance: 0.0008,
      runner,
      readJson: async () => fc,
    });

    expect(result.geojson).toEqual(fc);
    expect(result.layers).toEqual([{ name: "regio_s", geometryType: "3D Multi Polygon" }]);

    // ogr2ogr was told to extract our layer from a /vsizip/ source.
    const ogr2ogrCall = runner.calls.find((c) => c.file === "ogr2ogr");
    expect(ogr2ogrCall?.args.at(-1)).toBe("regio_s");
    expect(ogr2ogrCall?.args.at(-2)).toMatch(/^\/vsizip\//);
  });

  it("extracts a .7z archive with 7z then runs ogr2ogr on the real file", async () => {
    const runner = fakeRunner({
      ogrinfo: { stdout: "1: COMMUNE (Multi Polygon)" },
      ogr2ogr: {},
      "7z": {},
    });
    const fc = { type: "FeatureCollection", features: [] };

    const result = await extractLayerToGeoJson({
      archivePath: "/tmp/ADMIN-EXPRESS.7z",
      archiveKind: "7z",
      inner: "ADMIN-EXPRESS/admin.gpkg",
      layer: "COMMUNE",
      tolerance: 0.001,
      runner,
      readJson: async () => fc,
    });

    expect(result.geojson).toEqual(fc);
    // 7z extraction runs before any GDAL call.
    expect(runner.calls[0]?.file).toBe("7z");
    expect(runner.calls[0]?.args).toContain("/tmp/ADMIN-EXPRESS.7z");
    // The GDAL source is the extracted real file, NOT a /vsizip/ path.
    const ogr2ogrCall = runner.calls.find((c) => c.file === "ogr2ogr");
    expect(ogr2ogrCall?.args.at(-2)).not.toMatch(/^\/vsizip\//);
    expect(ogr2ogrCall?.args.at(-2)).toMatch(/admin\.gpkg$/);
  });

  it("rejects a .7z archive without an inner path", async () => {
    await expect(
      extractLayerToGeoJson({
        archivePath: "/tmp/a.7z",
        archiveKind: "7z",
        layer: "X",
        tolerance: 1,
        runner: fakeRunner({}),
        readJson: async () => ({}),
      }),
    ).rejects.toThrow(/\.7z archives require an "inner" path/);
  });
});

describe("archiveKindFromPath", () => {
  it("detects .7z (incl. query/hash) and defaults to zip", () => {
    expect(archiveKindFromPath("https://x/ADMIN.7z")).toBe("7z");
    expect(archiveKindFromPath("https://x/ADMIN.7z?token=1")).toBe("7z");
    expect(archiveKindFromPath("https://x/SDA.gpkg.zip")).toBe("zip");
    expect(archiveKindFromPath("https://x/file.shp.zip")).toBe("zip");
  });
});

describe("build7zExtractArgs / run7zExtract", () => {
  it("builds `7z x -y -bd -o<dir> <archive>`", () => {
    expect(build7zExtractArgs("/tmp/a.7z", "/tmp/work")).toEqual([
      "x",
      "-y",
      "-bd",
      "-o/tmp/work",
      "/tmp/a.7z",
    ]);
  });

  it("throws a clear error when 7z is absent (ENOENT)", async () => {
    await expect(run7zExtract("/tmp/a.7z", "/tmp/work", enoentRunner("7z"))).rejects.toThrow(
      /7z required for \.7z archives \(apt-get install p7zip-full\)/,
    );
  });

  it("surfaces stderr on a non-zero exit", async () => {
    await expect(
      run7zExtract("/tmp/a.7z", "/tmp/work", failingRunner("7z", "Cannot open archive")),
    ).rejects.toThrow(/7z extraction failed.*Cannot open archive/s);
  });
});
