import type { SourceKind } from "./domain.js";

export type SourceRecommendation =
  | "build-now"
  | "build-later"
  | "manual-check"
  | "partner-required"
  | "drop-for-phase-1";

export type SourceTier = "A" | "B" | "C";

export interface PrioritySourceBinding {
  readonly sourceId: string;
  readonly priority: 1 | 2 | 3 | 4 | 5;
  readonly tier: SourceTier;
  readonly kind: SourceKind;
  readonly city?: string;
  readonly recommendation: SourceRecommendation;
  readonly cadence: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
}

export const VALLEYFIELD_PRIORITY_SOURCE_BINDINGS = [
  {
    sourceId: "avis-publics-valleyfield",
    priority: 1,
    tier: "A",
    kind: "avis-publics",
    city: "salaberry-de-valleyfield",
    recommendation: "build-now",
    cadence: "daily",
  },
  {
    sourceId: "reglements-urbanisme-valleyfield",
    priority: 2,
    tier: "A",
    kind: "reglement",
    city: "salaberry-de-valleyfield",
    recommendation: "build-now",
    cadence: "weekly",
  },
  {
    sourceId: "roles-evaluation-fonciere-mamh",
    priority: 3,
    tier: "A",
    kind: "role-evaluation",
    recommendation: "build-now",
    cadence: "annual",
  },
  {
    sourceId: "donnees-quebec-catalog",
    priority: 4,
    tier: "A",
    kind: "donnees-quebec",
    recommendation: "build-now",
    cadence: "monthly",
  },
  {
    sourceId: "adresses-quebec-igo-geocoder",
    priority: 4,
    tier: "A",
    kind: "adresses-quebec",
    recommendation: "build-now",
    cadence: "monthly",
  },
  {
    sourceId: "cptaq-zone-agricole",
    priority: 5,
    tier: "A",
    kind: "cptaq",
    recommendation: "build-now",
    cadence: "quarterly",
  },
] as const satisfies readonly PrioritySourceBinding[];

/**
 * Beauharnois priority bindings (WP4 Source #2 — the second pilot city, first on
 * a different CMS). Kept in a separate array so the Valleyfield top-five stays
 * pinned; `getPrioritySourceBinding` resolves across both city plans.
 */
export const BEAUHARNOIS_PRIORITY_SOURCE_BINDINGS = [
  {
    sourceId: "avis-publics-beauharnois",
    priority: 1,
    tier: "A",
    kind: "avis-publics",
    city: "beauharnois",
    recommendation: "build-now",
    cadence: "daily",
  },
  {
    sourceId: "roles-evaluation-fonciere-mamh-beauharnois",
    priority: 3,
    tier: "A",
    kind: "role-evaluation",
    city: "beauharnois",
    recommendation: "build-now",
    cadence: "annual",
  },
] as const satisfies readonly PrioritySourceBinding[];

/**
 * Concrete, COLLECTIBLE MAMH rôle adapters (WP4 Source #3). The bindings above
 * describe the abstract rôle product per city plan; these are the per-MAMH-code
 * `RoleEvaluationMamhAdapter` ids that the RECUEIL endpoint actually resolves
 * (and that the deterministic seed-ontology path reuses), so a collected rôle
 * RawDocument flows through the SAME recueil → exploitation pipeline as the avis
 * adapters. The source id matches `roleSourceId(codeMamh)`.
 */
export const ROLE_EVALUATION_MAMH_SOURCE_BINDINGS = [
  {
    sourceId: "role-evaluation-mamh-70052",
    priority: 3,
    tier: "A",
    kind: "role-evaluation",
    city: "salaberry-de-valleyfield",
    recommendation: "build-now",
    cadence: "annual",
  },
  {
    sourceId: "role-evaluation-mamh-70022",
    priority: 3,
    tier: "A",
    kind: "role-evaluation",
    city: "beauharnois",
    recommendation: "build-now",
    cadence: "annual",
  },
] as const satisfies readonly PrioritySourceBinding[];

/**
 * Concrete, COLLECTIBLE terrAPI / Adresses Québec adapters (WP4 Source #4). The
 * abstract `adresses-quebec-igo-geocoder` binding above describes the open-data
 * product; these are the per-municipality `AdressesQuebecAdapter` ids the RECUEIL
 * endpoint actually resolves (and that the deterministic seed-ontology path
 * reuses), so a collected address list flows through the SAME recueil →
 * exploitation pipeline as the avis and rôle adapters. The source id matches
 * `adressesSourceId(codeMamh)`.
 */
export const ADRESSES_QUEBEC_SOURCE_BINDINGS = [
  {
    sourceId: "adresses-quebec-70052",
    priority: 4,
    tier: "A",
    kind: "adresses-quebec",
    city: "salaberry-de-valleyfield",
    recommendation: "build-now",
    cadence: "monthly",
  },
  {
    sourceId: "adresses-quebec-70022",
    priority: 4,
    tier: "A",
    kind: "adresses-quebec",
    city: "beauharnois",
    recommendation: "build-now",
    cadence: "monthly",
  },
] as const satisfies readonly PrioritySourceBinding[];

/**
 * Procès-verbaux (PV) adapters — WP A.2.2 generic PV scraper.
 * Easy-first cities: plain WordPress/Fusion sites, no CAPTCHA, direct download.
 * Window: 6 months (183 days) by default.
 */
export const PV_SOURCE_BINDINGS = [
  {
    sourceId: "proces-verbaux-saint-damase",
    priority: 1,
    tier: "A",
    kind: "pv",
    city: "saint-damase",
    recommendation: "build-now",
    cadence: "monthly",
  },
] as const satisfies readonly PrioritySourceBinding[];

/**
 * Generic avis-publics adapters — multi-city, config-driven (feat/avis-generic).
 * The `AvisPublicsGenericAdapter` + `AvisCityConfig` model replaces the per-city
 * city-specific adapters for new cities; Valleyfield and Beauharnois are the two
 * first pilot registrations. Source ids match `AvisCityConfig.sourceId`.
 */
export const AVIS_PUBLICS_GENERIC_SOURCE_BINDINGS = [
  {
    sourceId: "avis-publics-valleyfield",
    priority: 1,
    tier: "A",
    kind: "avis-publics",
    city: "salaberry-de-valleyfield",
    recommendation: "build-now",
    cadence: "daily",
  },
  {
    sourceId: "avis-publics-beauharnois",
    priority: 1,
    tier: "A",
    kind: "avis-publics",
    city: "beauharnois",
    recommendation: "build-now",
    cadence: "daily",
  },
] as const satisfies readonly PrioritySourceBinding[];

/** Every registered priority binding across all pilot cities. */
export const ALL_PRIORITY_SOURCE_BINDINGS: readonly PrioritySourceBinding[] = [
  ...VALLEYFIELD_PRIORITY_SOURCE_BINDINGS,
  ...BEAUHARNOIS_PRIORITY_SOURCE_BINDINGS,
  ...ROLE_EVALUATION_MAMH_SOURCE_BINDINGS,
  ...ADRESSES_QUEBEC_SOURCE_BINDINGS,
  ...PV_SOURCE_BINDINGS,
  ...AVIS_PUBLICS_GENERIC_SOURCE_BINDINGS,
];

export function getPrioritySourceBinding(
  sourceId: string,
): PrioritySourceBinding | undefined {
  return ALL_PRIORITY_SOURCE_BINDINGS.find(
    (source) => source.sourceId === sourceId,
  );
}
