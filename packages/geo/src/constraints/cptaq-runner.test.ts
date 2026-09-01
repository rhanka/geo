import { createHash } from "node:crypto";

import type { FeatureCollection, Polygon } from "geojson";
import { describe, expect, it, vi } from "vitest";

import {
  CPTAQ_BOUNDARIES_KEY,
  CptaqS3Repository,
  cptaqRepositoryFromEnv,
  parseCptaqRunnerArgs,
  proofFromCptaqManifest,
  runCptaqNormalizeServe,
  validateCptaqKeys,
  type CptaqRunnerRepository,
} from "./cptaq-runner.js";
import {
  CPTAQ_LAYER,
  CPTAQ_PHASE1_CITIES,
  CPTAQ_PREPROD_BUCKET,
  CPTAQ_UPSTREAM_URI,
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

function source(): FeatureCollection<Polygon, Record<string, unknown>> {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: square(-75, 44.5, -71, 46),
      properties: { Mrc: "Test", Date_maj: "2026-08-31", Zonage: "A" },
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
      geometry: boxes[city.slug]!,
      properties: { code: city.code, name: city.name },
    })),
  };
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const rawBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x09]);
const rawDigest = digest(rawBytes);
const rawCasKey = `raw/cptaq/cas/${rawDigest}.bin`;
const manifestKey = "capture/_runs/constraints-20260831T220000Z-0/manifest.jsonl";
const retrievedAt = "2026-08-31T22:00:00.000Z";

function manifest(overrides: Record<string, unknown> = {}): Uint8Array {
  const line = {
    run_id: "constraints-20260831T220000Z-0",
    lane: "constraints",
    source: "cptaq",
    url: CPTAQ_UPSTREAM_URI,
    retrieved_at: retrievedAt,
    http_status: 200,
    sha256: `sha256:${rawDigest}`,
    storage_key: rawCasKey,
    error: null,
    redacted: false,
    ...overrides,
  };
  return new TextEncoder().encode(`${JSON.stringify(line)}\n`);
}

function sidecar(overrides: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    id: `raw:cptaq:${rawDigest}`,
    source: "cptaq",
    sourceUrl: CPTAQ_UPSTREAM_URI,
    sha256: rawDigest,
    fetchedAt: retrievedAt,
    storageKey: rawCasKey,
    contentType: "application/zip",
    bytesLen: rawBytes.byteLength,
    provenance: { version: "capturedFetch/1", userAgent: "test", viaObscura: false },
    ...overrides,
  }));
}

function repository(bucket = CPTAQ_PREPROD_BUCKET): CptaqRunnerRepository & {
  writes: string[];
  objects: Map<string, { bytes: Uint8Array; etag: string }>;
} {
  let revision = 0;
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>([
    [rawCasKey, { bytes: rawBytes, etag: "raw" }],
    [manifestKey, { bytes: manifest(), etag: "manifest" }],
    [`${rawCasKey}.meta.json`, { bytes: sidecar(), etag: "sidecar" }],
    [CPTAQ_BOUNDARIES_KEY, {
      bytes: new TextEncoder().encode(JSON.stringify(boundaries())),
      etag: "boundaries",
    }],
  ]);
  const writes: string[] = [];
  return {
    bucket,
    writes,
    objects,
    readRequired: async (key) => {
      const object = objects.get(key);
      if (!object) throw new Error(`absent ${key}`);
      return object;
    },
    read: async (key) => objects.get(key) ?? null,
    putIfAbsent: async (key, body) => {
      if (objects.has(key)) return false;
      objects.set(key, { bytes: body, etag: `revision-${++revision}` });
      writes.push(key);
      return true;
    },
    putIfCurrent: async (key, body, priorEtag) => {
      if ((objects.get(key)?.etag ?? null) !== priorEtag) throw new Error(`stale ${key}`);
      objects.set(key, { bytes: body, etag: `revision-${++revision}` });
      writes.push(key);
    },
  };
}

