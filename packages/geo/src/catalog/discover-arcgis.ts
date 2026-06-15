/**
 * Recensement rejouable des services ArcGIS REST de zonage municipal.
 *
 * Migré depuis radar-immobilier `arcgis-discovery.ts` (P1-B) et adapté pour
 * produire des entrées {@link GeoSourceInventory} (`platform: 'arcgis'`).
 *
 * ## Principe de détection
 *
 * Pour chaque ville, on sonde des patterns d'URL signature ArcGIS REST :
 *   1. **Serveur municipal** : `https://<domaine_ville>/arcgis/rest/services`
 *      ou `https://<domaine_ville>/server/rest/services`
 *      puis filtrage des services contenant `Zonage/Zoning/zone` dans leur nom.
 *
 * Les domaines sont dérivés heuristiquement depuis le slug de ville
 * (ex. `sig.<slug>.ca`, `cartes.<slug>.ca`, `ville.<slug>.qc.ca`).
 *
 * ## Robots / politesse
 *
 * - Un timeout strict (défaut : 8 s) par requête → pas de blocage.
 * - User-Agent honnête (`sentropic-geo/0.1`).
 * - Pas de retentative sur 403/404 (non-scrapable → résultat `not-found`).
 * - Pas de scan agressif : on sonde 1-2 URLs par ville, pas de force-browse.
 * - Outil OFFLINE (non inclus dans CI) ; il tourne à la demande.
 *
 * ## Idempotence
 *
 * `discoverArcgisZonageServices()` accepte un registre existant en entrée.
 * Elle ne rescanne PAS les villes déjà dans le registre (sauf `force=true`).
 * Elle produit un rapport de couverture en sortie.
 *
 * ## Limitation connue (~30–40 % de couverture)
 *
 * La détection repose sur un annuaire de domaines municipaux dérivé des slugs
 * (pattern `https://sig.<slug>.ca` ou `https://gis.<slug>.ca` etc.). Sans
 * annuaire MAMH des sites municipaux, la couverture reste partielle (~30–40 %
 * des villes). Un recensement complet nécessite un annuaire fiable des URLs
 * officielles des villes (ex. Wikidata P856, annuaire MAMH, saisie manuelle).
 * Ce manque est le vrai goulot d'étranglement du recensement automatisé.
 *
 * ## Herméticité (ADR-0007)
 *
 * `fetchImpl` et `now` sont injectables. Les tests DOIVENT injecter des mocks.
 * Aucun réseau réel n'est autorisé en CI.
 *
 * ## Sortie
 *
 * `discoverArcgisZonageServices` retourne :
 *   - `inventories`  : entrées {@link GeoSourceInventory} produites (une par
 *     ville `found`, les skipped/not-found/error ne génèrent PAS d'entrée).
 *   - `coverage`     : rapport agrégé (found / notFound / errors / skipped).
 *
 * Adapté depuis immo `arcgis-discovery.ts` :
 *   - Porté    : logique heuristique slug→domaines, sonde `?f=json`, filtre
 *     services zonage, résolution couche, idempotence, timeout, rapport.
 *   - Adapté   : retourne des `GeoSourceInventory` (pas un `ArcgisDiscoveryReport`
 *     immo) ; User-Agent `sentropic-geo/0.1` ; `fetchImpl: typeof fetch` ;
 *     `domainGuesser` injectable ; suppression `reportToRegistryEntries` et
 *     classe `ArcgisDiscovery` (non utiles ici).
 *   - Laissé   : `arcgis-service-registry.ts` immo (registre vérifié live côté
 *     immo, pas migré — il est la source de vérité immo jusqu'à sa suppression).
 */

import type { GeoSourceInventory } from "./source-inventory.js";

// ── Constantes ─────────────────────────────────────────────────────────────────

/** Version du recenseur (miroir du schéma semver). */
export const ARCGIS_DISCOVERY_VERSION = "0.1.0";

/** User-Agent honnête par convention du repo (ADR-0007 / Scraping Policy). */
const GEO_USER_AGENT = "sentropic-geo/0.1";

/** Timeout par requête (court pour ne pas bloquer le recensement). */
export const ARCGIS_DISCOVERY_TIMEOUT_MS = 8_000;

/**
 * Patterns de noms de service ArcGIS REST associés au zonage.
 * Utilisés pour filtrer les services dans le catalogue d'un serveur ArcGIS.
 */
