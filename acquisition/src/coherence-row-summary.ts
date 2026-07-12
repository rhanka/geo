/**
 * coherence-row-summary.ts -- compact per-slug summary of the zone<->grille
 * coherence gate. Reuses evaluateCoherenceSlugs (the SAME read-only analysis the
 * gate uses) and prints one line per slug with the counts + overlap + provenance
 * that a PING-IMMO report needs, without paging the gate's full JSON dump.
 *
 *   npx tsx acquisition/src/coherence-row-summary.ts --slugs mont-tremblant,sutton
 */
import { evaluateCoherenceSlugs } from "./zone-grille-coherence-gate.js";

function arg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf("--" + key);
  return i >= 0 ? argv[i + 1] : undefined;
}

function pct(value: number): string {
  return (value * 100).toFixed(2) + "%";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const requested = arg(argv, "slugs") ?? arg(argv, "slug");
  if (!requested) throw new Error("pass --slugs a,b,c");
  const slugs = requested
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rows = await evaluateCoherenceSlugs(slugs);
  for (const r of rows) {
    console.log(
      [
        r.slug,
        "codes_zone=" + r.codes_zone.length,
        "codes_grille=" + r.codes_grille.length,
        "communs=" + r.communs.length,
        "strict=" + pct(r.recouvrement_strict),
        "raw=" + pct(r.recouvrement_raw),
        "bridged=" + pct(r.recouvrement_bridged),
        "real_zoning=" + r.real_zoning,
        "primary_flag=" + r.primary_flag,
        "source_url=" + (r.source_url ?? "-"),
        "owner=" + (r.owner ?? "-"),
        "layer=" + (r.layer ?? "-"),
      ].join("\t"),
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
