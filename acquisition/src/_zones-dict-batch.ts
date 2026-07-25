/**
 * _zones-dict-batch.ts — construit en lot le dictionnaire de codes RÉELS
 * (`_zones-dict-from-norms.ts`) pour plusieurs slugs, et rapporte lesquels ont
 * une grille de normes déposée exploitable comme `--dict` de la voie
 * glyph-vision. N'invente rien : délègue au script unitaire, qui ABORT sans
 * parquet déposé.
 *
 * Usage: npx tsx acquisition/src/_zones-dict-batch.ts --slugs a,b,c [--outdir work/zonage-dicts]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!slugs.length) throw new Error("required: --slugs a,b,c");
const outdir = arg("outdir") ?? "work/zonage-dicts";
if (!existsSync(outdir)) mkdirSync(outdir, { recursive: true });

const ok: string[] = [];
const ko: string[] = [];
for (const slug of slugs) {
  const out = `${outdir}/${slug}.dict.json`;
  const r = spawnSync("npx", ["tsx", "acquisition/src/_zones-dict-from-norms.ts", "--slug", slug, "--out", out], {
    encoding: "utf8",
  });
  const txt = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const lines = txt.split("\n").filter((l) => l.includes("[dict]"));
  console.log(`\n### ${slug}  (exit ${r.status})`);
  for (const l of lines.slice(0, 6)) console.log("  " + l);
  if (r.status === 0) ok.push(`${slug} -> ${out}`);
  else ko.push(slug);
}

console.log(`\n=== DICT DISPONIBLE (${ok.length}) ===`);
for (const o of ok) console.log("  " + o);
console.log(`=== SANS GRILLE DÉPOSÉE (${ko.length}) ===`);
console.log("  " + ko.join(" "));
