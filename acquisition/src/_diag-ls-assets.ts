/**
 * Lister les artefacts de recalage (gcp / reads / dicts / plans) pour un ou
 * plusieurs slugs, sans bash ad-hoc.
 *
 * Usage : npx tsx acquisition/src/_diag-ls-assets.ts --slugs a,b,c [--dirs work/gcp,work/reads]
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const slugs = (arg("slugs", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const dirs = (arg("dirs", "work/gcp,work/reads,work/zonage-dicts,work/zonage-plans,work/zonage-norms") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

for (const dir of dirs) {
  const abs = resolve(dir);
  if (!existsSync(abs)) {
    console.log(`# ${dir} : ABSENT`);
    continue;
  }
  let names: string[] = [];
  try {
    names = readdirSync(abs);
  } catch {
    continue;
  }
  const hits = slugs.length
    ? names.filter((n) => slugs.some((s) => n.startsWith(s)))
    : names;
  console.log(`# ${dir} : ${hits.length} entrées`);
  for (const n of hits.sort()) {
    let size = 0;
    try {
      size = statSync(resolve(abs, n)).size;
    } catch {
      /* ignore */
    }
    console.log(`  ${dir}/${n}\t${Math.round(size / 1024)}k`);
  }
}
