/**
 * _zones-noncanonical-key-audit-20260821.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * CONTEXTE (finding dé-entropie archi, Exemplar #4). Le nouveau geo-api indexerait
 * ~762 objets zones sous des clés NON-CANONIQUES comme des collections DISTINCTES,
 * gonflant l'ensemble servi de ~3885 à ~4647 collections. Motifs cités :
 *   - qc-zonage-<ville>__flat.<ISO-ts>
 *   - qc-zonage-<ville>__nested-misdeposit.<ISO-ts>
 *   - qc-zonage-<ville>__subdir.<ISO-ts>
 * MAIS beaucoup/toutes ces clés sont des SAUVEGARDES D'AUDIT INTENTIONNELLES
 * (backup AVANT écrasement/suppression d'une couche servie — réversibilité + audit
 * de perte de provenance). L'objectif n'est PAS de prouver qu'elles sont supprimables ;
 * c'est de déterminer EXACTEMENT :
 *   (a) lesquelles sont des backups d'audit vs de la vraie pollution du namespace servi,
 *   (b) OÙ elles se trouvent physiquement (sous un préfixe backup `_…/` vs directement
 *       dans le namespace servi),
 *   (c) POURQUOI geo-api les indexe comme collections.
 *
 * RÈGLE DE LOCALISATION (mesurée sur les vraies clés) : le namespace SERVI est
 * `normalized/ca-qc-zonage/` et son sous-arbre `qc-zonage-<slug>/`. Tout segment de
 * RÉPERTOIRE commençant par `_` (ex: `_replaced/`, `_zone-source-fold-backups/<ts>/`)
 * est une zone de BACKUP/annexe HORS du namespace servi. C'est le discriminant
 * physique entre « backup d'audit » et « pollution du namespace servi ».
 *
 * MÉTHODE (lecture seule S3 ; ne DÉPOSE / N'ÉCRIT / NE SUPPRIME RIEN) :
 *   1. LISTE TOUTES les clés sous normalized/ca-qc-zonage/ (pagination complète).
 *   2. CATÉGORISE chaque clé :
 *      - CANONICAL-FLAT               : qc-zonage-<slug>.geojson
 *      - CANONICAL-NESTED             : qc-zonage-<slug>/qc-zonage-<slug>.geojson
 *      - CANONICAL-NESTED-SIDECAR     : qc-zonage-<slug>/qc-zonage-<slug>.<ext≠geojson> (meta…)
 *      - BACKUP-UNDER-PREFIX          : au moins un segment de répertoire commence par `_`
 *                                       (sous-réparti par préfixe : _replaced, _zone-source-fold-backups…)
 *      - NONCANONICAL-GEOJSON-IN-NAMESPACE : un .geojson DIRECTEMENT dans le namespace servi
 *                                       (racine ou dossier qc-zonage-<slug>/) qui n'est PAS le
 *                                       canonique → VRAIE pollution vue par un indexeur qui strippe
 *                                       l'extension (ex: .additive-prebackup.geojson,
 *                                       .contour-auto-preclip.geojson, __<token>.<ts>.geojson)
 *      - SIDECAR-IN-NAMESPACE         : un .json sidecar DIRECTEMENT dans le namespace (racine)
 *                                       non-geojson (ex: .stats.json, .meta.json flat)
 *      - OTHER                        : tout le reste (décrit)
 *   3. Ensemble DISTINCT des tokens de suffixe `__<token>` (flat/subdir/nested/nested-misdeposit…),
 *      compté par token et par localisation (sous préfixe backup vs dans le namespace).
 *   4. CORRESPONDANCE backup↔canonique : chaque clé backup/pollution a-t-elle un slug qui possède
 *      AUSSI un canonique servi (flat/nested) ? Taux de correspondance.
 *   5. Candidats-collection pour geo-api sous 2 hypothèses d'indexeur (récursif+strip-ext /
 *      non-récursif+strip-ext), pour que le rapport archi rattache le chiffre ~762.
 *
 * Numéros MESURÉS, anti-invention : une clé ambigüe → OTHER, jamais devinée.
 *
 * USAGE (lecture seule) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-noncanonical-key-audit-20260821.ts
 *
 * ÉCRIT (fichiers locaux du dépôt, PAS S3) :
 *   work/coverage/zones-noncanonical-key-audit-20260821.json
 *   work/coverage/zones-noncanonical-key-audit-20260821.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { listObjectEntries, s3Client } from "./lib/s3.js";

const S3_PREFIX = "normalized/ca-qc-zonage/";
const OUT_JSON = "work/coverage/zones-noncanonical-key-audit-20260821.json";
const OUT_MD = "work/coverage/zones-noncanonical-key-audit-20260821.md";

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

type Category =
  | "CANONICAL-FLAT"
  | "CANONICAL-NESTED"
  | "CANONICAL-NESTED-SIDECAR"
  | "BACKUP-UNDER-PREFIX"
  | "NONCANONICAL-GEOJSON-IN-NAMESPACE"
  | "SIDECAR-IN-NAMESPACE"
  | "OTHER";

const CANONICAL_FLAT_RE = /^qc-zonage-([a-z0-9-]+)\.geojson$/;
const CANONICAL_NESTED_RE = /^qc-zonage-([a-z0-9-]+)\/qc-zonage-([a-z0-9-]+)\.geojson$/;
const CANONICAL_NESTED_SIDECAR_RE = /^qc-zonage-([a-z0-9-]+)\/qc-zonage-([a-z0-9-]+)\.(.+)$/;

interface Row {
  key: string;
  rest: string;
  category: Category;
  slug: string | null;
  backup_prefix: string | null; // premier segment de répertoire commençant par `_`
  is_geojson: boolean;
  variant: string | null; // descripteur non-canonique (ex: additive-prebackup, contour-auto-preclip, __flat)
  suffix_token: string | null; // token de `__<token>` (hors double-slug qc-zonage-…)
  location: "backup-prefix" | "namespace-root" | "namespace-nested" | "other";
  last_modified: string | null;
}

/** Premier segment de RÉPERTOIRE (hors filename) commençant par `_`, sinon null. */
function backupPrefixOf(rest: string): string | null {
  const parts = rest.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i]!.startsWith("_")) return parts[i]!;
  }
  return null;
}

