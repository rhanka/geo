/**
 * coverage-tracks.ts — TAXONOMIE des tracks d'acquisition (solution-driven).
 *
 * Pour chaque COUCHE (cadastre, role-foncier, zones, normes, pv, pmtiles), on
 * définit la LISTE PRIORISÉE des voies d'acquisition candidates ("tracks").
 * Un track = une façon concrète et nommée d'obtenir la donnée pour une ville :
 * un compte/portail (esri/agol, jmap, gonet, azimut, carto, ckan, MRC-SHP), une
 * recomposition PDF→GeoJSON par TYPE (T1 GeoPDF géoréf, T2 vectorisation calque,
 * T3 raster géoréf, T4 scan calé sur lots — ADR-0023), un portail logiciel piloté
 * en session (obscura : headless + login pour les portails JS/onclick), ou le
 * recenseur manuel en dernier recours.
 *
 * INVARIANT "aucun plafond" : pour chaque couche, la liste se termine TOUJOURS
 * par une voie universelle (pdf-* puis obscura puis recenseur-manual), de sorte
 * que TOUTE ville a au moins une voie réaliste. Aucune ville n'est sans plan.
 *
 * Aucun appel réseau, aucun LLM ici : c'est un catalogue statique pur (lecture).
 * Le seul track marqué `cost: "llm"` est `pdf-vision` (extraction des grilles de
 * normes par vision) ; il n'est JAMAIS exécuté par ce module — il est seulement
 * répertorié comme voie candidate priorisée après les voies gratuites.
 */

/** Les 6 couches cibles (chacune visée sur les 1106 municipalités). */
export type CoverageLayer =
  | "cadastre"
  | "role-foncier"
  | "zones"
  | "normes"
  | "pv"
  | "pmtiles";

export const COVERAGE_LAYERS: readonly CoverageLayer[] = [
  "cadastre",
  "role-foncier",
  "zones",
  "normes",
  "pv",
  "pmtiles",
] as const;

/**
 * Plateformes réelles connues du repo (cf. `recense-platform` qui DÉTECTE
 * `arcgis|jmap|gonet|ckan|pdf|unknown`, + plateformes métier additionnelles
 * recensées dans l'inventaire des sources : azimut, carto, gestionweblex,
 * pg-solutions/voilà, MRC-SHP, CMS de PV). `n/a` = track sans plateforme (ex.
 * désagrégation interne, dérivation pmtiles).
 */
export type TrackPlatform =
  | "esri-agol" // esri / arcgis-hub / agol account
  | "jmap" // K2 / Kheops
  | "gonet" // goAzimut / PG Solutions / gonet
  | "azimut"
  | "carto"
  | "gestionweblex" // règlements
  | "pg-solutions" // Voilà
  | "mrc-shp" // portail SHP de MRC
  | "ckan" // données-Québec / CKAN
  | "pdf" // ressource PDF brute (à recomposer)
  | "cms-pv" // CMS de site municipal (procès-verbaux)
  | "obscura" // headless + session (portails JS/onclick/login)
  | "n/a";

/** Coût d'exécution d'un track. `free` = HTTP/catalogue/détection (pas de crédit). */
export type TrackCost = "free" | "llm";

