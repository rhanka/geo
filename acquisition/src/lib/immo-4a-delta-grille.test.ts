import { describe, expect, it, vi } from "vitest";

import {
  IMMO_4A_OUTPUT_PREFIX,
  buildImmo4aArtifact,
  publishImmo4aArtifact,
  type Immo4aStore,
  type VivierB,
} from "./immo-4a-delta-grille.js";

const PREFIX = "normalized/ca-qc-zonage/";
const NOW = "2026-07-26T15:00:00.000Z";

function fc(properties: Array<Record<string, unknown>>): Buffer {
  return Buffer.from(JSON.stringify({
    type: "FeatureCollection",
    features: properties.map((props) => ({ type: "Feature", geometry: null, properties: props })),
  }));
}

function known(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    zone_code: "H-01",
    effet_densifiant: "stable",
    densite_avant: 1,
    densite_apres: 1,
    densite_avant_millesime: "2020",
    densite_avant_reglement: "115-12-2020",
    densite_apres_millesime: "2026",
    densite_apres_reglement: "358",
    usage_dominant: "residentiel",
    zone_source_url: "https://ville.example/zonage",
    zone_source_level: "municipal",
    ...overrides,
  };
}

function vivier(slugs: string[]): VivierB {
  return { as_of: "2026-07-25", count: slugs.length, slugs };
}

function memoryStore(seed: Record<string, Buffer>) {
  const data = new Map(Object.entries(seed));
  const puts = vi.fn(async (key: string, body: Buffer) => { data.set(key, body); });
  const snapshotPuts = vi.fn(async (key: string, body: Buffer) => {
    if (data.has(key)) throw new Error(`snapshot déjà présent: ${key}`);
    data.set(key, body);
  });
  return {
    store: {
      list: async (prefix: string) => [...data.keys()].filter((key) => key.startsWith(prefix)),
      get: async (key: string) => data.get(key) ?? null,
      putIfAbsent: snapshotPuts,
      put: puts,
    },
    puts,
    snapshotPuts,
  };
}

function buildOptions(store: Immo4aStore, slugs = ["sutton"]): Parameters<typeof buildImmo4aArtifact>[0] {
  return {
    store,
    vivier: vivier(slugs),
    vivierSha256: "b".repeat(64),
    generatedAt: NOW,
  };
}

