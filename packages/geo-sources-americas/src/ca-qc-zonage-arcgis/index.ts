/**
 * Registre des endpoints ArcGIS REST de zonage municipal du Québec, découverts
 * À L'ÉCHELLE et VÉRIFIÉS LIVE (≠ heuristique slug→domaine ~30-40 %).
 *
 * ## Provenance des données (anti-invention)
 *
 * Les endpoints viennent EXCLUSIVEMENT du harvester live
 * `scripts/ca-qc-zonage-arcgis/harvest.mjs` (voie AGOL) et
 * `scripts/ca-qc-zonage-arcgis/harvest-mamh.mjs` (voie annuaire MAMH). Chaque
 * entrée a été vérifiée en direct au moment de la découverte :
 *   - service ArcGIS répond en `?f=json` (pas d'auth),
 *   - une couche `esriGeometryPolygon`,
 *   - un champ "code de zone" présent (`zoneCodeField`),
 *   - une feature échantillon dont la géométrie (WGS84) tombe DANS le Québec
 *     (test point-in-polygon, anti faux-positifs NB/ON),
 *   - une query 1 feature HTTP 200.
 *
 * AUCUN endpoint n'est fabriqué : `registry.generated.json` est produit par le
 * harvester (champ `verifiedAt` ISO 8601). On NE l'édite PAS à la main.
 *
 * ## Format
 *
 * Le fichier généré est un tableau d'objets :
 *   `{ citySlug, serviceUrl, zoneCodeField, verifiedAt, source, meta }`
 * où `serviceUrl` pointe vers la COUCHE (`…/FeatureServer/N` ou `…/MapServer/N`).
 *
 * `buildQcZonageArcgisManifests()` les convertit en {@link SourceManifest}
 * (`format: "arcgis-rest"`, `layer` = id de couche, `fieldMap.zoneCode` = champ).
 *
 * ## Licence
 *
 * Les données publiées par les villes via ArcGIS Online / serveurs municipaux
 * n'ont PAS de licence uniforme déclarée à la découverte. On marque donc
 * `access: "open"` (endpoints publics, sans auth) et `license: "unknown"` au
 * niveau dataset — à requalifier ville par ville si une licence explicite est
 * trouvée. Pas de réutilisation au-delà de la consultation tant que non qualifié.
 */

import type { SourceManifest, DatasetManifest } from "@sentropic/geo-core";

// Import du JSON généré par le harvester (résolution Node "import attributes").
// Le fichier est ré-écrit à chaque lot d'endpoints vérifiés.
import VERIFIED_ENDPOINTS_JSON from "./registry.generated.json" with { type: "json" };

/** Une entrée d'endpoint ArcGIS zonage QC vérifié live. */
export interface VerifiedArcgisZonageEndpoint {
  /** Slug de ville (best-effort, dérivé du titre/owner/url ou de l'annuaire). */
  readonly citySlug: string;
  /** URL de la COUCHE vérifiée (`…/FeatureServer/N` ou `…/MapServer/N`). */
  readonly serviceUrl: string;
  /** Champ "code de zone" détecté (ou null si non déterminé). */
  readonly zoneCodeField: string | null;
  /** Horodatage ISO 8601 de la vérification live. */
  readonly verifiedAt: string;
  /** Voie de découverte : "agol-search" | "mamh-domain-probe" ou lot manuel qualifié. */
  readonly source: string;
  /** Licence qualifiée manuellement quand l'item ArcGIS la déclare explicitement. */
  readonly license?: SourceManifest["license"];
  /** Profil API si la licence reste à qualifier mais que la source officielle est publique. */
  readonly rightsProfile?: SourceManifest["rightsProfile"];
  /** Métadonnées de découverte (titre, owner, couche, type géométrie). */
  readonly meta?: {
    readonly title?: string;
    readonly owner?: string;
    readonly layerName?: string;
    readonly geometryType?: string;
    readonly website?: string;
  };
}

/**
 * Tableau des endpoints ArcGIS zonage QC vérifiés live.
 * Source de vérité : `registry.generated.json` (produit par le harvester).
 */
export const QC_ZONAGE_ARCGIS_ENDPOINTS: readonly VerifiedArcgisZonageEndpoint[] =
  VERIFIED_ENDPOINTS_JSON as readonly VerifiedArcgisZonageEndpoint[];


