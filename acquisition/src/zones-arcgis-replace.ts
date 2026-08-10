/**
 * zones-arcgis-replace.ts — REMPLACEMENT sûr d'une collection qc-zonage SERVIE
 * par une couche ArcGIS FeatureServer EN VIGUEUR, avec BACKUP
 * non-destructif, DOUBLE-LAYOUT (plate + sous-dossier si présents), preuve
 * géométrique v2 (putServedZoneGeojson, type=arcgis / method=natif / reliability=directe)
 * et GATE DE RECOUPEMENT des codes ACTUELLEMENT SERVIS (UNION plate ∪ sous-dossier).
 *
 * Jumeau ArcGIS de zones-geocentralis-replace.ts (qui est WFS-only) et de
 * zones-arcgis-serve.ts (qui, lui, CRÉE une nouvelle collection et REFUSE
 * d'écraser). Ici la collection est déjà servie : un REMPLACEMENT exige
 *   (a) un backup non-destructif AVANT tout écrasement (chaque layout existant),
 *   (b) l'écriture des DEUX layouts si geo-api sert le sous-dossier
 *       (mémoire fold-double-key-s3-serving : geo-api résout le sous-dossier),
 *   (c) une preuve que la géométrie de remplacement contient bien TOUS les codes
 *       actuellement servis (anti-régression : recoupement de l'UNION des layouts).
 *
 * Compose UNIQUEMENT des helpers committés :
 *   - preuve v2 : lib/zonage-proof.ts (proofFromFetched / attach / putServedZoneGeojson)
 *   - S3 : lib/s3.ts (exists, copyObject, getBytes)
 * Ne recalcule AUCUN fold lot↔zone (rôle de lot-zone-join-run / lots-enriched-run).
 *
 * GARDE-FOUS DURS (sinon ABORT, aucune écriture) :
 *   - anti-invention : ≥3 codes distincts, ≥50% des codes lettrés, ≤80% entiers purs,
 *     maxLen ≤24, nullRatio ≤0.5 (mêmes seuils que zones-arcgis-serve.ts).
 *   - porte spatiale : centre bbox ≤ --km du centroïde registre ET muni la plus
 *     proche == slug cible.
 *   - RECOUPEMENT : chaque code servi (canon, séparateur-insensible), UNION des
 *     layouts plate+sous-dossier, doit être présent dans les nouveaux codes.
 *     EXCEPTION : --allow-deprecated <csv> lève le gate UNIQUEMENT sur les codes
 *     listés (dépréciations réelles du plan en vigueur — ex. zones fusionnées/
 *     subdivisées) ; les autres codes servis absents restent BLOQUANTS. Les codes
 *     abandonnés sont journalisés ; leurs lots sont réassignés par re-fold SPATIAL.
 *   - COUVERTURE : nb de features de la nouvelle couche ≥ max(nb servi par layout).
 *   - REMPLACE, ne CRÉE pas : au moins un layout servi doit exister.
 *
 * --inspect (défaut) : n'écrit RIEN — valide les gates + imprime layout servi et recoupement.
 * --deposit : backup (chaque layout existant) → putServedZoneGeojson (layouts existants)
 *             → readback des octets déposés.
 *
 * Retry ETIMEDOUT sur chaque appel réseau/S3. Aucun secret loggé.
 *
 * Usage :
 *   npx tsx acquisition/src/zones-arcgis-replace.ts --slug saint-leon-de-standon \
 *     --layer https://services6.arcgis.com/.../FeatureServer/0 --zone-field no_zone \
 *     --where "mun_nom='Saint-Léon-de-Standon'" --inspect
 *   npx tsx acquisition/src/zones-arcgis-replace.ts --slug mont-saint-hilaire \
 *     --layer https://services5.arcgis.com/.../FeatureServer/6 --zone-field Numero_Zon --deposit
 *
 * `--where` est une clause SQL ArcGIS complète. Une apostrophe dans une valeur
 * SQL se double (`mun_nom='L''Ange-Gardien'`) ; elle est ensuite encodée dans
 * l'URL appelée et dans la preuve v2. Un dépôt est refusé si ce filtre produit
 * plusieurs pages : aucune URL unique ne pourrait alors restituer les octets
 * hachés dans `proof.geometry_source`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import {
  capturedFetch,
  capturedText,
  CapturedFetchError,
  type CaptureManifestLine,
  type CaptureRun,
} from "../../packages/qc-sources/src/capture/index.js";
import { CAPTURE_USER_AGENT, openCaptureRun } from "./lib/capture-s3.js";
import { buildArcGisGeoJsonQueryUrl, normalizeArcGisWhere } from "./lib/arcgis-query.js";
import { s3Client, copyObject, getBytes } from "./lib/s3.js";
import { reapplyServedZonageEnrichment } from "./lib/reapply-zonage-enrichment.js";
import { attachGeometryProof, carryForwardServedZoneProperties, proofFromCaptureEntry, putServedZoneAdditive, putServedZoneGeojson } from "./lib/zonage-proof.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REG = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const UA = CAPTURE_USER_AGENT;
const MAX_FEATURES = 20_000;
const PAGE = 1000;
/** `<source>` de la clé CAS : identifiant de lane-source, JAMAIS un slug (SPEC §2.1). */
const CAPTURE_SOURCE = "zones-arcgis";

