#!/usr/bin/env node
// =============================================================================
// served-ids.mjs — CONTRAT e2e immo+geo de la bascule préprod geo. 0 Python.
//
// L'orchestrateur e2e (radar-immobilier, i-cond) dispatche bascule-preprod.yml avec
// un input CYCLE_ID, puis vérifie par INCLUSION que chaque id canonique référencé
// par immo existe, octet pour octet, dans le « served set » de geo. Ce script porte
// TOUTE la logique geo de ce contrat (le workflow reste fin) :
//
//   build             (fin du job `s3`, hors DRY, CYCLE_ID non vide)
//                     Lit l'API PUBLIQUE préprod (0 credential, comme le smoke S7),
//                     calcule les ids ZONES avec le builder PUBLIÉ
//                     `@sentropic/geo@<BUILDER_VERSION>` (installé hors workspace par
//                     npm, version épinglée et revérifiée ici), écrit l'artefact :
//                       served-ids.txt            1 id par ligne, ordre d'octets, dédupliqué
//                       served-ids.txt.sha256     `<hex>  served-ids.txt` (sha256sum -c)
//                       served-ids.meta.json      comptes, collections lues, scope, builder
//                       missing-zone-collections.txt  slugs du registre SANS collection servie
//   cycle-leg         (job `cycle-leg`, needs [pg, s3], if always() && CYCLE_ID != '')
//                     RAPPORTE seulement : écrit `legs.geo` (cycle-leg-geo.json).
//   validate-cycle-id garde du CYCLE_ID avant tout usage dans un nom d'artefact.
//   builder-version   imprime la version épinglée (source unique pour `npm install`).
//
// SCOPE = ZONES SEULES (arbitrage i-cond, 2026-09-25). Les lots viendront par un
// endpoint geo-api `/join-keys` : lire les `qc-lots-*` par l'API OGC actuelle est
// impossible (géométrie obligatoire, chaque page relit tout l'objet côté serveur —
// Laval 401 594 lots ≈ 63 min — et qc-lots-montreal ferme la connexion vers 50 s).
//
// UNIVERS (SPEC_GEO_SERVED_CONTRACT §2) : collections `qc-zonage-<slug>` dont le slug
// est dans le registre committé des 1106 municipalités
// (packages/qc-sources/src/geo/municipalities.qc.json). Donc EXCLUS : `qc-zonage-norms-*`
// (tables de normes), couches thématiques (`qc-zonage-arcgis-*`, `qc-zonage-laval-sad-*`…)
// et variantes de slug hors registre (`l-assomption`, `l-epiphanie`,
// `sainte-christine-d-auvergne` — exclues tant qu'immo n'a pas dit s'il les référence).
// Propriété lue : `feature.properties.zone_code` (brute, canonicalisée par le builder).
//
// FAIL-CLOSED : erreur HTTP (après 3 tentatives sur 429/5xx/réseau/JSON illisible ;
// 4xx = échec immédiat), page incohérente, collection servie illisible, registre
// invalide, builder absent/mauvaise version, sortie non triée/dupliquée ⇒ exit 1.
// Résultat vide ⇒ exit 1 (un fichier vide ne passe JAMAIS pour un succès). SEULE
// tolérance : un slug du registre ABSENT de /collections n'est pas une erreur (le
// served set est, par définition, ce qui est servi) ; il est listé dans
// missing-zone-collections.txt.
//
// RUNNER KUBECTL-ONLY préservé : 0 kubectl, 0 cred S3/DB, seulement fetch sur l'API
// publique + npm. Pagination par `limit`/`offset` CALCULÉS ici (on ne suit PAS les
// liens `next` : l'API les rend en http:// derrière la terminaison TLS).
// =============================================================================
import { createHash } from "node:crypto";
import console from "node:console";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── constantes du contrat ────────────────────────────────────────────────────
export const CYCLE_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
export const BUILDER_PACKAGE = "@sentropic/geo";
export const BUILDER_VERSION = "0.6.2";
export const SERVED_IDS_SCOPE = "zones";
export const ZONE_COLLECTION_PREFIX = "qc-zonage-";
export const NORMS_COLLECTION_PREFIX = "qc-zonage-norms-";
export const ZONE_ID_PREFIX = "ogc:zones:";
export const IDS_FILE = "served-ids.txt";
export const SHA_FILE = `${IDS_FILE}.sha256`;
export const META_FILE = "served-ids.meta.json";
export const MISSING_FILE = "missing-zone-collections.txt";
export const CYCLE_LEG_FILE = "cycle-leg-geo.json";
export const LEG_REPO = "rhanka/geo";
export const LEG_WORKFLOW = "bascule-preprod.yml";
export const DEFAULT_API_URL = "https://api.preprod.geo.sent-tech.ca";
export const DEFAULT_REGISTRY = "packages/qc-sources/src/geo/municipalities.qc.json";
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_PAGE_LIMIT = 10000; // plafond MAX_LIMIT de geo-api
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

