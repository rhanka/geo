/**
 * _frag-triage-grep-dir.ts — ONE-OFF recursive text-search helper (sandbox
 * blocks ad-hoc grep/find; committed scripts are the escape hatch). Walks a
 * directory tree and prints file:line for every regex match.
 *
 * Usage: npx tsx acquisition/src/_frag-triage-grep-dir.ts --dir <path> --re <regex> [--ext .ts,.mts] [--flags gi]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const dir = arg("dir");
const reStr = arg("re");
if (!dir || !reStr) throw new Error("required: --dir <path> --re <regex>");
const exts = (arg("ext", ".ts,.mts") ?? ".ts,.mts").split(",");
const flags = arg("flags", "") ?? "";
const re = new RegExp(reStr, flags.includes("g") ? flags : flags + "g");

function walk(d: string, depth = 0): string[] {
  if (depth > 6) return [];
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(d);
  } catch {
    return [];
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(d, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out = out.concat(walk(p, depth + 1));
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

const files = walk(dir);
let total = 0;
for (const f of files) {
  let text: string;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    if (re.test(lines[i]!)) {
      total++;
      console.log(`${f}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
    }
  }
}
console.log(`\n(${total} match(es) dans ${files.length} fichier(s))`);
