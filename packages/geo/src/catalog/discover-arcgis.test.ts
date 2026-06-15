/**
 * Tests hermétiques — discoverArcgisZonageServices (ADR-0007).
 *
 * Règles ADR-0007 :
 *   - Aucun réseau réel : fetchImpl et now sont systématiquement injectés.
 *   - Aucun effet de bord.
 *   - Résultat déterministe.
 *
 * Couverture :
 *   - Détection serveur municipal (domaine heuristique + sonde catalogue)
 *   - Filtre services zonage
 *   - Idempotence (skip villes déjà au registre)
 *   - Rapport de couverture
 *   - Timeout/erreur → not-found/error (pas de throw)
 *   - `force: true` → re-sonde les villes déjà au registre
 *   - Entrées produites conformes à GeoSourceInventory
 */

import { describe, expect, it } from "vitest";

import {
  discoverArcgisZonageServices,
  defaultMunicipalDomainGuesser,
  filterZonageServices,
  probeArcgisCatalog,
  resolveZonageLayer,
  ARCGIS_DISCOVERY_VERSION,
  type DiscoverArcgisOptions,
} from "./discover-arcgis.js";
import { isGeoSourceInventory } from "./source-inventory.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date("2026-06-15T10:00:00.000Z");
const FIXED_NOW_FN = () => FIXED_NOW;
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

/** Construit une Response JSON hermétique. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

/** Catalogue ArcGIS REST minimal avec un service de zonage. */
function arcgisCatalogResponse(serviceName = "Zonage_municipal"): Response {
  return jsonResponse({
    currentVersion: 10.8,
    services: [
      { name: serviceName, type: "FeatureServer" },
      { name: "Routes", type: "MapServer" },
    ],
  });
}

/** Réponse de métadonnées d'un service ArcGIS avec une couche polygone. */
function arcgisServiceResponse(layerName = "Zonage"): Response {
  return jsonResponse({
    currentVersion: 10.8,
    layers: [
      { id: 0, name: layerName, geometryType: "esriGeometryPolygon" },
    ],
  });
}

/** Réponse de métadonnées d'un service sans couches (mais avec geometryType Polygon). */
function arcgisDirectLayerResponse(): Response {
  return jsonResponse({
    currentVersion: 10.8,
    geometryType: "esriGeometryPolygon",
    fields: [],
  });
}

/** Mock fetch qui simule un serveur ArcGIS municipal pour une ville donnée. */
function makeMunicipalFetch(opts: {
  readonly domain: string;
  readonly catalogPath: string;
  readonly serviceName?: string;
  readonly layerName?: string;
}): typeof fetch {
  const { domain, catalogPath, serviceName = "Zonage_municipal", layerName = "Zonage" } = opts;
  const catalogBase = `${domain}${catalogPath}`;

  return async (input: string | URL | Request): Promise<Response> => {
    const url = input.toString();
    if (url.startsWith(`${catalogBase}?f=json`)) {
      return arcgisCatalogResponse(serviceName);
    }
    // Service metadata (URL reconstituée par probeArcgisCatalog)
    if (url.includes(`${serviceName}/FeatureServer?f=json`)) {
      return arcgisServiceResponse(layerName);
    }
    // 404 pour tout le reste
    return new Response("Not Found", { status: 404 });
  };
}

// ── Tests : defaultMunicipalDomainGuesser ──────────────────────────────────────

describe("defaultMunicipalDomainGuesser", () => {
  it("retourne 6 domaines candidats pour un slug", () => {
    const domains = defaultMunicipalDomainGuesser("longueuil");
    expect(domains).toHaveLength(6);
  });

  it("inclut les patterns courants QC", () => {
    const domains = defaultMunicipalDomainGuesser("brossard");
    expect(domains).toContain("https://sig.brossard.ca");
    expect(domains).toContain("https://cartes.brossard.ca");
    expect(domains).toContain("https://ville.brossard.qc.ca");
  });

  it("normalise le slug en minuscules", () => {
    const domains = defaultMunicipalDomainGuesser("Longueuil");
    for (const d of domains) {
      expect(d).toBe(d.toLowerCase());
    }
  });
});

// ── Tests : filterZonageServices ───────────────────────────────────────────────

