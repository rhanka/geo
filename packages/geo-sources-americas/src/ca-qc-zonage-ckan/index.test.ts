/**
 * Hermetic tests for the QC municipal zonage CKAN source manifests
 * (ADR-0007: no real network, ADR-0017: manifest/recipe pattern).
 *
 * Coverage:
 *  1. Each manifest validates as a SourceManifest (validateSourceManifest).
 *  2. Each manifest carries `cc-by-4.0` licence, `kind: "administrative"`, CA-QC jurisdiction.
 *  3. Each manifest's source id matches the `ca-qc/zonage-<ville>` convention.
 *  4. Each manifest's dataset id matches the `qc-zonage-<ville>` convention.
 *  5. All source ids and dataset ids are globally unique.
 *  6. `QC_ZONAGE_CKAN_MANIFESTS` contains all expected manifests plus supplemental manifests.
 *  7. CKAN acquisition flow (mocked): resolveGeoResources + acquireCkanGeoJson
 *     work end-to-end for a representative manifest (Longueuil).
 */

import type { FeatureCollection, Geometry } from "@sentropic/geo-core";
import { validateSourceManifest } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import { resolveGeoResources, acquireCkanGeoJson } from "@sentropic/geo/acquire";

import {
  QC_ZONAGE_CKAN_MANIFESTS,
  LONGUEUIL_ZONAGE_MANIFEST,
  GATINEAU_ZONAGE_MANIFEST,
  SAGUENAY_ZONAGE_MANIFEST,
  LEVIS_ZONAGE_MANIFEST,
  TROIS_RIVIERES_ZONAGE_MANIFEST,
  SHERBROOKE_ZONAGE_MANIFEST,
  QUEBEC_ZONAGE_MANIFEST,
  REPENTIGNY_ZONAGE_MANIFEST,
  RIMOUSKI_ZONAGE_MANIFEST,
  ROUYN_NORANDA_ZONAGE_MANIFEST,
  SHAWINIGAN_ZONAGE_MANIFEST,
  MONTREAL_LIMITES_HAUTEUR_MANIFEST,
  MONTREAL_PPU_MANIFEST,
  MONTREAL_PUM_2050_MANIFEST,
  SAINT_HYACINTHE_AFFECTATIONS_MANIFEST,
  SAINT_HYACINTHE_ZONAGE_MANIFEST,
  LONGUEUIL_CKAN_PACKAGE_ID,
  GATINEAU_CKAN_PACKAGE_ID,
  SAGUENAY_CKAN_PACKAGE_ID,
  LEVIS_CKAN_PACKAGE_ID,
  TROIS_RIVIERES_CKAN_PACKAGE_ID,
  SHERBROOKE_CKAN_PACKAGE_ID,
  QUEBEC_CKAN_PACKAGE_ID,
  REPENTIGNY_CKAN_PACKAGE_ID,
  RIMOUSKI_CKAN_PACKAGE_ID,
  ROUYN_NORANDA_CKAN_PACKAGE_ID,
  SHAWINIGAN_CKAN_PACKAGE_ID,
  MONTREAL_LIMITES_HAUTEUR_CKAN_PACKAGE_ID,
  MONTREAL_PPU_CKAN_PACKAGE_ID,
  MONTREAL_PUM_2050_CKAN_PACKAGE_ID,
  SAINT_HYACINTHE_AFFECTATIONS_CKAN_PACKAGE_ID,
  SAINT_HYACINTHE_CKAN_PACKAGE_ID,
  DATASET_LONGUEUIL_ZONAGE,
  DATASET_GATINEAU_ZONAGE,
  DATASET_SAGUENAY_ZONAGE,
  DATASET_LEVIS_ZONAGE,
  DATASET_TROIS_RIVIERES_ZONAGE,
  DATASET_SHERBROOKE_ZONAGE,
  DATASET_QUEBEC_ZONAGE,
  DATASET_REPENTIGNY_ZONAGE,
  DATASET_RIMOUSKI_ZONAGE,
  DATASET_ROUYN_NORANDA_ZONAGE,
  DATASET_SHAWINIGAN_ZONAGE,
  DATASET_MONTREAL_LIMITES_HAUTEUR,
  DATASET_MONTREAL_PPU,
  DATASET_MONTREAL_PUM_2050_INTENSIFICATION_AFFECTATION,
  SUPPLEMENTAL_ZONAGE_CKAN_MANIFESTS,
  DATASET_SAINT_HYACINTHE_AFFECTATIONS,
  DATASET_SAINT_HYACINTHE_ZONAGE,
} from "./index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date("2026-06-15T10:00:00.000Z");
const FIXED_NOW_FN = () => FIXED_NOW;

