/**
 * _normes-sig-sanity — diagnostic $0. Classe la QUALITÉ des codes SIG servis.
 *
 * POURQUOI : le gate normes exige `overlap != 0` entre les codes de la grille et
 * les codes SIG servis. Un overlap 0 est spontanément lu comme « mauvaise grille /
 * millésime disjoint ». Mais il peut aussi venir d'un SIG DÉFECTUEUX : couche
 * d'AFFECTATION du schéma d'aménagement (AGRICOLE, COMMERCIALE…) au lieu du zonage,
 * codes dégénérés (A/B/C/D), ou numéros nus (06/16/18). Dans ces cas la grille est
 * saine et c'est la lane ZONES qu'il faut corriger — ré-extraire les normes ne
 * servirait à rien.
 *
 * Usage: npx tsx acquisition/src/_normes-sig-sanity.ts --slugs "a,b,c"
 */
import { s3Client } from "./lib/s3.js";
import { loadSigCanonCodes } from "./lib/zonage-norms.js";

function arg(name: string, def = ""): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** Mots d'AFFECTATION (schéma d'aménagement) — jamais des codes de zonage. */
const AFFECT = /^(AGRICOLE|COMMERCIAL|CONSERVATION|HAMEAU|INDUSTRIEL|INSTITUTIONNEL|MIXTE|RESIDENTIEL|RECREATIF|FORESTIER|PUBLIC|URBAIN|RURAL|VILLEGIATURE)/i;

function classify(codes: string[]): string {
  if (!codes.length) return "VIDE (aucun code servi)";
  const affect = codes.filter((c) => AFFECT.test(c.replace(/[\s,]/g, "")));
  if (affect.length >= Math.max(2, codes.length * 0.5))
    return `AFFECTATION (${affect.length}/${codes.length} mots d'affectation) — zonage NON servi`;
  const numeric = codes.filter((c) => /^\d+$/.test(c));
  if (numeric.length >= Math.max(2, codes.length * 0.8))
    return `NUMÉROS-NUS (${numeric.length}/${codes.length}) — préfixe de catégorie absent`;
  const single = codes.filter((c) => /^[A-Za-z]{1,2}$/.test(c));
  if (single.length >= Math.max(2, codes.length * 0.8))
    return `DÉGÉNÉRÉ (${single.length}/${codes.length} codes d'1-2 lettres, sans numéro)`;
  // Séparateur POINT inclus : la famille MRC de Montmagny code `AC.1`/`CBM.1`.
  // Sans le `.`, ces codes tombaient en INDÉTERMINÉ et ~160 zones VIVES étaient
  // lues comme mortes (faux négatif du gate, pas un défaut du SIG).
  const real = codes.filter((c) => /^[A-Za-z]{1,4}[ .-]?\d{1,4}$/.test(c));
  if (real.length >= Math.max(1, codes.length * 0.5))
    return `RÉEL (${real.length}/${codes.length} de forme Lettre-Num)`;
  return `INDÉTERMINÉ (${codes.length} codes)`;
}

async function main(): Promise<void> {
  const slugs = arg("--slugs").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) throw new Error('usage: --slugs "a,b,c"');
  const s3 = s3Client();
  for (const slug of slugs) {
    let codes: string[] = [];
    let err = "";
    try {
      codes = [...(await loadSigCanonCodes(s3, slug))].sort();
    } catch (e: any) {
      err = String(e?.message ?? e).slice(0, 50);
    }
    const verdict = err ? `ERR ${err}` : classify(codes);
    const sample = codes.slice(0, 6).join(",");
    console.log(`${slug}\tn=${codes.length}\t${verdict}\t[${sample}${codes.length > 6 ? ",…" : ""}]`);
  }
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
