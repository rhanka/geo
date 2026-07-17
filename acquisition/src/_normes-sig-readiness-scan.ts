// _normes-sig-readiness-scan — $0 : un dépôt de grille de normes est STRUCTURELLEMENT
// impossible quand la muni n'a pas de grille SIG exploitable, puisque le gate
// anti-invention exige overlap != 0 contre les zone_codes réellement servis.
//
// Ce scan mesure, par slug, l'état de la référence d'overlap AVANT toute dépense :
//   NO-GRID      : resolveGridKey => NONE (aucune collection zonage servie)
//   EMPTY        : grille servie mais 0 code
//   AFFECTATION  : les codes sont des affectations/vocations (AGR, URB, CON-A…) et non
//                  des zone_codes — cf. gate « rejet affectation » (memoire zonage-acquisition-qa-gate)
//   NUMERIC      : codes purement numériques (« 06 », « 16 ») — famille champlain, --sig-recode
//   OK           : n zone_codes de forme Lettre-Num
//
// Usage: npx tsx acquisition/src/_normes-sig-readiness-scan.ts --shard 0 --of 2
//        npx tsx acquisition/src/_normes-sig-readiness-scan.ts --slugs "a,b,c"
import fs from 'node:fs';
import path from 'node:path';

import { s3Client } from './lib/s3.js';
import { loadSigCanonCodes, resolveGridKey } from './lib/zonage-norms.js';

const argv = process.argv.slice(2);
function arg(name: string, def = ''): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

/** Affectations/vocations du schéma d'aménagement — jamais des zone_codes. */
const AFFECTATION_RE = /^(AGR|AGF|URB|RUR|REC|CON|EXT|HBD|IND|PUB|VIL|FOR|MULTI|COM)(-[A-Z])?$/;
const LETTER_NUM_RE = /^[A-Z]{1,4}-?\d{1,4}$/;

function classify(codes: string[]): string {
  if (!codes.length) return 'EMPTY';
  const aff = codes.filter((c) => AFFECTATION_RE.test(c)).length;
  const num = codes.filter((c) => /^\d+$/.test(c)).length;
  const ln = codes.filter((c) => LETTER_NUM_RE.test(c)).length;
  if (aff === codes.length) return 'AFFECTATION';
  if (num === codes.length) return 'NUMERIC';
  if (ln >= codes.length * 0.7) return 'OK';
  return 'MIXED';
}

async function main(): Promise<void> {
  let slugs = arg('slugs').split(',').map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) {
    const shard = Number(arg('shard', '0'));
    const of = Number(arg('of', '2'));
    const matrix = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'work/coverage/coverage-matrix.json'), 'utf8'),
    );
    const prod: string[] = [];
    for (const [slug, l] of Object.entries<any>(matrix.cities ?? {})) {
      if (l?.zones?.status === 'done' && l?.normes?.status !== 'done') prod.push(slug);
    }
    prod.sort();
    slugs = prod.filter((_, i) => i % of === shard);
  }
  const s3 = s3Client();
  const tally: Record<string, number> = {};
  for (const slug of slugs) {
    let verdict: string, n = 0;
    try {
      const key = await resolveGridKey(s3, slug);
      if (!key) verdict = 'NO-GRID';
      else {
        const codes = [...(await loadSigCanonCodes(s3, slug))].sort();
        n = codes.length;
        verdict = classify(codes);
      }
    } catch (e: any) {
      verdict = `ERR ${String(e?.message ?? e).slice(0, 40)}`;
    }
    tally[verdict.split(' ')[0]] = (tally[verdict.split(' ')[0]] ?? 0) + 1;
    console.log(`${verdict}\tsig=${n}\t${slug}`);
  }
  console.log(`\n# ${slugs.length} slug(s) — ${JSON.stringify(tally)}`);
  console.log('# seul OK (et NUMERIC via --sig-recode) peut franchir le gate overlap!=0.');
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
