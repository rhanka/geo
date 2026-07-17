/**
 * fold-reglement-to-zonage.ts — P0 immo (2026-07-13).
 *
 * La fiche lot immo enrichit sa zone via la collection POLYGONE `qc-zonage-<slug>`
 * (S3 `normalized/ca-qc-zonage/…`), PAS via `qc-zonage-norms-<slug>`. Le plumbing
 * immo (#367) affiche « Regl. {numero} ({millesime}) » + lien source dès que le
 * POLYGONE porte `reglement_numero/reglement_millesime/reglement_page_source/reglement_url`.
 *
 * Ce tool COPIE ces 4 champs (VERBATIM, déjà servis sur `qc-zonage-norms-<slug>`)
 * sur CHAQUE feature du polygone `qc-zonage-<slug>` (le règlement de zonage est
 * per-muni = constant sur tous les polygones). Anti-invention: ne stampe QUE si le
 * numéro est présent côté norms (sinon skip = null honnête). Réversible (--strip).
 *
 * Usage (npx tsx, from acquisition/):
 *   npx tsx src/fold-reglement-to-zonage.ts --slugs mont-tremblant,sutton --dry-run
 *   npx tsx src/fold-reglement-to-zonage.ts --slugs mont-tremblant,sutton,saint-raphael
 *   npx tsx src/fold-reglement-to-zonage.ts --all --dry-run   # toutes les villes zones-servies
 *   npx tsx src/fold-reglement-to-zonage.ts --all
 *
 * --all: le P0_1 vise TOUTES les villes, pas une liste à la main. L'univers est la
 * matrice de couverture (zones=done); chaque ville sans numéro côté norms est skippée
 * (null honnête), donc le passage est idempotent et sans invention.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadMatrix, MATRIX_PATH } from "./coverage-matrix.js";
import { getBytes, putBytes, exists, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const NORMS_PREFIX = "normalized/qc-zonage-norms/";
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const FIELDS = ["reglement_numero", "reglement_millesime", "reglement_page_source", "reglement_url"] as const;

/** Registre curé committé = source de vérité DURABLE (la lane norms // écrase les
 *  champs sur qc-zonage-norms, donc on préfère le registre). */
function registryReglement(slug: string): Record<string, unknown> | null {
  const cfg = JSON.parse(readFileSync(REGISTRY, "utf8")) as { slugs: Record<string, Record<string, unknown>> };
  const e = cfg.slugs[slug];
  if (!e || !e["reglement_numero"]) return null;
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) out[f] = e[f] ?? null;
  return out;
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

type S3 = ReturnType<typeof s3Client>;

/** Reglement 4-champs déjà servis sur la grille de normes du slug (source verbatim). */
async function normsReglement(s3: S3, slug: string): Promise<Record<string, unknown> | null> {
  const key = `${NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
  if (!(await exists(s3, key))) return null;
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
  const p: Record<string, unknown> = fc.features?.[0]?.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) out[f] = p[f] ?? null;
  return out["reglement_numero"] ? out : null;
}

/** Clé S3 du polygone zonage (layout plat OU sous-dossier). */
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
  let slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (argv.includes("--all")) {
    const matrix = loadMatrix(MATRIX_PATH);
    if (matrix === null) throw new Error(`matrice introuvable: ${MATRIX_PATH}`);
    slugs = Object.keys(matrix.cities)
      .filter((s) => matrix.cities[s]?.zones?.status === "done")
      .sort();
    console.log(`--all: ${slugs.length} villes zones-servies`);
  }
  if (slugs.length === 0) {
    console.error("pass --slugs <a,b> or --all");
    process.exit(2);
  }
  const s3 = s3Client();
  let ok = 0;
  const skipped: string[] = [];
  for (const slug of slugs) {
    const regl = strip ? null : (registryReglement(slug) ?? (await normsReglement(s3, slug)));
    if (!strip && !regl) {
      skipped.push(`${slug} (pas de reglement_numero: ni registre ni qc-zonage-norms)`);
      continue;
    }
    const key = await zonageKey(s3, slug);
    if (!key) {
      skipped.push(`${slug} (polygone qc-zonage non servi)`);
      continue;
    }
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
    const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
    let changed = 0;
    for (const f of feats) {
      f.properties = f.properties ?? {};
      for (const field of FIELDS) {
        if (strip) {
          if (field in f.properties) { delete f.properties[field]; changed++; }
        } else {
          const val = (regl as Record<string, unknown>)[field] ?? null;
          if (f.properties[field] !== val) { f.properties[field] = val; changed++; }
        }
      }
    }
    const numero = strip ? "(stripped)" : regl!["reglement_numero"];
    console.log(`${dryRun ? "DRY " : "OK  "}${slug} polygones=${feats.length} cellsChanged=${changed} reglement=${numero} key=${key}`);
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
