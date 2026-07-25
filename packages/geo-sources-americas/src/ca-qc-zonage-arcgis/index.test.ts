/**
 * Tests structurels du registre ArcGIS zonage QC.
 *
 * Ne touche PAS au réseau (ADR-0007) : valide uniquement les invariants des
 * endpoints vérifiés (produits hors-ligne par le harvester) et la conversion
 * en {@link SourceManifest}.
 */

import { describe, it, expect } from "vitest";
import { validateSourceManifest } from "@sentropic/geo-core";
import {
  QC_ZONAGE_ARCGIS_ENDPOINTS,
  QC_ZONAGE_ARCGIS_MANIFESTS,
  QC_ZONAGE_ARCGIS_COUNT,
  SUPPLEMENTAL_ZONAGE_ARCGIS_ENDPOINTS,
  buildQcZonageArcgisManifests,
} from "./index.js";

describe("QC_ZONAGE_ARCGIS_ENDPOINTS (registre vérifié live)", () => {
  it("expose un tableau non vide d'endpoints", () => {
    expect(Array.isArray(QC_ZONAGE_ARCGIS_ENDPOINTS)).toBe(true);
    expect(QC_ZONAGE_ARCGIS_ENDPOINTS.length).toBe(QC_ZONAGE_ARCGIS_COUNT);
    expect(QC_ZONAGE_ARCGIS_ENDPOINTS.length).toBeGreaterThan(0);
  });

  it("chaque endpoint a une URL https pointant vers une couche /Server/N", () => {
    for (const ep of QC_ZONAGE_ARCGIS_ENDPOINTS) {
      expect(ep.serviceUrl.startsWith("https://")).toBe(true);
      expect(ep.serviceUrl).toMatch(/\/(Feature|Map)Server\/\d+$/i);
    }
  });

  it("chaque endpoint a un verifiedAt ISO 8601 et une voie de découverte connue", () => {
    for (const ep of QC_ZONAGE_ARCGIS_ENDPOINTS) {
      expect(() => new Date(ep.verifiedAt).toISOString()).not.toThrow();
      expect(["agol-search", "mamh-domain-probe"]).toContain(ep.source);
    }
  });

  it("chaque endpoint a un citySlug non vide", () => {
    for (const ep of QC_ZONAGE_ARCGIS_ENDPOINTS) {
      expect(ep.citySlug.length).toBeGreaterThan(0);
    }
  });

  it("les serviceUrl sont uniques (dédup par couche)", () => {
    const urls = QC_ZONAGE_ARCGIS_ENDPOINTS.map((e) => e.serviceUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("buildQcZonageArcgisManifests", () => {
  const manifests = buildQcZonageArcgisManifests();

  it("produit un manifest par endpoint", () => {
    expect(manifests.length).toBe(QC_ZONAGE_ARCGIS_ENDPOINTS.length);
    expect(QC_ZONAGE_ARCGIS_MANIFESTS.length).toBe(
      manifests.length + SUPPLEMENTAL_ZONAGE_ARCGIS_ENDPOINTS.length,
    );
  });

  it("tous les manifests sont valides (validateSourceManifest)", () => {
    for (const m of QC_ZONAGE_ARCGIS_MANIFESTS) {
      const res = validateSourceManifest(m);
      expect(res.ok, JSON.stringify((res as { errors?: string[] }).errors)).toBe(true);
    }
  });

  it("les id de manifest sont uniques", () => {
    const ids = QC_ZONAGE_ARCGIS_MANIFESTS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chaque dataset est arcgis-rest avec layer numérique et CRS WGS84", () => {
    for (const m of QC_ZONAGE_ARCGIS_MANIFESTS) {
      expect(m.datasets.length).toBe(1);
      const ds = m.datasets[0]!;
      expect(ds.format).toBe("arcgis-rest");
      expect(typeof ds.layer).toBe("number");
      expect(ds.url).toMatch(/\/(Feature|Map)Server$/i);
      expect(ds.crs).toBe("EPSG:4326");
    }
  });

  it("jurisdiction CA-QC et licence unknown ou qualifiée explicitement", () => {
    for (const m of QC_ZONAGE_ARCGIS_MANIFESTS) {
      expect(m.jurisdiction.country).toBe("CA");
      expect(m.jurisdiction.subdivision).toBe("CA-QC");
      expect(["unknown", "cc-by-4.0"]).toContain(m.license);
    }
  });
});
