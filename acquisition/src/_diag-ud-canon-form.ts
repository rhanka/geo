/**
 * _diag-ud-canon-form — $0. Montre ce que `canonZoneCodeServe` rend pour des formes
 * de zone_code servies "exotiques" (parenthésée « 104 (AGF) » de la MRC de La Mitis,
 * lettre-au-milieu « 3-C-46 » de saint-eustache, suffixe « 16-F »). Sert à savoir si
 * le match longest-prefix de fold-usage-dominant.ts peut les atteindre SANS toucher
 * à la lib partagée.
 *
 *   npx tsx acquisition/src/_diag-ud-canon-form.ts "104 (AGF)" "3-C-46" "16-F"
 */
import { canonZoneCodeServe } from "./lib/zonage-norms.js";

const samples = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["104 (AGF)", "624 (AGC)", "9 (MTF)", "01 (CSV)", "3-C-46", "1-H-33", "16-F", "104-P", "A1-1"];

for (const s of samples) {
  const canon = canonZoneCodeServe(s);
  console.log(`${JSON.stringify(s).padEnd(14)} -> ${JSON.stringify(canon)}`);
}
