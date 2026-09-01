import { writeFile } from "node:fs/promises";

import type { FeatureCollection, Polygon } from "geojson";
import { describe, expect, it } from "vitest";

import type { CommandRunner } from "../acquire/gdal.js";
import {
  assertCptaqPreprodBucket,
  assertCptaqSourceProperties,
  buildCptaqServedCollections,
  cptaqLayout,
  CPTAQ_CAVEAT,
  CPTAQ_CONSTRAINT_KIND,
  CPTAQ_LAYER,
  CPTAQ_PHASE1_CITIES,
  CPTAQ_PREPROD_BUCKET,
  CPTAQ_PROPERTY_WHITELIST,
  CPTAQ_UPSTREAM_URI,
  extractCptaqLayer,
  prepareCptaqPublications,
  publishCptaqPublications,
  selectCptaqPhase1Boundaries,
  type CptaqBuildContext,
  type CptaqPublishStore,
} from "./cptaq.js";

function square(minX: number, minY: number, maxX: number, maxY: number): Polygon {
  return {
    type: "Polygon",
    coordinates: [[
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ]],
  };
}

function source(
  properties: Record<string, unknown> = {
    Mrc: "Test MRC",
    Date_maj: "2026-08-31",
    Zonage: "zone agricole",
  },
): FeatureCollection<Polygon, Record<string, unknown>> {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties,
      geometry: square(-75, 44.5, -71, 46),
    }],
  };
}

function boundaries(): FeatureCollection<Polygon, Record<string, unknown>> {
  const boxes: Record<string, Polygon> = {
    warden: square(-72.55, 45.35, -72.48, 45.42),
    "saint-stanislas-de-kostka": square(-74.16, 45.14, -74.07, 45.23),
    sutton: square(-72.64, 45.03, -72.52, 45.15),
    coaticook: square(-71.92, 45.02, -71.76, 45.18),
  };
  return {
    type: "FeatureCollection",
    features: CPTAQ_PHASE1_CITIES.map((city) => ({
      type: "Feature",
      properties: { code: city.code, name: city.name },
      geometry: boxes[city.slug]!,
    })),
  };
}

const digest = "a".repeat(64);
const context: CptaqBuildContext = {
  bucket: CPTAQ_PREPROD_BUCKET,
  rawArtifactUri: `s3://${CPTAQ_PREPROD_BUCKET}/raw/cptaq/cas/${digest}.bin`,
  captureManifestUri: `s3://${CPTAQ_PREPROD_BUCKET}/capture/_runs/constraints-20260831T220000Z-0/manifest.jsonl`,
  boundaryArtifactUri: `s3://${CPTAQ_PREPROD_BUCKET}/normalized/qc-admin-boundaries/qc-municipalites.geojson`,
  boundarySha256: `sha256:${"b".repeat(64)}`,
  sourceCrsWkt: 'PROJCRS["NAD83 / Quebec Lambert"]',
  proof: {
    url: CPTAQ_UPSTREAM_URI,
    method: "gdal/ogr2ogr zone_agricole_s -> EPSG:4326 RFC7946; simplify=NONE; clip=intersection",
    retrieved_at: "2026-08-31T22:00:00.000Z",
    sha256: `sha256:${digest}`,
  },
};

