/**
 * Hermetic tests for the CKAN open-data adapter (ADR-0007: no real network,
 * no wall-clock). `fetchImpl` and `now` are injected; every test asserts on a
 * fully deterministic, in-memory fake portal.
 */

import type { FeatureCollection, Geometry } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  acquireCkanGeoJson,
  resolveGeoResources,
  searchCkanPackages,
  type CkanPackage,
} from "./ckan.js";

// ── Shared fake data ──────────────────────────────────────────────────────────

const DONNEESQUEBEC_BASE = "https://www.donneesquebec.ca/recherche/api/3/action";
const FIXED_NOW = new Date("2026-06-14T12:00:00.000Z");
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
          coordinates: [[[-73.5, 45.5], [-73.4, 45.5], [-73.4, 45.6], [-73.5, 45.6], [-73.5, 45.5]]],
        },
        properties: { ZONE: "H-1", NOM: "Zone résidentielle" },
      },
    ],
  };
}

/** Build a JSON Response with status 200. */
function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/** A fake CKAN package_search result envelope. */
function packageSearchEnvelope(packages: unknown[]): unknown {
  return {
    success: true,
    result: {
      count: packages.length,
      results: packages,
    },
  };
}

/** A minimal raw CKAN package with one GeoJSON and one PDF resource. */
const RAW_LONGUEUIL_PACKAGE = {
  id: "zonage-ville-de-longueuil",
  name: "zonage-ville-de-longueuil",
  title: "Zonage — Ville de Longueuil",
  organization: { name: "ville-de-longueuil", title: "Ville de Longueuil" },
  resources: [
    {
      id: "res-001",
      name: "Zonage GeoJSON",
      format: "GeoJSON",
      url: "https://www.donneesquebec.ca/dl/longueuil-zonage.geojson",
      description: "Polygones de zonage WGS84",
    },
    {
      id: "res-002",
      name: "Règlement PDF",
      format: "PDF",
      url: "https://www.donneesquebec.ca/dl/longueuil-zonage.pdf",
    },
    {
      id: "res-003",
      name: "Zonage SHP",
      format: "SHP",
      url: "https://www.donneesquebec.ca/dl/longueuil-zonage.zip",
    },
    {
      id: "res-004",
      name: "Zonage GPKG",
      format: "GPKG",
      url: "https://www.donneesquebec.ca/dl/longueuil-zonage.gpkg",
    },
    {
      id: "res-005",
      name: "Zonage KML",
      format: "KML",
      url: "https://www.donneesquebec.ca/dl/longueuil-zonage.kml",
    },
    {
      id: "res-006",
      name: "Metadata HTML",
      format: "HTML",
      url: "https://www.donneesquebec.ca/dl/longueuil-zonage.html",
    },
  ],
};

// ── searchCkanPackages ────────────────────────────────────────────────────────

