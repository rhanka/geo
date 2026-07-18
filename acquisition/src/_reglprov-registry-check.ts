/**
 * _reglprov-registry-check.ts — dit, pour une liste de slugs, s'ils sont DÉJÀ
 * dans le registre curé reglement-provenance.json et leur numéro/note actuels.
 * Évite les doublons de clé et le re-travail. Lecture seule.
 *
 * Usage: npx tsx acquisition/src/_reglprov-registry-check.ts --slugs a,b,c
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REG = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const argv = process.argv.slice(2);
const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const cfg = JSON.parse(readFileSync(REG, "utf8")) as { slugs: Record<string, Record<string, unknown>> };
for (const s of slugs) {
  const e = cfg.slugs[s];
  if (!e) { console.log(`ABSENT   \t${s}`); continue; }
  const num = e["reglement_numero"];
  const note = String(e["_note"] ?? "").slice(0, 90);
  console.log(`${num ? "HAS-NUM " : "NULL-REG"}\t${s}\tnum=${num ?? "null"}\tnote=${note}`);
}
