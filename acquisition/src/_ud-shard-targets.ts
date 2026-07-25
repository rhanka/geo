/**
 * _ud-shard-targets.ts — liste les cibles usage_dominant pour un shard.
 * Source: work/coverage/zonage-enrichment.json (served=true && usage_dominant=false).
 * Tri alpha stable, split shard i/n (index%n==i). Priorise reglement=true.
 * Usage: npx tsx acquisition/src/_ud-shard-targets.ts --shard 1 --of 2 [--reglement-only]
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const MAP_DIR = resolve(ROOT, "acquisition", "config", "usage-dominant-map");

function arg(k: string, d?: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
}

const shard = Number(arg("shard", "1"));
const of = Number(arg("of", "2"));
const reglementOnly = process.argv.includes("--reglement-only");

interface Muni {
  slug: string;
  served: boolean;
  reglement: boolean;
  usage_dominant: boolean;
}

const data = JSON.parse(readFileSync(ENRICH, "utf8")) as { perMuni: Muni[] };
const all = data.perMuni
  .filter((m) => m.served && !m.usage_dominant)
  .map((m) => m.slug)
  .sort((a, b) => a.localeCompare(b));

const mine = all.filter((_, i) => i % of === shard);
const withReg = new Map(data.perMuni.map((m) => [m.slug, m.reglement]));
const withCfg = (slug: string) => existsSync(resolve(MAP_DIR, `${slug}.json`));

const todo = mine.filter((s) => !withCfg(s));
const done = mine.filter((s) => withCfg(s));

console.log(`# usage_dominant shard ${shard}/${of}`);
console.log(`total cibles (served && !usage_dominant): ${all.length}`);
console.log(`mon shard: ${mine.length}  déjà configuré: ${done.length}  TODO: ${todo.length}`);
console.log(`--- TODO reglement=true (prioritaires) ---`);
for (const s of todo) if (withReg.get(s)) console.log(s);
if (!reglementOnly) {
  console.log(`--- TODO reglement=false ---`);
  for (const s of todo) if (!withReg.get(s)) console.log(s);
}
