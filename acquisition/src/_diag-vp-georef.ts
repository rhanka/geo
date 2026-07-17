/**
 * _diag-vp-georef.ts — pourquoi t1-build dit-il « no /VP /Measure /GEO » ?
 *
 * `t1-build` ABORT est un verdict BINAIRE : il ne distingue pas « ce PDF n'a
 * aucun géoréf » (blocage d'entrée réel) de « ce PDF EN A un que le parseur ne
 * sait pas atteindre » (FAUX NÉGATIF silencieux — le plan part alors sur la
 * lane chamfer/T3 raster et y échoue pour la mauvaise raison).
 *
 * Ce diag imprime les marqueurs bruts trouvés dans le texte inflaté et ce que
 * `viewportGeoRefs()` en tire, pour trancher entre les deux.
 *
 * Usage: npx tsx acquisition/src/_diag-vp-georef.ts --pdf <f> [--context 300]
 */
import { readFileSync } from "node:fs";

import { inflatePdfText, viewportGeoRefs } from "./lib/t1-georef.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const pdf = arg("pdf");
if (!pdf) throw new Error("required: --pdf <file>");
const ctx = Number(arg("context", "300"));

const hay = inflatePdfText(readFileSync(pdf));
console.log(`hay: ${hay.length} chars`);

const count = (re: RegExp): number => (hay.match(re) ?? []).length;
console.log(`\n=== MARQUEURS BRUTS ===`);
console.log(`  /VP            : ${count(/\/VP\s*\[/g)}`);
console.log(`  /Measure       : ${count(/\/Measure/g)}`);
console.log(`  /Subtype /GEO  : ${count(/\/Subtype\s*\/GEO/g)}`);
console.log(`  /Subtype /RL   : ${count(/\/Subtype\s*\/RL/g)}   (mesure d'échelle CAD = PAS un géoréf, §2.1)`);
console.log(`  /GPTS          : ${count(/\/GPTS\s*\[/g)}`);
console.log(`  /Bounds        : ${count(/\/Bounds\s*\[/g)}`);
console.log(`  /GCS           : ${count(/\/GCS/g)}`);
console.log(`  /LGIDict       : ${count(/\/LGIDict/g)}   (GeoPDF TerraGo = autre voie)`);
console.log(`  PROJCS (WKT)   : ${count(/PROJCS/g)}`);
console.log(`  N 0 obj        : ${count(/\d+\s+0\s+obj/g)}   (objets top-level ; 0 => tout est en ObjStm)`);
console.log(`  /ObjStm        : ${count(/\/ObjStm/g)}`);

const vps = viewportGeoRefs(hay);
console.log(`\n=== viewportGeoRefs() => ${vps.length} viewport(s) ===`);
for (const v of vps)
  console.log(
    `  bbox=[${v.bbox.slice(0, 4).join(" ")}] gpts=${v.gpts.length} bounds=${v.bounds.length} wkt=${
      v.wkt ? v.wkt.slice(0, 40) + "…" : "(vide)"
    }`,
  );

if (vps.length === 0 && count(/\/Subtype\s*\/GEO/g) > 0) {
  console.log(
    `\n⛔ FAUX NÉGATIF PROBABLE : ${count(/\/Subtype\s*\/GEO/g)} mesure(s) /GEO présentes mais 0 viewport lu.`,
  );
}

const i = hay.search(/\/VP\s*\[/);
if (i >= 0) {
  console.log(`\n=== CONTEXTE du 1er /VP (offset ${i}) ===`);
  console.log(JSON.stringify(hay.slice(i, i + ctx)));
} else {
  console.log(`\n(aucun /VP[ dans le texte inflaté)`);
}
const g = hay.search(/\/Subtype\s*\/GEO/);
if (g >= 0) {
  console.log(`\n=== CONTEXTE de la 1re /Subtype /GEO (offset ${g}) ===`);
  console.log(JSON.stringify(hay.slice(Math.max(0, g - 120), g + ctx)));
}