/** Minimal GeoJSON FeatureCollection with one polygon feature. */
function makeFeatureCollection(): FeatureCollection<Geometry | null> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-73.5, 45.5],
              [-73.4, 45.5],
              [-73.4, 45.6],
              [-73.5, 45.6],
              [-73.5, 45.5],
            ],
          ],
        },
        properties: { ZONE: "H-1", NOM: "Zone résidentielle" },
      },
    ],
  };
}

/** Build a JSON Response with status 200. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "application/json" },
  });
}

// ── All manifests as a table ───────────────────────────────────────────────

/** All manifests with their expected ids for parametric tests. */
const ALL_MANIFESTS = [
  {
    manifest: LONGUEUIL_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-longueuil",
    datasetId: DATASET_LONGUEUIL_ZONAGE,
    packageId: LONGUEUIL_CKAN_PACKAGE_ID,
    city: "Longueuil",
  },
  {
    manifest: GATINEAU_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-gatineau",
    datasetId: DATASET_GATINEAU_ZONAGE,
    packageId: GATINEAU_CKAN_PACKAGE_ID,
    city: "Gatineau",
  },
  {
    manifest: SAGUENAY_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-saguenay",
    datasetId: DATASET_SAGUENAY_ZONAGE,
    packageId: SAGUENAY_CKAN_PACKAGE_ID,
    city: "Saguenay",
  },
  {
    manifest: LEVIS_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-levis",
    datasetId: DATASET_LEVIS_ZONAGE,
    packageId: LEVIS_CKAN_PACKAGE_ID,
    city: "Lévis",
  },
  {
    manifest: TROIS_RIVIERES_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-trois-rivieres",
    datasetId: DATASET_TROIS_RIVIERES_ZONAGE,
    packageId: TROIS_RIVIERES_CKAN_PACKAGE_ID,
    city: "Trois-Rivières",
  },
  {
    manifest: SHERBROOKE_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-sherbrooke",
    datasetId: DATASET_SHERBROOKE_ZONAGE,
    packageId: SHERBROOKE_CKAN_PACKAGE_ID,
    city: "Sherbrooke",
  },

  {
    manifest: MONTREAL_LIMITES_HAUTEUR_MANIFEST,
    sourceId: "ca-qc/zonage-montreal-limites-hauteur",
    datasetId: DATASET_MONTREAL_LIMITES_HAUTEUR,
    packageId: MONTREAL_LIMITES_HAUTEUR_CKAN_PACKAGE_ID,
    city: "Montréal limites de hauteur",
  },
  {
    manifest: MONTREAL_PPU_MANIFEST,
    sourceId: "ca-qc/zonage-montreal-ppu",
    datasetId: DATASET_MONTREAL_PPU,
    packageId: MONTREAL_PPU_CKAN_PACKAGE_ID,
    city: "Montréal PPU",
  },
  {
    manifest: MONTREAL_PUM_2050_MANIFEST,
    sourceId: "ca-qc/zonage-montreal-pum-2050",
    datasetId: DATASET_MONTREAL_PUM_2050_INTENSIFICATION_AFFECTATION,
    packageId: MONTREAL_PUM_2050_CKAN_PACKAGE_ID,
    city: "Montréal PUM 2050",
  },
  {
    manifest: QUEBEC_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-quebec",
    datasetId: DATASET_QUEBEC_ZONAGE,
    packageId: QUEBEC_CKAN_PACKAGE_ID,
    city: "Québec",
  },
  {
    manifest: REPENTIGNY_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-repentigny",
    datasetId: DATASET_REPENTIGNY_ZONAGE,
    packageId: REPENTIGNY_CKAN_PACKAGE_ID,
    city: "Repentigny",
  },
  {
    manifest: RIMOUSKI_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-rimouski",
    datasetId: DATASET_RIMOUSKI_ZONAGE,
    packageId: RIMOUSKI_CKAN_PACKAGE_ID,
    city: "Rimouski",
  },
  {
    manifest: ROUYN_NORANDA_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-rouyn-noranda",
    datasetId: DATASET_ROUYN_NORANDA_ZONAGE,
    packageId: ROUYN_NORANDA_CKAN_PACKAGE_ID,
    city: "Rouyn-Noranda",
  },

  {
    manifest: SAINT_HYACINTHE_AFFECTATIONS_MANIFEST,
    sourceId: "ca-qc/zonage-saint-hyacinthe-affectations",
    datasetId: DATASET_SAINT_HYACINTHE_AFFECTATIONS,
    packageId: SAINT_HYACINTHE_AFFECTATIONS_CKAN_PACKAGE_ID,
    city: "Saint-Hyacinthe affectations",
  },
  {
    manifest: SAINT_HYACINTHE_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-saint-hyacinthe",
    datasetId: DATASET_SAINT_HYACINTHE_ZONAGE,
    packageId: SAINT_HYACINTHE_CKAN_PACKAGE_ID,
    city: "Saint-Hyacinthe",
  },
  {
    manifest: SHAWINIGAN_ZONAGE_MANIFEST,
    sourceId: "ca-qc/zonage-shawinigan",
    datasetId: DATASET_SHAWINIGAN_ZONAGE,
    packageId: SHAWINIGAN_CKAN_PACKAGE_ID,
    city: "Shawinigan",
  },
] as const;

