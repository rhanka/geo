import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection, SourceManifest } from "@sentropic/geo-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquire, writeNormalized } from "./acquire.js";
import type { CommandRunner } from "./gdal.js";
import { LicenseError } from "./license-gate.js";

const SAMPLE: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-71.2, 46.8] },
      properties: { code: "06", nom: "Montréal" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-71.3, 46.9] },
      properties: { code: "03", nom: "Capitale-Nationale" },
    },
  ],
};

function arcgisManifest(license: SourceManifest["license"] = "cc-by-4.0"): SourceManifest {
  return {
    id: "ca-qc/decoupages",
    title: "Découpages administratifs du Québec",
    jurisdiction: { country: "CA", subdivision: "CA-QC", level: "region" },
    provider: { name: "Gouvernement du Québec" },
    license,
    datasets: [
      {
        id: "regions",
        title: "Régions administratives",
        format: "arcgis-rest",
        url: "https://services.arcgis.com/qc/FeatureServer",
        layer: 0,
        adminLevel: "region",
        query: { where: "1=1" },
      },
    ],
  };
}

function fetchReturning(payload: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), { status: 200, statusText: "OK" }),
  ) as unknown as typeof fetch;
}

describe("acquire", () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "geo-acquire-acq-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("acquires an arcgis-rest dataset end-to-end", async () => {
    const manifest = arcgisManifest();
    const result = await acquire(manifest, "regions", {
      cacheDir,
      fetchImpl: fetchReturning(SAMPLE),
    });

    expect(result.meta.count).toBe(2);
    expect(result.collection.features).toHaveLength(2);
    expect(result.meta.crs).toBe("EPSG:4326");
    expect(result.meta.license.redistributable).toBe(true);
    expect(result.meta.attribution.length).toBeGreaterThan(0);
    expect(result.meta.checksum?.algo).toBe("sha256");
    expect(result.meta.checksum?.value).toMatch(/^[0-9a-f]{64}$/);

    // Properties coerced toward AdminProperties.
    const [first] = result.collection.features;
    expect(first?.properties.name).toBe("Montréal");
    expect(first?.properties.level).toBe("region");
    expect(first?.properties.country).toBe("CA");
    expect(typeof first?.properties.geoId).toBe("string");
  });

  it("throws LicenseError before fetching for a proprietary source", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      acquire(arcgisManifest("proprietary"), "regions", { cacheDir, fetchImpl }),
    ).rejects.toThrow(LicenseError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws for an unknown dataset id", async () => {
    await expect(
      acquire(arcgisManifest(), "nope", { cacheDir, fetchImpl: fetchReturning(SAMPLE) }),
    ).rejects.toThrow(/not found/);
  });

  it("throws a clear error for an unsupported V1 format", async () => {
    const manifest = arcgisManifest();
    const dataset = manifest.datasets[0];
    if (dataset) dataset.format = "wms";
    await expect(
      acquire(manifest, "regions", { cacheDir, fetchImpl: fetchReturning(SAMPLE) }),
    ).rejects.toThrow(/not yet supported in V1/);
  });

  it("acquires a plain geojson dataset using dataset.url directly", async () => {
    const manifest: SourceManifest = {
      ...arcgisManifest(),
      datasets: [
        {
          id: "regions",
          title: "Régions",
          format: "geojson",
          url: "https://data.test/regions.geojson",
          adminLevel: "region",
        },
      ],
    };
    const result = await acquire(manifest, "regions", {
      cacheDir,
      fetchImpl: fetchReturning(SAMPLE),
    });
    expect(result.meta.count).toBe(2);
  });

  it("acquires a gpkg dataset via GDAL (injected runner, no real ogr2ogr)", async () => {
    const manifest: SourceManifest = {
      ...arcgisManifest(),
      datasets: [
        {
          id: "regions",
          title: "Régions",
          format: "gpkg",
          url: "https://data.test/SDA.gpkg.zip",
          crs: "EPSG:32198",
          adminLevel: "region",
          layer: "regio_s",
          query: { simplify: 0.0008 },
        },
      ],
    };

    // Fake archive bytes (never actually parsed as a zip — GDAL is mocked).
    const fetchImpl = vi.fn(async () =>
      new Response("PK fake zip", { status: 200, statusText: "OK" }),
    ) as unknown as typeof fetch;

    // The fake ogr2ogr writes the WGS84 GeoJSON to the outPath it is given.
    const gdalRunner: CommandRunner = async (file, args) => {
      if (file === "ogrinfo") return { stdout: "1: regio_s (3D Multi Polygon)", stderr: "" };
      // ogr2ogr args: [..., outPath, source, layer]; outPath is 3rd-from-last.
      const outPath = args[args.length - 3];
      if (typeof outPath === "string") {
        await writeFile(outPath, JSON.stringify(SAMPLE));
      }
      return { stdout: "", stderr: "" };
    };

    const result = await acquire(manifest, "regions", { cacheDir, fetchImpl, gdalRunner });

    expect(result.meta.count).toBe(2);
    expect(result.meta.crs).toBe("EPSG:4326");
    expect(result.collection.features[0]?.properties.level).toBe("region");
  });

  it("throws when a gpkg dataset omits a string layer", async () => {
    const manifest: SourceManifest = {
      ...arcgisManifest(),
      datasets: [
        {
          id: "regions",
          title: "Régions",
          format: "gpkg",
          url: "https://data.test/SDA.gpkg.zip",
          adminLevel: "region",
        },
      ],
    };
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      acquire(manifest, "regions", { cacheDir, fetchImpl }),
    ).rejects.toThrow(/requires a string "layer"/);
  });
});

describe("writeNormalized", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "geo-acquire-out-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("persists the FeatureCollection and a sibling .meta.json", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "geo-acquire-wc-"));
    try {
      const dataset = await acquire(arcgisManifest(), "regions", {
        cacheDir,
        fetchImpl: fetchReturning(SAMPLE),
      });
      const { geojsonPath, metaPath } = await writeNormalized(dataset, outDir);

      expect(geojsonPath.endsWith("/regions.geojson")).toBe(true);
      expect(metaPath.endsWith("/regions.meta.json")).toBe(true);

      const written = JSON.parse(await readFile(geojsonPath, "utf8")) as FeatureCollection;
      expect(written.type).toBe("FeatureCollection");
      expect(written.features).toHaveLength(2);

      const meta = JSON.parse(await readFile(metaPath, "utf8")) as { count: number };
      expect(meta.count).toBe(2);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
