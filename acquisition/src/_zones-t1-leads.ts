/**
 * _zones-t1-leads.ts — LE gisement T1 restant : les PDF sur disque qui portent un
 * géoréf embarqué EXPLOITABLE (`extractGeoRef() != null`) ET dont le slug est
 * encore `zones.status != done`.
 *
 * POURQUOI : `_zones-geopdf-falseneg-sweep.ts` balaie tout le corpus sans savoir
 * quelles munis restent à servir ; l'inverse (`_zones-leads-scan.ts`) sait qui
 * reste mais pas si le PDF est géoréférencé. Le croisement est la seule liste
 * ACTIONNABLE de la voie T1 — la moins chère (0 $, 0 vision) et la plus sûre
 * (le géoréf vient du document, pas d'un ajustement).
 *
 * Le script rapporte aussi, pour chaque candidat, si `pdftotext` lit des codes
 * de zone (voie `--labels text`, $0) ou 0 (plan GLYPHES ⇒ voie vision + dict).
 *
 * Usage: npx tsx acquisition/src/_zones-t1-leads.ts [--roots work] [--min-size N]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { extractGeoRef } from "./lib/t1-georef.js";

function opt(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const raw = JSON.parse(readFileSync("work/coverage/coverage-matrix.json", "utf8"));
const notDone = Object.entries(raw.cities as Record<string, any>)
  .filter(([, v]: any) => v?.zones?.status && v.zones.status !== "done")
  .map(([k]) => k)
  .sort((a, b) => b.length - a.length);

const minSize = Number(opt("min-size") ?? 20000);
const roots = (opt("roots") ?? "work").split(",");

function matchSlug(name: string): string | undefined {
  const n = name.toLowerCase().replace(/_/g, "-");
  for (const s of notDone) {
    if (n.startsWith(s)) {
      const rest = n.slice(s.length);
      if (rest === "" || /^[-._]/.test(rest)) return s;
    }
  }
  return undefined;
}

const bySlug = new Map<string, { path: string; size: number }[]>();
function walk(dir: string, depth: number) {
  if (depth > 8) return;
  let ents: string[];
  try {
    ents = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of ents) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (/\.pdf$/i.test(e) && st.size >= minSize) {
      const s = matchSlug(e);
      if (s) {
        const arr = bySlug.get(s) ?? [];
        // dédoublonne par taille : les lots de recalage recopient le MÊME pdf
        if (!arr.some((x) => x.size === st.size)) arr.push({ path: p, size: st.size });
        bySlug.set(s, arr);
      }
    }
  }
}
for (const r of roots) walk(r, 0);

interface Lead {
  slug: string;
  path: string;
  crs: string;
  residM: number;
  scale: number;
  codeLike: number;
  distinct: number;
  title: string;
}
const leads: Lead[] = [];
let probed = 0;

const CODE_RE = /^[A-Z]{1,3}-?\d{1,4}[a-z]?$/;

for (const [slug, files] of [...bySlug.entries()].sort()) {
  for (const f of files) {
    probed++;
    let geo = null;
    try {
      geo = extractGeoRef(readFileSync(f.path), f.path);
    } catch {
      geo = null;
    }
    if (!geo) continue;
    // Voie labels : combien de jetons ressemblent à un code de zone ?
    let words: string[] = [];
    let title = "";
    try {
      const txt = execFileSync("pdftotext", ["-f", "1", "-l", "1", f.path, "-"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      words = txt.split(/\s+/).filter(Boolean);
      title = (txt.match(/(MUNICIPALIT[ÉE][^\n]{0,60}|VILLE DE[^\n]{0,40}|PLAN DE ZONAGE[^\n]{0,40})/i) ?? [""])[0].trim();
    } catch {
      /* scan sans couche texte */
    }
    const codeLike = words.filter((w) => CODE_RE.test(w)).length;
    const distinct = new Set(words.filter((w) => CODE_RE.test(w))).size;
    leads.push({
      slug,
      path: f.path,
      crs: geo.crsName,
      residM: geo.maxResidualM ?? -1,
      scale: (geo as any).scaleMPerPt ?? -1,
      codeLike,
      distinct,
      title,
    });
  }
}

console.log(`slugs zones!=done avec pdf = ${bySlug.size} · pdf sondés = ${probed} · GÉORÉF EMBARQUÉ = ${leads.length}\n`);
const servable = leads.filter((l) => l.distinct >= 3).sort((a, b) => a.residM - b.residM);
const glyph = leads.filter((l) => l.distinct < 3).sort((a, b) => a.residM - b.residM);

console.log(`=== ⭐ T1 --labels text SERVABLE (>=3 codes lus, $0) : ${servable.length} ===`);
for (const l of servable)
  console.log(
    `  ${l.slug.padEnd(32)} resid=${l.residM.toFixed(2).padStart(8)}m codes=${String(l.distinct).padStart(3)} ${l.crs}  ${l.path}${l.title ? "\n      titre: " + l.title : ""}`,
  );

console.log(`\n=== ⏳ GÉORÉF OK mais codes GLYPHES (<3 lus) → voie vision + dict : ${glyph.length} ===`);
for (const l of glyph)
  console.log(
    `  ${l.slug.padEnd(32)} resid=${l.residM.toFixed(2).padStart(8)}m codes=${String(l.distinct).padStart(3)} ${l.crs}  ${l.path}${l.title ? "\n      titre: " + l.title : ""}`,
  );
