/**
 * zones-geocentralis-replace.ts — REMPLACEMENT sûr d'une collection qc-zonage
 * SERVIE par la couche WFS geocentralis EN VIGUEUR (siadmin_pzon_99_s ou autre),
 * avec BACKUP non-destructif, DOUBLE-LAYOUT (plate + sous-dossier si présent),
 * preuve géométrique v2 (putServedZoneGeojson) et GATE DE RECOUPEMENT des codes
 * ACTUELLEMENT SERVIS.
 *
 * POURQUOI un runner dédié (et pas `zones-wfs-run.ts --deposit`) :
 *   `zones-wfs-run.ts` dépose la SEULE clé plate, SANS sauvegarde, et ne vérifie
 *   pas que la nouvelle couche RECOUPE les codes déjà servis. Un REMPLACEMENT de
 *   collection déjà servie exige (a) un backup non-destructif AVANT tout écrasement,
 *   (b) l'écriture des DEUX layouts si geo-api sert le sous-dossier
 *   (mémoire fold-double-key-s3-serving), (c) une preuve que la géométrie de
 *   remplacement contient bien les zones qu'on remplaçait (anti-régression).
 *
 * Compose UNIQUEMENT des helpers committés :
 *   - gate anti-invention + spatial : zones-wfs-run.ts
 *   - preuve v2 : lib/zonage-proof.ts (proofFromFetched/attach/putServedZoneGeojson)
 *   - S3 : lib/s3.ts (exists, copyObject, getBytes)
 * Ne recalcule AUCUN fold lot↔zone (rôle de lot-zone-join-run / _lot-zone-refold-batch).
 *
 * GARDE-FOUS DURS (sinon ABORT, aucune écriture) :
 *   - validateWfsZoneCodes ok (≥3 codes distincts, champ réglementaire, non séquentiel)
 *   - porte spatiale : centre bbox ≤ max(--spatial-km,35) du centroïde registre
 *   - RECOUPEMENT : chaque code ACTUELLEMENT SERVI (canonicalisé, séparateur-insensible)
 *     doit être présent dans les nouveaux codes ; sinon ABORT.
 *
 * --inspect (défaut) : n'écrit RIEN — valide + imprime layout servi et recoupement.
 * --deposit : backup (chaque layout existant) → putServedZoneGeojson plate
 *             (+ sous-dossier SI il existait déjà) → readback des octets déposés.
 *
 * Usage :
 *   npx tsx acquisition/src/zones-geocentralis-replace.ts --pair saint-frederic=27065 \
 *     --wfs-layer evb:siadmin_pzon_99_s --zone-field etiquette_1 --inspect
 *   npx tsx acquisition/src/zones-geocentralis-replace.ts --pair saint-frederic=27065 \
 *     --wfs-layer evb:siadmin_pzon_99_s --zone-field etiquette_1 --deposit
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, exists, copyObject, getBytes } from "./lib/s3.js";
import { attachGeometryProof, proofFromFetched, putServedZoneGeojson } from "./lib/zonage-proof.js";
import {
  buildGetFeatureUrl,
  featuresBboxCenter,
  haversineKm,
  normalizeWfsFeatures,
  validateWfsZoneCodes,
  type GeoFeature,
  type MuniEntry,
  type WfsConfig,
} from "./zones-wfs-run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MUNIS_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const HTTP_UA = "sentropic-geo/0.1";
const HTTP_TIMEOUT_MS = 30_000;
const MAX_FEATURES = 20_000;
const PAGE = 1000;

const DEFAULT_WFS_BASE = "https://geoserver.geocentralis.com/geoserver/ows";
const DEFAULT_MUNI_FIELD = "id_municipalite";

interface GeoFC { type?: string; features?: GeoFeature[]; proof?: { schema_version?: unknown; geometry_source?: { sha256?: unknown } } }

interface Args {
  slug: string;
  code: string;
  cfg: WfsConfig;
  spatialKm: number;
  deposit: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const pair = (get("pair") ?? "").trim();
  const [slug, code] = pair.split("=").map((s) => (s ?? "").trim());
  if (!slug || !/^\d{4,5}$/.test(code ?? "")) {
    console.error("usage: --pair slug=code (code = id_municipalite MAMH 4-5 chiffres) --wfs-layer <t> --zone-field <f> [--inspect|--deposit]");
    process.exit(2);
  }
  const layer = get("wfs-layer");
  const zoneField = get("zone-field");
  if (!layer || !zoneField) { console.error("--wfs-layer et --zone-field sont requis (pas de défaut : la couche/champ doivent être explicites)"); process.exit(2); }
  return {
    slug: slug!,
    code: code!,
    cfg: { base: get("wfs-base") ?? DEFAULT_WFS_BASE, layer, zoneField, muniField: get("muni-field") ?? DEFAULT_MUNI_FIELD },
    spatialKm: Number(get("spatial-km") ?? 25),
    deposit: has("deposit") && !has("inspect"),
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
      const transient = /ETIMEDOUT|ECONNRESET|EAI_AGAIN|EPIPE|socket hang up|timeout|TimeoutError|NetworkingError|aborted/i.test(msg);
      if (!transient || a === tries) throw e;
      console.error(`  RETRY(${a}/${tries}) ${label}: ${msg}`);
      await sleep(1500 * a);
    }
  }
  throw last;
}

async function fetchJson<T = unknown>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": HTTP_UA, accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return JSON.parse(await r.text()) as T;
  } finally { clearTimeout(t); }
}

/** Page through every feature of one muni via WFS startIndex/count (with retry). */
async function fetchAll(cfg: WfsConfig, code: string): Promise<GeoFeature[]> {
  const out: GeoFeature[] = [];
  let start = 0;
  while (out.length < MAX_FEATURES) {
    const url = buildGetFeatureUrl(cfg, code, start, PAGE);
    const fc = await withRetry(`GetFeature start=${start}`, () => fetchJson<GeoFC>(url));
    if (!fc || !Array.isArray(fc.features) || fc.features.length === 0) break;
    out.push(...fc.features);
    if (fc.features.length < PAGE) break;
    start += fc.features.length;
    await sleep(120);
  }
  return out;
}