describe("filterZonageServices", () => {
  it("retient les services contenant 'zonage' (insensible à la casse)", () => {
    const services = [
      { name: "Zonage_municipal", type: "FeatureServer", url: "http://ex.com/Zonage_municipal/FeatureServer" },
      { name: "Routes", type: "MapServer", url: "http://ex.com/Routes/MapServer" },
      { name: "Affectation_sol", type: "FeatureServer", url: "http://ex.com/Affectation_sol/FeatureServer" },
    ];
    const result = filterZonageServices(services);
    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name);
    expect(names).toContain("Zonage_municipal");
    expect(names).toContain("Affectation_sol");
  });

  it("retient les services 'zoning' (anglais)", () => {
    const services = [
      { name: "ZoningLayer", type: "FeatureServer", url: "http://ex.com/ZoningLayer/FeatureServer" },
    ];
    const result = filterZonageServices(services);
    expect(result).toHaveLength(1);
  });

  it("exclut les services sans rapport avec le zonage", () => {
    const services = [
      { name: "Cadastre", type: "MapServer", url: "http://ex.com/Cadastre/MapServer" },
      { name: "Routes", type: "MapServer", url: "http://ex.com/Routes/MapServer" },
    ];
    const result = filterZonageServices(services);
    expect(result).toHaveLength(0);
  });

  it("fonctionne sur un tableau vide", () => {
    expect(filterZonageServices([])).toHaveLength(0);
  });
});

// ── Tests : probeArcgisCatalog ─────────────────────────────────────────────────

describe("probeArcgisCatalog", () => {
  it("retourne les services d'un catalogue ArcGIS valide", async () => {
    const mockFetch = async (): Promise<Response> => arcgisCatalogResponse("Zonage_municipal");
    const result = await probeArcgisCatalog(
      "https://sig.brossard.ca/arcgis/rest/services",
      mockFetch as typeof fetch,
      5000,
    );
    expect(result).not.toBeNull();
    expect(result!.services.length).toBeGreaterThanOrEqual(1);
    expect(result!.services[0]?.name).toBe("Zonage_municipal");
  });

  it("retourne null pour une réponse HTTP non-OK", async () => {
    const mockFetch = async (): Promise<Response> => new Response("Not Found", { status: 404 });
    const result = await probeArcgisCatalog(
      "https://unreachable.ca/arcgis/rest/services",
      mockFetch as typeof fetch,
      5000,
    );
    expect(result).toBeNull();
  });

  it("retourne null quand le JSON n'a pas de champ 'services'", async () => {
    const mockFetch = async (): Promise<Response> => jsonResponse({ folders: [], error: "no services" });
    const result = await probeArcgisCatalog(
      "https://example.ca/arcgis/rest/services",
      mockFetch as typeof fetch,
      5000,
    );
    expect(result).toBeNull();
  });

  it("retourne null quand le fetch lève une erreur (timeout simulé)", async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error("AbortError: request timed out (mock)");
    };
    const result = await probeArcgisCatalog(
      "https://timeout.ca/arcgis/rest/services",
      mockFetch as typeof fetch,
      1,
    );
    expect(result).toBeNull();
  });

  it("retourne null pour du JSON invalide", async () => {
    const mockFetch = async (): Promise<Response> =>
      new Response("not json {{{", { status: 200 });
    const result = await probeArcgisCatalog(
      "https://badresponse.ca/arcgis/rest/services",
      mockFetch as typeof fetch,
      5000,
    );
    expect(result).toBeNull();
  });
});

// ── Tests : resolveZonageLayer ─────────────────────────────────────────────────