describe("searchCkanPackages — response parsing", () => {
  it("parses a package_search response into CkanPackage[]", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      expect(url).toContain("package_search");
      expect(url).toContain("q=zonage");
      return jsonResponse(packageSearchEnvelope([RAW_LONGUEUIL_PACKAGE]));
    };

    const pkgs = await searchCkanPackages(DONNEESQUEBEC_BASE, "zonage", {
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(pkgs).toHaveLength(1);
    const [pkg] = pkgs;
    expect(pkg).toBeDefined();
    if (!pkg) return;
    expect(pkg.id).toBe("zonage-ville-de-longueuil");
    expect(pkg.title).toBe("Zonage — Ville de Longueuil");
    expect(pkg.organization).toBe("Ville de Longueuil");
    expect(pkg.resources).toHaveLength(6);
  });

  it("honours rows and start options by forwarding them in the URL", async () => {
    let capturedUrl = "";
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      capturedUrl = String(input);
      return jsonResponse(packageSearchEnvelope([]));
    };

    await searchCkanPackages(DONNEESQUEBEC_BASE, "zonage", {
      fetchImpl: fetchImpl as typeof fetch,
      rows: 25,
      start: 10,
    });

    expect(capturedUrl).toContain("rows=25");
    expect(capturedUrl).toContain("start=10");
  });

  it("returns an empty array when result.results is missing", async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ success: true, result: {} });

    const pkgs = await searchCkanPackages(DONNEESQUEBEC_BASE, "zonage", {
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(pkgs).toEqual([]);
  });

  it("returns an empty array when the result count is zero", async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse(packageSearchEnvelope([]));

    const pkgs = await searchCkanPackages(DONNEESQUEBEC_BASE, "zonage", {
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(pkgs).toEqual([]);
  });

  it("throws on a non-OK HTTP response", async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response("Not Found", { status: 404, statusText: "Not Found" });

    await expect(
      searchCkanPackages(DONNEESQUEBEC_BASE, "zonage", {
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("handles a trailing slash on the base URL gracefully", async () => {
    let capturedUrl = "";
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      capturedUrl = String(input);
      return jsonResponse(packageSearchEnvelope([]));
    };

    await searchCkanPackages(`${DONNEESQUEBEC_BASE}/`, "zonage", {
      fetchImpl: fetchImpl as typeof fetch,
    });

    // Must not produce a double-slash.
    expect(capturedUrl).not.toContain("action//package");
    expect(capturedUrl).toContain("/package_search");
  });
});

// ── resolveGeoResources ───────────────────────────────────────────────────────

describe("resolveGeoResources — format filtering", () => {
  /** Build a CkanPackage from the raw Longueuil fixture. */
  function longueuil(): CkanPackage {
    return {
      id: RAW_LONGUEUIL_PACKAGE.id,
      title: RAW_LONGUEUIL_PACKAGE.title,
      organization: "Ville de Longueuil",
      resources: RAW_LONGUEUIL_PACKAGE.resources.map((r) => ({
        id: r.id,
        name: r.name,
        format: r.format,
        url: r.url,
        ...(r.description ? { description: r.description } : {}),
      })),
    };
  }

  it("retains GeoJSON, SHP, GPKG, KML resources and drops PDF and HTML", () => {
    const resolved = resolveGeoResources(longueuil());
    // GeoJSON, SHP, GPKG, KML = 4 resources; PDF + HTML dropped.
    expect(resolved).toHaveLength(4);
    const formats = resolved.map((r) => r.format);
    expect(formats).toContain("geojson");
    expect(formats).toContain("shp");
    expect(formats).toContain("gpkg");
    expect(formats).toContain("kml");
    expect(formats).not.toContain("other");
  });

  it("marks GeoJSON as needsGdal=false and all others as needsGdal=true", () => {
    const resolved = resolveGeoResources(longueuil());
    for (const r of resolved) {
      if (r.format === "geojson") {
        expect(r.needsGdal).toBe(false);
      } else {
        expect(r.needsGdal).toBe(true);
      }
    }
  });

  it("is case-insensitive on the format field", () => {
    const pkg: CkanPackage = {
      id: "test",
      title: "Test",
      resources: [
        { id: "r1", name: "Layer", format: "GEOJSON", url: "https://example.com/a.geojson" },
        { id: "r2", name: "Layer", format: "Shapefile", url: "https://example.com/b.zip" },
        { id: "r3", name: "Layer", format: "geopackage", url: "https://example.com/c.gpkg" },
      ],
    };
    const resolved = resolveGeoResources(pkg);
    expect(resolved).toHaveLength(3);
    expect(resolved[0]?.format).toBe("geojson");
    expect(resolved[1]?.format).toBe("shp");
    expect(resolved[2]?.format).toBe("gpkg");
  });

  it("returns an empty array for a package with no geographic resources", () => {
    const pkg: CkanPackage = {
      id: "docs-only",
      title: "Documents seulement",
      resources: [
        { id: "d1", name: "Rapport PDF", format: "PDF", url: "https://example.com/doc.pdf" },
        { id: "d2", name: "Notice HTML", format: "HTML", url: "https://example.com/notice.html" },
      ],
    };
    expect(resolveGeoResources(pkg)).toEqual([]);
  });

  it("populates packageId and resourceId from the package", () => {
    const pkg: CkanPackage = {
      id: "pkg-abc",
      title: "ABC",
      resources: [
        { id: "res-xyz", name: "Layer", format: "GeoJSON", url: "https://example.com/x.geojson" },
      ],
    };
    const [res] = resolveGeoResources(pkg);
    expect(res?.packageId).toBe("pkg-abc");
    expect(res?.resourceId).toBe("res-xyz");
  });
});

// ── acquireCkanGeoJson ────────────────────────────────────────────────────────

describe("acquireCkanGeoJson — happy path", () => {
  it("fetches, parses and returns the FeatureCollection with provenance", async () => {
    const fc = makeFeatureCollection();
    const resourceUrl = "https://www.donneesquebec.ca/dl/longueuil-zonage.geojson";

    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      expect(String(input)).toBe(resourceUrl);
      return jsonResponse(fc);
    };

    const result = await acquireCkanGeoJson(resourceUrl, {
      fetchImpl: fetchImpl as typeof fetch,
      now: FIXED_NOW_FN,
      packageId: "zonage-ville-de-longueuil",
    });

    expect(result.collection.type).toBe("FeatureCollection");
    expect(result.collection.features).toHaveLength(1);
    expect(result.provenance.source).toBe("zonage-ville-de-longueuil");
    expect(result.provenance.url).toBe(resourceUrl);
    expect(result.provenance.fetchedAt).toBe("2026-06-14T12:00:00.000Z");
  });

  it("uses the resource URL as source when packageId is not provided", async () => {
    const fc = makeFeatureCollection();
    const resourceUrl = "https://www.donneesquebec.ca/dl/sherbrooke-zonage.geojson";

    const fetchImpl = async (): Promise<Response> => jsonResponse(fc);

    const result = await acquireCkanGeoJson(resourceUrl, {
      fetchImpl: fetchImpl as typeof fetch,
      now: FIXED_NOW_FN,
    });

    expect(result.provenance.source).toBe(resourceUrl);
  });

  it("forwards extra headers to the fetch call", async () => {
    const fc = makeFeatureCollection();
    let capturedHeaders: Record<string, string> | undefined;

    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      capturedHeaders = init?.headers as Record<string, string> | undefined;
      return jsonResponse(fc);
    };

    await acquireCkanGeoJson("https://example.com/x.geojson", {
      fetchImpl: fetchImpl as typeof fetch,
      now: FIXED_NOW_FN,
      headers: { "User-Agent": "sentropic-geo/0.1" },
    });

    expect(capturedHeaders).toEqual({ "User-Agent": "sentropic-geo/0.1" });
  });
});

