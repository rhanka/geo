/**
 * _immo-norms-slug-variant-scan.ts — READ-ONLY, $0 : généralise le cas
 * `l-assomption` / `lassomption`.
 *
 * Une muni servie en `qc-lots` peut porter `folded-normes=0%` non parce qu'aucune
 * norme n'existe, mais parce que son registre normes est déposé sous une GRAPHIE
 * VOISINE du slug (apostrophe rendue avec ou sans tiret, suffixe `--<mrc>`…). Le
 * gate `_immo-lots-folded-gain` classe alors la muni `NO-NORMS` — verdict FAUX,
 * puisque le registre existe, juste sous une autre clé.
 *
 * Ce scan liste les slugs `registry/qc-zonage-norms/` et les slugs servis
 * `normalized/qc-lots/`, les normalise avec le MÊME `norm()` que le cadastre, et
 * rapporte les munis servies SANS registre exact MAIS avec un registre sous une
 * graphie normalisée identique. Il n'écrit rien et ne déduit aucune valeur.
 *
 * Usage : npx tsx acquisition/src/_immo-norms-slug-variant-scan.ts
 */
import { norm as normCadastreSlug } from "./cadastre-clip-sda.js";
import { exists, listSlugs, s3Client } from "./lib/s3.js";
import { ZONAGE_NORMS_PREFIX, normsKey } from "./lib/zonage-norms.js";

const SERVED_PREFIX = "normalized/qc-lots/";

/** `norm()` NE réunit PAS `l-assomption` et `lassomption` : il supprime
 *  l'apostrophe sans séparateur alors que le slug cadastre garde un tiret. La
 *  clé de rapprochement doit donc aussi ignorer les tirets — c'est exactement la
 *  famille que la table `CADASTRE_SLUG_ALIASES` énumère à la main. */
function looseKey(slug: string): string {
  return normCadastreSlug(slug).replace(/-/g, "");
}

async function main(): Promise<void> {
  const s3 = s3Client();

  const normsSlugs = (await listSlugs(s3, ZONAGE_NORMS_PREFIX, ".parquet", true))
    .filter((s) => s.startsWith("qc-zonage-norms-"))
    .map((s) => s.replace(/^qc-zonage-norms-/, ""));
  const byNorm = new Map<string, string[]>();
  for (const slug of normsSlugs) {
    const k = looseKey(slug);
    byNorm.set(k, [...(byNorm.get(k) ?? []), slug]);
  }

  const served = (await listSlugs(s3, SERVED_PREFIX, ".geojson", true))
    .filter((s) => s.startsWith("qc-lots-"))
    .map((s) => s.replace(/^qc-lots-/, ""))
    .sort();

  console.log(`registres normes=${normsSlugs.length} (graphies normalisées distinctes=${byNorm.size}) · servis=${served.length}`);

  let hits = 0;
  for (const slug of served) {
    if (await exists(s3, normsKey(slug))) continue; // registre exact présent
    const variants = (byNorm.get(looseKey(slug)) ?? []).filter((v) => v !== slug);
    if (variants.length === 0) continue;
    hits += 1;
    console.log(`VARIANTE\t${slug}\tregistre sous: ${variants.join(",")}`);
  }
  console.log(`\nSUMMARY servis sans registre exact mais avec variante normalisée = ${hits}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
