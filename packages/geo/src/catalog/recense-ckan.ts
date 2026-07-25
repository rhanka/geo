/**
 * Recensement par découverte CKAN (Lot D — cadrage zones+lots §1.4 étape 2).
 *
 * `recenseCkanZonage(cities, opts)` : pour une liste de villes (slug + name),
 * interroge le portail CKAN Données Québec via `searchCkanPackages` +
 * `resolveGeoResources`, puis produit des entrées `GeoSourceInventory` avec :
 *   - `platform: 'ckan'`
 *   - `zonage.availability` selon les ressources trouvées
 *   - `zonage.url` : URL de la première ressource GeoJSON trouvée (ou SHP)
 *   - `lastChecked` : timestamp injecté (hermétique)
 *
 * ## Idempotence
 * La fonction est pure/idempotente : à mêmes paramètres (cities, fetch mock,
 * now mock) → même résultat. Aucun effet de bord.
 *
 * ## Herméticité (ADR-0007)
 * `fetchImpl` et `now` sont injectables. Les tests DOIVENT injecter des mocks
 * — aucun réseau réel n'est autorisé.
 *
 * ## Rapport de couverture
 * `recenseCkanZonage` retourne aussi un `CoverageReport` :
 *   - `total`          : nombre de villes soumises
 *   - `withCkan`       : nombre avec au moins une ressource CKAN trouvée
 *   - `withoutCkan`    : villes sans ressource
 *   - `coverageRatio`  : withCkan / total (0 si total = 0)
 */

import { resolveGeoResources, searchCkanPackages } from "../acquire/ckan.js";
import type { SearchCkanPackagesOptions } from "../acquire/ckan.js";
import type { GeoSourceInventory, ZonageAvailability, ZonageQuality } from "./source-inventory.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Ville minimale requise pour le recensement. */
export interface CityRef {
  /** Slug kebab-case (doit correspondre à `Municipality.slug`). */
  readonly slug: string;
  /**
   * Nom officiel de la ville en français (utilisé comme terme de recherche
   * sur le portail CKAN, ex. `"Longueuil"`, `"Gatineau"`).
   */
  readonly name: string;
}

/** Options pour `recenseCkanZonage`. */
export interface RecenseCkanOptions {
  /**
   * URL de base de l'API CKAN action. Défaut : Données Québec.
   * @default "https://www.donneesquebec.ca/recherche/api/3/action"
   */
  readonly ckanBaseUrl?: string;
  /**
   * Implémentation de `fetch` injectée (hermétique, ADR-0007).
   * Les tests DOIVENT injecter un mock — pas de réseau réel autorisé.
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Horloge injectée (hermétique). Défaut : `() => new Date()`.
   */
  readonly now?: () => Date;
  /**
   * Nombre maximum de packages CKAN retournés par recherche.
   * @default 5
   */
  readonly rows?: number;
}

/** Rapport de couverture CKAN produit par `recenseCkanZonage`. */
export interface CoverageReport {
  /** Nombre total de villes soumises. */
  readonly total: number;
  /** Nombre de villes avec au moins une ressource CKAN trouvée. */
  readonly withCkan: number;
  /** Nombre de villes sans ressource CKAN. */
  readonly withoutCkan: number;
  /** Ratio de couverture (withCkan / total). 0 si total = 0. */
  readonly coverageRatio: number;
  /** Slugs des villes avec ressource CKAN. */
  readonly coveredSlugs: readonly string[];
  /** Slugs des villes sans ressource CKAN. */
  readonly uncoveredSlugs: readonly string[];
}

/** Résultat complet de `recenseCkanZonage`. */
export interface RecenseCkanResult {
  /** Entrées d'inventaire produites (une par ville soumise). */
  readonly inventories: readonly GeoSourceInventory[];
  /** Rapport de couverture agrégé. */
  readonly coverage: CoverageReport;
}

// ── Constante ─────────────────────────────────────────────────────────────────

const DEFAULT_CKAN_BASE = "https://www.donneesquebec.ca/recherche/api/3/action";

// ── Helpers internes ──────────────────────────────────────────────────────────

/**
 * Construit le terme de recherche CKAN pour une ville et la couche zonage.
 * Utilise le nom officiel de la ville (pas le slug).
 */
function buildZonageQuery(cityName: string): string {
  return `zonage ${cityName}`;
}

/**
 * Sélectionne l'URL la plus pertinente parmi les ressources CKAN résolues.
 * Préférence : GeoJSON > SHP > autre. Retourne undefined si aucune ressource.
 */
