/**
 * _reglprov-s3-universe-gap.ts — lane P0_1 (provenance règlement). READ-ONLY.
 *
 * Pourquoi cet outil : TOUTES les sondes de ciblage de la lane partent de
 * `work/coverage/zonage-enrichment.json` (`served`), qui MENT PAR RETARD DANS LES
 * DEUX SENS (mémoire zonage-enrichment-cache-gisement-fantome) :
 *   - il dit `reglement=false` sur des villes déjà stampées (faux positifs),
 *   - il IGNORE les couches que la lane ZONES vient de déposer (faux négatifs).
 * Le seul juge de « le polygone existe » est S3.
 *
 * Cette sonde reconstruit l'univers SERVI depuis les clés S3 `normalized/ca-qc-zonage/`
 * (clé à plat ET sous-dossier, cf. fold-double-key-s3-serving) puis le croise avec le
 * REGISTRE CURÉ pour isoler la seule population qui vaut du travail neuf :
 *
 *   polygone S3 non vide  ∧  slug ABSENT du registre  = JAMAIS TRANCHÉ, SERVABLE
 *
 * Les couches de 0 feature sont sorties à part : leur goulot est ZONES, pas P0_1.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglprov-s3-universe-gap.ts
 *   npx tsx acquisition/src/_reglprov-s3-universe-gap.ts --shard 0/2
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const PREFIX = "normalized/ca-qc-zonage/";
/** Un .geojson de moins de ~1 KiB est une FeatureCollection vide (mesuré: 118 o). */
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
const curedNum = new Set<string>();
const curedNull = new Set<string>();
for (const [slug, e] of Object.entries(entries)) {
  if (!e || typeof e !== "object") continue;
  if ((e as any).reglement_numero) curedNum.add(slug);
  else curedNull.add(slug);
}

const enrich = readJson(ENRICH) ?? {};
const enrichServed = new Set<string>(
  (enrich.perMuni ?? enrich.munis ?? []).filter((m: any) => m?.served).map((m: any) => m.slug),
);

// --- univers S3 -------------------------------------------------------------
const size = new Map<string, number>();
const s3 = s3Client();
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
    // double clé : garder la PLUS GROSSE des deux (celle qui porte les features)
    size.set(slug, Math.max(size.get(slug) ?? 0, Number(o.Size ?? 0)));
  }
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);

const all = [...size.keys()].sort();
const nonEmpty = all.filter((s) => (size.get(s) ?? 0) > EMPTY_MAX_BYTES);
const empty = all.filter((s) => (size.get(s) ?? 0) <= EMPTY_MAX_BYTES);

const untriaged = nonEmpty.filter((s) => !curedNum.has(s) && !curedNull.has(s));
const missedByEnrich = nonEmpty.filter((s) => !enrichServed.has(s));

const sh = arg("shard");
function shardOf(list: string[]): string[] {
  if (!sh) return list;
  const [i, n] = sh.split("/").map(Number);
  return list.filter((_, idx) => idx % n === i);
}

console.log(`# S3 ${PREFIX} : couches=${all.length} nonVides=${nonEmpty.length} vides=${empty.length}`);
console.log(`# registre : numéro=${curedNum.size} null=${curedNull.size}`);
console.log(`# enrichment served=${enrichServed.size} -> S3 non vides ABSENTS de enrichment = ${missedByEnrich.length}`);
console.log(`# JAMAIS TRANCHÉS (polygone S3 non vide ∧ hors registre) = ${untriaged.length}`);

console.log("\n## jamais tranchés (travail neuf servable)");
for (const s of shardOf(untriaged)) console.log(`${s}\t${size.get(s)}o`);

console.log("\n## couches S3 VIDES (goulot = ZONES, pas P0_1)");
for (const s of shardOf(empty)) console.log(`${s}\t${size.get(s)}o\t${curedNum.has(s) ? "numéro-curé" : curedNull.has(s) ? "null-curé" : "hors-registre"}`);
