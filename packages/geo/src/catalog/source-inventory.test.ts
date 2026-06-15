/**
 * Tests hermétiques — GeoSourceInventory, recenseCkanZonage, recensePlatform.
 *
 * Règles ADR-0007 :
 *   - Aucun réseau réel : fetchImpl et now sont systématiquement injectés.
 *   - Aucun effet de bord.
 *   - Résultat déterministe.
 */

import { describe, expect, it } from "vitest";

import {
  isGeoSourceInventory,
  validateInventories,
  type GeoSourceInventory,
} from "./source-inventory.js";
import {
  recenseCkanZonage,
  type CityRef,
} from "./recense-ckan.js";
import { recensePlatform } from "./recense-platform.js";

// ── Helpers de test ───────────────────────────────────────────────────────────

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

/** Enveloppe CKAN package_search. */
function ckanSearchEnvelope(packages: unknown[]): unknown {
  return {
    success: true,
    result: { count: packages.length, results: packages },
  };
}

/** Paquet CKAN minimal avec une ressource GeoJSON. */
function makeCkanPackage(
  id: string,
  cityName: string,
  format = "GeoJSON",
  resourceUrl = `https://www.donneesquebec.ca/dl/${id}.geojson`,
) {
  return {
    id,
    name: id,
    title: `Zonage — ${cityName}`,
    organization: { name: cityName.toLowerCase(), title: cityName },
    resources: [
      {
        id: `${id}-res-001`,
        name: `Zonage ${cityName} GeoJSON`,
        format,
        url: resourceUrl,
      },
    ],
  };
}

// ── Tests : isGeoSourceInventory ──────────────────────────────────────────────

describe("isGeoSourceInventory", () => {
  it("valide une entrée bien formée", () => {
    const entry: GeoSourceInventory = {
      citySlug: "longueuil",
      zonage: { availability: "donnees-quebec", quality: "geojson", url: "https://example.com/z.geojson" },
      lots: { availability: "unknown", quality: "none" },
      platform: "ckan",
      lastChecked: "2026-06-15T10:00:00.000Z",
      notes: "test",
    };
    expect(isGeoSourceInventory(entry)).toBe(true);
  });

  it("valide une entrée sans champs optionnels", () => {
    const entry: GeoSourceInventory = {
      citySlug: "gatineau",
      zonage: { availability: "unknown", quality: "none" },
      lots: { availability: "unknown", quality: "none" },
      platform: "unknown",
    };
    expect(isGeoSourceInventory(entry)).toBe(true);
  });

  it("rejette un citySlug vide", () => {
    const bad = {
      citySlug: "",
      zonage: { availability: "unknown", quality: "none" },
      lots: { availability: "unknown", quality: "none" },
      platform: "unknown",
    };
    expect(isGeoSourceInventory(bad)).toBe(false);
  });

  it("rejette une availability invalide", () => {
    const bad = {
      citySlug: "test",
      zonage: { availability: "not-valid", quality: "none" },
      lots: { availability: "unknown", quality: "none" },
      platform: "ckan",
    };
    expect(isGeoSourceInventory(bad)).toBe(false);
  });

  it("rejette une platform invalide", () => {
    const bad = {
      citySlug: "test",
      zonage: { availability: "unknown", quality: "none" },
      lots: { availability: "unknown", quality: "none" },
      platform: "magic",
    };
    expect(isGeoSourceInventory(bad)).toBe(false);
  });

  it("rejette null et primitives", () => {
    expect(isGeoSourceInventory(null)).toBe(false);
    expect(isGeoSourceInventory(42)).toBe(false);
    expect(isGeoSourceInventory("string")).toBe(false);
    expect(isGeoSourceInventory(undefined)).toBe(false);
  });

  it("valide toutes les platforms possibles", () => {
    const platforms = ["arcgis", "ckan", "jmap", "gonet", "pdf", "unknown"] as const;
    for (const platform of platforms) {
      const entry = {
        citySlug: "test-city",
        zonage: { availability: "unknown", quality: "none" },
        lots: { availability: "unknown", quality: "none" },
        platform,
      };
      expect(isGeoSourceInventory(entry)).toBe(true);
    }
  });

  it("valide toutes les availabilities possibles", () => {
    const availabilities = [
      "donnees-quebec", "arcgis", "gonet", "jmap", "pdf", "none", "unknown",
    ] as const;
    for (const availability of availabilities) {
      const entry = {
        citySlug: "test-city",
        zonage: { availability, quality: "none" },
        lots: { availability: "unknown", quality: "none" },
        platform: "unknown",
      };
      expect(isGeoSourceInventory(entry)).toBe(true);
    }
  });
});

