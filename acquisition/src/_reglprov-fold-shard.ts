/**
 * _reglprov-fold-shard.ts — sert la provenance règlement pour TOUT un shard.
 * Calcule les slugs `reglement=false` du shard (même univers que le triage) et
 * invoque le fold committé (fold-reglement-to-zonage.ts) SANS le modifier (le
 * fold est partagé avec l'agent concurrent). Ne montre que les lignes utiles:
 * cellsChanged>0 (vrai dépôt), SKIP, et le DONE. Idempotent.
 *
 * Robuste aux ajouts concurrents au registre: re-calcule et re-folde tel quel.
 *
 * Usage (depuis acquisition/):
 *   npx tsx src/_reglprov-fold-shard.ts --shard 1 --of 2 --dry-run
 *   npx tsx src/_reglprov-fold-shard.ts --shard 1 --of 2
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const FOLD = resolve(ROOT, "acquisition", "src", "fold-reglement-to-zonage.ts");

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const shard = Number(arg(argv, "shard") ?? "0");
  const of = Number(arg(argv, "of") ?? "1");
  const dry = argv.includes("--dry-run");
  const enrich = JSON.parse(readFileSync(ENRICH, "utf8")) as { perMuni: Array<{ slug: string; reglement: boolean }> };
  const slugs = enrich.perMuni.filter((m) => m.reglement === false).map((m) => m.slug).sort()
    .filter((_, idx) => idx % of === shard);
  console.log(`shard ${shard}/${of}: ${slugs.length} slugs reglement=false → fold${dry ? " (dry-run)" : ""}`);
  const foldArgs = ["tsx", FOLD, "--slugs", slugs.join(","), ...(dry ? ["--dry-run"] : [])];
  const out = execFileSync("npx", foldArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 590_000 });
  const lines = out.split("\n");
  const changed = lines.filter((l) => /cellsChanged=[1-9]/.test(l));
  const done = lines.filter((l) => l.startsWith("DONE"));
  console.log(`\n=== cellsChanged>0 (dépôts réels) : ${changed.length} ===`);
  for (const l of changed) console.log(l);
  if (changed.length === 0) console.log("(aucun — tout déjà servi ou skip)");
  for (const l of done) console.log(l);
}

main();