// ── sortie (jamais de secret : il n'y en a aucun ici) ────────────────────────
const log = (msg) => console.log(`[served-ids] ${msg}`);
const warn = (msg) => console.log(`::warning title=served-ids::${msg}`);
const die = (msg) => {
  console.log(`::error title=served-ids failed::${msg}`);
  process.exit(1);
};

// =============================================================================
// CYCLE_ID + noms d'artefacts — fonctions PURES
// =============================================================================
export function isValidCycleId(value) {
  return typeof value === "string" && CYCLE_ID_PATTERN.test(value);
}

function assertCycleId(cycleId) {
  if (!isValidCycleId(cycleId)) {
    throw new Error(`CYCLE_ID invalide ${JSON.stringify(cycleId)} : attendu ${CYCLE_ID_PATTERN}`);
  }
}

export function servedIdsArtifactName(cycleId) {
  assertCycleId(cycleId);
  return `geo-served-canonical-ids-${cycleId}`;
}

export function cycleLegArtifactName(cycleId) {
  assertCycleId(cycleId);
  return `cycle-leg-geo-${cycleId}`;
}

// =============================================================================
// Ordre d'octets (LC_ALL=C) + sha256 + format de ligne — fonctions PURES
// =============================================================================
export function byteCompare(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Ligne compatible `sha256sum -c` (deux espaces, mode texte). */
export function sha256FileLine(hex, name = IDS_FILE) {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error(`sha256 invalide : ${hex}`);
  return `${hex}  ${name}\n`;
}

export function parseSha256File(text) {
  const first = String(text ?? "").split("\n")[0].trim();
  const m = /^([a-f0-9]{64})(?:\s+\*?\S.*)?$/.exec(first);
  if (!m) throw new Error("fichier .sha256 illisible (attendu `<64 hex>  <nom>`)");
  return m[1];
}

/**
 * Garde de SORTIE du builder publié : non vide, chaque id `ogc:zones:<slug>:<code>`
 * sans blanc, strictement croissant en ordre d'octets (⇒ trié ET dédupliqué).
 */
export function assertServedZoneIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("résultat vide : aucun id de zone servi (fail-closed)");
  const shape = /^ogc:zones:[a-z0-9][a-z0-9-]*:\S+$/;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== "string" || !shape.test(id)) throw new Error(`id hors format à l'index ${i} : ${JSON.stringify(id)}`);
    if (i > 0 && byteCompare(ids[i - 1], id) >= 0) {
      throw new Error(`ids non triés en ordre d'octets ou dupliqués à l'index ${i} : ${JSON.stringify(ids[i - 1])} ≥ ${JSON.stringify(id)}`);
    }
  }
}

/** La sérialisation du builder doit être EXACTEMENT 1 id par ligne + LF final. */
export function assertSerialization(ids, text) {
  const expected = ids.length === 0 ? "" : `${ids.join("\n")}\n`;
  if (text !== expected) throw new Error("sérialisation du builder inattendue (attendu 1 id par ligne, LF final)");
}

