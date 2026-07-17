/**
 * _usage-dominant-targets.ts — liste les cibles du fold usage_dominant.
 *
 * Univers: work/coverage/zonage-enrichment.json (perMuni, déjà trié alpha).
 * Cible = served && !usage_dominant. Priorité = reglement (le règlement est déjà
 * servi sur le polygone => on a le document/URL sous la main).
 *
 * --todo retire les slugs qui ont DÉJÀ un config committé: le cache est régénéré
 * rarement et porte `usage_dominant:false` sur des slugs déjà servis (13/36 mesurés
 * sur le shard 0/2 au 2026-07-17). Sans ce filtre on re-pioche du déjà-fait, et les
 * 2 shards se marchent dessus.
 *
 * Usage:
 *   npx tsx acquisition/src/_usage-dominant-targets.ts --with-reglement
 *   npx tsx acquisition/src/_usage-dominant-targets.ts --with-reglement --shard 1/2
 *   npx tsx acquisition/src/_usage-dominant-targets.ts --todo --shard 0/2
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const MAP_DIR = resolve(ROOT, "acquisition", "config", "usage-dominant-map");

interface Row {
  slug: string;
  served: boolean;
  reglement: boolean;
  usage_dominant: boolean;
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const argv = process.argv.slice(2);
const withReg = argv.includes("--with-reglement");
const todo = argv.includes("--todo");
const shard = arg(argv, "shard"); // "i/n"

const summary = JSON.parse(readFileSync(CACHE, "utf8")) as { perMuni: Row[] };
let targets = summary.perMuni.filter((r) => r.served && !r.usage_dominant);
if (withReg) targets = targets.filter((r) => r.reglement);
if (todo) targets = targets.filter((r) => !existsSync(resolve(MAP_DIR, `${r.slug}.json`)));
targets.sort((a, b) => a.slug.localeCompare(b.slug));

let picked = targets;
if (shard) {
  const [i, n] = shard.split("/").map(Number);
  picked = targets.filter((_, idx) => idx % n === i);
}

console.log(`targets=${targets.length}${shard ? ` shard=${shard} picked=${picked.length}` : ""}`);
for (const [idx, r] of targets.entries()) {
  const mine = picked.includes(r);
  if (!shard || mine) console.log(`${String(idx).padStart(3)} ${r.slug}${r.reglement ? " [reglement]" : ""}`);
}
