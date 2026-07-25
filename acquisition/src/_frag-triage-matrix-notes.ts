/**
 * _frag-triage-matrix-notes.ts — ONE-OFF (zone-contiguity `fragmented` triage
 * mission): dump the coverage-matrix.json `zones` cell (doneTrack + notes) for
 * the 9 fragmented slugs not yet rectified, to find the ORIGINAL provenance
 * (source PDF/URL) of the contour-auto geometry — a lead for a T1-eligible
 * GeoPDF even when work/zonage-norms/<slug>/ has none on disk today.
 *
 * Usage: npx tsx acquisition/src/_frag-triage-matrix-notes.ts
 */
import { MATRIX_PATH, loadMatrix } from "./coverage-matrix.js";

const SLUGS = [
  "notre-dame-de-lourdes--joliette",
  "saint-amable",
  "preissac",
  "stratford",
  "mont-saint-hilaire",
  "hemmingford--les-jardins-de-napierville--2",
  "cowansville",
  "chelsea",
  "boucherville",
];

const matrix = loadMatrix(MATRIX_PATH);
if (!matrix) throw new Error(`matrice introuvable: ${MATRIX_PATH}`);

for (const slug of SLUGS) {
  const cov = matrix.cities[slug];
  console.log(`\n=== ${slug} ===`);
  if (!cov) {
    console.log("  ABSENT de la matrice");
    continue;
  }
  const z = cov.zones;
  console.log(`  status=${z?.status} doneTrack=${z?.doneTrack} lastResearchAt=${z?.lastResearchAt}`);
  console.log(`  notes: ${z?.notes ?? "(vide)"}`);
}
