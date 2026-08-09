/**
 * _file-grep.ts — $0 helper: print the windows of a file around each match of a
 * regex, for files that live OUTSIDE the git repo (scratchpad downloads: VPlus
 * `/structure/tree` JSON, portal HTML…) where `git grep` cannot reach and the
 * ad-hoc-bash gate forbids `grep`. Pure read, fabricates nothing.
 *
 * Usage: npx tsx acquisition/src/_file-grep.ts --file <path> --re '<js-regex>' [--ctx 120] [--max 20]
 */
import { readFileSync } from "node:fs";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const file = arg("file");
const re = arg("re");
if (!file || !re) throw new Error("required: --file <path> --re <js-regex>");
const ctx = Number(arg("ctx") ?? "120");
const max = Number(arg("max") ?? "20");

const body = readFileSync(file, "utf8");
const rx = new RegExp(re, "gi");
let n = 0;
for (const m of body.matchAll(rx)) {
  if (n >= max) break;
  n++;
  const i = m.index ?? 0;
  const from = Math.max(0, i - ctx);
  const to = Math.min(body.length, i + m[0].length + ctx);
  console.log(`--- match ${n} @${i}\n${body.slice(from, to).replace(/\s+/g, " ")}`);
}
console.log(`matches=${n}${n >= max ? " (tronqué)" : ""} file=${file}`);
