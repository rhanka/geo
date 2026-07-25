/**
 * _rotate-blast-radius.ts — count how many zoning plan PDFs already on disk are
 * hit by the /Rotate frame mismatch (see pdf-normalize-rotation.ts for the
 * measured trap). Pure reporting: reads, counts, prints. Serves nothing.
 *
 * Usage: npx tsx acquisition/src/_rotate-blast-radius.ts [--dir work/zonage-plans] [--limit 400]
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const dirs = arg("dir", "work/zonage-plans,work/zones-recalage").split(",");
const limit = Number(arg("limit", "400"));

function walk(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (acc.length >= limit) return;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, acc);
    else if (e.toLowerCase().endsWith(".pdf")) acc.push(p);
  }
}

const pdfs: string[] = [];
for (const d of dirs) walk(d.trim(), pdfs);

let rotated = 0;
let upright = 0;
let unreadable = 0;
const hits: string[] = [];

for (const p of pdfs) {
  let info: string;
  try {
    info = execFileSync("pdfinfo", ["-f", "1", "-l", "1", p], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    unreadable += 1;
    continue;
  }
  const rm = info.match(/Page\s+1\s+rot:\s*(-?\d+)/) ?? info.match(/Page rot:\s*(-?\d+)/);
  const rot = rm ? ((Number(rm[1]) % 360) + 360) % 360 : 0;
  if (rot !== 0) {
    rotated += 1;
    const pm = info.match(/Page\s+1\s+size:\s*([\d.]+)\s*x\s*([\d.]+)/) ?? info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
    hits.push(`  rot=${rot}\t${pm ? `${pm[1]}x${pm[2]}` : "?"}\t${p}`);
  } else upright += 1;
}

console.log(`=== /Rotate blast radius — plans PDF sur disque ===`);
console.log(`scannés=${pdfs.length}  rot=0 (sains)=${upright}  rot!=0 (TOUCHÉS)=${rotated}  illisibles=${unreadable}`);
if (hits.length) {
  console.log(`\n=== PDF TOUCHÉS (repère transposé, GCP et étiquettes désaccordés) ===`);
  for (const h of hits) console.log(h);
}
