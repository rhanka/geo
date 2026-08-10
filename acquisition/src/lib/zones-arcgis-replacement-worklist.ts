/**
 * Contrat immuable du Job de CAPTURE d'un remplacement ArcGIS de zonage.
 *
 * Ce n'est volontairement pas une `CaptureWorklist` générique : un remplacement
 * doit pouvoir prouver quel filtre municipal, quel champ de zone et quelles
 * dépréciations ont été autorisés. Le Job de capture ne dépose ensuite que
 * `raw/` et `capture/_runs/`; un Job de dépôt distinct consommera son reçu.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { buildArcGisGeoJsonQueryUrl } from "./arcgis-query.js";

export const ZONES_ARCGIS_REPLACEMENT_WORKLIST_CONTRACT = "zones-arcgis-replacement/v1";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEPRECATED_CODE_RE = /^[^\u0000-\u001f]{1,64}$/;

function arcgisLayer(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("layer doit être une URL HTTPS ArcGIS valide");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("layer doit être une URL HTTPS ArcGIS sans identifiant, query ni fragment");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!/\/(?:FeatureServer|MapServer)\/\d+$/i.test(pathname)) {
    throw new Error("layer doit viser exactement un FeatureServer/<n> ou MapServer/<n>");
  }
  url.pathname = pathname;
  return url.toString();
}

function municipalityWhere(field: string, value: string): string {
  return `${field} = '${value.replace(/'/g, "''")}'`;
}

const MunicipalityFilterSchema = z.object({
  field: z.string().regex(FIELD_RE),
  value: z.string().trim().min(1).max(160).refine((value) => !/[\u0000-\u001f]/.test(value), "valeur de filtre invalide"),
}).strict();

const TargetSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  source: z.literal("zones-arcgis"),
  layer: z.string().transform(arcgisLayer),
  municipality_filter: MunicipalityFilterSchema,
  zone_field: z.string().regex(FIELD_RE),
  zone_prefix_field: z.string().regex(FIELD_RE).optional(),
  max_distance_km: z.number().finite().positive().max(100),
  allow_deprecated: z.array(z.string().trim().regex(DEPRECATED_CODE_RE)).max(100).default([]),
}).strict().superRefine((target, context) => {
  const seen = new Set<string>();
  for (const code of target.allow_deprecated) {
    const canonical = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!canonical || seen.has(canonical)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["allow_deprecated"], message: "codes dépréciés vides ou dupliqués" });
      return;
    }
    seen.add(canonical);
  }
});

export const ZonesArcgisReplacementWorklistSchema = z.object({
  contract: z.literal(ZONES_ARCGIS_REPLACEMENT_WORKLIST_CONTRACT),
  // Une ville par Job : un receipt capture ↔ une décision de dépôt. Cela évite
  // qu'un shard partage un run_id, un log ou une transaction entre municipalités.
  targets: z.tuple([TargetSchema]),
}).strict();

export type ZonesArcgisReplacementTarget = z.infer<typeof TargetSchema>;
export type ZonesArcgisReplacementWorklist = z.infer<typeof ZonesArcgisReplacementWorklistSchema>;
export interface RegisteredReplacementMunicipality { slug: string; name: string }

/** Refuse les worklists génériques avant le moindre GET tiers. */
export function parseZonesArcgisReplacementWorklist(value: unknown): ZonesArcgisReplacementWorklist {
  return ZonesArcgisReplacementWorklistSchema.parse(value);
}

/** Filtre SQL déterministe et explicitement rattaché à la municipalité ciblée. */
export function whereForReplacementTarget(target: ZonesArcgisReplacementTarget): string {
  return municipalityWhere(target.municipality_filter.field, target.municipality_filter.value);
}

function comparableMunicipalityName(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("fr-CA").trim();
}

/** The ArcGIS predicate must name the same municipality as the registry slug. */
export function assertReplacementTargetMatchesMunicipalityRegister(
  target: ZonesArcgisReplacementTarget,
  municipalities: readonly RegisteredReplacementMunicipality[],
): void {
  const municipality = municipalities.find((candidate) => candidate.slug === target.slug);
  if (!municipality) throw new Error(`slug de remplacement absent du registre municipal: ${target.slug}`);
  if (comparableMunicipalityName(target.municipality_filter.value) !== comparableMunicipalityName(municipality.name)) {
    throw new Error(
      `filtre municipal ${JSON.stringify(target.municipality_filter.value)} ne correspond pas au slug ${target.slug} (${JSON.stringify(municipality.name)})`,
    );
  }
}

/** L'unique URL que le Job de capture est autorisé à appeler pour ce contrat. */
export function captureUrlForReplacementTarget(target: ZonesArcgisReplacementTarget): string {
  return buildArcGisGeoJsonQueryUrl(
    target.layer,
    [target.zone_field, ...(target.zone_prefix_field ? [target.zone_prefix_field] : [])],
    { where: whereForReplacementTarget(target), resultOffset: 0, resultRecordCount: 20_000 },
  );
}

/** Sérialisation canonique : ce sont ces octets qui sont hashés puis déposés sur S3. */
export function serializeZonesArcgisReplacementWorklist(worklist: ZonesArcgisReplacementWorklist): string {
  const target = worklist.targets[0];
  return `${JSON.stringify({
    contract: ZONES_ARCGIS_REPLACEMENT_WORKLIST_CONTRACT,
    targets: [{
      slug: target.slug,
      source: target.source,
      layer: target.layer,
      municipality_filter: target.municipality_filter,
      zone_field: target.zone_field,
      ...(target.zone_prefix_field ? { zone_prefix_field: target.zone_prefix_field } : {}),
      max_distance_km: target.max_distance_km,
      allow_deprecated: target.allow_deprecated,
    }],
  }, null, 2)}\n`;
}

export function zonesArcgisReplacementWorklistSha256(worklist: ZonesArcgisReplacementWorklist): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(serializeZonesArcgisReplacementWorklist(worklist)).digest("hex")}`;
}
