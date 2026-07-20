/**
 * _ud-dormant-configs.ts — liste les configs usage_dominant DORMANTES.
 *
 * Une config est « dormante » quand `acquisition/config/usage-dominant-map/<slug>.json`
 * EXISTE mais que `work/coverage/zonage-enrichment.json` porte encore
 * `usage_dominant=false` pour ce slug: la config a été écrite (parfois même
 * committée) sans que `fold-usage-dominant.ts` ait tourné, donc RIEN n'est servi.
 * Mesuré le 2026-07-20 sur saint-gabriel-de-rimouski / saint-donat--la-mitis /
 * saint-celestin--nicolet-yamaska--2: 142 polygones prêts, 0 servi. Écrire n'est
 * PAS servir — cf mémoire [[fold-cellschanged-zero-est-ambigu]].
 *
 * Le verdict du coverage est une PRÉSOMPTION (le fichier peut être périmé): la
 * preuve reste `_ud-verify-served.ts --slugs …` sur le S3, à passer sur la liste
 * rendue ici avant de folder.
 *
 * Usage:
 *   npx tsx acquisition/src/_ud-dormant-configs.ts              # tous
 *   npx tsx acquisition/src/_ud-dormant-configs.ts --shard 0 --of 2
 *   npx tsx acquisition/src/_ud-dormant-configs.ts --shard 0 --of 2 --csv
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

interface Muni {
  slug: string;
  served: boolean;
  usage_dominant: boolean;
}

const shardRaw = arg("shard");
const of = Number(arg("of", "2"));
const csv = process.argv.includes("--csv");

const data = JSON.parse(readFileSync(ENRICH, "utf8")) as { perMuni: Muni[] };
// Même tri que _ud-shard-targets: le shard se calcule sur la liste COMPLÈTE des
// cibles (served && !usage_dominant), pas sur les seules dormantes, sinon les
// deux outils ne parlent pas du même découpage.
const targets = data.perMuni
  .filter((m) => m.served && !m.usage_dominant)
  .map((m) => m.slug)
  .sort((a, b) => a.localeCompare(b));

const mine =
  shardRaw === undefined ? targets : targets.filter((_, i) => i % of === Number(shardRaw));
const dormant = mine.filter((s) => existsSync(resolve(MAP_DIR, `${s}.json`)));

if (csv) {
  console.log(dormant.join(","));
} else {
  const scope = shardRaw === undefined ? "tous shards" : `shard ${shardRaw}/${of}`;
  console.log(`# configs DORMANTES (${scope}): ${dormant.length} / ${mine.length} cibles`);
  for (const s of dormant) console.log(s);
}