/**
 * Endpoints ArcGIS supplémentaires vérifiés manuellement pendant l'épuisement
 * des sources municipales. Ils restent séparés du registre généré pour ne pas
 * polluer `registry.generated.json`, qui demeure la sortie du harvester.
 */
export const SUPPLEMENTAL_ZONAGE_ARCGIS_ENDPOINTS: readonly VerifiedArcgisZonageEndpoint[] = [
  {
    citySlug: "disraeli",
    serviceUrl: "https://services5.arcgis.com/uAjEWTv7FeJttOAH/arcgis/rest/services/Carte_interactive_Disraeli/FeatureServer/2",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    meta: {
      title: "Zonage",
      owner: "Ville de Disraeli",
      layerName: "Zonage",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "disraeli-affectation-sol",
    serviceUrl: "https://services5.arcgis.com/uAjEWTv7FeJttOAH/arcgis/rest/services/Carte_interactive_Disraeli/FeatureServer/3",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    meta: {
      title: "Affectation du sol",
      owner: "Ville de Disraeli",
      layerName: "Affectation du sol",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "quebec-zonage-en-vigueur",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/2",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Zonage en vigueur",
      owner: "Ville de Québec",
      layerName: "Zonage en vigueur",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "quebec-affectation-territoire",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/39",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Grande affectation du territoire",
      owner: "Ville de Québec",
      layerName: "Grande affectation du territoire",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "quebec-perimetre-urbanisation",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/12",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    meta: {
      title: "Territoire à l'intérieur du périmètre d'urbanisation",
      owner: "Ville de Québec",
      layerName: "Territoire à l'intérieur du périmètre d'urbanisation",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "quebec-ppu",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/54",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    meta: {
      title: "Programme particulier d'urbanisme",
      owner: "Ville de Québec",
      layerName: "Programme particulier d'urbanisme",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "rimouski-piia",
    serviceUrl: "https://services1.arcgis.com/ZesQmh5DOw9rl0RN/arcgis/rest/services/Patrimoine_PIIA/FeatureServer/5",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Plan d'implantation et d'intégration architecturale",
      owner: "Ville de Rimouski",
      layerName: "PIIA",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "saint-augustin-piia",
    serviceUrl: "https://services6.arcgis.com/bb3A2FAyAtd6ADTL/arcgis/rest/services/PIIA_en_Vigueur_WFL1/FeatureServer/3",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    meta: {
      title: "PIIA en vigueur",
      owner: "Saint-Augustin-de-Desmaures",
      layerName: "PIIA en vigueur",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "mrc-bellechasse-piia",
    serviceUrl: "https://services6.arcgis.com/DgGbwYJQAY35Ym3n/arcgis/rest/services/i006_piia_en_vigueur_vue/FeatureServer/0",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    meta: {
      title: "PIIA en vigueur",
      owner: "MRC de Bellechasse",
      layerName: "PIIA en vigueur",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "mont-tremblant-piia-vf",
    serviceUrl: "https://services6.arcgis.com/GnhEJPl3z9NGOl6b/arcgis/rest/services/PIIA_VF/FeatureServer/2",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    meta: {
      title: "PIIA",
      owner: "Ville de Mont-Tremblant",
      layerName: "PIIA_VF",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "mrc-pontiac-affectation-agricole",
    serviceUrl: "https://services2.arcgis.com/6zR0qR9VLIPQNvIM/arcgis/rest/services/Règlement_no_227_2016_MRC_de_Pontiac/FeatureServer/5",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    meta: {
      title: "Affectation en milieux agricole",
      owner: "MRC de Pontiac",
      layerName: "Affectation en milieux agricole",
      geometryType: "esriGeometryPolygon",
    },
  },
  {
    citySlug: "sherbrooke-milieux-humides-rci",
    serviceUrl: "https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/Milieux%20humides%20RCI/FeatureServer/0",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Milieux humides RCI",
      owner: "Ville de Sherbrooke",
      layerName: "Milieux humides RCI",
      geometryType: "esriGeometryPolygon",
    },
  },
  // Licence: Données Québec package f47351fc7ecc4c7db8a8b0de4df985d0
  // `license_id=cc-by`, `license_title=Attribution (CC-BY 4.0)`; couche vérifiée polygonale, 227 entités.
  {
    citySlug: "saint-hyacinthe-ilots-densification-vises",
    serviceUrl: "https://arcgis.st-hyacinthe.ca/server/rest/services/Hosted/ISOGEO_DataLink_Features/FeatureServer/4",
    zoneCodeField: "num_zone",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Îlots de densification visés",
      owner: "Ville de Saint-Hyacinthe",
      layerName: "z_vise_all",
      geometryType: "esriGeometryPolygon",
      website: "https://www.donneesquebec.ca/recherche/dataset/f47351fc7ecc4c7db8a8b0de4df985d0",
    },
  },
  // Licence: ArcGIS item 0106919a72f84b29a5fa79f5444adc59
  // `licenseInfo=Creative Commons 4.0 (CC) - Attribution`; couche vérifiée polygonale, 273 entités.
  {
    citySlug: "mrc-beauharnois-salaberry-zone-agricole-transposee",
    serviceUrl: "https://services5.arcgis.com/8TXm0JD0A0eOyxy5/arcgis/rest/services/zone_agricole_transposee_s/FeatureServer/8",
    zoneCodeField: "zonage",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Zone agricole transposée",
      owner: "MRC de Beauharnois-Salaberry",
      layerName: "zone_agricole_transposee_s",
      geometryType: "esriGeometryPolygon",
      website: "https://www.arcgis.com/home/item.html?id=0106919a72f84b29a5fa79f5444adc59",
    },
  },
  // Licence: ArcGIS item da29a494fb324842a92cb61482b71bb2
  // `licenseInfo=Licence Creative Commons Attribution 4.0 International`; couche vérifiée polygonale, 11 entités.
  {
    citySlug: "longueuil-zonage-agricole",
    serviceUrl: "https://services2.arcgis.com/h4XWvDXfYYyD6jNu/arcgis/rest/services/DO_ZonageAgricole/FeatureServer/0",
    zoneCodeField: "TYPE",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Zonage agricole",
      owner: "Ville de Longueuil",
      layerName: "Zonage agricole",
      geometryType: "esriGeometryPolygon",
      website: "https://www.arcgis.com/home/item.html?id=da29a494fb324842a92cb61482b71bb2",
    },
  },
  // Licence: ArcGIS item df185eece9b04f2c897f3b41210d92da
  // `licenseInfo=CC BY`; couche vérifiée polygonale, 212 entités.
  {
    citySlug: "sherbrooke-zones-developpement-urbain",
    serviceUrl: "https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/ZoneDeveloppement/FeatureServer/0",
    zoneCodeField: "TYPE",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Zones de développement urbain",
      owner: "Ville de Sherbrooke",
      layerName: "zone_developpement",
      geometryType: "esriGeometryPolygon",
      website: "https://www.arcgis.com/home/item.html?id=df185eece9b04f2c897f3b41210d92da",
    },
  },
  // Licence: ArcGIS item 19946a7cfa1d435190328072110bf522
  // `licenseInfo=CC BY`; couche vérifiée polygonale, 1 entité.
  {
    citySlug: "sherbrooke-limite-rci-1274-2",
    serviceUrl: "https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/LimiteControleInterimaire1274_2/FeatureServer/0",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Limite du Reglement de controle interimaire n1274-2",
      owner: "Ville de Sherbrooke",
      layerName: "LimiteControleInterimaire1274_2",
      geometryType: "esriGeometryPolygon",
      website: "https://www.arcgis.com/home/item.html?id=19946a7cfa1d435190328072110bf522",
    },
  },
  // Licence: ArcGIS item 83ee438b8b6d47089ceadeaa39a97c0d
  // `licenseInfo=CC BY`; couche vérifiée polygonale, 23 entités.
  {
    citySlug: "sherbrooke-milieux-boises-rci",
    serviceUrl: "https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/Milieux%20boisés%20RCI/FeatureServer/0",
    zoneCodeField: "INFORCI",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Milieux boises RCI",
      owner: "Ville de Sherbrooke",
      layerName: "milieu_boise_rci",
      geometryType: "esriGeometryPolygon",
      website: "https://www.arcgis.com/home/item.html?id=83ee438b8b6d47089ceadeaa39a97c0d",
    },
  },
  // Licence: ArcGIS item e07a8bf719924d6da105e626f2aca7f0
  // `licenseInfo=Creative Commons 4.0 (CC) - Attribution`; couche vérifiée polygonale, 589 entités.
  {
    citySlug: "mrc-beauharnois-salaberry-inclusions-exclusions-cptaq",
    serviceUrl: "https://services5.arcgis.com/8TXm0JD0A0eOyxy5/arcgis/rest/services/incl_excl_s/FeatureServer/11",
    zoneCodeField: "resultat",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Inclusions et exclusions CPTAQ",
      owner: "MRC de Beauharnois-Salaberry",
      layerName: "incl_excl_s",
      geometryType: "esriGeometryPolygon",
      website: "https://www.arcgis.com/home/item.html?id=e07a8bf719924d6da105e626f2aca7f0",
    },
  },
  // Licence: ArcGIS item d330d1a903c144cbaf7fc1c6939aba1f
  // `licenseInfo=Creative Commons 4.0 (CC) - Attribution`; couche vérifiée polygonale, 83 entités.
  {
    citySlug: "mrc-granit-demandes-portee-collective",
    serviceUrl: "https://services6.arcgis.com/qVhfI6UTbRNL5Gfd/arcgis/rest/services/demandes_portee_collective_s/FeatureServer/106",
    zoneCodeField: "numero",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Demandes a portee collective",
      owner: "MRC du Granit",
      layerName: "demandes_portee_collective_s",
      geometryType: "esriGeometryPolygon",
      website: "https://www.arcgis.com/home/item.html?id=d330d1a903c144cbaf7fc1c6939aba1f",
    },
  },
  // Licence: Donnees Quebec package `base-de-donnees-des-zones-inondables`,
  // `license_id=cc-by`; couche polygonale MELCCFP, 621 entites.
  {
    citySlug: "melccfp-bdzi-zones-inondables",
    serviceUrl: "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/22",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Base de donnees des zones a risque d'inondation",
      owner: "MELCCFP",
      layerName: "Zones inondables",
      geometryType: "esriGeometryPolygon",
      website: "https://www.donneesquebec.ca/recherche/dataset/base-de-donnees-des-zones-inondables",
    },
  },
  // Licence: Donnees Quebec package `delimitation-du-perimetre-de-la-zone-d-intervention-speciale-zis-annexe2-modifie`,
  // `license_id=cc-by`; couche polygonale historique ZIS, 142 entites.
  {
    citySlug: "melccfp-zis-annexe2-modifiee",
    serviceUrl: "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/ZIS_Annexe2_modifiee/MapServer/0",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Zone d'intervention speciale 2017-2019, annexe 2 modifiee",
      owner: "MELCCFP",
      layerName: "ZIS Annexe 2 modifiee",
      geometryType: "esriGeometryPolygon",
      website: "https://www.donneesquebec.ca/recherche/dataset/delimitation-du-perimetre-de-la-zone-d-intervention-speciale-zis-annexe2-modifie",
    },
  },
  // Licence: Donnees Quebec package `zis-annexe2-arrete-30dec2019`,
  // `license_id=cc-by`; couche polygonale, 8 entites.
  {
    citySlug: "melccfp-zis-arrete-2019-exclusions",
    serviceUrl: "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/ZIS_Annexe2_arrete_30dec2019/MapServer/0",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-supplemental-arcgis",
    license: "cc-by-4.0",
    meta: {
      title: "Territoires soustraits a l'application de la ZIS",
      owner: "MELCCFP",
      layerName: "ZIS Annexe 2 arrete 30 decembre 2019",
      geometryType: "esriGeometryPolygon",
      website: "https://www.donneesquebec.ca/recherche/dataset/zis-annexe2-arrete-30dec2019",
    },
  },

  {
    citySlug: "quebec-moratoire-effet-gel",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/4",
    zoneCodeField: "ZONE",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Moratoire / effet de gel", owner: "Ville de Québec", layerName: "Moratoire / effet de gel", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-zone-inondable-reglementee",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/14",
    zoneCodeField: "NO_REGLEMENT_SCHEMA",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Zone inondable réglementée", owner: "Ville de Québec", layerName: "Zone inondable réglementée", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-forte-pente",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/20",
    zoneCodeField: "NO_REGLEMENT_SCHEMA",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Secteur potentiel à forte pente", owner: "Ville de Québec", layerName: "Secteur potentiel à forte pente", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-karst",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/22",
    zoneCodeField: "NO_REGLEMENT_SCHEMA",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Secteur à potentiel karstique", owner: "Ville de Québec", layerName: "Secteur à potentiel karstique", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-zone-agricole",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/30",
    zoneCodeField: "NO_REGLEMENT_CPTAQ",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Zone agricole", owner: "Ville de Québec", layerName: "Zone agricole", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-milieux-humides-interet",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/37",
    zoneCodeField: "MILIEU_HUMIDE_INT",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Milieux humides d'intérêt", owner: "Ville de Québec", layerName: "Milieux humides d'intérêt", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-zone-influence-mhi",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/45",
    zoneCodeField: "STATUT_CODE",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Zone d'influence des milieux humides d'intérêt", owner: "Ville de Québec", layerName: "Zone d'influence des MHI", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-commission-urbanisme",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/50",
    zoneCodeField: "DENOMINATION",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Commission d'urbanisme", owner: "Ville de Québec", layerName: "Commission d'urbanisme", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-vision-amenagement",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/55",
    zoneCodeField: "CODE_AFFECTATION",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Vision d'aménagement", owner: "Ville de Québec", layerName: "Vision d'aménagement", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-sites-patrimoniaux-declares",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/56",
    zoneCodeField: "CODE_AFFECTATION",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Sites patrimoniaux déclarés", owner: "Ville de Québec", layerName: "Sites patrimoniaux déclarés", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-proprietes-conventuelles",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_AMENAGEMENT_ENVIRONNEMENT/FeatureServer/57",
    zoneCodeField: "CODE_AFFECTATION",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Propriétés conventuelles", owner: "Ville de Québec", layerName: "Propriétés conventuelles", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-patrimoine-batiment-etudie",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_COMMUNAUTE_CULTURE_PATRIMOINE/FeatureServer/11",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Bâtiment étudié", owner: "Ville de Québec", layerName: "Bâtiment étudié", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-immeuble-cite",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_COMMUNAUTE_CULTURE_PATRIMOINE/FeatureServer/5",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Immeuble cité municipal", owner: "Ville de Québec", layerName: "Immeuble cité municipal", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-immeuble-classe",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_COMMUNAUTE_CULTURE_PATRIMOINE/FeatureServer/6",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Immeuble classé provincial", owner: "Ville de Québec", layerName: "Immeuble classé provincial", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-site-patrimonial-cite",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_COMMUNAUTE_CULTURE_PATRIMOINE/FeatureServer/8",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Site patrimonial cité municipal", owner: "Ville de Québec", layerName: "Site patrimonial cité municipal", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-site-patrimonial-classe",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_COMMUNAUTE_CULTURE_PATRIMOINE/FeatureServer/9",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Site patrimonial déclaré/classé provincial", owner: "Ville de Québec", layerName: "Site patrimonial déclaré/classé provincial", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "quebec-aire-protection-patrimoine",
    serviceUrl: "https://services1.arcgis.com/4GCvRJNX6LNyFVQ0/arcgis/rest/services/CI_COMMUNAUTE_CULTURE_PATRIMOINE/FeatureServer/10",
    zoneCodeField: null,
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "Aire de protection patrimoniale", owner: "Ville de Québec", layerName: "Aire de protection patrimoniale", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "saint-augustin-milieu-humide-interet",
    serviceUrl: "https://services6.arcgis.com/bb3A2FAyAtd6ADTL/arcgis/rest/services/PU25_VSAD_MHdInt%C3%A9r%C3%AAt_WFL1/FeatureServer/0",
    zoneCodeField: "CAT_A",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "PU25 - Milieu humide d'intérêt", owner: "Saint-Augustin-de-Desmaures", layerName: "Milieu humide d'intérêt", geometryType: "esriGeometryPolygon" },
  },
  {
    citySlug: "saint-augustin-affectations-2025",
    serviceUrl: "https://services6.arcgis.com/bb3A2FAyAtd6ADTL/arcgis/rest/services/PU25_VSAD_MHdInt%C3%A9r%C3%AAt_WFL1/FeatureServer/7",
    zoneCodeField: "Affect_VSAD",
    verifiedAt: "2026-06-18T00:00:00.000Z",
    source: "manual-demo-unverified-arcgis",
    rightsProfile: "demo-unverified",
    meta: { title: "PU25 - Affectations 2025", owner: "Saint-Augustin-de-Desmaures", layerName: "Affectations 2025", geometryType: "esriGeometryPolygon" },
  },

];