function pickBestUrl(resources: ReturnType<typeof resolveGeoResources>): string | undefined {
  const geojson = resources.find((r) => r.format === "geojson");
  if (geojson !== undefined) return geojson.url;
  const shp = resources.find((r) => r.format === "shp");
  if (shp !== undefined) return shp.url;
  const first = resources[0];
  return first !== undefined ? first.url : undefined;
}

/**
 * Détermine `availability` selon les ressources CKAN trouvées.
 */
function toAvailability(
  resources: ReturnType<typeof resolveGeoResources>,
): ZonageAvailability {
  if (resources.length === 0) return "unknown";
  return "donnees-quebec";
}

/**
 * Détermine `quality` selon le meilleur format disponible.
 */
function toQuality(resources: ReturnType<typeof resolveGeoResources>): ZonageQuality {
  if (resources.length === 0) return "none";
  if (resources.some((r) => r.format === "geojson")) return "geojson";
  // SHP/GPKG/KML/FGDB = téléchargeable mais pas GeoJSON direct
  return "pdf"; // on abaisse à "pdf" pour les formats non-GeoJSON (nécessite GDAL)
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Recense la disponibilité de la couche zonage sur le portail CKAN Données
 * Québec pour une liste de villes.
 *
 * Pour chaque ville :
 * 1. Recherche via `searchCkanPackages(baseUrl, "zonage <cityName>", opts)`.
 * 2. Résout les ressources géo de chaque package trouvé (`resolveGeoResources`).
 * 3. Produit une entrée `GeoSourceInventory` avec `platform: 'ckan'` et
 *    `lastChecked` fixé au moment du recensement (horloge injectée).
 *
 * ## Idempotence
 * Appels successifs avec les mêmes paramètres (même fetch mock, même horloge)
 * retournent le même résultat. Pas d'état partagé.
 *
 * @param cities - Liste de villes à recenser.
 * @param opts   - Options (baseUrl, fetchImpl, now, rows).
 * @returns Inventaires + rapport de couverture.
 */
export async function recenseCkanZonage(
  cities: readonly CityRef[],
  opts: RecenseCkanOptions = {},
): Promise<RecenseCkanResult> {
  const ckanBaseUrl = opts.ckanBaseUrl ?? DEFAULT_CKAN_BASE;
  const now = opts.now ?? (() => new Date());
  const rows = opts.rows ?? 5;
  const lastChecked = now().toISOString();

  const searchOpts: SearchCkanPackagesOptions =
    opts.fetchImpl !== undefined
      ? { fetchImpl: opts.fetchImpl, rows }
      : { rows };

  const inventories: GeoSourceInventory[] = [];
  const coveredSlugs: string[] = [];
  const uncoveredSlugs: string[] = [];

  for (const city of cities) {
    const query = buildZonageQuery(city.name);

    let resources: ReturnType<typeof resolveGeoResources> = [];

    try {
      const packages = await searchCkanPackages(ckanBaseUrl, query, searchOpts);
      // Résoudre les ressources de tous les packages trouvés
      for (const pkg of packages) {
        const pkgResources = resolveGeoResources(pkg);
        resources = [...resources, ...pkgResources];
      }
    } catch {
      // Erreur réseau / parsing : on classe comme unknown (pas de throw, idempotent)
      resources = [];
    }

    const availability = toAvailability(resources);
    const quality = toQuality(resources);
    const url = pickBestUrl(resources);

    const hasCkan = resources.length > 0;
    if (hasCkan) {
      coveredSlugs.push(city.slug);
    } else {
      uncoveredSlugs.push(city.slug);
    }

    const zonageLayer = url !== undefined
      ? { availability, quality, url }
      : { availability, quality };

    const entry: GeoSourceInventory = {
      citySlug: city.slug,
      zonage: zonageLayer,
      lots: { availability: "unknown", quality: "none" },
      platform: "ckan",
      lastChecked,
      notes: hasCkan
        ? `Recensement CKAN automatique (${lastChecked}). ${resources.length} ressource(s) trouvée(s) via "${query}".`
        : `Recensement CKAN automatique (${lastChecked}). Aucune ressource trouvée via "${query}" sur ${ckanBaseUrl}.`,
    };

    inventories.push(entry);
  }

  const total = cities.length;
  const withCkan = coveredSlugs.length;
  const withoutCkan = uncoveredSlugs.length;

  const coverage: CoverageReport = {
    total,
    withCkan,
    withoutCkan,
    coverageRatio: total === 0 ? 0 : withCkan / total,
    coveredSlugs,
    uncoveredSlugs,
  };

  return { inventories, coverage };
}
