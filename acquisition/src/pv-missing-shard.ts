/**
 * pv-missing-shard.ts — LECTURE PURE. Énumère, de façon déterministe, les
 * municipalités dont la couche PV n'est PAS `done` dans coverage-matrix.json,
 * puis les répartit en shards `position % mod == shard` pour une découverte
 * fraîche coordonnée à plusieurs agents (A=%0, B=%1, C=%2, mod=3 par défaut).
 *
 * N'ÉCRIT JAMAIS la matrice (contrat: le conductor seul réconcilie via
 * coverage-reconcile). Ne fait aucun réseau. Sert juste à choisir la cible.
 *
 * Usage:
 *   npx tsx src/pv-missing-shard.ts --shard 1 --mod 3
 *   npx tsx src/pv-missing-shard.ts --shard 1 --mod 3 --json
 *   npx tsx src/pv-missing-shard.ts --count            # juste le total manquant
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATRIX = resolve(HERE, "..", "..", "work", "coverage", "coverage-matrix.json");

function get(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function has(argv: string[], k: string): boolean {
  return argv.includes(`--${k}`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const mod = Number(get(argv, "mod") ?? "3");
  const shard = Number(get(argv, "shard") ?? "1");
  const asJson = has(argv, "json");
  const countOnly = has(argv, "count");

  const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as {
    cities: Record<string, { pv?: { status?: string } }>;
  };
  const cities = matrix.cities;

  // Ordre canonique = Object.keys(matrix.cities) (même ordre que coverage-reconcile).
  const missing = Object.keys(cities).filter(
    (slug) => cities[slug]?.pv?.status !== "done",
  );

  if (countOnly) {
    console.log(`PV manquant total: ${missing.length}`);
    return;
  }

  const mine = missing.filter((_, i) => i % mod === shard);

  if (asJson) {
    console.log(
      JSON.stringify(
        mine.map((slug) => ({ slug, site: websiteForSlug(slug) ?? null })),
        null,
        2,
      ),
    );
    return;
  }

  console.error(
    `[pv-missing-shard] total manquant=${missing.length}  shard ${shard}/${mod} → ${mine.length} villes`,
  );
  for (const slug of mine) {
    console.log(`${slug}\t${websiteForSlug(slug) ?? "(pas de site annuaire)"}`);
  }
}

main();
