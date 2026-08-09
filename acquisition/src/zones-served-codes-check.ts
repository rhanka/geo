/**
 * zones-served-codes-check — contrôle de CONTENU (anti-invention) des collections
 * zonage réellement déposées en S3. Pour chaque slug, lit
 * normalized/ca-qc-zonage/qc-zonage-<slug>.geojson et rapporte :
 *   - nb features, nb codes distincts
 *   - la liste des zone_codes
 *   - drapeaux de pollution : numéros de lots (P-#### / L-#### / grand nombre nu),
 *     séquentiel pur (OBJECTID/NO_ZONE), affectation (CMM/PMAD/SAD/inondable...).
 *
 * Un dépôt SAIN = codes réglementaires lettrés à petit indice (H-3, RA-101, RUR-11).
 * Un dépôt SUSPECT = P-2764, 100001, OBJECTID, "milieux humides"...
 *
 * Usage : npx tsx acquisition/src/zones-served-codes-check.ts <slug> [<slug> ...]
 */
import { getBytes, s3Client } from "./lib/s3.js";
import type { FeatureCollection } from "geojson";

const AFFECTATION = /(CMM|PMAD|SAD|milieux[_\s-]?humides|inondable|agricole|conservation|villegiature)/i;
// numéro de lot / partie-de-lot : lettre P/L + ≥3 chiffres, ou nombre nu ≥ 4 chiffres
const LOTNUM = /^(P|L|PT|PL)[-\s]?\d{3,}$/i;
const BARE_BIGNUM = /^\d{4,}$/;

function classify(code: string): string | null {
  const c = code.trim();
  if (LOTNUM.test(c)) return "lot-number";
  if (BARE_BIGNUM.test(c)) return "bare-bignum";
  if (AFFECTATION.test(c)) return "affectation";
  return null;
}

async function checkSlug(slug: string): Promise<void> {
  const s3 = s3Client();
  const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
  let fc: FeatureCollection;
  try {
    fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as FeatureCollection;
  } catch (e) {
    console.log(`\n=== ${slug} : ABSENT/illisible en S3 (${String(e).slice(0, 80)})`);
    return;
  }
  const feats = fc.features ?? [];
  const codes = new Map<string, number>();
  for (const f of feats) {
    const code = String((f.properties as any)?.zone_code ?? "");
    codes.set(code, (codes.get(code) ?? 0) + 1);
  }
  const distinct = [...codes.keys()].sort();
  const suspects = distinct.map((c) => ({ code: c, flag: classify(c) })).filter((x) => x.flag);
  const lettered = distinct.filter((c) => /[A-Za-z]/.test(c) && /\d/.test(c));
  console.log(`\n=== ${slug} : ${feats.length} features · ${distinct.length} codes distincts · ${lettered.length} lettrés`);
  console.log(`  codes : ${distinct.join(", ")}`);
  if (suspects.length) {
    console.log(`  ⚠ SUSPECTS (${suspects.length}) : ${suspects.map((s) => `${s.code}[${s.flag}]`).join(", ")}`);
  } else {
    console.log(`  ✓ aucun code suspect (pas de lot-number / bignum / affectation)`);
  }
}

async function main(): Promise<void> {
  const slugs = process.argv.slice(2);
  if (!slugs.length) throw new Error("usage: zones-served-codes-check.ts <slug> [<slug> ...]");
  for (const s of slugs) await checkSlug(s);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