// =============================================================================
// Registre + sélection des collections — fonctions PURES
// =============================================================================
export function parseRegistrySlugs(json) {
  if (!Array.isArray(json) || json.length === 0) throw new Error("registre vide ou non tableau");
  const seen = new Set();
  for (const entry of json) {
    const slug = entry?.slug;
    if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) throw new Error(`slug de registre invalide : ${JSON.stringify(slug)}`);
    if (seen.has(slug)) throw new Error(`slug de registre dupliqué : ${slug}`);
    seen.add(slug);
  }
  return [...seen].sort(byteCompare);
}

export function collectionIdsOf(body) {
  const arr = Array.isArray(body?.collections) ? body.collections : [];
  return arr.map((c) => c?.id).filter((x) => typeof x === "string" && x !== "");
}

/**
 * Sélection normative : `qc-zonage-<slug>` avec slug ∈ registre. Un slug du
 * registre sans collection servie → `missing` (TOLÉRÉ, listé). Tout autre
 * `qc-zonage-*` est exclu et compté (norms / hors registre).
 */
export function selectZoneCollections(collectionIds, registrySlugs) {
  const served = new Set(collectionIds);
  const registry = new Set(registrySlugs);
  const sortedSlugs = [...registry].sort(byteCompare);
  const selected = sortedSlugs
    .filter((slug) => served.has(`${ZONE_COLLECTION_PREFIX}${slug}`))
    .map((slug) => ({ id: `${ZONE_COLLECTION_PREFIX}${slug}`, slug }));
  const missing = sortedSlugs.filter((slug) => !served.has(`${ZONE_COLLECTION_PREFIX}${slug}`));
  const zonage = [...served].filter((id) => id.startsWith(ZONE_COLLECTION_PREFIX)).sort(byteCompare);
  const excludedNorms = zonage.filter((id) => id.startsWith(NORMS_COLLECTION_PREFIX));
  const excludedUnregistered = zonage.filter(
    (id) => !id.startsWith(NORMS_COLLECTION_PREFIX) && !registry.has(id.slice(ZONE_COLLECTION_PREFIX.length)),
  );
  return { selected, missing, excludedNorms, excludedUnregistered };
}

// =============================================================================
// Pagination OGC (limit/offset calculés) — fonctions PURES + lecteur injectable
// =============================================================================
export function itemsUrl(base, id, limit, offset) {
  return `${String(base).replace(/\/+$/, "")}/collections/${encodeURIComponent(id)}/items?limit=${limit}&offset=${offset}`;
}

/** Contrôle d'une page items ; lève sur toute incohérence (jamais « au mieux »). */
export function checkItemsPage(body, { id, offset, expectedMatched }) {
  if (body === null || typeof body !== "object" || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    throw new Error(`${id} offset=${offset} : réponse non FeatureCollection`);
  }
  const { numberMatched, numberReturned } = body;
  if (!Number.isInteger(numberMatched) || numberMatched < 0) throw new Error(`${id} offset=${offset} : numberMatched invalide (${numberMatched})`);
  if (!Number.isInteger(numberReturned) || numberReturned !== body.features.length) {
    throw new Error(`${id} offset=${offset} : numberReturned (${numberReturned}) ≠ features.length (${body.features.length})`);
  }
  if (expectedMatched !== undefined && numberMatched !== expectedMatched) {
    throw new Error(`${id} offset=${offset} : numberMatched a changé pendant la lecture (${expectedMatched} → ${numberMatched})`);
  }
  if (offset < numberMatched && numberReturned === 0) throw new Error(`${id} offset=${offset} : page vide avant la fin (${numberMatched}) — aucune progression`);
  if (offset + numberReturned > numberMatched) throw new Error(`${id} offset=${offset} : dépassement (${offset}+${numberReturned} > ${numberMatched})`);
  return { features: body.features, numberMatched, numberReturned };
}

