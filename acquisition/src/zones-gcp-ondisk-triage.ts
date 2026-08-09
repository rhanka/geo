/**
 * Triage $0 : croiser les GCP DÉJÀ dérivés sur disque (work/gcp/**) avec les slugs
 * dont zones.status != "done" dans work/coverage/coverage-matrix.json.
 *
 * Motivation (mesurée) : le blocage dominant de la lane recalage n'est plus le
 * géoréférencement mais l'ÉTIQUETTE (le dictionnaire de codes réels). Plusieurs slugs
 * portent déjà des GCP INDÉPENDANTS gatés (résidu+holdout) sans être servis.
 * Ce script les liste pour reprise immédiate, sans re-dériver quoi que ce soit.
 *
 * Usage :
 *   npx tsx acquisition/src/zones-gcp-ondisk-triage.ts [--min-indep 8] [--json]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const minIndep = Number(arg("min-indep", "3"));
const gcpRoot = resolve("work/gcp");

type GcpHit = {
  file: string;
  total: number;
  independent: number;
  residualMaxM: number | null;
  holdoutM: number | null;
};

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 3) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out, depth + 1);
    else if (e.endsWith(".json")) out.push(p);
  }
  return out;
}

function readGcp(path: string): GcpHit | null {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const gcps = Array.isArray(raw?.gcps) ? raw.gcps : Array.isArray(raw) ? raw : null;
  if (!gcps || gcps.length === 0) return null;
  const independent = gcps.filter((g: any) => g?.independent === true).length;
  return {
    file: path,
    total: gcps.length,
    independent,
    residualMaxM:
      typeof raw?.fit?.maxResidualM === "number"
        ? raw.fit.maxResidualM
        : typeof raw?.maxResidualM === "number"
          ? raw.maxResidualM
          : null,
    holdoutM:
      typeof raw?.holdout?.maxErrorM === "number"
        ? raw.holdout.maxErrorM
        : typeof raw?.holdoutMaxErrorM === "number"
          ? raw.holdoutMaxErrorM
          : null,
  };
}

const matrix = JSON.parse(readFileSync(resolve("work/coverage/coverage-matrix.json"), "utf8"));
const cities: Record<string, any> = matrix.cities ?? {};
const nonDone = new Set(
  Object.keys(cities).filter((s) => (cities[s]?.zones?.status ?? "unknown") !== "done"),
);

// Index slug -> fichiers GCP. On associe par PRÉFIXE de nom de fichier, le slug le plus
// LONG gagnant.
// ⛔ GATE D'HOMONYMIE (contamination mesurée) : l'arbitrage doit porter sur TOUS les
// slugs de la matrice, pas seulement les non-done. Sinon `saint-bruno` (non-done)
// capte `saint-bruno-de-montarville.autogcp.json` (muni DIFFÉRENTE, déjà servie) et on
// croit avoir 48 GCP gratuits sur la mauvaise municipalité.
const slugsByLength = Object.keys(cities).sort((a, b) => b.length - a.length);
const byslug = new Map<string, GcpHit[]>();

for (const path of walk(gcpRoot)) {
  const base = path.slice(gcpRoot.length + 1);
  const name = base.split("/").pop() ?? base;
  // ⛔ Les fichiers nomment le slug tantôt suivi d'un POINT (`<slug>.pass38-t3.gcp.json`)
  // tantôt d'un TIRET (`<slug>-lotC-t3.gcp.json`). Ne reconnaître que le point rate
  // silencieusement toute la seconde famille. On teste les deux, slug le plus LONG
  // d'abord pour ne pas laisser `saint-paul` capter `saint-paul-dabbotsford`.
  const slug = slugsByLength.find(
    (s) => name === `${s}.gcp.json` || name.startsWith(`${s}.`) || name.startsWith(`${s}-`),
  );
  if (!slug || !nonDone.has(slug)) continue;
  const hit = readGcp(path);
  if (!hit) continue;
  if (hit.independent < minIndep) continue;
  if (!byslug.has(slug)) byslug.set(slug, []);
  byslug.get(slug)!.push(hit);
}

const rows = [...byslug.entries()]
  .map(([slug, hits]) => {
    hits.sort((a, b) => b.independent - a.independent);
    return { slug, best: hits[0], count: hits.length };
  })
  .sort((a, b) => b.best.independent - a.best.independent);

if (has("json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  for (const r of rows) {
    console.log(
      `${r.slug}\tindep=${r.best.independent}/${r.best.total}\tresid=${r.best.residualMaxM ?? "-"}\tholdout=${r.best.holdoutM ?? "-"}\tfiles=${r.count}\t${r.best.file.slice(gcpRoot.length + 1)}`,
    );
  }
}
console.log(
  `# slugs non-done avec GCP indépendants >= ${minIndep} sur disque : ${rows.length} (sur ${nonDone.size} non-done)`,
);
