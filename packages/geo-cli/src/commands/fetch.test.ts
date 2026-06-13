import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection } from "@sentropic/geo-core";
import { LicenseError, type CommandRunner } from "@sentropic/geo-acquire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSource, formatFetchResult } from "./fetch.js";

const REGION_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-71.2, 46.8] },
      properties: { RES_CO_REG: "03", RES_NM_REG: "Capitale-Nationale" },
    },
  ],
};

function fetchReturning(payload: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(payload), { status: 200, statusText: "OK" }),
  ) as unknown as typeof fetch;
}

describe("fetchSource", () => {
  let outDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "geo-cli-out-"));
    cacheDir = await mkdtemp(join(tmpdir(), "geo-cli-cache-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("acquires one dataset and writes normalized output via the real pipeline", async () => {
    // qc-regions is a bulk `gpkg` dataset (SDA.gpkg.zip + GDAL). Inject a fake
    // GDAL runner so the real acquire + ca-qc normalizer pipeline runs without
    // a real ogr2ogr: ogrinfo lists one layer, ogr2ogr writes REGION_FC to the
    // emitted GeoJSON path (3rd-from-last arg: [..., outPath, source, layer]).
    const gdalRunner: CommandRunner = async (file, args) => {
      if (file === "ogrinfo") return { stdout: "1: regio_s (3D Multi Polygon)", stderr: "" };
      const outPath = args[args.length - 3];
      if (typeof outPath === "string") await writeFile(outPath, JSON.stringify(REGION_FC));
      return { stdout: "", stderr: "" };
    };

    const result = await fetchSource(
      "ca-qc/sda",
      "qc-regions",
      { out: outDir },
      // Isolated cacheDir so this real download never writes the default
      // `.cache/geo` and poisons subsequent fetches (ADR-0007).
      { fetchImpl: fetchReturning(REGION_FC), cacheDir, gdalRunner },
    );

    expect(result.datasets).toHaveLength(1);
    const ds = result.datasets[0];
    expect(ds?.datasetId).toBe("qc-regions");
    expect(ds?.count).toBe(1);
    expect(ds?.license).toBe("cc-by-4.0");
    expect(ds?.attribution.length).toBeGreaterThan(0);

    // The ca-qc normalizer ran: geoId is canonical, not the passthrough fallback.
    const written = JSON.parse(await readFile(ds!.geojsonPath, "utf8")) as {
      features: Array<{ properties: { geoId: string; iso?: string } }>;
    };
    expect(written.features[0]?.properties.geoId).toBe("ca/qc/region/03");
    expect(written.features[0]?.properties.iso).toBe("CA-QC");

    expect(formatFetchResult(result)).toContain("qc-regions");
  });

  it("fetches all datasets of a source when datasetId is omitted (injected acquire)", async () => {
    const acquire = vi.fn(async (_m, id: string) => ({
      meta: {
        sourceId: "ca-qc/sda",
        datasetId: id,
        title: id,
        license: { id: "cc-by-4.0", title: "CC BY 4.0", redistributable: true, attributionRequired: true },
        attribution: "© test",
        crs: "EPSG:4326" as const,
        fetchedAt: new Date().toISOString(),
        count: 2,
      },
      collection: { type: "FeatureCollection" as const, features: [] },
    }));
    const writeNormalized = vi.fn(async (_d, dir: string) => ({
      geojsonPath: join(dir, "x.geojson"),
      metaPath: join(dir, "x.meta.json"),
    }));

    const result = await fetchSource(
      "ca-qc/sda",
      undefined,
      { out: outDir },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { acquire: acquire as any, writeNormalized: writeNormalized as any },
    );

    expect(acquire).toHaveBeenCalledTimes(3);
    expect(result.datasets.map((d) => d.datasetId)).toEqual([
      "qc-regions",
      "qc-mrc",
      "qc-municipalites",
    ]);
  });

  it("throws for an unknown dataset id", async () => {
    await expect(
      fetchSource("ca-qc/sda", "nope", { out: outDir }, { fetchImpl: fetchReturning(REGION_FC) }),
    ).rejects.toThrow(/unknown dataset/);
  });

  it("throws for an unknown source", async () => {
    await expect(fetchSource("nope", undefined, { out: outDir })).rejects.toThrow(/unknown source/);
  });

  it("propagates a LicenseError from a non-redistributable source", async () => {
    const acquire = vi.fn(async () => {
      throw new LicenseError("blocked");
    });
    await expect(
      fetchSource(
        "ca-qc/sda",
        "qc-regions",
        { out: outDir },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { acquire: acquire as any },
      ),
    ).rejects.toBeInstanceOf(LicenseError);
  });
});