export function isAbsentZoneCode(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** Lit TOUTES les features d'une collection et rend les `zone_code` bruts. */
export async function readZoneCollection(getJson, base, id, { limit = DEFAULT_PAGE_LIMIT } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`limit invalide : ${limit}`);
  const zoneCodes = [];
  let offset = 0;
  let expectedMatched;
  let pages = 0;
  let absent = 0;
  for (;;) {
    const page = checkItemsPage(await getJson(itemsUrl(base, id, limit, offset)), { id, offset, expectedMatched });
    pages += 1;
    expectedMatched = page.numberMatched;
    for (const feature of page.features) {
      const code = feature?.properties?.zone_code;
      if (isAbsentZoneCode(code)) absent += 1;
      zoneCodes.push(code);
    }
    offset += page.numberReturned;
    if (offset >= page.numberMatched) break;
  }
  return { zoneCodes, features: zoneCodes.length, numberMatched: expectedMatched, pages, zoneCodeAbsent: absent };
}

// =============================================================================
// HTTP fail-closed (retry borné sur transitoires) + parallélisme borné
// =============================================================================
export function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

export async function getJsonWithRetry(url, { fetchImpl = globalThis.fetch, attempts = 3, timeoutMs = 120000, sleep = defaultSleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { headers: { Accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      lastError = new Error(`GET ${url} : erreur réseau (${error?.message ?? error})`);
      if (attempt < attempts) { await sleep(attempt * 2000); continue; }
      throw lastError;
    }
    if (!res.ok) {
      lastError = new Error(`GET ${url} : HTTP ${res.status}`);
      if (isRetryableStatus(res.status) && attempt < attempts) { await sleep(attempt * 2000); continue; }
      throw lastError;
    }
    let text;
    try {
      text = await res.text();
      return JSON.parse(text);
    } catch (error) {
      lastError = new Error(`GET ${url} : corps illisible ou non JSON (${error?.message ?? error})`);
      if (attempt < attempts) { await sleep(attempt * 2000); continue; }
      throw lastError;
    }
  }
  throw lastError ?? new Error(`GET ${url} : échec`);
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** map à parallélisme borné, ordre préservé ; au 1er échec, plus rien n'est lancé. */
export async function mapLimit(items, limit, fn) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`concurrence invalide : ${limit}`);
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// =============================================================================
// Builder PUBLIÉ @sentropic/geo@<BUILDER_VERSION> (installé hors workspace)
// =============================================================================
export function resolveBuilderEntry(builderDir, expectedVersion = BUILDER_VERSION) {
  const pkgDir = join(builderDir, "node_modules", "@sentropic", "geo");
  const pkgPath = join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`builder introuvable (${pkgPath}) : npm install --prefix <dir> ${BUILDER_PACKAGE}@${expectedVersion}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.name !== BUILDER_PACKAGE) throw new Error(`paquet inattendu : ${pkg.name} (attendu ${BUILDER_PACKAGE})`);
  if (pkg.version !== expectedVersion) throw new Error(`version du builder ${pkg.version} ≠ version épinglée ${expectedVersion}`);
  const entry = pkg.exports?.["."]?.import;
  if (typeof entry !== "string" || entry === "") throw new Error(`${BUILDER_PACKAGE} sans exports["."].import`);
  return { entryPath: join(pkgDir, entry), version: pkg.version };
}

export async function loadBuilder(builderDir, expectedVersion = BUILDER_VERSION) {
  const { entryPath, version } = resolveBuilderEntry(builderDir, expectedVersion);
  const mod = await import(pathToFileURL(entryPath).href);
  if (typeof mod.buildServedCanonicalIds !== "function" || typeof mod.serializeServedCanonicalIds !== "function") {
    throw new Error(`${BUILDER_PACKAGE}@${version} n'exporte pas buildServedCanonicalIds/serializeServedCanonicalIds`);
  }
  return { build: mod.buildServedCanonicalIds, serialize: mod.serializeServedCanonicalIds, version };
}

