#!/usr/bin/env node
// geo-pv-cas-sha-slug-index — INDEX CÔTÉ GEO du CAS PV (slug + sha256 + url) extrait
// des MANIFESTES DE CAPTURE COMMITTÉS, pour un diff CRED-FREE contre l'inventaire
// docSha immo (réconciliation object-store : intersection / branche-(a) jamais-capté /
// branche-(b) hash-divergent).
//
// Lecture seule, ZÉRO réseau, ZÉRO cred. Fonction PURE des entrées committées :
// re-run = octet-identique (aucune horloge dans le contenu). C'est la moitié GEO du
// diff ; l'autre moitié (6846 docSha immo) vient d'immo/i-cond.
//
// Source de vérité de la clé CAS : packages/qc-sources/src/capture/manifest.ts:52
//   CAS_KEY_RE = /^raw\/<source>\/cas\/<sha256>\/.<ext>/  (group1 source, group2 sha, group3 ext)
//
// Usage : node scripts/geo-pv-cas-sha-slug-index.mjs [--out <path>] [--tsv <path>]
//   défaut --out : work/coverage/geo-pv-cas-sha-slug-index.json

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const COVERAGE_DIR = join(ROOT, "work", "coverage");
// Clé CAS canonique (miroir manifest.ts:52). group1 = source, group2 = sha256, group3 = ext.
const CAS_KEY_RE = /^raw\/([a-z0-9][a-z0-9._-]*)\/cas\/([a-f0-9]{64})\.([a-z0-9]+)$/;

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

  // sha256 -> { slugs:Set, urls:Set, source, ext }
  const bySha = new Map();
  // slug -> Set<sha256>
  const bySlug = new Map();
  // `sourceUrl \t sha256 \t slug` triples (per-line association, deduped) — vue url→sha (audit drift P4).
  const urlRows = new Set();
  const contributed = [];
  const skipped = [];
  let totalCasLines = 0;
  let casAbsentLines = 0; // lignes sans storage_key durable (échecs de capture) — comptées, pas inventées

  for (const file of files) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      skipped.push({ file: file.slice(ROOT.length + 1), reason: `parse-error: ${e.message}` });
      continue;
    }
    if (!Array.isArray(doc.lines)) {
      skipped.push({ file: file.slice(ROOT.length + 1), reason: "no lines[] array" });
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
      if (url) { entry.urls.add(url); urlRows.add(`${url}\t${sha}\t${slug}`); }
      let slugSet = bySlug.get(slug);
      if (!slugSet) { slugSet = new Set(); bySlug.set(slug, slugSet); }
      slugSet.add(sha);
    }
    contributed.push({ file: file.slice(ROOT.length + 1), lines_with_cas: contributedLines });
  }

  // Sérialisation DÉTERMINISTE (tri partout).
  const bySha256 = {};
  for (const sha of [...bySha.keys()].sort()) {
    const e = bySha.get(sha);
    bySha256[sha] = {
      slugs: [...e.slugs].sort(),
      urls: [...e.urls].sort(),
      source: e.source,
      ext: e.ext,
    };
  }
  const bySlugObj = {};
  for (const slug of [...bySlug.keys()].sort()) {
    bySlugObj[slug] = [...bySlug.get(slug)].sort();
  }

  const artifact = {
    contract: "geo-pv-cas-sha-slug-index/v1",
    purpose:
      "Index côté geo du CAS PV (slug+sha256+url) depuis les manifestes de capture committés, " +
      "pour diff cred-free vs inventaire docSha immo (réconciliation object-store). Fonction pure des entrées.",
    cas_key_source: "packages/qc-sources/src/capture/manifest.ts CAS_KEY_RE",
    inputs: {
      manifest_files: files.length,
      contributed,
      skipped_unrecognized: skipped,
    },
    summary: {
      distinct_sha256: bySha.size,
      distinct_slug: bySlug.size,
      total_cas_lines: totalCasLines,
      cas_absent_lines: casAbsentLines,
    },
    by_sha256: bySha256,
    by_slug: bySlugObj,
  };

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

  process.stdout.write(
    JSON.stringify(
      {
        out: outPath.slice(ROOT.length + 1),
        tsv_out: tsvPath ?? null,
        tsv_rows: tsvRows,
        manifest_files: files.length,
        contributed_files: contributed.length,
        skipped_files: skipped.length,
        distinct_sha256: bySha.size,
        distinct_slug: bySlug.size,
        distinct_source_url: urlRows.size,
        total_cas_lines: totalCasLines,
        cas_absent_lines: casAbsentLines,
      },
      null,
      2,
    ) + "\n",
  );
}

main();
