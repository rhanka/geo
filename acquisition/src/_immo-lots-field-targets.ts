/**
 * _immo-lots-field-targets.ts — classe les munis cibles par champ depuis
 * work/coverage/immo-lots.json (produit par immo-lots-audit.ts).
 *
 * Sortie: pour chaque champ (adresse, folded-normes, surface_m2, code_postal),
 * la liste des munis sous 100%, triée par IMPACT = lots manquants (décroissant),
 * avec normesStatus. Sert à piocher des lots de 6-10 munis pour re-enrich.
 *
 * Usage:
 *   tsx src/_immo-lots-field-targets.ts <field> [--min <pct>] [--limit <n>] [--normes-done] [--csv]
 *   field ∈ adresse | folded-normes | surface_m2 | code_postal | all
 * Lecture seule, aucun dépôt.
 */
import { readFileSync } from "node:fs";

interface PerMuni {
  slug: string;
  numLots: number;
  normesStatus: string;
  fieldPct: Record<string, number>;
  fieldNum: Record<string, number>;
}

const CACHE = "work/coverage/immo-lots.json";

function main(): void {
  const argv = process.argv.slice(2);
  const field = argv[0] ?? "all";
  const min = num(flag(argv, "--min"), 99.99);
  const limit = num(flag(argv, "--limit"), 60);
  const normesDone = argv.includes("--normes-done");
  const csv = argv.includes("--csv");

  const j = JSON.parse(readFileSync(CACHE, "utf8")) as { perMuni: PerMuni[] };
  const fields = field === "all" ? ["adresse", "folded-normes", "surface_m2", "code_postal"] : [field];

  for (const f of fields) {
    let rows = j.perMuni
      .filter((m) => (m.fieldPct?.[f] ?? 0) < min)
      .filter((m) => (normesDone ? m.normesStatus === "done" : true))
      .map((m) => {
        const pct = m.fieldPct?.[f] ?? 0;
        const have = m.fieldNum?.[f] ?? 0;
        const missing = m.numLots - have;
        return { slug: m.slug, numLots: m.numLots, pct, have, missing, normesStatus: m.normesStatus };
      })
      .sort((a, b) => b.missing - a.missing);
    const total = rows.length;
    const totalMissing = rows.reduce((s, r) => s + r.missing, 0);
    rows = rows.slice(0, limit);

    if (csv) {
      console.log(rows.map((r) => r.slug).join(","));
      continue;
    }
    console.log(`\n=== ${f} : ${total} munis < ${min}%  (lots manquants total=${totalMissing}) ===`);
    for (const r of rows) {
      console.log(
        `${r.slug.padEnd(42)} lots=${String(r.numLots).padStart(7)} pct=${r.pct.toFixed(2).padStart(6)} ` +
          `miss=${String(r.missing).padStart(7)} normes=${r.normesStatus}`,
      );
    }
  }
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function num(v: string | undefined, d: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

main();
