/**
 * _txt-grep.ts — $0 diagnostic. Grep-like search over a UTF-8 text file
 * (typically a `pdftotext -layout` dump of a règlement de zonage) to locate the
 * LÉGENDE / « classification des zones » table that maps a zone prefix to its
 * fonction dominante — the anti-invention source for usage-dominant-map configs.
 *
 * No `grep` in the geo bash allowlist; this committed runner replaces ad-hoc
 * pipes. Prints matching line numbers + optional context so the caller can then
 * Read the exact window.
 *
 * Usage:
 *   npx tsx acquisition/src/_txt-grep.ts --file dump.txt --re 'dominante|vocation|classification'
 *   npx tsx acquisition/src/_txt-grep.ts --file dump.txt --re '^\s*(A|F|U|Rb)\b' --context 1
 */
import { readFileSync } from "node:fs";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const file = arg("file");
const reStr = arg("re");
const context = parseInt(arg("context") ?? "0", 10);
const max = parseInt(arg("max") ?? "80", 10);
if (!file || !reStr) {
  console.error("usage: --file <path> --re <regex> [--context N] [--max N]");
  process.exit(2);
}
const re = new RegExp(reStr, "i");
const lines = readFileSync(file, "utf8").split(/\r?\n/);
let shown = 0;
const printed = new Set<number>();
for (let i = 0; i < lines.length; i++) {
  if (!re.test(lines[i])) continue;
  if (shown >= max) {
    console.log(`… (max ${max} atteint)`);
    break;
  }
  shown++;
  const lo = Math.max(0, i - context);
  const hi = Math.min(lines.length - 1, i + context);
  for (let j = lo; j <= hi; j++) {
    if (printed.has(j)) continue;
    printed.add(j);
    console.log(`${String(j + 1).padStart(5)}${j === i ? ":" : " "} ${lines[j]}`);
  }
  if (context > 0) console.log("  --");
}
if (shown === 0) console.log(`(0 hit pour /${reStr}/i dans ${file})`);
