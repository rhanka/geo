/**
 * _reglprov-stamp-audit.ts — lane P0_1 (provenance règlement). READ-ONLY.
 *
 * Pourquoi cet outil EN PLUS de `_reglprov-s3-cured-unfolded.ts` : ce dernier rend le
 * BON verdict mais il est INEXPLOITABLE sur la population complète (`--all`). Mesuré
 * 2026-07-20, shard 1/2 : sur 419 et sur 104 slugs, il sort
 *
 *     Warning: Detected unsettled top-level await at ..._reglprov-s3-cured-unfolded.ts:138
 *       const fc = JSON.parse(await r.Body!.transformToString());
 *
 * puis s'arrête AVANT d'imprimer la moindre ligne de verdict — exit code 0, sortie
 * vide. Trois défauts cumulés :
 *   1. `transformToString()` matérialise la couche ENTIÈRE en une string V8 (les
 *      cadastres dépassent le max-string ceiling — c'est exactement ce que
 *      `parseFeatureCollectionBuffer` de lib/s3.ts existe pour éviter) ;
 *   2. la boucle est SÉQUENTIELLE et sans timeout : une seule requête qui pend fige
 *      les 400 suivantes ;
 *   3. tout est en top-level await et n'imprime qu'à la fin : une interruption ne
 *      laisse AUCUNE trace exploitable.
 *
 * Or c'est le seul gate qui prouve, indépendamment de `zonage-enrichment.json`, que la
 * provenance curée est RÉELLEMENT servie — et il paye (mémoire
 * reglprov-redepot-zones-efface-le-stamp : un re-dépôt ZONES EFFACE le stamp, et
 * aucune autre sonde ne le voit).
 *
 * Ce que fait celui-ci, à verdict identique :
 *   - RANGE GET des premiers octets d'abord. `fold` écrit les 4 champs sur CHAQUE
 *     feature, donc le stamp est presque toujours dans le premier Mo ; on ne
 *     télécharge la couche entière QUE si le préfixe ne tranche pas.
 *   - recherche du jeton sur le BUFFER (jamais de string géante).
 *   - concurrence bornée + timeout par clé (une clé morte ne bloque plus la passe).
 *   - impression AU FIL DE L'EAU : un run tué garde ses lignes.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglprov-stamp-audit.ts --shard 1/2 [--all]
 *     [--conc 6] [--timeout-ms 60000] [--probe-bytes 1048576]
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
const TOKEN = '"reglement_numero"';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function num(name: string, dflt: number): number {
  const v = arg(name);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function readJson(p: string): any {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Valeur de `reglement_numero` lue sur un buffer BRUT.
 *
 * On ne parse pas le GeoJSON : sur une couche de plusieurs dizaines de Mo, parser
 * coûte plus cher que le téléchargement, et la question posée est booléenne. On lit
 * la PREMIÈRE occurrence du jeton, qui est celle du premier feature.
 *
 * Rend `undefined` quand le jeton est absent du buffer — ce qui, sur un buffer
 * TRONQUÉ (range), ne veut pas dire « pas stampé » mais « indécis » : l'appelant
 * doit alors relire la couche entière. Ne jamais confondre les deux.
 */
function stampIn(buf: Buffer): string | null | undefined {
  const i = buf.indexOf(TOKEN);
  if (i < 0) return undefined;
  // fenêtre courte après le jeton : `:"712-00-2013"` ou `:null`
  const tail = buf.subarray(i + TOKEN.length, i + TOKEN.length + 200).toString("utf8");
  const m = /^\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(null))/.exec(tail);
  if (!m) return undefined;
  return m[2] ? null : (m[1] ?? null);
}

