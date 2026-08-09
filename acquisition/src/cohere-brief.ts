/**
 * cohere-brief.ts -- compact one-line-per-slug reader for a zone-grille
 * coherence report JSON (the file written by zone-grille-coherence-gate.ts).
 *
 * The gate itself only prints the PROBLEM buckets (incoherentes / order-mismatch
 * / ancien-zonage). This helper prints the scalar metrics for EVERY requested
 * slug (zone/grille/commun counts, strict overlap, flags, real_zoning) so a
 * conductor can PING immo without paging the giant codes_zone/codes_grille
 * arrays.
 *
 * Usage:
 *   npx tsx acquisition/src/cohere-brief.ts [--in <report.json>] [--slugs a,b,c]
 * Defaults to work/coverage/zone-grille-coherence.json and all slugs in it.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DEFAULT_REPORT = join(ROOT, "work", "coverage", "zone-grille-coherence.json");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pct(x: unknown): string {
  const n = typeof x === "number" ? x : 0;
  return `${(n * 100).toFixed(1)}%`;
}

function main(): void {
  const inPath = arg("--in") ?? DEFAULT_REPORT;
  const only = arg("--slugs")?.split(",").map((s) => s.trim()).filter(Boolean);
  const doc = JSON.parse(readFileSync(inPath, "utf8")) as {
    rows?: Record<string, any>;
  };
  const rows = doc.rows ?? {};
  const slugs = (only && only.length ? only : Object.keys(rows)).sort();
  console.log(`# cohere-brief ${inPath}`);
  console.log(
    "slug\tflag\treal\tzone\tgrille\tcommun\tstrict\traw\tbridged\tsource_url",
  );
  for (const slug of slugs) {
    const r = rows[slug];
    if (!r) {
      console.log(`${slug}\t(absent du rapport)`);
      continue;
    }
    console.log(
      [
        slug,
        r.primary_flag ?? (r.flags ?? []).join("|") ?? "?",
        r.real_zoning === true ? "true" : "false",
        Array.isArray(r.codes_zone) ? r.codes_zone.length : "?",
        Array.isArray(r.codes_grille) ? r.codes_grille.length : "?",
        Array.isArray(r.communs) ? r.communs.length : "?",
        pct(r.recouvrement_strict),
        pct(r.recouvrement_raw),
        pct(r.recouvrement_bridged),
        r.source_url ?? "-",
      ].join("\t"),
    );
  }
}

main();