interface MuniEntry { slug: string; name: string; lat: number; lon: number }
interface GeoFeature { type: "Feature"; geometry: { type?: string; coordinates?: unknown } | null; properties: Record<string, unknown> }
interface GeoFC { type?: string; features?: GeoFeature[]; proof?: { schema_version?: unknown; geometry_source?: { sha256?: unknown } } }

interface Args { slug: string; layer: string; zoneField: string; zonePrefixField?: string; where: string; km: number; deposit: boolean; allowDeprecated: string[] }

/**
 * Abort from inside the async runner without bypassing its `catch`/`finally`
 * closure.  `process.exit()` would tear down an open CaptureRun before its
 * manifest, run log and run.json are durably finalized.
 */
export function abort(message: string): never {
  console.error(message);
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const slug = get("slug"); const layer = get("layer"); const zoneField = get("zone-field");
  if (!slug || !layer || !zoneField) {
    abort("usage: --slug <s> --layer <FeatureServer/N> --zone-field <field> [--where <clause>] [--zone-prefix-field <f>] [--km 8] [--allow-deprecated A-16,C-6] [--inspect|--deposit]");
  }
  const rawWhere = get("where");
  if (has("where") && (rawWhere === undefined || rawWhere.startsWith("--"))) {
    abort("ABORT arguments: --where requiert une clause non vide");
  }
  let where: string;
  try { where = normalizeArcGisWhere(rawWhere); }
  catch (e) {
    abort(`ABORT arguments: ${e instanceof Error ? e.message : String(e)}`);
  }
  const zonePrefixField = get("zone-prefix-field");
  const allowDeprecatedRaw = get("allow-deprecated");
  const allowDeprecated = allowDeprecatedRaw ? allowDeprecatedRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return {
    slug, layer, zoneField, where,
    ...(zonePrefixField ? { zonePrefixField } : {}),
    km: Number(get("km") ?? 8),
    deposit: has("deposit") && !has("inspect"),
    allowDeprecated,
  };
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** Rejoue une opération sur erreur réseau transitoire (ETIMEDOUT & co). */
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let a = 1; a <= tries; a++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      const transient = /ETIMEDOUT|ECONNRESET|EAI_AGAIN|EPIPE|socket hang up|timeout|TimeoutError|NetworkingError|aborted|fetch failed/i.test(msg);
      if (!transient || a === tries) throw e;
      console.error(`  RETRY(${a}/${tries}) ${label}: ${msg}`);
      await sleep(1500 * a);
    }
  }
  throw last;
}

/**
 * CHOKEPOINT DE CAPTURE (SPEC_CAPTURE_ON_CLUSTER.md §5.1, règle C-0) : plus aucun
 * `fetch()` nu ici. Chaque tentative — succès, 404, timeout — produit une ligne de
 * `capture/_runs/<run-id>/manifest.jsonl`, et les octets reçus partent en
 * content-addressed sous `raw/zones-arcgis/cas/<sha256>.json`. C'est cette ligne,
 * et elle seule, qui fait la preuve v2 plus bas.
 */
