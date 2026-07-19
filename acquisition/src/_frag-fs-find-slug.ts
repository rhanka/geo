/**
 * _frag-fs-find-slug.ts — ONE-OFF: recursively search several `work/` trees +
 * the local tsx tmp cache for any file/dir whose name contains a given slug
 * substring — looking for a leftover crop/render/build artefact from the
 * ORIGINAL T1 build of a fragmented city (e.g. a cached Claude-vision crop
 * that would reveal the exact plan page number used).
 *
 * Usage: npx tsx acquisition/src/_frag-fs-find-slug.ts --needle <slug> [--roots a,b,c]
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const needle = (arg("needle") ?? "").toLowerCase();
if (!needle) throw new Error("required: --needle <slug substring>");
const rootsArg = arg(
  "roots",
  [
    join(ROOT, "work", "reads"),
    join(ROOT, "work", "zonage-reads"),
    join(ROOT, "work", "zonage-recalage"),
    join(ROOT, "work", "zones-recalage"),
    join(ROOT, "work", "gcp"),
    join(ROOT, "work", "recalage-shard0"),
    join(ROOT, "work", "zonage-norms-focus"),
    "/home/antoinefa/.cache-tmp",
  ].join(","),
)!;
const roots = rootsArg.split(",");

function walk(dir: string, depth: number, out: string[]): void {
  if (depth > 3) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (e.toLowerCase().includes(needle)) out.push(p);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, depth + 1, out);
  }
}

for (const root of roots) {
  const hits: string[] = [];
  walk(root, 0, hits);
  console.log(`\n=== ${root} (${hits.length} hit(s)) ===`);
  for (const h of hits.slice(0, 60)) console.log(`  ${h}`);
}