describe("CPTAQ Phase-1 transform", () => {
  it("confirms the four exact slugs against unique served boundary code/name identities", () => {
    const selected = selectCptaqPhase1Boundaries(boundaries());
    expect([...selected.keys()]).toEqual([
      "warden",
      "saint-stanislas-de-kostka",
      "sutton",
      "coaticook",
    ]);
    expect(selected.get("saint-stanislas-de-kostka")?.properties).toMatchObject({
      code: "70040",
      name: "Saint-Stanislas-de-Kostka",
    });
  });

  it("rejects the wrong Saint-Stanislas boundary instead of guessing a slug", () => {
    const value = boundaries();
    value.features[1]!.properties.name = "Saint-Stanislas";
    expect(() => selectCptaqPhase1Boundaries(value)).toThrow(/saint-stanislas-de-kostka.*received 0/);
  });

  it("clips per city and emits WGS84 MultiPolygon served collections", () => {
    const collections = buildCptaqServedCollections({ source: source(), boundaries: boundaries(), context });
    expect(collections).toHaveLength(4);
    for (const collection of collections) {
      expect(collection.name).toMatch(/^ca-qc-constraints-/);
      expect(collection.features).toHaveLength(1);
      expect(collection.features[0]?.geometry.type).toBe("MultiPolygon");
      expect(collection.bbox).toEqual(collection.emprise.bbox);
      expect(collection.provenance.transform).toMatchObject({
        source_crs_wkt: context.sourceCrsWkt,
        target_crs: "EPSG:4326",
        rfc7946: true,
        geometry_type: "MultiPolygon",
        simplify: { method: "NONE", tolerance: null },
      });
    }
    expect(collections[0]?.bbox).toEqual([-72.55, 45.35, -72.48, 45.42]);
  });

  it("emits the ratified properties, proof-v2 and deterministic constraint ref", () => {
    const first = buildCptaqServedCollections({ source: source(), boundaries: boundaries(), context });
    const second = buildCptaqServedCollections({ source: source(), boundaries: boundaries(), context });
    const properties = first[0]?.features[0]?.properties;
    expect(properties).toMatchObject({
      constraint_kind: CPTAQ_CONSTRAINT_KIND,
      Mrc: "Test MRC",
      Date_maj: "2026-08-31",
      Zonage: "zone agricole",
      caveat: CPTAQ_CAVEAT,
      source: {
        dataset: "zone-agricole-transposee",
        version: `sha256:${digest}`,
        artifact_uri: context.rawArtifactUri,
        upstream_uri: CPTAQ_UPSTREAM_URI,
      },
    });
    expect(properties?.constraint_ref).toMatch(/^cptaq-zone-agricole:[a-f0-9]{64}$/);
    expect(properties?.constraint_ref).toBe(second[0]?.features[0]?.properties.constraint_ref);
    expect(first[0]?.proof).toEqual({ schema_version: "2.0", geometry_source: context.proof });
  });

  it("rejects every out-of-whitelist source property, including PII", () => {
    expect(() =>
      buildCptaqServedCollections({
        source: source({ Mrc: "MRC", Date_maj: "2026-08-31", Zonage: "A", proprietaire: "Personne" }),
        boundaries: boundaries(),
        context,
      }),
    ).toThrow(/property whitelist rejected: proprietaire/);
  });

  it("keeps missing whitelisted values explicit as null", () => {
    expect(assertCptaqSourceProperties({ Mrc: "MRC" })).toEqual({
      Mrc: "MRC",
      Date_maj: null,
      Zonage: null,
    });
    expect(CPTAQ_PROPERTY_WHITELIST).toEqual(["Mrc", "Date_maj", "Zonage"]);
  });

  it("rejects the production bucket before building any output", () => {
    expect(() => assertCptaqPreprodBucket("sentropic-geo")).toThrow(/only sentropic-geo-preprod/);
    expect(() =>
      buildCptaqServedCollections({
        source: source(),
        boundaries: boundaries(),
        context: { ...context, bucket: "sentropic-geo" },
      }),
    ).toThrow(/only sentropic-geo-preprod/);
  });
});

describe("CPTAQ exact GDAL extraction", () => {
  it("reads .prj CRS, reprojects RFC7946 and never passes -simplify", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const wkt = 'PROJCRS["NAD83 / Quebec Lambert"]';
    const runner: CommandRunner = async (file, args) => {
      calls.push({ file, args: [...args] });
      if (file === "ogrinfo" && args.includes("-json")) {
        return { stdout: JSON.stringify({ layers: [{ coordinateSystem: { wkt } }] }), stderr: "" };
      }
      if (file === "ogrinfo") return { stdout: `1: ${CPTAQ_LAYER} (Polygon)`, stderr: "" };
      const outPath = args.at(-3);
      if (!outPath) throw new Error("fake ogr2ogr output path absent");
      await writeFile(outPath, JSON.stringify(source()));
      return { stdout: "", stderr: "" };
    };

    const result = await extractCptaqLayer("/tmp/proof-bound-cptaq-cas.bin", runner);
    expect(result.sourceCrsWkt).toBe(wkt);
    expect(result.layers).toEqual([{ name: CPTAQ_LAYER, geometryType: "Polygon" }]);
    const ogr2ogr = calls.find((call) => call.file === "ogr2ogr");
    expect(ogr2ogr?.args).toContain("EPSG:4326");
    expect(ogr2ogr?.args).toContain("RFC7946=YES");
    expect(ogr2ogr?.args).not.toContain("-simplify");
    expect(ogr2ogr?.args.some((arg) => arg.startsWith("COORDINATE_PRECISION=")))
      .toBe(false);
  });

  it("rejects the cartographic line layer", async () => {
    const runner: CommandRunner = async (file, args) => {
      if (file === "ogrinfo" && args.includes("-json")) {
        return { stdout: JSON.stringify({ layers: [{ coordinateSystem: { wkt: "WKT" } }] }), stderr: "" };
      }
      if (file === "ogrinfo") return { stdout: `1: ${CPTAQ_LAYER} (Line String)`, stderr: "" };
      const outPath = args.at(-3)!;
      await writeFile(outPath, JSON.stringify(source()));
      return { stdout: "", stderr: "" };
    };
    await expect(extractCptaqLayer("/tmp/proof-bound-cptaq-cas.bin", runner)).rejects.toThrow(
      /must be POLYGON/,
    );
  });
});