function filenameOf(rest: string): string {
  return rest.slice(rest.lastIndexOf("/") + 1);
}

/** Slug de base rattachable à un canonique servi. */
function baseSlugOf(rest: string): string | null {
  const fn = filenameOf(rest);
  const m = /^qc-zonage-([a-z0-9-]+?)(?:__|\.|$)/.exec(fn);
  if (m) return m[1]!;
  const dir = /(?:^|\/)qc-zonage-([a-z0-9-]+)\//.exec(rest);
  return dir ? dir[1]! : null;
}

/** Descripteur de variante d'un filename qc-zonage-<slug><variant> (partie après le slug). */
function variantOf(fn: string): { variant: string | null; suffixToken: string | null } {
  const m = /^qc-zonage-[a-z0-9-]+?(__.+|\..+)$/.exec(fn);
  if (!m) return { variant: null, suffixToken: null };
  const tail = m[1]!;
  // token de suffixe `__<token>` (mais PAS le double-slug fold-backup __qc-zonage-…)
  const tok = /^__([a-z0-9-]+)/.exec(tail);
  const suffixToken = tok && !tok[1]!.startsWith("qc-zonage") ? tok[1]! : null;
  // variant lisible : enlève le timestamp ISO et .geojson terminal pour regrouper
  let variant = tail
    .replace(/\.\d{4}-\d{2}-\d{2}T[0-9]+Z?/g, ".<ts>")
    .replace(/\.geojson$/, "")
    .replace(/^\./, "")
    .replace(/^__/, "__");
  if (tail.startsWith("__qc-zonage")) variant = "__<double-slug>";
  return { variant, suffixToken };
}

function categorize(rest: string): Pick<Row, "category" | "slug" | "backup_prefix" | "is_geojson" | "variant" | "suffix_token" | "location"> {
  const fn = filenameOf(rest);
  const is_geojson = fn.endsWith(".geojson");
  const backup_prefix = backupPrefixOf(rest);
  if (backup_prefix) {
    const { variant, suffixToken } = variantOf(fn);
    return { category: "BACKUP-UNDER-PREFIX", slug: baseSlugOf(rest), backup_prefix, is_geojson, variant, suffix_token: suffixToken, location: "backup-prefix" };
  }
  const flat = CANONICAL_FLAT_RE.exec(rest);
  if (flat) return { category: "CANONICAL-FLAT", slug: flat[1]!, backup_prefix: null, is_geojson: true, variant: null, suffix_token: null, location: "namespace-root" };
  const nested = CANONICAL_NESTED_RE.exec(rest);
  if (nested && nested[1] === nested[2]) return { category: "CANONICAL-NESTED", slug: nested[1]!, backup_prefix: null, is_geojson: true, variant: null, suffix_token: null, location: "namespace-nested" };
  const sidecar = CANONICAL_NESTED_SIDECAR_RE.exec(rest);
  if (sidecar && sidecar[1] === sidecar[2] && sidecar[3] !== "geojson") {
    // sidecar sous le dossier canonique nested (meta/stats/proof…)
    const { variant, suffixToken } = variantOf(fn);
    // Un .geojson non-canonique sous le dossier nested est de la pollution (pas un sidecar).
    if (is_geojson) {
      return { category: "NONCANONICAL-GEOJSON-IN-NAMESPACE", slug: sidecar[1]!, backup_prefix: null, is_geojson: true, variant, suffix_token: suffixToken, location: "namespace-nested" };
    }
    return { category: "CANONICAL-NESTED-SIDECAR", slug: sidecar[1]!, backup_prefix: null, is_geojson: false, variant, suffix_token: suffixToken, location: "namespace-nested" };
  }
  // Directement dans le namespace (racine ou dossier nested), non-canonique.
  const inNestedDir = rest.includes("/");
  const location = inNestedDir ? "namespace-nested" : "namespace-root";
  const { variant, suffixToken } = variantOf(fn);
  if (is_geojson && /^qc-zonage-/.test(fn)) {
    return { category: "NONCANONICAL-GEOJSON-IN-NAMESPACE", slug: baseSlugOf(rest), backup_prefix: null, is_geojson: true, variant, suffix_token: suffixToken, location };
  }
  if (!is_geojson && /^qc-zonage-/.test(fn) && fn.endsWith(".json")) {
    return { category: "SIDECAR-IN-NAMESPACE", slug: baseSlugOf(rest), backup_prefix: null, is_geojson: false, variant, suffix_token: suffixToken, location };
  }
  return { category: "OTHER", slug: baseSlugOf(rest), backup_prefix: null, is_geojson, variant, suffix_token: suffixToken, location: "other" };
}

