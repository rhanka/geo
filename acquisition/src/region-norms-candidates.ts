/**
 * region-norms-candidates — READ-ONLY planning helper (filesystem + registry only,
 * 0 S3, 0 LLM, 0 network). Lists the residual normes munis (zones done ∧ normes≠done)
 * for the Estrie + Montérégie + Centre-du-Québec region, flagging whether a grille
 * PDF is already staged locally (work/zonage-norms/<slug>/grille.pdf or grille-*.pdf)
 * and whether the muni is crawlable via the PV registry (pvIndexUrl).
 *
 * Region membership is decided by the muni's MRC label (municipalities.qc.json).
 * Prints JSON grouped by region + a flat emit list. Committed (passes bash gate).
 *
 * Usage: npx tsx acquisition/src/region-norms-candidates.ts [--json]
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMatrix, MATRIX_PATH, allMunicipalities } from "./coverage-matrix.js";
import { ALL_PV_CITIES } from "../../packages/qc-sources/src/sources/grille-discovery.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK = join(REPO, "work", "zonage-norms");

const REGION_MRCS: Record<string, string[]> = {
  Estrie: [
    "Le Granit", "Le Haut-Saint-François", "Le Val-Saint-François", "Les Sources",
    "Coaticook", "Memphrémagog", "Sherbrooke",
  ],
  Montérégie: [
    "Acton", "Beauharnois-Salaberry", "Brome-Missisquoi", "La Haute-Yamaska",
    "Le Haut-Richelieu", "Le Haut-Saint-Laurent", "Les Jardins-de-Napierville",
    "Les Maskoutains", "La Vallée-du-Richelieu", "Marguerite-D'Youville",
    "Pierre-De Saurel", "Roussillon", "Rouville", "Vaudreuil-Soulanges", "Longueuil",
  ],
  "Centre-du-Québec": [
    "Arthabaska", "Bécancour", "Drummond", "L'Érable", "Nicolet-Yamaska",
  ],
};

function regionOf(mrc: string | null): string | null {
  if (!mrc) return null;
  for (const [region, mrcs] of Object.entries(REGION_MRCS)) {
    if (mrcs.some((m) => m.toLowerCase() === mrc.toLowerCase())) return region;
  }
  return null;
}

/** Any staged grille PDF for the slug: work/zonage-norms/<slug>/*.pdf. */
function stagedGrille(slug: string): string | null {
  const dir = join(WORK, slug);
  if (!existsSync(dir)) return null;
  try {
    const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return null;
    const prefer = pdfs.find((f) => /grille/i.test(f)) ?? pdfs[0]!;
    return join(dir, prefer);
  } catch {
    return null;
  }
}

function main(): void {
  const matrix = loadMatrix(MATRIX_PATH);
  if (!matrix) throw new Error(`matrix not found: ${MATRIX_PATH}`);

  const mrcBySlug = new Map<string, string | null>();
  const nameBySlug = new Map<string, string>();
  for (const m of allMunicipalities()) {
    mrcBySlug.set(m.slug, m.mrc);
    nameBySlug.set(m.slug, m.name);
  }

  const registry = new Map<string, string>();
  for (const e of ALL_PV_CITIES) {
    if (!registry.has(e.config.citySlug)) registry.set(e.config.citySlug, e.config.pvIndexUrl);
  }

  const rows: Array<{
    slug: string; name: string; mrc: string | null; region: string;
    normesStatus: string; hasLocalGrille: boolean; localPath: string | null;
    inRegistry: boolean; pvIndexUrl: string | null;
  }> = [];

  for (const [slug, cov] of Object.entries(matrix.cities)) {
    const c = cov as Record<string, { status?: string }>;
    if (c["zones"]?.status !== "done") continue;
    if (c["normes"]?.status === "done") continue;
    const mrc = mrcBySlug.get(slug) ?? null;
    const region = regionOf(mrc);
    if (!region) continue;
    const local = stagedGrille(slug);
    rows.push({
      slug,
      name: nameBySlug.get(slug) ?? slug,
      mrc,
      region,
      normesStatus: c["normes"]?.status ?? "?",
      hasLocalGrille: local !== null,
      localPath: local,
      inRegistry: registry.has(slug),
      pvIndexUrl: registry.get(slug) ?? null,
    });
  }

  rows.sort((a, b) => (a.region + a.mrc + a.slug).localeCompare(b.region + b.mrc + b.slug));

  const summary = {
    total: rows.length,
    byRegion: Object.fromEntries(
      Object.keys(REGION_MRCS).map((r) => [r, rows.filter((x) => x.region === r).length]),
    ),
    withLocalGrille: rows.filter((r) => r.hasLocalGrille).length,
    crawlable: rows.filter((r) => r.inRegistry).length,
  };

  if (process.argv.includes("--staged")) {
    const staged = rows.filter((r) => r.hasLocalGrille).map((r) => ({
      slug: r.slug, region: r.region, mrc: r.mrc, localPath: r.localPath, pvIndexUrl: r.pvIndexUrl,
    }));
    console.log(JSON.stringify({ count: staged.length, staged }, null, 2));
    return;
  }
  if (process.argv.includes("--crawlable")) {
    const cr = rows.filter((r) => !r.hasLocalGrille && r.inRegistry).map((r) => ({
      slug: r.slug, region: r.region, mrc: r.mrc, pvIndexUrl: r.pvIndexUrl,
    }));
    console.log(JSON.stringify({ count: cr.length, crawlable: cr }, null, 2));
    return;
  }
  console.log(JSON.stringify({ summary, rows }, null, 2));
}

main();
