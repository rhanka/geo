/**
 * GeoSourceInventory — modèle TS pour l'inventaire des sources géographiques
 * (zonage + lots) par ville, migré depuis radar-immobilier (ADR-0013).
 *
 * Pas de Zod : le repo geo est strict-TS sans Zod (ADR-0007 / dependency-free).
 * Un validateur léger (`isGeoSourceInventory`) remplace le parse Zod.
 *
 * ## Availability enum
 *   donnees-quebec  — flux CKAN open-data (Données Québec) : format GeoJSON
 *   arcgis          — service REST ArcGIS (MRNF, MAMH, municipal)
 *   gonet           — portail GoNet / PG Solutions
 *   jmap            — JMap Server (Kheops Technologies)
 *   pdf             — plans de zonage en PDF scanné ou vectoriel
 *   none            — aucune source connue / non investigué
 *   unknown         — ville non encore investiguée
 *
 * ## Quality enum (ordre décroissant de valeur pour le pipeline)
 *   geojson  — vecteur prêt à l'emploi (API ou téléchargement direct)
 *   html     — données parsables depuis une page web (semi-structuré)
 *   pdf      — PDF scanné ou vectoriel, nécessite OCR / extraction manuelle
 *   none     — aucune donnée accessible
 *
 * ## Platform enum (tech stack du portail source, champ ajouté Lot D)
 *   arcgis   — ESRI ArcGIS REST/MapServer
 *   ckan     — portail CKAN (Données Québec, Open Data)
 *   jmap     — JMap Server (Kheops Technologies)
 *   gonet    — GoNet / GoAzimut (PG Solutions)
 *   pdf      — document PDF uniquement, pas de portail tech
 *   unknown  — plateforme non déterminée
 */

// ── Enums (union littéraux TS, pas d'enum runtime) ────────────────────────────

export type ZonageAvailability =
  | "donnees-quebec"
  | "arcgis"
  | "gonet"
  | "jmap"
  | "pdf"
  | "none"
  | "unknown";

export type ZonageQuality = "geojson" | "html" | "pdf" | "none";

/**
 * Plateforme technologique de la source (détectée ou renseignée manuellement).
 * Ajouté dans Lot D : permet de router automatiquement l'acquisition
 * (CKAN → `searchCkanPackages`, ArcGIS → `crawlArcgisLayer`, etc.).
 */
export type SourcePlatform = "arcgis" | "ckan" | "jmap" | "gonet" | "pdf" | "unknown";

// ── Layer descriptor ──────────────────────────────────────────────────────────

/**
 * Descriptor pour une couche géo (zonage ou lots) d'une ville.
 */
export interface GeoLayerDescriptor {
  /** D'où proviennent les données. */
  readonly availability: ZonageAvailability;
  /** Qualité du format pour l'ingestion automatisée. */
  readonly quality: ZonageQuality;
  /**
   * URL directe vers la ressource (API CKAN, REST ArcGIS, PDF, page portail…).
   * Absente si non investigué.
   */
  readonly url?: string;
}

// ── Main inventory type ───────────────────────────────────────────────────────

/**
 * Entrée d'inventaire pour une municipalité.
 *
 * - `citySlug`    : identifiant kebab-case unique, doit correspondre au champ
 *                   `slug` de {@link Municipality} dans `QC_MUNICIPALITIES`.
 * - `zonage`      : disponibilité du plan de zonage.
 * - `lots`        : disponibilité de la couche cadastrale.
 * - `platform`    : tech stack de la source principale (ajout Lot D).
 * - `lastChecked` : horodatage ISO 8601 de la dernière vérification
 *                   (injecté par le recensement, absent si non investigué).
 * - `notes`       : commentaire libre (sources, caveats, date d'investigation…).
 */
export interface GeoSourceInventory {
  readonly citySlug: string;
  readonly zonage: GeoLayerDescriptor;
  readonly lots: GeoLayerDescriptor;
  /** Plateforme technologique de la source principale (Lot D). */
  readonly platform: SourcePlatform;
  /**
   * ISO 8601 timestamp de la dernière vérification automatique ou manuelle.
   * Absente pour les entrées non encore investiguées.
   */
  readonly lastChecked?: string;
  /** Notes libres : caveats, attribution, date d'investigation, références. */
  readonly notes?: string;
}

// ── Runtime validation (remplace Zod.parse) ───────────────────────────────────

const AVAILABILITY_VALUES: ReadonlySet<string> = new Set<ZonageAvailability>([
  "donnees-quebec",
  "arcgis",
  "gonet",
  "jmap",
  "pdf",
  "none",
  "unknown",
]);

const QUALITY_VALUES: ReadonlySet<string> = new Set<ZonageQuality>([
  "geojson",
  "html",
  "pdf",
  "none",
]);

const PLATFORM_VALUES: ReadonlySet<string> = new Set<SourcePlatform>([
  "arcgis",
  "ckan",
  "jmap",
  "gonet",
  "pdf",
  "unknown",
]);

function isLayerDescriptor(value: unknown): value is GeoLayerDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!AVAILABILITY_VALUES.has(String(v["availability"]))) return false;
  if (!QUALITY_VALUES.has(String(v["quality"]))) return false;
  if ("url" in v && v["url"] !== undefined && typeof v["url"] !== "string") return false;
  return true;
}

/**
 * Type guard runtime léger : vérifie qu'une valeur inconnue est bien un
 * `GeoSourceInventory` valide. Remplace `GeoSourceInventory.parse(x)` (Zod)
 * dans un repo sans Zod (ADR-0007).
 */
export function isGeoSourceInventory(value: unknown): value is GeoSourceInventory {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v["citySlug"] !== "string" || v["citySlug"].length === 0) return false;
  if (!isLayerDescriptor(v["zonage"])) return false;
  if (!isLayerDescriptor(v["lots"])) return false;
  if (!PLATFORM_VALUES.has(String(v["platform"]))) return false;
  if ("lastChecked" in v && v["lastChecked"] !== undefined && typeof v["lastChecked"] !== "string")
    return false;
  if ("notes" in v && v["notes"] !== undefined && typeof v["notes"] !== "string") return false;
  return true;
}

/**
 * Valide un tableau de `GeoSourceInventory` et retourne les entrées valides.
 * Les entrées invalides sont collectées dans `errors` (index + message).
 */
export function validateInventories(values: unknown[]): {
  valid: GeoSourceInventory[];
  errors: Array<{ index: number; message: string }>;
} {
  const valid: GeoSourceInventory[] = [];
  const errors: Array<{ index: number; message: string }> = [];
  for (let i = 0; i < values.length; i++) {
    const item = values[i];
    if (isGeoSourceInventory(item)) {
      valid.push(item);
    } else {
      const slug =
        typeof item === "object" && item !== null && "citySlug" in item
          ? String((item as Record<string, unknown>)["citySlug"])
          : "(inconnu)";
      errors.push({ index: i, message: `Entrée invalide à l'index ${i} (citySlug="${slug}")` });
    }
  }
  return { valid, errors };
}
