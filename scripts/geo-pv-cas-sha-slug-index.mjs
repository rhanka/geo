#!/usr/bin/env node
// geo-pv-cas-sha-slug-index — INDEX + RÉSOLVEUR CÔTÉ GEO du CAS PV (slug + sha256 + url)
// extrait des MANIFESTES DE CAPTURE COMMITTÉS.
//
// Deux usages, un seul artefact pur :
//  (1) diff CRED-FREE contre l'inventaire docSha immo (réconciliation object-store :
//      intersection / branche-(a) jamais-capté / branche-(b) hash-divergent) ;
//  (2) RÉSOLVEUR immo→geo pour le repoint #511 : `url-source → clé CAS geo canonique`
//      (`raw/pv-index/cas/<sha256-geo>.<ext>`) + `by_sha256[sha].cas_key`. La clé de join
//      STABLE est l'URL (partagée immo/geo), PAS le sha — c'est pourquoi un `mapToGeoKey`
//      qui ré-emploie le sha immo casse (404) quand geo a capté la même URL sous un sha ≠.
//
// Lecture seule, ZÉRO réseau, ZÉRO cred. Fonction PURE des entrées committées :
// re-run = octet-identique (aucune horloge dans le contenu). C'est la moitié GEO du
// diff/repoint ; l'autre moitié (docSha immo → url) vient d'immo/i-cond (join côté immo).
//
// Source de vérité de la clé CAS : packages/qc-sources/src/capture/manifest.ts:52
//   CAS_KEY_RE = /^raw\/<source>\/cas\/<sha256>\.<ext>/  (group1 source, group2 sha, group3 ext)
//
// Scope : PV-minutes uniquement (source `pv-index` ; décision owner via i-cond). Les
// non-PV (agendas/règlements/projets) sont hors-scope du repoint immo→geo.
//
// `buildArtifact(inputs)` est PURE et exportée (testée : scripts/geo-pv-cas-sha-slug-index.test.mjs).
//
// Usage : node scripts/geo-pv-cas-sha-slug-index.mjs [--out <path>] [--tsv <path>]
//   défaut --out : work/coverage/geo-pv-cas-sha-slug-index.json

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const COVERAGE_DIR = join(ROOT, "work", "coverage");
// Clé CAS canonique (miroir manifest.ts:52). group1 = source, group2 = sha256, group3 = ext.
export const CAS_KEY_RE = /^raw\/([a-z0-9][a-z0-9._-]*)\/cas\/([a-f0-9]{64})\.([a-z0-9]+)$/;
// Bucket object-store où vivent les objets CAS (mirror @sentropic/geo CAMPAIGN_BUCKET).
const CAS_BUCKET = "sentropic-geo";

// Clé CAS canonique reconstruite depuis (source, sha, ext) — l'inverse de CAS_KEY_RE.
function casKey(source, sha, ext) {
  return `raw/${source}/cas/${sha}.${ext}`;
}

function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * PURE : construit l'artefact index+résolveur depuis des manifestes déjà parsés.
 * @param inputs Array<{ relPath: string, doc?: unknown, parseError?: string }>
 * @returns { artifact, urlRows } — urlRows = Set des triples `url\tsha\tslug` (vue TSV).
 * Déterministe (tri partout, aucune horloge) : mêmes inputs → même sortie octet-identique.
 */
