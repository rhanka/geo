#!/usr/bin/env node
/**
 * WP3 KPI — REPRODUCIBLE règlement-URL coverage over the palier-167 cohort.
 *
 * Answers the conductor question "chaque slug de cohorte porte-t-il numéro +
 * URL/PDF servi ?" with a CLOSED partition and a per-slug action bucket. Every
 * signal is read from a COMMITTED input (registry + latest served-URL audit +
 * cohort + municipal catalogue); nothing is fetched, nothing is inferred from a
 * neighbouring city. A slug with no evidence lands in the bucket its missing
 * evidence dictates — never guessed.
 *
 * Buckets (per cohort slug, first match wins → closed partition of 167):
 *   unmatched        cohort slug resolves to no catalogue city (alias miss)
 *   no-numero        règlement number absent (upstream declaration gap; URL moot)
 *   complete         numéro présent ET URL servie sur la grille de normes (http reglement_url)
 *   curable-fold     numéro + URL http CURÉE au registre, grille servie mais URL non
 *                    stampée → fold additif publish-reglement-provenance SANS capture (levier LOCAL)
 *   grille-unserved  numéro + URL http au registre mais grille de normes NON servie
 *                    → dépend du serving de la grille (zones/serving), pas un fold local
 *   capture-bound    numéro présent, aucune URL http nulle part → capture cluster requise
 *
 * The served-URL signal is the reglement-url-served-audit (read-only S3 census of
 * `reglement_url` on the norms grille `normalized/qc-zonage-norms/` — the SAME
 * surface publish-reglement-provenance stamps, NOT the geometry ca-qc-zonage):
 * a slug's `features_with_http_reglement_url > 0` ⇔ URL servie. The audit also
 * exposes a mineable `_source_url` as DIAGNOSTIC ONLY (never a curable signal — it
 * can be a dead/placeholder link the curated registry already adjudicated to null).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CITY_TARGET = 1106;
const PALIER_TARGET = 167;
const BUCKETS = ["complete", "curable-fold", "grille-unserved", "capture-bound", "no-numero", "unmatched"];
// `--universe` buckets ALL 1106 catalogue slugs (photo globale WP3); default =
// the palier-167 cohort. Same bucket logic, same anti-invention, same closed
// partition — only the slug universe + the served-audit source differ.
const MODE = process.argv.includes("--universe") ? "universe" : "cohort";
const TARGET = MODE === "universe" ? CITY_TARGET : PALIER_TARGET;
const OUTPUT_DATE = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const OUTPUT_AS_OF = `${OUTPUT_DATE.slice(0, 4)}-${OUTPUT_DATE.slice(4, 6)}-${OUTPUT_DATE.slice(6, 8)}`;
const OUTPUT_SCOPE = MODE === "universe" ? "all1106" : "palier167";
const OUTPUT = `work/coverage/reglement-url-coverage-${OUTPUT_SCOPE}-${OUTPUT_DATE}.json`;
const AUDIT_PATTERN = MODE === "universe"
  ? /^reglement-url-served-audit-all1106-.*\.json$/
  : /^reglement-url-served-audit-palier167-.*\.json$/;

function absolute(relativePath) {
  return resolve(REPO_ROOT, relativePath);
}
function readJson(relativePath) {
  return JSON.parse(readFileSync(absolute(relativePath), "utf8"));
}
function invariant(condition, message) {
  if (!condition) throw new Error(`Validation failed: ${message}`);
}
function isHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    // Dotted hostname required: a placeholder sentinel like `https://non-disponible`
    // parses as a URL but its dotless host is not a real reglement source. Reject
    // it so a placeholder never counts as a served/registry URL (anti-invention).
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}
function latestCoverageFile(pattern, timestampField) {
  const candidates = readdirSync(absolute("work/coverage"))
    .filter((name) => pattern.test(name))
    .map((name) => {
      const relativePath = `work/coverage/${name}`;
      const data = readJson(relativePath);
      const timestamp = data[timestampField];
      invariant(typeof timestamp === "string" && timestamp.length > 0,
        `${relativePath} is missing ${timestampField}`);
      return { relativePath, data, timestamp };
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp)
      || left.relativePath.localeCompare(right.relativePath));
  invariant(candidates.length > 0, `no authoritative coverage file matches ${pattern}`);
  return candidates.at(-1);
}

// --- Municipal catalogue (1106) — the only legitimate slug universe ----------
const catalog = readJson("packages/qc-sources/src/geo/municipalities.qc.json");
invariant(Array.isArray(catalog) && catalog.length === CITY_TARGET,
  `municipal catalogue must be an array of ${CITY_TARGET}`);
const catalogSlugs = new Set(catalog.map(({ slug }) => slug));
invariant(catalogSlugs.size === CITY_TARGET, "municipal catalogue has duplicate or missing slugs");

// --- Registry: declared number + source URL ----------------------------------
const REGISTRY_PATH = "acquisition/config/reglement-provenance.json";
const registrySource = readJson(REGISTRY_PATH);
invariant(registrySource.slugs !== null && typeof registrySource.slugs === "object"
  && !Array.isArray(registrySource.slugs), `${REGISTRY_PATH} has no slugs object`);
const registryBySlug = new Map();
for (const [slug, row] of Object.entries(registrySource.slugs)) {
  invariant(row !== null && typeof row === "object" && !Array.isArray(row),
    `${REGISTRY_PATH}/${slug} is not an object`);
  if (catalogSlugs.has(slug)) registryBySlug.set(slug, row);
}

// --- Latest served-URL audit: authoritative "URL servie" on the norms grille -
// The provenance surface immo consumes is normalized/qc-zonage-norms/, where
// publish-reglement-provenance stamps reglement_url. This audit is measured on
// that SAME surface (acquisition/src/reglement-url-served-audit.ts, read-only),
// so a slug counted "served" here is genuinely complete on the surface the fold
// writes — NOT the geometry collection (which a capture-KPI would observe).
const servedAudit = latestCoverageFile(AUDIT_PATTERN, "generated_at");
invariant(servedAudit.data.contract === "reglement-url-served-audit/v1",
  `${servedAudit.relativePath} has unexpected contract`);
invariant(Array.isArray(servedAudit.data.slugs), `${servedAudit.relativePath} has no slugs array`);
const servedBySlug = new Map();
for (const row of servedAudit.data.slugs) {
  const slug = row?.slug;
  invariant(typeof slug === "string" && slug.length > 0, `served-audit row has no slug`);
  invariant(typeof row.grille_served === "boolean", `served-audit/${slug} has non-boolean grille_served`);
  invariant(Number.isInteger(row.features_with_http_reglement_url),
    `served-audit/${slug} has non-integer features_with_http_reglement_url`);
  invariant(Number.isInteger(row.features_with_http_source_url),
    `served-audit/${slug} lacks features_with_http_source_url (re-run the extended audit)`);
  invariant(!servedBySlug.has(slug), `served-audit has duplicate slug ${slug}`);
  servedBySlug.set(slug, row);
}

// --- Palier-167 cohort (radar slug space) + verified alias whitelist ---------
const PALIER_COHORT_PATH = "work/coverage/palier-cohort-167.json";
const palierCohortSource = readJson(PALIER_COHORT_PATH);
invariant(palierCohortSource.contract === "city-kpi-matrix-slug-cohort/v1",
  `${PALIER_COHORT_PATH} has unexpected contract`);
invariant(Array.isArray(palierCohortSource.cities)
  && palierCohortSource.cities.length === PALIER_TARGET,
  `${PALIER_COHORT_PATH} must list ${PALIER_TARGET} cities`);
const palierRows = palierCohortSource.cities.map((row) => {
  invariant(typeof row.slug === "string" && row.slug.length > 0, `${PALIER_COHORT_PATH} row has no slug`);
  invariant(Number.isInteger(row.priorityRank), `${PALIER_COHORT_PATH}/${row.slug} has no integer priorityRank`);
  return { slug: row.slug, priorityRank: row.priorityRank };
});
invariant(new Set(palierRows.map((r) => r.slug)).size === PALIER_TARGET, "palier cohort has duplicate slugs");

// Radar joins some cities on a SINGLE hyphen before the MRC suffix; the geo
// catalogue uses `--`. Verified 1:1 equivalents (municipality name + MRC),
// identical to scripts/generate-completion-regdens.mjs. Each target is asserted
// present below, so a wrong alias fails loud rather than guessing.
const PALIER_SLUG_ALIASES = {
  "saint-isidore-roussillon": "saint-isidore--roussillon",
  "saint-damase-les-maskoutains": "saint-damase--les-maskoutains",
  "hemmingford-les-jardins-de-napierville": "hemmingford--les-jardins-de-napierville",
  "saint-louis-de-gonzague-beauharnois-salaberry": "saint-louis-de-gonzague--beauharnois-salaberry",
  "hemmingford-les-jardins-de-napierville-2": "hemmingford--les-jardins-de-napierville--2",
  "saint-sebastien-le-haut-richelieu": "saint-sebastien--le-haut-richelieu",
  "sainte-sabine-brome-missisquoi": "sainte-sabine--brome-missisquoi",
};
function resolvePalierSlug(slug) {
  if (catalogSlugs.has(slug)) return slug;
  const alias = PALIER_SLUG_ALIASES[slug];
  if (alias === undefined) return undefined;
  invariant(catalogSlugs.has(alias),
    `palier alias target absent from municipal catalogue: ${slug} -> ${alias}`);
  return alias;
}

// --- Bucket each cohort slug (first match wins → closed partition) -----------
function bucketForCity(geoSlug) {
  if (geoSlug === undefined) return { bucket: "unmatched" };
  const reg = registryBySlug.get(geoSlug);
  const numero = reg !== undefined && reg.reglement_numero !== null && reg.reglement_numero !== undefined;
  const registryUrlHttp = reg !== undefined && isHttpUrl(reg.reglement_url);
  const registryUrlPlaceholder = reg !== undefined && typeof reg.reglement_url === "string"
    && reg.reglement_url.length > 0 && !isHttpUrl(reg.reglement_url);
  const audit = servedBySlug.get(geoSlug);
  const grilleServed = audit !== undefined && audit.grille_served === true;
  const servedUrl = audit !== undefined && audit.features_with_http_reglement_url > 0;
  // Diagnostic only: the served grille carries a raw http _source_url. This is
  // NOT a curable signal — that _source_url can be a dead/404 link or a sentinel
  // the curated registry already adjudicated to null (e.g. saint-patrice-de-
  // sherrington: _note documents the pdf returns 404, url deliberately null). The
  // curated registry is the ONLY authority for reglement_url; never fold a raw
  // grille _source_url over a documented null (« ne jamais servir une preuve morte »).
  const mineableSourceUrl = audit !== undefined && !servedUrl && audit.features_with_http_source_url > 0;
  const detail = {
    numero_present: numero,
    served_url: servedUrl,
    grille_served: grilleServed,
    mineable_source_url_diag: mineableSourceUrl,
    registry_url_http: registryUrlHttp,
    registry_url_placeholder: registryUrlPlaceholder,
  };
  if (!numero) return { bucket: "no-numero", ...detail };
  if (servedUrl) return { bucket: "complete", ...detail };
  // Registry holds a real, CURATED http URL but the served grille does not carry
  // it: pure additive fold IF the grille is served (my lever), otherwise blocked
  // on the norms grille being served at all.
  if (registryUrlHttp && grilleServed) return { bucket: "curable-fold", ...detail };
  if (registryUrlHttp && !grilleServed) return { bucket: "grille-unserved", ...detail };
  return { bucket: "capture-bound", ...detail };
}

// Universe mode iterates the 1106 catalogue slugs directly (each IS a catalogue
// city → never `unmatched`); cohort mode keeps the radar-slug + alias resolution.
const cities = MODE === "universe"
  ? catalog.map(({ slug }) => {
      const { bucket, ...detail } = bucketForCity(slug);
      return { slug, geo_slug: slug, bucket, ...detail };
    })
  : palierRows.map(({ slug, priorityRank }) => {
      const geoSlug = resolvePalierSlug(slug);
      const { bucket, ...detail } = bucketForCity(geoSlug);
      return {
        priorityRank,
        slug,
        geo_slug: geoSlug ?? null,
        aliased: geoSlug !== undefined && geoSlug !== slug,
        bucket,
        ...detail,
      };
    });

// --- Closed-partition totals + loud invariant --------------------------------
const partition = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
for (const city of cities) {
  invariant(BUCKETS.includes(city.bucket), `${city.slug} has invalid bucket ${city.bucket}`);
  partition[city.bucket] += 1;
}
const partitionTotal = BUCKETS.reduce((sum, b) => sum + partition[b], 0);
invariant(partitionTotal === TARGET,
  `partition is ${partitionTotal}, expected ${TARGET}`);

// Actionable slug lists (geo slug) so a campaign shards without re-deriving.
const bucketSlugs = Object.fromEntries(BUCKETS.filter((b) => b !== "complete").map((b) => [
  b,
  cities.filter((c) => c.bucket === b).map((c) => c.geo_slug ?? c.slug),
]));

const report = {
  contract: MODE === "universe" ? "reglement-url-coverage-all1106/v1" : "reglement-url-coverage-palier167/v1",
  as_of: OUTPUT_AS_OF,
  ...(MODE === "universe"
    ? { universe: CITY_TARGET }
    : { cohort: palierCohortSource.cohort, cohort_source: palierCohortSource.source }),
  target: TARGET,
  source_as_of: {
    registry_path: REGISTRY_PATH,
    served_audit_path: servedAudit.relativePath,
    served_audit_generated_at: servedAudit.timestamp,
  },
  bucket_semantics: {
    complete: "numéro présent ET URL de BASE servie sur la grille de normes (reglement_url http). PLANCHER base-cadre, PAS preuve per-event (cf. caveats.granularity)",
    "curable-fold": "numéro + URL http CURÉE au registre, grille servie mais URL non stampée → fold additif publish-reglement-provenance SANS capture (levier LOCAL)",
    "grille-unserved": "numéro + URL http au registre mais grille de normes NON servie → dépend du serving de la grille (zones/serving)",
    "capture-bound": "numéro présent, aucune URL http nulle part (registre null/placeholder ET non servie) → capture cluster (socle)",
    "no-numero": "numéro absent (gap de déclaration amont; URL sans objet)",
    unmatched: "slug cohorte non résolu à une ville catalogue",
  },
  // Ce que « complete » NE prouve PAS — pour ne pas greenwash (revue croisée
  // avec la lane extraction/fantômes, 2026-08-23).
  caveats: {
    granularity: "complete = une URL de reglement de BASE servie (plancher que le cadre de zonage existe). Ce n'est PAS une preuve per-event: une zone/amendement servi peut pointer un règlement dont le PDF spécifique n'est pas la base. Le sourcing per-event (par bylaw/PV) reste un objectif distinct.",
    liveness: "L'URL n'est validée qu'en FORME (http, domaine à point, pas placeholder) et via la curation registre; elle n'est PAS re-fetchée à la génération. Une URL curée peut être morte (404) après coup — un axe liveness re-vérifiée serait une passe capture séparée.",
  },
  partition,
  // complete/target is the owner-facing coverage line for this axis.
  coverage: `${partition.complete}/${TARGET}`,
  buckets: bucketSlugs,
  cities,
};

writeFileSync(absolute(OUTPUT), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUTPUT,
  source_as_of: report.source_as_of,
  target: TARGET,
  partition,
  coverage: report.coverage,
  curable_fold_count: bucketSlugs["curable-fold"].length,
  grille_unserved_count: bucketSlugs["grille-unserved"].length,
  capture_bound_count: bucketSlugs["capture-bound"].length,
  no_numero_count: bucketSlugs["no-numero"].length,
  unmatched: bucketSlugs.unmatched,
}, null, 2));
