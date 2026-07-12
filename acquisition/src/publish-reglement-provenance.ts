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
 *   npx tsx acquisition/src/publish-reglement-provenance.ts --generalize --dry-run  # coverage 817
 *   npx tsx acquisition/src/publish-reglement-provenance.ts --generalize            # sert toutes les grilles
 *
 * --generalize: pour CHAQUE grille servie, MINE la provenance DÉJÀ DÉPOSÉE
 * (reglement_numero <- _reglement, reglement_url <- _source_url, verbatim). La
 * millesime + page_source ne viennent QUE du registre curé (jamais dérivées d'un
 * numéro de règlement = ce serait de l'invention). Le registre curé override champ
 * par champ (valeur curée non-null gagne, sinon repli sur le miné).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getBytes, putBytes, exists, listSlugs, s3Client } from "./lib/s3.js";

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

const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v);

/** Provenance minée depuis la provenance DÉJÀ déposée dans la grille (verbatim),
 *  le registre curé override champ par champ (curé non-null gagne). Anti-invention:
 *  millesime + page_source NE viennent QUE du registre curé. */
function resolveProv(firstProps: Record<string, unknown>, curated?: Prov): Prov {
  const minedNumero = asStr(firstProps["_reglement"]);
  const minedUrl = isUrl(firstProps["_source_url"]) ? (firstProps["_source_url"] as string) : null;
  return {
    reglement_numero: curated?.reglement_numero ?? minedNumero,
    reglement_millesime: curated?.reglement_millesime ?? null,
    reglement_page_source: curated?.reglement_page_source ?? null,
    reglement_url: curated?.reglement_url ?? minedUrl,
  };
}

/** Applique/retire les 4 champs sur la grille servie d'un slug. Retourne le compte
 *  de cellules modifiées + le nombre de features (null si grille non servie). */
async function applyToServed(
  s3: ReturnType<typeof s3Client>,
  slug: string,
  prov: Prov,
  opts: { dryRun: boolean; strip: boolean },
): Promise<{ features: number; changed: number } | null> {
  const key = `${SERVED_PREFIX}qc-zonage-norms-${slug}.geojson`;
  if (!(await exists(s3, key))) return null;
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
  const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
  let changed = 0;
  for (const f of feats) {
    f.properties = f.properties ?? {};
    for (const field of FIELDS) {
      if (opts.strip) {
        if (field in f.properties) { delete f.properties[field]; changed++; }
      } else {
        const val = (prov as Record<string, unknown>)[field] ?? null;
        if (f.properties[field] !== val) { f.properties[field] = val; changed++; }
      }
    }
  }
  if (!opts.dryRun && changed > 0) {
    await putBytes(s3, key, Buffer.from(JSON.stringify(fc)), "application/geo+json");
  }
  return { features: feats.length, changed };
}

/** Lit les properties de la 1re feature d'une grille servie (pour miner la provenance). */
async function firstProps(
  s3: ReturnType<typeof s3Client>,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const key = `${SERVED_PREFIX}qc-zonage-norms-${slug}.geojson`;
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
  return fc.features?.[0]?.properties ?? {};
}

async function generalize(dryRun: boolean, cfg: { slugs: Record<string, Prov> }): Promise<void> {
  const s3 = s3Client();
  const rests = await listSlugs(s3, SERVED_PREFIX, ".geojson", true);
  const slugs = rests
    .filter((r) => r.startsWith("qc-zonage-norms-"))
    .map((r) => r.slice("qc-zonage-norms-".length))
    .sort();
  console.log(`generalize: ${slugs.length} grilles servies`);
  let numeroFilled = 0, urlFilled = 0, curated = 0, served = 0, i = 0;
  for (const slug of slugs) {
    i++;
    const props = await firstProps(s3, slug);
    if (!props) continue;
    const cur = cfg.slugs[slug];
    if (cur) curated++;
    const prov = resolveProv(props, cur);
    if (prov.reglement_numero) numeroFilled++;
    if (prov.reglement_url) urlFilled++;
    const res = await applyToServed(s3, slug, prov, { dryRun, strip: false });
    if (res) served++;
    if (i % 100 === 0) console.log(`  ...${i}/${slugs.length}`);
  }
  console.log(
    `DONE generalize${dryRun ? " (dry-run)" : ""}: served=${served}/${slugs.length} ` +
      `numero=${numeroFilled} url=${urlFilled} curated(millesime)=${curated}`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const strip = argv.includes("--strip");
  const cfg = JSON.parse(readFileSync(CONFIG, "utf8")) as { slugs: Record<string, Prov> };

  if (argv.includes("--generalize")) {
    await generalize(dryRun, cfg);
    return;
  }

  const slugsArg = arg(argv, "slugs");
  const slugs = argv.includes("--all")
    ? Object.keys(cfg.slugs)
    : (slugsArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("pass --slugs <a,b>, --all, or --generalize");
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
    const res = await applyToServed(s3, slug, prov ?? ({} as Prov), { dryRun, strip });
    if (!res) {
      skipped.push(`${slug} (grille non servie)`);
      continue;
    }
    const numero = strip ? "(stripped)" : prov.reglement_numero;
    console.log(`${dryRun ? "DRY " : "OK  "}${slug} features=${res.features} cellsChanged=${res.changed} reglement=${numero}`);
    ok++;
  }
  for (const s of skipped) console.log(`SKIP ${s}`);
  console.log(`DONE ok=${ok}/${slugs.length} skipped=${skipped.length}${dryRun ? " (dry-run)" : ""}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