async function bodyToBuffer(body: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
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

  const s3 = s3Client();

  // Univers S3 : mêmes DEUX formes servies que la sonde d'origine (à plat ET
  // sous-dossier, mémoire fold-double-key-s3-serving). Tout autre dossier est un
  // artefact de pipeline et le compter ferait crier au serving cassé à tort.
  const keysOf = new Map<string, { key: string; size: number }[]>();
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
      const flat = `${PREFIX}qc-zonage-${slug}.geojson`;
      const nested = `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
      if (k !== flat && k !== nested) continue;
      const list = keysOf.get(slug) ?? [];
      list.push({ key: k, size: Number(o.Size ?? 0) });
      keysOf.set(slug, list);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  const all = process.argv.includes("--all");
  let pop = [...keysOf.entries()]
    .filter(([slug, list]) => list.some((v) => v.size > EMPTY_MAX_BYTES) && curedNum.has(slug))
    .map(([slug]) => slug)
    .sort();
  if (!all) pop = pop.filter((s) => !enrichServed.has(s));

  const sh = arg("shard");
  if (sh) {
    const [i, n] = sh.split("/").map(Number);
    pop = pop.filter((_, idx) => idx % n! === i!);
  }

  // Reprise ciblée. Les couches les plus lourdes (becancour, brossard, chambly…)
  // sortent en ERREUR-S3 « aborted » au timeout par défaut : elles se rejouent seules,
  // avec un probe plus large et un timeout plus long, sans re-sonder les 400 autres.
  const only = arg("slugs");
  if (only) {
    const want = new Set(only.split(",").map((s) => s.trim()).filter(Boolean));
    pop = pop.filter((s) => want.has(s));
  }

  const conc = num("conc", 6);
  const timeoutMs = num("timeout-ms", 60_000);
  const probeBytes = num("probe-bytes", 1_048_576);

  console.log(`# S3 couches=${keysOf.size} · registre à numéro=${curedNum.size} · enrichment served=${enrichServed.size}`);
  console.log(`# population = ${pop.length}${all ? " (--all)" : " (angle mort: absents d'enrichment)"} · conc=${conc}`);

  const todo: string[] = [];
  const orphan: string[] = [];
  const errored: string[] = [];
  let done = 0;

  /** Lit le stamp d'une clé : range d'abord, couche entière seulement si indécis. */
  async function readStamp(key: string): Promise<string | null> {
    for (const range of [`bytes=0-${probeBytes - 1}`, undefined]) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const r = await s3.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: key, ...(range ? { Range: range } : {}) }),
          { abortSignal: ac.signal },
        );
        const buf = await bodyToBuffer(r.Body);
        const v = stampIn(buf);
        if (v !== undefined) return v;
        // Jeton absent. Si le buffer est COMPLET, c'est un vrai « non stampé ».
        // S'il est tronqué, on ne sait pas encore → second tour, couche entière.
        if (!range || buf.length < probeBytes) return null;
      } finally {
        clearTimeout(t);
      }
    }
    return null;
  }

  const queue = [...pop];
  async function worker(): Promise<void> {
    for (;;) {
      const slug = queue.shift();
      if (!slug) return;
      const want = curedNum.get(slug)!;
      const keys = keysOf.get(slug)!.filter((k) => k.size > EMPTY_MAX_BYTES);
      let anyMissing = false;
      let anyPresent = false;
      for (const { key } of keys) {
        let stamped: string | null;
        try {
          stamped = await readStamp(key);
        } catch (e) {
          console.log(`${slug}\tERREUR-S3\t${key}\t${(e as Error).message}`);
          errored.push(slug);
          continue;
        }
        if (!stamped) {
          anyMissing = true;
          console.log(`${slug}\tÀ-FOLDER\tregistre=${want}\tS3=∅\t${key}`);
        } else {
          anyPresent = true;
          if (stamped !== want) console.log(`${slug}\tDIVERGENT\tregistre=${want}\tS3=${stamped}\t${key}`);
        }
      }
      if (anyMissing) todo.push(slug);
      if (anyMissing && anyPresent) orphan.push(slug);
      done++;
      if (done % 25 === 0) console.log(`# ...${done}/${pop.length}`);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, conc) }, () => worker()));

  console.log(`\n# sondés=${done}/${pop.length} · À FOLDER = ${todo.length} · ERREUR-S3 = ${errored.length}`);
  if (todo.length) {
    console.log(`npx tsx acquisition/src/fold-reglement-to-zonage.ts --slugs ${todo.sort().join(",")}`);
  }
  if (orphan.length) {
    console.log(`\n# ⛔ DOUBLE CLÉ INCOHÉRENTE = ${orphan.length} (une clé stampée, une clé nue)`);
    console.log(`#   fold n'en écrit qu'une; geo-api sert le SOUS-DOSSIER => escalade serving.`);
    for (const s of orphan.sort()) console.log(s);
  }
}

await main();
