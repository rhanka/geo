/**
 * normes-shard-targets — READ-ONLY sélecteur déterministe des cibles PRODUCTIBLES
 * de la lane normes, par shard.
 *
 * Une cible PRODUCTIBLE = une muni dont la couche `zones` est `done` (on a la
 * géométrie, donc un dépôt de normes est joignable aux lots) et dont la couche
 * `normes` n'est PAS `done`. Tri alphabétique stable, puis filtre `index % n == i`.
 *
 * Pour chaque cible on rapporte, à $0 :
 *   - `pdf` : un PDF grille déjà présent sur disque (`work/zonage-norms/<slug>/*.pdf`),
 *     levier #1 de la découverte (le règlement de zonage porte la grille en annexe) ;
 *   - `plan` : un PDF de plan de zonage déjà récupéré par la lane recalage
 *     (`work/zonage-plans/<slug>*.pdf`) — même document dans bien des cas ;
 *   - la MRC, pour permettre une découverte groupée par portail MRC.
 *
 * Pure lecture : pas de réseau, pas de LLM, aucune écriture.
 * Usage: npx tsx acquisition/src/normes-shard-targets.ts --shard 1 --shards 2 [--limit 15] [--with-pdf-only] [--json]
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMatrix } from "./coverage-matrix.js";
import municipalitiesRaw from "../../packages/qc-sources/src/geo/municipalities.qc.json" with { type: "json" };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const NORMS_DIR = join(REPO, "work", "zonage-norms");
const PLANS_DIR = join(REPO, "work", "zonage-plans");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const shard = Number(arg("shard", "0"));
const shards = Number(arg("shards", "2"));
const limit = arg("limit") ? Number(arg("limit")) : undefined;
const withPdfOnly = hasFlag("with-pdf-only");
const asJson = hasFlag("json");

const MRC_BY_SLUG = new Map<string, string | null>(
  (municipalitiesRaw as ReadonlyArray<{ slug: string; mrc: string | null }>).map((m) => [m.slug, m.mrc]),
);

/** PDFs déjà stagés pour ce slug par la lane normes (grille.pdf et frères). */
function localNormsPdfs(slug: string): string[] {
  const dir = join(NORMS_DIR, slug);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .map((f) => join("work/zonage-norms", slug, f));
  } catch {
    return [];
  }
}

/** PDFs de plan de zonage déjà récupérés par la lane recalage (préfixe = slug). */
function localPlanPdfs(slug: string): string[] {
  if (!existsSync(PLANS_DIR)) return [];
  try {
    return readdirSync(PLANS_DIR)
      .filter((f) => f.toLowerCase().endsWith(".pdf") && (f === `${slug}.pdf` || f.startsWith(`${slug}.`) || f.startsWith(`${slug}-`)))
      .map((f) => join("work/zonage-plans", f));
  } catch {
    return [];
  }
}

const matrix = loadMatrix();
const cities: Record<string, any> = (matrix as any).cities ?? {};

type Row = {
  slug: string;
  mrc: string | null;
  zonesTrack?: string;
  normesStatus: string;
  normesTracks: string[];
  pdfs: string[];
  plans: string[];
};

const all: Row[] = [];
for (const [slug, layers] of Object.entries<any>(cities)) {
  const z = layers?.zones;
  const n = layers?.normes;
  if (!z || !n) continue;
  if (z.status !== "done") continue;
  if (n.status === "done") continue;
  all.push({
    slug,
    mrc: MRC_BY_SLUG.get(slug) ?? null,
    zonesTrack: z.doneTrack,
    normesStatus: n.status,
    normesTracks: n.candidateTracks ?? [],
    pdfs: localNormsPdfs(slug),
    plans: localPlanPdfs(slug),
  });
}
all.sort((a, b) => a.slug.localeCompare(b.slug));

let mine = all.filter((_, i) => i % shards === shard);
if (withPdfOnly) mine = mine.filter((r) => r.pdfs.length > 0 || r.plans.length > 0);
const out = limit ? mine.slice(0, limit) : mine;

if (asJson) {
  console.log(JSON.stringify({ total: all.length, shard, shards, mine: mine.length, rows: out }, null, 2));
} else {
  console.log(
    `[normes-shard-targets] zones=done & normes!=done : total=${all.length} · shard ${shard}/${shards}=${mine.length}` +
      (withPdfOnly ? " (avec PDF local)" : "") +
      (limit ? ` · affichés=${out.length}` : ""),
  );
  const withPdf = mine.filter((r) => r.pdfs.length > 0).length;
  const withPlan = mine.filter((r) => r.plans.length > 0).length;
  console.log(`[normes-shard-targets] shard: PDF normes local=${withPdf} · plan local=${withPlan}`);
  for (const r of out) {
    const src = r.pdfs.length ? `PDF:${r.pdfs.length}` : r.plans.length ? `PLAN:${r.plans.length}` : "-";
    console.log(`${r.slug}\t${r.normesStatus}\t${src}\t${r.mrc ?? "?"}\t[${r.normesTracks.join(",")}]`);
  }
}
