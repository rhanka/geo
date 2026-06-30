/**
 * focus30-allayers — couverture des 30 villes focus démo immo sur les 3 couches (zones/normes/pv).
 * Lecture pure de coverage-matrix.json (0 LLM, 0 réseau). Répond : les 30 sont-elles COHÉRENTES
 * (zones+normes+pv) ou faut-il un effort de complétude priorisé par couche ?
 *
 * Usage : `npx tsx acquisition/src/focus30-allayers.ts`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MATRIX = join(ROOT, "work", "coverage", "coverage-matrix.json");

const FOCUS = [
  "longueuil", "rosemere", "westmount", "hampstead", "cote-saint-luc", "dorval", "chambly",
  "saint-lambert", "mont-royal", "montreal-ouest", "brossard", "sainte-catherine", "la-prairie",
  "delson", "candiac", "montreal-est", "lile-dorval", "saint-constant", "saint-bruno-de-montarville",
  "carignan", "dollard-des-ormeaux", "pointe-claire", "saint-philippe", "saint-mathieu",
  "chateauguay", "sainte-julie", "saint-basile-le-grand", "varennes", "kirkland", "boucherville",
];

const LAYERS = ["zones", "normes", "pv"] as const;

function main(): void {
  const m = JSON.parse(readFileSync(MATRIX, "utf8"));
  const cities = m.cities ?? {};
  const tally: Record<string, number> = { zones: 0, normes: 0, pv: 0 };
  const missing: Record<string, string[]> = { zones: [], normes: [], pv: [] };
  const rows: string[] = [];
  for (const s of FOCUS) {
    const c = cities[s] ?? {};
    const cells = LAYERS.map((l) => {
      const done = c[l]?.status === "done";
      if (done) tally[l]++;
      else missing[l].push(s);
      return done ? "✓" : "·";
    });
    rows.push(`  ${s.padEnd(30)} z:${cells[0]} n:${cells[1]} p:${cells[2]}`);
  }
  console.log("FOCUS-30 par couche (z=zones n=normes p=pv) :");
  console.log(rows.join("\n"));
  console.log(`\nTOTAUX /30 : zones=${tally.zones} · normes=${tally.normes} · pv=${tally.pv}`);
  for (const l of LAYERS) {
    if (missing[l].length) console.log(`MANQUE ${l} (${missing[l].length}): ${missing[l].join(", ")}`);
  }
}

main();
