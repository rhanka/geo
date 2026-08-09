/**
 * Listing outillé (remplace `ls`, interdit en bash ad-hoc) : liste les fichiers
 * d'un ou plusieurs répertoires, avec filtre sous-chaîne optionnel.
 *
 * Usage : npx tsx acquisition/src/_zones-ls.ts <dir> [dir...] [--match <substr>] [--limit N]
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const match = (arg("match") ?? "").toLowerCase();
const limit = Number(arg("limit", "400"));
const dirs = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && !(i > 0 && arr[i - 1]?.startsWith("--")));

for (const d of dirs) {
  const abs = resolve(d);
  if (!existsSync(abs)) {
    console.log(`# ${d} : ABSENT`);
    continue;
  }
  const st = statSync(abs);
  if (!st.isDirectory()) {
    console.log(`${d}  ${st.size} o`);
    continue;
  }
  const names = readdirSync(abs)
    .filter((n) => !match || n.toLowerCase().includes(match))
    .sort();
  console.log(`# ${d} : ${names.length} entrées${match ? ` (match=${match})` : ""}`);
  for (const n of names.slice(0, limit)) {
    const p = join(abs, n);
    let size = "";
    try {
      const s = statSync(p);
      size = s.isDirectory() ? "<dir>" : `${s.size}`;
    } catch {
      size = "?";
    }
    console.log(`  ${size.padStart(10)}  ${n}`);
  }
  if (names.length > limit) console.log(`  … +${names.length - limit}`);
}
