/**
 * _refold-progress-summary.ts — SONDE lecture seule du journal resume-safe écrit
 * par `_lot-zone-refold-batch.ts` (`--out`). Ne touche ni S3 ni géométrie ;
 * agrège seulement les compteurs déjà mesurés (deposited / skip par raison /
 * complete_final) pour le reporting par-commit exigé par le brief owner.
 *
 * Usage :
 *   npx tsx acquisition/src/_refold-progress-summary.ts --journal work/coverage/_refold-167-progress.json
 *   ... --list-complete          # liste les slugs devenus complete_final
 *   ... --list-skips             # liste les slugs non déposés avec leur raison
 */
import { readFileSync } from "node:fs";

interface Entry {
  slug: string;
  deposited: boolean;
  skipped_reason: string | null;
  complete_before: boolean;
  complete_final: boolean;
  lot_metrics_before: { num_lots: number; num_with_norms: number; num_with_code_zone: number } | null;
  lot_metrics_final: { num_lots: number; num_with_norms: number; num_with_code_zone: number } | null;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? String(process.argv[i + 1] ?? "") : null;
}
const has = (name: string): boolean => process.argv.includes(name);

const journalPath = arg("--journal");
if (!journalPath) throw new Error("--journal <path> requis");

const raw = JSON.parse(readFileSync(journalPath, "utf8")) as { generated_at: string; entries: Entry[] };
const entries = raw.entries ?? [];

const deposited = entries.filter((e) => e.deposited);
const skipped = entries.filter((e) => !e.deposited);
const reasons = new Map<string, number>();
for (const e of skipped) {
  const key = (e.skipped_reason ?? "?").split(/[:(]/)[0]!.trim();
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}

// « résolu » col-12 = tous les lots portent code_zone ; col-13 = tous portent normes.
const col12Complete = deposited.filter((e) => e.lot_metrics_final && e.lot_metrics_final.num_lots > 0 && e.lot_metrics_final.num_with_code_zone === e.lot_metrics_final.num_lots);
const col13Complete = deposited.filter((e) => e.complete_final);
const col12Newly = col12Complete.filter((e) => !(e.lot_metrics_before && e.lot_metrics_before.num_lots > 0 && e.lot_metrics_before.num_with_code_zone === e.lot_metrics_before.num_lots));
const col13Newly = col13Complete.filter((e) => !e.complete_before);

console.log(`journal=${journalPath} generated_at=${raw.generated_at}`);
console.log(`total=${entries.length} deposited=${deposited.length} skipped=${skipped.length}`);
console.log(`skip_reasons=${JSON.stringify(Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])))}`);
console.log(`col12_complete_final=${col12Complete.length} (newly=${col12Newly.length})`);
console.log(`col13_complete_final=${col13Complete.length} (newly=${col13Newly.length})`);

if (has("--list-complete")) {
  console.log(`col12_complete: ${col12Complete.map((e) => e.slug).join(", ")}`);
  console.log(`col13_complete: ${col13Complete.map((e) => e.slug).join(", ")}`);
}
if (has("--list-skips")) {
  for (const e of skipped) console.log(`SKIP ${e.slug}: ${e.skipped_reason ?? "?"}`);
}
