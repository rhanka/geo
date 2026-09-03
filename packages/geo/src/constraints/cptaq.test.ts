import { writeFile } from "node:fs/promises";

import { LICENSES } from "@sentropic/geo-core";
import type { FeatureCollection, Polygon } from "geojson";
import { describe, expect, it } from "vitest";

import type { CommandRunner } from "../acquire/gdal.js";
import { isCanonicalGeojsonKey } from "../storage/canonical-key.js";
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
    id: 1,
    mrc: null,
    zonage: "Zone agricole",
    date_maj: "2026-08-31",
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
      zonage: "Zone agricole",
      date_maj: "2026-08-31",
      caveat: CPTAQ_CAVEAT,
      source: {
        dataset: "zone-agricole-transposee",
        version: `sha256:${digest}`,
        artifact_uri: context.rawArtifactUri,
        upstream_uri: CPTAQ_UPSTREAM_URI,
      },
    });
    // mrc + id are dropped from the served properties (SPECIAL-DROP; mrc measured null ×1446)
    expect(properties).not.toHaveProperty("mrc");
    expect(properties).not.toHaveProperty("id");
    expect(properties?.constraint_ref).toMatch(/^cptaq-zone-agricole:[a-f0-9]{64}$/);
    expect(properties?.constraint_ref).toBe(second[0]?.features[0]?.properties.constraint_ref);
    expect(first[0]?.proof).toEqual({ schema_version: "2.0", geometry_source: context.proof });
  });

  it("serves agricole-only features but proves coverage from the FULL dataset emprise (§3)", () => {
    // Full dataset: one agricole zone over Warden + one NON-agricole zone spanning the province.
    // Warden serves the agricole feature (1); the other cities serve 0 agricole features yet stay
    // COVERED (no-hit-covered), because the emprise is the full-dataset extent — the agricole filter
    // applies to served features AFTER the emprise is computed. This is the §3 coverage proof.
    const mixed: FeatureCollection<Polygon, Record<string, unknown>> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: square(-72.60, 45.30, -72.45, 45.45),
          properties: { id: 1, mrc: null, zonage: "Zone agricole", date_maj: "2026-08-31" },
        },
        {
          type: "Feature",
          geometry: square(-75, 44.5, -71, 46),
          properties: { id: 2, mrc: null, zonage: "Zone non agricole", date_maj: "2026-08-31" },
        },
      ],
    };
    const collections = buildCptaqServedCollections({ source: mixed, boundaries: boundaries(), context });
    const warden = collections.find((c) => c.name.includes("warden"))!;
    const sutton = collections.find((c) => c.name.includes("sutton"))!;
    // Warden: the agricole feature is served (1); the non-agricole is never served.
    expect(warden.features).toHaveLength(1);
    expect(warden.features[0]!.properties.zonage).toBe("Zone agricole");
    // Sutton: 0 agricole features, but STILL built + covered from the full-dataset emprise.
    expect(sutton.features).toHaveLength(0);
    expect(sutton.emprise.polygon.type).toBe("MultiPolygon");
    // No served feature anywhere carries the non-agricole class.
    for (const collection of collections) {
      for (const feature of collection.features) {
        expect(feature.properties.zonage).toBe("Zone agricole");
      }
    }
  });

  it("rejects every out-of-whitelist source property, including PII", () => {
    expect(() =>
      buildCptaqServedCollections({
        source: source({ zonage: "Zone agricole", date_maj: "2026-08-31", proprietaire: "Personne" }),
        boundaries: boundaries(),
        context,
      }),
    ).toThrow(/property whitelist rejected: proprietaire/);
  });

  it("special-drops {id, mrc} silently, rejects unknown, keeps missing values null", () => {
    // {id, mrc} are known non-PII → dropped silently (not served, not rejected)
    expect(assertCptaqSourceProperties({ id: 42, mrc: null, zonage: "Zone agricole", date_maj: "2026-08-31" }))
      .toEqual({ zonage: "Zone agricole", date_maj: "2026-08-31" });
    // missing whitelisted values stay explicit null
    expect(assertCptaqSourceProperties({ mrc: null })).toEqual({ zonage: null, date_maj: null });
    // any OTHER key is unknown → REJECT (fail-closed, potential PII)
    expect(() => assertCptaqSourceProperties({ proprietaire: "Personne" }))
      .toThrow(/property whitelist rejected: proprietaire/);
    expect(CPTAQ_PROPERTY_WHITELIST).toEqual(["zonage", "date_maj"]);
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
      // inspectLayerSourceCrs now calls `ogrinfo -ro -so <source> <layer>` (TEXT, no -json;
      // the layer is the last arg). listLayers omits the layer arg. Mirror real GDAL 3.6.2 output.
      if (file === "ogrinfo" && args.at(-1) === CPTAQ_LAYER) {
        return { stdout: `Layer SRS WKT:\n${wkt}\nData axis to CRS axis mapping: 1,2\n`, stderr: "" };
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
      // CRS read succeeds (valid WKT via TEXT); the layer is then rejected as non-Polygon downstream.
      if (file === "ogrinfo" && args.at(-1) === CPTAQ_LAYER) {
        return { stdout: `Layer SRS WKT:\nPROJCRS["NAD83"]\nData axis to CRS axis mapping: 1,2\n`, stderr: "" };
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
    expect(first.layout.flatMetaKey).toBe(
      "normalized/ca-qc-constraints/ca-qc-constraints-warden.meta.json",
    );
    expect(first.layout.nestedMetaKey).toBe(
      "normalized/ca-qc-constraints/ca-qc-constraints-warden/ca-qc-constraints-warden.meta.json",
    );
    expect(first.snapshotKey).toMatch(/\/_snapshots\/[a-f0-9]{64}\.geojson$/);
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
    expect(one.map((item) => [...item.metaBytes])).toEqual(
      two.map((item) => [...item.metaBytes]),
    );
  });

  it.each(CPTAQ_PHASE1_CITIES)(
    "writes canonical $slug metadata beside both served layouts",
    async (city) => {
      const publication = prepareCptaqPublications(collections, CPTAQ_PREPROD_BUCKET)
        .find((item) => item.citySlug === city.slug)!;
      const store = memoryStore();
      await publishCptaqPublications(store, [publication], false);

      const flatMetaKey = publication.layout.flatMetaKey;
      const nestedMetaKey = publication.layout.nestedMetaKey;
      const flatMetaBytes = store.objects.get(flatMetaKey)?.bytes;
      const nestedMetaBytes = store.objects.get(nestedMetaKey)?.bytes;
      expect(flatMetaBytes).toEqual(publication.metaBytes);
      expect(nestedMetaBytes).toEqual(publication.metaBytes);

      const meta = JSON.parse(new TextDecoder().decode(flatMetaBytes));
      expect(meta).toEqual({
        attribution: "© CPTAQ, Gouvernement du Québec (CC-BY-4.0)",
        count: publication.collection.features.length,
        crs: "EPSG:4326",
        datasetId: `ca-qc-constraints-${city.slug}`,
        fetchedAt: context.proof.retrieved_at,
        license: LICENSES["cc-by-4.0"],
        rights: {
          licenseStatus: "explicit",
          profile: "open",
          usageNotice: "Transposée au cadastre — n'est PAS le plan légal officiel (D07)",
        },
        sourceId: "ca-qc/cptaq-zone-agricole",
        title: `Zone agricole protégée (CPTAQ transposée) — ${city.name}`,
      });
      expect(meta.license.id).toBe(LICENSES["cc-by-4.0"].id);
    },
  );

  it("keeps served collections canonical while excluding pointers and snapshots", () => {
    for (const publication of prepareCptaqPublications(collections, CPTAQ_PREPROD_BUCKET)) {
      expect(isCanonicalGeojsonKey(publication.layout.flatCollectionKey)).toBe(true);
      expect(isCanonicalGeojsonKey(publication.layout.nestedCollectionKey)).toBe(true);
      expect(isCanonicalGeojsonKey(publication.layout.flatLatestKey)).toBe(false);
      expect(isCanonicalGeojsonKey(publication.layout.nestedLatestKey)).toBe(false);
      expect(isCanonicalGeojsonKey(publication.snapshotKey)).toBe(false);
      expect(isCanonicalGeojsonKey(
        publication.snapshotKey.replace("/_snapshots/", "/snapshots/"),
      )).toBe(true);
    }
  });

  it("writes snapshot first then both collection/metadata layouts and both pointers", async () => {
    const store = memoryStore();
    const publications = prepareCptaqPublications(collections, CPTAQ_PREPROD_BUCKET);
    await publishCptaqPublications(store, publications, false);
    for (const publication of publications) {
      expect(store.objects.has(publication.snapshotKey)).toBe(true);
      expect(store.objects.has(publication.layout.flatCollectionKey)).toBe(true);
      expect(store.objects.has(publication.layout.nestedCollectionKey)).toBe(true);
      expect(store.objects.has(publication.layout.flatMetaKey)).toBe(true);
      expect(store.objects.has(publication.layout.nestedMetaKey)).toBe(true);
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
