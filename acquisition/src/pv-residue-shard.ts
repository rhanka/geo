/**
 * pv-residue-shard — lecture pure : liste les municipalités dont la couche PV
 * n'est PAS "done" dans work/coverage/coverage-matrix.json, triées par slug, et
 * marque celles du shard demandé (index % mod == r). Sert à découper le travail
 * de découverte PV entre plusieurs passes /loop sans inliner de node -e.
 *
 * 0 écriture, 0 réseau, 0 LLM. Imprime :
 *   - histogramme des statuts PV != done
 *   - la liste du shard (slug, index, status, registered?, website)
 *
 * Usage (depuis acquisition/) :
 *   npx tsx src/pv-residue-shard.ts --mod 3 --rem 0
 *   npx tsx src/pv-residue-shard.ts --mod 3 --rem 0 --all   # imprime tout le résidu
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";
import { ALL_PV_CITIES } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATRIX = resolve(HERE, "..", "..", "work", "coverage", "coverage-matrix.json");

function arg(k: string, d?: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
}
const has = (k: string): boolean => process.argv.includes(`--${k}`);

const mod = Number(arg("mod", "3"));
const rem = Number(arg("rem", "0"));
const all = has("all");

const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as {
  cities: Record<string, Record<string, { status?: string } | undefined>>;
};
const registered = new Set(ALL_PV_CITIES.map((e) => e.config.citySlug));

const residue = Object.keys(matrix.cities)
  .filter((slug) => matrix.cities[slug]?.pv?.status !== "done")
  .sort();

const hist: Record<string, number> = {};
for (const slug of residue) {
  const st = matrix.cities[slug]?.pv?.status ?? "(none)";
  hist[st] = (hist[st] ?? 0) + 1;
}

console.log(`PV RESIDUE (status!=done): ${residue.length} municipalités`);
console.log(
  "  statuts: " +
    Object.entries(hist)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(" "),
);
console.log(`  registered(ALL_PV_CITIES): ${residue.filter((s) => registered.has(s)).length}`);

const shard = residue.filter((_, i) => i % mod === rem);
console.log(`\nSHARD mod=${mod} rem=${rem} : ${shard.length} municipalités`);
console.log("idx".padEnd(6) + "slug".padEnd(30) + "reg".padEnd(5) + "status".padEnd(14) + "website");
const rows = all ? residue.map((s) => [residue.indexOf(s), s] as const) : shard.map((s) => [residue.indexOf(s), s] as const);
for (const [idx, slug] of rows) {
  const st = matrix.cities[slug]?.pv?.status ?? "(none)";
  const reg = registered.has(slug) ? "yes" : "no";
  const site = websiteForSlug(slug) ?? "(no site in directory)";
  console.log(String(idx).padEnd(6) + slug.padEnd(30) + reg.padEnd(5) + st.padEnd(14) + site);
}