export const ARCGIS_ZONAGE_SERVICE_NAME_PATTERNS: readonly RegExp[] = [
  /zonage/i,
  /zoning/i,
  /zone_municipal/i,
  /plan_urban/i,
  /urbanisme/i,
  /affectation/i,
];

/**
 * Patterns de noms de couches (layers) ArcGIS pour le zonage.
 * Utilisés pour identifier la bonne couche dans un MapServer/FeatureServer.
 */
export const ARCGIS_ZONAGE_LAYER_NAME_PATTERNS: readonly RegExp[] = [
  /zonage/i,
  /zone/i,
  /zoning/i,
];

/**
 * Suffixes d'URL courants pour les serveurs ArcGIS municipaux QC.
 * Ordonnés par probabilité (le plus commun en premier).
 */
export const ARCGIS_SERVER_URL_PATTERNS = [
  "/arcgis/rest/services",
  "/server/rest/services",
  "/gis/rest/services",
  "/sig/rest/services",
] as const;

// ── Types publics ──────────────────────────────────────────────────────────────

/** Statut de la détection pour une ville. */
export type ArcgisDiscoveryStatus = "found" | "not-found" | "error" | "skipped";

/** Rapport de couverture produit par `discoverArcgisZonageServices`. */
export interface ArcgisZonageCoverage {
  /** Nombre total de villes soumises. */
  readonly totalCities: number;
  /** Nombre de villes pour lesquelles un service de zonage a été trouvé. */
  readonly found: number;
  /** Nombre de villes sondées sans résultat. */
  readonly notFound: number;
  /** Nombre de villes en erreur réseau/timeout. */
  readonly errors: number;
  /** Nombre de villes ignorées (déjà dans le registre, idempotence). */
  readonly skipped: number;
  /** Ratio de couverture parmi les villes non-ignorées (found / (found + notFound + errors)). */
  readonly coverageRatio: number;
  /** ISO 8601 timestamp de génération. */
  readonly generatedAt: string;
}

/** Options pour `discoverArcgisZonageServices`. */
export interface DiscoverArcgisOptions {
  /**
   * Registre existant (pour idempotence).
   * Les villes dont le `citySlug` est dans ce registre sont ignorées
   * (sauf si `force: true`).
   */
  readonly existingInventories?: ReadonlyArray<{ readonly citySlug: string }>;
  /**
   * Si `true`, rescanne les villes déjà dans le registre.
   * @default false
   */
  readonly force?: boolean;
  /**
   * Implémentation de `fetch` injectée (hermétique, ADR-0007).
   * Tests DOIVENT injecter un mock — aucun réseau réel autorisé.
   * @default globalThis.fetch
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Timeout par requête HTTP en ms.
   * @default ARCGIS_DISCOVERY_TIMEOUT_MS (8 000)
   */
  readonly timeoutMs?: number;
  /**
   * Horloge injectée (hermétique, ADR-0007).
   * @default () => new Date()
   */
  readonly now?: () => Date;
  /**
   * Fonction de mapping slug → domaines candidats.
   * Injectée pour les tests (permet de court-circuiter l'heuristique).
   * @default defaultMunicipalDomainGuesser
   */
  readonly domainGuesser?: (citySlug: string) => readonly string[];
}

/** Résultat complet de `discoverArcgisZonageServices`. */
export interface DiscoverArcgisResult {
  /**
   * Entrées d'inventaire produites.
   * Une entrée est créée UNIQUEMENT pour les villes avec statut `found`.
   * Les villes `not-found`, `error` et `skipped` ne produisent pas d'entrée.
   */
  readonly inventories: readonly GeoSourceInventory[];
  /** Rapport de couverture agrégé. */
  readonly coverage: ArcgisZonageCoverage;
}

// ── Heuristique domaine → URL ──────────────────────────────────────────────────

/**
 * Dérive des domaines municipaux candidats depuis un slug de ville.
 *
 * Heuristiques basées sur l'observation des sites QC :
 *   - `cartes.<slug>.ca`
 *   - `sig.<slug>.ca`
 *   - `gis.<slug>.ca`
 *   - `geomatique.<slug>.ca`
 *   - `www.ville.<slug>.qc.ca`
 *   - `ville.<slug>.qc.ca`
 *
 * **Limitation** : sans annuaire MAMH des URLs officielles, la couverture
 * reste partielle (~30–40 % des villes). C'est le principal goulot
 * d'étranglement du recensement automatisé.
 */
