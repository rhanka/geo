/**
 * Tests for {@link FileProvider}: on-disk format loading, bbox/limit/offset, and
 * graceful handling of a missing directory.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AdminFeatureCollection, CollectionMeta } from "@sentropic/geo-core";

import { FileProvider } from "./file-provider.js";

const COLLECTION: AdminFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "ca/qc/region/06",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-73.7, 45.4],
            [-73.5, 45.4],
            [-73.5, 45.6],
            [-73.7, 45.6],
            [-73.7, 45.4],
          ],
        ],
      },
      properties: { geoId: "ca/qc/region/06", name: "Montréal", level: "region", country: "CA" },
    },
    {
      type: "Feature",
      id: "ca/qc/region/03",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-71.3, 46.7],
            [-71.1, 46.7],
            [-71.1, 46.9],
            [-71.3, 46.9],
            [-71.3, 46.7],
          ],
        ],
      },
      properties: { geoId: "ca/qc/region/03", name: "Capitale-Nationale", level: "region", country: "CA" },
    },
  ],
};

const META: CollectionMeta = {
  sourceId: "ca-qc-sda",
  datasetId: "ca-qc-regions",
  title: "Régions administratives du Québec",
  license: { id: "cc-by-4.0", title: "CC BY 4.0", redistributable: true, attributionRequired: true },
  attribution: "© Gouvernement du Québec",
  crs: "EPSG:4326",
  fetchedAt: "2026-06-13T00:00:00.000Z",
  count: 2,
};

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "geo-api-fp-"));
  await writeFile(join(dir, "regions.geojson"), JSON.stringify(COLLECTION), "utf8");
  await writeFile(join(dir, "regions.meta.json"), JSON.stringify(META), "utf8");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileProvider on-disk loading", () => {
  it("uses datasetId from meta as the collection id and surfaces meta fields", async () => {
    const provider = new FileProvider(dir);
    const collections = await provider.listCollections();
    expect(collections).toHaveLength(1);
    const col = collections[0]!;
    expect(col.id).toBe("ca-qc-regions");
    expect(col.title).toBe("Régions administratives du Québec");
    expect(col.attribution).toBe("© Gouvernement du Québec");
    expect(col.count).toBe(2);
    expect(col.extent).toBeDefined();
  });

  it("returns items with limit/offset", async () => {
    const provider = new FileProvider(dir);
    const result = await provider.getItems("ca-qc-regions", { limit: 1, offset: 1 });
    expect(result).toBeDefined();
    expect(result!.numberMatched).toBe(2);
    expect(result!.numberReturned).toBe(1);
    expect(result!.features[0]!.id).toBe("ca/qc/region/03");
  });

  it("filters items by bbox", async () => {
    const provider = new FileProvider(dir);
    const result = await provider.getItems("ca-qc-regions", { bbox: [-73.8, 45.3, -73.4, 45.7] });
    expect(result!.numberMatched).toBe(1);
    expect(result!.features[0]!.id).toBe("ca/qc/region/06");
  });

  it("fetches a single item by id", async () => {
    const provider = new FileProvider(dir);
    const feature = await provider.getItem("ca-qc-regions", "ca/qc/region/03");
    expect(feature?.properties.name).toBe("Capitale-Nationale");
  });

  it("treats a missing directory as zero collections", async () => {
    const provider = new FileProvider(join(dir, "does-not-exist"));
    expect(await provider.listCollections()).toEqual([]);
    expect(await provider.getCollection("anything")).toBeUndefined();
    expect(await provider.getItems("anything", {})).toBeUndefined();
  });
});
