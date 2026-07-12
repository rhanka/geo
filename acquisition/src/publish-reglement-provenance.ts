/**
 * publish-reglement-provenance.ts — P0_1 lane (demande Steve/immo 2026-07-12).
 *
 * SURFACE la provenance du RÈGLEMENT sur les grilles de normes SERVIES: ajoute 4
 * champs FIGÉS à CHAQUE feature de `normalized/qc-zonage-norms/qc-zonage-norms-<slug>.geojson`:
 *   reglement_numero, reglement_millesime, reglement_page_source, reglement_url
 * (passthrough verbatim d'un registre par muni; anti-invention: champ inconnu = null).
 *
 * Le geo-api sert ce geojson tel quel -> immo lit ces 4 champs sur la fiche lot
 * (« de quel règlement/millésime vient chaque norme »). RÉVERSIBLE (re-run sans le
 * slug dans le registre = laisse les champs; --strip pour les retirer).
 *
 * Registre: acquisition/config/reglement-provenance.json ({ slugs: { <slug>: {...4} } }).
 *
 * Usage (npx tsx, from repo root):
 *   npx tsx acquisition/src/publish-reglement-provenance.ts --slugs mont-tremblant,sutton,alma
 *   npx tsx acquisition/src/publish-reglement-provenance.ts --slugs alma --dry-run
 *   npx tsx acquisition/src/publish-reglement-provenance.ts --all   # tous les slugs du registre
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getBytes, putBytes, exists, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const SERVED_PREFIX = "normalized/qc-zonage-norms/";
const FIELDS = ["reglement_numero", "reglement_millesime", "reglement_page_source", "reglement_url"] as const;

interface Prov {
  reglement_numero: string | null;
  reglement_millesime: string | null;
  reglement_page_source: string | null;
  reglement_url: string | null;
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const strip = argv.includes("--strip");
  const cfg = JSON.parse(readFileSync(CONFIG, "utf8")) as { slugs: Record<string, Prov> };
  const slugsArg = arg(argv, "slugs");
  const slugs = argv.includes("--all")
    ? Object.keys(cfg.slugs)
    : (slugsArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("pass --slugs <a,b> or --all");
    process.exit(2);
  }
  const s3 = s3Client();
  let ok = 0;
  const skipped: string[] = [];
  for (const slug of slugs) {
    const prov = cfg.slugs[slug];
    if (!prov && !strip) {
      skipped.push(`${slug} (absent du registre)`);
      continue;
    }
    const key = `${SERVED_PREFIX}qc-zonage-norms-${slug}.geojson`;
    if (!(await exists(s3, key))) {
      skipped.push(`${slug} (grille non servie: ${key})`);
      continue;
    }
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
    const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
    let changed = 0;
    for (const f of feats) {
      f.properties = f.properties ?? {};
      for (const field of FIELDS) {
        const val = strip ? undefined : (prov as Record<string, unknown>)[field] ?? null;
        if (strip) {
          if (field in f.properties) { delete f.properties[field]; changed++; }
        } else if (f.properties[field] !== val) {
          f.properties[field] = val;
          changed++;
        }
      }
    }
    const numero = strip ? "(stripped)" : prov.reglement_numero;
    console.log(`${dryRun ? "DRY " : "OK  "}${slug} features=${feats.length} cellsChanged=${changed} reglement=${numero}`);
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
