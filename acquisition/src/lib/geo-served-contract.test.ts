import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildGeoServedContract,
  canonicalJson,
  geoServedContractKeys,
  publishGeoServedContract,
  type GeoServedContractStore,
  type ListedObject,
} from "./geo-served-contract.js";

const ZONES = "normalized/ca-qc-zonage/";
const PV = "registry/qc-pv/";
const SNAPSHOT_ID = "a".repeat(24);
const NOW = "2026-07-26T15:00:00.000Z";

function sha256(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function bytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function listed(key: string, size: number): ListedObject {
  return { key, etag: `etag-${key}`, last_modified: "2026-07-26T14:00:00.000Z", size };
}

function memoryStore(seed: Record<string, Buffer>) {
  const data = new Map(Object.entries(seed));
  const calls: string[] = [];
  let latestGeneration = 0;
  const store: GeoServedContractStore = {
    async list(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => listed(key, data.get(key)!.length));
    },
    async read(key) {
      const value = data.get(key);
      return value ? { bytes: value, etag: key.endsWith("latest.json") ? `v${latestGeneration}:${key}` : `etag-${key}`, size: value.length } : null;
    },
    async putIfAbsent(key, body) {
      calls.push(`snapshot:${key}`);
      if (data.has(key)) return false;
      data.set(key, body);
      return true;
    },
    async putLatestIfCurrent(key, body, priorEtag) {
      calls.push(`latest:${key}:${priorEtag ?? "none"}`);
      if (data.has(key) && priorEtag !== `v${latestGeneration}:${key}`) throw new Error("concurrent latest update");
      if (!data.has(key) && priorEtag !== null) throw new Error("missing latest changed");
      latestGeneration++;
      data.set(key, body);
    },
  };
  return { store, data, calls };
}

function options(store: GeoServedContractStore) {
  return {
    store,
    registry: { path: "registry.json", sha256: sha256("registry"), city_slugs: ["alpha", "beta"] },
    canonicalizer: { id: "zone_ref_canon_v1" as const, implementation_path: "canonicalizer.ts", implementation_sha256: sha256("canonicalizer") },
    generatedAt: NOW,
    readConcurrency: 2,
  };
}

function seed(): Record<string, Buffer> {
  const fourA = bytes({ schema_version: "1.0.0", artifact: "geo-4a-delta-grille", complete: true, snapshot_id: SNAPSHOT_ID });
  return {
    // Flat deliberately conflicts with nested: geo-api serves nested, so this
    // value must not influence the contract observation.
    [`${ZONES}qc-zonage-alpha.geojson`]: bytes({ type: "FeatureCollection", features: [{ properties: { zone_code: "WRONG", reglement_numero: "wrong" } }] }),
    [`${ZONES}qc-zonage-alpha/qc-zonage-alpha.geojson`]: bytes({
      type: "FeatureCollection",
      features: [
        {
          properties: {
            zone_code: "H-01",
            reglement_numero: "R-7",
            reglement_millesime: 2024,
            usage_dominant: "residentiel",
            zone_source_url: "https://ville.example.test/zonage",
            zone_source_level: "documented",
          },
        },
        {
          properties: {
            zone_code: "H-1",
            reglement_numero: "R-7",
            reglement_millesime: null,
            usage_dominant: "inconnu",
            zone_source_url: null,
            zone_source_level: "candidate",
          },
        },
      ],
    }),
    [`${PV}alpha/index.json`]: bytes({ entries: [{ url: "https://ville.example.test/pv.pdf" }] }),
    [`${PV}beta/index.json`]: bytes({}),
    "exports/immo/artefact-4a-delta-grille/v1/latest.json": fourA,
    [`exports/immo/artefact-4a-delta-grille/v1/snapshots/${SNAPSHOT_ID}.json`]: fourA,
  };
}

