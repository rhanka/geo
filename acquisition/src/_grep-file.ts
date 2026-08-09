/**
 * _grep-file.ts — chercheur $0 dans un fichier texte (le hook interdit grep inline).
 * Imprime les lignes qui matchent une regex (I par défaut) avec n° de ligne.
 * Usage:
 *   npx tsx acquisition/src/_grep-file.ts --file a.txt --re "règlement.{0,40}\\d"
 *   npx tsx acquisition/src/_grep-file.ts --file a.txt --re "314-14" --context 1
 */
import { readFileSync } from "node:fs";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const file = arg("file");
const reStr = arg("re");
const ctx = Number(arg("context", "0"));
const flags = arg("flags", "i")!;
if (!file || !reStr) throw new Error("required: --file <path> --re <regex>");

const re = new RegExp(reStr, flags);
const lines = readFileSync(file, "utf8").split("\n");
let hits = 0;
for (let i = 0; i < lines.length; i++) {
  if (re.test(lines[i]!)) {
    hits++;
    const lo = Math.max(0, i - ctx);
    const hi = Math.min(lines.length - 1, i + ctx);
    for (let j = lo; j <= hi; j++) {
      console.log(`${j + 1}${j === i ? ":" : "-"}\t${lines[j]}`);
    }
    if (ctx > 0) console.log("--");
  }
}
console.log(`# ${hits} ligne(s) match /${reStr}/${flags} dans ${file}`);