async function jget(
  run: CaptureRun,
  u: string,
  slug: string,
  attempt: number,
  ms = 30000,
): Promise<{ fc: GeoFC; line: CaptureManifestLine }> {
  const res = await capturedFetch(u, { headers: { "User-Agent": UA, Accept: "application/json" } }, {
    run,
    source: CAPTURE_SOURCE,
    slugs: [slug],
    attempt,
    timeoutMs: ms,
    version: "zones-arcgis-replace/1",
  });
  if (!res.ok) throw new CapturedFetchError(res.line);
  return { fc: JSON.parse(capturedText(res)) as GeoFC, line: res.line };
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, dLat = (bLat - aLat) * Math.PI / 180, dLon = (bLon - aLon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function* positions(c: unknown): Generator<[number, number]> {
  if (!Array.isArray(c)) return;
  if (c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") { yield [c[0], c[1]]; return; }
  for (const x of c) yield* positions(x);
}

async function fetchAll(
  run: CaptureRun,
  slug: string,
  layer: string,
  fields: string[],
  where: string,
): Promise<{ feats: GeoFeature[]; entries: CaptureManifestLine[] }> {
  const feats: GeoFeature[] = []; const entries: CaptureManifestLine[] = []; let offset = 0;
  while (feats.length < MAX_FEATURES) {
    const u = buildArcGisGeoJsonQueryUrl(layer, fields, { where, resultOffset: offset, resultRecordCount: PAGE });
    let attempt = 0;
    const r = await withRetry(`GetFeature offset=${offset}`, () => { attempt += 1; return jget(run, u, slug, attempt); });
    entries.push(r.line);
    const fs = r.fc.features ?? [];
    if (fs.length === 0) break;
    feats.push(...fs); offset += fs.length;
    if (fs.length < PAGE) break;
    await sleep(120);
  }
  return { feats, entries };
}

function zoneCode(props: Record<string, unknown> | undefined, zoneField: string, zonePrefixField?: string): string | null {
  const raw = props?.[zoneField];
  if (raw == null || raw === "") return null;
  const code = String(raw).trim();
  if (!code) return null;
  const prefixRaw = zonePrefixField ? props?.[zonePrefixField] : null;
  const prefix = prefixRaw == null ? "" : String(prefixRaw).trim();
  return prefix ? `${prefix}-${code}` : code;
}

/** Canonicalisation séparateur-insensible pour comparer des codes de zone. */
function canon(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function distinctCodesOf(feats: GeoFeature[]): { raw: Set<string>; canon: Set<string> } {
  const raw = new Set<string>(); const c = new Set<string>();
  for (const f of feats) {
    const p = f.properties ?? {};
    const v = p["zone_code"] ?? p["code_zone"] ?? p["ZONE_CODE"] ?? p["CODE_ZONE"];
    if (v !== null && v !== undefined && String(v).trim()) { raw.add(String(v).trim()); c.add(canon(v)); }
  }
  return { raw, canon: c };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
}

/** Keep every currently served property for the same zone before the central
 * schema-loss gate checks the replacement. Fresh source attributes still win;
 * the existing enrichment is then refreshed by the committed folds. */
function freshFeaturesWithServedProperties(norm: GeoFeature[], current: GeoFeature[]): { features: GeoFeature[]; matched: number; unmatched: number } {
  const features = norm.map((feature) => ({ ...feature, properties: { ...(feature.properties ?? {}) } }));
  const carried = carryForwardServedZoneProperties(features, current, canon);
  return { features, ...carried };
}

async function readServed(s3: S3Client, key: string): Promise<GeoFeature[] | null> {
  try {
    // A HEAD followed by GET doubled the S3 round trips at the identity gate.
    // GET is authoritative for both existence and the bytes we must compare;
    // a true 404 is the only absence accepted here.
    const buf = await withRetry(`get ${key}`, () => getBytes(s3, key));
    const fc = JSON.parse(buf.toString("utf8")) as GeoFC;
    return Array.isArray(fc.features) ? fc.features : [];
  } catch (error) {
    const detail = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
    if (detail?.name === "NotFound" || detail?.name === "NoSuchKey" || detail?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

/** Le run de capture courant (clôturé par `main`, y compris en ABORT). */
let CAPTURE: CaptureRun | null = null;

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const reg = JSON.parse(readFileSync(REG, "utf8")) as MuniEntry[];
  const muni = reg.find((m) => m.slug === a.slug);
  if (!muni) abort(`ABORT: slug "${a.slug}" absent du registre`);
  const s3 = s3Client();
  const fields = [a.zoneField, ...(a.zonePrefixField ? [a.zonePrefixField] : [])];

  // ── 0. Ouverture du run de capture (journalise MÊME en --inspect) ───────────
  const run = openCaptureRun({ lane: "zones", s3 });
  CAPTURE = run;
  console.error(`[arcgis-replace] slug=${a.slug} layer=${a.layer} field=${a.zoneField} where=${JSON.stringify(a.where)} mode=${a.deposit ? "DEPOSIT" : "INSPECT"}`);
  console.error(`[arcgis-replace] capture run=${run.runId} manifest=s3://${run.keys.manifest}`);
  run.log(`[arcgis-replace] slug=${a.slug} layer=${a.layer} field=${a.zoneField} mode=${a.deposit ? "DEPOSIT" : "INSPECT"}`);

  // ── 1. Fetch ArcGIS (via le chokepoint) ─────────────────────────────────────
  const { feats: rawFeats, entries: captureEntries } = await fetchAll(run, a.slug, a.layer, fields, a.where);
  if (rawFeats.length === 0) abort("ABORT: 0 feature téléchargée");

  // schéma serving (zone_code EXPLICITE, jamais deviné)
  const norm: GeoFeature[] = rawFeats.map((f) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: { zone_code: zoneCode(f.properties, a.zoneField, a.zonePrefixField), kind: null, affectation: null, num_zone: null, source: a.layer, confidence: "arcgis-zone-vector" },
  }));
  const newCodes = distinctCodesOf(norm);

  // ── 2. Gate anti-invention (mêmes seuils que zones-arcgis-serve.ts) ──────────
  const codes = [...newCodes.raw]; // distinct suffit pour lettre/entier/len
  const codesAll = norm.map((f) => f.properties["zone_code"]).filter((v): v is string => typeof v === "string" && v !== "");
  const withLetter = codesAll.filter((s) => /[A-Za-z]/.test(s)).length;
  const pureInt = codesAll.filter((s) => /^\d+$/.test(s)).length;
  const maxLen = Math.max(...codesAll.map((s) => s.length));
  const nullRatio = 1 - codesAll.length / norm.length;
  console.error(`[arcgis-replace] feats=${norm.length} nonnull=${codesAll.length} distinct=${newCodes.raw.size} withLetter=${(withLetter / codesAll.length).toFixed(2)} pureInt=${(pureInt / codesAll.length).toFixed(2)} maxLen=${maxLen} nullRatio=${nullRatio.toFixed(2)}`);
  console.error(`[arcgis-replace] codes (${codes.length}): ${codes.sort().join(", ")}`);
  if (newCodes.raw.size < 3) abort("ABORT anti-invention: <3 codes distincts");
  if (withLetter / codesAll.length < 0.5) abort("ABORT anti-invention: <50% des codes lettrés");
  if (pureInt / codesAll.length > 0.8) abort("ABORT anti-invention: >80% entiers purs (id séquentiel ?)");
  if (maxLen > 24) abort(`ABORT anti-invention: code trop long (maxLen=${maxLen})`);
  if (nullRatio > 0.5) abort(`ABORT anti-invention: trop de null (${nullRatio.toFixed(2)})`);

  // ── 3. Porte spatiale ───────────────────────────────────────────────────────
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
  for (const f of norm) for (const [x, y] of positions(f.geometry?.coordinates)) { if (!Number.isFinite(x) || !Number.isFinite(y)) continue; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); n++; }
  if (n === 0) abort("ABORT: aucune position géométrique");
  const cLon = (minx + maxx) / 2, cLat = (miny + maxy) / 2;
  const distKm = haversineKm(cLat, cLon, muni.lat, muni.lon);
  const nearest = reg.map((m) => ({ m, d: haversineKm(cLat, cLon, m.lat, m.lon) })).sort((x, y) => x.d - y.d)[0]!;
  console.error(`[arcgis-replace] bbox centre=[${cLat.toFixed(4)},${cLon.toFixed(4)}] dist(${a.slug})=${distKm.toFixed(2)}km nearest=${nearest.m.slug}@${nearest.d.toFixed(2)}km`);
  if (distKm > a.km) abort(`ABORT spatial: ${distKm.toFixed(2)}km > ${a.km}km`);
  if (nearest.m.slug !== a.slug) abort(`ABORT spatial: muni la plus proche = ${nearest.m.slug} ≠ ${a.slug}`);

  // ── 4. Layout servi + gate de recoupement (UNION plate ∪ sous-dossier) ──────
  const flatKey = `${S3_PREFIX}qc-zonage-${a.slug}.geojson`;
  const subKey = `${S3_PREFIX}qc-zonage-${a.slug}/qc-zonage-${a.slug}.geojson`;
  // The two layouts are independent S3 objects.  Read them concurrently: a
  // slow legacy shadow lookup must not delay the identity gate for the active
  // layout, and both results are still required before any decision or write.
  const [flatServed, subServed] = await Promise.all([
    readServed(s3, flatKey),
    readServed(s3, subKey),
  ]);
  console.error(`[arcgis-replace] layout servi: plate=${flatServed ? `${flatServed.length} feat` : "ABSENT"} sous-dossier=${subServed ? `${subServed.length} feat` : "ABSENT"}`);
  if (!flatServed && !subServed) abort(`ABORT: aucune géométrie qc-zonage-${a.slug} servie — ce runner REMPLACE, il ne CRÉE pas`);

  const servedRaw = new Set<string>(); const servedCanon = new Set<string>();
  let maxServed = 0;
  for (const feats of [flatServed, subServed]) {
    if (!feats) continue;
    maxServed = Math.max(maxServed, feats.length);
    const d = distinctCodesOf(feats);
    for (const r of d.raw) servedRaw.add(r);
    for (const c of d.canon) servedCanon.add(c);
  }
  const flatCanon = flatServed ? distinctCodesOf(flatServed).canon : new Set<string>();
  const subCanon = subServed ? distinctCodesOf(subServed).canon : new Set<string>();
  const covered = [...servedCanon].filter((c) => newCodes.canon.has(c));
  const uncovered = [...servedRaw].filter((r) => !newCodes.canon.has(canon(r)));
  console.error(`[arcgis-replace] codes servis UNION (${servedRaw.size}): ${[...servedRaw].sort().join(", ")}`);
  console.error(`[arcgis-replace] RECOUPEMENT: ${covered.length}/${servedCanon.size} codes servis présents dans la nouvelle couche`);

  // --allow-deprecated : lève le gate UNIQUEMENT sur les codes servis listés (canon).
  // Les autres codes servis absents restent BLOQUANTS. Journalise chaque abandon.
  const deprecatedCanon = new Set(a.allowDeprecated.map(canon));
  const abandoned = uncovered.filter((r) => deprecatedCanon.has(canon(r)));
  const blocking = uncovered.filter((r) => !deprecatedCanon.has(canon(r)));
  // Codes passés à --allow-deprecated mais qui NE sont PAS abandonnés (présents dans
  // la nouvelle couche, ou absents des servis) : signalés comme no-op, pas d'abandon.
  const requestedButPresent = a.allowDeprecated.filter((r) => newCodes.canon.has(canon(r)));
  const requestedNotServed = a.allowDeprecated.filter((r) => !servedCanon.has(canon(r)) && !newCodes.canon.has(canon(r)));
  if (abandoned.length > 0) {
    console.error(`[arcgis-replace] DÉPRÉCIATION AUTORISÉE (--allow-deprecated) — ${abandoned.length} code(s) servi(s) ABANDONNÉ(s) (les lots seront réassignés par re-fold spatial) :`);
    for (const u of abandoned.sort()) {
      const c = canon(u);
      const where = [flatCanon.has(c) ? "plate" : null, subCanon.has(c) ? "SOUS-DOSSIER(servi)" : null].filter(Boolean).join("+") || "?";
      console.error(`  ABANDON(déprécié) ${u}  (était servi dans: ${where})`);
    }
  }
  if (requestedButPresent.length > 0) console.error(`[arcgis-replace] --allow-deprecated NO-OP (encore présents dans la nouvelle couche, non abandonnés): ${requestedButPresent.sort().join(", ")}`);
  if (requestedNotServed.length > 0) console.error(`[arcgis-replace] --allow-deprecated NO-OP (ni servis ni présents): ${requestedNotServed.sort().join(", ")}`);
  if (blocking.length > 0) {
    for (const u of blocking.sort()) {
      const c = canon(u);
      const where = [flatCanon.has(c) ? "plate" : null, subCanon.has(c) ? "SOUS-DOSSIER(servi)" : null].filter(Boolean).join("+") || "?";
      console.error(`  UNCOVERED ${u}  (présent dans: ${where})`);
    }
    console.error(`ABORT (recoupement): ${blocking.length} code(s) servi(s) ABSENT(s) de la nouvelle couche ET non listé(s) --allow-deprecated: ${blocking.sort().join(", ")}`);
    console.error(`  → la couche ArcGIS ne recoupe pas ces codes servis ; AUCUN dépôt (garde-fou dur).`);
    abort("ABORT recoupement: code servi absent de la couche de remplacement");
  }
  if (norm.length < maxServed) {
    console.error(`ABORT (couverture): nouvelle couche ${norm.length} features < max servi ${maxServed} — couverture insuffisante.`);
    abort(`ABORT (couverture): nouvelle couche ${norm.length} features < max servi ${maxServed} — couverture insuffisante.`);
  }

  // Une preuve v2 doit pointer sur l'URL QUI A RENDU les octets hachés. Une
  // agrégation paginée n'a pas d'URL source unique : refuser avant tout backup.
  if (captureEntries.length !== 1) {
    console.error(`ABORT preuve v2 exacte: ${captureEntries.length} pages capturées; aucune URL unique ne restitue les octets agrégés (aucun dépôt).`);
    abort(`ABORT preuve v2 exacte: ${captureEntries.length} pages capturées; aucune URL unique ne restitue les octets agrégés (aucun dépôt).`);
  }
  const soleEntry = captureEntries[0]!;
  const exactCaptureUrl = buildArcGisGeoJsonQueryUrl(a.layer, fields, { where: a.where, resultOffset: 0, resultRecordCount: PAGE });
  if (soleEntry.url !== exactCaptureUrl) {
    console.error(`ABORT preuve v2 exacte: URL de capture inattendue; refus de hasher des octets sous une autre URL.`);
    abort("ABORT preuve v2 exacte: URL de capture inattendue; refus de hasher des octets sous une autre URL.");
  }
  const proof = proofFromCaptureEntry(soleEntry, { type: "arcgis", method: "natif", reliability: "directe" });
  console.error(`[arcgis-replace] PREUVE = entrée de capture exacte (run=${run.runId}, url=${proof.url}, cas=s3://${soleEntry.storage_key})`);

  if (!a.deposit) {
    console.error(`\n=== INSPECT OK (aucune écriture servie) ===`);
    console.error(`  nouvelle couche: ${norm.length} features, ${newCodes.raw.size} codes distincts`);
    console.error(`  recoupement ${covered.length}/${servedCanon.size} des servis, couverture ${norm.length} ≥ ${maxServed}`);
    console.error(`  dépôt écrirait: plate=${flatServed ? "OUI" : "non"} sous-dossier=${subServed ? "OUI" : "non"}`);
    console.error(`  CAPTURE: ${captureEntries.length} ligne(s) -> s3://${run.keys.manifest}`);
    for (const e of captureEntries) console.error(`    ${e.http_status} ${e.bytes}B ${e.sha256} -> s3://${e.storage_key}`);
    return;
  }

  // ── 5. Backup non-destructif de chaque layout existant ───────────────────────
  const ts = stamp();
  const backups: string[] = [];
  for (const [layout, key, present] of [["flat", flatKey, !!flatServed] as const, ["subdir", subKey, !!subServed] as const]) {
    if (!present) continue;
    const dest = `${S3_PREFIX}_replaced/qc-zonage-${a.slug}__${layout}.${ts}.geojson`;
    await withRetry(`backup ${key}`, () => copyObject(s3, key, dest));
    backups.push(dest);
    console.error(`[arcgis-replace] BACKUP ${key} -> s3://${dest}`);
  }

  // ── 6. Dépôt v2 (layouts existants uniquement : REMPLACE, ne crée pas) ───────
  // PREUVE ADOSSÉE À LA CAPTURE (règle C-1) : la porte précédente garantit
  // qu'une seule entrée de manifeste fournit l'URL, l'instant et le sha256.
  const targets: Array<{ key: string; current: GeoFeature[] }> = [];
  if (flatServed) targets.push({ key: flatKey, current: flatServed });
  if (subServed) targets.push({ key: subKey, current: subServed });
  for (const target of targets) {
    const carried = freshFeaturesWithServedProperties(norm, target.current);
    const fc = attachGeometryProof({ type: "FeatureCollection" as const, features: carried.features }, proof);
    console.error(`[arcgis-replace] PROPRIÉTÉS reportées ${target.key}: zones appariées=${carried.matched}/${norm.length} non-appariées=${carried.unmatched}`);
    await withRetry(`put ${target.key}`, () => putServedZoneGeojson(s3, target.key, fc as never));
    console.error(`[arcgis-replace] DÉPÔT v2 -> s3://${target.key}`);
  }

  // ── 7. Readback des octets déposés ──────────────────────────────────────────
  for (const { key } of targets) {
    const buf = await withRetry(`readback ${key}`, () => getBytes(s3, key));
    const fc = JSON.parse(buf.toString("utf8")) as GeoFC;
    const rb = distinctCodesOf(fc.features ?? []);
    const okProof = fc.proof?.schema_version === "2.0" && typeof fc.proof?.geometry_source?.sha256 === "string";
    console.error(`[arcgis-replace] READBACK ${key}: features=${(fc.features ?? []).length} distinct=${rb.raw.size} proof_v2=${okProof ? "OUI" : "NON"} sha=${String(fc.proof?.geometry_source?.sha256 ?? "?").slice(0, 23)}…`);
  }

  // ── 8. Re-fold additif — MÊME PASSE (atomicité) ─────────────────────────────
  await reapplyServedZonageEnrichment(a.slug);

  // ── 9. STAMP provenance additif — source exacte de la nouvelle géométrie ────
  // Un re-dépôt géométrie v2 (putServedZoneGeojson) EFFACE zone_source_url /
  // zone_source_level : il ne reporte pas le stamp additif. On les ré-écrit ICI,
  // dans la même passe, sur CHAQUE clé servie, via le chemin additif sûr — la
  // géométrie fraîchement déposée est prouvée octet-pour-octet inchangée par
  // putServedZoneAdditive (seules les 2 clés whitelistées peuvent différer).
  // Idempotent, et ne régresse pas la géométrie qui vient d'être posée.
  const zoneSourceUrl = proof.url;      // URL source v2 exacte (== proof.geometry_source.url)
  const zoneSourceLevel = "documented"; // source SIG officielle re-téléchargeable qui recoupe les codes servis
  for (const { key } of targets) {
    const buf = await withRetry(`get-for-stamp ${key}`, () => getBytes(s3, key));
    const fc = JSON.parse(buf.toString("utf8")) as { type?: unknown; features?: Array<{ geometry?: unknown; properties?: Record<string, unknown> | null }> };
    for (const f of fc.features ?? []) {
      f.properties = { ...(f.properties ?? {}), zone_source_url: zoneSourceUrl, zone_source_level: zoneSourceLevel };
    }
    const res = await withRetry(`stamp ${key}`, () => putServedZoneAdditive(s3, key, fc, { allowedProps: ["zone_source_url", "zone_source_level"] }));
    console.error(`[arcgis-replace] STAMP provenance url=${zoneSourceUrl} level=${zoneSourceLevel} key=${key} (features=${res.features})`);
  }

  console.error(`\n=== DÉPÔT TERMINÉ ===`);
  console.error(`  backups: ${backups.map((b) => `s3://${b}`).join("  ")}`);
  console.error(`  déposé:  ${targets.map(({ key }) => `s3://${key}`).join("  ")}`);
  console.error(`  provenance: url=${zoneSourceUrl} level=${zoneSourceLevel} (re-stampée sur ${targets.length} clé(s))`);
  if (abandoned.length > 0) console.error(`  déprécié(abandonné): ${abandoned.sort().join(", ")}  → réassignation par re-fold spatial`);
  console.error(`  proof:   url=${proof.url}`);
  console.error(`  sha256:  ${proof.sha256}`);
  console.error(`  retrieved_at=${proof.retrieved_at}`);
  console.error(`  capture: run=${run.runId} manifest=s3://${run.keys.manifest} (${captureEntries.length} ligne(s))`);
}

/** Clôture le run de capture (`run.json`) quel que soit le sort du runner. */
async function closeCapture(exitCode: number): Promise<void> {
  if (!CAPTURE) return;
  await CAPTURE.finish(exitCode);
}

/**
 * Execute the replacement and always finalize the CaptureRun before surfacing
 * the result.  Kept separate from the CLI boundary so every abort path is
 * testable without a live S3 client.
 */
export async function runWithCaptureFinalization<T>(
  runner: () => Promise<T>,
  finish: (exitCode: number) => Promise<void>,
): Promise<T> {
  let exitCode = 0;
  try {
    return await runner();
  } catch (error) {
    exitCode = 1;
    throw error;
  } finally {
    await finish(exitCode);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void runWithCaptureFinalization(main, closeCapture).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
