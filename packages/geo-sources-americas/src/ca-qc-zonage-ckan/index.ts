/**
 * CKAN zonage source declarations for Québec municipalities on Données Québec.
 *
 * Each municipality publishes its zonage layer as a CKAN *package*. The
 * acquisition flow (ADR-0017):
 *
 *   1. Pin the `packageId` (CKAN slug confirmed via `package_show`, 2026-06-15).
 *   2. {@link resolveGeoResources} → filter for GeoJSON resource at runtime.
 *   3. {@link acquireCkanGeoJson} → download and parse into a WGS84 FeatureCollection.
 *
 * ## Design principle — packageId, not resource URL
 * Each manifest stores the *packageId* in a stable constant and pins the
 * GeoJSON resource URL confirmed at cadrage time. The packageId is the durable
 * key; the resource URL may drift between portal re-publications, so callers
 * should re-resolve via `package_show?id=<packageId>` if the pinned URL 404s.
 *
 * ## Edge-cases (documented)
 * - **Sherbrooke**: GeoJSON resource is served via `opendata.arcgis.com` (ArcGIS
 *   Hub download endpoint), not the Données Québec CDN. `acquireCkanGeoJson`
 *   handles it transparently — it is a plain HTTPS GeoJSON download.
 * - **Shawinigan**: The single CKAN resource is an ArcGIS FeatureServer `/query`
 *   endpoint that returns GeoJSON directly (`?f=geojson`). The URL is long but
 *   the response is a valid FeatureCollection; `acquireCkanGeoJson` handles it.
 *   If the FeatureServer moves or the result is paginated, route through
 *   `crawlArcgisLayer` instead (set `format: "arcgis-rest"` and provide `layer`).
 *
 * ## Confirmed municipalities (package_show verified 2026-06-15)
 * Longueuil, Gatineau, Saguenay, Lévis, Trois-Rivières, Sherbrooke, Québec,
 * Repentigny, Rimouski, Rouyn-Noranda, Shawinigan.
 * All datasets carry `licence_id: "cc-by"` (resolved to `cc-by-4.0` here).
 */

import type { SourceManifest } from "@sentropic/geo-core";

// ── Shared constants ──────────────────────────────────────────────────────────

/** Données Québec CKAN action API base URL (stable, documented). */
export const DONNEESQUEBEC_CKAN_BASE =
  "https://www.donneesquebec.ca/recherche/api/3/action";

// ── Longueuil ─────────────────────────────────────────────────────────────────

/** CKAN package id for the Longueuil municipal zonage (confirmed 2026-06-15). */
export const LONGUEUIL_CKAN_PACKAGE_ID = "zonage";

/** Dataset id for the Longueuil zonage (OGC collection id, ADR-0005). */
export const DATASET_LONGUEUIL_ZONAGE = "qc-zonage-longueuil";

/** Source manifest for the **Longueuil municipal zonage** via CKAN Données Québec. */
export const LONGUEUIL_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-longueuil",
  title: "Zonage — Ville de Longueuil (CKAN Données Québec)",
  description:
    "Polygones des zones de zonage municipal de la Ville de Longueuil, " +
    "publiés en open data sur le portail Données Québec. " +
    "Acquisition via acquireCkanGeoJson (adapter CKAN générique, ADR-0017).",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Longueuil",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${LONGUEUIL_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_LONGUEUIL_ZONAGE,
      title: "Zones de zonage — Longueuil (GeoJSON WGS84)",
      description:
        "Polygones de zonage en GeoJSON WGS84. " +
        "Ressource GeoJSON confirmée via package_show (2026-06-15).",
      format: "geojson",
      url: "https://www.donneesquebec.ca/recherche/dataset/aedd53ac-131d-4141-93c4-8d4211eb2d95/resource/fafe8962-b38d-4a98-ad93-25ac8950b8c8/download/zonage.json",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Gatineau ──────────────────────────────────────────────────────────────────

/** CKAN package id for the Gatineau municipal zonage (confirmed 2026-06-15). */
export const GATINEAU_CKAN_PACKAGE_ID = "vgat-zonage-norme-v1";

