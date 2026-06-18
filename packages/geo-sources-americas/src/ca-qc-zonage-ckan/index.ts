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


// ── Supplemental CKAN zoning / urbanism zones ────────────────────────────────

interface SupplementalCkanZonageDataset {
  readonly sourceId: string;
  readonly datasetId: string;
  readonly title: string;
  readonly description: string;
  readonly providerName: string;
  readonly providerUrl: string;
  readonly packageId: string;
  readonly url: string;
}

function supplementalZonageManifest(spec: SupplementalCkanZonageDataset): SourceManifest {
  return {
    id: spec.sourceId,
    title: spec.title,
    description: spec.description,
    kind: "administrative",
    jurisdiction: { country: "CA", subdivision: "CA-QC" },
    provider: {
      name: spec.providerName,
      url: spec.providerUrl,
    },
    license: "cc-by-4.0",
    homepage: `https://www.donneesquebec.ca/recherche/dataset/${spec.packageId}`,
    datasets: [
      {
        id: spec.datasetId,
        title: `${spec.title} (GeoJSON WGS84)`,
        description: `${spec.description} Ressource GeoJSON confirmée via package_search Données Québec (2026-06-18).`,
        format: "geojson",
        url: spec.url,
        crs: "EPSG:4326",
        updateCadence: "P1Y",
      },
    ],
  } satisfies SourceManifest;
}

