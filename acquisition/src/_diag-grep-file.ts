/**
 * _diag-grep-file.ts — $0 local : grep d'un fichier texte (une ligne par match).
 * Remplace le `grep` ad-hoc interdit par le hook.
 *
 * USAGE : npx tsx acquisition/src/_diag-grep-file.ts --file <path> --find "<regex>" [--max 60] [--flags i]
 */
import { readFileSync } from "node:fs";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const file = arg("file");
  const find = arg("find");
  const max = Number(arg("max") ?? 60);
  const flags = arg("flags") ?? "i";
  if (!file || !find) throw new Error("required: --file <path> --find <regex>");
  const re = new RegExp(find, flags);
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i]!)) continue;
    n++;
    if (n <= max) console.log(`${i + 1}\t${lines[i]}`);
  }
  console.log(`# ${n} lignes appariees sur ${lines.length} pour /${find}/${flags}`);
}

main();
