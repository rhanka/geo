/**
 * Triage des rapports de recalage déjà produits (`work/gcp/*.report.json`).
 *
 * Motif : avant de (re)lancer un auto-seed sur un slug, savoir ce que les passes
 * précédentes ont DÉJÀ prouvé. Ce script n'invente rien : il lit les rapports
 * committés/locaux et dénombre `pass` + la `reason` de rejet, normalisée en
 * familles (résidu / iso-gate / entrée absente / ...).
 *
 * Usage : npx tsx acquisition/src/_gcp-reports-triage.ts [--reasons] [--slug <s>]
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const dir = resolve("work/gcp");
const only = arg("slug");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

/** Normalise une raison libre en famille stable (pour dénombrer). */
function family(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("orientation/isotropy") || r.includes("anisotropy") || r.includes("north-up")) {
    return "iso-gate (aniso/orientation) — fit géométriquement suspect";
  }
  if (r.includes("independent parcel") || r.includes("after residual pruning")) {
    return "0 appariement de parcelles — pas de vecteur exploitable / seed faux";
  }
  if (r.includes("residual+holdout")) return "résidu+holdout > seuil";
  if (r.includes("svg")) return "SVG/vecteur absent";
  return reason.slice(0, 90);
}

let pass = 0;
let fail = 0;
let unreadable = 0;
const reasons = new Map<string, number>();
const passers: string[] = [];

for (const f of files) {
  if (only && !f.includes(only)) continue;
  let j: any;
  try {
    j = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  } catch {
    unreadable++;
    continue;
  }
  if (j?.pass === true) {
    pass++;
    passers.push(`${f}  best=${JSON.stringify(j.best ?? {})} residual=${j.residual_max_m}m gcps=${j.selected_gcps}`);
    continue;
  }
  if (j?.pass === false) {
    fail++;
    const fam = family(String(j.reason ?? "(sans reason)"));
    reasons.set(fam, (reasons.get(fam) ?? 0) + 1);
  }
}

console.log(`rapports lus : ${pass + fail} (pass=${pass} · fail=${fail} · illisibles=${unreadable})`);
if (passers.length) {
  console.log(`\n=== PASS (fit retenu) ===`);
  for (const p of passers) console.log(`  ${p}`);
}
console.log(`\n=== familles de REJET ===`);
[...reasons.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`${String(v).padStart(4)}  ${k}`));