describe("Geo served contract", () => {
  it("measures only the selected served layout, closes all partitions, and keeps unknown separate from complete", async () => {
    const { store } = memoryStore(seed());
    const manifest = await buildGeoServedContract(options(store));

    expect(manifest.complete).toBe(true);
    expect(manifest.qc_zonage.coverage.city_partition).toEqual({ served: 1, absent: 1, invalid: 0 });
    expect(manifest.qc_zonage.cities[0]).toMatchObject({
      city_slug: "alpha",
      state: "served",
      collection: { selected_layout: "nested", collection_s3_uri: `s3://sentropic-geo/${ZONES}qc-zonage-alpha/qc-zonage-alpha.geojson` },
      fields: { usage_dominant: { known: 1, explicit_unknown: 1, absent: 0, invalid: 0 } },
      join_key: {
        joinable: 0,
        blocked_canonical_collision: 2,
        canonical_collisions: [{ zone_ref_canon_v1: "H-1", reglement_number: "R-7", zone_ref_verbatim: ["H-01", "H-1"] }],
      },
      served_geometry_proof_shape: "absent",
    });
    expect(manifest.qc_zonage.cities[1]).toMatchObject({ city_slug: "beta", state: "absent" });
    expect(manifest.qc_zonage.coverage.fields_by_city.usage_dominant).toEqual({
      complete: 0,
      incomplete: 1,
      explicit_unknown: 0,
      absent: 0,
      invalid: 0,
      absent_collection: 1,
    });
    expect(manifest.pv).toMatchObject({
      kind: "index_only",
      bytes_of_pv_documents: "not_served",
      coverage: { present_valid_index: 1, absent: 0, invalid_index: 1 },
    });
    expect(manifest.artefacts.geo_4a_delta_grille).toMatchObject({
      state: "present_verified_snapshot",
      snapshot_id: SNAPSHOT_ID,
      latest_matches_snapshot: true,
    });
  });

  it("uses deterministic bytes whose sha256 names the immutable snapshot, then moves latest", async () => {
    const { store, data, calls } = memoryStore(seed());
    const result = await publishGeoServedContract({ ...options(store), dryRun: false });
    const keys = geoServedContractKeys(result.manifestSha256);

    expect(result.snapshotKey).toBe(keys.snapshotKey);
    expect(data.get(result.snapshotKey)?.toString("utf8")).toBe(`${canonicalJson(result.manifest)}\n`);
    expect(sha256(data.get(result.snapshotKey)!)).toBe(result.manifestSha256);
    expect(calls[0]).toBe(`snapshot:${result.snapshotKey}`);
    expect(calls[1]).toBe(`latest:${result.latestKey}:none`);
    expect(JSON.parse(data.get(result.latestKey)!.toString("utf8"))).toMatchObject({
      snapshot_sha256: result.manifestSha256,
      snapshot_s3_uri: result.snapshotUri,
    });
  });

  it("does not update latest when immutable snapshot creation fails", async () => {
    const { store, calls } = memoryStore(seed());
    const failingStore: GeoServedContractStore = { ...store, putIfAbsent: vi.fn(async () => { throw new Error("S3 snapshot write failed"); }) };

    await expect(publishGeoServedContract({ ...options(failingStore), dryRun: false })).rejects.toThrow("snapshot write failed");
    expect(calls).toEqual([]);
  });

  it("refuses a source object that disappears after a successful listing instead of measuring it absent", async () => {
    const { store } = memoryStore(seed());
    const disappearing: GeoServedContractStore = {
      ...store,
      read: async (key) => key.includes("qc-zonage-alpha/qc-zonage-alpha") ? null : store.read(key),
    };

    await expect(buildGeoServedContract(options(disappearing))).rejects.toThrow("disparue après listing");
  });

  it("refuses bytes whose S3 identity no longer matches the listing", async () => {
    const { store } = memoryStore(seed());
    const replaced: GeoServedContractStore = {
      ...store,
      read: async (key) => {
        const object = await store.read(key);
        return key.includes("qc-zonage-alpha/qc-zonage-alpha") && object ? { ...object, etag: "replacement" } : object;
      },
    };

    await expect(buildGeoServedContract(options(replaced))).rejects.toThrow("identité ETag incohérente");
  });
});
