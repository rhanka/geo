/**
 * Integration test (ADR-0017): the real Québec SDA pipeline, driven through the
 * engine's `fetchSource` against this library's registry. Relocated here from
 * `@sentropic/geo`'s fetch tests in phase D — this is the package that owns the
 * `ca-qc/sda` manifest and its bespoke normalizer recipe, so the real-pipeline
 * assertion belongs here.
 *
 * The GDAL runner and `fetch` are injected so no real ogr2ogr or network is
 * touched: the real ca-qc normalizer runs over a fixture FeatureCollection and
 * must emit the canonical `geoId`/`iso`, proving the manifest → recipe → acquire
 * → normalize wiring is intact end-to-end.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection } from "@sentropic/geo-core";
import { fetchSource, buildRegistry } from "@sentropic/geo/cli";
import type { CommandRunner } from "@sentropic/geo/acquire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registry } from "./index.js";

const REGISTRY = buildRegistry([registry]);

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

describe("ca-qc/sda real pipeline (via @sentropic/geo fetchSource)", () => {
  let outDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "americas-out-"));
    cacheDir = await mkdtemp(join(tmpdir(), "americas-cache-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("acquires qc-regions and runs the real ca-qc normalizer (canonical geoId)", async () => {
    // qc-regions is a bulk `gpkg` dataset (SDA.gpkg.zip + GDAL). Inject a fake
    // GDAL runner so the real acquire + ca-qc normalizer pipeline runs without a
    // real ogr2ogr: ogrinfo lists one layer, ogr2ogr writes REGION_FC to the
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
      // Isolated cacheDir so this never writes the default `.cache/geo` (ADR-0007).
      { registry: REGISTRY, fetchImpl: fetchReturning(REGION_FC), cacheDir, gdalRunner },
    );

    expect(result.datasets).toHaveLength(1);
    const ds = result.datasets[0];
    expect(ds?.datasetId).toBe("qc-regions");
    expect(ds?.count).toBe(1);
    expect(ds?.license).toBe("cc-by-4.0");

    // The real ca-qc normalizer ran: geoId is canonical, iso is the QC subdivision.
    const written = JSON.parse(await readFile(ds!.geojsonPath, "utf8")) as {
      features: Array<{ properties: { geoId: string; iso?: string } }>;
    };
    expect(written.features[0]?.properties.geoId).toBe("ca/qc/region/03");
    expect(written.features[0]?.properties.iso).toBe("CA-QC");
  });
});
