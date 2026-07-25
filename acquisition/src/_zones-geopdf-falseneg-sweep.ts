/**
 * _zones-geopdf-falseneg-sweep.ts — le gisement « faux non-GeoPDF » (lecture seule, $0)
 *
 * POURQUOI : `t1-build` ABORT « no /VP /Measure /GEO » est un verdict BINAIRE. Il
 * confond « ce PDF n'a aucun géoréf » (blocage d'entrée réel) et « ce PDF EN a un
 * que le parseur ne sait pas atteindre » (FAUX NÉGATIF). Dans le second cas le plan
 * part sur la lane chamfer/T3 raster et y échoue POUR LA MAUVAISE RAISON — en
 * consommant du temps et parfois de l'argent, alors qu'un T1 rendrait un géoréf
 * exact avec des labels $0.
 *
 * `_diag-vp-georef.ts` tranche ce doute pour UN pdf. Celui-ci le fait pour le
 * CORPUS, afin de mesurer le gisement AVANT d'investir dans un chantier de parseur.
 *
 * ⛔ LE PRÉDICAT DÉCISIF EST `extractGeoRef() === null`, PAS `viewportGeoRefs()==0`.
 * MESURÉ (2026-07-17) : une 1re version de ce balayeur comptait 39 « faux négatifs »
 * sur `/Subtype/GEO > 0 ∧ viewportGeoRefs()==0` — un gisement IMAGINAIRE. `extractGeoRef`
 * possède une SECONDE voie, `geoMeasures()`, qui s'ancre sur /GPTS avec 6 ko de contexte
 * et lit donc les mesures même concaténées dans un ObjStm, SANS passer par les viewports.
 * Un viewport illisible ne fait donc pas un ABORT. Ne jamais rapporter un gisement sur
 * un prédicat interne : mesurer ce que `t1-build` appelle RÉELLEMENT.
 *
 * ⚠️ /Subtype/RL est EXCLU du verdict : c'est une mesure d'échelle CAD, PAS un
 * géoréf (§2.1 de la spec) — la confondre fabriquerait un gisement imaginaire.
 *
 * Usage: npx tsx acquisition/src/_zones-geopdf-falseneg-sweep.ts [--dir work/pdf ...] [--limit N]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { extractGeoRef, inflatePdfText, viewportGeoRefs } from "./lib/t1-georef.js";

const DEFAULT_DIRS = [
  "work/zonage-plans",
  "work/pdf",
  "work/zones-recalage",
  "work/zonage-pdf",
  "work/recalage-shard0",
];

function args(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++)
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  return out;
}
function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

function walk(dir: string, acc: string[] = []): string[] {
  let ents: string[];
  try {
    ents = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of ents) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, acc);
    else if (e.toLowerCase().endsWith(".pdf")) acc.push(p);
  }
  return acc;
}

const dirs = args("dir").length ? args("dir") : DEFAULT_DIRS;
const limit = Number(arg("limit", "100000"));
const pdfs = dirs.flatMap((d) => walk(d)).slice(0, limit);

console.log(`balayage: ${pdfs.length} PDF sur ${dirs.length} dossier(s)\n`);

interface Row {
  path: string;
  geo: number;
  rl: number;
  vps: number;
  objstm: number;
  /** Le seul verdict qui compte : ce que t1-build obtient réellement. */
  extracted: boolean;
  residM?: number;
  err?: string;
}
const rows: Row[] = [];

for (const p of pdfs) {
  try {
    const buf = readFileSync(p);
    // Budget serré : les dicts de géoréf sont minuscules ; inutile d'assembler
    // 400 Mo pour un plan A0 dont on ne lit que les marqueurs.
    const hay = inflatePdfText(buf, { maxChars: 48 * 1024 * 1024 });
    const count = (re: RegExp): number => (hay.match(re) ?? []).length;
    let geoRef = null;
    try {
      geoRef = extractGeoRef(buf, p);
    } catch {
      geoRef = null;
    }
    rows.push({
      path: p,
      geo: count(/\/Subtype\s*\/GEO/g),
      rl: count(/\/Subtype\s*\/RL/g),
      vps: viewportGeoRefs(hay).length,
      objstm: count(/\/ObjStm/g),
      extracted: geoRef !== null,
      residM: geoRef?.maxResidualM,
    });
  } catch (e) {
    rows.push({ path: p, geo: 0, rl: 0, vps: 0, objstm: 0, extracted: false, err: (e as Error).message });
  }
}

// LE gisement : le PDF porte une mesure /GEO et t1-build n'en tire RIEN.
const trueNeg = rows.filter((r) => r.geo > 0 && !r.extracted);
// Lisibles par la voie geoMeasures alors que les viewports sont muets : PAS un blocage.
const vpBlindOnly = rows.filter((r) => r.geo > 0 && r.extracted && r.vps === 0);
const ok = rows.filter((r) => r.extracted);
const rlOnly = rows.filter((r) => r.geo === 0 && r.rl > 0);
const errs = rows.filter((r) => r.err);

console.log(`=== ⛔ VRAIS FAUX NÉGATIFS (/Subtype/GEO > 0 ∧ extractGeoRef()==null) : ${trueNeg.length} ===`);
for (const r of trueNeg)
  console.log(
    `  GEO=${String(r.geo).padStart(3)} vps=${String(r.vps).padStart(2)} objstm=${String(r.objstm).padStart(3)}  ${r.path}`,
  );

console.log(
  `\n=== ✅ T1 EXTRAIT (extractGeoRef non-null) : ${ok.length} — dont ${vpBlindOnly.length} via geoMeasures SEULE (viewports muets, sans conséquence) ===`,
);
for (const r of ok)
  console.log(
    `  resid=${(r.residM ?? 0).toFixed(2).padStart(7)}m vps=${String(r.vps).padStart(2)}${r.vps === 0 ? " (geoMeasures)" : ""}  ${r.path}`,
  );

console.log(`\n=== /Subtype/RL seul (mesure CAD, PAS un géoréf — §2.1) : ${rlOnly.length} ===`);
for (const r of rlOnly.slice(0, 10)) console.log(`  RL=${r.rl}  ${r.path}`);

if (errs.length) {
  console.log(`\n=== erreurs de lecture : ${errs.length} ===`);
  for (const r of errs.slice(0, 10)) console.log(`  ${r.path} :: ${r.err}`);
}

console.log(
  `\nRÉSUMÉ : ${rows.length} PDF · VRAIS-faux-négatifs=${trueNeg.length} · T1-extraits=${ok.length} (dont ${vpBlindOnly.length} viewports-muets-mais-OK) · RL-seul=${rlOnly.length} · erreurs=${errs.length}`,
);
console.log(
  `⚠️ Un T1 extrait n'est PAS un dépôt : il donne le géoréf, pas les ÉTIQUETTES ni la complétude de la feuille.`,
);
