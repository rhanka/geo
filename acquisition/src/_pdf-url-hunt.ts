/**
 * Retrouve les URL de PDF déjà utilisées pour un slug, dans les artefacts du repo.
 *
 * Motif : les rapports GCP (`work/gcp/*.report.json`) ne consignent PAS l'URL du PDF
 * source, et `work/pdf/` est purgé entre les passes. Pour relancer une désambiguïsation
 * de rotation sur un rejet « orientation ambiguity » (géométrie saine), il faut
 * re-télécharger l'entrée exacte. Ce script la cherche là où elle a pu être écrite :
 * la matrice de couverture (notes + champs d'URL) et les rapports de run markdown.
 *
 * N'invente aucune URL : il ne rapporte que ce qui est écrit dans les artefacts.
 *
 * Usage : npx tsx acquisition/src/_pdf-url-hunt.ts <slug> [<slug> ...]
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const URL_RE = /https?:\/\/[^\s"'`)<>\]]+/g;

/** Toutes les chaînes d'un JSON, avec leur chemin. */
function* strings(node: any, path: string[] = []): Generator<{ path: string; value: string }> {
  if (typeof node === "string") {
    yield { path: path.join("."), value: node };
  } else if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* strings(node[i], [...path, String(i)]);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) yield* strings(v, [...path, k]);
  }
}

// --- 1. La matrice de couverture -------------------------------------------------
const matrixPath = resolve("work/coverage/coverage-matrix.json");
const matrix = existsSync(matrixPath) ? JSON.parse(readFileSync(matrixPath, "utf8")) : null;

function matrixEntry(slug: string): any {
  if (!matrix) return null;
  const cities = matrix.cities ?? matrix;
  if (Array.isArray(cities)) return cities.find((c: any) => c?.slug === slug) ?? null;
  return cities?.[slug] ?? null;
}

// --- 2. Les rapports de run markdown ---------------------------------------------
const mdFiles: string[] = [];
function walkMd(dir: string, depth: number): void {
  if (depth > 2 || !existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkMd(p, depth + 1);
    else if (e.endsWith(".md") || e.endsWith(".json")) mdFiles.push(p);
  }
}
walkMd(resolve("work/delegation-mass"), 0);
walkMd(resolve("work/zonage-norms"), 0);

for (const slug of slugs) {
  console.log(`\n================ ${slug}`);

  const entry = matrixEntry(slug);
  if (entry) {
    const urls = new Set<string>();
    for (const s of strings(entry)) {
      for (const u of s.value.match(URL_RE) ?? []) if (/\.pdf/i.test(u)) urls.add(`${s.path} → ${u}`);
    }
    const zones = entry.zones ?? {};
    console.log(`  matrice : zones.status=${zones.status ?? "?"} tracks=[${(zones.candidateTracks ?? []).join(",")}]`);
    if (zones.note) console.log(`  note    : ${String(zones.note).slice(0, 300)}`);
    if (urls.size) {
      console.log(`  URL PDF dans la matrice :`);
      for (const u of urls) console.log(`    ${u}`);
    } else {
      console.log(`  URL PDF dans la matrice : AUCUNE`);
    }
  } else {
    console.log(`  matrice : slug ABSENT`);
  }

  // Les rapports markdown/json qui citent le slug ET une URL de PDF.
  const found = new Set<string>();
  for (const f of mdFiles) {
    let txt: string;
    try {
      txt = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (!txt.includes(slug)) continue;
    for (const line of txt.split("\n")) {
      if (!line.toLowerCase().includes(slug.toLowerCase())) continue;
      for (const u of line.match(URL_RE) ?? []) {
        if (/\.pdf/i.test(u)) found.add(`${f.replace(process.cwd() + "/", "")} → ${u}`);
      }
    }
  }
  if (found.size) {
    console.log(`  URL PDF citées dans les rapports :`);
    for (const u of found) console.log(`    ${u}`);
  } else {
    console.log(`  URL PDF citées dans les rapports : AUCUNE`);
  }
}
