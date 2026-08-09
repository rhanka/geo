/**
 * Isole la famille de rejet « orientation ambiguity » dans les rapports de
 * recalage déjà produits (`work/gcp/*.report.json`).
 *
 * Motif : `_gcp-reports-triage.ts` dénombre les familles mais ne nomme pas les
 * slugs. Or la mémoire projet [[recalage-pdf-lever-exhausted]] établit que cette
 * famille précise est SOLUBLE (saint-jerome servi en relançant
 * `--rotation-disambig lots`), contrairement au résidu (épuisé) et à l'entrée
 * absente. Ce script n'invente rien : il lit les rapports, extrait le slug en
 * l'ancrant sur la liste RÉELLE des slugs de la matrice (plus long préfixe
 * gagnant — les fichiers portent des suffixes de run `-lotA`, `-rot0`,
 * `-retry2-20260712`), et croise avec `zones.status`.
 *
 * Usage : npx tsx acquisition/src/_zones-orientation-ambiguity-triage.ts [--family <mot>] [--all]
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const familyNeedle = (arg("family", "orientation ambiguity") as string).toLowerCase();
const showAll = process.argv.includes("--all");

const matrix = JSON.parse(readFileSync(resolve("work/coverage/coverage-matrix.json"), "utf8"));
const cities: Record<string, any> = matrix.cities ?? {};
// Trie par longueur décroissante : « saint-roch-ouest » doit gagner sur « saint-roch ».
const slugsByLen = Object.keys(cities).sort((a, b) => b.length - a.length);

/** Ancre un nom de fichier de rapport sur un slug RÉEL de la matrice. */
function slugOf(file: string): string | null {
  const base = file.replace(/\.json$/, "");
  for (const s of slugsByLen) if (base === s || base.startsWith(`${s}.`) || base.startsWith(`${s}-`)) return s;
  return null;
}

const dir = resolve("work/gcp");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

type Row = { slug: string; file: string; status: string; reason: string };
const hits: Row[] = [];
const unmapped: string[] = [];

for (const f of files) {
  let j: any;
  try {
    j = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  } catch {
    continue;
  }
  if (j?.pass !== false) continue;
  const reason = String(j.reason ?? "");
  if (!showAll && !reason.toLowerCase().includes(familyNeedle)) continue;
  const slug = slugOf(f);
  if (!slug) {
    unmapped.push(f);
    continue;
  }
  hits.push({ slug, file: f, status: String(cities[slug]?.zones?.status ?? "unknown"), reason });
}

// Un slug peut avoir plusieurs rapports : on le compte une fois, en gardant les fichiers.
const bySlug = new Map<string, Row[]>();
for (const h of hits) bySlug.set(h.slug, [...(bySlug.get(h.slug) ?? []), h]);

const actionable = [...bySlug.entries()].filter(([, rows]) => rows[0].status !== "done");
const alreadyDone = [...bySlug.entries()].filter(([, rows]) => rows[0].status === "done");

console.log(`famille="${familyNeedle}" · rapports fail correspondants=${hits.length} · slugs distincts=${bySlug.size}`);
console.log(`\n=== ACTIONNABLES (zones.status != done) : ${actionable.length} ===`);
for (const [slug, rows] of actionable.sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`\n### ${slug}  (status=${rows[0].status}, ${rows.length} rapport(s))`);
  for (const r of rows) console.log(`    ${r.file}\n      → ${r.reason.slice(0, 160)}`);
}
console.log(`\n=== DÉJÀ done (ne pas retravailler) : ${alreadyDone.length} ===`);
console.log(`  ${alreadyDone.map(([s]) => s).sort().join(", ") || "(aucun)"}`);
if (unmapped.length) {
  console.log(`\n=== rapports non ancrables sur un slug de la matrice : ${unmapped.length} ===`);
  for (const u of unmapped) console.log(`  ${u}`);
}