// ── 1. validateSourceManifest ─────────────────────────────────────────────────

describe("QC zonage CKAN manifests — validateSourceManifest", () => {
  for (const { manifest, city } of ALL_MANIFESTS) {
    it(`${city}: is a valid SourceManifest`, () => {
      const result = validateSourceManifest(manifest);
      expect(
        result.ok,
        `${city} manifest validation failed: ${JSON.stringify((result as { errors?: string[] }).errors)}`,
      ).toBe(true);
    });
  }
});

// ── 2. Licence, kind, jurisdiction ───────────────────────────────────────────

describe("QC zonage CKAN manifests — licence, kind, jurisdiction", () => {
  for (const { manifest, city } of ALL_MANIFESTS) {
    it(`${city}: licence=cc-by-4.0, kind=administrative, jurisdiction=CA/CA-QC`, () => {
      expect(manifest.license).toBe("cc-by-4.0");
      expect(manifest.kind).toBe("administrative");
      expect(manifest.jurisdiction.country).toBe("CA");
      expect(manifest.jurisdiction.subdivision).toBe("CA-QC");
    });
  }
});

// ── 3. Source id convention ───────────────────────────────────────────────────

describe("QC zonage CKAN manifests — source id convention", () => {
  for (const { manifest, sourceId, city } of ALL_MANIFESTS) {
    it(`${city}: source id is "${sourceId}"`, () => {
      expect(manifest.id).toBe(sourceId);
    });
  }
});

// ── 4. Dataset id convention ──────────────────────────────────────────────────

describe("QC zonage CKAN manifests — dataset id convention", () => {
  for (const { manifest, datasetId, city } of ALL_MANIFESTS) {
    it(`${city}: dataset id is "${datasetId}"`, () => {
      expect(manifest.datasets).toHaveLength(1);
      expect(manifest.datasets[0]?.id).toBe(datasetId);
    });
  }
});

// ── 5. Global uniqueness ──────────────────────────────────────────────────────

describe("QC zonage CKAN manifests — uniqueness", () => {
  it("all source ids are unique", () => {
    const sourceIds = ALL_MANIFESTS.map(({ manifest }) => manifest.id);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });

  it("all dataset ids are unique", () => {
    const datasetIds = ALL_MANIFESTS.flatMap(({ manifest }) =>
      manifest.datasets.map((ds) => ds.id),
    );
    expect(new Set(datasetIds).size).toBe(datasetIds.length);
  });

  it("all CKAN package ids are unique", () => {
    const packageIds = ALL_MANIFESTS.map(({ packageId }) => packageId);
    expect(new Set(packageIds).size).toBe(packageIds.length);
  });
});