/** Un track candidat (voie d'acquisition) pour une couche. */
export interface CoverageTrack {
  /** Identifiant stable (référencé par la matrice d'état). */
  readonly id: string;
  /** Libellé lisible. */
  readonly label: string;
  /** Plateforme réelle visée. */
  readonly platform: TrackPlatform;
  /** Gratuit (HTTP/catalogue) vs LLM (crédit). */
  readonly cost: TrackCost;
  /** Prérequis pour emprunter cette voie (compte, découverte préalable, etc.). */
  readonly prereqs: readonly string[];
  /**
   * `true` si c'est une voie universelle de repli : toujours empruntable pour
   * n'importe quelle ville (garantit "aucun plafond").
   */
  readonly fallback?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracks transverses (réutilisés par plusieurs couches géométriques)
// ─────────────────────────────────────────────────────────────────────────────

const PDF_T1: CoverageTrack = {
  id: "pdf-georef-t1",
  label: "Recomposition PDF→GeoJSON — T1 GeoPDF géoréférencé",
  platform: "pdf",
  cost: "free",
  prereqs: ["pdf-plan-zonage-georef-disponible"],
};
const PDF_T2: CoverageTrack = {
  id: "pdf-vectorize-t2",
  label: "Recomposition PDF→GeoJSON — T2 vectorisation de calque",
  platform: "pdf",
  cost: "free",
  prereqs: ["pdf-plan-vectoriel"],
};
const PDF_T3: CoverageTrack = {
  id: "pdf-raster-t3",
  label: "Recomposition PDF→GeoJSON — T3 raster géoréférencé",
  platform: "pdf",
  cost: "free",
  prereqs: ["pdf-raster", "points-de-calage"],
};
const PDF_T4: CoverageTrack = {
  id: "pdf-scan-t4",
  label: "Recomposition PDF→GeoJSON — T4 scan calé sur lots (ADR-0023)",
  platform: "pdf",
  cost: "free",
  prereqs: ["pdf-scan", "lots-cadastre-pour-calage"],
  fallback: true,
};
const OBSCURA: CoverageTrack = {
  id: "obscura-session",
  label: "Obscura — portail logiciel piloté (headless + session/login)",
  platform: "obscura",
  cost: "free",
  prereqs: ["portail-js-ou-login-identifie"],
  fallback: true,
};
const RECENSEUR_MANUAL: CoverageTrack = {
  id: "recenseur-manual",
  label: "Recenseur manuel (source à trouver — dernier recours)",
  platform: "n/a",
  cost: "free",
  prereqs: [],
  fallback: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Listes priorisées PAR COUCHE (du plus rentable/gratuit au repli universel)
// ─────────────────────────────────────────────────────────────────────────────

const CADASTRE_TRACKS: readonly CoverageTrack[] = [
  {
    id: "harvest-cadastre-renove",
    label: "Cadastre rénové du Québec (track unique existant)",
    platform: "ckan",
    cost: "free",
    prereqs: ["cadastre-renove-province"],
    fallback: true, // la province entière est moissonnable → couvre toute ville
  },
];

const ROLE_FONCIER_TRACKS: readonly CoverageTrack[] = [
  {
    id: "xml-mamh",
    label: "Rôle foncier — flux XML MAMH (track unique existant)",
    platform: "n/a",
    cost: "free",
    prereqs: ["role-mamh-province"],
    fallback: true,
  },
];

const ZONES_TRACKS: readonly CoverageTrack[] = [
  {
    id: "agol-account",
    label: "Zonage via compte AGOL / ArcGIS Hub (FeatureServer ville)",
    platform: "esri-agol",
    cost: "free",
    prereqs: ["agol-owner-identifie", "couche-zonage-servie"],
  },
  {
    id: "disaggregation",
    label: "Désagrégation d'une collection MRC/agrégée → per-muni",
    platform: "n/a",
    cost: "free",
    prereqs: ["collection-agregee-contenant-la-ville"],
  },
  {
    id: "ckan",
    label: "Zonage via CKAN / données-Québec",
    platform: "ckan",
    cost: "free",
    prereqs: ["jeu-ckan-zonage"],
  },
  {
    id: "mrc-shp-portal",
    label: "Portail SHP de MRC (téléchargement vecteur)",
    platform: "mrc-shp",
    cost: "free",
    prereqs: ["portail-mrc-shp"],
  },
  {
    id: "jmap",
    label: "Zonage via portail JMap (K2)",
    platform: "jmap",
    cost: "free",
    prereqs: ["portail-jmap"],
  },
  {
    id: "gonet",
    label: "Zonage via goNet / goAzimut (PG Solutions)",
    platform: "gonet",
    cost: "free",
    prereqs: ["portail-gonet"],
  },
  {
    id: "azimut",
    label: "Zonage via Azimut",
    platform: "azimut",
    cost: "free",
    prereqs: ["portail-azimut"],
  },
  {
    id: "carto",
    label: "Zonage via Carto",
    platform: "carto",
    cost: "free",
    prereqs: ["portail-carto"],
  },
  PDF_T1,
  PDF_T2,
  PDF_T3,
  PDF_T4,
  OBSCURA,
  RECENSEUR_MANUAL,
];

const NORMES_TRACKS: readonly CoverageTrack[] = [
  {
    id: "pdf-native",
    label: "Normes — grille extraite du PDF natif (texte/tableau)",
    platform: "pdf",
    cost: "free",
    prereqs: ["pdf-grille-normes-texte"],
  },
  {
    id: "gestionweblex",
    label: "Normes — règlement d'urbanisme via GestionWeblex",
    platform: "gestionweblex",
    cost: "free",
    prereqs: ["portail-gestionweblex"],
  },
  {
    id: "pdf-vision",
    label: "Normes — extraction vision de la grille (LLM)",
    platform: "pdf",
    cost: "llm",
    prereqs: ["pdf-grille-image", "budget-vision"],
  },
  OBSCURA,
  RECENSEUR_MANUAL,
];

const PV_TRACKS: readonly CoverageTrack[] = [
  {
    id: "scraper-configured",
    label: "PV — scraper configuré pour le CMS de la ville (ALL_PV_CITIES)",
    platform: "cms-pv",
    cost: "free",
    prereqs: ["pv-city-config"],
  },
  {
    id: "scraper-new",
    label: "PV — nouveau scraper à configurer (CMS détecté, pas encore câblé)",
    platform: "cms-pv",
    cost: "free",
    prereqs: ["cms-detecte"],
  },
  OBSCURA,
  RECENSEUR_MANUAL,
];

const PMTILES_TRACKS: readonly CoverageTrack[] = [
  {
    id: "derive-province",
    label: "PMTiles — dérivé des couches province (build tuiles per-muni)",
    platform: "n/a",
    cost: "free",
    prereqs: ["couches-amont-disponibles"],
    fallback: true,
  },
];

/** Taxonomie complète : couche → liste priorisée de tracks. */
export const COVERAGE_TRACKS: Readonly<
  Record<CoverageLayer, readonly CoverageTrack[]>
> = {
  cadastre: CADASTRE_TRACKS,
  "role-foncier": ROLE_FONCIER_TRACKS,
  zones: ZONES_TRACKS,
  normes: NORMES_TRACKS,
  pv: PV_TRACKS,
  pmtiles: PMTILES_TRACKS,
};

/** Tous les ids de tracks d'une couche, dans l'ordre de priorité. */
export function trackIdsFor(layer: CoverageLayer): readonly string[] {
  return COVERAGE_TRACKS[layer].map((t) => t.id);
}

/** Recherche d'un track par couche + id (pour libellé/coût dans les rapports). */
export function findTrack(
  layer: CoverageLayer,
  id: string,
): CoverageTrack | undefined {
  return COVERAGE_TRACKS[layer].find((t) => t.id === id);
}

/** `true` si le track existe et est gratuit (aucun crédit). */
export function isFreeTrack(layer: CoverageLayer, id: string): boolean {
  const t = findTrack(layer, id);
  return t ? t.cost === "free" : false;
}