describe("artefact 4a delta de grille", () => {
  it("chooses the nested object actually served, preserves the exact code, and emits the canonical B' join", async () => {
    const flat = `${PREFIX}qc-zonage-sutton.geojson`;
    const nested = `${PREFIX}qc-zonage-sutton/qc-zonage-sutton.geojson`;
    const rest = `${PREFIX}qc-zonage-outside.geojson`;
    const { store } = memoryStore({
      // Deliberately different: flat is not the source geo-api serves when nested exists.
      [flat]: fc([known({ densite_avant: 1, densite_apres: 3, effet_densifiant: "densifie" })]),
      [nested]: fc([known(), known()]), // multipolygon: exactly one delta record
      [rest]: fc([{ zone_code: "A-1", effet_densifiant: "inconnu" }]),
    });

    const artifact = await buildImmo4aArtifact(buildOptions(store));

    expect(artifact.coverage).toMatchObject({
      served_collections: 2,
      b_prime: { collections_known_effect: 1, features_known_effect: 2 },
      rest: { collections_unknown_only: 1, features_explicit_unknown: 1 },
      b_prime_export: { cities_emitted: 1, records_emitted: 1 },
    });
    expect(artifact.records).toHaveLength(1);
    expect(artifact.records[0]).toMatchObject({
      join_key: {
        city_slug: "sutton",
        zone_ref_canon_v1: "H-1",
        zone_ref_verbatim: "H-01",
        reglement_number: "358",
      },
      geo_zone_code: "H-01",
      densite_avant: 1,
      densite_apres: 1,
      geo_zone_usage_dominant: "residentiel",
      provenance: {
        projection_source: { selected_layout: "nested" },
        grid_delta_evidence: null,
      },
    });
    expect(artifact.source_collections[0]?.collection_s3_uri).toContain(nested);
  });

  it("refuses an observed effect that contradicts its two densities", async () => {
    const key = `${PREFIX}qc-zonage-sutton.geojson`;
    const { store } = memoryStore({
      [key]: fc([known({ effet_densifiant: "densifie", densite_avant: 3, densite_apres: 1 })]),
    });

    await expect(buildImmo4aArtifact(buildOptions(store))).rejects.toThrow(/contredit.*dérivé=reduit/);
  });

  it("omits a B' city that has only explicit unknowns and never invents a delta", async () => {
    const key = `${PREFIX}qc-zonage-void.geojson`;
    const { store } = memoryStore({
      [key]: fc([{ zone_code: "R-1", effet_densifiant: "inconnu", densite_avant: null, densite_apres: null }]),
    });

    const artifact = await buildImmo4aArtifact(buildOptions(store, ["void"]));

    expect(artifact.records).toEqual([]);
    expect(artifact.source_collections).toEqual([]);
    expect(artifact.coverage.b_prime).toMatchObject({
      collections_unknown_only: 1,
      features_explicit_unknown: 1,
    });
    expect(artifact.coverage.b_prime_export).toMatchObject({
      cities_with_known_effect: 0,
      cities_omitted_without_known_effect: 1,
    });
  });

  it("omits a known but unjoinable delta when the post regulation is absent", async () => {
    const key = `${PREFIX}qc-zonage-sutton.geojson`;
    const { store } = memoryStore({
      [key]: fc([known({ densite_apres_reglement: null })]),
    });

    const artifact = await buildImmo4aArtifact(buildOptions(store));

    expect(artifact.records).toEqual([]);
    expect(artifact.coverage.b_prime_export).toMatchObject({
      cities_with_known_effect: 1,
      cities_emitted: 0,
      known_effect_features_unjoinable: 1,
    });
  });

  it("omits Coaticook RD-104 when a zone code is carried as the post regulation", async () => {
    const key = `${PREFIX}qc-zonage-coaticook.geojson`;
    const { store } = memoryStore({
      [key]: fc([known({
        zone_code: "RD-104",
        densite_apres_reglement: "RD-104",
        densite_apres_millesime: "2026",
      })]),
    });

    const artifact = await buildImmo4aArtifact(buildOptions(store, ["coaticook"]));

    expect(artifact.records).toEqual([]);
    expect(artifact.coverage.b_prime_export).toMatchObject({
      known_effect_features_unjoinable: 1,
      cities_emitted: 0,
    });
  });

  it("dry-run writes nothing; a real publish writes only an immutable snapshot then latest", async () => {
    const key = `${PREFIX}qc-zonage-sutton.geojson`;
    const { store, puts, snapshotPuts } = memoryStore({ [key]: fc([known()]) });
    const options = { ...buildOptions(store), store, dryRun: true };

    const dry = await publishImmo4aArtifact(options);
    expect(puts).not.toHaveBeenCalled();
    expect(snapshotPuts).not.toHaveBeenCalled();
    expect(dry.snapshotKey).toMatch(new RegExp(`^${IMMO_4A_OUTPUT_PREFIX}snapshots/`));
    expect(dry.latestKey).toBe(`${IMMO_4A_OUTPUT_PREFIX}latest.json`);

    await publishImmo4aArtifact({ ...options, dryRun: false });
    expect(snapshotPuts).toHaveBeenCalledTimes(1);
    expect(snapshotPuts.mock.calls.map(([outputKey]) => outputKey)).toEqual([dry.snapshotKey]);
    expect(puts).toHaveBeenCalledTimes(1);
    expect(puts.mock.calls.map(([outputKey]) => outputKey)).toEqual([dry.latestKey]);
    await expect(publishImmo4aArtifact({ ...options, dryRun: false })).rejects.toThrow(/snapshot déjà présent/);
  });

  it("fails closed when duplicate polygons claim different values for the same join key", async () => {
    const key = `${PREFIX}qc-zonage-sutton.geojson`;
    const { store } = memoryStore({
      [key]: fc([
        known({ effet_densifiant: "densifie", densite_avant: 1, densite_apres: 2 }),
        known({ effet_densifiant: "densifie", densite_avant: 1, densite_apres: 3 }),
      ]),
    });

    await expect(buildImmo4aArtifact(buildOptions(store))).rejects.toThrow(/delta contradictoire/);
  });
});