describe("acquireCkanGeoJson — error handling", () => {
  it("throws on a non-OK HTTP response (404)", async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response("Not Found", { status: 404, statusText: "Not Found" });

    await expect(
      acquireCkanGeoJson("https://example.com/missing.geojson", {
        fetchImpl: fetchImpl as typeof fetch,
        now: FIXED_NOW_FN,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("throws on a non-OK HTTP response (500)", async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" });

    await expect(
      acquireCkanGeoJson("https://example.com/data.geojson", {
        fetchImpl: fetchImpl as typeof fetch,
        now: FIXED_NOW_FN,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("throws when the body is not a GeoJSON FeatureCollection (plain object)", async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ type: "Feature", geometry: null, properties: {} });

    await expect(
      acquireCkanGeoJson("https://example.com/bad.geojson", {
        fetchImpl: fetchImpl as typeof fetch,
        now: FIXED_NOW_FN,
      }),
    ).rejects.toThrow(/FeatureCollection/);
  });

  it("throws when the body is not JSON at all", async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response("<html>not json</html>", { status: 200, statusText: "OK" });

    await expect(
      acquireCkanGeoJson("https://example.com/html.geojson", {
        fetchImpl: fetchImpl as typeof fetch,
        now: FIXED_NOW_FN,
      }),
    ).rejects.toThrow(/parse GeoJSON/);
  });

  it("throws when the body is null JSON", async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response("null", { status: 200, statusText: "OK" });

    await expect(
      acquireCkanGeoJson("https://example.com/null.geojson", {
        fetchImpl: fetchImpl as typeof fetch,
        now: FIXED_NOW_FN,
      }),
    ).rejects.toThrow(/FeatureCollection/);
  });

  it("returns an empty FeatureCollection when the GeoJSON has zero features", async () => {
    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    const fetchImpl = async (): Promise<Response> => jsonResponse(empty);

    const result = await acquireCkanGeoJson("https://example.com/empty.geojson", {
      fetchImpl: fetchImpl as typeof fetch,
      now: FIXED_NOW_FN,
    });

    expect(result.collection.features).toHaveLength(0);
    expect(result.provenance.fetchedAt).toBe("2026-06-14T12:00:00.000Z");
  });
});
