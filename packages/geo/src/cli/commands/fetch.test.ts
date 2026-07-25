import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection } from "@sentropic/geo-core";
import { LicenseError } from "../../acquire/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSource, formatFetchResult } from "./fetch.js";
import { buildRegistry } from "../registry.js";
import { FIXTURE_REGISTRY } from "../../catalog/fixtures.js";

// Engine tests inject a registry built from the hermetic fixture (ADR-0017): the
// engine never statically imports source packages. The end-to-end coverage of
// the *real* ca-qc gpkg pipeline lives in the americas continent lib's tests.
const REGISTRY = buildRegistry([FIXTURE_REGISTRY]);

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

  it("dispatches the resolved recipe into acquire and writes normalized output", async () => {
    // The fixture's qc-regions dataset carries a `recipe` tag resolving to the
    // SDA-shaped recipe. Inject an `acquire` that runs whatever recipe the
    // engine dispatched into the `normalizer` slot over the raw payload, so the
    // recipe-dispatch path is exercised hermetically (no GDAL, no network): the
    // written output reflects the recipe's canonical geoId.
    const acquire = vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (manifest: any, _id: string, opts: any) => {
        const collection = opts.normalizer
          ? opts.normalizer(REGION_FC, { manifest, dataset: manifest.datasets[0] })
          : REGION_FC;
        return {
          meta: {
            sourceId: "ca-qc/sda",
            datasetId: "qc-regions",
            title: "qc-regions",
            license: {
              id: "cc-by-4.0",
              title: "CC BY 4.0",
              redistributable: true,
              attributionRequired: true,
            },
            attribution: "© Gouvernement du Québec",
            crs: "EPSG:4326" as const,
            fetchedAt: new Date().toISOString(),
            count: 1,
          },
          collection,
        };
      },
    );

    const result = await fetchSource(
      "ca-qc/sda",
      "qc-regions",
      { out: outDir },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { registry: REGISTRY, acquire: acquire as any, cacheDir },
    );

    expect(result.datasets).toHaveLength(1);
    const ds = result.datasets[0];
    expect(ds?.datasetId).toBe("qc-regions");
    expect(ds?.count).toBe(1);
    expect(ds?.license).toBe("cc-by-4.0");
    expect(ds?.attribution.length).toBeGreaterThan(0);

    // The dispatched recipe ran: geoId is canonical, not the raw passthrough.
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
      { registry: REGISTRY, acquire: acquire as any, writeNormalized: writeNormalized as any },
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
      fetchSource("ca-qc/sda", "nope", { out: outDir }, { registry: REGISTRY }),
    ).rejects.toThrow(/unknown dataset/);
  });

  it("throws for an unknown source", async () => {
    await expect(
      fetchSource("nope", undefined, { out: outDir }, { registry: REGISTRY }),
    ).rejects.toThrow(/unknown source/);
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
        { registry: REGISTRY, acquire: acquire as any },
      ),
    ).rejects.toBeInstanceOf(LicenseError);
  });
});
