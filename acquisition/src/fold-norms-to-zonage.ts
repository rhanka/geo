/**
 * fold-norms-to-zonage.ts — P0 immo (2026-07-13), suite de fold-reglement-to-zonage.
 *
 * La fiche lot immo lit la collection POLYGONE `qc-zonage-<slug>` (S3
 * `normalized/ca-qc-zonage/…`). Pour afficher les NORMES (hauteur/densité/marges/
 * façade/superficie) et pas seulement le règlement, on JOINT la grille
 * `qc-zonage-norms-<slug>` par `zone_code` sur chaque polygone (comme coaticook le
 * fait déjà nativement). Anti-invention: on ne copie QUE des valeurs déjà servies
 * verbatim sur la grille (ou null si la zone n'a pas de ligne). Réversible (--strip).
 *
 * Champs joints = les paires *_value + *_unit affichables (pas les *_raw/*_confidence,
 * pour limiter le poids du geojson polygone).
 *
 * Usage (from acquisition/):
 *   npx tsx src/fold-norms-to-zonage.ts --slugs mont-tremblant --dry-run
 *   npx tsx src/fold-norms-to-zonage.ts --slugs mont-tremblant,sutton
 */
import { pathToFileURL } from "node:url";

import { getBytes, putBytes, exists, s3Client } from "./lib/s3.js";

const NORMS_PREFIX = "normalized/qc-zonage-norms/";
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const NORM_FIELDS = [
  "hauteur_min_value", "hauteur_min_unit", "hauteur_max_value", "hauteur_max_unit",
  "densite_value", "densite_unit",
  "marge_avant_min_value", "marge_avant_min_unit",
  "marge_laterale_min_value", "marge_laterale_min_unit",
  "marge_arriere_min_value", "marge_arriere_min_unit",
  "facade_min_value", "facade_min_unit",
  "superficie_min_value", "superficie_min_unit",
] as const;

type S3 = ReturnType<typeof s3Client>;

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const canon = (v: unknown): string => String(v ?? "").trim().toUpperCase();

/** Map zone_code -> { NORM_FIELDS } depuis la grille servie. */
async function grilleNorms(s3: S3, slug: string): Promise<Map<string, Record<string, unknown>> | null> {
  const key = `${NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
  if (!(await exists(s3, key))) return null;
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
  const map = new Map<string, Record<string, unknown>>();
  for (const f of fc.features ?? []) {
    const p: Record<string, unknown> = f.properties ?? {};
    const zc = canon(p["zone_code"]);
    if (!zc) continue;
    const sub: Record<string, unknown> = {};
    for (const nf of NORM_FIELDS) sub[nf] = p[nf] ?? null;
    map.set(zc, sub);
  }
  return map;
}

async function zonageKey(s3: S3, slug: string): Promise<string | null> {
  const flat = `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`;
  if (await exists(s3, flat)) return flat;
  const sub = `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  if (await exists(s3, sub)) return sub;
  return null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const strip = argv.includes("--strip");
  const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("pass --slugs <a,b>");
    process.exit(2);
  }
  const s3 = s3Client();
  let ok = 0;
  const skipped: string[] = [];
  for (const slug of slugs) {
    const norms = strip ? null : await grilleNorms(s3, slug);
    if (!strip && (!norms || norms.size === 0)) {
      skipped.push(`${slug} (grille norms vide/absente)`);
      continue;
    }
    const key = await zonageKey(s3, slug);
    if (!key) {
      skipped.push(`${slug} (polygone qc-zonage non servi)`);
      continue;
    }
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
    const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
    let matched = 0, changed = 0;
    for (const f of feats) {
      f.properties = f.properties ?? {};
      if (strip) {
        for (const nf of NORM_FIELDS) if (nf in f.properties) { delete f.properties[nf]; changed++; }
        continue;
      }
      const sub = norms!.get(canon(f.properties["zone_code"]));
      if (!sub) continue;
      matched++;
      for (const nf of NORM_FIELDS) {
        if (f.properties[nf] !== sub[nf]) { f.properties[nf] = sub[nf]; changed++; }
      }
    }
    const pct = feats.length ? Math.round((matched / feats.length) * 1000) / 10 : 0;
    console.log(`${dryRun ? "DRY " : "OK  "}${slug} polygones=${feats.length} matched=${matched} (${pct}%) cellsChanged=${changed} key=${key}`);
    if (!dryRun && changed > 0) {
      await putBytes(s3, key, Buffer.from(JSON.stringify(fc)), "application/geo+json");
    }
    ok++;
  }
  for (const s of skipped) console.log(`SKIP ${s}`);
  console.log(`DONE ok=${ok}/${slugs.length} skipped=${skipped.length}${dryRun ? " (dry-run)" : ""}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