export function buildArtifact(inputs) {
  // sha256 -> { slugs:Set, urls:Set, source, ext }
  const bySha = new Map();
  // slug -> Set<sha256>
  const bySlug = new Map();
  // url-source -> { shas:Set<sha256>, slugs:Set } — la vue de résolution (join key = URL).
  const byUrl = new Map();
  // `sourceUrl \t sha256 \t slug` triples (per-line association, deduped) — vue url→sha (audit drift P4).
  const urlRows = new Set();
  const contributed = [];
  const skipped = [];
  let totalCasLines = 0;
  let casAbsentLines = 0; // lignes sans storage_key durable (échecs de capture) — comptées, pas inventées

  for (const input of inputs) {
    const relPath = input.relPath;
    if (input.parseError) {
      skipped.push({ file: relPath, reason: `parse-error: ${input.parseError}` });
      continue;
    }
    const doc = input.doc;
    if (!isRecord(doc) || !Array.isArray(doc.lines)) {
      skipped.push({ file: relPath, reason: "no lines[] array" });
      continue;
    }
    let contributedLines = 0;
    for (const line of doc.lines) {
      const key = typeof line?.storage_key === "string" ? line.storage_key : null;
      if (!key) { casAbsentLines++; continue; }
      const m = CAS_KEY_RE.exec(key);
      if (!m) { casAbsentLines++; continue; }
      const [, source, sha, ext] = m;
      const slug = typeof line.slug === "string" ? line.slug : "(unknown-slug)";
      const url = typeof line.url === "string" ? line.url : null;
      totalCasLines++;
      contributedLines++;
      let entry = bySha.get(sha);
      if (!entry) { entry = { slugs: new Set(), urls: new Set(), source, ext }; bySha.set(sha, entry); }
      entry.slugs.add(slug);
      if (url) {
        entry.urls.add(url);
        urlRows.add(`${url}\t${sha}\t${slug}`);
        let u = byUrl.get(url);
        if (!u) { u = { shas: new Set(), slugs: new Set() }; byUrl.set(url, u); }
        u.shas.add(sha);
        u.slugs.add(slug);
      }
      let slugSet = bySlug.get(slug);
      if (!slugSet) { slugSet = new Set(); bySlug.set(slug, slugSet); }
      slugSet.add(sha);
    }
    contributed.push({ file: relPath, lines_with_cas: contributedLines });
  }

  // Sérialisation DÉTERMINISTE (tri partout). by_sha256 porte la clé CAS explicite.
  const bySha256 = {};
  for (const sha of [...bySha.keys()].sort()) {
    const e = bySha.get(sha);
    bySha256[sha] = {
      slugs: [...e.slugs].sort(),
      urls: [...e.urls].sort(),
      source: e.source,
      ext: e.ext,
      cas_key: casKey(e.source, sha, e.ext),
    };
  }
  const bySlugObj = {};
  for (const slug of [...bySlug.keys()].sort()) {
    bySlugObj[slug] = [...bySlug.get(slug)].sort();
  }

  // RÉSOLVEUR url-source → clé CAS geo. Une URL captée sous UN seul sha-geo → clé canonique.
  // Une URL captée sous ≥2 sha-geo (drift / re-capture) → geo_cas_key=null + drift=true +
  // candidates[] : JAMAIS deviné, la désambiguïsation est explicite (immo/i-cond, cas par cas).
  const resolveBySourceUrl = {};
  let sourceUrlsSingleKey = 0;
  let sourceUrlsDrift = 0;
  for (const url of [...byUrl.keys()].sort()) {
    const u = byUrl.get(url);
    const shas = [...u.shas].sort();
    const slugs = [...u.slugs].sort();
    if (shas.length === 1) {
      const sha = shas[0];
      const e = bySha.get(sha);
      resolveBySourceUrl[url] = {
        geo_cas_key: casKey(e.source, sha, e.ext),
        sha256_geo: sha,
        ext: e.ext,
        slugs,
        drift: false,
      };
      sourceUrlsSingleKey++;
    } else {
      resolveBySourceUrl[url] = {
        geo_cas_key: null,
        drift: true,
        candidates: shas.map((sha) => {
          const e = bySha.get(sha);
          return { sha256_geo: sha, geo_cas_key: casKey(e.source, sha, e.ext), ext: e.ext, slugs: [...e.slugs].sort() };
        }),
        slugs,
      };
      sourceUrlsDrift++;
    }
  }

  const artifact = {
    contract: "geo-pv-cas-sha-slug-index/v2",
    purpose:
      "Index + résolveur côté geo du CAS PV (slug+sha256+url) depuis les manifestes de capture " +
      "committés. (1) diff cred-free vs inventaire docSha immo ; (2) résolveur repoint immo→geo " +
      "url-source → clé CAS geo canonique (raw/pv-index/cas/<sha256-geo>.<ext>). Fonction pure des entrées.",
    scope: "PV-minutes uniquement (source pv-index ; décision owner via i-cond). Non-PV hors-scope repoint.",
    cas_key_source: "packages/qc-sources/src/capture/manifest.ts CAS_KEY_RE",
    cas_key_format: "raw/<source>/cas/<sha256>.<ext>",
    s3: {
      bucket: CAS_BUCKET,
      cas_prefix_pv: "raw/pv-index/cas/",
      object_uri_pattern: `s3://${CAS_BUCKET}/raw/<source>/cas/<sha256>.<ext>`,
    },
    resolver: {
      join_key: "source_url",
      note:
        "La clé de join stable immo↔geo est l'URL-source (partagée), PAS le sha (immo-sha ≠ geo-sha " +
        "sur le set divergent → mapToGeoKey 404). immo fait le join immo-sha→url de son côté, puis " +
        "lookup url→geo_cas_key ici. Drift (url→≥2 sha-geo) flaggé (geo_cas_key=null + candidates), jamais deviné.",
    },
    inputs: {
      manifest_files: inputs.length,
      contributed,
      skipped_unrecognized: skipped,
    },
    summary: {
      distinct_sha256: bySha.size,
      distinct_slug: bySlug.size,
      total_cas_lines: totalCasLines,
      cas_absent_lines: casAbsentLines,
      distinct_source_url: byUrl.size,
      source_urls_single_key: sourceUrlsSingleKey,
      source_urls_drift: sourceUrlsDrift,
    },
    resolve_by_source_url: resolveBySourceUrl,
    by_sha256: bySha256,
    by_slug: bySlugObj,
  };

  return { artifact, urlRows };
}