describe("resolveZonageLayer", () => {
  it("retourne l'URL de la couche zonage trouvée par nom", async () => {
    const mockFetch = async (): Promise<Response> => arcgisServiceResponse("Zonage");
    const result = await resolveZonageLayer(
      "https://sig.example.ca/arcgis/rest/services/Zonage_municipal/FeatureServer",
      mockFetch as typeof fetch,
      5000,
    );
    expect(result).toBe(
      "https://sig.example.ca/arcgis/rest/services/Zonage_municipal/FeatureServer/0",
    );
  });

  it("retourne l'URL quand le service est une couche directe (geometryType Polygon)", async () => {
    const mockFetch = async (): Promise<Response> => arcgisDirectLayerResponse();
    const result = await resolveZonageLayer(
      "https://sig.example.ca/arcgis/rest/services/Zonage/FeatureServer/0",
      mockFetch as typeof fetch,
      5000,
    );
    expect(result).toBe(
      "https://sig.example.ca/arcgis/rest/services/Zonage/FeatureServer/0",
    );
  });

  it("retourne null quand le fetch échoue", async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error("Network error (mock)");
    };
    const result = await resolveZonageLayer(
      "https://unreachable.ca/arcgis/rest/services/Zonage/FeatureServer",
      mockFetch as typeof fetch,
      5000,
    );
    expect(result).toBeNull();
  });

  it("retourne null quand le service n'a pas de couches", async () => {
    const mockFetch = async (): Promise<Response> =>
      jsonResponse({ currentVersion: 10.8, tables: [] });
    const result = await resolveZonageLayer(
      "https://sig.example.ca/arcgis/rest/services/Empty/FeatureServer",
      mockFetch as typeof fetch,
      5000,
    );
    expect(result).toBeNull();
  });
});

// ── Tests : discoverArcgisZonageServices ──────────────────────────────────────

