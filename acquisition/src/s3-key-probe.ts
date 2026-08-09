/**
 * s3-key-probe.ts — HEAD-probe (fortement cohérent) l'existence de clés zonage /
 * qc-lots pour un ou plusieurs slugs. Sert à vérifier un purge (list S3 est
 * éventuellement cohérent ; HEAD ne l'est pas) sans imprimer de secret.
 *
 *   npx tsx acquisition/src/s3-key-probe.ts <slug> [...]
 *
 * Pour chaque slug imprime la présence de:
 *   zones  = normalized/ca-qc-zonage/qc-zonage-<slug>.geojson
 *   lots   = normalized/qc-lots/qc-lots-<slug>.geojson
 */
import { exists, listSlugs, s3Client } from "./lib/s3.js";

const argv = process.argv.slice(2);
const s3 = s3Client();

const findIdx = argv.indexOf("--find");
if (findIdx >= 0) {
  // Cherche des slugs cadastre / zones / lots contenant une sous-chaîne.
  const needle = (argv[findIdx + 1] ?? "").toLowerCase();
  const cad = await listSlugs(s3, "normalized/qc-cadastre-lots/", ".geojson", true);
  const zon = await listSlugs(s3, "normalized/ca-qc-zonage/", ".geojson", true);
  const lot = await listSlugs(s3, "normalized/qc-lots/", ".geojson", true);
  const hit = (arr: string[]) => arr.filter((s) => s.toLowerCase().includes(needle)).sort();
  console.log(`cadastre: ${hit(cad).join(", ") || "(aucun)"}`);
  console.log(`zones:    ${hit(zon).map((s) => s.replace(/^qc-zonage-/, "")).join(", ") || "(aucun)"}`);
  console.log(`lots:     ${hit(lot).map((s) => s.replace(/^qc-lots-/, "")).join(", ") || "(aucun)"}`);
} else {
  const slugs = argv.map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("usage: npx tsx acquisition/src/s3-key-probe.ts <slug> [...] | --find <substr>");
    process.exit(2);
  }
  for (const slug of slugs) {
    const zones = await exists(s3, `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`);
    const lots = await exists(s3, `normalized/qc-lots/qc-lots-${slug}.geojson`);
    console.log(`${slug} zones=${zones ? "Y" : "n"} lots=${lots ? "Y" : "n"}`);
  }
}
