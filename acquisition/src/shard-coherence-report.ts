/**
 * shard-coherence-report.ts -- compact, read-only per-slug summary of a
 * zone-grille coherence gate JSON (produced by zone-grille-coherence-gate.ts).
 *
 * The gate JSON dumps the FULL code lists per slug (thousands of lines); this
 * reporter distills each row to the fields an IMMO PING needs: counts,
 * strict/raw overlap, provenance and real_zoning. Read-only, no S3, no network.
 *
 * Usage:
 *   npx tsx acquisition/src/shard-coherence-report.ts <gate-json> [slug,slug,...]
 */
import { readFileSync } from "node:fs";

const [jsonPath, slugCsv] = process.argv.slice(2);
if (!jsonPath) {
  console.error("usage: shard-coherence-report.ts <gate-json> [slug,slug]");
  process.exit(1);
}
const wanted = slugCsv ? new Set(slugCsv.split(",").map((s) => s.trim())) : null;

const report = JSON.parse(readFileSync(jsonPath, "utf8")) as {
  generated_at: string;
  rows: Record<string, any>;
};

const pct = (x: number | undefined): string =>
  typeof x === "number" ? `${(x * 100).toFixed(2)}%` : "n/a";

console.log(`# coherence report from ${jsonPath}`);
console.log(`# generated_at=${report.generated_at}`);
for (const [slug, r] of Object.entries(report.rows)) {
  if (wanted && !wanted.has(slug)) continue;
  const nz = Array.isArray(r.codes_zone) ? r.codes_zone.length : 0;
  const ng = Array.isArray(r.codes_grille) ? r.codes_grille.length : 0;
  const nc = Array.isArray(r.communs) ? r.communs.length : 0;
  console.log(
    [
      `slug=${slug}`,
      `real_zoning=${r.real_zoning}`,
      `flag=${r.primary_flag}`,
      `codes_zone=${nz}`,
      `codes_grille=${ng}`,
      `communs=${nc}`,
      `strict=${pct(r.recouvrement_strict)}`,
      `raw=${pct(r.recouvrement_raw)}`,
      `bridged=${pct(r.recouvrement_bridged)}`,
      `zone_features=${r.zone_features}`,
      `source_url=${r.source_url ?? "null"}`,
      `owner=${r.owner ?? "null"}`,
      `layer=${r.layer ?? "null"}`,
    ].join(" "),
  );
}
