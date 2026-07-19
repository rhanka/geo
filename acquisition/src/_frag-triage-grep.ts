/**
 * _frag-triage-grep.ts — ONE-OFF text-search helper (the sandbox blocks ad-hoc
 * grep/find/cat; committed scripts are the escape hatch per project convention).
 * Prints matching lines (with N lines of context) for a regex in a file.
 *
 * Usage: npx tsx acquisition/src/_frag-triage-grep.ts --file <path> --re <regex> [--ctx 5] [--flags gi]
 */
import { readFileSync } from "node:fs";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const file = arg("file");
const reStr = arg("re");
if (!file || !reStr) throw new Error("required: --file <path> --re <regex>");
const ctx = Number(arg("ctx", "5"));
const flags = arg("flags", "g") ?? "g";

const text = readFileSync(file, "utf8");
const lines = text.split("\n");
const re = new RegExp(reStr, flags.includes("g") ? flags : flags + "g");

let found = 0;
for (let i = 0; i < lines.length; i++) {
  if (re.test(lines[i]!)) {
    found++;
    const from = Math.max(0, i - ctx);
    const to = Math.min(lines.length - 1, i + ctx);
    console.log(`\n--- match @line ${i + 1} ---`);
    for (let k = from; k <= to; k++) console.log(`${k + 1}\t${lines[k]}`);
  }
}
console.log(`\n(${found} ligne(s) correspondante(s))`);