const SUPPLEMENTAL_ZONAGE_CKAN_DATASETS: readonly SupplementalCkanZonageDataset[] = [
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-espace-vert-local",
    datasetId: "qc-zonage-montreal-pum-2050-espace-vert-local",
    title: "PUM 2050 - Affectation du sol Espace vert local — Ville de Montréal",
    description: "Polygones de l'affectation du sol Espace vert local du Plan d'urbanisme et de mobilité 2050 de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: MONTREAL_PUM_2050_CKAN_PACKAGE_ID,
    url: "https://donnees.montreal.ca/fr/dataset/f420857a-709d-450a-a422-61c3f5079a5e/resource/10576f01-940b-403e-afd3-80665d733ee4/download/affect_espacevertlocal.geojson",
  },
  {
    sourceId: "ca-qc/zonage-gatineau-zone-inondable-reglement",
    datasetId: "qc-zonage-gatineau-zone-inondable-reglement",
    title: "Zone inondable - Annexe règlement de zonage — Ville de Gatineau",
    description: "Zones de grand et faible courant des rivières des Outaouais et Gatineau, annexe E du règlement de zonage 502-2005 amendement 502-237-2017.",
    providerName: "Ville de Gatineau",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "zones-de-grand-et-faible-courant-des-rivieres-des-outaouais-gatineau",
    url: "https://www.donneesquebec.ca/recherche/dataset/b1e7c9a9-a34a-457c-8671-bae4529749fb/resource/fa30634a-2cdf-4c2b-829e-32ea37b8ce71/download/zoneinondable.json",
  },
  {
    sourceId: "ca-qc/zonage-quebec-zones-agricoles-permanentes",
    datasetId: "qc-zonage-quebec-zones-agricoles-permanentes",
    title: "Zones agricoles permanentes — Ville de Québec",
    description: "Polygones des zones agricoles permanentes publiés par la Ville de Québec.",
    providerName: "Ville de Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "vque_58",
    url: "https://www.donneesquebec.ca/recherche/dataset/25696140-f1da-4729-831e-9904628c43c6/resource/30449123-2926-4da3-8563-03ac2add9d57/download/vdq-zonesagricolespermanentes.geojson",
  },
  {
    sourceId: "ca-qc/zonage-rimouski-piia",
    datasetId: "qc-zonage-rimouski-piia",
    title: "PIIA — Ville de Rimouski",
    description: "Polygones des plans d'implantation et d'intégration architecturale de la Ville de Rimouski.",
    providerName: "Ville de Rimouski",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "piia",
    url: "https://www.donneesquebec.ca/recherche/dataset/b8c136d8-34b4-44d5-93db-07235205a125/resource/901952e1-07b1-4885-9293-02b5db39481f/download/piia.json",
  },
  {
    sourceId: "ca-qc/zonage-rimouski-perimetre-urbanisation",
    datasetId: "qc-zonage-rimouski-perimetre-urbanisation",
    title: "Périmètre d'urbanisation — Ville de Rimouski",
    description: "Polygones du périmètre d'urbanisation de la Ville de Rimouski.",
    providerName: "Ville de Rimouski",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "pu",
    url: "https://www.donneesquebec.ca/recherche/dataset/53868146-7c06-4415-95cb-08fdc8b4d484/resource/94fedded-9f10-49f3-976c-5a1f1da3297a/download/perimetreurbanisation.json",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-type-milieux",
    datasetId: "qc-zonage-laval-cdu-type-milieux",
    title: "Type de milieux du CDU — Ville de Laval",
    description: "Polygones des types de milieux du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-type-milieux",
    url: "https://www.donneesquebec.ca/recherche/dataset/4abee7cc-b3d9-436e-ab13-e3ea31b45b08/resource/34ce13f3-35bd-4b54-b980-c516ba107864/download/cdu-type-milieux.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-zone-amenagement-ecologique-particuliere",
    datasetId: "qc-zonage-laval-cdu-zone-amenagement-ecologique-particuliere",
    title: "Zone d'aménagement écologique particulière du CDU — Ville de Laval",
    description: "Polygones des zones d'aménagement écologique particulière du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-zone-amenagement-ecologique-particuliere",
    url: "https://www.donneesquebec.ca/recherche/dataset/dc2de4b0-1985-4982-beca-c432941464db/resource/482b8bdb-36e2-4c7c-bb91-1164840d3418/download/cdu-zone-amenagement-ecologique-particuliere.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-piia-zone-amenagement-ecologique-particuliere",
    datasetId: "qc-zonage-laval-cdu-piia-zone-amenagement-ecologique-particuliere",
    title: "PIIA zone d'aménagement écologique particulière du CDU — Ville de Laval",
    description: "Polygones des PIIA liés aux zones d'aménagement écologique particulière du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-piia-zone-amenagement-ecologique-particuliere",
    url: "https://www.donneesquebec.ca/recherche/dataset/5d615028-abf3-413d-9e6c-488ee3b3fa5a/resource/4d7a53fb-3377-4db6-abd9-a4535dd1f63c/download/cdu-piia-zone-amenagement-ecologique-particuliere.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-piia-vitrine-autoroutiere",
    datasetId: "qc-zonage-laval-cdu-piia-vitrine-autoroutiere",
    title: "PIIA vitrine autoroutière du CDU — Ville de Laval",
    description: "Polygones des PIIA vitrine autoroutière du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-piia-vitrine-autoroutiere",
    url: "https://www.donneesquebec.ca/recherche/dataset/643ce0cd-b239-45f8-a5dc-5f3d8c58ef9b/resource/5b7e20a3-20a1-42d9-8395-1238e53f0264/download/cdu-piia-vitrine-autoroutiere.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-piia-territoire-riverain",
    datasetId: "qc-zonage-laval-cdu-piia-territoire-riverain",
    title: "PIIA territoire riverain du CDU — Ville de Laval",
    description: "Polygones des PIIA territoire riverain du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-piia-territoire-riverain",
    url: "https://www.donneesquebec.ca/recherche/dataset/0f7ef1be-bf03-4bec-8b73-a1ee5c62d64b/resource/39441079-94ac-4ec3-a109-0c5f169c8e68/download/cdu-piia-territoire-riverain.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-perimetre-urbanisation",
    datasetId: "qc-zonage-laval-cdu-perimetre-urbanisation",
    title: "Périmètre d'urbanisation du CDU — Ville de Laval",
    description: "Polygones du périmètre d'urbanisation du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-perimetre-urbanisation",
    url: "https://www.donneesquebec.ca/recherche/dataset/ecead70d-5fdf-42f3-a481-287786e3a3bc/resource/212b1eb9-20d6-4413-ae57-5316902f9195/download/cdu-perimetre-urbanisation.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-perimetre-centre-ville",
    datasetId: "qc-zonage-laval-cdu-perimetre-centre-ville",
    title: "Périmètre du centre-ville du CDU — Ville de Laval",
    description: "Polygones du périmètre du centre-ville du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-perimetre-centre-ville",
    url: "https://www.donneesquebec.ca/recherche/dataset/e8b45a85-5fa4-4c02-845e-4dcfd6effb21/resource/008849f2-e910-42f2-9d81-246b0e742b13/download/cdu-perimetre-centre-ville.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-zone-contrainte-sonore",
    datasetId: "qc-zonage-laval-cdu-zone-contrainte-sonore",
    title: "Aire de contraintes sonores du CDU — Ville de Laval",
    description: "Polygones des aires de contraintes sonores du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "zonage-code-de-l-urbanisme-aire-de-contraintes-sonores",
    url: "https://www.donneesquebec.ca/recherche/dataset/24db9ba3-a817-4872-a737-6b320afab40b/resource/35f4d248-3cc6-49d6-a070-bad12cbc0aec/download/cdu-zone-contrainte-sonore.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-zone-contrainte-odeur",
    datasetId: "qc-zonage-laval-cdu-zone-contrainte-odeur",
    title: "Zone de contrainte d'odeur du CDU — Ville de Laval",
    description: "Polygones des zones de contrainte d'odeur des stations d'épuration des eaux usées du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-zone-contrainte-odeur",
    url: "https://www.donneesquebec.ca/recherche/dataset/ce760098-2925-4f5b-b1d8-7434cc51d8e2/resource/cc5ea73f-8e17-4c72-8736-bc937eef303f/download/cdu-zone-contrainte-odeur.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-zone-contrainte-ferroviaire",
    datasetId: "qc-zonage-laval-cdu-zone-contrainte-ferroviaire",
    title: "Zone de contrainte des risques ferroviaires du CDU — Ville de Laval",
    description: "Polygones des zones de contrainte des risques ferroviaires du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-zone-contrainte-ferroviaire",
    url: "https://www.donneesquebec.ca/recherche/dataset/ceccb407-2539-4ddc-882a-a3c7519bc581/resource/84939eb2-d512-4f0e-bb6b-888da9ac03a5/download/cdu-zone-contrainte-ferroviaire.geojson",
  },
  {
    sourceId: "ca-qc/zonage-longueuil-utilisation-sol",
    datasetId: "qc-zonage-longueuil-utilisation-sol",
    title: "Utilisation du sol — Ville de Longueuil",
    description: "Polygones d'utilisation du sol publiés par la Ville de Longueuil.",
    providerName: "Ville de Longueuil",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "utilisation-du-sol",
    url: "https://www.donneesquebec.ca/recherche/dataset/7c22d077-660a-4180-a558-dbf9c05e844e/resource/8df2e7d1-00aa-4dd6-9c02-597bec311e0d/download/utilisationsol.json",
  },
  {
    sourceId: "ca-qc/zonage-longueuil-perimetre-urbain",
    datasetId: "qc-zonage-longueuil-perimetre-urbain",
    title: "Périmètre urbain — Ville de Longueuil",
    description: "Polygones du périmètre urbain publiés par la Ville de Longueuil.",
    providerName: "Ville de Longueuil",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "perimetre-urbain-longueuil",
    url: "https://www.donneesquebec.ca/recherche/dataset/02dd45fb-0ec6-45ed-bb63-bf331a74649a/resource/d62a2dab-73e6-441d-a366-5c32745266bd/download/perimetreurbain.json",
  },
  {
    sourceId: "ca-qc/zonage-saguenay-affectation-sol",
    datasetId: "qc-zonage-saguenay-affectation-sol",
    title: "Affectation du sol au plan d'urbanisme — Ville de Saguenay",
    description: "Polygones d'affectation du sol au plan d'urbanisme de Saguenay.",
    providerName: "Ville de Saguenay",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "sag_affectation",
    url: "https://www.donneesquebec.ca/recherche/dataset/cb8cc9d2-58a7-490c-a3a1-dd8da2276ac4/resource/f9a94b7f-6adf-4c4d-bf74-039b677e3cd7/download/sag_affectation.geojson",
  },
  {
    sourceId: "ca-qc/zonage-saguenay-perimetre-urbain",
    datasetId: "qc-zonage-saguenay-perimetre-urbain",
    title: "Périmètre urbain — Ville de Saguenay",
    description: "Polygones du périmètre urbain publiés par la Ville de Saguenay.",
    providerName: "Ville de Saguenay",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "sag_perimetre-urbain",
    url: "https://www.donneesquebec.ca/recherche/dataset/ea20a777-0b5f-4f0d-a607-b366dcca1b15/resource/e813dcfb-2c57-4901-b2aa-4bea3a1dbed9/download/sag_perimetreurbain.geojson",
  },
  {
    sourceId: "ca-qc/zonage-trois-rivieres-piia",
    datasetId: "qc-zonage-trois-rivieres-piia",
    title: "PIIA — Ville de Trois-Rivières",
    description: "Polygones des plans d'implantation et d'intégration architecturale de Trois-Rivières.",
    providerName: "Ville de Trois-Rivières",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "piia-v3r",
    url: "https://www.donneesquebec.ca/recherche/dataset/693a2cf2-55f0-4c80-8a6f-91a26137610c/resource/832999ed-a761-46b5-aae3-c5d4ff5dd742/download/piia-v3r.json",
  },
  {
    sourceId: "ca-qc/zonage-trois-rivieres-affectation-sol",
    datasetId: "qc-zonage-trois-rivieres-affectation-sol",
    title: "Affectation du sol — Ville de Trois-Rivières",
    description: "Polygones d'affectation du sol publiés par la Ville de Trois-Rivières.",
    providerName: "Ville de Trois-Rivières",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "affectation-du-sol-v3r",
    url: "https://www.donneesquebec.ca/recherche/dataset/19be4795-9060-463a-ace9-92be649fba1a/resource/c50619df-61c9-409e-af71-07792d0bd3bf/download/affectation-sol-v3r.json",
  },
  {
    sourceId: "ca-qc/zonage-trois-rivieres-perimetre-urbanisation",
    datasetId: "qc-zonage-trois-rivieres-perimetre-urbanisation",
    title: "Périmètres d'urbanisation — Ville de Trois-Rivières",
    description: "Polygones des périmètres d'urbanisation publiés par la Ville de Trois-Rivières.",
    providerName: "Ville de Trois-Rivières",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "perimetre-urbain-v3r",
    url: "https://www.donneesquebec.ca/recherche/dataset/821eed5c-0b3d-4d96-9ea4-a670e56ed15d/resource/2d40b0e4-cca6-421e-88bd-7e5d6569851f/download/perimetre-urbain-v3r.json",
  },
  {
    sourceId: "ca-qc/zonage-trois-rivieres-phase-developpement-urbanisme",
    datasetId: "qc-zonage-trois-rivieres-phase-developpement-urbanisme",
    title: "Phase de développement du plan d'urbanisme — Ville de Trois-Rivières",
    description: "Polygones des phases de développement du plan d'urbanisme de Trois-Rivières.",
    providerName: "Ville de Trois-Rivières",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "phase-dev-plan-urba-v3r",
    url: "https://www.donneesquebec.ca/recherche/dataset/92140ae2-5432-4feb-abcc-88eb91542c32/resource/fe9433df-f6c0-4517-a6d5-7f069098729c/download/phase-dev-plan-urba-v3r.json",
  },
  {
    sourceId: "ca-qc/zonage-rouyn-noranda-affectation-sol-plan-urbanisme",
    datasetId: "qc-zonage-rouyn-noranda-affectation-sol-plan-urbanisme",
    title: "Affectations du sol au plan d'urbanisme — Ville de Rouyn-Noranda",
    description: "Polygones d'affectations du sol au plan d'urbanisme de Rouyn-Noranda.",
    providerName: "Ville de Rouyn-Noranda",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "fb70c632427e4d08ab8da27f586f0d57_0",
    url: "https://www.donneesquebec.ca/recherche/dataset/9cdffa06-a461-4e90-9194-7ac884840cd5/resource/881fccce-a689-4eb5-a367-5370d1cc9c2a/download/affectation_sol_plan_urbanisme.json",
  },
  {
    sourceId: "ca-qc/zonage-rouyn-noranda-perimetres-urbains",
    datasetId: "qc-zonage-rouyn-noranda-perimetres-urbains",
    title: "Périmètres urbains — Ville de Rouyn-Noranda",
    description: "Polygones des périmètres urbains publiés par Rouyn-Noranda.",
    providerName: "Ville de Rouyn-Noranda",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "371e43c2adc1461ab09c8013b5c488ee_0",
    url: "https://www.donneesquebec.ca/recherche/dataset/e23d07c7-6511-4800-9615-ce2e8e29f65d/resource/5f1f9263-8046-4b5f-b480-64f00236dacf/download/perimetre_urbain.geojson",
  },
  {
    sourceId: "ca-qc/zonage-rouyn-noranda-affectation-territoire-sadr",
    datasetId: "qc-zonage-rouyn-noranda-affectation-territoire-sadr",
    title: "Affectations du territoire au SADR — Ville de Rouyn-Noranda",
    description: "Polygones d'affectations du territoire au schéma d'aménagement et de développement révisé de Rouyn-Noranda.",
    providerName: "Ville de Rouyn-Noranda",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "94ce01334fe14ff5b3cd62af140cf0cb_0",
    url: "https://www.donneesquebec.ca/recherche/dataset/42d1454b-05f1-449a-afa4-b3fa9bcd36ce/resource/19430433-548b-41da-84cd-8596a9d44b19/download/affectation_territoire_sadr.geojson",
  },
  {
    sourceId: "ca-qc/zonage-sherbrooke-affectations-sol",
    datasetId: "qc-zonage-sherbrooke-affectations-sol",
    title: "Affectations du sol — Ville de Sherbrooke",
    description: "Polygones des affectations du sol publiés par Sherbrooke.",
    providerName: "Ville de Sherbrooke",
    providerUrl: "https://donneesouvertes-sherbrooke.opendata.arcgis.com",
    packageId: "34527d5b13034195bc3029f4988e5de4_0",
    url: "https://donneesouvertes-sherbrooke.opendata.arcgis.com/api/download/v1/items/34527d5b13034195bc3029f4988e5de4/geojson?layers=0",
  },
  {
    sourceId: "ca-qc/zonage-sherbrooke-perimetre-urbain",
    datasetId: "qc-zonage-sherbrooke-perimetre-urbain",
    title: "Périmètre urbain — Ville de Sherbrooke",
    description: "Polygones du périmètre urbain publiés par Sherbrooke.",
    providerName: "Ville de Sherbrooke",
    providerUrl: "https://donneesouvertes-sherbrooke.opendata.arcgis.com",
    packageId: "cde79f04c7d649b8860594fd5c50a8ef_0",
    url: "https://donneesouvertes-sherbrooke.opendata.arcgis.com/api/download/v1/items/cde79f04c7d649b8860594fd5c50a8ef/geojson?layers=0",
  },
  {
    sourceId: "ca-qc/zonage-gatineau-affectations-territoire",
    datasetId: "qc-zonage-gatineau-affectations-territoire",
    title: "Affectations du territoire — Ville de Gatineau",
    description: "Polygones d'affectations du territoire publiés par la Ville de Gatineau.",
    providerName: "Ville de Gatineau",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "affectations-du-territoire",
    url: "https://www.donneesquebec.ca/recherche/dataset/e57cc953-a96c-41df-8822-a5e456e76c35/resource/99bef1cc-4ebc-4cdd-a7ad-7d519a0bb7c2/download/affectations_territoire.json",
  },
  {
    sourceId: "ca-qc/zonage-rimouski-affectations-sol",
    datasetId: "qc-zonage-rimouski-affectations-sol",
    title: "Affectations du sol — Ville de Rimouski",
    description: "Polygones d'affectations du sol publiés par la Ville de Rimouski.",
    providerName: "Ville de Rimouski",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "affectations",
    url: "https://www.donneesquebec.ca/recherche/dataset/6728d63f-cf12-426b-bb1f-344a6d398394/resource/2c8bdae5-549b-4183-b1c9-c04da1963f28/download/affectation.json",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-production-agricole",
    datasetId: "qc-zonage-laval-cdu-production-agricole",
    title: "Zonage de production agricole du CDU — Ville de Laval",
    description: "Polygones du zonage de production agricole du code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-zonage-de-production-agricole",
    url: "https://www.donneesquebec.ca/recherche/dataset/0d299651-2d95-4de3-b513-cf6009f51ca7/resource/16f0f379-10a8-47c5-bcbb-90aecb0edbb2/download/cdu-zonage-production-agricole.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-distance-separatrice-production-agricole",
    datasetId: "qc-zonage-laval-sad-distance-separatrice-production-agricole",
    title: "Distances séparatrices de production agricole du SAD — Ville de Laval",
    description: "Polygones de délimitation des distances séparatrices par rapport au périmètre d'urbanisation de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-distances-separatrices-par-rapport-au-perimetre-d-urbanisation",
    url: "https://www.donneesquebec.ca/recherche/dataset/a830ba50-04b2-47c9-931f-6d61f5a18147/resource/f7bdf97d-8552-4c91-9b19-ef5d95fad33f/download/sad-distance-separatrice-pour-production-agricole.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-perimetre-urbanisation",
    datasetId: "qc-zonage-laval-sad-perimetre-urbanisation",
    title: "Périmètre d'urbanisation du SAD — Ville de Laval",
    description: "Polygones de délimitation du périmètre d'urbanisation du schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-du-perimetre-d-urbanisation",
    url: "https://www.donneesquebec.ca/recherche/dataset/5df6bf93-bcea-43bf-b727-dd6aff8fff68/resource/7ae7fec7-d260-464d-90d4-b926ce590eee/download/sad-perimetre-d-urbanisation.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-utilisation-sol-carriere",
    datasetId: "qc-zonage-laval-sad-utilisation-sol-carriere",
    title: "Utilisation du sol - carrières — Ville de Laval",
    description: "Polygones de délimitation approximative des carrières publiés par Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-approximative-des-carrieres",
    url: "https://www.donneesquebec.ca/recherche/dataset/ca1f60e2-cbed-442b-a169-2216e3ab7053/resource/13f5ed9b-58bd-41c2-8ab4-afb2009203e1/download/sad-utilisation-sol-carriere.geojson",
  },
  {
    sourceId: "ca-qc/zonage-quebec-utilisation-sol",
    datasetId: "qc-zonage-quebec-utilisation-sol",
    title: "Utilisation du sol — Ville de Québec",
    description: "Polygones d'utilisation du sol publiés par la Ville de Québec.",
    providerName: "Ville de Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "vque_54",
    url: "https://www.donneesquebec.ca/recherche/dataset/9f72df06-1b29-4647-831a-d10faa45a6aa/resource/a281ed4e-6798-465a-a622-25b7f2043016/download/vdq-utilisationdusol.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-plan-urbanisme-affectation-sol",
    datasetId: "qc-zonage-montreal-plan-urbanisme-affectation-sol",
    title: "Plan d'urbanisme - Affectation du sol — Ville de Montréal",
    description: "Polygones d'affectation du sol au Plan d'urbanisme de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-affectation-du-sol",
    url: "https://donnees.montreal.ca/dataset/0eaea940-aafc-43bc-bab2-a87ac66a93ba/resource/6c424c56-1cc9-4fd2-99b2-686ba78f54a7/download/affectationpu.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-plan-urbanisme-densite-construction",
    datasetId: "qc-zonage-montreal-plan-urbanisme-densite-construction",
    title: "Plan d'urbanisme - Densité de construction — Ville de Montréal",
    description: "Polygones de densité de construction au Plan d'urbanisme de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-plan-urbanisme-densite",
    url: "https://donnees.montreal.ca/dataset/63964021-1bb6-4828-ae82-b7ac421a4990/resource/7a59762e-ac17-4a9f-bb2a-12e2d5673906/download/densitepu.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-grandes-affectations",
    datasetId: "qc-zonage-montreal-schema-grandes-affectations",
    title: "Schéma d'aménagement - Grandes affectations du territoire — Ville de Montréal",
    description: "Polygones des grandes affectations du territoire du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-affectation-densite",
    url: "https://donnees.montreal.ca/dataset/0d39fcc6-8dff-4c5b-902f-1752fa44db70/resource/87c6370f-a661-41d0-a631-f3d8e5276598/download/graffectations.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-perimetre-urbanisation",
    datasetId: "qc-zonage-montreal-schema-perimetre-urbanisation",
    title: "Schéma d'aménagement - Périmètre d'urbanisation — Ville de Montréal",
    description: "Polygones du périmètre d'urbanisation du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-affectation-densite",
    url: "https://donnees.montreal.ca/dataset/0d39fcc6-8dff-4c5b-902f-1752fa44db70/resource/a6e477af-cbb4-4a90-8f6f-f3d78ce391a4/download/perimurb.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-secteurs-densification",
    datasetId: "qc-zonage-montreal-schema-secteurs-densification",
    title: "Schéma d'aménagement - Secteurs prioritaires de densification — Ville de Montréal",
    description: "Polygones des secteurs prioritaires de densification du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-affectation-densite",
    url: "https://donnees.montreal.ca/dataset/0d39fcc6-8dff-4c5b-902f-1752fa44db70/resource/681a83f5-4513-402a-83a8-f227fb10ba0d/download/secteursdensification.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-aires-densite",
    datasetId: "qc-zonage-montreal-schema-aires-densite",
    title: "Schéma d'aménagement - Aires de densité — Ville de Montréal",
    description: "Polygones des aires de densité du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-affectation-densite",
    url: "https://donnees.montreal.ca/dataset/0d39fcc6-8dff-4c5b-902f-1752fa44db70/resource/15b34214-38cc-46b6-92be-21a6441a525f/download/densiteairetod.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-densite-residentielle",
    datasetId: "qc-zonage-montreal-schema-densite-residentielle",
    title: "Schéma d'aménagement - Densité résidentielle — Ville de Montréal",
    description: "Polygones de densité résidentielle du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-affectation-densite",
    url: "https://donnees.montreal.ca/dataset/0d39fcc6-8dff-4c5b-902f-1752fa44db70/resource/cc5a08e4-41d2-4c8c-a0bf-7a4e1a72b613/download/densiteresidentielle.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-terrains-construire-transformer",
    datasetId: "qc-zonage-montreal-schema-terrains-construire-transformer",
    title: "Schéma d'aménagement - Terrains à construire et à transformer — Ville de Montréal",
    description: "Polygones des terrains à construire et à transformer du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-affectation-densite",
    url: "https://donnees.montreal.ca/dataset/0d39fcc6-8dff-4c5b-902f-1752fa44db70/resource/61ed8f1d-331b-4cbf-89fa-f81d293f8a37/download/terrainsconsttrans.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-planification-strategique",
    datasetId: "qc-zonage-montreal-schema-planification-strategique",
    title: "Schéma d'aménagement - Secteurs de planification stratégique — Ville de Montréal",
    description: "Polygones des secteurs de planification stratégique du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-affectation-densite",
    url: "https://donnees.montreal.ca/dataset/0d39fcc6-8dff-4c5b-902f-1752fa44db70/resource/a290349f-5ed8-408f-ac2e-13a768d19faa/download/planifstrategiquesad.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-ensembles-commerciaux-redeveloppement",
    datasetId: "qc-zonage-montreal-pum-2050-ensembles-commerciaux-redeveloppement",
    title: "PUM 2050 - Ensembles commerciaux à potentiel de redéveloppement — Ville de Montréal",
    description: "Polygones des grands ensembles commerciaux péricentriques à potentiel de redéveloppement du PUM 2050 de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-grands-ensembles-commerciaux-pericentriques-redeveloppement-plan-urbanisme-mobilite-2050",
    url: "https://donnees.montreal.ca/fr/dataset/f70f8ebf-8bf3-46fe-ae2b-55e93eef77cf/resource/aa102aee-ddd6-45f3-987c-6a443c75efc9/download/commpericentr_potredevlp.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-secteurs-opportunite",
    datasetId: "qc-zonage-montreal-pum-2050-secteurs-opportunite",
    title: "PUM 2050 - Secteurs d'opportunité — Ville de Montréal",
    description: "Polygones des secteurs d'opportunité du Plan d'urbanisme et de mobilité 2050 de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-secteurs-d-opportunite-plan-d-urbanisme-et-de-mobilite-2050",
    url: "https://donnees.montreal.ca/dataset/959ab861-a1a3-49b2-b101-5b948a4804ca/resource/ba5b4853-0b6d-423c-b970-1de733a66ef7/download/sect_plan_officiel.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-stationnement-srb-pie-ix",
    datasetId: "qc-zonage-montreal-pum-2050-stationnement-srb-pie-ix",
    title: "PUM 2050 - Secteurs stationnement SRB Pie-IX — Ville de Montréal",
    description: "Polygones de référence pour les dispositions de stationnement autour des stations du SRB Pie-IX.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-secteurs-reference-dispositions-stationnement-plan-urbanisme-mobilite-2050",
    url: "https://donnees.montreal.ca/dataset/e04f47ad-06a9-400e-9577-dd79fdb51a92/resource/1b600caf-4f74-47f9-a77f-bbb9cb647fa3/download/rayonsmarche500m_srbpieix.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-stationnement-metro",
    datasetId: "qc-zonage-montreal-pum-2050-stationnement-metro",
    title: "PUM 2050 - Secteurs stationnement métro — Ville de Montréal",
    description: "Polygones de référence pour les dispositions de stationnement autour des stations de métro.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-secteurs-reference-dispositions-stationnement-plan-urbanisme-mobilite-2050",
    url: "https://donnees.montreal.ca/dataset/e04f47ad-06a9-400e-9577-dd79fdb51a92/resource/2e406b2c-c2ac-46eb-a166-e3770aa322a9/download/rayonsmarche750m_metro.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-stationnement-rem",
    datasetId: "qc-zonage-montreal-pum-2050-stationnement-rem",
    title: "PUM 2050 - Secteurs stationnement REM — Ville de Montréal",
    description: "Polygones de référence pour les dispositions de stationnement autour des stations de REM.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-secteurs-reference-dispositions-stationnement-plan-urbanisme-mobilite-2050",
    url: "https://donnees.montreal.ca/dataset/e04f47ad-06a9-400e-9577-dd79fdb51a92/resource/a85e4927-b67f-4dc7-86f7-bfb66ca5bcf0/download/rayonsmarche750m_rem.geojson",
  },
  {
    sourceId: "ca-qc/zonage-rimouski-aires-contraintes",
    datasetId: "qc-zonage-rimouski-aires-contraintes",
    title: "Aires de contraintes — Ville de Rimouski",
    description: "Polygones des aires de contraintes du plan d'urbanisme de Rimouski.",
    providerName: "Ville de Rimouski",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "aires-de-contraintes",
    url: "https://www.donneesquebec.ca/recherche/dataset/c569c90d-ca0a-4db0-af39-126fcc24ea9a/resource/ca09cc1f-2d90-4230-a32c-d52e3474af39/download/airecontrainte.json",
  },
  {
    sourceId: "ca-qc/zonage-trois-rivieres-affectation-territoire-sadr",
    datasetId: "qc-zonage-trois-rivieres-affectation-territoire-sadr",
    title: "Affectation du territoire (SADR) — Ville de Trois-Rivières",
    description: "Polygones d'affectation du territoire au schéma d'aménagement et de développement révisé de Trois-Rivières.",
    providerName: "Ville de Trois-Rivières",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "affectation-territoire-sadr-v3r",
    url: "https://www.donneesquebec.ca/recherche/dataset/1d98b01f-c62f-4ecd-b366-8c294427c26b/resource/c01f5de6-0dc6-4271-8814-bc6b14bc2fb8/download/affectation-territoire-sadr-v3r.json",
  },
  {
    sourceId: "ca-qc/zonage-quebec-zones-inondables-reglementees",
    datasetId: "qc-zonage-quebec-zones-inondables-reglementees",
    title: "Zones inondables réglementées — Ville de Québec",
    description: "Polygones des zones inondables réglementées publiées par la Ville de Québec.",
    providerName: "Ville de Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "vque_77",
    url: "https://www.donneesquebec.ca/recherche/dataset/f5b58938-8153-4091-baae-08ccf01fc8e2/resource/7be12b7d-1038-445c-a794-76fb8c0cd1f7/download/vdq-zonesinondablesreglementees.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-grandes-affectations-territoire",
    datasetId: "qc-zonage-laval-sad-grandes-affectations-territoire",
    title: "Grandes affectations du territoire du SAD — Ville de Laval",
    description: "Polygones de délimitation des grandes affectations du territoire du schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-grandes-affectations-du-territoire",
    url: "https://www.donneesquebec.ca/recherche/dataset/a18e1c84-54d6-44d3-a0ba-a1323162ac6e/resource/a8b4b215-f479-4707-b33a-9adf7c9e612d/download/sad-grande-affectation-du-territoire.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-hauteur-maximale-batiments",
    datasetId: "qc-zonage-laval-sad-hauteur-maximale-batiments",
    title: "Secteurs de hauteur maximale des bâtiments du SAD — Ville de Laval",
    description: "Polygones de délimitation des secteurs de hauteur maximale des bâtiments du schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-secteurs-de-hauteur-maximale-des-batiments",
    url: "https://www.donneesquebec.ca/recherche/dataset/aac77691-7bfd-40fb-9f1c-af71b8270fa8/resource/ce9f62b6-90d9-4a40-9c79-c3edb5002d15/download/sad-hauteur-maximale-des-batiments.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-densite-residentielle-minimale",
    datasetId: "qc-zonage-laval-sad-densite-residentielle-minimale",
    title: "Seuils de densité résidentielle minimale brute du SAD — Ville de Laval",
    description: "Polygones de délimitation des seuils de densité résidentielle minimale brute du schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-seuils-de-densite-residentielle-minimale-brute",
    url: "https://www.donneesquebec.ca/recherche/dataset/74bf5cf3-0a9b-4c4b-be9f-f679e2e63a2f/resource/46149f76-7c85-4152-98d3-12f42caf4773/download/sad-densite-residentielle-brute.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-contrainte-odeur-station-epuration",
    datasetId: "qc-zonage-laval-sad-contrainte-odeur-station-epuration",
    title: "Distances séparatrices des usines d'épuration du SAD — Ville de Laval",
    description: "Polygones des distances séparatrices par rapport aux usines d'épuration pour les contraintes d'odeurs du schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-distances-separatrices-par-rapport-usines-d-epuration-pour-les-contraintes-d-odeurs",
    url: "https://www.donneesquebec.ca/recherche/dataset/d677087b-c1e4-46d7-b8d4-4f1c08a95f67/resource/c39e85fb-ded6-4ee0-ad9e-dcb00e55b779/download/sad-contrainte-odeur-station-epuration.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-zone-agricole",
    datasetId: "qc-zonage-laval-sad-zone-agricole",
    title: "Zone agricole permanente et inclusions agricoles du SAD — Ville de Laval",
    description: "Polygones de délimitation de la zone agricole permanente et des inclusions agricoles du schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-de-la-zone-agricole-permanente-et-des-inclusions-agricoles",
    url: "https://www.donneesquebec.ca/recherche/dataset/7a8b6386-0336-4711-81c6-14d019907d2c/resource/9c41abbe-423c-47a4-be4c-82b926bb4a8f/download/sad-zone-agricole.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-aires-tod",
    datasetId: "qc-zonage-laval-sad-aires-tod",
    title: "Aires TOD illustrées du SAD — Ville de Laval",
    description: "Polygones de délimitation des aires TOD illustrées du schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-aires-tod-illustrees",
    url: "https://www.donneesquebec.ca/recherche/dataset/f77318ce-36a1-4613-999c-c00ad1aefade/resource/5e0d570e-f10f-4967-84b7-a751c14e53b9/download/sad-aire-transit-oriented-developpement-tod.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-terrains-structurants-construire",
    datasetId: "qc-zonage-laval-sad-terrains-structurants-construire",
    title: "Terrains structurants à construire du SAD — Ville de Laval",
    description: "Polygones de délimitation des terrains structurants à construire du schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-terrains-structurants-a-construire",
    url: "https://www.donneesquebec.ca/recherche/dataset/3953705a-8d86-4427-b411-c75746fc26b9/resource/2dc7df86-3262-4500-bc7a-feebb5df7abf/download/sad-terrains-structurants-a-construire.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-terrains-structurants-transformer",
    datasetId: "qc-zonage-laval-sad-terrains-structurants-transformer",
    title: "Terrains structurants à transformer du SAD — Ville de Laval",
    description: "Polygones de délimitation des terrains structurants à transformer du schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-terrains-structurants-a-transformer",
    url: "https://www.donneesquebec.ca/recherche/dataset/43862633-c1b0-42a9-a474-3d7ab68be5e9/resource/561fcfdf-a53b-45da-8a00-8b32045da831/download/sad-terrains-structurants-a-transformer.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-secteurs-amenagement",
    datasetId: "qc-zonage-laval-secteurs-amenagement",
    title: "Limites des secteurs d'aménagement — Ville de Laval",
    description: "Polygones des limites des secteurs d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "limites-des-secteurs-d-amenagement",
    url: "https://www.donneesquebec.ca/recherche/dataset/7855bca7-28c8-4da9-927b-1ffe10be4f09/resource/76bb4d9f-dff9-4863-b9bc-15e851e290e6/download/limites-des-secteurs-d-amenagement.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-bois-corridors-forestiers-interet",
    datasetId: "qc-zonage-laval-cdu-bois-corridors-forestiers-interet",
    title: "Bois et corridors forestiers d'intérêt du CDU — Ville de Laval",
    description: "Polygones des bois et corridors forestiers d'intérêt établis dans le code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-bois-et-corridors-forestiers-d-interet",
    url: "https://www.donneesquebec.ca/recherche/dataset/06950d7f-94d9-4033-90b2-f0a3f57eabbf/resource/55b380aa-5df9-48ec-9e61-ed5ff5ac667b/download/cdu-bois-et-corridors-forestiers-interet.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-ecosysteme-forestier-exceptionnel",
    datasetId: "qc-zonage-laval-cdu-ecosysteme-forestier-exceptionnel",
    title: "Écosystème forestier exceptionnel du CDU — Ville de Laval",
    description: "Polygones des écosystèmes forestiers exceptionnels établis dans le code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-ecosysteme-forestier-exceptionnel",
    url: "https://www.donneesquebec.ca/recherche/dataset/2929f373-5b29-44b9-8f5b-e2e463cb0cca/resource/c7cdd5c0-4604-4e37-acb8-24b909e0bf6e/download/cdu-ecosysteme-forestier-exceptionnel.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-couvert-forestier",
    datasetId: "qc-zonage-laval-cdu-couvert-forestier",
    title: "Couvert forestier du CDU — Ville de Laval",
    description: "Polygones du couvert forestier représenté dans le code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-couvert-forestier",
    url: "https://www.donneesquebec.ca/recherche/dataset/ec15823e-40bc-4f6b-b482-482427ed201a/resource/18051005-3737-4ebe-b7d4-caef54ef0397/download/cdu-couvert-forestier.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-milieu-humide-interet-presume",
    datasetId: "qc-zonage-laval-cdu-milieu-humide-interet-presume",
    title: "Milieu humide d'intérêt présumé du CDU — Ville de Laval",
    description: "Polygones des milieux humides d'intérêt présumé établis dans le code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "milieu-humide-d-interet-presume",
    url: "https://www.donneesquebec.ca/recherche/dataset/02e54ee7-aef3-42dd-81b6-68c93ffbc465/resource/35b27c6b-af1b-43e7-82d3-c7cda9be62ee/download/cdu-milieu-humide-interet-presume.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-vente-produits-ferme-milieu-urbain",
    datasetId: "qc-zonage-laval-cdu-vente-produits-ferme-milieu-urbain",
    title: "Vente extérieure de produits de la ferme en milieu urbain du CDU — Ville de Laval",
    description: "Polygone du territoire autorisant la vente extérieure de produits de la ferme en milieu urbain dans le code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu_territoire_autorisant_vente_produits_de_la_ferme_en_milieu_urbain",
    url: "https://www.donneesquebec.ca/recherche/dataset/7df302b7-d0e3-47e7-8e10-1d2626f44be4/resource/3304a901-75a4-4369-9d86-f714c256a430/download/cdu-territoire-autorisant-vente-produits-de-la-ferme-en-milieu-urbain.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-cdu-aire-influence-milieu-humide-interet-presume",
    datasetId: "qc-zonage-laval-cdu-aire-influence-milieu-humide-interet-presume",
    title: "Aire d'influence de milieu humide d'intérêt présumé du CDU — Ville de Laval",
    description: "Polygones des aires d'influence de milieux humides d'intérêt présumé établies dans le code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-aire-influence-milieu-humide-interet-presume",
    url: "https://www.donneesquebec.ca/recherche/dataset/b0712843-8431-496c-a418-ffe6dd1adc3e/resource/080552ff-6fb9-4811-8596-377983a1d536/download/cdu-aire-influence-milieu-humide-interet-presume.geojson",
  },

  {
    sourceId: "ca-qc/zonage-quebec-grandes-affectations-territoire",
    datasetId: "qc-zonage-quebec-grandes-affectations-territoire",
    title: "Grandes affectations du territoire — Ville de Québec",
    description: "Polygones des grandes affectations du territoire publiés par la Ville de Québec.",
    providerName: "Ville de Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "grandes-affectations-du-territoire",
    url: "https://www.donneesquebec.ca/recherche/dataset/ec849ced-33e2-48b2-870f-892fb303d7a8/resource/a77c7f07-4e7c-43ab-b848-fd146cc751b4/download/vdq-schemagrandeaffectation.geojson",
  },
  {
    sourceId: "ca-qc/zonage-saguenay-grandes-affectations-territoire",
    datasetId: "qc-zonage-saguenay-grandes-affectations-territoire",
    title: "Grandes affectations du territoire — Ville de Saguenay",
    description: "Polygones des grandes affectations du territoire publiés par la Ville de Saguenay.",
    providerName: "Ville de Saguenay",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "1a5a6b81-4b2b-4623-8c0f-67c5da9208a9",
    url: "https://www.donneesquebec.ca/recherche/dataset/1a5a6b81-4b2b-4623-8c0f-67c5da9208a9/resource/b1dfe680-04c6-4bec-8d7c-9854b5be531b/download/sag_grandesaffectations.geojson",
  },
  {
    sourceId: "ca-qc/zonage-sherbrooke-affectations-territoire",
    datasetId: "qc-zonage-sherbrooke-affectations-territoire",
    title: "Affectations du territoire — Ville de Sherbrooke",
    description: "Polygones des affectations du territoire publiés par la Ville de Sherbrooke.",
    providerName: "Ville de Sherbrooke",
    providerUrl: "https://donneesouvertes-sherbrooke.opendata.arcgis.com",
    packageId: "582f768e118b4edeb7f24abe3e7ebf52_0",
    url: "https://donneesouvertes-sherbrooke.opendata.arcgis.com/api/download/v1/items/582f768e118b4edeb7f24abe3e7ebf52/geojson?layers=0",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-patrimoine-secteurs",
    datasetId: "qc-zonage-montreal-pum-2050-patrimoine-secteurs",
    title: "PUM 2050 - Ensembles et secteurs patrimoniaux — Ville de Montréal",
    description: "Polygones des ensembles et secteurs patrimoniaux du Plan d'urbanisme et de mobilité 2050 de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-patrimoine-et-paysages-plan-d-urbanisme-et-de-mobilite-2050",
    url: "https://donnees.montreal.ca/fr/dataset/6e89c97b-3786-4aad-a664-a07d31f84b2f/resource/f23f68bd-451c-4832-aa2e-9446daa3a57a/download/patrimoine_bati_paysager_pum.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-corridors-visuels",
    datasetId: "qc-zonage-montreal-pum-2050-corridors-visuels",
    title: "PUM 2050 - Corridors visuels — Ville de Montréal",
    description: "Polygones des corridors visuels exceptionnels ou intéressants du Plan d'urbanisme et de mobilité 2050 de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-patrimoine-et-paysages-plan-d-urbanisme-et-de-mobilite-2050",
    url: "https://donnees.montreal.ca/fr/dataset/6e89c97b-3786-4aad-a664-a07d31f84b2f/resource/d04837a5-c7c2-41c8-bc9f-9b817d15b1be/download/corridorvisuel.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-cotes-vues-exceptionnelles",
    datasetId: "qc-zonage-montreal-pum-2050-cotes-vues-exceptionnelles",
    title: "PUM 2050 - Cotes altimétriques des vues exceptionnelles — Ville de Montréal",
    description: "Polygones des cotes altimétriques des corridors visuels exceptionnels du PUM 2050 de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-patrimoine-et-paysages-plan-d-urbanisme-et-de-mobilite-2050",
    url: "https://donnees.montreal.ca/fr/dataset/6e89c97b-3786-4aad-a664-a07d31f84b2f/resource/22f03c4c-d1bd-4662-b3b1-b19bcc505968/download/cotes_vues_except.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-cotes-vues-interessantes",
    datasetId: "qc-zonage-montreal-pum-2050-cotes-vues-interessantes",
    title: "PUM 2050 - Cotes altimétriques des vues intéressantes — Ville de Montréal",
    description: "Polygones des cotes altimétriques des corridors visuels intéressants du PUM 2050 de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-patrimoine-et-paysages-plan-d-urbanisme-et-de-mobilite-2050",
    url: "https://donnees.montreal.ca/fr/dataset/6e89c97b-3786-4aad-a664-a07d31f84b2f/resource/f6ddff1f-32e6-477e-b70f-f45baafffedd/download/cotes_vues_intere.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-pum-2050-secteurs-archeologiques",
    datasetId: "qc-zonage-montreal-pum-2050-secteurs-archeologiques",
    title: "PUM 2050 - Secteurs d'intérêt archéologique — Ville de Montréal",
    description: "Polygones des secteurs d'intérêt archéologique du Plan d'urbanisme et de mobilité 2050 de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-patrimoine-et-paysages-plan-d-urbanisme-et-de-mobilite-2050",
    url: "https://donnees.montreal.ca/fr/dataset/6e89c97b-3786-4aad-a664-a07d31f84b2f/resource/33d070ca-9c2d-4f42-915b-f6eca6681192/download/interet_archeo.geojson",
  },

  {
    sourceId: "ca-qc/zonage-msp-contraintes-erosion-mouvements-terrain",
    datasetId: "qc-zonage-msp-contraintes-erosion-mouvements-terrain",
    title: "Zones de contraintes relatives à l'érosion côtière et mouvements de terrain — MSP Québec",
    description: "Polygones des zones de contraintes relatives à l'érosion côtière et aux mouvements de terrain publiés par le ministère de la Sécurité publique du Québec.",
    providerName: "Ministère de la Sécurité publique du Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "zones-contraintes-erosion-et-mouvements-de-terrain",
    url: "https://geoegl.msp.gouv.qc.ca/apis/wss/aleas.fcgi?service=wfs&version=1.1.0&request=getfeature&typename=dpp_zone_erosion_s&outputformat=geojson&srsName=epsg:4326",
  },
  {
    sourceId: "ca-qc/zonage-gatineau-zones-inondables-norme",
    datasetId: "qc-zonage-gatineau-zones-inondables-norme",
    title: "Zones inondables normé v1 — Ville de Gatineau",
    description: "Polygones des zones inondables normées publiés par la Ville de Gatineau.",
    providerName: "Ville de Gatineau",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "vgat-zones-inondables-norme-v1",
    url: "https://www.donneesquebec.ca/recherche/dataset/3cf9b309-d6ac-416d-9f03-de946a4322a8/resource/fa2ca5bf-f319-4625-b6ee-693cb1ae5d43/download/zones-inondables-norme.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-environnement-aire-protection-milieu-humide",
    datasetId: "qc-zonage-montreal-schema-environnement-aire-protection-milieu-humide",
    title: "Schéma - Aire de protection d'un milieu humide — Ville de Montréal",
    description: "Polygones des aires de protection d'un milieu humide au schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-environnement-milieux-naturels",
    url: "https://donnees.montreal.ca/fr/dataset/e668ac49-2403-4c91-a61f-09d249da26ac/resource/7b5328bb-fdee-4071-86cb-fefda9d93a5e/download/aireprotection_milhum.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-environnement-milieu-humide-littoral-zi",
    datasetId: "qc-zonage-montreal-schema-environnement-milieu-humide-littoral-zi",
    title: "Schéma - Milieu humide en littoral ou zone inondable — Ville de Montréal",
    description: "Polygones des milieux humides d'intérêt en littoral ou zone inondable du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-environnement-milieux-naturels",
    url: "https://donnees.montreal.ca/fr/dataset/e668ac49-2403-4c91-a61f-09d249da26ac/resource/ea27ca05-924f-44c2-ae7a-39b9123ea976/download/milhumint_littoral_ou_zi.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-environnement-milieu-humide-utilisation-durable",
    datasetId: "qc-zonage-montreal-schema-environnement-milieu-humide-utilisation-durable",
    title: "Schéma - Milieu humide d'intérêt pour une utilisation durable — Ville de Montréal",
    description: "Polygones des milieux humides d'intérêt pour une utilisation durable du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-environnement-milieux-naturels",
    url: "https://donnees.montreal.ca/fr/dataset/e668ac49-2403-4c91-a61f-09d249da26ac/resource/79778d4a-a040-4643-8d42-ff43d9388fa2/download/milhumint_utilisationdurable.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-environnement-milieu-humide-proteger-restaurer",
    datasetId: "qc-zonage-montreal-schema-environnement-milieu-humide-proteger-restaurer",
    title: "Schéma - Milieu humide d'intérêt à protéger ou restaurer — Ville de Montréal",
    description: "Polygones des milieux humides d'intérêt à protéger ou à restaurer du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-environnement-milieux-naturels",
    url: "https://donnees.montreal.ca/fr/dataset/e668ac49-2403-4c91-a61f-09d249da26ac/resource/9c815e0f-d161-454b-b6be-f418700282ea/download/milhumint_aproteger_arestaurer.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-patrimoine-grandes-proprietes-institutionnelles",
    datasetId: "qc-zonage-montreal-schema-patrimoine-grandes-proprietes-institutionnelles",
    title: "Schéma - Grandes propriétés institutionnelles — Ville de Montréal",
    description: "Polygones des grandes propriétés à caractère institutionnel du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-patrimoine-paysage",
    url: "https://donnees.montreal.ca/fr/dataset/1f927d2e-d5b3-4bb6-b521-94b3ce4525b8/resource/24cc739f-5e51-4c54-9739-911b13cf6c79/download/grandespropinst.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-patrimoine-archeologique",
    datasetId: "qc-zonage-montreal-schema-patrimoine-archeologique",
    title: "Schéma - Patrimoine archéologique — Ville de Montréal",
    description: "Polygones du patrimoine archéologique du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-patrimoine-paysage",
    url: "https://donnees.montreal.ca/fr/dataset/1f927d2e-d5b3-4bb6-b521-94b3ce4525b8/resource/b8d8ef70-951d-434d-a629-9280ff09a1a3/download/siarcheosad.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-economie-poles-commerciaux",
    datasetId: "qc-zonage-montreal-schema-economie-poles-commerciaux",
    title: "Schéma - Pôles commerciaux — Ville de Montréal",
    description: "Polygones des pôles commerciaux du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-economie",
    url: "https://donnees.montreal.ca/fr/dataset/f23eda72-c14a-4396-be1e-450396daa975/resource/f169c6e6-4a83-44d1-abd5-f95a23056667/download/polecommercial.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-economie-poles-economiques",
    datasetId: "qc-zonage-montreal-schema-economie-poles-economiques",
    title: "Schéma - Pôles économiques — Ville de Montréal",
    description: "Polygones des pôles économiques du schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-economie",
    url: "https://donnees.montreal.ca/fr/dataset/f23eda72-c14a-4396-be1e-450396daa975/resource/aa403e4b-c1bb-46c5-9793-be1c0c6c6e30/download/poleemploi.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-sites-immeubles-proteges-lpc",
    datasetId: "qc-zonage-montreal-sites-immeubles-proteges-lpc",
    title: "Sites et immeubles protégés LPC — Ville de Montréal",
    description: "Polygones des sites et immeubles protégés en vertu de la Loi sur le patrimoine culturel à Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-sites-immeubles-proteges-lpc",
    url: "https://donnees.montreal.ca/dataset/41fcc790-e328-44be-bcbf-73556fa0bc32/resource/b0a6cfa4-ad77-4f5b-bd1b-050fe233a31f/download/patrimoinelpc.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-ecoterritoires",
    datasetId: "qc-zonage-montreal-ecoterritoires",
    title: "Écoterritoires de l'agglomération — Ville de Montréal",
    description: "Polygones des écoterritoires de l'agglomération de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-ecoterritoires",
    url: "https://donnees.montreal.ca/fr/dataset/942ae48f-ba0c-4e33-bb81-b6da50d9d13d/resource/295d94b9-8515-4a7c-9bc2-0e661582f4d7/download/ecoterritoires.geojson",
  },
  {
    sourceId: "ca-qc/zonage-rimouski-sites-patrimoine",
    datasetId: "qc-zonage-rimouski-sites-patrimoine",
    title: "Sites du patrimoine — Ville de Rimouski",
    description: "Polygones des sites du patrimoine publiés par la Ville de Rimouski.",
    providerName: "Ville de Rimouski",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "sites-patrimoine",
    url: "https://www.donneesquebec.ca/recherche/dataset/ecea5b3b-d1a5-4183-9003-ba787ac48604/resource/a5f938ce-a332-411a-b8d6-ce031b52897d/download/sitepatrimoine.json",
  },

  {
    sourceId: "ca-qc/zonage-laval-cdu-batiment-interet-patrimonial",
    datasetId: "qc-zonage-laval-cdu-batiment-interet-patrimonial",
    title: "Bâtiment d'intérêt patrimonial du CDU — Ville de Laval",
    description: "Polygones des bâtiments d'intérêt patrimonial du Code de l'urbanisme de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cdu-batiment-interet-patrimonial",
    url: "https://www.donneesquebec.ca/recherche/dataset/dd6dfdac-a961-4c27-99b3-43a6884dad9d/resource/c50e645e-c96d-4bac-8ebf-1ccb76cfe72e/download/cdu-batiment-interet-patrimonial.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-aires-destructurees-zone-agricole",
    datasetId: "qc-zonage-laval-sad-aires-destructurees-zone-agricole",
    title: "Aires déstructurées en zone agricole — Ville de Laval",
    description: "Polygones des aires déstructurées en zone agricole au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "sad-aires-destructurees-en-zone-agricole",
    url: "https://www.donneesquebec.ca/recherche/dataset/3f33cb21-037a-49c3-bea2-ca2e89bbc978/resource/6d71ac23-2724-41c7-838b-570d5887f78e/download/sad-aires-destructurees-en-zone-agricole.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-territoire-interet-patrimonial",
    datasetId: "qc-zonage-laval-sad-territoire-interet-patrimonial",
    title: "Territoires d'intérêt patrimonial — Ville de Laval",
    description: "Polygones des territoires d'intérêt patrimonial au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-approximative-des-territoires-d-interet-patrimonial",
    url: "https://www.donneesquebec.ca/recherche/dataset/ab1afd0e-eaed-45b7-8be5-253c33f6209f/resource/5ddfa3b7-474f-4ffa-b9d3-b659234f2912/download/sad-territoire-d-interet-patrimonial.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-centre-ville",
    datasetId: "qc-zonage-laval-sad-centre-ville",
    title: "Centre-ville approximatif — Ville de Laval",
    description: "Polygone de délimitation approximative du centre-ville de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-approximative-du-centre-ville",
    url: "https://www.donneesquebec.ca/recherche/dataset/eacf7bfd-c592-4037-bacc-669d83b31b88/resource/1bc5732a-efda-45a0-81ef-925b36a0ccbc/download/sad-secteur-centre-ville.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-aires-protegees",
    datasetId: "qc-zonage-laval-sad-aires-protegees",
    title: "Aires protégées illustrées — Ville de Laval",
    description: "Polygones des aires protégées illustrées au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-aires-protegees-illustrees",
    url: "https://www.donneesquebec.ca/recherche/dataset/4b68b330-2a29-4394-97b4-5e0549e21acf/resource/48929723-cfa0-493c-8ab6-86260e98e9f7/download/sad-aires-naturelles-protegees.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-bois-interet-metropolitain",
    datasetId: "qc-zonage-laval-sad-bois-interet-metropolitain",
    title: "Bois d'intérêt métropolitain — Ville de Laval",
    description: "Polygones des bois d'intérêt métropolitain au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-bois-d-interet-metropolitain",
    url: "https://www.donneesquebec.ca/recherche/dataset/35470900-1873-4548-a66f-a0c309f3143c/resource/29437aee-c54b-4bc7-9fa0-fe98553153ae/download/sad-bois-d-interet-metropolitain.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-bois-interet-municipal",
    datasetId: "qc-zonage-laval-sad-bois-interet-municipal",
    title: "Bois d'intérêt municipal — Ville de Laval",
    description: "Polygones des bois d'intérêt municipaux au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-bois-d-interet-municipaux",
    url: "https://www.donneesquebec.ca/recherche/dataset/e0e294cf-bef2-4361-a4d3-2fcf88df69ec/resource/28e56a06-785e-4859-9ab9-f6332b5f671f/download/sad-bois-d-interet-municipal.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-ecosystemes-forestiers-exceptionnels",
    datasetId: "qc-zonage-laval-sad-ecosystemes-forestiers-exceptionnels",
    title: "Écosystèmes forestiers exceptionnels — Ville de Laval",
    description: "Polygones des écosystèmes forestiers exceptionnels au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-ecosystemes-forestiers-exceptionnels",
    url: "https://www.donneesquebec.ca/recherche/dataset/c0d531f0-08e0-433d-bd34-68addc93d84a/resource/34642b7c-1f7b-458d-985b-de17af056fe2/download/sad-ecosysteme-forestier-exceptionnel.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-secteurs-revitalisation-urbaine-integree",
    datasetId: "qc-zonage-laval-sad-secteurs-revitalisation-urbaine-integree",
    title: "Secteurs de revitalisation urbaine intégrée — Ville de Laval",
    description: "Polygones des secteurs de revitalisation urbaine intégrée au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-secteurs-de-revitalisation-urbaine-integree",
    url: "https://www.donneesquebec.ca/recherche/dataset/2f0d5aeb-2c98-4584-82e2-a8df8e87c047/resource/26c8c117-e757-4652-a763-14a4ca9aa3a5/download/sad-secteur-revitalisation-urbaine-integree-rui.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-unites-paysageres",
    datasetId: "qc-zonage-laval-sad-unites-paysageres",
    title: "Unités paysagères du territoire — Ville de Laval",
    description: "Polygones des unités paysagères du territoire au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-unites-paysageres-du-territoire",
    url: "https://www.donneesquebec.ca/recherche/dataset/399d9376-2cfd-43a1-9483-9ea583e75130/resource/7e18432a-c741-47d6-a110-b6abc30c1b41/download/sad-unitees-paysagere-du-territoire.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-zones-amenagement-ecologique-particuliere",
    datasetId: "qc-zonage-laval-sad-zones-amenagement-ecologique-particuliere",
    title: "Zones d'aménagement écologique particulière — Ville de Laval",
    description: "Polygones des zones d'aménagement écologique particulière au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-des-zones-d-amenagement-ecologique-particuliere",
    url: "https://www.donneesquebec.ca/recherche/dataset/24074e8a-cf7a-4cf5-abc2-dadd2b949636/resource/49b1f388-0484-40f0-8253-6ab932905d14/download/sad-zone-amenagement-ecologique-particuliere-zaep.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-poles-commerciaux",
    datasetId: "qc-zonage-laval-sad-poles-commerciaux",
    title: "Pôles commerciaux — Ville de Laval",
    description: "Polygones des pôles commerciaux au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "delimitation-graphique-des-poles-commerciaux",
    url: "https://www.donneesquebec.ca/recherche/dataset/fc9bf7ae-1473-4552-a146-5f2aeaad7868/resource/f9ce0d2f-821a-4be3-8d2c-72c8a9d7290e/download/sad-pole-commerciaux.geojson",
  },
  {
    sourceId: "ca-qc/zonage-laval-sad-milieux-humides",
    datasetId: "qc-zonage-laval-sad-milieux-humides",
    title: "Milieux humides illustrés — Ville de Laval",
    description: "Polygones des milieux humides illustrés au schéma d'aménagement de Laval.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "localisation-des-milieux-humides-illustres",
    url: "https://www.donneesquebec.ca/recherche/dataset/cf3a5973-1216-44e2-84dc-5578f53fdef2/resource/e01e4495-d020-464a-8ad0-17331f499331/download/sad-milieux-humides.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-rui",
    datasetId: "qc-zonage-montreal-rui",
    title: "Zones de revitalisation urbaine intégrée — Ville de Montréal",
    description: "Polygones des zones de revitalisation urbaine intégrée de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-rui",
    url: "https://donnees.montreal.ca/fr/dataset/065c9cf6-eeb8-44d0-8d50-4dff23e16198/resource/52ca1f00-da98-432c-ab1d-9fea80e2757d/download/rui2014.json",
  },
  {
    sourceId: "ca-qc/zonage-mtmd-zpegt-carte-contrainte-surface",
    datasetId: "qc-zonage-mtmd-zpegt-carte-contrainte-surface",
    title: "Zones potentiellement exposées aux glissements de terrain — MTMD Québec",
    description: "Polygones surfaciques de la carte de contrainte des zones potentiellement exposées aux glissements de terrain.",
    providerName: "Ministère des Transports et de la Mobilité durable",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "zone-potentiellement-exposee-aux-glissements-de-terrain-zpegt",
    url: "https://ws.mapserver.transports.gouv.qc.ca/swtq?service=WFS&version=2.0.0&request=GetFeature&typename=ms:zpegt_cgt_s&outfile=ZPEGT_s&srsname=EPSG:4326&outputformat=geojson",
  },

  {
    sourceId: "ca-qc/zonage-laval-sad-corridors-acces",
    datasetId: "qc-zonage-laval-sad-corridors-acces",
    title: "Corridors routiers d'accès — Ville de Laval",
    description: "Polygones des corridors routiers d'accès de Laval au schéma d'aménagement.",
    providerName: "Ville de Laval",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "representation-graphique-des-corridors-routiers-d-acces-de-laval",
    url: "https://www.donneesquebec.ca/recherche/dataset/0c59e52f-6ba8-40f2-965c-93a5e4545cfd/resource/3e9d8395-1067-4a74-bc06-f728114cbf78/download/sad-corridor-d-acces-a-laval.geojson",
  },
  {
    sourceId: "ca-qc/zonage-gatineau-secteurs-boises",
    datasetId: "qc-zonage-gatineau-secteurs-boises",
    title: "Secteurs boisés — Ville de Gatineau",
    description: "Polygones des secteurs boisés publiés par la Ville de Gatineau.",
    providerName: "Ville de Gatineau",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "secteurs-boises",
    url: "https://www.donneesquebec.ca/recherche/dataset/8a2899f6-3268-4dc7-8829-4faafbdf57b7/resource/a043a4af-3467-425b-9b0b-ef78172c3649/download/secteur_boise.json",
  },
  {
    sourceId: "ca-qc/zonage-mcc-immeubles-classes-terrains-proteges",
    datasetId: "qc-zonage-mcc-immeubles-classes-terrains-proteges",
    title: "Terrains protégés d'immeubles patrimoniaux classés — MCC Québec",
    description: "Polygones des terrains protégés associés aux immeubles patrimoniaux classés par la ministre de la Culture et des Communications.",
    providerName: "Ministère de la Culture et des Communications du Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "immeubles-patrimoniaux-classes-par-la-ministre-de-la-culture-et-des-communications",
    url: "https://www.donneesquebec.ca/recherche/dataset/33a72ee0-4af3-4d76-8a13-0338e10cdaeb/resource/a82a8015-d06a-45bc-bedc-7e03399f71a8/download/terrains_protege_pg.geojson",
  },
  {
    sourceId: "ca-qc/zonage-mcc-immeubles-classes-aires-protection",
    datasetId: "qc-zonage-mcc-immeubles-classes-aires-protection",
    title: "Aires de protection d'immeubles patrimoniaux classés — MCC Québec",
    description: "Polygones des aires de protection associées aux immeubles patrimoniaux classés par la ministre de la Culture et des Communications.",
    providerName: "Ministère de la Culture et des Communications du Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "immeubles-patrimoniaux-classes-par-la-ministre-de-la-culture-et-des-communications",
    url: "https://www.donneesquebec.ca/recherche/dataset/33a72ee0-4af3-4d76-8a13-0338e10cdaeb/resource/614a4251-0006-45b6-b98d-8f9afbe26c2e/download/aires_protection_pg.geojson",
  },
  {
    sourceId: "ca-qc/zonage-mcc-sites-classes-perimetres",
    datasetId: "qc-zonage-mcc-sites-classes-perimetres",
    title: "Sites patrimoniaux classés, périmètres — MCC Québec",
    description: "Polygones des périmètres des sites patrimoniaux classés par la ministre de la Culture et des Communications.",
    providerName: "Ministère de la Culture et des Communications du Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "sites-patrimoniaux-classes-par-la-ministre-de-la-culture-et-des-communications",
    url: "https://www.donneesquebec.ca/recherche/dataset/578d182d-4897-4c11-aa7f-ee0cfed222a0/resource/5abd7e57-bfeb-49ba-a76c-93d961ae0633/download/sites_classes_pg.geojson",
  },
  {
    sourceId: "ca-qc/zonage-mcc-sites-declares-perimetres",
    datasetId: "qc-zonage-mcc-sites-declares-perimetres",
    title: "Sites patrimoniaux déclarés, périmètres — MCC Québec",
    description: "Polygones des périmètres des sites patrimoniaux déclarés par le gouvernement du Québec.",
    providerName: "Ministère de la Culture et des Communications du Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "sites-patrimoniaux-declares-par-le-gouvernement-du-quebec",
    url: "https://www.donneesquebec.ca/recherche/dataset/b35078ae-f1a6-4f9a-a9d2-b00244ae1e84/resource/059897d4-f927-4c30-b345-bf6810f2d00f/download/sites_declares_pg.geojson",
  },
  {
    sourceId: "ca-qc/zonage-trois-rivieres-ilot-destructure",
    datasetId: "qc-zonage-trois-rivieres-ilot-destructure",
    title: "Îlot déstructuré — Ville de Trois-Rivières",
    description: "Polygones des îlots déstructurés publiés par la Ville de Trois-Rivières.",
    providerName: "Ville de Trois-Rivières",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "ilot-destructure-v3r",
    url: "https://www.donneesquebec.ca/recherche/dataset/196b87db-32ad-4b9c-bf72-a3b9f5e9f5c3/resource/9cb3d003-52ee-4af0-bdf9-70917d57d132/download/ilot-destructure-v3r.json",
  },

  {
    sourceId: "ca-qc/zonage-shawinigan-batiments-patrimoniaux",
    datasetId: "qc-zonage-shawinigan-batiments-patrimoniaux",
    title: "Bâtiments patrimoniaux — Ville de Shawinigan",
    description: "Polygones des bâtiments patrimoniaux publiés par la Ville de Shawinigan.",
    providerName: "Ville de Shawinigan",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "shawi-batiment-patrimonial",
    url: "https://cartes.shawinigan.ca/server/rest/services/B%C3%A2timents_patrimoniaux/FeatureServer/0/query?where=1=1&outFields=*&returnGeometry=true&f=geojson",
  },
  {
    sourceId: "ca-qc/zonage-trois-rivieres-fiche-patrimoniale",
    datasetId: "qc-zonage-trois-rivieres-fiche-patrimoniale",
    title: "Fiche patrimoniale — Ville de Trois-Rivières",
    description: "Polygones des fiches patrimoniales publiées par la Ville de Trois-Rivières.",
    providerName: "Ville de Trois-Rivières",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "fiche-patrimoniale-v3r",
    url: "https://www.donneesquebec.ca/recherche/dataset/f0c37551-c07c-4a18-a42c-7d37ca7da317/resource/05f2d670-372b-41a0-9b87-2b1adb79f9b5/download/fiche-patrimoniale-v3r.json",
  },
  {
    sourceId: "ca-qc/zonage-trois-rivieres-premier-quartier",
    datasetId: "qc-zonage-trois-rivieres-premier-quartier",
    title: "Premier quartier — Ville de Trois-Rivières",
    description: "Polygones du premier quartier publiés par la Ville de Trois-Rivières.",
    providerName: "Ville de Trois-Rivières",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "premier-quartier-v3r",
    url: "https://www.donneesquebec.ca/recherche/dataset/d37e99a6-1be4-4953-bcbb-27be87d45d3b/resource/f4997998-a6a9-47ba-bd18-03cbb05a1b65/download/premier-quartier-v3r.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-patrimoine-secteurs-valeur",
    datasetId: "qc-zonage-montreal-schema-patrimoine-secteurs-valeur",
    title: "Schéma - Secteurs de valeur patrimoniale — Ville de Montréal",
    description: "Polygones des secteurs de valeur patrimoniale au schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-patrimoine-paysage",
    url: "https://donnees.montreal.ca/fr/dataset/1f927d2e-d5b3-4bb6-b521-94b3ce4525b8/resource/0b0f4f89-1fad-44bf-aac6-a8f8c5a26f86/download/secteurvaleurpatrimoniale.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-patrimoine-noyaux-villageois",
    datasetId: "qc-zonage-montreal-schema-patrimoine-noyaux-villageois",
    title: "Schéma - Noyaux villageois — Ville de Montréal",
    description: "Polygones des noyaux villageois au schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-patrimoine-paysage",
    url: "https://donnees.montreal.ca/fr/dataset/1f927d2e-d5b3-4bb6-b521-94b3ce4525b8/resource/91330324-5f08-4d3d-814e-6943a5165f10/download/noyauxvillageois.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-environnement-index-plaines-inondables",
    datasetId: "qc-zonage-montreal-schema-environnement-index-plaines-inondables",
    title: "Schéma - Index des plaines inondables — Ville de Montréal",
    description: "Polygones de l'index des plaines inondables au schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-environnement-milieux-naturels",
    url: "https://donnees.montreal.ca/fr/dataset/e668ac49-2403-4c91-a61f-09d249da26ac/resource/e90198d4-18bf-4f0a-93e2-ff5854b09071/download/indexplaineinondable.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-environnement-ilots-chaleur",
    datasetId: "qc-zonage-montreal-schema-environnement-ilots-chaleur",
    title: "Schéma - Îlots de chaleur — Ville de Montréal",
    description: "Polygones des îlots de chaleur au schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-environnement-milieux-naturels",
    url: "https://donnees.montreal.ca/fr/dataset/e668ac49-2403-4c91-a61f-09d249da26ac/resource/8cd8d34a-cfdd-4acf-a363-d4adaeff18c0/download/ilotschaleur.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-schema-environnement-bois-corridors",
    datasetId: "qc-zonage-montreal-schema-environnement-bois-corridors",
    title: "Schéma - Bois et corridors forestiers métropolitains — Ville de Montréal",
    description: "Polygones des bois et corridors forestiers métropolitains au schéma d'aménagement de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-schema-environnement-milieux-naturels",
    url: "https://donnees.montreal.ca/fr/dataset/e668ac49-2403-4c91-a61f-09d249da26ac/resource/df6f3078-97d5-47c8-923e-3200bf1bbab7/download/boiscorridorforestier.json",
  },
  {
    sourceId: "ca-qc/zonage-montreal-vulnerabilite-crues-2022",
    datasetId: "qc-zonage-montreal-vulnerabilite-crues-2022",
    title: "Vulnérabilité aux crues 2022 — Ville de Montréal",
    description: "Polygones simplifiés de vulnérabilité aux crues publiés par la Ville de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-vulnerabilite-changements-climatiques",
    url: "https://donnees.montreal.ca/fr/dataset/3603f75a-1963-4130-9fc5-ab3e7272211a/resource/01afc867-11f2-4a3b-b77e-d5e9ee853c87/download/vulnerabilite-crues-polygones-simplifies-2022.geojson",
  },
  {
    sourceId: "ca-qc/zonage-montreal-cuvettes-retention-ruissellement-2021",
    datasetId: "qc-zonage-montreal-cuvettes-retention-ruissellement-2021",
    title: "Cuvettes de rétention du ruissellement 2021 — Ville de Montréal",
    description: "Polygones simplifiés des cuvettes de rétention de l'eau de ruissellement publiés par la Ville de Montréal.",
    providerName: "Ville de Montréal",
    providerUrl: "https://donnees.montreal.ca",
    packageId: "vmtl-cuvettes-retention-eau-ruissellement",
    url: "https://donnees.montreal.ca/fr/dataset/f1341a6b-3741-47d8-9dfd-a8e68e0f88b5/resource/024be1ad-ad83-4a49-a0d9-ad258382f5a5/download/cuvettes-retention-eau-ruissellement-polygones-simplifies-2021.geojson",
  },
  {
    sourceId: "ca-qc/zonage-msp-inondations-2023-municipalites",
    datasetId: "qc-zonage-msp-inondations-2023-municipalites",
    title: "Municipalités touchées par les inondations 2023 — MSP Québec",
    description: "Polygones des municipalités touchées par des événements d'inondations depuis le 14 avril 2023.",
    providerName: "Ministère de la Sécurité publique du Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cartographie-des-inondations-du-printemps-2023",
    url: "https://geoegl.msp.gouv.qc.ca/apis/wss/inondation2023.fcgi?service=wfs&version=1.1.0&request=getfeature&typename=vg_observation_inondation_16avril2023_mun_tout_v&outputformat=geojson&srsName=epsg:4326",
  },
  {
    sourceId: "ca-qc/zonage-msp-inondations-2017-municipalites",
    datasetId: "qc-zonage-msp-inondations-2017-municipalites",
    title: "Municipalités touchées par les inondations 2017 — MSP Québec",
    description: "Polygones cumulatifs des municipalités touchées par les inondations majeures d'avril-mai 2017.",
    providerName: "Ministère de la Sécurité publique du Québec",
    providerUrl: "https://www.donneesquebec.ca",
    packageId: "cartographie-des-inondations-majeures-avril-mai-2017",
    url: "https://geoegl.msp.gouv.qc.ca/apis/wss/complet.fcgi?service=wfs&version=1.1.0&request=getfeature&typename=vg_observation_inondation_23avril2017_mun_tout_v&outputformat=geojson&srsName=epsg:4326",
  },

];

export const SUPPLEMENTAL_ZONAGE_CKAN_MANIFESTS: readonly SourceManifest[] =
  SUPPLEMENTAL_ZONAGE_CKAN_DATASETS.map(supplementalZonageManifest);

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
  ...SUPPLEMENTAL_ZONAGE_CKAN_MANIFESTS,
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