/** Canonicalisation séparateur-insensible pour comparer des codes de zone. */
function canon(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function distinctZoneCodes(features: GeoFeature[]): { raw: Set<string>; canon: Set<string> } {
  const raw = new Set<string>();
  const c = new Set<string>();
  for (const f of features) {
    const p = f.properties ?? {};
    const v = p["zone_code"] ?? p["code_zone"] ?? p["ZONE_CODE"] ?? p["CODE_ZONE"];
    if (v !== null && v !== undefined && String(v).trim()) { raw.add(String(v).trim()); c.add(canon(v)); }
  }
  return { raw, canon: c };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
}

async function readServed(s3: S3Client, key: string): Promise<GeoFeature[] | null> {
  if (!(await withRetry(`exists ${key}`, () => exists(s3, key)))) return null;
  const buf = await withRetry(`get ${key}`, () => getBytes(s3, key));
  const fc = JSON.parse(buf.toString("utf8")) as GeoFC;
  return Array.isArray(fc.features) ? fc.features : [];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { slug, code, cfg, spatialKm } = args;
  const munis = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as MuniEntry[];
  const muni = munis.find((m) => m.slug === slug);
  const s3 = s3Client();

  console.error(`[replace] slug=${slug} id_municipalite=${code} layer=${cfg.layer} field=${cfg.zoneField} mode=${args.deposit ? "DEPOSIT" : "INSPECT"}`);

  // ── 1. Fetch + gate anti-invention ──────────────────────────────────────────
  const raw = await fetchAll(cfg, code);
  if (raw.length === 0) { console.error(`ABORT: 0 feature pour ${cfg.muniField}=${code}`); process.exit(1); }
  const verdict = validateWfsZoneCodes(raw, cfg.zoneField);
  if (!verdict.ok) {
    console.error(`ABORT (anti-invention): ${verdict.reason} — distinct=${verdict.stats.distinct} sample=${JSON.stringify(verdict.stats.sample.slice(0, 6))}`);
    process.exit(1);
  }
  const layerUrl = `${cfg.base}#${cfg.layer}[${cfg.muniField}=${code}]`;
  const norm = normalizeWfsFeatures(raw, cfg.zoneField, layerUrl);
  const newCodes = distinctZoneCodes(norm);
  console.error(`[replace] fetched=${raw.length} features, zone_code distinct=${newCodes.raw.size} codeLike=${(verdict.stats.codeLikeRatio * 100).toFixed(0)}%`);
  console.error(`[replace] codes: ${[...newCodes.raw].sort().join(", ")}`);

  // ── 2. Porte spatiale ───────────────────────────────────────────────────────
  if (muni) {
    const c = featuresBboxCenter(norm);
    if (c.n > 0) {
      const d = haversineKm(muni.lat, muni.lon, c.lat, c.lon);
      if (d > Math.max(spatialKm, 35)) { console.error(`ABORT (spatial): features à ${d.toFixed(0)}km du centroïde registre ${slug}`); process.exit(1); }
      console.error(`[replace] spatial OK: ${d.toFixed(1)}km du centroïde registre`);
    }
  } else {
    console.error(`[replace] WARN: slug ${slug} absent du registre municipalities.qc.json — porte spatiale non appliquée`);
  }

  // ── 3. Layout servi + gate de recoupement ───────────────────────────────────
  const flatKey = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const subKey = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const flatServed = await readServed(s3, flatKey);
  const subServed = await readServed(s3, subKey);
  const servedSource = flatServed ?? subServed;
  console.error(`[replace] layout servi: plate=${flatServed ? `${flatServed.length} feat` : "ABSENT"} sous-dossier=${subServed ? `${subServed.length} feat` : "ABSENT"}`);
  if (!servedSource) { console.error(`ABORT: aucune géométrie qc-zonage-${slug} servie (ni plate ni sous-dossier) — ce runner REMPLACE, il ne crée pas`); process.exit(1); }

  const served = distinctZoneCodes(servedSource);
  const covered = [...served.canon].filter((c) => newCodes.canon.has(c));
  const uncovered = [...served.raw].filter((r) => !newCodes.canon.has(canon(r)));
  console.error(`[replace] codes servis (${served.raw.size}): ${[...served.raw].sort().join(", ")}`);
  console.error(`[replace] RECOUPEMENT: ${covered.length}/${served.canon.size} codes servis présents dans la nouvelle couche`);
  if (uncovered.length > 0) {
    console.error(`ABORT (recoupement): ${uncovered.length} code(s) servi(s) ABSENT(s) de la nouvelle couche: ${uncovered.sort().join(", ")}`);
    console.error(`  → la couche geocentralis ne recoupe pas les codes servis ; AUCUN dépôt (garde-fou dur).`);
    process.exit(1);
  }

  if (!args.deposit) {
    console.error(`\n=== INSPECT OK (aucune écriture) ===`);
    console.error(`  nouvelle couche: ${norm.length} features, ${newCodes.raw.size} codes distincts, recoupement ${covered.length}/${served.canon.size} des servis`);
    console.error(`  dépôt écrirait: plate=OUI${subServed ? " + sous-dossier=OUI" : " (sous-dossier ABSENT → non écrit)"}`);
    return;
  }

  // ── 4. Backup non-destructif de chaque layout existant ───────────────────────
  const ts = stamp();
  const backups: string[] = [];
  for (const [layout, key, present] of [["flat", flatKey, !!flatServed] as const, ["subdir", subKey, !!subServed] as const]) {
    if (!present) continue;
    const dest = `${S3_PREFIX}_replaced/qc-zonage-${slug}__${layout}.${ts}.geojson`;
    await withRetry(`backup ${key}`, () => copyObject(s3, key, dest));
    backups.push(dest);
    console.error(`[replace] BACKUP ${key} -> s3://${dest}`);
  }

  // ── 5. Dépôt v2 (plate toujours ; sous-dossier si présent) ───────────────────
  const proof = proofFromFetched({ url: buildGetFeatureUrl(cfg, code, 0, PAGE), type: "wfs", method: "natif", reliability: "directe", bytes: JSON.stringify(raw) });
  const targets: string[] = [flatKey];
  if (subServed) targets.push(subKey);
  for (const key of targets) {
    const fc = attachGeometryProof({ type: "FeatureCollection" as const, features: norm }, proof);
    await withRetry(`put ${key}`, () => putServedZoneGeojson(s3, key, fc));
    console.error(`[replace] DÉPÔT v2 -> s3://${key}`);
  }

  // ── 6. Readback des octets déposés ──────────────────────────────────────────
  for (const key of targets) {
    const buf = await withRetry(`readback ${key}`, () => getBytes(s3, key));
    const fc = JSON.parse(buf.toString("utf8")) as GeoFC;
    const rb = distinctZoneCodes(fc.features ?? []);
    const okProof = fc.proof?.schema_version === "2.0" && typeof fc.proof?.geometry_source?.sha256 === "string";
    console.error(`[replace] READBACK ${key}: features=${(fc.features ?? []).length} distinct=${rb.raw.size} proof_v2=${okProof ? "OUI" : "NON"} sha=${String(fc.proof?.geometry_source?.sha256 ?? "?").slice(0, 23)}…`);
  }

  console.error(`\n=== DÉPÔT TERMINÉ ===`);
  console.error(`  backups: ${backups.map((b) => `s3://${b}`).join("  ")}`);
  console.error(`  déposé:  ${targets.map((k) => `s3://${k}`).join("  ")}`);
  console.error(`  proof:   url=${proof.url}`);
  console.error(`  sha256:  ${proof.sha256}`);
  console.error(`  retrieved_at=${proof.retrieved_at}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