function memoryStore(bucket = CPTAQ_PREPROD_BUCKET): CptaqPublishStore & {
  objects: Map<string, { bytes: Uint8Array; etag: string }>;
  writes: string[];
} {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  const writes: string[] = [];
  let revision = 0;
  return {
    bucket,
    objects,
    writes,
    read: async (key) => {
      const object = objects.get(key);
      return object ? { bytes: object.bytes, etag: object.etag } : null;
    },
    putIfAbsent: async (key, body) => {
      if (objects.has(key)) return false;
      objects.set(key, { bytes: body, etag: `etag-${++revision}` });
      writes.push(key);
      return true;
    },
    putIfCurrent: async (key, body, priorEtag) => {
      const previous = objects.get(key);
      if ((previous?.etag ?? null) !== priorEtag) throw new Error(`CAS mismatch: ${key}`);
      objects.set(key, { bytes: body, etag: `etag-${++revision}` });
      writes.push(key);
    },
  };
}

describe("CPTAQ served publication", () => {
  const collections = buildCptaqServedCollections({ source: source(), boundaries: boundaries(), context });

  it("prepares flat+nested layouts, immutable sha snapshot and two CAS pointers", () => {
    const publications = prepareCptaqPublications(collections, CPTAQ_PREPROD_BUCKET);
    const first = publications[0]!;
    expect(first.layout).toEqual(cptaqLayout("warden"));
    expect(first.layout.flatCollectionKey).toBe(
      "normalized/ca-qc-constraints/ca-qc-constraints-warden.geojson",
    );
    expect(first.layout.nestedCollectionKey).toBe(
      "normalized/ca-qc-constraints/ca-qc-constraints-warden/ca-qc-constraints-warden.geojson",
    );
    expect(first.snapshotKey).toMatch(/\/snapshots\/[a-f0-9]{64}\.geojson$/);
    const pointer = JSON.parse(new TextDecoder().decode(first.pointerBytes));
    expect(pointer).toMatchObject({
      schema_version: "1.0.0",
      contract: "ca-qc-constraints-latest",
      snapshot_sha256: first.snapshotSha256,
      served_s3_uris: {
        flat: `s3://${CPTAQ_PREPROD_BUCKET}/${first.layout.flatCollectionKey}`,
        nested: `s3://${CPTAQ_PREPROD_BUCKET}/${first.layout.nestedCollectionKey}`,
      },
    });
  });

  it("re-applies the no-PII whitelist at deposit time", () => {
    const tainted = structuredClone(collections) as unknown as Array<{
      features: Array<{ properties: Record<string, unknown> }>;
    }>;
    tainted[0]!.features[0]!.properties["proprietaire"] = "Personne";
    expect(() => prepareCptaqPublications(
      tainted as unknown as typeof collections,
      CPTAQ_PREPROD_BUCKET,
    )).toThrow(/deposit property whitelist.*proprietaire/);
  });

  it("produces byte-identical snapshots for byte-identical inputs", () => {
    const one = prepareCptaqPublications(collections, CPTAQ_PREPROD_BUCKET);
    const two = prepareCptaqPublications(
      buildCptaqServedCollections({ source: source(), boundaries: boundaries(), context }),
      CPTAQ_PREPROD_BUCKET,
    );
    expect(one.map((item) => item.snapshotSha256)).toEqual(two.map((item) => item.snapshotSha256));
    expect([...one[0]!.collectionBytes]).toEqual([...two[0]!.collectionBytes]);
  });

  it("writes snapshot first then both collection layouts and both pointers", async () => {
    const store = memoryStore();
    const publications = prepareCptaqPublications(collections, CPTAQ_PREPROD_BUCKET);
    await publishCptaqPublications(store, publications, false);
    for (const publication of publications) {
      expect(store.objects.has(publication.snapshotKey)).toBe(true);
      expect(store.objects.has(publication.layout.flatCollectionKey)).toBe(true);
      expect(store.objects.has(publication.layout.nestedCollectionKey)).toBe(true);
      expect(store.objects.has(publication.layout.flatLatestKey)).toBe(true);
      expect(store.objects.has(publication.layout.nestedLatestKey)).toBe(true);
      expect(store.writes.indexOf(publication.snapshotKey)).toBeLessThan(
        store.writes.indexOf(publication.layout.nestedLatestKey),
      );
    }
  });

  it("keeps dry-run non-writing and refuses a production store", async () => {
    const dry = memoryStore();
    await publishCptaqPublications(
      dry,
      prepareCptaqPublications(collections, CPTAQ_PREPROD_BUCKET),
      true,
    );
    expect(dry.writes).toEqual([]);
    await expect(
      publishCptaqPublications(memoryStore("sentropic-geo"), [], false),
    ).rejects.toThrow(/only sentropic-geo-preprod/);
  });
});
