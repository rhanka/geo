/**
 * _immo-lots-peek.ts — $0 peek at per-muni numLots + fieldPct from a local
 * immo-lots audit snapshot (immo-lots.json or a --file report), for regression
 * checks before/after a re-enrich pass. Read-only local JSON, zero S3.
 *
 *   tsx src/_immo-lots-peek.ts --slugs a,b,c [--file work/coverage/immo-lots.report.json]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

interface MuniRow {
  slug: string;
  numLots: number;
  normesStatus?: string;
  fieldPct: Record<string, number>;
  fieldNum: Record<string, number>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const file = arg("file") ?? "work/coverage/immo-lots.json";
  const want = new Set((arg("slugs") ?? "").split(",").filter(Boolean));
  const summary = JSON.parse(readFileSync(resolve(ROOT, file), "utf8")) as { perMuni: MuniRow[] };
  const byName = new Map(summary.perMuni.map((r) => [r.slug, r]));
  for (const slug of want) {
    const r = byName.get(slug);
    if (!r) {
      console.log(`${slug}\tABSENT`);
      continue;
    }
    const f = r.fieldPct;
    console.log(
      `${slug}\tlots=${r.numLots}\tsurface=${f["surface_m2"] ?? 0}%\tcp=${f["code_postal"] ?? 0}%\t` +
        `adresse=${f["adresse"] ?? 0}%\tfolded=${f["folded-normes"] ?? 0}%\tnormes=${r.normesStatus ?? "-"}`,
    );
  }
}

main();
