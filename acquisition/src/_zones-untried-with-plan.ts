/**
 * _zones-untried-with-plan.ts — le gisement JAMAIS TENTÉ, plan déjà sur disque.
 *
 * [[recalage-pdf-lever-exhausted]] dit vrai sur le RÉSIDU (161 rejets
 * résidu+holdout, épuisés) et sur le bucket `candidateTracks` PDF (générique,
 * ne prouve aucun PDF). Mais « déjà rejeté » et « jamais tenté » sont deux
 * états différents, et seul le second est du gisement : un slug qui a son plan
 * sur disque ET zéro trace de run n'a jamais rencontré les gates.
 *
 * Croise à $0, sans réseau :
 *   - la matrice (`zones.status != done`) ;
 *   - les plans PDF réellement présents (même balayage que
 *     `_ondisk-plan-gisement.ts`) ;
 *   - les traces de run dans `work/gcp/` : `*.report.json` ET `*.gcp.json`.
 *
 * ⚠️ Ancrage des noms de fichiers : un rapport s'appelle `<slug><suffixe de
 * run>.report.json` (`-lotA`, `-rot0`, `-retry2-…`, `-urbain`, `-chamfer`) —
 * on ancre donc sur le PLUS LONG slug de la matrice qui préfixe le nom, sinon
 * `saint-come` capterait les runs de `saint-come-liniere`.
 *
 * ⛔ Un slug listé ici n'est PAS un dépôt promis : le plan peut être un mauvais
 * document (saint-adelphe = carte routière, 30 GCP dormants pour 0 code), et le
 * blocage dominant reste l'ÉTIQUETTE (dict) puis la COMPLÉTUDE (périmètre
 * d'urbanisation renvoyé à un encart). REGARDER la page avant de recaler.
 *
 * Usage: npx tsx acquisition/src/_zones-untried-with-plan.ts [--json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const matrix = JSON.parse(readFileSync(resolve("work/coverage/coverage-matrix.json"), "utf8")) as {
  cities: Record<string, { zones?: { status?: string } }>;
};
const nonDone = Object.keys(matrix.cities).filter((s) => matrix.cities[s]?.zones?.status !== "done");
const bySlugLen = [...nonDone].sort((a, b) => b.length - a.length);
/** Tous les slugs de la matrice, pour ancrer un rapport même déjà `done`. */
const allByLen = Object.keys(matrix.cities).sort((a, b) => b.length - a.length);

function walk(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
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
}

const pdfs: string[] = [];
for (const d of ["work/zonage-plans", "work/zones-recalage", "work/zonage-pdf", "work/pdf", "work/recalage-shard0"])
  walk(d, pdfs);

function slugOf(path: string, pool: string[]): string | null {
  const base = path.toLowerCase().replace(/[_\s]+/g, "-");
  for (const s of pool) if (base.includes(s)) return s;
  return null;
}

/**
 * Slugs portant une trace de run (rapport OU GcpFile).
 *
 * ⚠️ Ne PAS se limiter à `work/gcp/` : des runs déposent leur rapport à côté du
 * PDF, dans `work/zones-recalage/<shard>/` (mesuré : `eastman` y a
 * `eastman-perimetre-t2-report.json` + `-disambig-report.json`, ~20 tentatives,
 * et un balayage `work/gcp`-seul le recomptait « jamais tenté » à chaque passe).
 */
const tried = new Set<string>();
/**
 * `anyJson` : dans `work/gcp/` TOUT .json est une trace de run (c'est le dossier
 * des calages). Ailleurs, filtrer sur le nom — `work/zones-recalage/` contient
 * aussi des .json de données qui ne prouvent aucune tentative.
 */
function collectRunTraces(dir: string, anyJson: boolean): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectRunTraces(p, anyJson);
      continue;
    }
    if (!/\.json$/i.test(e)) continue;
    // *-t2-report.json / *-disambig-report.json / *.autogcp.report.json …
    if (!anyJson && !/gcp|report|autogcp|disambig|register|chamfer|seed/i.test(e)) continue;
    const s = slugOf(e, allByLen);
    if (s) tried.add(s);
  }
}
collectRunTraces("work/gcp", true);
collectRunTraces("work/zones-recalage", false);

const withPlan = new Map<string, { path: string; rot: number; pages: number }[]>();
for (const p of pdfs) {
  const s = slugOf(p, bySlugLen);
  if (!s) continue;
  if (!withPlan.has(s)) withPlan.set(s, []);
  withPlan.get(s)!.push({ path: p, rot: 0, pages: 0 });
}

const untried = [...withPlan.keys()].filter((s) => !tried.has(s)).sort();

const rows = untried.map((slug) => {
  const files = withPlan.get(slug)!;
  for (const f of files) {
    try {
      const info = execFileSync("pdfinfo", [f.path], {
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const rm = info.match(/Page rot:\s*(-?\d+)/);
      f.rot = rm ? ((Number(rm[1]) % 360) + 360) % 360 : 0;
      const pm = info.match(/Pages:\s*(\d+)/);
      f.pages = pm ? Number(pm[1]) : 0;
    } catch {
      /* PDF illisible : laissé à 0/0, il se verra au rendu */
    }
  }
  return { slug, files };
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ n_non_done: nonDone.length, n_with_plan: withPlan.size, untried: rows }, null, 2));
} else {
  console.log(
    `zones non-done=${nonDone.length} · avec plan sur disque=${withPlan.size} · portant une trace de run=${
      withPlan.size - untried.length
    }`,
  );
  console.log(`\n=== JAMAIS TENTÉS (plan sur disque, 0 rapport ET 0 GcpFile) : ${rows.length} ===`);
  for (const { slug, files } of rows) {
    const rot = files.some((f) => f.rot !== 0) ? " *ROT*" : "";
    console.log(`  ${slug}${rot}`);
    for (const f of files) console.log(`      rot=${f.rot} pages=${String(f.pages).padStart(3)} ${f.path}`);
  }
  console.log(
    `\n⚠️ Un plan sur disque ne promet rien : REGARDER la page d'abord (mauvais document),` +
      ` puis le dict, puis la complétude (périmètre d'urbanisation non étiqueté).`,
  );
}
