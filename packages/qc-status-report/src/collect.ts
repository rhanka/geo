/**
 * Collecte de la couverture LIVE depuis S3 (lecture seule).
 *
 * Compte, par préfixe, le nombre de municipalités (slugs) couvertes pour chaque
 * type de donnée du pipeline QC, puis dérive les pourcentages sur le
 * dénominateur "province" = nombre de lots cadastraux livrés (~1102). Échantillonne
 * les grilles de zonage pour mesurer combien portent réellement un `zone_code`
 * (vs un fichier présent mais sans attribut de zone exploitable).
 *
 * AUCUNE écriture S3. AUCUN secret en sortie.
 */
import type { S3Client } from "@aws-sdk/client-s3";

import { listSlugs, getRange } from "./s3.js";

/** Préfixes S3 (alignés sur l'acquisition / le harvest). */
export const PREFIXES = {
  cadastreLots: "normalized/qc-cadastre-lots/",
  cadastrePreclip: "normalized/qc-cadastre-lots-preclip/",
  roleFoncier: "registry/role-foncier/",
  indexImmo: "registry/index-immo/",
  zonageGrids: "normalized/ca-qc-zonage/",
  zonageNorms: "registry/qc-zonage-norms/",
  pmtiles: "pmtiles/",
} as const;

/** Combien de grilles de zonage échantillonner pour la présence de zone_code. */
const ZONE_SAMPLE_LIMIT = 60;
/** Octets lus par grille pour détecter un zone_code non-null. */
const ZONE_SAMPLE_BYTES = 65536;

export interface Coverage {
  collectedAt: string;
  /** Dénominateur province = nb de fichiers de lots cadastraux. */
  provinceDenominator: number;
  cadastreLots: number;
  cadastrePreclipBackups: number;
  roleFoncier: number;
  indexImmo: number;
  zonageGridsTotal: number;
  /** Grilles dont l'échantillon contient un vrai zone_code/code_zone non-null. */
  zonageGridsWithZoneCode: number;
  /** Nb de grilles réellement échantillonnées (cap pour rester rapide). */
  zonageGridsSampled: number;
  zonageNorms: number;
  pmtiles: number;
  /** Liste des fichiers PMTiles livrés (ex qc-zones, qc-lots). */
  pmtilesFiles: string[];
}

/** Pourcentage entier borné [0,100] sur le dénominateur province. */
export function pct(n: number, denom: number): number {
  if (denom <= 0) return 0;
  return Math.min(100, Math.round((n / denom) * 100));
}

/** Détecte un zone_code/code_zone NON-null dans un extrait de GeoJSON. */
function hasRealZoneCode(sample: string): boolean {
  // On cherche "zone_code":"X" ou "code_zone":"X" avec une valeur non vide / non null.
  const re = /"(?:zone_code|code_zone)"\s*:\s*"([^"]+)"/;
  return re.test(sample);
}

export async function collectCoverage(s3: S3Client): Promise<Coverage> {
  const [
    cadastreLots,
    cadastrePreclip,
    roleFoncier,
    indexImmo,
    zonageGrids,
    zonageNorms,
    pmtilesFiles,
  ] = await Promise.all([
    // Les lots imbriqués (sous-dossiers ArcGIS éventuels) sont exclus : top-level.
    listSlugs(s3, PREFIXES.cadastreLots, ".geojson", true),
    listSlugs(s3, PREFIXES.cadastrePreclip, ".geojson", false),
    listSlugs(s3, PREFIXES.roleFoncier, ".parquet", true),
    listSlugs(s3, PREFIXES.indexImmo, ".parquet", true),
    listSlugs(s3, PREFIXES.zonageGrids, ".geojson", true),
    listSlugs(s3, PREFIXES.zonageNorms, ".parquet", true),
    listSlugs(s3, PREFIXES.pmtiles, ".pmtiles", false),
  ]);

  // Échantillonnage des grilles pour mesurer la présence de zone_code réel.
  const toSample = zonageGrids.slice(0, ZONE_SAMPLE_LIMIT);
  let withZoneCode = 0;
  const samples = await Promise.allSettled(
    toSample.map((slug) =>
      getRange(s3, `${PREFIXES.zonageGrids}${slug}.geojson`, ZONE_SAMPLE_BYTES),
    ),
  );
  for (const r of samples) {
    if (r.status === "fulfilled" && hasRealZoneCode(r.value)) withZoneCode++;
  }

  return {
    collectedAt: new Date().toISOString(),
    provinceDenominator: cadastreLots.length,
    cadastreLots: cadastreLots.length,
    cadastrePreclipBackups: cadastrePreclip.length,
    roleFoncier: roleFoncier.length,
    indexImmo: indexImmo.length,
    zonageGridsTotal: zonageGrids.length,
    zonageGridsWithZoneCode: withZoneCode,
    zonageGridsSampled: toSample.length,
    zonageNorms: zonageNorms.length,
    pmtiles: pmtilesFiles.length,
    pmtilesFiles: pmtilesFiles.map((s) => `${s}.pmtiles`).sort(),
  };
}
