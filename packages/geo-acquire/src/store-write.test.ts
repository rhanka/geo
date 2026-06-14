import type {
  AdminFeatureCollection,
  NormalizedDataset,
} from "@sentropic/geo-core";
import type { PutOptions, Store } from "@sentropic/geo-storage";
import { describe, expect, it } from "vitest";

import { writeNormalizedToStore } from "./acquire.js";

/** An in-memory {@link Store} recording puts; keeps the test off disk + network. */
class MemoryStore implements Store {
  readonly objects = new Map<string, { body: string; contentType?: string }>();

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    const text = typeof body === "string" ? body : new TextDecoder().decode(body);
    this.objects.set(
      key,
      opts?.contentType !== undefined ? { body: text, contentType: opts.contentType } : { body: text },
    );
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    const o = this.objects.get(key);
    return o ? new TextEncoder().encode(o.body) : undefined;
  }
  async has(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async list(prefix?: string): Promise<string[]> {
    const keys = [...this.objects.keys()].sort();
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
  }
}

function sampleDataset(sourceId = "ca-qc/sda", datasetId = "qc-regions"): NormalizedDataset {
  const collection: AdminFeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-71.2, 46.8] },
        properties: {
          geoId: "qc-03",
          name: "Capitale-Nationale",
          level: "region",
          country: "CA",
        },
      },
    ],
  };
  return {
    meta: {
      sourceId,
      datasetId,
      title: "Régions",
      license: { id: "CC-BY-4.0", name: "CC BY 4.0", redistribute: true } as never,
      attribution: "Source: QC",
      crs: "urn:ogc:def:crs:OGC:1.3:CRS84" as never,
      fetchedAt: "2026-06-13T00:00:00.000Z",
      count: 1,
    },
    collection,
  };
}

describe("writeNormalizedToStore", () => {
  it("puts <sourceSlug>/<datasetId>.geojson + .meta.json into the store", async () => {
    const store = new MemoryStore();
    const { geojsonKey, metaKey } = await writeNormalizedToStore(sampleDataset(), store);

    expect(geojsonKey).toBe("ca-qc-sda/qc-regions.geojson");
    expect(metaKey).toBe("ca-qc-sda/qc-regions.meta.json");
    expect(store.objects.has(geojsonKey)).toBe(true);
    expect(store.objects.has(metaKey)).toBe(true);
  });

  it("prepends an optional prefix to both keys", async () => {
    const store = new MemoryStore();
    const { geojsonKey, metaKey } = await writeNormalizedToStore(
      sampleDataset(),
      store,
      "normalized/v1/",
    );
    expect(geojsonKey).toBe("normalized/v1/ca-qc-sda/qc-regions.geojson");
    expect(metaKey).toBe("normalized/v1/ca-qc-sda/qc-regions.meta.json");
  });

  it("writes the FeatureCollection compactly and meta pretty, with content types", async () => {
    const store = new MemoryStore();
    const { geojsonKey, metaKey } = await writeNormalizedToStore(sampleDataset(), store);

    const geojson = store.objects.get(geojsonKey);
    expect(geojson?.contentType).toBe("application/geo+json");
    expect(geojson?.body).not.toMatch(/\n {2}/); // compact: no 2-space indent
    expect(geojson?.body.endsWith("\n")).toBe(true);

    const meta = store.objects.get(metaKey);
    expect(meta?.contentType).toBe("application/json");
    expect(meta?.body).toMatch(/\n {2}"sourceId"/); // pretty-printed
    const parsed = JSON.parse(meta?.body ?? "{}") as { count: number };
    expect(parsed.count).toBe(1);
  });
});
