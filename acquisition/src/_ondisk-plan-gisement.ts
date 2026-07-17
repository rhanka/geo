/**
 * _ondisk-plan-gisement.ts — cross the zoning-plan PDFs already on disk against
 * the slugs whose zones.status is still != 'done'.
 *
 * WHY: discovery (finding the official plan) is the expensive half of the
 * recalage lane. Any non-done slug that ALREADY has its plan on disk is a $0
 * candidate — especially since the arbitration flags (--rotation-disambig lots,
 * --aniso-lot-arbitrate) and the /Rotate normalisation post-date most of the
 * archived runs, so an old "rejected" verdict on these is not authoritative.
 *
 * Pure reporting: reads the matrix + the filesystem, prints. Serves nothing.
 *
 * Usage: npx tsx acquisition/src/_ondisk-plan-gisement.ts [--dir work/zonage-plans,work/zones-recalage]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const dirs = arg("dir", "work/zonage-plans,work/zones-recalage").split(",");

const matrix = JSON.parse(readFileSync(resolve("work/coverage/coverage-matrix.json"), "utf8")) as {
  cities: Record<string, { zones?: { status?: string } }>;
};
const nonDone = Object.keys(matrix.cities).filter((s) => matrix.cities[s]?.zones?.status !== "done");
// Longest-first so "saint-louis-de-gonzague" wins over a shorter prefix slug.
const bySlugLen = [...nonDone].sort((a, b) => b.length - a.length);

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
for (const d of dirs) walk(d.trim(), pdfs);

/** Filename → slug, by longest non-done slug whose token form appears in it. */
function slugOf(path: string): string | null {
  const base = path.toLowerCase().replace(/[_\s]+/g, "-");
  for (const s of bySlugLen) if (base.includes(s)) return s;
  return null;
}

const hits = new Map<string, { path: string; rot: number; pages: number }[]>();
for (const p of pdfs) {
  const s = slugOf(p);
  if (!s) continue;
  let rot = 0;
  let pages = 0;
  try {
    const info = execFileSync("pdfinfo", [p], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const rm = info.match(/Page rot:\s*(-?\d+)/);
    rot = rm ? ((Number(rm[1]) % 360) + 360) % 360 : 0;
    const pm = info.match(/Pages:\s*(\d+)/);
    pages = pm ? Number(pm[1]) : 0;
  } catch {
    continue;
  }
  if (!hits.has(s)) hits.set(s, []);
  hits.get(s)!.push({ path: p, rot, pages });
}

const rows = [...hits.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const rotatedSlugs = rows.filter(([, v]) => v.some((f) => f.rot !== 0));

console.log("=== GISEMENT $0 : slugs zones!=done AYANT DEJA leur plan sur disque ===");
console.log(
  `zones non-done=${nonDone.length} | PDF scannes=${pdfs.length} | slugs non-done avec plan local=${rows.length} | dont plan TOURNE (/Rotate!=0)=${rotatedSlugs.length}`,
);
console.log("");
for (const [slug, files] of rows) {
  const flag = files.some((f) => f.rot !== 0) ? " *ROT*" : "";
  console.log(`${slug}${flag}`);
  for (const f of files) console.log(`    rot=${f.rot} pages=${f.pages} ${f.path}`);
}
