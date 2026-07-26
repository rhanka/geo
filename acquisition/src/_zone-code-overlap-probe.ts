/**
 * _zone-code-overlap-probe.ts — pourquoi un fold de normes matche 0 polygone
 * alors que les DEUX côtés portent de la donnée.
 *
 * Sept villes B' ont leurs normes acquises, servies et valuées, et un fold à
 * 0 % : ce n'est pas un défaut d'acquisition, c'est que les codes de zone ne se
 * joignent pas. Cette sonde met les deux vocabulaires côte à côte pour qu'on
 * VOIE l'écart au lieu de le supposer — préfixe, casse, séparateur, zéros de
 * tête, suffixe de secteur.
 *
 * Lecture seule stricte : n'écrit rien, ne plie rien, ne canonise rien. Décider
 * qu'un `H1` servi « est » un `H-01` de la grille est un jugement, pas une
 * observation, et il ne se prend pas dans une sonde.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_zone-code-overlap-probe.ts --slugs amherst,amos
 */
import { getBytes, s3Client } from "./lib/s3.js";

const ZONAGE = "normalized/ca-qc-zonage/";
const NORMS = "normalized/qc-zonage-norms/";

interface FeatureLike { properties?: Record<string, unknown> }

function codes(features: FeatureLike[], fields: string[]): string[] {
  const out = new Set<string>();
  for (const feature of features) {
    for (const field of fields) {
      const value = feature.properties?.[field];
      if (typeof value === "string" && value.trim().length > 0) { out.add(value.trim()); break; }
    }
  }
  return [...out].sort();
}

async function readFeatures(s3: ReturnType<typeof s3Client>, keys: string[]): Promise<FeatureLike[] | null> {
  for (const key of keys) {
    try {
      const parsed = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: FeatureLike[] };
      if (Array.isArray(parsed.features)) return parsed.features;
    } catch {
      // clé absente : l'autre layout peut exister, on n'en conclut rien ici
    }
  }
  return null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--slugs");
  const slugs = (i >= 0 ? argv[i + 1] ?? "" : "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("usage: --slugs a,b,c");
  const s3 = s3Client();

  for (const slug of slugs) {
    const zon = await readFeatures(s3, [`${ZONAGE}qc-zonage-${slug}.geojson`, `${ZONAGE}qc-zonage-${slug}/qc-zonage-${slug}.geojson`]);
    const nor = await readFeatures(s3, [`${NORMS}qc-zonage-norms-${slug}.geojson`, `${NORMS}qc-zonage-norms-${slug}/qc-zonage-norms-${slug}.geojson`]);
    if (!zon || !nor) { console.log(JSON.stringify({ slug, error: `illisible: zonage=${!!zon} normes=${!!nor}` })); continue; }

    const zonCodes = codes(zon, ["zone_code", "code_zone", "ZONE", "zone"]);
    const norCodes = codes(nor, ["zone_code", "code_zone", "ZONE", "zone"]);
    const zonSet = new Set(zonCodes);
    const exact = norCodes.filter((c) => zonSet.has(c));

    console.log(JSON.stringify({
      slug,
      zonage: { polygones: zon.length, codes_distincts: zonCodes.length, echantillon: zonCodes.slice(0, 8) },
      normes: { lignes: nor.length, codes_distincts: norCodes.length, echantillon: norCodes.slice(0, 8) },
      recoupement_exact: exact.length,
    }, null, 1));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