// =============================================================================
// Orchestration `build` — injectable (getJson, builder) → testable sans réseau
// =============================================================================
export async function buildServedZoneIds({ apiUrl, registrySlugs, getJson, builder, concurrency = DEFAULT_CONCURRENCY, pageLimit = DEFAULT_PAGE_LIMIT, onCollection = () => {} }) {
  const base = String(apiUrl).replace(/\/+$/, "");
  const collectionIds = collectionIdsOf(await getJson(`${base}/collections`));
  if (collectionIds.length === 0) throw new Error("/collections vide ou illisible (fail-closed)");
  const selection = selectZoneCollections(collectionIds, registrySlugs);
  if (selection.selected.length === 0) throw new Error("aucune collection qc-zonage-<slug du registre> servie (fail-closed)");

  const perCollection = await mapLimit(selection.selected, concurrency, async ({ id, slug }) => {
    const read = await readZoneCollection(getJson, base, id, { limit: pageLimit });
    const idsForCollection = builder.build({ zones: read.zoneCodes.map((zoneCode) => ({ citySlug: slug, zoneCode })) });
    const summary = { id, slug, features: read.features, pages: read.pages, zone_code_absent: read.zoneCodeAbsent, ids: idsForCollection.length };
    onCollection(summary);
    return { ...summary, zoneCodes: read.zoneCodes };
  });

  const zones = perCollection.flatMap((c) => c.zoneCodes.map((zoneCode) => ({ citySlug: c.slug, zoneCode })));
  const ids = builder.build({ zones });
  assertServedZoneIds(ids);
  const text = builder.serialize(ids);
  assertSerialization(ids, text);
  const collections = perCollection.map(({ zoneCodes, ...summary }) => summary);
  return {
    ids,
    text,
    sha256: sha256Hex(text),
    selection,
    collections,
    counts: {
      api_collections: collectionIds.length,
      zone_collections_read: collections.length,
      registry_slugs: registrySlugs.length,
      registry_slugs_without_zone_collection: selection.missing.length,
      excluded_norms_collections: selection.excludedNorms.length,
      excluded_unregistered_qc_zonage_collections: selection.excludedUnregistered.length,
      pages: collections.reduce((s, c) => s + c.pages, 0),
      features: zones.length,
      features_zone_code_absent: collections.reduce((s, c) => s + c.zone_code_absent, 0),
      ids: ids.length,
      ids_bytes: Buffer.byteLength(text, "utf8"),
    },
  };
}