// ── Tests : validateInventories ───────────────────────────────────────────────

describe("validateInventories", () => {
  it("retourne toutes les entrées valides", () => {
    const entries: GeoSourceInventory[] = [
      {
        citySlug: "longueuil",
        zonage: { availability: "donnees-quebec", quality: "geojson" },
        lots: { availability: "unknown", quality: "none" },
        platform: "ckan",
      },
      {
        citySlug: "gatineau",
        zonage: { availability: "unknown", quality: "none" },
        lots: { availability: "unknown", quality: "none" },
        platform: "unknown",
      },
    ];
    const result = validateInventories(entries);
    expect(result.valid).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("isole les entrées invalides avec leur index", () => {
    const mixed = [
      {
        citySlug: "longueuil",
        zonage: { availability: "donnees-quebec", quality: "geojson" },
        lots: { availability: "unknown", quality: "none" },
        platform: "ckan",
      },
      { citySlug: "", zonage: {}, lots: {}, platform: "bad" }, // invalide
      {
        citySlug: "gatineau",
        zonage: { availability: "unknown", quality: "none" },
        lots: { availability: "unknown", quality: "none" },
        platform: "unknown",
      },
    ];
    const result = validateInventories(mixed);
    expect(result.valid).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(1);
  });
});

// ── Tests : recenseCkanZonage ─────────────────────────────────────────────────

describe("recenseCkanZonage", () => {
  const CKAN_BASE = "https://www.donneesquebec.ca/recherche/api/3/action";

  const CITIES: CityRef[] = [
    { slug: "longueuil", name: "Longueuil" },
    { slug: "gatineau", name: "Gatineau" },
  ];

  it("peuple l'inventaire pour une ville avec ressource GeoJSON", async () => {
    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes("package_search")) {
        const pkg = makeCkanPackage("zonage-longueuil", "Longueuil");
        return jsonResponse(ckanSearchEnvelope([pkg]));
      }
      return jsonResponse(ckanSearchEnvelope([]));
    };

    const result = await recenseCkanZonage(
      [{ slug: "longueuil", name: "Longueuil" }],
      { fetchImpl: mockFetch as typeof fetch, now: FIXED_NOW_FN, ckanBaseUrl: CKAN_BASE },
    );

    expect(result.inventories).toHaveLength(1);
    const inv = result.inventories[0];
    expect(inv).toBeDefined();
    expect(inv!.citySlug).toBe("longueuil");
    expect(inv!.platform).toBe("ckan");
    expect(inv!.zonage.availability).toBe("donnees-quebec");
    expect(inv!.zonage.quality).toBe("geojson");
    expect(inv!.zonage.url).toBe("https://www.donneesquebec.ca/dl/zonage-longueuil.geojson");
    expect(inv!.lastChecked).toBe(FIXED_NOW_ISO);
  });

  it("marque 'unknown' quand aucune ressource CKAN n'est trouvée", async () => {
    const mockFetch = async (): Promise<Response> => {
      return jsonResponse(ckanSearchEnvelope([]));
    };

    const result = await recenseCkanZonage(
      [{ slug: "saint-damase", name: "Saint-Damase" }],
      { fetchImpl: mockFetch as typeof fetch, now: FIXED_NOW_FN, ckanBaseUrl: CKAN_BASE },
    );

    expect(result.inventories).toHaveLength(1);
    const inv = result.inventories[0];
    expect(inv!.zonage.availability).toBe("unknown");
    expect(inv!.zonage.quality).toBe("none");
    expect(inv!.platform).toBe("ckan");
    expect(inv!.lastChecked).toBe(FIXED_NOW_ISO);
  });

  it("produit le rapport de couverture correct pour 2 villes (1 avec CKAN, 1 sans)", async () => {
    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes("Longueuil")) {
        const pkg = makeCkanPackage("zonage-longueuil", "Longueuil");
        return jsonResponse(ckanSearchEnvelope([pkg]));
      }
      // Gatineau : aucune ressource
      return jsonResponse(ckanSearchEnvelope([]));
    };

    const result = await recenseCkanZonage(CITIES, {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      ckanBaseUrl: CKAN_BASE,
    });

    expect(result.coverage.total).toBe(2);
    expect(result.coverage.withCkan).toBe(1);
    expect(result.coverage.withoutCkan).toBe(1);
    expect(result.coverage.coverageRatio).toBeCloseTo(0.5);
    expect(result.coverage.coveredSlugs).toContain("longueuil");
    expect(result.coverage.uncoveredSlugs).toContain("gatineau");
  });

  it("est idempotent : deux appels successifs donnent le même résultat", async () => {
    const mockFetch = async (): Promise<Response> => {
      const pkg = makeCkanPackage("zonage-longueuil", "Longueuil");
      return jsonResponse(ckanSearchEnvelope([pkg]));
    };

    const opts = {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
      ckanBaseUrl: CKAN_BASE,
    };

    const r1 = await recenseCkanZonage([{ slug: "longueuil", name: "Longueuil" }], opts);
    const r2 = await recenseCkanZonage([{ slug: "longueuil", name: "Longueuil" }], opts);

    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("gère une erreur réseau sans throw (classé unknown)", async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error("Network error (mock)");
    };

    const result = await recenseCkanZonage(
      [{ slug: "trois-rivieres", name: "Trois-Rivières" }],
      { fetchImpl: mockFetch as typeof fetch, now: FIXED_NOW_FN, ckanBaseUrl: CKAN_BASE },
    );

    expect(result.inventories).toHaveLength(1);
    const inv = result.inventories[0];
    expect(inv!.zonage.availability).toBe("unknown");
    expect(result.coverage.withoutCkan).toBe(1);
  });

  it("gère une liste vide sans erreur", async () => {
    const mockFetch = async (): Promise<Response> => jsonResponse(ckanSearchEnvelope([]));
    const result = await recenseCkanZonage([], {
      fetchImpl: mockFetch as typeof fetch,
      now: FIXED_NOW_FN,
    });
    expect(result.inventories).toHaveLength(0);
    expect(result.coverage.total).toBe(0);
    expect(result.coverage.coverageRatio).toBe(0);
  });

  it("peuple correctement les entrées résultantes comme GeoSourceInventory valides", async () => {
    const mockFetch = async (): Promise<Response> => {
      const pkg = makeCkanPackage("zonage-longueuil", "Longueuil");
      return jsonResponse(ckanSearchEnvelope([pkg]));
    };

    const result = await recenseCkanZonage(
      [{ slug: "longueuil", name: "Longueuil" }],
      { fetchImpl: mockFetch as typeof fetch, now: FIXED_NOW_FN, ckanBaseUrl: CKAN_BASE },
    );

    for (const inv of result.inventories) {
      expect(isGeoSourceInventory(inv)).toBe(true);
    }
  });

  it("gère les ressources SHP (quality='pdf' par défaut pour non-GeoJSON)", async () => {
    const mockFetch = async (): Promise<Response> => {
      const pkg = makeCkanPackage(
        "zonage-sherbrooke",
        "Sherbrooke",
        "SHP",
        "https://www.donneesquebec.ca/dl/zonage-sherbrooke.shp",
      );
      return jsonResponse(ckanSearchEnvelope([pkg]));
    };

    const result = await recenseCkanZonage(
      [{ slug: "sherbrooke", name: "Sherbrooke" }],
      { fetchImpl: mockFetch as typeof fetch, now: FIXED_NOW_FN, ckanBaseUrl: CKAN_BASE },
    );

    const inv = result.inventories[0];
    expect(inv!.zonage.availability).toBe("donnees-quebec");
    // SHP = nécessite GDAL, quality abaissée
    expect(inv!.zonage.quality).toBe("pdf");
    expect(inv!.zonage.url).toBe("https://www.donneesquebec.ca/dl/zonage-sherbrooke.shp");
  });
});

