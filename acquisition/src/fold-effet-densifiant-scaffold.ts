/**
 * fold-effet-densifiant-scaffold.ts — 4a immo (loop-mrjumq96, evol-filtrage-vivier).
 *
 * Pose le CONTRAT tri-état "effet densifiant" (noms confirmés par immo 2026-07-13)
 * sur chaque feature de la collection POLYGONE `qc-zonage-<slug>` (lue par le lot).
 * Métrique = NB LOGEMENTS AUTORISÉS (le "log" de Steve), pas le champ densite flou.
 *
 * Scaffold HONNÊTE (anti-invention): effet_densifiant='inconnu' partout tant que
 * l'AVANT (valeur pré-amendement exacte de la zone) n'est pas acquis. On remplit
 * seulement ce qu'on SAIT déjà: densite_apres_reglement/_millesime = le règlement
 * en vigueur déjà servi sur le polygone (reglement_numero/_millesime). Le nb de
 * logements (densite_apres) reste null tant qu'il n'est pas extrait verbatim.
 * Idempotent: ne SET que les clés absentes (n'écrase pas un remplissage réel futur).
 *
 * Usage (from acquisition/):
 *   npx tsx src/fold-effet-densifiant-scaffold.ts --slugs saint-stanislas-de-kostka,sutton,saint-raphael --dry-run
 *   npx tsx src/fold-effet-densifiant-scaffold.ts --slugs saint-stanislas-de-kostka,sutton,saint-raphael
 */
import { pathToFileURL } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";
import { putServedZoneAdditive } from "./lib/zonage-proof.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
type S3 = ReturnType<typeof s3Client>;

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function zonageKeys(s3: S3, slug: string): Promise<string[]> {
  const candidates = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const keys: string[] = [];
  for (const key of candidates) if (await exists(s3, key)) keys.push(key);
  return keys;
}

const CONTRACT = [
  "densite_avant", "densite_avant_millesime", "densite_avant_reglement",
  "densite_apres", "densite_apres_millesime", "densite_apres_reglement",
  "effet_densifiant", "effet_densifiant_delta",
] as const;

/** N'écrit une clé que si absente (idempotent + ne clobbe pas un fill réel). */
function setIfAbsent(props: Record<string, unknown>, key: string, val: unknown): number {
  if (!(key in props)) { props[key] = val; return 1; }
  return 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const strip = argv.includes("--strip");
  const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) { console.error("pass --slugs <a,b>"); process.exit(2); }
  const s3 = s3Client();
  let ok = 0;
  const skipped: string[] = [];
  for (const slug of slugs) {
    const keys = await zonageKeys(s3, slug);
    if (keys.length === 0) { skipped.push(`${slug} (polygone qc-zonage non servi)`); continue; }
    for (const key of keys) {
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")); // objet COMPLET (préserve type/crs)
      if (!fc.type) fc.type = "FeatureCollection"; // garde-fou anti-404
      const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
      let changed = 0;
      for (const f of feats) {
        f.properties = f.properties ?? {};
        const p = f.properties;
        if (strip) {
          for (const k of CONTRACT) if (k in p) { delete p[k]; changed++; }
          continue;
        }
        // AVANT: inconnu (acquisition à venir)
        changed += setIfAbsent(p, "densite_avant", null);
        changed += setIfAbsent(p, "densite_avant_millesime", null);
        changed += setIfAbsent(p, "densite_avant_reglement", null);
        // APRES: nb logements pas encore extrait -> null ; mais on connaît le règlement en vigueur servi
        changed += setIfAbsent(p, "densite_apres", null);
        changed += setIfAbsent(p, "densite_apres_millesime", (p["reglement_millesime"] as unknown) ?? null);
        changed += setIfAbsent(p, "densite_apres_reglement", (p["reglement_numero"] as unknown) ?? null);
        // verdict tri-état: inconnu tant que avant+apres absents
        changed += setIfAbsent(p, "effet_densifiant", "inconnu");
        changed += setIfAbsent(p, "effet_densifiant_delta", null);
      }
      console.log(`${dryRun ? "DRY " : "OK  "}${slug} polygones=${feats.length} cellsChanged=${changed} key=${key}`);
      if (!dryRun && changed > 0) {
        await putServedZoneAdditive(s3, key, fc, { allowedProps: CONTRACT });
      }
    }
    ok++;
  }
  for (const s of skipped) console.log(`SKIP ${s}`);
  console.log(`DONE ok=${ok}/${slugs.length} skipped=${skipped.length}${dryRun ? " (dry-run)" : ""}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