describe("discoverArcgisZonageServices", () => {
  // Domaine guesser qui retourne uniquement l'URL de test connue
  function singleDomainGuesser(domain: string) {
    return (_slug: string): readonly string[] => [domain];
  }

  it("détecte un service ArcGIS municipal et produit un GeoSourceInventory", async () => {
    const domain = "https://sig.brossard.ca";
    const mockFetch = makeMunicipalFetch({
      domain,
      catalogPath: "/arcgis/rest/services",
      serviceName: "Zonage_municipal",
      layerName: "Zonage",
    });

    const opts: DiscoverArcgisOptions = {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      domainGuesser: singleDomainGuesser(domain),
    };

    const result = await discoverArcgisZonageServices(["brossard"], opts);

    expect(result.inventories).toHaveLength(1);
    const inv = result.inventories[0];
    expect(inv).toBeDefined();
    expect(inv!.citySlug).toBe("brossard");
    expect(inv!.platform).toBe("arcgis");
    expect(inv!.zonage.availability).toBe("arcgis");
    expect(inv!.zonage.quality).toBe("geojson");
    expect(inv!.zonage.url).toContain("Zonage_municipal");
    expect(inv!.lastChecked).toBe(FIXED_NOW_ISO);
  });

  it("produit un GeoSourceInventory valide (isGeoSourceInventory)", async () => {
    const domain = "https://cartes.longueuil.ca";
    const mockFetch = makeMunicipalFetch({
      domain,
      catalogPath: "/arcgis/rest/services",
      serviceName: "Zonage_municipal",
    });

    const result = await discoverArcgisZonageServices(["longueuil"], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      domainGuesser: singleDomainGuesser(domain),
    });

    for (const inv of result.inventories) {
      expect(isGeoSourceInventory(inv)).toBe(true);
    }
  });

  it("retourne inventories vide pour une ville sans service ArcGIS (not-found)", async () => {
    const mockFetch = async (): Promise<Response> =>
      new Response("Not Found", { status: 404 });

    const result = await discoverArcgisZonageServices(["ville-inconnue"], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
    });

    expect(result.inventories).toHaveLength(0);
    expect(result.coverage.notFound).toBe(1);
    expect(result.coverage.found).toBe(0);
  });

  it("comptabilise les erreurs réseau sans throw (robustesse)", async () => {
    // domainGuesser retourne un seul domaine, fetch lève une erreur
    const mockFetch = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED (mock)");
    };

    // probeArcgisCatalog capture l'erreur et retourne null → not-found
    // probeCity retourne not-found (pas error) dans ce cas
    const result = await discoverArcgisZonageServices(["erreur-ville"], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      domainGuesser: () => ["https://unreachable.ca"],
    });

    expect(result.inventories).toHaveLength(0);
    // L'erreur réseau dans probeArcgisCatalog est absorbée → not-found
    expect(result.coverage.notFound + result.coverage.errors).toBe(1);
  });

  it("est idempotent : skip les villes déjà dans le registre", async () => {
    const mockFetch = async (): Promise<Response> => arcgisCatalogResponse();

    const existingInventories = [
      {
        citySlug: "longueuil",
        platform: "arcgis" as const,
        zonage: { availability: "arcgis" as const, quality: "geojson" as const, url: "https://existing.url/0" },
        lots: { availability: "unknown" as const, quality: "none" as const },
        lastChecked: "2026-01-01T00:00:00.000Z",
      },
    ];

    const result = await discoverArcgisZonageServices(["longueuil", "brossard"], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      existingInventories,
      domainGuesser: () => [], // brossard n'a pas de domaine → not-found
    });

    expect(result.coverage.skipped).toBe(1);
    expect(result.coverage.totalCities).toBe(2);
    // longueuil skipée, brossard not-found (pas de domaine → aucune URL sondée)
    expect(result.coverage.notFound).toBe(1);
    // Aucune entrée produite (longueuil skipée, brossard not-found)
    expect(result.inventories).toHaveLength(0);
  });

  it("force=true re-sonde les villes déjà dans le registre", async () => {
    const domain = "https://sig.longueuil.ca";
    const mockFetch = makeMunicipalFetch({
      domain,
      catalogPath: "/arcgis/rest/services",
      serviceName: "Zonage_municipal",
    });

    const existingInventories = [
      {
        citySlug: "longueuil",
        platform: "arcgis" as const,
        zonage: { availability: "arcgis" as const, quality: "geojson" as const, url: "https://old.url/0" },
        lots: { availability: "unknown" as const, quality: "none" as const },
      },
    ];

    const result = await discoverArcgisZonageServices(["longueuil"], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      existingInventories,
      force: true,
      domainGuesser: singleDomainGuesser(domain),
    });

    // force=true → doit re-sonder → should find
    expect(result.coverage.skipped).toBe(0);
    expect(result.coverage.found).toBe(1);
    expect(result.inventories).toHaveLength(1);
  });

  it("produit le rapport de couverture correct pour plusieurs villes", async () => {
    const domain = "https://sig.testville.ca";
    const mockFetch = makeMunicipalFetch({
      domain,
      catalogPath: "/arcgis/rest/services",
      serviceName: "Zonage_municipal",
    });

    // ville-a → trouvée via domain
    // ville-b → pas de domaine → not-found
    const result = await discoverArcgisZonageServices(["ville-a", "ville-b", "ville-c"], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      existingInventories: [{ citySlug: "ville-c" }],
      domainGuesser: (slug) => slug === "ville-a" ? [domain] : [],
    });

    expect(result.coverage.totalCities).toBe(3);
    expect(result.coverage.found).toBe(1);
    expect(result.coverage.notFound).toBe(1);
    expect(result.coverage.skipped).toBe(1);
    expect(result.coverage.coverageRatio).toBeCloseTo(0.5); // 1/(1+1) = 0.5
    expect(result.coverage.generatedAt).toBe(FIXED_NOW_ISO);
    expect(result.inventories).toHaveLength(1);
  });

  it("retourne coverageRatio=0 pour une liste vide", async () => {
    const mockFetch = async (): Promise<Response> => new Response("", { status: 404 });
    const result = await discoverArcgisZonageServices([], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
    });
    expect(result.inventories).toHaveLength(0);
    expect(result.coverage.totalCities).toBe(0);
    expect(result.coverage.coverageRatio).toBe(0);
  });

  it("note les entrées avec la version du recenseur", async () => {
    const domain = "https://sig.note-test.ca";
    const mockFetch = makeMunicipalFetch({
      domain,
      catalogPath: "/arcgis/rest/services",
      serviceName: "Zonage_municipal",
    });

    const result = await discoverArcgisZonageServices(["note-test"], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      domainGuesser: singleDomainGuesser(domain),
    });

    expect(result.inventories[0]?.notes).toContain(ARCGIS_DISCOVERY_VERSION);
    expect(result.inventories[0]?.notes).toContain("arcgis-discovery");
  });

  it("filtre correctement : service non-zonage dans catalogue → not-found", async () => {
    const domain = "https://sig.test.ca";
    const mockFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = input.toString();
      if (url.includes("?f=json") && url.includes("/rest/services?")) {
        // Catalogue avec uniquement un service Routes (pas de zonage)
        return jsonResponse({
          services: [{ name: "Routes", type: "MapServer" }],
        });
      }
      return new Response("Not Found", { status: 404 });
    };

    const result = await discoverArcgisZonageServices(["test-city"], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      domainGuesser: singleDomainGuesser(domain),
    });

    expect(result.inventories).toHaveLength(0);
    expect(result.coverage.notFound).toBe(1);
  });
});
