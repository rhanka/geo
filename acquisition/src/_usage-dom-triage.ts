/**
 * _usage-dom-triage — $0 read-only. Liste les cibles usage_dominant:
 * villes served && reglement && usage_dominant=false, triées par slug, avec
 * l'index de la liste triée (pour le sharding index%n==i) et un flag "config
 * déjà sur disque". Aucune écriture, aucun réseau.
 *
 *   npx tsx acquisition/src/_usage-dom-triage.ts --shard 1 --of 2
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const MAP_DIR = resolve(ROOT, "acquisition", "config", "usage-dominant-map");

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Muni {
  slug: string;
  served?: boolean;
  reglement?: boolean;
  usage_dominant?: boolean;
}

function main(): void {
  const shard = Number(arg("shard") ?? "1");
  const of = Number(arg("of") ?? "2");
  const j = JSON.parse(readFileSync(ENRICH, "utf8")) as { perMuni: Muni[] };
  const cands = j.perMuni
    .filter((m) => m.served && m.reglement && !m.usage_dominant)
    .map((m) => m.slug)
    .sort();
  const mine = cands
    .map((slug, i) => ({ slug, i }))
    .filter((x) => x.i % of === shard);
  const todo = mine.filter((x) => !existsSync(resolve(MAP_DIR, `${x.slug}.json`)));
  const done = mine.filter((x) => existsSync(resolve(MAP_DIR, `${x.slug}.json`)));
  console.log(`candidats(served&reglement&!usage_dominant)=${cands.length} shard=${shard}/${of} mine=${mine.length} todo=${todo.length} déjàConfig=${done.length}`);
  console.log(`TODO: ${todo.map((x) => `${x.i}:${x.slug}`).join(" ")}`);
  if (done.length) console.log(`déjàConfig: ${done.map((x) => x.slug).join(" ")}`);
}

main();
