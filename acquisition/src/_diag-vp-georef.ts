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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { extractGeoRef, inflatePdfText, viewportGeoRefs } from "./lib/t1-georef.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function args(name: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < process.argv.length; k++)
    if (process.argv[k] === `--${name}` && process.argv[k + 1]) out.push(process.argv[k + 1]!);
  return out;
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

// La taille de PAGE est décisive : `extractGeoRef` REJETTE (inPage) tout viewport
// dont la BBox déborde la page de plus de 5 %, ou couvre < 5 % de son aire. Un
// viewport parfaitement lu peut donc être écarté ici, silencieusement.
let pageW = 0;
let pageH = 0;
try {
  const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
  const pm = info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (pm) {
    pageW = Number(pm[1]);
    pageH = Number(pm[2]);
  }
} catch {
  /* pdfinfo absent : on retombe sur /MediaBox comme extractGeoRef */
}
console.log(`\n=== PAGE ===`);
console.log(`  pdfinfo page size : ${pageW || "?"} x ${pageH || "?"} pt`);
const mb = (hay.match(/\/MediaBox\s*\[([^\]]+)\]/) || [, ""])[1] ?? "";
console.log(`  1er /MediaBox     : [${mb.trim()}]`);

const vps = viewportGeoRefs(hay);
console.log(`\n=== viewportGeoRefs() => ${vps.length} viewport(s) ===`);
const lim = 1.05;
for (const v of vps) {
  const b = v.bbox;
  let verdict = "";
  if (pageW && pageH && b.length >= 4) {
    const maxX = Math.max(Math.abs(b[0]!), Math.abs(b[2]!));
    const maxY = Math.max(Math.abs(b[1]!), Math.abs(b[3]!));
    const area = Math.abs((b[2]! - b[0]!) * (b[3]! - b[1]!));
    const okX = maxX <= pageW * lim;
    const okY = maxY <= pageH * lim;
    const okA = area > 0.05 * pageW * pageH;
    verdict = okX && okY && okA ? " inPage=OUI" : ` inPage=NON (x:${okX ? "ok" : "DÉBORDE"} y:${okY ? "ok" : "DÉBORDE"} aire:${okA ? "ok" : "TROP PETITE"})`;
  }
  console.log(
    `  bbox=[${v.bbox.slice(0, 4).join(" ")}] gpts=${v.gpts.length} bounds=${v.bounds.length} wkt=${
      v.wkt ? v.wkt.slice(0, 30) + "…" : "(vide)"
    }${verdict}`,
  );
}

// Le SEUL verdict qui compte : ce que t1-build obtient réellement.
let geo = null;
let geoErr = "";
try {
  geo = extractGeoRef(readFileSync(pdf), pdf);
} catch (e) {
  geoErr = (e as Error).message;
}
console.log(`\n=== extractGeoRef() (ce que t1-build appelle) ===`);
console.log(
  geo
    ? `  ✅ OK — résidu max ${geo.maxResidualM.toFixed(3)} m`
    : `  ⛔ null → t1-build ABORT${geoErr ? ` (throw: ${geoErr})` : ""}`,
);

if (vps.length === 0 && count(/\/Subtype\s*\/GEO/g) > 0) {
  console.log(
    `\n⛔ FAUX NÉGATIF PROBABLE : ${count(/\/Subtype\s*\/GEO/g)} mesure(s) /GEO présentes mais 0 viewport lu.`,
  );
}

// --obj N : imprime l'objet N tel que le voit `resolveObj` (même regex). Sert à
// vérifier qu'une expansion d'ObjStm associe bien chaque corps à SON numéro : une
// mauvaise association donnerait un WKT/PROJCS pris à l'objet voisin — donc un
// géoréf FAUX en silence, ce qu'aucun gate aval ne rattraperait.
for (const objArg of args("obj")) {
  const n = Number(objArg);
  const m = hay.match(new RegExp("(?:^|[^0-9])" + n + "\\s+0\\s+obj([\\s\\S]{0,4000}?)endobj"));
  console.log(`\n=== resolveObj(${n}) ===`);
  console.log(m ? JSON.stringify(m[1]!.slice(0, Number(arg("context", "300")))) : "  (introuvable)");
  const all = [...hay.matchAll(new RegExp("(?:^|[^0-9])" + n + "\\s+0\\s+obj", "g"))].length;
  console.log(`  occurrences de "${n} 0 obj" : ${all}${all > 1 ? "  ⚠️ AMBIGU (resolveObj prend la 1re)" : ""}`);
}

for (const needle of args("grep")) {
  const hits = [...hay.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].length;
  console.log(`\n=== grep "${needle}" : ${hits} occurrence(s) ===`);
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
