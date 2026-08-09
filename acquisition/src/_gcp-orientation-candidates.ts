/**
 * Gisement « orientation ambiguity » — les rejets SOLUBLES du stock de rapports GCP.
 *
 * Motif (mesuré) : `_gcp-reports-triage.ts` dénombre ~23 rapports rejetés sur
 * `orientation ambiguity: N plausible (non-mirror, isometric) fits disagree...`.
 * Ce rejet n'est PAS un échec de méthode : il dit que la géométrie est SAINE
 * (non-miroir, isométrique — aucune anisotropie parasite) et que seule la rotation
 * (flip 180°) reste indécise. C'est le cas windsor du §7.2 de
 * `docs/spec/zonage-georeferencement-gcp.md`, tranchable par lot-assignment
 * (`--rotation-disambig lots`) — prouvé sur saint-jerome (résidu 5,151 m, rot0 DÉCISIF).
 *
 * Ce script n'invente rien : il lit les rapports déjà produits et liste les slugs
 * dont le rejet appartient à cette famille, avec de quoi décider s'il vaut une relance
 * (nb de fits sains, rotations concurrentes, meilleur résidu, taille du cadastre/SVG).
 *
 * Usage : npx tsx acquisition/src/_gcp-orientation-candidates.ts [--json]
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve("work/gcp");
const asJson = process.argv.includes("--json");

type Row = {
  file: string;
  slug: string;
  fits: number;
  reason: string;
  cadastre_features: number;
  svg_points: number;
  passing_attempts: number;
  rotations: number[];
  best_residual_m: number | null;
  best_holdout_m: number | null;
  best_gcps: number | null;
  pdf?: string;
  pdf_local?: string | null;
  already_disambiguated: boolean;
};

const files = readdirSync(dir).filter((f) => f.endsWith(".report.json"));
const disambigDone = new Set(
  files
    .filter((f) => f.includes("disambig"))
    .map((f) => f.replace(/-disambig.*$/, "").replace(/\.report\.json$/, "")),
);

const rows: Row[] = [];

for (const f of files) {
  let j: any;
  try {
    j = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  } catch {
    continue;
  }
  if (j?.pass !== false) continue;
  const reason = String(j.reason ?? "");
  const m = /orientation ambiguity: (\d+) plausible \(non-mirror, isometric\)/.exec(reason);
  if (!m) continue;

  const attempts: any[] = Array.isArray(j.attempts) ? j.attempts : [];
  const passing = attempts.filter((a) => a?.pass === true);
  const rotations = [...new Set(passing.map((a) => Number(a.rotation)))].sort((a, b) => a - b);
  const byResidual = [...passing].sort(
    (a, b) => (a.residual_max_m ?? 1e9) - (b.residual_max_m ?? 1e9),
  );
  const best = byResidual[0];

  // Le PDF source : soit noté dans le rapport, soit deviné dans work/pdf/.
  const slug = String(j.slug ?? f.replace(/\.report\.json$/, ""));
  const pdf = j.pdf ?? j.pdf_path ?? j.source_pdf ?? j.source ?? undefined;
  let pdfLocal: string | null = null;
  const pdfDir = resolve("work/pdf");
  if (existsSync(pdfDir)) {
    const hit = readdirSync(pdfDir).find(
      (p) => p.toLowerCase().endsWith(".pdf") && p.startsWith(slug),
    );
    if (hit) pdfLocal = `work/pdf/${hit}`;
  }

  rows.push({
    file: f,
    slug,
    fits: Number(m[1]),
    reason: reason.slice(0, 120),
    cadastre_features: Number(j.cadastre_features ?? 0),
    svg_points: Number(j.svg_points ?? 0),
    passing_attempts: passing.length,
    rotations,
    best_residual_m: best?.residual_max_m ?? null,
    best_holdout_m: best?.holdout_max_m ?? null,
    best_gcps: best?.selected_gcps ?? null,
    pdf: typeof pdf === "string" ? pdf : undefined,
    pdf_local: pdfLocal,
    already_disambiguated: disambigDone.has(slug),
  });
}

// Tri : les plus prometteurs d'abord (résidu bas, beaucoup de svg_points).
rows.sort((a, b) => (a.best_residual_m ?? 1e9) - (b.best_residual_m ?? 1e9));

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(`rapports « orientation ambiguity » (géométrie SAINE, rotation indécise) : ${rows.length}\n`);
  console.log(
    "slug".padEnd(38) +
      "fits".padStart(5) +
      "pass".padStart(5) +
      "rot".padStart(14) +
      "resid".padStart(9) +
      "hold".padStart(8) +
      "gcps".padStart(6) +
      "  cad/svg" +
      "  pdf",
  );
  for (const r of rows) {
    console.log(
      (r.slug + (r.already_disambiguated ? " *" : "")).padEnd(38) +
        String(r.fits).padStart(5) +
        String(r.passing_attempts).padStart(5) +
        `[${r.rotations.join(",")}]`.padStart(14) +
        (r.best_residual_m ?? "-").toString().padStart(9) +
        (r.best_holdout_m ?? "-").toString().padStart(8) +
        (r.best_gcps ?? "-").toString().padStart(6) +
        `  ${r.cadastre_features}/${r.svg_points}` +
        `  ${r.pdf_local ?? r.pdf ?? "(pdf inconnu)"}`,
    );
  }
  console.log(`\n* = un rapport -disambig existe déjà pour ce slug (déjà tranché).`);
}
