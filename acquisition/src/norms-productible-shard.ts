/**
 * norms-productible-shard — READ-ONLY selection helper.
 *
 * Émet les municipalités PRODUCTIBLES pour l'extraction de normes :
 * zones.status == "done" (une grille SIG existe pour cross-valider) ET
 * normes.status != "done" (pas encore servie). Découpe déterministe en shards
 * (index de position dans le filtre % nShards == shard).
 *
 * Avec --manifest F, ne garde que les munis productibles qui ont DÉJÀ une grille
 * confirmée dans le manifest de découverte F (shape munis.json), et émet une ligne
 * TSV `slug<TAB>route<TAB>sourceUrl` par muni retenue (extraction directe possible).
 *
 * Usage: npx tsx acquisition/src/norms-productible-shard.ts [--shard 0] [--n 2] [--take 15]
 *        npx tsx acquisition/src/norms-productible-shard.ts --shard 0 --manifest work/zonage-norms/discovered.json
 */
import { readFileSync } from "node:fs";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main(): void {
  const shard = Number(arg("--shard", "0"));
  const n = Number(arg("--n", "2"));
  const take = Number(arg("--take", "0"));
  const matrix = JSON.parse(readFileSync("work/coverage/coverage-matrix.json", "utf8"));
  const cities: Record<string, any> = matrix.cities ?? {};
  const productible: string[] = [];
  // Deterministic SORTED enumeration so every shard agrees on index parity
  // ("index dans la liste triée % n == shard"), independent of JSON key order.
  for (const slug of Object.keys(cities).sort()) {
    const c = cities[slug];
    if (c?.zones?.status === "done" && c?.normes?.status !== "done") productible.push(slug);
  }
  const mine = productible.filter((_, idx) => idx % n === shard);
  const manifestPath = arg("--manifest", "");
  if (manifestPath) {
    const man = JSON.parse(readFileSync(manifestPath, "utf8"));
    const byslug = new Map<string, any>();
    for (const m of man.munis ?? []) byslug.set(m.slug, m);
    const mineSet = new Set(mine);
    const rows = (man.munis ?? []).filter((m: any) => mineSet.has(m.slug));
    const capped = take > 0 ? rows.slice(0, take) : rows;
    console.error(
      `productible=${productible.length} shard=${shard}/${n}=${mine.length} · manifest=${(man.munis ?? []).length} · intersect=${rows.length} (take ${capped.length})`,
    );
    for (const m of capped) console.log(`${m.slug}\t${m.route ?? ""}\t${m.sourceUrl ?? ""}`);
    return;
  }
  const selected = take > 0 ? mine.slice(0, take) : mine;
  console.error(
    `productible=${productible.length} shard=${shard}/${n} → ${mine.length} (take ${selected.length})`,
  );
  console.log(selected.join(","));
}

main();
