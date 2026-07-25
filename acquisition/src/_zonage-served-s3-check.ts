/**
 * _zonage-served-s3-check.ts — lane P0_1, READ-ONLY, preuve S3 (pas l'API).
 *
 * L'API geo peut CACHER la collection (mémoire geo-api-collection-cache): un
 * `reglement_numero` fraîchement foldé peut apparaître ∅ à l'API alors que S3
 * (la vérité durable) le porte déjà. Ce helper lit DIRECTEMENT les 2 clés S3 du
 * polygone (plate + sous-dossier) et imprime, par clé, le nombre de features et
 * la valeur `reglement_numero` du 1er feature.
 *
 * Usage: npx tsx acquisition/src/_zonage-served-s3-check.ts slugA slugB ...
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

async function main(): Promise<void> {
  const slugs = process.argv.slice(2);
  const s3 = s3Client();
  for (const slug of slugs) {
    const keys = [
      `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
      `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    ];
    let any = false;
    for (const key of keys) {
      if (!(await exists(s3, key))) continue;
      any = true;
      try {
        const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
        const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
        const p = feats[0]?.properties ?? {};
        console.log(
          `${slug}\t${key.endsWith(`${slug}.geojson`) && !key.includes(`${slug}/`) ? "FLAT" : "SUBFOLDER"}\tfeatures=${feats.length}\tnum=${p["reglement_numero"] ?? "∅"}\tmill=${p["reglement_millesime"] ?? "∅"}`,
        );
      } catch (e) {
        console.log(`${slug}\t${key}\tPARSE-ERR ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!any) console.log(`${slug}\t(aucune clé S3 zonage)`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