/** Sépare une URL de couche `…/Server/N` en `{ serviceUrl, layer }`. */
function splitLayerUrl(layerUrl: string): { serviceUrl: string; layer: number } {
  const m = layerUrl.match(/^(.*\/(?:Feature|Map)Server)\/(\d+)$/i);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    return { serviceUrl: m[1], layer: Number(m[2]) };
  }
  return { serviceUrl: layerUrl, layer: 0 };
}

/**
 * Convertit les endpoints vérifiés en {@link SourceManifest} (`arcgis-rest`).
 * Un manifest par endpoint ; `id` = `ca-qc/zonage-arcgis-<citySlug>[-N]`.
 */
export function buildQcZonageArcgisManifests(
  endpoints: readonly VerifiedArcgisZonageEndpoint[] = QC_ZONAGE_ARCGIS_ENDPOINTS,
): SourceManifest[] {
  const seenIds = new Map<string, number>();
  return endpoints.map((ep) => {
    const { serviceUrl, layer } = splitLayerUrl(ep.serviceUrl);
    // id unique même si plusieurs couches pour une même ville
    const baseId = `ca-qc/zonage-arcgis-${ep.citySlug}`;
    const n = seenIds.get(baseId) ?? 0;
    seenIds.set(baseId, n + 1);
    const id = n === 0 ? baseId : `${baseId}-${n + 1}`;

    const dataset: DatasetManifest = {
      id: `qc-zonage-arcgis-${ep.citySlug}${n === 0 ? "" : `-${n + 1}`}`,
      title: `Zonage — ${ep.meta?.owner ?? ep.citySlug} (ArcGIS REST, vérifié live)`,
      description:
        `Polygones de zonage via ArcGIS REST FeatureServer/MapServer. ` +
        `Couche ${layer} (${ep.meta?.layerName ?? "?"}). ` +
        `Champ code de zone : ${ep.zoneCodeField ?? "auto"}. ` +
        `Découvert par ${ep.source}, vérifié live ${ep.verifiedAt}.`,
      format: "arcgis-rest",
      url: serviceUrl,
      layer,
      crs: "EPSG:4326",
      query: { where: "1=1", outFields: "*", f: "geojson" },
      // Le champ "code de zone" alimente le champ standard `code` du FieldMap.
      ...(ep.zoneCodeField ? { fieldMap: { code: ep.zoneCodeField } } : {}),
      updateCadence: "P1Y",
      access: "open",
    };

    return {
      id,
      title: `Zonage ArcGIS — ${ep.meta?.owner ?? ep.citySlug}`,
      description:
        `Endpoint ArcGIS REST de zonage municipal vérifié live (${ep.source}). ` +
        (ep.license
          ? `Licence qualifiée manuellement depuis les métadonnées ArcGIS.`
          : `Licence non qualifiée à la découverte; source officielle publique servie en demo-unverified.`),
      kind: "administrative",
      jurisdiction: { country: "CA", subdivision: "CA-QC" },
      provider: {
        name: ep.meta?.owner ?? ep.citySlug,
        ...(ep.meta?.website ? { url: ep.meta.website } : {}),
      },
      // pas de licence uniforme déclarée -> `unknown`; le profil API rend le statut explicite.
      license: ep.license ?? "unknown",
      rightsProfile: ep.rightsProfile ?? (ep.license ? "open" : "demo-unverified"),
      datasets: [dataset],
    } satisfies SourceManifest;
  });
}

/**
 * Manifests prêts à câbler dans le registre geo (un par endpoint vérifié).
 * Recalculé à l'import depuis `registry.generated.json`.
 */
export const QC_ZONAGE_ARCGIS_MANIFESTS: readonly SourceManifest[] = [
  ...buildQcZonageArcgisManifests(),
  ...buildQcZonageArcgisManifests(SUPPLEMENTAL_ZONAGE_ARCGIS_ENDPOINTS),
];

/** Nombre d'endpoints vérifiés actuellement dans le registre. */
export const QC_ZONAGE_ARCGIS_COUNT = QC_ZONAGE_ARCGIS_ENDPOINTS.length;
