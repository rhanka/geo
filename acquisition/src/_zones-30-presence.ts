/**
 * Sonde ciblee : presence/completion zones SERVIE pour la cohorte A (30 villes),
 * lue depuis la matrice v2 autoritaire (608c23d2, post-masse). Colonne KPI 1
 * (zones servies) + col 10 (v2) pour les 30. Presence servie = quality_status
 * dans {v2, acceptable, candidate} ; absent/incomplet = {orphan, unknown, absent}.
 *
 * Usage : npx tsx acquisition/src/_zones-30-presence.ts --out=<json> --markdown=<md>
 */
import { readFileSync, writeFileSync } from "node:fs";

const MATRIX = "work/coverage/zone-provenance-quality-matrix-20260803T001639Z-81de8d776a7d73c9.json";

const COHORT30 = [
  "westmount", "saint-lambert", "hampstead", "mont-royal", "montreal-ouest",
  "cote-saint-luc", "longueuil", "sainte-catherine", "la-prairie", "delson",
  "candiac", "montreal-est", "boucherville", "dorval", "saint-constant",
  "saint-bruno-de-montarville", "carignan", "dollard-des-ormeaux", "pointe-claire",
  "saint-philippe", "saint-mathieu", "chateauguay", "sainte-julie",
  "saint-basile-le-grand", "chambly", "rosemere", "varennes",
  "brossard", "ile-dorval", "kirkland",
];

function opt(name: string): string | null {
  const p = `--${name}=`;
  const a = process.argv.slice(2).find((x) => x.startsWith(p));
  return a === undefined ? null : a.slice(p.length);
}

const root = JSON.parse(readFileSync(MATRIX, "utf8")) as { contract?: string; rows?: unknown };
if (root.contract !== "zone-provenance-quality-matrix/v1") throw new Error(`contract inattendu: ${root.contract}`);
const bySlug = new Map<string, string>();
for (const r of root.rows as Array<Record<string, unknown>>) {
  if (typeof r.city_slug === "string" && typeof r.quality_status === "string") bySlug.set(r.city_slug, r.quality_status);
}

// KPI 1 = geometrie SERVIE (orphan = servi SANS preuve, donc PRESENT en geometrie).
const SERVED_GEOM = new Set(["v2", "acceptable", "candidate", "orphan"]);
// KPI 11 = provenance/url presente (proof non-null) : orphan exclu (proof:null).
const PROVENANCE = new Set(["v2", "acceptable", "candidate"]);
const rows = COHORT30.map((slug) => {
  const q = bySlug.get(slug) ?? null;
  return {
    slug,
    quality_status: q,
    served_geometry: q !== null && SERVED_GEOM.has(q),
    provenance_present: q !== null && PROVENANCE.has(q),
    v2: q === "v2",
    orphan_no_proof: q === "orphan",
    absent_from_matrix: q === null,
  };
});

const counts = {
  total: rows.length,
  served_geometry: rows.filter((r) => r.served_geometry).length,
  provenance_present: rows.filter((r) => r.provenance_present).length,
  v2: rows.filter((r) => r.v2).length,
  orphan_no_proof: rows.filter((r) => r.orphan_no_proof).length,
  not_served: rows.filter((r) => !r.served_geometry).length,
  absent_from_matrix: rows.filter((r) => r.absent_from_matrix).length,
};

const report = {
  contract: "zones-cohort30-presence/v1",
  matrix: MATRIX,
  matrix_revision: "608c23d2",
  counts,
  rows,
};
const outPath = opt("out");
const mdPath = opt("markdown");
if (outPath) writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
if (mdPath) {
  const presenceGaps = rows.filter((r) => !r.served_geometry).map((r) => `${r.slug} (${r.quality_status ?? "absent-matrice"})`).join(", ") || "aucun";
  const provGaps = rows.filter((r) => r.served_geometry && !r.provenance_present).map((r) => `${r.slug} (${r.quality_status})`).join(", ") || "aucun";
  writeFileSync(mdPath, `# Cohorte-30 zones (matrice 608c23d2)\n\nKPI1 geometrie SERVIE ${counts.served_geometry}/30 ; KPI11 provenance presente ${counts.provenance_present}/30 ; v2 ${counts.v2}/30.\nGaps PRESENCE (KPI1, non-servi) : ${presenceGaps}.\nGaps PROVENANCE (KPI11, servi mais orphan/no-proof) : ${provGaps}.\n`);
}
process.stdout.write(`${JSON.stringify(counts)}\n`);