function parseArgs(argv) {
  const out = { outPath: join(COVERAGE_DIR, "geo-pv-cas-sha-slug-index.json"), tsvPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out.outPath = resolve(argv[++i]);
    else if (argv[i] === "--tsv") out.tsvPath = resolve(argv[++i]);
  }
  return out;
}

// Fichiers d'entrée : manifestes octets-classification committés (ils portent lines[] avec
// slug + storage_key). Les KPI (autre structure) sont recensés en skipped avec raison.
function inputFiles() {
  return readdirSync(COVERAGE_DIR)
    .filter((f) => f.startsWith("pv-capture-octets-classification-") && f.endsWith(".json"))
    .sort()
    .map((f) => join(COVERAGE_DIR, f));
}

function main() {
  const { outPath, tsvPath } = parseArgs(process.argv.slice(2));
  const files = inputFiles();
  // I/O au bord (impur) ; la logique est PURE dans buildArtifact.
  const inputs = files.map((file) => {
    const relPath = file.slice(ROOT.length + 1);
    try {
      return { relPath, doc: JSON.parse(readFileSync(file, "utf8")) };
    } catch (e) {
      return { relPath, parseError: e.message };
    }
  });
  const { artifact, urlRows } = buildArtifact(inputs);

  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);

  // Vue url→sha optionnelle (TSV `sourceUrl \t sha256 \t slug`) pour l'audit drift P4
  // (immo sert un doc dont geo a le MÊME sourceUrl sous un AUTRE sha = re-key/conversion).
  let tsvRows = 0;
  if (tsvPath) {
    const rows = [...urlRows].sort();
    tsvRows = rows.length;
    mkdirSync(dirname(tsvPath), { recursive: true });
    writeFileSync(tsvPath, rows.length ? `${rows.join("\n")}\n` : "");
  }

  const s = artifact.summary;
  process.stdout.write(
    JSON.stringify(
      {
        out: outPath.slice(ROOT.length + 1),
        tsv_out: tsvPath ?? null,
        tsv_rows: tsvRows,
        manifest_files: artifact.inputs.manifest_files,
        contributed_files: artifact.inputs.contributed.length,
        skipped_files: artifact.inputs.skipped_unrecognized.length,
        distinct_sha256: s.distinct_sha256,
        distinct_slug: s.distinct_slug,
        distinct_source_url: s.distinct_source_url,
        source_urls_single_key: s.source_urls_single_key,
        source_urls_drift: s.source_urls_drift,
        total_cas_lines: s.total_cas_lines,
        cas_absent_lines: s.cas_absent_lines,
      },
      null,
      2,
    ) + "\n",
  );
}

// N'exécute main() que lancé en CLI (pas à l'import du test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
