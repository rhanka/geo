/**
 * norms-local-pdf-inventory — READ-ONLY. For a set of slugs, report which ones
 * already have a LOCAL zoning PDF on disk (LEVEL-1 normes discovery: the grille
 * des usages et normes is an ANNEXE of the zoning règlement, i.e. the SAME PDF
 * the zones extraction already downloaded). Scans the known staging roots and
 * matches by slug, so the normes runner can point `--pdf` at an on-disk file
 * instead of re-crawling.
 *
 * Node/TS only. Writes nothing.
 *   npx tsx acquisition/src/norms-local-pdf-inventory.ts <slug,slug,...>
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../..");
const ROOTS = [
  "work/zonage-norms",
  "work/zonage-plans",
  "work/zonage-norms-focus",
  "work/gcp",
];

function slugOf(argv: string[]): string[] {
  const csv = argv[0] ?? "";
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

/** All PDFs anywhere under `dir` (bounded recursion), returned as repo-relative paths. */
function pdfsUnder(dir: string, depth = 0): string[] {
  const abs = resolve(REPO, dir);
  if (!existsSync(abs) || depth > 3) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...pdfsUnder(join(dir, name), depth + 1));
    else if (/\.pdf$/i.test(name) && st.size > 1000) out.push(`${join(dir, name)}\t${st.size}`);
  }
  return out;
}

function main(): void {
  const slugs = slugOf(process.argv.slice(2));
  if (!slugs.length) { console.error("usage: norms-local-pdf-inventory <slug,slug,...>"); process.exit(1); }
  // Build one index of every candidate PDF once, then match per slug.
  const all: string[] = [];
  for (const r of ROOTS) all.push(...pdfsUnder(r));
  const hasByslug = new Map<string, string[]>();
  for (const slug of slugs) {
    const norm = slug.replace(/-/g, "[-]?");
    const re = new RegExp(`(^|/|\\W)${norm}(\\W|/|$)`, "i");
    const matches = all.filter((line) => re.test(line.split("\t")[0]));
    if (matches.length) hasByslug.set(slug, matches);
  }
  console.log(`# scanned ${all.length} PDFs under ${ROOTS.join(", ")}`);
  const have: string[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const m = hasByslug.get(slug);
    if (m && m.length) {
      have.push(slug);
      console.log(`HAVE  ${slug}`);
      for (const line of m.slice(0, 6)) console.log(`      ${line}`);
    } else {
      missing.push(slug);
    }
  }
  console.log(`\n# HAVE local pdf: ${have.length} | MISSING: ${missing.length}`);
  console.log(`MISSING: ${missing.join(",")}`);
}

main();
