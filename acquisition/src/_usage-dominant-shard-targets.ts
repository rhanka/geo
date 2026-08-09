/**
 * _usage-dominant-shard-targets.ts — helper $0 (lecture seule) pour la lane
 * usage_dominant. Lit work/coverage/zonage-enrichment.json, retient les munis
 * SERVIS dont usage_dominant=false (vivier), les trie alphabétiquement (ordre
 * déterministe partagé entre agents), assigne un index et applique le filtre de
 * shard (index % n == i). Marque celles qui ONT déjà un reglement (à traiter en
 * priorité) et celles qui ont DÉJÀ un config committé (à sauter). N'écrit rien.
 *
 *   npx tsx acquisition/src/_usage-dominant-shard-targets.ts --shard 0 --n 2 [--all]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const MAP_DIR = resolve(ROOT, "acquisition", "config", "usage-dominant-map");

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Muni {
  slug: string;
  served: boolean;
  reglement: boolean;
  usage_dominant: boolean;
}

function main(): void {
  const shard = Number(arg("shard") ?? "0");
  const n = Number(arg("n") ?? "2");
  const showAll = process.argv.includes("--all");
  const cov = JSON.parse(readFileSync(COVERAGE, "utf8")) as { perMuni: Muni[] };
  const universe = cov.perMuni
    .filter((m) => m.served && !m.usage_dominant)
    .map((m) => m.slug)
    .sort((a, b) => a.localeCompare(b));
  console.log(`vivier total (servi & usage_dominant=false) = ${universe.length}`);
  const mine = universe
    .map((slug, idx) => ({ slug, idx }))
    .filter((x) => x.idx % n === shard);
  const byMuni = new Map(cov.perMuni.map((m) => [m.slug, m]));
  let withReg = 0;
  let hasCfg = 0;
  const rows = mine.map(({ slug, idx }) => {
    const reg = byMuni.get(slug)?.reglement ?? false;
    const cfg = existsSync(resolve(MAP_DIR, `${slug}.json`));
    if (reg) withReg++;
    if (cfg) hasCfg++;
    return { slug, idx, reg, cfg };
  });
  const todo = rows.filter((r) => !r.cfg);
  const todoReg = todo.filter((r) => r.reg);
  console.log(
    `shard ${shard}/${n}: ${mine.length} slugs (reglement=${withReg}, configDéjà=${hasCfg}) → À FAIRE=${todo.length} (dont reglement=${todoReg.length})`,
  );
  console.log(`\n=== À FAIRE, reglement d'abord ===`);
  for (const r of [...todoReg, ...todo.filter((r) => !r.reg)]) {
    console.log(`  ${r.reg ? "REG " : "    "}idx=${String(r.idx).padStart(3)} ${r.slug}`);
  }
  if (showAll) {
    console.log(`\n=== déjà config (sauter, re-fold si besoin) ===`);
    for (const r of rows.filter((r) => r.cfg)) console.log(`  idx=${String(r.idx).padStart(3)} ${r.slug}`);
  }
}

main();