export function defaultMunicipalDomainGuesser(citySlug: string): readonly string[] {
  const base = citySlug.toLowerCase();
  return [
    `https://cartes.${base}.ca`,
    `https://sig.${base}.ca`,
    `https://gis.${base}.ca`,
    `https://geomatique.${base}.ca`,
    `https://www.ville.${base}.qc.ca`,
    `https://ville.${base}.qc.ca`,
  ];
}

// ── Primitives de sondage (internes + exportées pour tests unitaires) ──────────

/** Shape d'un service ArcGIS REST brut (extrait du catalogue). */
interface ArcgisService {
  readonly name: string;
  readonly type: string;
  readonly url: string;
}

/**
 * Sonde un catalogue ArcGIS REST (`?f=json`) et retourne la liste de services.
 * Retourne `null` si l'URL ne répond pas ou ne ressemble pas à un catalogue ArcGIS.
 *
 * @internal Exportée pour faciliter les tests unitaires.
 */
export async function probeArcgisCatalog(
  catalogUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ readonly services: readonly ArcgisService[] } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetchImpl(`${catalogUrl}?f=json`, {
        signal: controller.signal,
        headers: {
          "User-Agent": GEO_USER_AGENT,
          "Accept": "application/json",
        },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return null;

    let data: Record<string, unknown>;
    try {
      const text = await res.text();
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }

    // Un catalogue ArcGIS REST valide doit avoir un champ "services"
    const rawServices = data["services"];
    if (!Array.isArray(rawServices)) return null;

    const services: ArcgisService[] = rawServices
      .filter((s): s is Record<string, unknown> => s != null && typeof s === "object")
      .map((s) => ({
        name: String(s["name"] ?? ""),
        type: String(s["type"] ?? ""),
        url: catalogUrl.replace(
          /\/rest\/services.*$/,
          `/rest/services/${String(s["name"] ?? "")}/${String(s["type"] ?? "")}`,
        ),
      }));

    return { services };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Filtre les services ArcGIS REST dont le nom correspond à un pattern de zonage.
 *
 * @internal Exportée pour faciliter les tests unitaires.
 */
export function filterZonageServices(
  services: ReadonlyArray<ArcgisService>,
): readonly ArcgisService[] {
  return services.filter((s) => {
    const nameParts = s.name.split("/");
    const baseName = nameParts[nameParts.length - 1] ?? s.name;
    return ARCGIS_ZONAGE_SERVICE_NAME_PATTERNS.some((p) => p.test(baseName));
  });
}

/**
 * Sonde un service ArcGIS REST pour trouver la couche de zonage.
 * Retourne l'URL de la première couche de zonage (FeatureServer/N ou MapServer/N),
 * ou `null` si aucune couche de zonage n'est trouvée.
 *
 * @internal Exportée pour faciliter les tests unitaires.
 */
export async function resolveZonageLayer(
  serviceUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetchImpl(`${serviceUrl}?f=json`, {
        signal: controller.signal,
        headers: {
          "User-Agent": GEO_USER_AGENT,
          "Accept": "application/json",
        },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return null;

    let data: Record<string, unknown>;
    try {
      const text = await res.text();
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }

    const rawLayers = data["layers"];
    if (!Array.isArray(rawLayers)) {
      // Peut-être déjà une couche directe (FeatureServer/0)
      const geoType = data["geometryType"];
      if (typeof geoType === "string" && geoType.includes("Polygon")) {
        return serviceUrl;
      }
      return null;
    }

    // Chercher la couche de zonage par nom
    for (const layer of rawLayers) {
      if (layer == null || typeof layer !== "object") continue;
      const l = layer as Record<string, unknown>;
      const layerName = String(l["name"] ?? "");
      const layerId = Number(l["id"] ?? 0);

      if (ARCGIS_ZONAGE_LAYER_NAME_PATTERNS.some((p) => p.test(layerName))) {
        return `${serviceUrl}/${layerId}`;
      }
    }

    // Fallback : première couche disponible
    for (const layer of rawLayers) {
      if (layer == null || typeof layer !== "object") continue;
      const l = layer as Record<string, unknown>;
      const layerId = Number(l["id"] ?? 0);
      return `${serviceUrl}/${layerId}`;
    }

    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Sondage d'une ville ────────────────────────────────────────────────────────

interface ProbeCityResult {
  readonly status: ArcgisDiscoveryStatus;
  readonly serviceUrl?: string;
  readonly serviceName?: string;
}

/** Sonde une ville individuelle pour trouver son service ArcGIS de zonage. */
async function probeCity(
  citySlug: string,
  opts: {
    readonly fetchImpl: typeof fetch;
    readonly timeoutMs: number;
    readonly domainGuesser: (slug: string) => readonly string[];
  },
): Promise<ProbeCityResult> {
  const domains = opts.domainGuesser(citySlug);

  for (const domain of domains) {
    for (const suffix of ARCGIS_SERVER_URL_PATTERNS) {
      const catalogUrl = `${domain}${suffix}`;

      let catalog: Awaited<ReturnType<typeof probeArcgisCatalog>>;
      try {
        catalog = await probeArcgisCatalog(catalogUrl, opts.fetchImpl, opts.timeoutMs);
      } catch {
        continue;
      }

      if (catalog === null) continue;

      const zonageServices = filterZonageServices(catalog.services);
      if (zonageServices.length === 0) continue;

      for (const service of zonageServices) {
        const layerUrl = await resolveZonageLayer(service.url, opts.fetchImpl, opts.timeoutMs);
        if (layerUrl !== null) {
          return {
            status: "found",
            serviceUrl: layerUrl,
            serviceName: service.name,
          };
        }
      }
    }
  }

  return { status: "not-found" };
}

// ── API publique ───────────────────────────────────────────────────────────────

/**
 * Sonde, pour une liste de villes, la présence d'un service ArcGIS REST de zonage
 * et produit des entrées {@link GeoSourceInventory} (`platform: 'arcgis'`).
 *
 * ## Idempotence
 * Les villes déjà dans `existingInventories` sont ignorées (statut `skipped`)
 * sauf si `force: true` est passé.
 *
 * ## Limitation couverture (~30–40 %)
 * La détection repose sur des heuristiques slug → domaine municipal. Sans
 * annuaire MAMH des URLs officielles, la couverture reste partielle. Voir
 * {@link defaultMunicipalDomainGuesser} pour les patterns testés.
 *
 * ## Herméticité (ADR-0007)
 * `fetchImpl` et `now` sont injectables. En CI, toujours injecter des mocks.
 *
 * @param citySlugs   Slugs des villes à sonder.
 * @param opts        Options (registre existant, fetch injectable, timeout, etc.).
 * @returns           `{ inventories, coverage }` — inventaires + rapport.
 */
export async function discoverArcgisZonageServices(
  citySlugs: readonly string[],
  opts: DiscoverArcgisOptions = {},
): Promise<DiscoverArcgisResult> {
  const {
    existingInventories = [],
    force = false,
    fetchImpl = globalThis.fetch,
    timeoutMs = ARCGIS_DISCOVERY_TIMEOUT_MS,
    now = () => new Date(),
    domainGuesser = defaultMunicipalDomainGuesser,
  } = opts;

  const existingSlugs = new Set(existingInventories.map((e) => e.citySlug));
  const inventories: GeoSourceInventory[] = [];

  let found = 0;
  let notFound = 0;
  let errors = 0;
  let skipped = 0;

  for (const citySlug of citySlugs) {
    // Idempotence : ignorer les villes déjà dans le registre
    if (!force && existingSlugs.has(citySlug)) {
      skipped++;
      continue;
    }

    let result: ProbeCityResult;
    try {
      result = await probeCity(citySlug, { fetchImpl, timeoutMs, domainGuesser });
    } catch {
      errors++;
      continue;
    }

    if (result.status === "found" && result.serviceUrl !== undefined) {
      found++;
      const lastChecked = now().toISOString();
      const inventory: GeoSourceInventory = {
        citySlug,
        platform: "arcgis",
        zonage: {
          availability: "arcgis",
          quality: "geojson",
          url: result.serviceUrl,
        },
        lots: {
          availability: "unknown",
          quality: "none",
        },
        lastChecked,
        notes: `Découvert par recensement automatisé arcgis-discovery v${ARCGIS_DISCOVERY_VERSION}. Service : ${result.serviceName ?? "inconnu"}. Non vérifié live.`,
      };
      inventories.push(inventory);
    } else if (result.status === "not-found") {
      notFound++;
    } else {
      errors++;
    }
  }

  const probed = found + notFound + errors;
  const coverageRatio = probed > 0 ? found / probed : 0;

  const coverage: ArcgisZonageCoverage = {
    totalCities: citySlugs.length,
    found,
    notFound,
    errors,
    skipped,
    coverageRatio,
    generatedAt: now().toISOString(),
  };

  return { inventories, coverage };
}