describe("CPTAQ proof-bound S3 runner", () => {
  it("normalizes only the four confirmed cities and defaults to a non-writing dry run", async () => {
    const store = repository();
    const extractArchive = vi.fn(async (key: string, bytes: Uint8Array) => {
      expect(key).toBe(rawCasKey);
      expect([...bytes]).toEqual([...rawBytes]);
      return {
        source: source(),
        sourceCrsWkt: 'PROJCRS["NAD83 / Quebec Lambert"]',
        layers: [{ name: CPTAQ_LAYER, geometryType: "Polygon" }],
      };
    });
    const summary = await runCptaqNormalizeServe(
      { rawCasKey, captureManifestKey: manifestKey },
      { repository: store, extractArchive },
    );
    expect(summary).toMatchObject({
      bucket: CPTAQ_PREPROD_BUCKET,
      raw_cas_key: rawCasKey,
      raw_sha256: `sha256:${rawDigest}`,
      dry_run: true,
      simplify: "NONE",
      publication_object_count: 20,
    });
    expect(summary.collections.map((item) => item.city_slug)).toEqual([
      "warden",
      "saint-stanislas-de-kostka",
      "sutton",
      "coaticook",
    ]);
    expect(summary.collections.every((item) => item.feature_count === 1)).toBe(true);
    expect(store.writes).toEqual([]);
    expect(extractArchive).toHaveBeenCalledOnce();
  });

  it("publishes exactly snapshot + flat/nested objects + flat/nested CAS pointers", async () => {
    const store = repository();
    const summary = await runCptaqNormalizeServe(
      { rawCasKey, captureManifestKey: manifestKey, publish: true },
      {
        repository: store,
        extractArchive: async () => ({
          source: source(),
          sourceCrsWkt: "CPTAQ .prj WKT",
          layers: [{ name: CPTAQ_LAYER, geometryType: "Polygon" }],
        }),
      },
    );
    expect(summary.dry_run).toBe(false);
    expect(store.writes).toHaveLength(20);
    expect(store.writes.filter((key) => key.endsWith("/latest.json"))).toHaveLength(4);
    expect(store.writes.filter((key) => key.endsWith(".latest.json"))).toHaveLength(4);
    expect(store.writes.filter((key) => key.includes("/snapshots/"))).toHaveLength(4);
  });

  it("fails before GDAL when the S3 bytes do not match the raw CAS key", async () => {
    const store = repository();
    store.objects.set(rawCasKey, { bytes: Uint8Array.from([1, 2, 3]), etag: "changed" });
    const extractArchive = vi.fn();
    await expect(runCptaqNormalizeServe(
      { rawCasKey, captureManifestKey: manifestKey },
      { repository: store, extractArchive },
    )).rejects.toThrow(/bytes do not match the digest/);
    expect(extractArchive).not.toHaveBeenCalled();
  });

  it("rejects a redacted or non-ratified capture proof", () => {
    expect(() => proofFromCptaqManifest(manifest({ redacted: true }), rawCasKey)).toThrow(
      /redacted or UNKNOWN/,
    );
    expect(() => proofFromCptaqManifest(
      manifest({ url: "https://example.invalid/invented.zip" }),
      rawCasKey,
    )).toThrow(/not the ratified/);
  });

  it("refuses alternate raw, manifest, boundary and production targets", () => {
    expect(() => validateCptaqKeys({
      rawCasKey: `raw/other/cas/${rawDigest}.bin`,
      captureManifestKey: manifestKey,
    })).toThrow(/raw\/cptaq\/cas/);
    expect(() => validateCptaqKeys({
      rawCasKey,
      captureManifestKey: "capture/_runs/zones-run/manifest.jsonl",
    })).toThrow(/constraints/);
    expect(() => validateCptaqKeys({
      rawCasKey,
      captureManifestKey: manifestKey,
      boundariesKey: "normalized/invented.geojson",
    })).toThrow(/qc-municipalites/);
    expect(() => cptaqRepositoryFromEnv({
      S3_BUCKET: "sentropic-geo",
      S3_ENDPOINT: "https://s3.example.invalid",
      S3_REGION: "ca-test-1",
    })).toThrow(/only sentropic-geo-preprod/);
  });

  it("parses explicit mutation separately from the required proof inputs", () => {
    expect(parseCptaqRunnerArgs([
      "--raw-cas-key", rawCasKey,
      "--capture-manifest-key", manifestKey,
      "--publish",
    ])).toEqual({ rawCasKey, captureManifestKey: manifestKey, publish: true });
    expect(() => parseCptaqRunnerArgs(["--publish"])).toThrow(/Usage/);
  });
});

describe("CPTAQ S3 CAS adapter", () => {
  it("uses native S3 preconditions for immutable snapshots and mutable pointers", async () => {
    const commands: unknown[] = [];
    const sender = {
      send: vi.fn(async (command: unknown) => {
        commands.push(command);
        return {};
      }),
    };
    const store = new CptaqS3Repository(sender, CPTAQ_PREPROD_BUCKET);
    expect(await store.putIfAbsent("snapshot", Uint8Array.from([1]), "application/json")).toBe(true);
    await store.putIfCurrent("first", Uint8Array.from([2]), null, "application/json");
    await store.putIfCurrent("next", Uint8Array.from([3]), '"etag-before"', "application/json");
    expect(commands.map((command) => (command as { input: Record<string, unknown> }).input)).toEqual([
      expect.objectContaining({ IfNoneMatch: "*", Bucket: CPTAQ_PREPROD_BUCKET }),
      expect.objectContaining({ IfNoneMatch: "*", Bucket: CPTAQ_PREPROD_BUCKET }),
      expect.objectContaining({ IfMatch: '"etag-before"', Bucket: CPTAQ_PREPROD_BUCKET }),
    ]);
  });

  it("converts an S3 412 into an immutable-snapshot already-present result", async () => {
    const sender = {
      send: vi.fn(async () => {
        throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } };
      }),
    };
    const store = new CptaqS3Repository(sender, CPTAQ_PREPROD_BUCKET);
    await expect(store.putIfAbsent("snapshot", Uint8Array.from([1]), "application/json"))
      .resolves.toBe(false);
  });
});
