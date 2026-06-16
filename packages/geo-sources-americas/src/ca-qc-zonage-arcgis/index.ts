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
  /** Voie de découverte : "agol-search" | "mamh-domain-probe". */
  readonly source: string;
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
export function buildQcZonageArcgisManifests(): SourceManifest[] {
  const seenIds = new Map<string, number>();
  return QC_ZONAGE_ARCGIS_ENDPOINTS.map((ep) => {
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
        `Licence non qualifiée à la découverte (endpoint public sans auth).`,
      kind: "administrative",
      jurisdiction: { country: "CA", subdivision: "CA-QC" },
      provider: {
        name: ep.meta?.owner ?? ep.citySlug,
        ...(ep.meta?.website ? { url: ep.meta.website } : {}),
      },
      // pas de licence uniforme déclarée → marquée "unknown" au niveau source
      license: "unknown",
      datasets: [dataset],
    } satisfies SourceManifest;
  });
}

/**
 * Manifests prêts à câbler dans le registre geo (un par endpoint vérifié).
 * Recalculé à l'import depuis `registry.generated.json`.
 */
export const QC_ZONAGE_ARCGIS_MANIFESTS: readonly SourceManifest[] =
  buildQcZonageArcgisManifests();

/** Nombre d'endpoints vérifiés actuellement dans le registre. */
export const QC_ZONAGE_ARCGIS_COUNT = QC_ZONAGE_ARCGIS_ENDPOINTS.length;