/** Dataset id for the Gatineau zonage (OGC collection id). */
export const DATASET_GATINEAU_ZONAGE = "qc-zonage-gatineau";

/** Source manifest for the **Gatineau municipal zonage** via CKAN Données Québec. */
export const GATINEAU_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-gatineau",
  title: "Zonage normé v1 — Ville de Gatineau (CKAN Données Québec)",
  description:
    "Polygones des zones de zonage normé municipal de la Ville de Gatineau, " +
    "publiés en open data sur le portail Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Gatineau",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${GATINEAU_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_GATINEAU_ZONAGE,
      title: "Zones de zonage normé v1 — Gatineau (GeoJSON WGS84)",
      description:
        "Polygones de zonage normé en GeoJSON WGS84. " +
        "Ressource GeoJSON confirmée via package_show (2026-06-15).",
      format: "geojson",
      url: "https://www.donneesquebec.ca/recherche/dataset/5f03d188-27ca-47a2-a871-8df97bed75cd/resource/e96f48a7-b0c8-42ce-afa8-06475b38b3af/download/zonage-norme.json",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Saguenay ──────────────────────────────────────────────────────────────────

/** CKAN package id for the Saguenay municipal zonage (confirmed 2026-06-15). */
export const SAGUENAY_CKAN_PACKAGE_ID = "sag_zonage";

/** Dataset id for the Saguenay zonage (OGC collection id). */
export const DATASET_SAGUENAY_ZONAGE = "qc-zonage-saguenay";

/** Source manifest for the **Saguenay municipal zonage** via CKAN Données Québec. */
export const SAGUENAY_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-saguenay",
  title: "Zonage — Ville de Saguenay (CKAN Données Québec)",
  description:
    "Polygones des zones de zonage municipal de la Ville de Saguenay, " +
    "publiés en open data sur le portail Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Saguenay",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${SAGUENAY_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_SAGUENAY_ZONAGE,
      title: "Zones de zonage — Saguenay (GeoJSON WGS84)",
      description:
        "Polygones de zonage en GeoJSON WGS84. " +
        "Ressource GeoJSON confirmée via package_show (2026-06-15).",
      format: "geojson",
      url: "https://www.donneesquebec.ca/recherche/dataset/a086941f-22e3-4fe7-a8dc-fe791229d942/resource/6d5e4aa8-1b9f-4deb-8815-4803ce63007f/download/sag_zonage.geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Lévis ─────────────────────────────────────────────────────────────────────

/** CKAN package id for the Lévis municipal zonage (confirmed 2026-06-15). */
export const LEVIS_CKAN_PACKAGE_ID = "zonage-levis";

/** Dataset id for the Lévis zonage (OGC collection id). */
export const DATASET_LEVIS_ZONAGE = "qc-zonage-levis";

/** Source manifest for the **Lévis municipal zonage** via CKAN Données Québec. */
export const LEVIS_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-levis",
  title: "Zonage — Ville de Lévis (CKAN Données Québec)",
  description:
    "Polygones des zones de zonage municipal de la Ville de Lévis, " +
    "publiés en open data sur le portail Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Lévis",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${LEVIS_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_LEVIS_ZONAGE,
      title: "Zones de zonage — Lévis (GeoJSON WGS84)",
      description:
        "Polygones de zonage en GeoJSON WGS84. " +
        "Ressource GeoJSON confirmée via package_show (2026-06-15).",
      format: "geojson",
      url: "https://www.donneesquebec.ca/recherche/dataset/6cd041e3-902c-469e-a863-e54f4df966f2/resource/7b5a1166-1a41-4d6d-9286-de5d4caa07c5/download/zonage.json",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Trois-Rivières ────────────────────────────────────────────────────────────

/** CKAN package id for the Trois-Rivières municipal zonage (confirmed 2026-06-15). */
export const TROIS_RIVIERES_CKAN_PACKAGE_ID = "zonage-v3r";

/** Dataset id for the Trois-Rivières zonage (OGC collection id). */
export const DATASET_TROIS_RIVIERES_ZONAGE = "qc-zonage-trois-rivieres";

/** Source manifest for the **Trois-Rivières municipal zonage** via CKAN Données Québec. */
export const TROIS_RIVIERES_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-trois-rivieres",
  title: "Zonage — Ville de Trois-Rivières (CKAN Données Québec)",
  description:
    "Polygones des zones de zonage municipal de la Ville de Trois-Rivières, " +
    "publiés en open data sur le portail Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Trois-Rivières",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${TROIS_RIVIERES_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_TROIS_RIVIERES_ZONAGE,
      title: "Zones de zonage — Trois-Rivières (GeoJSON WGS84)",
      description:
        "Polygones de zonage en GeoJSON WGS84. " +
        "Ressource GeoJSON confirmée via package_show (2026-06-15).",
      format: "geojson",
      url: "https://www.donneesquebec.ca/recherche/dataset/85fa8f51-28f6-4163-9d96-eab0b185ec10/resource/6073d899-4ff3-488a-a4bf-10334638c4ae/download/zonage-v3r.json",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Sherbrooke ────────────────────────────────────────────────────────────────

/**
 * CKAN package id for the Sherbrooke municipal zonage (confirmed 2026-06-15).
 *
 * Edge-case: The GeoJSON resource URL is served by `opendata.arcgis.com`
 * (ArcGIS Hub download endpoint), not the Données Québec CDN. This is a
 * standard HTTPS GeoJSON download; `acquireCkanGeoJson` handles it transparently.
 */
export const SHERBROOKE_CKAN_PACKAGE_ID = "ae984df25d12471f9f3de4b84b3e2a53_0";

/** Dataset id for the Sherbrooke zonage (OGC collection id). */
export const DATASET_SHERBROOKE_ZONAGE = "qc-zonage-sherbrooke";

/** Source manifest for the **Sherbrooke municipal zonage** via CKAN Données Québec. */
export const SHERBROOKE_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-sherbrooke",
  title: "Zonage — Ville de Sherbrooke (CKAN Données Québec / ArcGIS Hub)",
  description:
    "Polygones des zones de zonage municipal de la Ville de Sherbrooke, " +
    "publiés via ArcGIS Hub (opendata.arcgis.com) et référencés sur Données Québec. " +
    "Ressource GeoJSON téléchargeable directement (pas de pagination ArcGIS REST requise).",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Sherbrooke — Données géomatiques",
    url: "https://donneesouvertes-sherbrooke.opendata.arcgis.com",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${SHERBROOKE_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_SHERBROOKE_ZONAGE,
      title: "Zones de zonage — Sherbrooke (GeoJSON via ArcGIS Hub)",
      description:
        "Polygones de zonage en GeoJSON via ArcGIS Hub download endpoint. " +
        "URL confirmée via package_show (2026-06-15). " +
        "Si cette URL cesse de fonctionner, utiliser la ressource EsriREST: " +
        "https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/Zonage/FeatureServer/0",
      format: "geojson",
      url: "https://donneesouvertes-sherbrooke.opendata.arcgis.com/api/download/v1/items/ae984df25d12471f9f3de4b84b3e2a53/geojson?layers=0",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Québec (ville) ────────────────────────────────────────────────────────────

/** CKAN package id for the Ville de Québec municipal zonage (confirmed 2026-06-15). */
export const QUEBEC_CKAN_PACKAGE_ID = "vque_56";

/** Dataset id for the Ville de Québec zonage (OGC collection id). */
export const DATASET_QUEBEC_ZONAGE = "qc-zonage-quebec";

/** Source manifest for the **Ville de Québec municipal zonage** via CKAN Données Québec. */
export const QUEBEC_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-quebec",
  title: "Zonage municipal — Zones — Ville de Québec (CKAN Données Québec)",
  description:
    "Polygones des zones de zonage municipal de la Ville de Québec, " +
    "publiés en open data sur le portail Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Québec",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${QUEBEC_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_QUEBEC_ZONAGE,
      title: "Zones de zonage — Québec (GeoJSON WGS84)",
      description:
        "Polygones de zonage en GeoJSON WGS84. " +
        "Ressource GeoJSON confirmée via package_show (2026-06-15).",
      format: "geojson",
      url: "https://www.donneesquebec.ca/recherche/dataset/a56dfef1-ad07-4b21-9ef7-24a0c553a085/resource/8108e324-503f-4a10-9107-ea556fdc883d/download/vdq-zonagemunicipalzones.geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Repentigny ────────────────────────────────────────────────────────────────

/** CKAN package id for the Repentigny municipal zonage (confirmed 2026-06-15). */
export const REPENTIGNY_CKAN_PACKAGE_ID = "zonagemunicipal";

/** Dataset id for the Repentigny zonage (OGC collection id). */
export const DATASET_REPENTIGNY_ZONAGE = "qc-zonage-repentigny";

/** Source manifest for the **Repentigny municipal zonage** via CKAN Données Québec. */
export const REPENTIGNY_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-repentigny",
  title: "Zonage municipal — Ville de Repentigny (CKAN Données Québec)",
  description:
    "Polygones des zones de zonage municipal de la Ville de Repentigny, " +
    "publiés en open data sur le portail Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Repentigny",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${REPENTIGNY_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_REPENTIGNY_ZONAGE,
      title: "Zones de zonage municipal — Repentigny (GeoJSON WGS84)",
      description:
        "Polygones de zonage en GeoJSON WGS84. " +
        "Ressource GeoJSON confirmée via package_show (2026-06-15).",
      format: "geojson",
      url: "https://www.donneesquebec.ca/recherche/dataset/d8dffd21-359d-43dd-af8f-32d44a274cfe/resource/74ee6756-9d5d-4c9e-9b0d-8d694aeb1a7d/download/zonage_municipal.geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Rimouski ──────────────────────────────────────────────────────────────────

/** CKAN package id for the Rimouski municipal zonage (confirmed 2026-06-15). */
export const RIMOUSKI_CKAN_PACKAGE_ID = "plan-de-zonage";

/** Dataset id for the Rimouski zonage (OGC collection id). */
export const DATASET_RIMOUSKI_ZONAGE = "qc-zonage-rimouski";

/** Source manifest for the **Rimouski municipal zonage** via CKAN Données Québec. */
export const RIMOUSKI_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-rimouski",
  title: "Plan de zonage — Ville de Rimouski (CKAN Données Québec)",
  description:
    "Polygones du plan de zonage municipal de la Ville de Rimouski, " +
    "publiés en open data sur le portail Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Rimouski",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${RIMOUSKI_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_RIMOUSKI_ZONAGE,
      title: "Plan de zonage — Rimouski (GeoJSON WGS84)",
      description:
        "Polygones de zonage en GeoJSON WGS84. " +
        "Ressource GeoJSON confirmée via package_show (2026-06-15).",
      format: "geojson",
      url: "https://www.donneesquebec.ca/recherche/dataset/d1935001-9c0c-432a-ab5e-f519384feb24/resource/a1a8d4f1-2610-4f83-ae47-86f876f32d97/download/planzonage.json",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Rouyn-Noranda ─────────────────────────────────────────────────────────────

/** CKAN package id for the Rouyn-Noranda municipal zonage (confirmed 2026-06-15). */
export const ROUYN_NORANDA_CKAN_PACKAGE_ID = "4a69c2484a2540de9f9eb58b908d4d0f_0";

/** Dataset id for the Rouyn-Noranda zonage (OGC collection id). */
export const DATASET_ROUYN_NORANDA_ZONAGE = "qc-zonage-rouyn-noranda";

/** Source manifest for the **Rouyn-Noranda municipal zonage** via CKAN Données Québec. */
export const ROUYN_NORANDA_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-rouyn-noranda",
  title: "Plan de zonage — Ville de Rouyn-Noranda (CKAN Données Québec / ArcGIS Hub)",
  description:
    "Polygones du plan de zonage municipal de la Ville de Rouyn-Noranda, " +
    "publiés via ArcGIS Hub et référencés sur Données Québec. " +
    "Ressource GeoJSON téléchargeable directement sur le CDN Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Rouyn-Noranda",
    url: "https://donnees-ouvertes-vrn.opendata.arcgis.com",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${ROUYN_NORANDA_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_ROUYN_NORANDA_ZONAGE,
      title: "Plan de zonage — Rouyn-Noranda (GeoJSON WGS84)",
      description:
        "Polygones de zonage en GeoJSON WGS84. " +
        "Ressource GeoJSON confirmée via package_show (2026-06-15). " +
        "Également disponible via ArcGIS REST: " +
        "https://carte.rouyn-noranda.ca/arcgis/rest/services/Donnees_ouvertes/Donnees_ouvertes/MapServer/5",
      format: "geojson",
      url: "https://www.donneesquebec.ca/recherche/dataset/81cfd131-73ec-43ad-9d6b-72f127c45f51/resource/cc9a0110-6ce5-4b00-ace9-603dda3c2acc/download/plan_zonage.geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};



// ── Montréal ─────────────────────────────────────────────────────────────────

/** CKAN package id for Montréal plan d'urbanisme height limits (confirmed 2026-06-18). */
export const MONTREAL_LIMITES_HAUTEUR_CKAN_PACKAGE_ID = "vmtl-plan-urbanisme-limites-hauteur";

/** CKAN package id for Montréal programmes particuliers d'urbanisme (confirmed 2026-06-18). */
export const MONTREAL_PPU_CKAN_PACKAGE_ID = "vmtl-plan-urbanisme-ppu";

/** CKAN package id for Montréal PUM 2050 intensification/affectation zones (confirmed 2026-06-18). */
export const MONTREAL_PUM_2050_CKAN_PACKAGE_ID =
  "vmtl-niveaux-intensification-urbaine-densite-affectation-sol-pum-2050";

/** Dataset id for Montréal plan d'urbanisme height limits. */
export const DATASET_MONTREAL_LIMITES_HAUTEUR = "qc-zonage-montreal-limites-hauteur";

/** Dataset id for Montréal programmes particuliers d'urbanisme. */
export const DATASET_MONTREAL_PPU = "qc-zonage-montreal-ppu";

/** Dataset id for Montréal PUM 2050 intensification/affectation zones. */
export const DATASET_MONTREAL_PUM_2050_INTENSIFICATION_AFFECTATION =
  "qc-zonage-montreal-pum-2050-intensification-affectation";

/** Source manifest for Montréal plan d'urbanisme height limits via CKAN Données Québec / Données Montréal. */
export const MONTREAL_LIMITES_HAUTEUR_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-montreal-limites-hauteur",
  title: "Plan d'urbanisme - Limites de hauteur — Ville de Montréal",
  description:
    "Polygones des limites de hauteur au plan d'urbanisme de Montréal, " +
    "référencés sur Données Québec et publiés par Données Montréal.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Montréal",
    url: "https://donnees.montreal.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${MONTREAL_LIMITES_HAUTEUR_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_MONTREAL_LIMITES_HAUTEUR,
      title: "Plan d'urbanisme - Limites de hauteur — Montréal (GeoJSON WGS84)",
      description: "Polygones des limites de hauteur au plan d'urbanisme. Ressource confirmée via package_search Données Québec (2026-06-18).",
      format: "geojson",
      url: "https://donnees.montreal.ca/dataset/9f49de77-c50d-43af-bc64-c28c3bd6d021/resource/79c4a316-d6b7-4fca-a3d4-f999b83647b1/download/plan-urbanisme-limites-hauteurs.geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

/** Source manifest for Montréal programmes particuliers d'urbanisme via CKAN Données Québec / Données Montréal. */
export const MONTREAL_PPU_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-montreal-ppu",
  title: "Plan d'urbanisme - Programmes particuliers d'urbanisme — Ville de Montréal",
  description:
    "Polygones des programmes particuliers d'urbanisme de Montréal, " +
    "référencés sur Données Québec et publiés par Données Montréal.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Montréal",
    url: "https://donnees.montreal.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${MONTREAL_PPU_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_MONTREAL_PPU,
      title: "Plan d'urbanisme - PPU — Montréal (GeoJSON WGS84)",
      description: "Polygones des programmes particuliers d'urbanisme. Ressource confirmée via package_search Données Québec (2026-06-18).",
      format: "geojson",
      url: "https://donnees.montreal.ca/dataset/9c5bf3bf-75f4-4e25-aa35-3993a916aec9/resource/7daf3ea2-ee0b-4acd-ac4c-cc3e59b0fb7d/download/ppu.geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

/** Source manifest for Montréal PUM 2050 intensification/affectation zones via CKAN Données Québec / Données Montréal. */
export const MONTREAL_PUM_2050_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-montreal-pum-2050",
  title: "PUM 2050 - Intensification, densité et affectation du sol — Ville de Montréal",
  description:
    "Polygones des niveaux d'intensification urbaine, seuils minimaux moyens de densité nette " +
    "et affectation du sol du Plan d'urbanisme et de mobilité 2050 de Montréal.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Montréal",
    url: "https://donnees.montreal.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${MONTREAL_PUM_2050_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_MONTREAL_PUM_2050_INTENSIFICATION_AFFECTATION,
      title: "PUM 2050 - Intensification, densité et affectation du sol — Montréal (GeoJSON WGS84)",
      description: "Polygones PUM 2050 d'intensification, densité et affectation du sol. Ressource confirmée via package_search Données Québec (2026-06-18).",
      format: "geojson",
      url: "https://donnees.montreal.ca/fr/dataset/f420857a-709d-450a-a422-61c3f5079a5e/resource/aa336ce2-2380-4006-bc8b-ef8eea39c8ff/download/intens_affect.geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Saint-Hyacinthe ───────────────────────────────────────────────────────────

/** CKAN package id for the Saint-Hyacinthe municipal zonage (confirmed 2026-06-18). */
export const SAINT_HYACINTHE_CKAN_PACKAGE_ID = "4b810a13d5d34c1ea2672ba37acc72dc";

/** CKAN package id for the Saint-Hyacinthe zoning affectations (confirmed 2026-06-18). */
export const SAINT_HYACINTHE_AFFECTATIONS_CKAN_PACKAGE_ID = "8512559138ba4ca3b894f42f7265d72d";

/** Dataset id for the Saint-Hyacinthe zonage (OGC collection id). */
export const DATASET_SAINT_HYACINTHE_ZONAGE = "qc-zonage-saint-hyacinthe";

/** Dataset id for the Saint-Hyacinthe zoning affectations (OGC collection id). */
export const DATASET_SAINT_HYACINTHE_AFFECTATIONS = "qc-zonage-saint-hyacinthe-affectations";

/** Source manifest for the **Saint-Hyacinthe municipal zonage** via CKAN Données Québec. */
export const SAINT_HYACINTHE_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-saint-hyacinthe",
  title: "Zonage — Ville de Saint-Hyacinthe (CKAN Données Québec / ArcGIS FeatureServer)",
  description:
    "Polygones du zonage municipal de la Ville de Saint-Hyacinthe, " +
    "publiés via un ArcGIS FeatureServer query endpoint référencé sur Données Québec. " +
    "La ressource retourne du GeoJSON directement via le paramètre ?f=geojson.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Saint-Hyacinthe",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${SAINT_HYACINTHE_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_SAINT_HYACINTHE_ZONAGE,
      title: "Zonage — Saint-Hyacinthe (GeoJSON via ArcGIS FeatureServer query)",
      description:
        "Polygones de zonage via ArcGIS FeatureServer /query?f=geojson. " +
        "Ressource confirmée via package_search Données Québec (2026-06-18).",
      format: "geojson",
      url: "https://arcgis.st-hyacinthe.ca/server/rest/services/ISOGEO_SigimProd_Features/FeatureServer/13/query?where=1=1&outFields=*&returnGeometry=true&f=geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

/** Source manifest for the **Saint-Hyacinthe zoning affectations** via CKAN Données Québec. */
export const SAINT_HYACINTHE_AFFECTATIONS_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-saint-hyacinthe-affectations",
  title: "Grandes affectations du zonage — Ville de Saint-Hyacinthe (CKAN Données Québec)",
  description:
    "Polygones des grandes affectations du zonage de la Ville de Saint-Hyacinthe, " +
    "publiés via un ArcGIS FeatureServer query endpoint référencé sur Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Saint-Hyacinthe",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${SAINT_HYACINTHE_AFFECTATIONS_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_SAINT_HYACINTHE_AFFECTATIONS,
      title: "Grandes affectations du zonage — Saint-Hyacinthe (GeoJSON via ArcGIS FeatureServer query)",
      description:
        "Polygones d'affectation via ArcGIS FeatureServer /query?f=geojson. " +
        "Ressource confirmée via package_search Données Québec (2026-06-18).",
      format: "geojson",
      url: "https://arcgis.st-hyacinthe.ca/server/rest/services/ISOGEO_SigimProd_Features/FeatureServer/15/query?where=1=1&outFields=*&returnGeometry=true&f=geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Shawinigan ────────────────────────────────────────────────────────────────

/**
 * CKAN package id for the Shawinigan municipal zonage (confirmed 2026-06-15).
 *
 * Edge-case: The single CKAN resource URL is an ArcGIS FeatureServer `/query`
 * endpoint that returns GeoJSON directly (`?f=geojson&where=1=1&outFields=*&returnGeometry=true`).
 * `acquireCkanGeoJson` handles it as a plain GeoJSON download.
 *
 * If the FeatureServer is paginated or unavailable, migrate to `format: "arcgis-rest"`
 * with `layer: 0` and route through `crawlArcgisLayer`.
 * FeatureServer base: `https://cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer`
 */
export const SHAWINIGAN_CKAN_PACKAGE_ID = "shawi-plan-de-zonage";

/** Dataset id for the Shawinigan zonage (OGC collection id). */
export const DATASET_SHAWINIGAN_ZONAGE = "qc-zonage-shawinigan";

/** Source manifest for the **Shawinigan municipal zonage** via CKAN Données Québec. */
export const SHAWINIGAN_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/zonage-shawinigan",
  title: "Plan de zonage — Ville de Shawinigan (CKAN Données Québec / ArcGIS FeatureServer)",
  description:
    "Polygones du plan de zonage municipal de la Ville de Shawinigan, " +
    "publiés via un ArcGIS FeatureServer query endpoint référencé sur Données Québec. " +
    "La ressource retourne du GeoJSON directement via le paramètre ?f=geojson. " +
    "Si la réponse est paginée ou le service indisponible, migrer vers format arcgis-rest + crawlArcgisLayer.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Shawinigan",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${SHAWINIGAN_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_SHAWINIGAN_ZONAGE,
      title: "Zonage municipal — Shawinigan (GeoJSON via ArcGIS FeatureServer query)",
      description:
        "Polygones de zonage via ArcGIS FeatureServer /query?f=geojson. " +
        "Ressource confirmée via package_show (2026-06-15). " +
        "Fallback: crawlArcgisLayer sur " +
        "https://cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer (layer 0).",
      format: "geojson",
      url: "https://cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson",
      crs: "EPSG:4326",
      updateCadence: "P1Y",
    },
  ],
};

// ── Aggregate exports ─────────────────────────────────────────────────────────

/**
 * Confirmed QC municipal zonage manifests (CKAN Données Québec).
 * Licence `cc-by-4.0` for all (verified 2026-06-15).
 * Ordered alphabetically by city name.
 */
export const QC_ZONAGE_CKAN_MANIFESTS: readonly SourceManifest[] = [
  GATINEAU_ZONAGE_MANIFEST,
  LEVIS_ZONAGE_MANIFEST,
  LONGUEUIL_ZONAGE_MANIFEST,
  MONTREAL_LIMITES_HAUTEUR_MANIFEST,
  MONTREAL_PPU_MANIFEST,
  MONTREAL_PUM_2050_MANIFEST,
  QUEBEC_ZONAGE_MANIFEST,
  REPENTIGNY_ZONAGE_MANIFEST,
  RIMOUSKI_ZONAGE_MANIFEST,
  ROUYN_NORANDA_ZONAGE_MANIFEST,
  SAGUENAY_ZONAGE_MANIFEST,
  SAINT_HYACINTHE_AFFECTATIONS_MANIFEST,
  SAINT_HYACINTHE_ZONAGE_MANIFEST,
  SHAWINIGAN_ZONAGE_MANIFEST,
  SHERBROOKE_ZONAGE_MANIFEST,
  TROIS_RIVIERES_ZONAGE_MANIFEST,
];
