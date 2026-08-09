/**
 * zones-artefact-purge.ts — purge KEY-EXACT des dépôts zonage ARTEFACTS sous
 * `normalized/ca-qc-zonage/`, que l'ancien `zones-purge.ts` (clé à plat
 * `qc-zonage-<slug>.geojson`) ne pouvait PAS supprimer : les vrais objets vivent
 * à des chemins non-canoniques et un HEAD sur la clé à plat renvoyait un
 * faux-négatif « déjà supprimé ».
 *
 * Trois formes d'artefact (structurelles, pas devinées) :
 *   A. `_replaced/qc-zonage-<slug>.geojson`            (cimetière de versions remplacées)
 *   B. `ca-qc-zonage-<...>-arcgis/qc-zonage-...(.meta).json|geojson`  (dump ArcGIS en sous-dossier)
 *   C. `normalized/ca-qc-zonage/…/ca-qc-zonage-<...>-arcgis/…`        (doublon double-imbriqué)
 *
 * GATE ANTI-CASSE (absolue) : une clé n'est supprimée que si sa muni de base
 *   - n'est PAS une vraie muni (nom d'owner/portal-item ArcGIS), OU
 *   - est une vraie muni DÉJÀ servie PROPREMENT à plat (`qc-zonage-<base>.geojson`
 *     présent à la racine du préfixe).
 * Sinon la clé est mise en HOLD (jamais supprimée) et signalée.
 *
 * Lecture pure par défaut (dry-run). `--apply` supprime. `--emit <path>` écrit la
 * liste des clés retenues. N'imprime aucun secret.
 *
 *   npx tsx acquisition/src/zones-artefact-purge.ts            # dry-run
 *   npx tsx acquisition/src/zones-artefact-purge.ts --emit work/coverage/zones-artefact-keys.txt
 *   npx tsx acquisition/src/zones-artefact-purge.ts --apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { BUCKET, s3Client, deleteObject, listSlugs } from "./lib/s3.js";

const PREFIX = "normalized/ca-qc-zonage/";
const TS = /\d{4}-\d{2}-\d{2}T/;

/** Réduit un slug artefact à la muni de base la plus plausible. */
function baseMuni(slug: string): string {
  return slug
    .replace(/-arcgis$/, "")
    .replace(/__subdir.*$/, "")
    .replace(/__qc-zonage-.*$/, "")
    .replace(/\.geojson\..*$/, "")
    .replace(/\.geojson$/, "");
}

async function listAllKeys(s3: ReturnType<typeof s3Client>): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

function category(rest: string): "replaced" | "arcgis" | "nested" | null {
  if (rest.startsWith("_replaced/")) return "replaced";
  if (rest.startsWith("normalized/")) return "nested"; // double-imbriqué
  const segs = rest.split("/");
  // dump ArcGIS = un segment RÉPERTOIRE nommé ca-qc-zonage-<...>-arcgis
  if (segs.length >= 2 && segs.slice(0, -1).some((s) => /^ca-qc-zonage-.*-arcgis$/.test(s))) return "arcgis";
  return null;
}

