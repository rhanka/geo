/**
 * _reglement-provenance-holdnull-triage.ts — triage $0 des HOLD-NULL d'un shard.
 *
 * Pour chaque slug servi SANS provenance (served && !reglement) déjà présent au
 * registre avec reglement_numero=null (HOLD-NULL), imprime:
 *   - la forme de l'URL manifest (CORPS probable vs ANNEXE/grille probable)
 *   - le début du _note du registre (pour distinguer un JUGEMENT rendu — à
 *     respecter — d'une prémisse MESURABLE rendue sur la mauvaise pièce — à
 *     re-ouvrir à $0). Mémoire note-premisse-mesurable-vs-jugement.
 *
 * READ-ONLY. Usage (from repo root):
 *   npx tsx acquisition/src/_reglement-provenance-holdnull-triage.ts --shard 1/2
 *   npx tsx acquisition/src/_reglement-provenance-holdnull-triage.ts --shard 1/2 --corps-only
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client, getBytes } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

/** Heuristique $0 sur la forme d'URL: CORPS (règlement complet, porte le numéro)
 *  vs ANNEXE (cahier de grilles, souvent SANS numéro). Ne décide RIEN — oriente
 *  seulement le triage; c'est le document lu qui tranche. */
function urlShape(url: string | null): string {
  if (!url) return "NO-URL";
  const u = decodeURIComponent(url).toLowerCase();
  const annexe = /(grille|specification|sp[eé]cification|annexe|cahier|usages?-et-normes|usages?_et_normes|normes-implantation)/.test(u);
  const corps = /(zonage|r[eè]glement|reglement|by-?law|refonte)/.test(u);
  if (annexe && !corps) return "ANNEXE";
  if (corps && !annexe) return "CORPS";
  if (corps && annexe) return "MIXTE"; // ex: reglement_de_zonage + grilles
  return "AUTRE";
}

async function main(): Promise<void> {
  const shardSpec = arg("shard");
  const corpsOnly = process.argv.includes("--corps-only");

  const enrich = JSON.parse(readFileSync(ENRICH, "utf8")) as {
    perMuni: Array<{ slug: string; served?: boolean; reglement?: boolean }>;
  };
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as {
    slugs: Record<string, { reglement_numero: unknown; _note?: string }>;
  };

  const targets = enrich.perMuni
    .filter((m) => m.served === true && m.reglement === false)
    .map((m) => m.slug)
    .sort();

  let mine = targets;
  if (shardSpec) {
    const [i, n] = shardSpec.split("/").map(Number);
    mine = targets.filter((_, idx) => idx % n === i);
  }

  const s3 = s3Client();
  const manifest = JSON.parse(
    (await getBytes(s3, "registry/qc-zonage-norms/manifest.json")).toString("utf8"),
  ) as { entries?: Array<{ slug: string; source_url?: string }> };
  const urlBySlug = new Map<string, string>();
  for (const e of manifest.entries ?? []) {
    const v = (e.source_url ?? "").trim();
    if (/^https?:\/\//i.test(v)) {
      try {
        if (new URL(v).hostname.includes(".")) urlBySlug.set(e.slug, v);
      } catch { /* skip */ }
    }
  }

  const staleOnly = process.argv.includes("--stale-only");
  const accessFailOnly = process.argv.includes("--access-fail");
  // Échec d'ACCÈS mesurable (peut se rétablir): à re-curler à $0.
  const ACCESS_FAIL = /(http[ =]?(000|403|404|5\d\d)|lien mort|injoignable|timeout|time ?out|ne repond pas|http=000|blocage acces|waf|403|404)/i;
  // Prémisse MESURABLE périmable: la note affirme "rien à lire / pas d'URL / dossier
  // vide", MAIS le manifest sert MAINTENANT une URL réelle => null STALE (levier cdx,
  // mémoire null-verdict-perime-par-depot-amont). À re-ouvrir à $0.
  const STALE_PREMISE = /(aucune entree au manifest|no-?grille|no-?local-?pdf|aucun source_url|aucun pdf local|rien a lire|dossier vide|defaut de decouverte|pas de pdf|introuvable)/i;

  let shown = 0;
  for (const slug of mine) {
    const reg = registry.slugs[slug];
    if (!reg || reg.reglement_numero) continue; // HOLD-NULL only
    const url = urlBySlug.get(slug) ?? null;
    const shape = urlShape(url);
    const noteRaw = reg._note ?? "";
    const noteFlat = noteRaw.replace(/[éèê]/g, "e").toLowerCase();
    const stale = !!url && STALE_PREMISE.test(noteFlat);
    const accessFail = ACCESS_FAIL.test(noteRaw);
    if (corpsOnly && !(shape === "CORPS" || shape === "MIXTE")) continue;
    if (staleOnly && !stale) continue;
    if (accessFailOnly && !accessFail) continue;
    shown++;
    const note = noteRaw.replace(/\s+/g, " ").slice(0, 260);
    console.log(`\n### ${slug}  [${shape}]${stale ? " ⚠️STALE(note=rien-à-lire mais URL servie)" : ""}`);
    console.log(`URL: ${url ?? "-"}`);
    console.log(`NOTE: ${note}${noteRaw.length > 260 ? "…" : ""}`);
  }
  console.log(`\n# shard=${shardSpec ?? "all"} HOLD-NULL affichés=${shown}${corpsOnly ? " (corps/mixte)" : ""}${staleOnly ? " (stale)" : ""}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
