/**
 * _reglement-provenance-stale-null.ts — surface les verdicts HOLD-NULL PÉRIMÉS.
 *
 * Motivation (mémoire null-verdict-perime-par-depot-amont): une note « aucun PDF
 * local / dossier vide / 404 / défaut de DÉCOUVERTE / il manque le corps » se
 * périme SEULE dès que la lane normes dépose un doc dans work/zonage-norms/<slug>/.
 * Ce script croise, pour chaque HOLD-NULL du shard, la présence d'un PDF local
 * AVEC un marqueur de péremption dans le `_note`. Un slug listé = à RE-LIRE à $0.
 *
 * READ-ONLY. Usage (repo root):
 *   npx tsx acquisition/src/_reglement-provenance-stale-null.ts --shard 0/2
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

/** Phrases qui signalent un verdict rendu sur une ABSENCE de doc — donc périmable
 *  dès qu'un PDF apparaît sur le disque. */
const STALE_RE =
  /(aucun\s+pdf\s+local|dossier\s+vide|\bvide\b|404|défaut\s+de\s+découverte|defaut\s+de\s+decouverte|il\s+manque\s+le\s+corps|aucune\s+grille|aucun\s+document|rien\s+n['’]a\s+ete\s+lu|rien\s+n['’]a\s+été\s+lu|pas\s+de\s+source_url|http\s*404)/i;

function main(): void {
  const shardSpec = arg("shard");
  const enrich = JSON.parse(readFileSync(ENRICH, "utf8")) as {
    perMuni: Array<{ slug: string; served?: boolean; reglement?: boolean }>;
  };
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as {
    slugs: Record<string, { reglement_numero: unknown; _note?: string }>;
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

  let flagged = 0;
  for (const slug of mine) {
    const reg = registry.slugs[slug];
    if (!reg || reg.reglement_numero) continue; // HOLD-NULL only
    const dir = join(NORMSDIR, slug);
    if (!existsSync(dir)) continue;
    let pdfs: string[] = [];
    try {
      pdfs = readdirSync(dir).filter((f) => /\.pdf$/i.test(f) && statSync(join(dir, f)).size > 4096);
    } catch {
      continue;
    }
    if (pdfs.length === 0) continue; // pas de doc => rien de périmé
    const note = reg._note ?? "";
    if (!STALE_RE.test(note)) continue; // note ne parlait pas d'absence
    flagged++;
    const biggest = pdfs
      .map((f) => ({ f, kb: Math.round(statSync(join(dir, f)).size / 1024) }))
      .sort((a, b) => b.kb - a.kb);
    console.log(`\n### ${slug}  pdfs=${pdfs.length}`);
    for (const { f, kb } of biggest) console.log(`   ${f} (${kb}k)`);
    console.log(`   note⟩ ${note.slice(0, 160)}…`);
  }
  console.log(`\n# shard=${shardSpec ?? "all"} HOLD-NULL périmés (note d'absence + PDF présent)=${flagged}`);
}

main();
