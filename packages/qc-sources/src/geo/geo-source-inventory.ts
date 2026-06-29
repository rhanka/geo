/**
 * GeoSourceInventory — modèle Zod pour l'inventaire des sources géographiques
 * (zonage + lots) par ville, prérequis du WP B (vertical géo).
 *
 * Availability enum:
 *   donnees-quebec  — flux CKAN open-data (Données Québec) : format GeoJSON
 *   goazimut        — plateforme propriétaire GoAzimut / PG Solutions
 *   pdf             — plans de zonage en PDF scanné ou vectoriel
 *   none            — aucune source connue / non investigué
 *   unknown         — ville non encore investigée
 *
 * Quality enum (ordre décroissant de valeur pour le pipeline) :
 *   geojson  — vecteur prêt à l'emploi (API ou téléchargement direct)
 *   html     — données parsables depuis une page web (semi-structuré)
 *   pdf      — PDF scanné ou vectoriel, nécessite OCR / extraction manuelle
 *   none     — aucune donnée accessible
 */

import { z } from "zod";

export const GeoDataAvailability = z.enum([
  "donnees-quebec",
  "goazimut",
  "pdf",
  "none",
  "unknown",
]);
export type GeoDataAvailabilityT = z.infer<typeof GeoDataAvailability>;

export const GeoDataQuality = z.enum(["geojson", "html", "pdf", "none"]);
export type GeoDataQualityT = z.infer<typeof GeoDataQuality>;

/**
 * Descriptor for a single geo data layer (zonage or lots) for one city.
 */
export const GeoLayerDescriptor = z.object({
  /** Where the data comes from. */
  availability: GeoDataAvailability,

  /** Quality of the data format for automated ingestion. */
  quality: GeoDataQuality,

  /** Direct URL to the resource (CKAN API, PDF link, portal page…). Optional. */
  url: z.string().url().optional(),
});
export type GeoLayerDescriptorT = z.infer<typeof GeoLayerDescriptor>;

/**
 * Inventory entry for one municipality.
 *
 * - `citySlug`  matches the QC_MUNICIPALITIES slug (kebab-case).
 * - `zonage`    describes availability of the zoning (plan de zonage) layer.
 * - `lots`      describes availability of the cadastral lots layer.
 * - `notes`     optional free-text commentary (source caveats, last-checked date…).
 */
export const GeoSourceInventory = z.object({
  citySlug: z.string().min(1),

  zonage: GeoLayerDescriptor,

  lots: GeoLayerDescriptor,

  /** Free-text notes: caveats, date of investigation, attribution, etc. */
  notes: z.string().optional(),
});
export type GeoSourceInventoryT = z.infer<typeof GeoSourceInventory>;
