/**
 * Localise les PDF déjà téléchargés correspondant à des tokens (slugs).
 *
 * Motif : les rapports GCP (`work/gcp/*.report.json`) ne notent pas le chemin du PDF
 * source. Pour relancer une désambiguïsation de rotation (`--rotation-disambig lots`)
 * sur un rejet « orientation ambiguity », il faut retrouver l'entrée réelle. Ce script
 * balaie l'arborescence de travail et rapporte les PDF présents + leur taille.
 *
 * Usage : npx tsx acquisition/src/_pdf-locate.ts <token> [<token> ...] [--roots a,b]
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const tokens = process.argv.slice(2).filter((a) => !a.startsWith("--") && !a.includes(","));
const roots = (arg("roots") ?? "work/pdf,work/zonage,work/plans,work/cache").split(",");

type Hit = { path: string; bytes: number };
const hits: Hit[] = [];

function walk(dir: string, depth: number): void {
  if (depth > 3 || !existsSync(dir)) return;
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
      walk(p, depth + 1);
    } else if (e.toLowerCase().endsWith(".pdf")) {
      hits.push({ path: p, bytes: st.size });
    }
  }
}

for (const r of roots) walk(resolve(r.trim()), 0);

if (!tokens.length) {
  console.log(`PDF trouvés (tous) : ${hits.length}`);
  for (const h of hits.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`  ${(h.bytes / 1024).toFixed(0).padStart(8)} Ko  ${h.path}`);
  }
} else {
  for (const t of tokens) {
    const matched = hits.filter((h) => h.path.toLowerCase().includes(t.toLowerCase()));
    console.log(`\n=== ${t} : ${matched.length} PDF`);
    for (const h of matched.sort((a, b) => b.bytes - a.bytes)) {
      console.log(`  ${(h.bytes / 1024).toFixed(0).padStart(8)} Ko  ${h.path}`);
    }
  }
}