/** slug artefact pour dériver la base muni (pour la gate). */
function artefactSlug(rest: string, cat: string): string {
  if (cat === "replaced") {
    return rest.replace(/^_replaced\/qc-zonage-/, "").replace(/\.geojson$/, "");
  }
  // arcgis / nested : le nom de répertoire ca-qc-zonage-<X> porte la base
  const dir = rest.split("/").find((s) => /^ca-qc-zonage-/.test(s)) ?? rest;
  return dir.replace(/^ca-qc-zonage-/, "");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  // Étend la purge aux dumps `-arcgis` d'une VRAIE muni DÉJÀ servie (qc-lots présent)
  // qui CONSERVE un dépôt zones NON-arcgis après purge (jamais la seule source zones).
  const purgeRedundantArcgis = argv.includes("--purge-redundant-arcgis");
  const emitIdx = argv.indexOf("--emit");
  const emitPath = emitIdx >= 0 ? argv[emitIdx + 1] : null;

  const here = dirname(fileURLToPath(import.meta.url));
  const muniPath = join(here, "..", "..", "packages", "qc-sources", "src", "geo", "municipalities.qc.json");
  const munis = JSON.parse(readFileSync(muniPath, "utf8")) as { slug: string }[];
  const realMuni = new Set(munis.map((m) => m.slug));

  const s3 = s3Client();
  const keys = await listAllKeys(s3);

  // qc-lots servis (preuve de service bout-en-bout) : un slug avec un produit
  // qc-lots-<slug>.geojson est servi, même si ses zones vivent à un chemin non-plat.
  const qcLots = new Set(
    (await listSlugs(s3, "normalized/qc-lots/", ".geojson", true)).map((s) => s.replace(/^qc-lots-/, "")),
  );

  // Dépôt PROPRE = clé exactement à plat `qc-zonage-<slug>.geojson` (1 segment).
  const cleanFlat = new Set<string>();
  // Dépôt zones NON-arcgis pour une base (à plat OU en sous-dossier) : source
  // zones réutilisable qui subsiste si on ne purge QUE les dumps -arcgis.
  const nonArcgisZones = new Set<string>();
  for (const k of keys) {
    const rest = k.slice(PREFIX.length);
    const flat = rest.match(/^qc-zonage-([^/]+)\.geojson$/);
    if (flat) cleanFlat.add(flat[1]!);
    if (!/-arcgis/.test(k)) {
      const m = k.match(/qc-zonage-([^/]+)\.geojson$/);
      if (m && !/(__subdir|__qc-zonage-|\.geojson\.|\d{4}-\d{2}-\d{2}T)/.test(m[1]!)) nonArcgisZones.add(m[1]!);
    }
  }

  const del: { key: string; cat: string; base: string }[] = [];
  const hold: { key: string; base: string }[] = [];
  for (const k of keys) {
    const rest = k.slice(PREFIX.length);
    const cat = category(rest);
    if (!cat) continue;
    const base = baseMuni(artefactSlug(rest, cat));
    if (realMuni.has(base) && !cleanFlat.has(base)) {
      // Base = vraie muni sans dépôt PROPRE à plat. Par défaut -> HOLD (prudence).
      // Exception opt-in : purge un dump -arcgis SI la muni est servie (qc-lots)
      // ET conserve un dépôt zones NON-arcgis après purge (donc rejouable).
      const isArcgisKey = /-arcgis/.test(k);
      const safeRedundant =
        purgeRedundantArcgis && isArcgisKey && qcLots.has(base) && nonArcgisZones.has(base);
      if (!safeRedundant) {
        hold.push({ key: k, base });
        continue;
      }
    }
    del.push({ key: k, cat, base });
  }

  const byCat = (c: string) => del.filter((d) => d.cat === c);
  const uniqBase = [...new Set(del.map((d) => d.base))].sort();
  const realBases = uniqBase.filter((b) => realMuni.has(b));

  console.log(
    `KEYS=${keys.length} | DELETE=${del.length} (replaced=${byCat("replaced").length} ` +
      `arcgis=${byCat("arcgis").length} nested=${byCat("nested").length}) | HOLD=${hold.length} | ` +
      `bases uniques=${uniqBase.length} (dont vraies-munis servies-propre=${realBases.length})`,
  );
  console.log(`\nvraies-munis (base) dont le dump artefact est supprimé — servi propre à plat, sûr :`);
  console.log("  " + (realBases.join(", ") || "(aucune)"));
  if (hold.length) {
    console.log(`\nHOLD (base=vraie-muni SANS dépôt propre à plat — NON supprimé) :`);
    for (const h of hold) console.log(`  ${h.base}  <-  ${h.key}`);
  }
  console.log(`\nExemples de clés supprimées :`);
  for (const d of del.slice(0, 8)) console.log(`  [${d.cat}] ${d.key}`);
  if (del.length > 8) console.log(`  … +${del.length - 8}`);

  if (emitPath) {
    writeFileSync(emitPath, del.map((d) => d.key).join("\n") + "\n", "utf8");
    console.log(`\némis ${del.length} clés -> ${emitPath}`);
  }

  if (!apply) {
    console.log(`\n(dry-run — rien supprimé. Relancer avec --apply pour supprimer les ${del.length} clés.)`);
    return;
  }

  let done = 0;
  for (const d of del) {
    await deleteObject(s3, d.key);
    done += 1;
    if (done % 25 === 0 || done === del.length) console.log(`supprimé ${done}/${del.length}`);
  }
  console.log(`PURGE TERMINÉE : ${done} clés supprimées.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