function inc(map: Map<string, number>, k: string, by = 1): void { map.set(k, (map.get(k) ?? 0) + by); }

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();
  const entries = await listObjectEntries(s3, S3_PREFIX);

  const rows: Row[] = [];
  const byCategory = new Map<Category, Row[]>();
  const canonicalFlatSlugs = new Set<string>();
  const canonicalNestedSlugs = new Set<string>();

  for (const { key, last_modified } of entries) {
    if (!key.startsWith(S3_PREFIX)) continue;
    const rest = key.slice(S3_PREFIX.length);
    if (rest === "") continue;
    const c = categorize(rest);
    const row: Row = { key, rest, last_modified, ...c };
    rows.push(row);
    let b = byCategory.get(c.category); if (!b) { b = []; byCategory.set(c.category, b); } b.push(row);
    if (c.category === "CANONICAL-FLAT" && c.slug) canonicalFlatSlugs.add(c.slug);
    if (c.category === "CANONICAL-NESTED" && c.slug) canonicalNestedSlugs.add(c.slug);
  }

  const canonicalSlugs = new Set<string>([...canonicalFlatSlugs, ...canonicalNestedSlugs]);
  const counts: Record<string, number> = {};
  for (const [cat, r] of byCategory) counts[cat] = r.length;

  // ── Sous-répartition des backups par préfixe ──
  const backupRows = byCategory.get("BACKUP-UNDER-PREFIX") ?? [];
  const backupByPrefix = new Map<string, number>();
  const backupGeojsonByPrefix = new Map<string, number>();
  for (const r of backupRows) {
    inc(backupByPrefix, r.backup_prefix ?? "?");
    if (r.is_geojson) inc(backupGeojsonByPrefix, r.backup_prefix ?? "?");
  }

  // ── Tokens de suffixe `__<token>` (hors double-slug) ──
  const tokenCounts = new Map<string, { backup_prefix: number; namespace: number }>();
  for (const r of rows) {
    if (!r.suffix_token) continue;
    const c = tokenCounts.get(r.suffix_token) ?? { backup_prefix: 0, namespace: 0 };
    if (r.location === "backup-prefix") c.backup_prefix++; else c.namespace++;
    tokenCounts.set(r.suffix_token, c);
  }
  const tokenSet = [...tokenCounts.entries()]
    .map(([token, c]) => ({ token, under_backup_prefix: c.backup_prefix, in_namespace: c.namespace, total: c.backup_prefix + c.namespace }))
    .sort((a, b) => b.total - a.total);

  // ── Variantes de pollution IN-NAMESPACE (par descripteur) ──
  const pollutionRows = byCategory.get("NONCANONICAL-GEOJSON-IN-NAMESPACE") ?? [];
  const pollutionByVariant = new Map<string, number>();
  const pollutionByLocation = new Map<string, number>();
  for (const r of pollutionRows) { inc(pollutionByVariant, r.variant ?? "(none)"); inc(pollutionByLocation, r.location); }
  const sidecarRows = byCategory.get("SIDECAR-IN-NAMESPACE") ?? [];
  const sidecarByVariant = new Map<string, number>();
  for (const r of sidecarRows) inc(sidecarByVariant, r.variant ?? "(none)");

  // ── OTHER: formes, pour ne rien cacher ──
  const otherRows = byCategory.get("OTHER") ?? [];
  const otherShapes = new Map<string, number>();
  for (const r of otherRows) {
    const fn = filenameOf(r.rest);
    const ext = fn.includes(".") ? fn.slice(fn.indexOf(".")) : "(no-ext)";
    inc(otherShapes, `${r.location}:${ext}`);
  }

  // ── TASK 2 — correspondance backup/pollution ↔ canonique ──
  const noncanon = rows.filter((r) => r.category === "BACKUP-UNDER-PREFIX" || r.category === "NONCANONICAL-GEOJSON-IN-NAMESPACE" || r.category === "SIDECAR-IN-NAMESPACE" || r.category === "OTHER");
  const considered = rows.filter((r) => (r.category === "BACKUP-UNDER-PREFIX" || r.category === "NONCANONICAL-GEOJSON-IN-NAMESPACE") && r.slug);
  let withCanon = 0; const orphans: string[] = [];
  for (const r of considered) {
    if (r.slug && canonicalSlugs.has(r.slug)) withCanon++;
    else if (orphans.length < 40) orphans.push(`${r.key} (slug=${r.slug ?? "?"})`);
  }
  const withoutCanon = considered.length - withCanon;
  const correspondenceRate = considered.length ? Math.round((withCanon / considered.length) * 1000) / 10 : 0;

  // ── Candidats-collection geo-api sous 2 hypothèses (borne haute, par clé) ──
  const geojsonUnderBackup = backupRows.filter((r) => r.is_geojson).length;
  const geojsonPollutionRoot = pollutionRows.filter((r) => r.location === "namespace-root").length;
  const geojsonPollutionNested = pollutionRows.filter((r) => r.location === "namespace-nested").length;
  const nonCanonCount = (counts["BACKUP-UNDER-PREFIX"] ?? 0) + (counts["NONCANONICAL-GEOJSON-IN-NAMESPACE"] ?? 0) + (counts["SIDECAR-IN-NAMESPACE"] ?? 0) + (counts["OTHER"] ?? 0);

  // ── MODÈLE EXACT de l'indexeur geo-api (store-provider.ts) ──────────────────
  // id de collection = stemOf(clé) = BASENAME (dernier segment) moins `.geojson`
  //   (le RÉPERTOIRE est ignoré ; store-provider.ts:246-250), puis dédup par id EXACT
  //   (store-provider.ts:101-104). Filtre unique : `.endsWith(".geojson")` (récursif,
  //   pas de skip `_replaced/`). Un éventuel sibling `<stem>.meta.json` avec datasetId
  //   remapperait l'id — NON résolu ici (nécessiterait lire chaque meta) ; ce modèle est
  //   la borne HAUTE des collections en supposant zéro remap meta. Caveat noté au rapport.
  function stemOf(geojsonKey: string): string {
    const base = geojsonKey.slice(geojsonKey.lastIndexOf("/") + 1);
    return base.slice(0, -".geojson".length);
  }
  const canonicalStems = new Set<string>(); // stems des clés canoniques (= qc-zonage-<slug>)
  const stemToKeys = new Map<string, string[]>(); // tous les .geojson → stem
  for (const r of rows) {
    if (!r.is_geojson) continue;
    const stem = stemOf(r.rest);
    const arr = stemToKeys.get(stem) ?? []; arr.push(r.key); stemToKeys.set(stem, arr);
    if (r.category === "CANONICAL-FLAT" || r.category === "CANONICAL-NESTED") canonicalStems.add(stem);
  }
  const distinctStems = stemToKeys.size;
  const extraStems: string[] = [];
  for (const stem of stemToKeys.keys()) if (!canonicalStems.has(stem)) extraStems.push(stem);
  // Provenance des stems EXTRA : viennent-ils d'une clé sous préfixe backup, ou du namespace ?
  const backupKeySet = new Set(backupRows.map((r) => r.key));
  const pollutionKeySet = new Set(pollutionRows.map((r) => r.key));
  let extraFromBackup = 0, extraFromNamespace = 0, extraMixedOrOther = 0;
  for (const stem of extraStems) {
    const ks = stemToKeys.get(stem)!;
    const anyBackup = ks.some((k) => backupKeySet.has(k));
    const anyPollution = ks.some((k) => pollutionKeySet.has(k));
    if (anyBackup && !anyPollution) extraFromBackup++;
    else if (anyPollution && !anyBackup) extraFromNamespace++;
    else extraMixedOrOther++;
  }
  // Stems où une clé NON-canonique COLLISIONNE avec l'id canonique (donc déduppée, PAS extra).
  let collapsedIntoCanonical = 0;
  for (const stem of canonicalStems) {
    const ks = stemToKeys.get(stem) ?? [];
    if (ks.length > 1) collapsedIntoCanonical += ks.length - 1;
  }
  const geoapiModel = {
    algorithm: "id = basename(key) sans .geojson (répertoire ignoré) ; dédup par id exact ; filtre .geojson ; récursif ; réf store-provider.ts:86-120,246-278",
    meta_datasetId_caveat: "un sibling <stem>.meta.json avec datasetId remapperait l'id — non résolu ici ; borne haute = zéro remap",
    total_distinct_collections_modeled: distinctStems,
    legitimate_canonical_collections: canonicalStems.size,
    extra_noncanonical_collections: extraStems.length,
    extra_from_backup_prefix_keys: extraFromBackup,
    extra_from_in_namespace_pollution: extraFromNamespace,
    extra_mixed_or_other: extraMixedOrOther,
    noncanonical_geojson_keys_collapsed_into_canonical_id: collapsedIntoCanonical,
    extra_stems_sample: extraStems.slice(0, 30).sort(),
  };

  const sample = (cat: Category, n = 15): string[] => (byCategory.get(cat) ?? []).slice(0, n).map((r) => r.key);

  const report = {
    contract: "zones-noncanonical-key-audit/diagnostic",
    generated_at_utc: new Date().toISOString(),
    read_only: true,
    s3_prefix: S3_PREFIX,
    location_rule: "namespace servi = normalized/ca-qc-zonage/ + qc-zonage-<slug>/. Un segment de répertoire commençant par `_` = zone backup/annexe HORS namespace servi.",
    totals: {
      total_keys_listed: entries.length,
      by_category: counts,
      canonical_flat_slugs: canonicalFlatSlugs.size,
      canonical_nested_slugs: canonicalNestedSlugs.size,
      distinct_canonical_slugs: canonicalSlugs.size,
      non_canonical_keys: nonCanonCount,
    },
    split_backup_vs_namespace: {
      backups_under_underscore_prefix: counts["BACKUP-UNDER-PREFIX"] ?? 0,
      backup_prefixes: [...backupByPrefix.entries()].sort((a, b) => b[1] - a[1]).map(([prefix, count]) => ({ prefix, count, geojson: backupGeojsonByPrefix.get(prefix) ?? 0 })),
      noncanonical_geojson_in_namespace: counts["NONCANONICAL-GEOJSON-IN-NAMESPACE"] ?? 0,
      noncanonical_geojson_in_namespace_root: geojsonPollutionRoot,
      noncanonical_geojson_in_nested_dir: geojsonPollutionNested,
      sidecar_json_in_namespace: counts["SIDECAR-IN-NAMESPACE"] ?? 0,
      other: counts["OTHER"] ?? 0,
    },
    geoapi_indexer_verdict: {
      source: "packages/geo/src/api/providers/store-provider.ts + packages/geo/src/storage/s3-store.ts (établi par lecture code, file:line)",
      recurses_into_backup_prefixes: true,
      recurse_evidence: "S3Store.list() ListObjectsV2 sans Delimiter → récursif ; pushe chaque Key sans filtre (s3-store.ts:111-129)",
      keeps_suffix_as_collection_id: true,
      id_rule: "id = stemOf(basename) = basename moins .geojson (répertoire ignoré) ; override par sibling <stem>.meta.json.datasetId (store-provider.ts:108-119,231-234,246-250)",
      only_exclusion: ".endsWith('.geojson') ; puis dédup par id EXACT (store-provider.ts:96,101-104)",
      no_canonical_regex: true,
      no_prefix_skiplist: true,
      no_collapse_by_slug: true,
      consequence: "qc-zonage-<slug>__flat.<ts>.geojson (et .additive-prebackup/.contour-auto-preclip/__double-slug) deviennent chacun UNE collection distincte ; les snapshots single-slug qc-zonage-<slug>.geojson sous _zone-source-fold-backups collisionnent avec l'id canonique et sont déduppés (last-wins/nested), donc NE créent pas de collection en trop",
    },
    geoapi_collection_model_exact: geoapiModel,
    geoapi_collection_candidates_upper_bound_per_key: {
      note: "Borne HAUTE par CLÉ (avant dédup par stem). Le modèle exact ci-dessus est la mesure qui compte.",
      legitimate_canonical_slugs: canonicalSlugs.size,
      geojson_under_backup_prefixes: geojsonUnderBackup,
      geojson_pollution_namespace_root: geojsonPollutionRoot,
      geojson_pollution_nested_dir: geojsonPollutionNested,
      extra_keys_if_recurse: geojsonUnderBackup + geojsonPollutionRoot + geojsonPollutionNested,
      extra_keys_if_no_recurse_namespace_only: geojsonPollutionRoot + geojsonPollutionNested,
    },
    finding_762_check: {
      cited_extra_collections: 762,
      measured_extra_collections_exact_model: geoapiModel.extra_noncanonical_collections,
      measured_extra_from_backup_prefix: geoapiModel.extra_from_backup_prefix_keys,
      measured_extra_from_in_namespace_pollution: geoapiModel.extra_from_in_namespace_pollution,
      measured_noncanonical_geojson_keys_upper_bound: geojsonUnderBackup + geojsonPollutionRoot + geojsonPollutionNested,
      note: "Le modèle exact (stems distincts non-canoniques) est la comparaison correcte au +762 ; la borne haute par clé sur-compte car les snapshots single-slug collisionnent avec l'id canonique.",
    },
    suffix_token_set: tokenSet,
    pollution_in_namespace_by_variant: [...pollutionByVariant.entries()].sort((a, b) => b[1] - a[1]).map(([variant, count]) => ({ variant, count })),
    pollution_in_namespace_by_location: [...pollutionByLocation.entries()].map(([location, count]) => ({ location, count })),
    sidecar_in_namespace_by_variant: [...sidecarByVariant.entries()].sort((a, b) => b[1] - a[1]).map(([variant, count]) => ({ variant, count })),
    backup_canonical_correspondence: {
      considered_keys: considered.length,
      with_matching_canonical: withCanon,
      without_matching_canonical: withoutCanon,
      correspondence_rate_pct: correspondenceRate,
      orphan_sample: orphans,
    },
    other_shapes: [...otherShapes.entries()].sort((a, b) => b[1] - a[1]).map(([shape, count]) => ({ shape, count })),
    samples: {
      "CANONICAL-FLAT": sample("CANONICAL-FLAT"),
      "CANONICAL-NESTED": sample("CANONICAL-NESTED"),
      "CANONICAL-NESTED-SIDECAR": sample("CANONICAL-NESTED-SIDECAR"),
      "BACKUP-UNDER-PREFIX": sample("BACKUP-UNDER-PREFIX"),
      "NONCANONICAL-GEOJSON-IN-NAMESPACE": sample("NONCANONICAL-GEOJSON-IN-NAMESPACE", 25),
      "SIDECAR-IN-NAMESPACE": sample("SIDECAR-IN-NAMESPACE"),
      "OTHER": sample("OTHER"),
    },
    noncanonical_sample: noncanon.slice(0, 60).map((r) => ({ key: r.key, category: r.category, slug: r.slug, backup_prefix: r.backup_prefix, variant: r.variant, location: r.location })),
  };

  mkdirSync("work/coverage", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 1)}\n`);

  const catRows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `| ${c} | ${n} |`).join("\n");
  const bpRows = report.split_backup_vs_namespace.backup_prefixes.map((p) => `| \`${p.prefix}/\` | ${p.count} | ${p.geojson} |`).join("\n") || "| (aucun) | 0 | 0 |";
  const tokRows = tokenSet.map((t) => `| \`${t.token}\` | ${t.under_backup_prefix} | ${t.in_namespace} | ${t.total} |`).join("\n") || "| (aucun) | 0 | 0 | 0 |";
  const polRows = report.pollution_in_namespace_by_variant.map((v) => `| \`${v.variant}\` | ${v.count} |`).join("\n") || "| (aucun) | 0 |";
  const scRows = report.sidecar_in_namespace_by_variant.map((v) => `| \`${v.variant}\` | ${v.count} |`).join("\n") || "| (aucun) | 0 |";
  const otRows = report.other_shapes.map((o) => `| \`${o.shape}\` | ${o.count} |`).join("\n") || "| (aucun) | 0 |";
  const sampleBlock = (cat: Category, n = 15): string => { const s = sample(cat, n); return s.length ? s.map((k) => `- \`${k}\``).join("\n") : "- (aucun)"; };

  const md = `# Audit clés non-canoniques \`normalized/ca-qc-zonage/\` — ${new Date().toISOString().slice(0, 10)}

Sonde LECTURE SEULE (aucune écriture / suppression S3). Finding dé-entropie archi
(Exemplar #4) : le nouveau geo-api indexerait ~762 objets sous des clés non-canoniques
comme des collections DISTINCTES (~3885 → ~4647). But : séparer les **sauvegardes
d'audit** (backup avant écrasement — réversibilité + audit de provenance) de la vraie
**pollution du namespace servi**, mesurer OÙ chaque clé se trouve, et rattacher le chiffre.

**Règle de localisation (mesurée).** Le namespace SERVI est \`${S3_PREFIX}\` + son sous-arbre
\`qc-zonage-<slug>/\`. Tout segment de répertoire commençant par \`_\` (ex: \`_replaced/\`,
\`_zone-source-fold-backups/<ts>/\`) est une zone de BACKUP/annexe HORS du namespace servi.

## Totaux (énumération S3 paginée complète)

- clés listées sous \`${S3_PREFIX}\` : **${entries.length}**
- slugs canoniques FLAT : **${canonicalFlatSlugs.size}** · NESTED : **${canonicalNestedSlugs.size}** · distincts : **${canonicalSlugs.size}**
- clés non-canoniques totales : **${nonCanonCount}**

### Par catégorie

| catégorie | clés |
|-----------|------|
${catRows}

## Split backups vs pollution du namespace (le cœur du finding)

### Backups sous un préfixe \`_…/\` (backups d'audit propres, HORS namespace servi)

Total : **${counts["BACKUP-UNDER-PREFIX"] ?? 0}** clés.

| préfixe backup | clés | dont .geojson |
|----------------|------|---------------|
${bpRows}

### Pollution DIRECTEMENT dans le namespace servi

- **.geojson non-canoniques dans le namespace : ${counts["NONCANONICAL-GEOJSON-IN-NAMESPACE"] ?? 0}**
  (racine : ${geojsonPollutionRoot} · dossier nested : ${geojsonPollutionNested})
- sidecars .json dans le namespace (racine) : ${counts["SIDECAR-IN-NAMESPACE"] ?? 0}
- OTHER : ${counts["OTHER"] ?? 0}

Variantes de la pollution .geojson in-namespace :

| variante | clés |
|----------|------|
${polRows}

Sidecars in-namespace :

| variante | clés |
|----------|------|
${scRows}

## Verdict indexeur geo-api (lecture code, file:line)

geo-api est du **TypeScript custom du dépôt** (pas un serveur OGC tiers). Chaîne :
\`GEO_DATA_URI=s3://sentropic-geo/normalized\` (deploy/k8s/geo-api-deployment.yaml:45-46)
→ \`StoreProvider\` sur \`S3Store\` (make-provider.ts:50-51).

- **(a) RÉCURSE, aucune exclusion.** \`S3Store.list()\` fait un \`ListObjectsV2\` **sans
  \`Delimiter\`** → récursif sur tout le sous-arbre, et pushe chaque \`Key\` **sans filtre**
  (s3-store.ts:111-129). Le provider ne filtre QUE par \`.endsWith(".geojson")\`
  (store-provider.ts:96). **Pas de skip \`_replaced/\`, pas de skip-liste de préfixe.**
- **(b) Le suffixe \`__flat.<ts>\` est CONSERVÉ comme id de collection.** \`stemOf\` =
  basename moins \`.geojson\`, **répertoire ignoré** (store-provider.ts:246-250) ;
  \`id = meta?.datasetId ?? stem\` (store-provider.ts:231-234). Donc
  \`qc-zonage-beaupre__flat.2026-08-16T0441Z.geojson\` → collection
  **\`qc-zonage-beaupre__flat.2026-08-16T0441Z\`** (PAS collapsé en \`qc-zonage-beaupre\`).
- **(c) Rien n'exclut les clés non-canoniques.** Aucune regex de nom canonique, aucune
  skip-liste, aucun collapse-par-slug. Seule la dédup par **id EXACT**
  (store-provider.ts:101-104) fusionne, et le tie-break flat/nested ne joue qu'en cas de
  collision d'id (store-provider.ts:255-278).

**Conséquence mesurée.** Comme \`stemOf\` ignore le répertoire, un snapshot single-slug
\`_zone-source-fold-backups/<ts>/qc-zonage-<slug>.geojson\` a le MÊME id que le canonique
\`qc-zonage-<slug>\` → déduppé, **PAS** une collection en trop. En revanche chaque
\`__flat.<ts>\` / \`.additive-prebackup\` / \`.contour-auto-preclip\` / double-slug a un
basename distinct → **une collection en trop**.

## Modèle EXACT de collections servies (algorithme geo-api rejoué)

id = stemOf(basename) ; dédup par id exact. Caveat : un sibling \`<stem>.meta.json\` avec
\`datasetId\` remapperait l'id (non résolu ici → borne haute sans remap meta).

- collections distinctes modélisées (tous \`.geojson\`) : **${geoapiModel.total_distinct_collections_modeled}**
- collections légitimes (stems canoniques) : **${geoapiModel.legitimate_canonical_collections}**
- **collections EN TROP (stems non-canoniques) : ${geoapiModel.extra_noncanonical_collections}**
  - dont issues de clés sous préfixe backup : **${geoapiModel.extra_from_backup_prefix_keys}**
  - dont issues de pollution in-namespace : **${geoapiModel.extra_from_in_namespace_pollution}**
  - mixte/autre : ${geoapiModel.extra_mixed_or_other}
- clés .geojson non-canoniques COLLISIONNANT avec un id canonique (déduppées, PAS en trop) : **${geoapiModel.noncanonical_geojson_keys_collapsed_into_canonical_id}**

### Rattachement du chiffre ~762

- cité (collections en trop) : **762**
- **mesuré (modèle exact) collections en trop : ${geoapiModel.extra_noncanonical_collections}**
  (backup=${geoapiModel.extra_from_backup_prefix_keys}, in-namespace=${geoapiModel.extra_from_in_namespace_pollution})
- borne haute par clé (avant dédup stem) : ${geojsonUnderBackup + geojsonPollutionRoot + geojsonPollutionNested}

_Note : le +762 cité par archi est probablement un instantané antérieur (avant les
snapshots \`_zone-source-fold-backups\` du 2026-07-24 ou une passe de backups \`_replaced\`) ;
la mesure du modèle exact ci-dessus est la valeur courante rejouable._

## Ensemble des tokens de suffixe \`__<token>\` (mesuré)

| token | sous préfixe backup | dans namespace | total |
|-------|---------------------|----------------|-------|
${tokRows}

## Correspondance backup/pollution ↔ canonique (TASK 2)

Chaque clé backup/pollution a-t-elle un slug qui possède AUSSI un canonique servi (flat/nested) ?

- clés considérées : **${considered.length}**
- avec canonique correspondant : **${withCanon}**
- sans canonique correspondant (orphelines) : **${withoutCanon}**
- **taux de correspondance : ${correspondenceRate}%**

${orphans.length ? `Orphelines (échantillon) :\n${orphans.map((k) => `- \`${k}\``).join("\n")}` : "Aucune orpheline détectée : chaque backup/pollution correspond à une ville qui a AUSSI un canonique servi."}

## Formes OTHER (rien de caché)

| forme (localisation:extension) | clés |
|--------------------------------|------|
${otRows}

## Échantillons de clés

### CANONICAL-FLAT
${sampleBlock("CANONICAL-FLAT")}

### CANONICAL-NESTED
${sampleBlock("CANONICAL-NESTED")}

### CANONICAL-NESTED-SIDECAR
${sampleBlock("CANONICAL-NESTED-SIDECAR")}

### BACKUP-UNDER-PREFIX
${sampleBlock("BACKUP-UNDER-PREFIX")}

### NONCANONICAL-GEOJSON-IN-NAMESPACE (vraie pollution servie)
${sampleBlock("NONCANONICAL-GEOJSON-IN-NAMESPACE", 25)}

### SIDECAR-IN-NAMESPACE
${sampleBlock("SIDECAR-IN-NAMESPACE")}

### OTHER
${sampleBlock("OTHER")}

## Correctif proposé

1. **Discipline de clé servie canonique dans l'acquisition.** Seuls
   \`qc-zonage-<slug>.geojson\` (flat) et \`qc-zonage-<slug>/qc-zonage-<slug>.geojson\` (nested)
   sont des clés SERVIES. Aucune variante horodatée / pré-backup (\`.additive-prebackup.geojson\`,
   \`.contour-auto-preclip.geojson\`, \`__<token>.<ts>.geojson\`) ne doit être écrite DIRECTEMENT
   dans le namespace servi.
2. **Backups relocalisés vers un préfixe EXCLU de l'index (préserver, pas supprimer).** Les
   sauvegardes vivent déjà sous \`_replaced/\` et \`_zone-source-fold-backups/\` (préfixes \`_…/\`,
   hors namespace) ; les pré-backups actuellement DANS le namespace (\`.additive-prebackup.geojson\`,
   \`.contour-auto-preclip.geojson\`) doivent y être déplacés (copy vers \`_replaced/\` puis retrait
   du namespace). Réversibilité + audit préservés, namespace propre.
3. **Ce que geo-api doit exclure.** (a) skipper tout segment de chemin commençant par \`_\`
   (\`_replaced/\`, \`_zone-source-fold-backups/\`…) ; (b) n'accepter comme collection que les clés
   MATCHANT la regex canonique flat/nested (rejette \`.additive-prebackup\`, \`.contour-auto-preclip\`,
   \`__<token>\`, sidecars \`.stats.json\`/\`.meta.json\`) ; (c) dédupliquer par slug (last-wins).
`;
  writeFileSync(OUT_MD, md);

  process.stdout.write(
    `[done] total=${entries.length} canonical_slugs=${canonicalSlugs.size} non_canonical=${nonCanonCount}\n` +
    `[done] backups_under_prefix=${counts["BACKUP-UNDER-PREFIX"] ?? 0} (${[...backupByPrefix.entries()].map(([p, n]) => `${p}=${n}`).join(", ")})\n` +
    `[done] pollution_geojson_in_namespace=${counts["NONCANONICAL-GEOJSON-IN-NAMESPACE"] ?? 0} (root=${geojsonPollutionRoot}, nested=${geojsonPollutionNested})\n` +
    `[done] sidecar_in_namespace=${counts["SIDECAR-IN-NAMESPACE"] ?? 0} other=${counts["OTHER"] ?? 0}\n` +
    `[done] geoapi_model: distinct_collections=${geoapiModel.total_distinct_collections_modeled} canonical=${geoapiModel.legitimate_canonical_collections} EXTRA=${geoapiModel.extra_noncanonical_collections} (backup=${geoapiModel.extra_from_backup_prefix_keys}, in-namespace=${geoapiModel.extra_from_in_namespace_pollution}); single-slug collapsed=${geoapiModel.noncanonical_geojson_keys_collapsed_into_canonical_id}\n` +
    `[done] upper_bound_per_key extra_if_recurse=${geojsonUnderBackup + geojsonPollutionRoot + geojsonPollutionNested}\n` +
    `[done] correspondence=${correspondenceRate}% (${withCanon}/${considered.length})\n` +
    `[done] tokens: ${tokenSet.map((t) => `${t.token}(${t.total})`).join(", ") || "(none)"}\n` +
    `[done] wrote ${OUT_JSON} + ${OUT_MD}\n`,
  );
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