/** Écrit les 4 fichiers de l'artefact geo-served-canonical-ids-<CYCLE_ID>. */
export function writeServedIdsArtifact(outDir, result, meta) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, IDS_FILE), result.text);
  writeFileSync(join(outDir, SHA_FILE), sha256FileLine(result.sha256, IDS_FILE));
  const missing = result.selection.missing;
  writeFileSync(join(outDir, MISSING_FILE), missing.length ? `${missing.map((s) => `${ZONE_COLLECTION_PREFIX}${s}`).join("\n")}\n` : "");
  writeFileSync(join(outDir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
}

// =============================================================================
// cycle-leg — rapport `legs.geo` (0 kubectl, 0 cred) — fonctions PURES
// =============================================================================
/** needs.<job>.result → success|failure|pending. cancelled/skipped ⇒ failure ;
 *  vide/inconnu (jamais observé en fin de `needs`) ⇒ pending. */
export function mapJobResult(result) {
  switch (String(result ?? "").trim()) {
    case "success":
      return "success";
    case "failure":
    case "cancelled":
    case "skipped":
      return "failure";
    default:
      return "pending";
  }
}

/** T1.txt (jambe pg) → ISO 8601 UTC ou null si absent/illisible. */
export function parseT1(text) {
  const t = String(text ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(t)) return null;
  return Number.isFinite(Date.parse(t)) ? t : null;
}

export function shortSha(sha) {
  const s = String(sha ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(s)) throw new Error(`sha de commit invalide : ${JSON.stringify(sha)}`);
  return s.slice(0, 7);
}

/** Sous-branche `legs.geo` du schéma partagé (ordre des clés figé). */
export function buildGeoLeg({ cycleId, runId, gitSha, t1, pgResult, s3Result, servedIdsSha256, repo = LEG_REPO, workflow = LEG_WORKFLOW }) {
  if (!/^\d+$/.test(String(runId ?? ""))) throw new Error(`run_id invalide : ${JSON.stringify(runId)}`);
  if (servedIdsSha256 !== null && servedIdsSha256 !== undefined && !/^[a-f0-9]{64}$/.test(servedIdsSha256)) {
    throw new Error(`served_ids_sha256 invalide : ${servedIdsSha256}`);
  }
  return {
    repo,
    workflow,
    run_id: String(runId),
    sha_main: shortSha(gitSha),
    t1: t1 ?? null,
    verdict: { pg: mapJobResult(pgResult), s3: mapJobResult(s3Result) },
    served_ids_artifact: servedIdsArtifactName(cycleId),
    served_ids_sha256: servedIdsSha256 ?? null,
    served_ids_scope: SERVED_IDS_SCOPE,
  };
}

/** sha de l'artefact served-ids téléchargé : null s'il est absent ; RECALCULÉ sur
 *  served-ids.txt et comparé au .sha256 (artefact incohérent ⇒ erreur). */
export function readServedIdsSha(dir) {
  const shaPath = join(dir, SHA_FILE);
  const idsPath = join(dir, IDS_FILE);
  if (!existsSync(shaPath) && !existsSync(idsPath)) return null;
  if (!existsSync(shaPath) || !existsSync(idsPath)) throw new Error(`artefact served-ids incomplet dans ${dir} (${IDS_FILE} + ${SHA_FILE} attendus)`);
  const declared = parseSha256File(readFileSync(shaPath, "utf8"));
  const actual = sha256Hex(readFileSync(idsPath));
  if (declared !== actual) throw new Error(`sha256 incohérent : ${SHA_FILE}=${declared} ≠ sha256(${IDS_FILE})=${actual}`);
  return actual;
}

// =============================================================================
// CLI
// =============================================================================
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`argument inattendu : ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`valeur manquante pour ${a}`);
    out[a.slice(2)] = v;
    i++;
  }
  return out;
}

const envOr = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

function intEnv(name, fallback, min, max) {
  const n = Number(envOr(name, String(fallback)));
  if (!Number.isInteger(n) || n < min || n > max) die(`${name} invalide : attendu un entier ${min}..${max}`);
  return n;
}

function cmdValidateCycleId(args) {
  const value = args[0] ?? envOr("CYCLE_ID", "");
  if (!isValidCycleId(value)) die(`CYCLE_ID invalide ${JSON.stringify(value)} : attendu ${CYCLE_ID_PATTERN} (rien n'a été exécuté).`);
  log(`CYCLE_ID OK — '${value}' → artefacts ${servedIdsArtifactName(value)}, ${cycleLegArtifactName(value)}`);
}

async function cmdBuild(argv) {
  const args = parseArgs(argv);
  const builderDir = args["builder-dir"];
  const outDir = args.out;
  if (!builderDir || !outDir) die("usage : build --builder-dir <dir npm> --out <dir artefact>");
  const cycleId = envOr("CYCLE_ID", "");
  if (cycleId !== "" && !isValidCycleId(cycleId)) die(`CYCLE_ID invalide ${JSON.stringify(cycleId)}`);
  const apiUrl = envOr("PREPROD_API_URL", DEFAULT_API_URL).replace(/\/+$/, "");
  const concurrency = intEnv("SERVED_IDS_CONCURRENCY", DEFAULT_CONCURRENCY, 1, 8);
  const pageLimit = intEnv("SERVED_IDS_PAGE_LIMIT", DEFAULT_PAGE_LIMIT, 1, DEFAULT_PAGE_LIMIT);
  const timeoutMs = intEnv("SERVED_IDS_HTTP_TIMEOUT_SEC", 120, 5, 900) * 1000;

  // 1. Builder publié (AVANT tout réseau : un builder absent échoue sans requête).
  let builder;
  try { builder = await loadBuilder(builderDir, BUILDER_VERSION); } catch (e) { die(`builder : ${e.message}`); }
  log(`builder ${BUILDER_PACKAGE}@${builder.version} (publié, ${builderDir})`);

  // 2. Registre committé des municipalités (univers normatif).
  const registryRel = envOr("SERVED_IDS_REGISTRY", DEFAULT_REGISTRY);
  const registryPath = resolve(REPO_ROOT, registryRel);
  let registrySlugs;
  let registrySha;
  try {
    const bytes = readFileSync(registryPath);
    registrySha = sha256Hex(bytes);
    registrySlugs = parseRegistrySlugs(JSON.parse(bytes.toString("utf8")));
  } catch (e) { die(`registre ${registryRel} : ${e.message}`); }
  log(`registre ${registryRel} : ${registrySlugs.length} slugs (sha256 ${registrySha})`);

  // 3. Lecture API publique + builder.
  const t0 = Date.now();
  let done = 0;
  const getJson = (url) => getJsonWithRetry(url, { timeoutMs });
  let result;
  try {
    result = await buildServedZoneIds({
      apiUrl, registrySlugs, getJson, builder, concurrency, pageLimit,
      onCollection: () => { done += 1; if (done % 100 === 0) log(`… ${done} collections lues (${Math.round((Date.now() - t0) / 1000)} s)`); },
    });
  } catch (e) { die(`served ids : ${e.message}`); }
  const durationMs = Date.now() - t0;

  const meta = {
    schema: "geo-served-canonical-ids-meta/v1",
    scope: SERVED_IDS_SCOPE,
    scope_note: "zones seules (arbitrage i-cond) ; lots à venir via un endpoint geo-api /join-keys",
    cycle_id: cycleId || null,
    generated_at: new Date().toISOString(),
    duration_ms: durationMs,
    api_url: apiUrl,
    builder: { package: BUILDER_PACKAGE, version: builder.version, source: "npm (publié)", functions: ["buildServedCanonicalIds", "serializeServedCanonicalIds"] },
    registry: { path: registryRel, sha256: registrySha, city_count: registrySlugs.length },
    selection_rule: "qc-zonage-<slug>, slug ∈ registre ; exclus : qc-zonage-norms-*, qc-zonage-* hors registre (couches thématiques, variantes de slug)",
    zone_property: "feature.properties.zone_code",
    id_format: "ogc:zones:<city_slug>:<canonicalizeZoneCodeForJoin(zone_code)>",
    missing_policy: "slug du registre absent de /collections = toléré, listé dans missing-zone-collections.txt ; collection servie illisible = échec",
    ids_file: IDS_FILE,
    ids_sha256: result.sha256,
    counts: result.counts,
    missing_zone_collections: result.selection.missing.map((s) => `${ZONE_COLLECTION_PREFIX}${s}`),
    excluded_unregistered_qc_zonage_collections: result.selection.excludedUnregistered,
    collections_read: result.collections,
  };
  try { writeServedIdsArtifact(outDir, result, meta); } catch (e) { die(`écriture de l'artefact : ${e.message}`); }
  if (result.selection.missing.length) warn(`${result.selection.missing.length} slug(s) du registre sans collection qc-zonage servie (listés dans ${MISSING_FILE}, tolérés).`);
  log(`OK — ${result.counts.ids} ids zones / ${result.counts.zone_collections_read} collections / ${result.counts.features} features / ${result.counts.pages} pages en ${Math.round(durationMs / 1000)} s`);
  log(`sha256(${IDS_FILE}) = ${result.sha256}  → ${outDir}`);
}

function cmdCycleLeg(argv) {
  const args = parseArgs(argv);
  const out = args.out;
  if (!out) die("usage : cycle-leg --out <fichier> [--pg-dir <dir T1.txt>] [--served-dir <dir artefact served-ids>]");
  const cycleId = envOr("CYCLE_ID", "");
  if (!isValidCycleId(cycleId)) die(`CYCLE_ID invalide ${JSON.stringify(cycleId)}`);

  let t1 = null;
  const t1Path = args["pg-dir"] ? join(args["pg-dir"], "T1.txt") : null;
  if (t1Path && existsSync(t1Path)) {
    t1 = parseT1(readFileSync(t1Path, "utf8"));
    if (t1 === null) warn(`T1.txt présent mais illisible (${t1Path}) → t1=null`);
  } else {
    log("pointeurs pg (T1.txt) absents → t1=null (DRY, jambe pg en échec avant S1, ou artefact non produit)");
  }

  let servedSha = null;
  if (args["served-dir"]) {
    try { servedSha = readServedIdsSha(args["served-dir"]); } catch (e) { die(`artefact served-ids : ${e.message}`); }
  }
  if (servedSha === null) log("artefact served-ids absent → served_ids_sha256=null (verdict s3 rapporté tel quel)");

  let leg;
  try {
    leg = buildGeoLeg({
      cycleId,
      runId: envOr("GITHUB_RUN_ID", ""),
      gitSha: envOr("GITHUB_SHA", ""),
      repo: envOr("GITHUB_REPOSITORY", LEG_REPO),
      t1,
      pgResult: envOr("PG_RESULT", ""),
      s3Result: envOr("S3_RESULT", ""),
      servedIdsSha256: servedSha,
    });
  } catch (e) { die(`legs.geo : ${e.message}`); }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(leg, null, 2)}\n`);
  log(`legs.geo écrit → ${out}`);
  console.log(JSON.stringify(leg, null, 2));
}

const COMMANDS = {
  "validate-cycle-id": cmdValidateCycleId,
  "builder-version": () => console.log(BUILDER_VERSION),
  build: cmdBuild,
  "cycle-leg": cmdCycleLeg,
};

async function main() {
  const cmd = process.argv[2];
  const isHelp = !cmd || cmd === "-h" || cmd === "--help";
  if (isHelp || !COMMANDS[cmd]) {
    console.log(
      "usage: node served-ids.mjs <validate-cycle-id [id]|builder-version|build|cycle-leg>\n" +
        "  validate-cycle-id : CYCLE_ID (env ou argument) ∈ ^[A-Za-z0-9._-]{1,100}$, sinon exit 1.\n" +
        `  builder-version   : version épinglée du builder publié (${BUILDER_PACKAGE}@${BUILDER_VERSION}).\n` +
        "  build --builder-dir <dir> --out <dir> : ids ZONES servis (API publique PREPROD_API_URL, 0 cred).\n" +
        "    env : CYCLE_ID, PREPROD_API_URL, SERVED_IDS_CONCURRENCY (4), SERVED_IDS_PAGE_LIMIT (10000),\n" +
        "          SERVED_IDS_HTTP_TIMEOUT_SEC (120), SERVED_IDS_REGISTRY (registre committé).\n" +
        "  cycle-leg --out <fichier> [--pg-dir <dir>] [--served-dir <dir>] : legs.geo (rapport seul).\n" +
        "    env : CYCLE_ID, PG_RESULT, S3_RESULT, GITHUB_RUN_ID, GITHUB_SHA, GITHUB_REPOSITORY.",
    );
    process.exit(isHelp ? 0 : 1);
  }
  await COMMANDS[cmd](process.argv.slice(3));
}

const invokedDirectly = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedDirectly) {
  main().catch((e) => die(e?.message ?? String(e)));
}
