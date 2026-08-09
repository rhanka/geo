/**
 * _ud-dir-list.ts — $0 read-only : liste les fichiers d'un répertoire avec leur taille
 * (plus gros d'abord). Le hook anti-bash-adhoc interdit `ls` ; ceci le remplace.
 *   npx tsx acquisition/src/_ud-dir-list.ts --dir <path> [--max 50]
 */
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const dir = arg("dir");
if (!dir) { console.error("usage: --dir <path> [--max 50]"); process.exit(2); }
const max = Number(arg("max") ?? 50);

const rows = readdirSync(dir).map((f) => {
  const st = statSync(resolve(dir, f));
  return { f, size: st.isDirectory() ? -1 : st.size };
}).sort((a, b) => b.size - a.size).slice(0, max);

for (const r of rows) {
  console.log(`${r.size < 0 ? "     <dir>" : (r.size / 1048576).toFixed(2).padStart(8) + "MB"}  ${r.f}`);
}
console.log(`# ${rows.length} entrées`);
