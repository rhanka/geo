/**
 * fold-reglement-quebec-arrondissement.ts — lane PROVENANCE P0_1, cas Ville de Québec.
 *
 * POURQUOI UN FOLD DÉDIÉ. `fold-reglement-to-zonage.ts` est PER-MUNI : il copie la
 * MÊME valeur sur tous les polygones d'un slug. Pour `quebec` c'est INTERDIT — la
 * Ville n'a pas un règlement de zonage unique, elle a **un règlement d'urbanisme
 * PAR ARRONDISSEMENT**. Stamper per-muni donnerait une provenance FAUSSE sur la
 * quasi-totalité des 4785 zones. C'est pourquoi `quebec` reste un **null curé
 * (VETO)** au registre : le fold transverse doit continuer de le SKIPPER.
 *
 * CE QUE CE FOLD FAIT. Il stampe les 4 champs de provenance PAR ZONE, en routant
 * chaque polygone vers le règlement de SON arrondissement.
 *
 * LE RATTACHEMENT ZONE -> ARRONDISSEMENT EST MESURÉ, PAS DÉDUIT.
 * Le `zone_code` servi vaut p. ex. « 21703Mc ». Affirmer « le 1er chiffre = le
 * numéro d'arrondissement » serait une inférence de préfixe interdite
 * ([[zone-prefix-letter-inference-trap]]). La sonde committée
 * `_probe-vdq-arrondissement-prefix.ts` la MESURE en croisant, dans la grille
 * XLSX officielle, le N de « R.C.A.<N>V.Q. … » (colonne « Dernier règlement ayant
 * modifié la zone ») avec le 1er chiffre du code de zone de la même ligne :
 *   témoins = 1732, concordants = 1732, DISCORDANTS = 0, sur les 6 arrondissements.
 * Le rattachement est donc un fait mesuré sur 1732 témoins indépendants.
 *
 * LES NUMÉROS SONT VERBATIM. Chaque numéro/titre est lu sur le portail officiel des
 * règlements de la Ville de Québec (un document par arrondissement), pas dérivé
 * d'une URL ni d'un nom de fichier ([[reglement-numero-url-trap]]).
 *
 * Millésime : chaque règlement porte, en référence de son article 1, « [2010,
 * R.C.A.<N>V.Q. 4, a. 1] » — l'année d'adoption initiale. Les années ultérieures
 * (2011…2026) présentes dans les documents sont celles des AMENDEMENTS et ne sont
 * pas la base ([[reglement-annee-du-numero-fausse]]).
 *
 * `reglement_page_source` = null : la source est le portail réglementaire HTML
 * consolidé, il n'y a pas de page de PDF à citer (null honnête, pas un défaut).
 *
 * Réversible (--strip). Idempotent. Anti-invention : une zone dont le code ne
 * commence pas par un chiffre d'arrondissement connu n'est PAS stampée.
 *
 * Usage:
 *   npx tsx acquisition/src/fold-reglement-quebec-arrondissement.ts --dry-run
 *   npx tsx acquisition/src/fold-reglement-quebec-arrondissement.ts
 *   npx tsx acquisition/src/fold-reglement-quebec-arrondissement.ts --strip
 */
import { pathToFileURL } from "node:url";

import { getBytes, putBytes, exists, s3Client } from "./lib/s3.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const SLUG = "quebec";
const FIELDS = ["reglement_numero", "reglement_millesime", "reglement_page_source", "reglement_url"] as const;

/** Les 6 arrondissements de la Ville de Québec, indexés par le chiffre de tête du
 *  code de zone (rattachement MESURÉ: 1732/1732, cf. _probe-vdq-arrondissement-prefix).
 *  `nom` et `numero` sont VERBATIM du portail réglementaire officiel. */
const ARRONDISSEMENTS: Record<string, { numero: string; nom: string }> = {
  "1": { numero: "R.C.A.1V.Q. 4", nom: "Règlement de l'Arrondissement de La Cité-Limoilou sur l'urbanisme" },
  "2": { numero: "R.C.A.2V.Q. 4", nom: "Règlement de l'Arrondissement des Rivières sur l'urbanisme" },
  "3": { numero: "R.C.A.3V.Q. 4", nom: "Règlement de l'Arrondissement de Sainte-Foy–Sillery–Cap-Rouge sur l'urbanisme" },
  "4": { numero: "R.C.A.4V.Q. 4", nom: "Règlement de l'Arrondissement de Charlesbourg sur l'urbanisme" },
  "5": { numero: "R.C.A.5V.Q. 4", nom: "Règlement de l'Arrondissement de Beauport sur l'urbanisme" },
  "6": { numero: "R.C.A.6V.Q. 4", nom: "Règlement de l'Arrondissement de La Haute-Saint-Charles sur l'urbanisme" },
};
const MILLESIME = 2010;
const urlFor = (n: string): string => `https://reglements.ville.quebec.qc.ca/fr/showdoc/cr/R.C.A.${n}V.Q.4`;

type S3 = ReturnType<typeof s3Client>;

async function zonageKeys(s3: S3, slug: string): Promise<string[]> {
  const candidates = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const keys: string[] = [];
  for (const k of candidates) if (await exists(s3, k)) keys.push(k);
  return keys;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const strip = argv.includes("--strip");

  const s3 = s3Client();
  const keys = await zonageKeys(s3, SLUG);
  if (keys.length === 0) { console.log(`SKIP ${SLUG} (polygone qc-zonage non servi)`); return; }

  for (const key of keys) {
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
    const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
    let changed = 0;
    let unrouted = 0;
    const perArr = new Map<string, number>();

    for (const f of feats) {
      f.properties = f.properties ?? {};
      if (strip) {
        for (const field of FIELDS) if (field in f.properties) { delete f.properties[field]; changed++; }
        continue;
      }
      const code = String(f.properties["zone_code"] ?? "").trim();
      const arr = ARRONDISSEMENTS[code.slice(0, 1)];
      if (!arr) { unrouted++; continue; }
      perArr.set(arr.numero, (perArr.get(arr.numero) ?? 0) + 1);
      const vals: Record<string, unknown> = {
        reglement_numero: arr.numero,
        reglement_millesime: MILLESIME,
        reglement_page_source: null,
        reglement_url: urlFor(code.slice(0, 1)),
      };
      for (const field of FIELDS) {
        if (f.properties[field] !== vals[field]) { f.properties[field] = vals[field]; changed++; }
      }
    }

    console.log(`${dryRun ? "DRY " : "OK  "}${SLUG} polygones=${feats.length} cellsChanged=${changed} nonRoutees=${unrouted} key=${key}`);
    for (const [num, n] of [...perArr.entries()].sort()) console.log(`     ${num}\t${n} zones`);
    if (!dryRun && changed > 0) {
      await putBytes(s3, key, Buffer.from(JSON.stringify(fc)), "application/geo+json");
    }
  }
  console.log(`DONE ${SLUG}${dryRun ? " (dry-run)" : ""}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