// ── 6. QC_ZONAGE_CKAN_MANIFESTS aggregate ────────────────────────────────────

describe("QC_ZONAGE_CKAN_MANIFESTS", () => {
  it("contains all expected manifests plus supplemental manifests", () => {
    expect(QC_ZONAGE_CKAN_MANIFESTS).toHaveLength(ALL_MANIFESTS.length + SUPPLEMENTAL_ZONAGE_CKAN_MANIFESTS.length);
  });

  it("all manifests in the aggregate array are valid SourceManifests", () => {
    for (const manifest of QC_ZONAGE_CKAN_MANIFESTS) {
      const result = validateSourceManifest(manifest);
      expect(
        result.ok,
        `manifest ${manifest.id} failed validation: ${JSON.stringify((result as { errors?: string[] }).errors)}`,
      ).toBe(true);
    }
  });

  it("all manifests in the aggregate have cc-by-4.0 licence", () => {
    for (const manifest of QC_ZONAGE_CKAN_MANIFESTS) {
      expect(manifest.license).toBe("cc-by-4.0");
    }
  });

  it("all source ids in aggregate are unique and follow ca-qc/zonage-<ville> pattern", () => {
    const ids = QC_ZONAGE_CKAN_MANIFESTS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^ca-qc\/zonage-[a-z0-9-]+$/);
    }
  });

  it("all dataset ids in aggregate are unique and follow qc-zonage-<ville> pattern", () => {
    const datasetIds = QC_ZONAGE_CKAN_MANIFESTS.flatMap((m) =>
      m.datasets.map((ds) => ds.id),
    );
    expect(new Set(datasetIds).size).toBe(datasetIds.length);
    for (const id of datasetIds) {
      expect(id).toMatch(/^qc-zonage-[a-z0-9-]+$/);
    }
  });

  it("contains all expected manifests (by source id)", () => {
    const ids = new Set(QC_ZONAGE_CKAN_MANIFESTS.map((m) => m.id));
    const expected = ALL_MANIFESTS.map(({ sourceId }) => sourceId);
    for (const sourceId of expected) {
      expect(ids.has(sourceId), `${sourceId} missing from QC_ZONAGE_CKAN_MANIFESTS`).toBe(true);
    }
  });
});

// ── 7. CKAN acquisition flow (mocked) ────────────────────────────────────────

