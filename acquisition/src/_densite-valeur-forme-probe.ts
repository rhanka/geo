/**
 * _densite-valeur-forme-probe.ts — la densité servie est-elle NUMÉRIQUE ?
 *
 * Trois faits mesurés se contredisent :
 *   - la collection de normes servie d'arundel porte 25/25 `densite_value` ;
 *   - le pli des normes sur le zonage servi est IDEMPOTENT (cellsChanged=0),
 *     donc le zonage porte déjà ces valeurs ;
 *   - le diagnostic B' compte pourtant 0 feature avec densité.
 *
 * L'explication candidate est que le diagnostic teste `finite(densite_value)` :
 * une densité stockée en TEXTE (« 1 log./ha », « 2 à 4 ») ne passe pas ce test
 * et disparaît du compte sans disparaître de la donnée.
 *
 * Cette sonde montre les valeurs VERBATIM et leur type. Elle ne convertit rien :
 * décider qu'un « 2 à 4 » vaut 2, 3 ou 4 serait exactement l'invention que ce
 * chantier interdit.
 *
 * Lecture seule stricte. N'écrit rien.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_densite-valeur-forme-probe.ts --slugs arundel,sayabec
 */
import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const index = argv.indexOf("--slugs");
  const slugs = (index >= 0 ? argv[index + 1] ?? "" : "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("usage: --slugs a,b");
  const s3 = s3Client();

  for (const slug of slugs) {
    // geo-api sert le SOUS-DOSSIER quand les deux layouts coexistent : on sonde
    // les deux plutot que de conclure sur l'objet plat.
    const candidates = [
      `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
      `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    ];
    for (const key of candidates) {
      if (!(await exists(s3, key))) continue;
      const parsed = await getGeoJsonFeatureCollection<{ properties?: Record<string, unknown> }>(s3, key);
      const features = parsed.features ?? [];
      const present = features.filter((f) => {
        const value = f.properties?.["densite_value"];
        return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
      });
      const numeric = present.filter((f) => Number.isFinite(Number(f.properties?.["densite_value"])));
      const samples = [...new Set(present.map((f) => {
        const value = f.properties?.["densite_value"];
        return `${typeof value}:${JSON.stringify(value)}`;
      }))].slice(0, 8);
      console.log(JSON.stringify({
        slug,
        key,
        polygones: features.length,
        densite_presente: present.length,
        densite_numerique: numeric.length,
        unite: [...new Set(present.map((f) => f.properties?.["densite_unit"] ?? null))].slice(0, 5),
        echantillon: samples,
      }));
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
