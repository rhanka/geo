/**
 * _reglprov-s3-cured-unfolded.ts — lane P0_1 (provenance règlement). READ-ONLY.
 *
 * Pourquoi cet outil : `_reglement-prov-fold-lag.ts` cherche les villes « numéro au
 * registre mais polygone non stampé » EN PARTANT de `work/coverage/zonage-enrichment.json`.
 * Or ce fichier IGNORE les couches que la lane ZONES vient de déposer (mémoire
 * univers-servi-est-s3-pas-enrichment : 872 couches S3 contre `served=846`).
 * `_reglprov-s3-universe-gap.ts` CALCULE bien cette population (`missedByEnrich`) mais ne
 * l'imprime pas : il ne sort que les slugs HORS registre. Résultat : un slug
 *
 *     polygone S3 non vide  ∧  absent d'enrichment  ∧  numéro DÉJÀ au registre
 *
 * est invisible pour les DEUX sondes — personne ne lui passe jamais le fold, alors que
 * c'est un stamp à $0 (le numéro est déjà curé, il ne reste qu'à le servir).
 *
 * Cette sonde ferme l'angle mort en ne consultant PAS enrichment du tout : elle lit
 * l'objet S3 lui-même et regarde si `features[0].properties.reglement_numero` est posé.
 * C'est le seul juge de « servi » (mémoire geo-api-collection-cache : l'API ment).
 *
 * Usage:
 *   npx tsx acquisition/src/_reglprov-s3-cured-unfolded.ts --shard 0/2
 *   npx tsx acquisition/src/_reglprov-s3-cured-unfolded.ts --shard 0/2 --all
 *     --all : sonde TOUS les slugs curés-à-numéro (lent), pas seulement ceux absents
 *             d'enrichment. Sans --all, on se limite à l'angle mort mesuré.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const PREFIX = "normalized/ca-qc-zonage/";
const EMPTY_MAX_BYTES = 1024;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function readJson(p: string): any {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const registry = readJson(REGISTRY) ?? {};
const entries: Record<string, any> = registry.slugs ?? registry.munis ?? registry;
const curedNum = new Map<string, string>();
for (const [slug, e] of Object.entries(entries)) {
  if (e && typeof e === "object" && (e as any).reglement_numero) {
    curedNum.set(slug, String((e as any).reglement_numero));
  }
}

const enrich = readJson(ENRICH) ?? {};
const enrichServed = new Set<string>(
  (enrich.perMuni ?? enrich.munis ?? []).filter((m: any) => m?.served).map((m: any) => m.slug),
);

// --- univers S3 : garder la PLUS GROSSE des deux clés (plate / sous-dossier) -------
const s3 = s3Client();
const best = new Map<string, { key: string; size: number }>();
let token: string | undefined;
do {
  const r = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token, MaxKeys: 1000 }),
  );
  for (const o of r.Contents ?? []) {
    const k = o.Key ?? "";
    if (!k.endsWith(".geojson")) continue;
    const base = k.slice(k.lastIndexOf("/") + 1).replace(/\.geojson$/, "");
    if (!base.startsWith("qc-zonage-")) continue;
    const slug = base.slice("qc-zonage-".length);
    const size = Number(o.Size ?? 0);
    const cur = best.get(slug);
    if (!cur || size > cur.size) best.set(slug, { key: k, size });
  }
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);

const sh = arg("shard");
const all = process.argv.includes("--all");

// Population sondée : couche S3 non vide ∧ numéro au registre, et (sauf --all) le slug
// est ABSENT d'enrichment — c'est exactement ce que les deux autres sondes ne voient pas.
let pop = [...best.entries()]
  .filter(([slug, v]) => v.size > EMPTY_MAX_BYTES && curedNum.has(slug))
  .map(([slug]) => slug)
  .sort();
if (!all) pop = pop.filter((s) => !enrichServed.has(s));

if (sh) {
  const [i, n] = sh.split("/").map(Number);
  pop = pop.filter((_, idx) => idx % n === i);
}

console.log(`# S3 couches=${best.size} · registre à numéro=${curedNum.size} · enrichment served=${enrichServed.size}`);
console.log(`# population sondée = ${pop.length}${all ? " (--all)" : " (absents d'enrichment = l'angle mort)"}`);

const todo: string[] = [];
for (const slug of pop) {
  const { key } = best.get(slug)!;
  let stamped: string | null = null;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const fc = JSON.parse(await r.Body!.transformToString());
    stamped = fc?.features?.[0]?.properties?.reglement_numero ?? null;
  } catch (e) {
    console.log(`${slug}\tERREUR-S3\t${(e as Error).message}`);
    continue;
  }
  const want = curedNum.get(slug)!;
  if (!stamped) {
    todo.push(slug);
    console.log(`${slug}\tÀ-FOLDER\tregistre=${want}\tS3=∅`);
  } else if (stamped !== want) {
    console.log(`${slug}\tDIVERGENT\tregistre=${want}\tS3=${stamped}`);
  }
}

console.log(`\n# À FOLDER = ${todo.length}`);
if (todo.length) console.log(`npx tsx acquisition/src/fold-reglement-to-zonage.ts --slugs ${todo.join(",")}`);