describe("CKAN acquisition flow (mocked, ADR-0007)", () => {
  /**
   * Simulates the full acquisition flow for Longueuil:
   * 1. resolveGeoResources on a mock package_show result
   * 2. acquireCkanGeoJson on the resolved resource URL
   */
  it("Longueuil: resolveGeoResources → GeoJSON resource → acquireCkanGeoJson", async () => {
    const fc = makeFeatureCollection();

    // Simulate a package_show response for the Longueuil package.
    // The manifest's dataset[0].url is the confirmed GeoJSON resource URL.
    const longueuil_dataset = LONGUEUIL_ZONAGE_MANIFEST.datasets[0];
    if (!longueuil_dataset) throw new Error("Longueuil manifest has no dataset");

    const mockPackage = {
      id: LONGUEUIL_CKAN_PACKAGE_ID,
      title: "Zonage — Ville de Longueuil",
      organization: "Ville de Longueuil",
      resources: [
        {
          id: "fafe8962-b38d-4a98-ad93-25ac8950b8c8",
          name: "Zonage",
          format: "GeoJSON",
          url: longueuil_dataset.url,
        },
        {
          id: "ba97d3d4-1d11-419a-a361-56cf3b88b3ca",
          name: "Zonage",
          format: "KMZ",
          url: "https://example.com/zonage.kmz",
        },
        {
          id: "5bffde75-9e94-4282-8158-ec2dce8fefa6",
          name: "Zonage",
          format: "SHP",
          url: "https://example.com/zonage.zip",
        },
      ],
    };

    // Step 1: resolveGeoResources (pure, no network).
    const geoResources = resolveGeoResources(mockPackage);
    // GeoJSON + SHP = 2 resources (KMZ is not a recognised format → "other", dropped).
    expect(geoResources.length).toBeGreaterThanOrEqual(1);
    const geojsonResource = geoResources.find((r) => r.format === "geojson");
    expect(geojsonResource).toBeDefined();
    expect(geojsonResource?.needsGdal).toBe(false);
    expect(geojsonResource?.url).toBe(longueuil_dataset.url);

    // Step 2: acquireCkanGeoJson (mocked fetch).
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      expect(String(input)).toBe(longueuil_dataset.url);
      return jsonResponse(fc);
    };

    const result = await acquireCkanGeoJson(longueuil_dataset.url, {
      fetchImpl: fetchImpl as typeof fetch,
      now: FIXED_NOW_FN,
      packageId: LONGUEUIL_CKAN_PACKAGE_ID,
    });

    expect(result.collection.type).toBe("FeatureCollection");
    expect(result.collection.features).toHaveLength(1);
    expect(result.provenance.source).toBe(LONGUEUIL_CKAN_PACKAGE_ID);
    expect(result.provenance.url).toBe(longueuil_dataset.url);
    expect(result.provenance.fetchedAt).toBe("2026-06-15T10:00:00.000Z");
  });

  it("Shawinigan (ArcGIS FeatureServer query): acquireCkanGeoJson handles ?f=geojson URL", async () => {
    const fc = makeFeatureCollection();
    const shawinigan_dataset = SHAWINIGAN_ZONAGE_MANIFEST.datasets[0];
    if (!shawinigan_dataset) throw new Error("Shawinigan manifest has no dataset");

    // The URL contains query params — acquireCkanGeoJson must pass it verbatim.
    expect(shawinigan_dataset.url).toContain("FeatureServer");
    expect(shawinigan_dataset.url).toContain("f=geojson");

    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      expect(String(input)).toBe(shawinigan_dataset.url);
      return jsonResponse(fc);
    };

    const result = await acquireCkanGeoJson(shawinigan_dataset.url, {
      fetchImpl: fetchImpl as typeof fetch,
      now: FIXED_NOW_FN,
      packageId: SHAWINIGAN_CKAN_PACKAGE_ID,
    });

    expect(result.collection.type).toBe("FeatureCollection");
    expect(result.collection.features).toHaveLength(1);
    expect(result.provenance.source).toBe(SHAWINIGAN_CKAN_PACKAGE_ID);
  });

  it("Sherbrooke (ArcGIS Hub GeoJSON download): acquireCkanGeoJson handles opendata.arcgis.com URL", async () => {
    const fc = makeFeatureCollection();
    const sherbrooke_dataset = SHERBROOKE_ZONAGE_MANIFEST.datasets[0];
    if (!sherbrooke_dataset) throw new Error("Sherbrooke manifest has no dataset");

    // The URL is on opendata.arcgis.com — acquireCkanGeoJson handles it as plain HTTPS.
    expect(sherbrooke_dataset.url).toContain("arcgis.com");

    const fetchImpl = async (): Promise<Response> => jsonResponse(fc);

    const result = await acquireCkanGeoJson(sherbrooke_dataset.url, {
      fetchImpl: fetchImpl as typeof fetch,
      now: FIXED_NOW_FN,
      packageId: SHERBROOKE_CKAN_PACKAGE_ID,
    });

    expect(result.collection.type).toBe("FeatureCollection");
    expect(result.provenance.source).toBe(SHERBROOKE_CKAN_PACKAGE_ID);
  });
});

// ── 8. Dataset format and CRS ─────────────────────────────────────────────────

describe("QC zonage CKAN manifests — dataset format and CRS", () => {
  for (const { manifest, city } of ALL_MANIFESTS) {
    it(`${city}: dataset format is geojson and crs is EPSG:4326`, () => {
      const ds = manifest.datasets[0];
      expect(ds?.format).toBe("geojson");
      expect(ds?.crs).toBe("EPSG:4326");
    });
  }
});

// ── 9. Homepage URLs ──────────────────────────────────────────────────────────

describe("QC zonage CKAN manifests — homepage URLs", () => {
  for (const { manifest, packageId, city } of ALL_MANIFESTS) {
    it(`${city}: homepage contains the CKAN package id`, () => {
      expect(manifest.homepage).toBeDefined();
      expect(manifest.homepage).toContain(packageId);
      expect(manifest.homepage).toContain("donneesquebec.ca");
    });
  }
});