// ── Tests : recensePlatform ───────────────────────────────────────────────────

describe("recensePlatform", () => {
  it("détecte ArcGIS depuis l'URL avant tout fetch (pre-fetch)", async () => {
    // fetchImpl ne devrait même pas être appelé (URL pre-match)
    const mockFetch = async (): Promise<Response> => {
      throw new Error("Should not be called");
    };

    const result = await recensePlatform(
      "montreal",
      "https://geoindex.ville.montreal.qc.ca/arcgis/rest/services/Zonage/MapServer",
      { fetchImpl: mockFetch as typeof fetch },
    );

    expect(result.platform).toBe("arcgis");
    expect(result.evidence).toContain("[url-pre-fetch]");
    expect(result.success).toBe(true);
  });

  it("détecte JMap depuis l'URL", async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error("Should not be called");
    };

    const result = await recensePlatform(
      "levis",
      "https://geospatial.ville.levis.qc.ca/jmap/services",
      { fetchImpl: mockFetch as typeof fetch },
    );

    expect(result.platform).toBe("jmap");
    expect(result.success).toBe(true);
  });

  it("détecte GoNet depuis l'URL", async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error("Should not be called");
    };

    const result = await recensePlatform(
      "test-city",
      "https://portail.municipalite.qc.ca/goazimut/services",
      { fetchImpl: mockFetch as typeof fetch },
    );

    expect(result.platform).toBe("gonet");
    expect(result.success).toBe(true);
  });

  it("détecte CKAN depuis l'URL", async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error("Should not be called");
    };

    const result = await recensePlatform(
      "test-city",
      "https://www.donneesquebec.ca/recherche/api/3/action/package_search?q=zonage",
      { fetchImpl: mockFetch as typeof fetch },
    );

    expect(result.platform).toBe("ckan");
    expect(result.success).toBe(true);
  });

  it("détecte PDF via Content-Type après HEAD fetch", async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response(null, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    };

    const result = await recensePlatform(
      "valleyfield",
      "https://ville.valleyfield.qc.ca/urbanisme/zonage.pdf",
      { fetchImpl: mockFetch as typeof fetch },
    );

    expect(result.platform).toBe("pdf");
    expect(result.success).toBe(true);
  });

  it("détecte ArcGIS depuis le body JSON (après HEAD sans info suffisante)", async () => {
    let callCount = 0;
    const mockFetch = async (): Promise<Response> => {
      callCount++;
      // Premier appel (HEAD) : pas de body
      if (callCount === 1) {
        return new Response(null, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      // Deuxième appel (GET) : body ArcGIS
      return new Response(
        JSON.stringify({ currentVersion: 10.8, serviceDescription: "ArcGIS MapServer" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await recensePlatform(
      "brossard",
      "https://sig.brossard.ca/server/rest/services",
      { fetchImpl: mockFetch as typeof fetch },
    );

    expect(result.platform).toBe("arcgis");
    expect(result.evidence).toContain("[body]");
    expect(result.success).toBe(true);
  });

  it("retourne 'unknown' quand aucun pattern ne matche", async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response("<html><body>Site municipal</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };

    const result = await recensePlatform(
      "inconnue",
      "https://www.ville-inconnue.qc.ca/",
      { fetchImpl: mockFetch as typeof fetch },
    );

    expect(result.platform).toBe("unknown");
    expect(result.success).toBe(true);
  });

  it("retourne success=false en cas d'erreur réseau irrémédiable", async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED (mock)");
    };

    const result = await recensePlatform(
      "erreur",
      "https://unreachable.ville.qc.ca/",
      { fetchImpl: mockFetch as typeof fetch },
    );

    expect(result.platform).toBe("unknown");
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("ECONNREFUSED");
  });

  it("retourne les champs citySlug et siteUrl corrects", async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error("Should not be called");
    };

    const result = await recensePlatform(
      "longueuil",
      "https://sig.longueuil.quebec/arcgis/rest/services",
      { fetchImpl: mockFetch as typeof fetch },
    );

    expect(result.citySlug).toBe("longueuil");
    expect(result.siteUrl).toBe("https://sig.longueuil.quebec/arcgis/rest/services");
  });
});
