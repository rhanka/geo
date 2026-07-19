/**
 * _immo-alias-key-probe.ts — READ-ONLY: quelles clés S3 existent RÉELLEMENT pour
 * une muni servie sous DEUX slugs (tiret vs plat, cf. CADASTRE_SLUG_ALIASES) ?
 *
 * Une muni dont le cadastre vit sous une graphie plate ("lassomption") est aussi
 * servie sous le slug à tirets ("l-assomption"). Le doublon servi peut porter
 * `folded-normes=0%` alors que le jumeau porte 88%. Ce probe dit LAQUELLE des
 * trois clés (cadastre / lot-zonage / registre normes) manque de quel côté —
 * pour trancher la lane responsable sans rien deviner.
 *
 * N'écrit rien. Usage :
 *   npx tsx acquisition/src/_immo-alias-key-probe.ts --slugs l-assomption,lassomption
 */
import { exists, s3Client } from "./lib/s3.js";
import { normsKey } from "./lib/zonage-norms.js";

const PREFIXES: Array<{ label: string; key: (s: string) => string }> = [
  { label: "cadastre", key: (s) => `normalized/qc-cadastre-lots/${s}.geojson` },
  { label: "lot-zonage", key: (s) => `normalized/qc-lot-zonage/${s}.parquet` },
  { label: "norms-registry", key: (s) => normsKey(s) },
  { label: "served-qc-lots", key: (s) => `normalized/qc-lots/qc-lots-${s}.geojson` },
];

function arg(k: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? String(process.argv[i + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const slugs = arg("slugs").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("usage: --slugs a,b");
  const s3 = s3Client();
  for (const slug of slugs) {
    const marks: string[] = [];
    for (const p of PREFIXES) {
      marks.push(`${p.label}=${(await exists(s3, p.key(slug))) ? "Y" : "n"}`);
    }
    console.log(`${slug}\t${marks.join("\t")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
