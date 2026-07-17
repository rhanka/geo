/**
 * _reglement-provenance-local-scan.ts — re-sonde $0 du DISQUE local pour les
 * HOLD-NULL d'un shard.
 *
 * Motivation (mémoire null-verdict-perime-par-depot-amont + reglement-provenance-
 * shard1-status-20260717T-cdx): une note « aucun PDF local / dossier vide » se
 * périme SEULE — la lane normes dépose en continu des `cdx-*` (amendements/projets)
 * qui NOMMENT le règlement de zonage de base. Ce script liste, pour chaque slug
 * HOLD-NULL du shard, les fichiers présents dans work/zonage-norms/<slug>/, en
 * signalant les cdx-* et les noms « règlement/zonage/amendement/modifiant ».
 *
 * READ-ONLY. Usage (from repo root):
 *   npx tsx acquisition/src/_reglement-provenance-local-scan.ts --shard 1/2
 *   npx tsx acquisition/src/_reglement-provenance-local-scan.ts --shard 1/2 --only-nonempty
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const NORMSDIR = resolve(ROOT, "work", "zonage-norms");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

/** cdx-* / amendement / modifiant / projet / zonage-<num> = candidat CORPS/base. */
function interesting(name: string): boolean {
  const n = name.toLowerCase();
  return /^cdx-/.test(n)
    || /(amend|modifiant|modif|projet|second-projet|entree|vigueur|avis)/.test(n)
    || /(reglement|règlement|zonage|by-?law)/.test(n);
}

function main(): void {
  const shardSpec = arg("shard");
  const onlyNonEmpty = process.argv.includes("--only-nonempty");

  const enrich = JSON.parse(readFileSync(ENRICH, "utf8")) as {
    perMuni: Array<{ slug: string; served?: boolean; reglement?: boolean }>;
  };
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as {
    slugs: Record<string, { reglement_numero: unknown }>;
  };

  const targets = enrich.perMuni
    .filter((m) => m.served === true && m.reglement === false)
    .map((m) => m.slug)
    .sort();

  let mine = targets;
  if (shardSpec) {
    const [i, n] = shardSpec.split("/").map(Number);
    mine = targets.filter((_, idx) => idx % n === i);
  }

  let withFiles = 0;
  let withInteresting = 0;
  for (const slug of mine) {
    const reg = registry.slugs[slug];
    if (!reg || reg.reglement_numero) continue; // HOLD-NULL only
    const dir = join(NORMSDIR, slug);
    if (!existsSync(dir)) {
      if (!onlyNonEmpty) console.log(`${slug}\tNO-DIR`);
      continue;
    }
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => /\.pdf$/i.test(f));
    } catch {
      if (!onlyNonEmpty) console.log(`${slug}\tUNREADABLE`);
      continue;
    }
    if (files.length === 0) {
      if (!onlyNonEmpty) console.log(`${slug}\tEMPTY`);
      continue;
    }
    withFiles++;
    const flagged = files.filter(interesting);
    if (flagged.length > 0) withInteresting++;
    const sized = files.map((f) => {
      let kb = 0;
      try { kb = Math.round(statSync(join(dir, f)).size / 1024); } catch { /* skip */ }
      return `${interesting(f) ? "⭐" : "  "}${f} (${kb}k)`;
    });
    console.log(`\n### ${slug}  files=${files.length} interesting=${flagged.length}`);
    for (const s of sized) console.log(`  ${s}`);
  }
  console.log(`\n# shard=${shardSpec ?? "all"} HOLD-NULL avec PDF local=${withFiles}, dont ⭐interesting=${withInteresting}`);
}

main();
