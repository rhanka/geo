/**
 * Affiche le VERDICT de désambiguïsation de rotation d'un rapport GCP, sans avoir à
 * lire un JSON de plusieurs milliers de lignes.
 *
 * Motif : `--rotation-disambig lots` mesure chaque orientation par lot-assignment
 * (§7.2/§8) et ne tranche QUE si c'est décisif (marge tight ≥ 15 pt, serving ≥ 70 %,
 * ≥ 3 codes). Quand il SKIP, la preuve du skip est le classement des rotations — c'est
 * ce qu'il faut consigner, pas juste « échec ».
 *
 * Usage : npx tsx acquisition/src/_gcp-disambig-verdict.ts work/gcp/<slug>-disambig.report.json
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("usage: _gcp-disambig-verdict.ts <report.json>");
const j = JSON.parse(readFileSync(path, "utf8"));

console.log(`slug   : ${j.slug}`);
console.log(`pass   : ${j.pass}`);
console.log(`reason : ${j.reason ?? "(aucune)"}`);
console.log(`cadastre_features=${j.cadastre_features} svg_points=${j.svg_points}`);

/** Trouve récursivement le bloc de désambiguïsation, quel que soit son nom exact. */
function findBlock(node: any, depth = 0): any {
  if (!node || typeof node !== "object" || depth > 4) return null;
  for (const [k, v] of Object.entries(node)) {
    if (/rotation_disamb|disambig|rotation_decision/i.test(k)) return v;
    const hit = findBlock(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

const block = findBlock(j);
if (!block) {
  console.log(`\n(aucun bloc de désambiguïsation dans ce rapport)`);
  process.exit(0);
}

const decision = block.decision ?? block;
console.log(`\n=== DÉCISION ===`);
for (const k of ["decisive", "serve", "rotation", "reason", "margin_pct", "winner"]) {
  if (decision?.[k] !== undefined) console.log(`  ${k} = ${JSON.stringify(decision[k])}`);
}

const ranking = block.ranking ?? decision?.ranking ?? block.measured ?? [];
if (Array.isArray(ranking) && ranking.length) {
  console.log(`\n=== CLASSEMENT DES ROTATIONS (tight = signal d'orientation) ===`);
  console.log(
    "extent".padEnd(14) + "rot".padStart(5) + "tight%".padStart(9) + "serving%".padStart(10) +
      "codes".padStart(7) + "resid".padStart(9) + "gcps".padStart(6),
  );
  for (const r of ranking) {
    console.log(
      String(r.extent ?? "?").padEnd(14) +
        String(r.rotation ?? "?").padStart(5) +
        String(r.coverage_pct ?? "-").padStart(9) +
        String(r.serving_coverage_pct ?? "-").padStart(10) +
        String(r.n_distinct_codes ?? "-").padStart(7) +
        String(r.residual_max_m ?? "-").padStart(9) +
        String(r.selected_gcps ?? "-").padStart(6),
    );
  }
  const best = [...ranking].sort((a, b) => (b.coverage_pct ?? 0) - (a.coverage_pct ?? 0));
  if (best.length >= 2) {
    const margin = (best[0].coverage_pct ?? 0) - (best[1].coverage_pct ?? 0);
    console.log(
      `\nmarge tight du 1er sur le 2e : ${margin.toFixed(2)} pt (seuil de décision : 15 pt)`,
    );
  }
}
