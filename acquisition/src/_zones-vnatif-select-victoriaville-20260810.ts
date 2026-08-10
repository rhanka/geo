/**
 * _zones-vnatif-select-victoriaville-20260810.ts — SÉLECTION + validation LIVE de
 * la worklist VICTORIAVILLE (les munis UPGRADABLE hébergés sur geo.victoriaville.ca).
 *
 * Plateforme : UNE couche ArcGIS MapServer PARTAGÉE — `IntranetMRC/ZonageMunicipal/
 * MapServer/3` sur `geo.victoriaville.ca` (publique, sans jeton, honore f=geojson) —
 * filtrée PAR MUNI via le champ `Code_mun`. Chaque muni du scoping porte le MÊME
 * zone_source_url (la couche partagée) ; la valeur `Code_mun` n'y figure PAS. On la
 * résout donc par le champ NOM `Municipalite` de la couche, mis en correspondance
 * avec le nom canonique du registre municipal (correspondance EXACTE unique, sinon SKIP).
 *
 * Forme de requête geojson (par muni) :
 *   <layer>/query?where=Code_mun='<code>'&outFields=*&f=geojson
 * Comptage source (numberMatched) :
 *   <layer>/query?where=Code_mun='<code>'&returnCountOnly=true&f=json → { count }
 *
 * L'URL rédigée dans la worklist est CANONICALISÉE via `new URL().toString()` (le `'`
 * devient `%27`) : c'est exactement la forme que le chokepoint de capture inscrit au
 * manifeste (`redactUrlForManifest` = `new URL(url).toString()`, aucun param secret ici),
 * donc `findLine(line.url===url)` du dépôt est byte-exact par construction.
 *
 * Read-only : lit le scoping (upgradable_list host=geo.victoriaville.ca), le registre
 * municipal (anti-homonyme par nom), et le servi S3 (codes déjà servis + preuve v2 ?).
 * Puis PROBE la source ArcGIS en direct AVANT inclusion :
 *   - Code_mun résolu de façon UNIQUE par nom (sinon SKIP ambigu/introuvable) ;
 *   - count query rend { count } > 0 et <= maxRecordCount (sinon tronquerait → SKIP) ;
 *   - f=geojson honoré (FeatureCollection non-vide) ;
 *   - ANTI-INVENTION du champ code-zone : parmi Disposition_spéciale / GROUPEUSAGE / Type
 *     etc., le champ qui REPRODUIT ≥90% des codes DÉJÀ SERVIS gagne. On DIAGNOSTIQUE
 *     l'overlap de CHAQUE champ candidat pour prouver que le vrai code-zone
 *     (`Disposition_spéciale`) l'emporte et qu'aucun champ d'affectation (`GROUPEUSAGE`)
 *     n'est capté par erreur. Inclus seulement si ≥1 champ non-vide atteint ≥90%.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-select-victoriaville-20260810.ts \
 *     --worklist-out work/coverage/zones-vnatif-capture-worklist-victoriaville-20260810.json \
 *     --diag-out work/coverage/_zones-vnatif-select-victoriaville-20260810.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = "geo.victoriaville.ca";
const SCOPING = "work/coverage/zones-v2-upgrade-scoping-20260810.json";
const S3_PREFIX = "normalized/ca-qc-zonage/";
const OVERLAP_MIN_PCT = 90;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MUNIS_PATH = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
// Champs jamais éligibles comme code-zone (géométrie / id / audit / admin-muni).
const TECHNICAL_EXCLUDE = new Set<string>([
  "OBJECTID", "OBJECTID1", "ID", "SHAPE", "SHAPELENGTH", "SHAPEAREA", "SHAPELENG",
  "ZONAGEMUNICIPALID", "GLOBALID", "DATEFME", "SHAPESTAREA", "SHAPESTLENGTH",
  "HYPERLIENGRILLEUSAGE", "CODEMUN", "NOMMUN", "MUN", "MUNICIPALITE",
]);

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function canonName(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function normName(s: string): string { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function canonUrl(raw: string): string { return new URL(raw).toString(); }
function isCodeLike(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return s.length > 0 && s.length <= 24 && /[A-Za-z0-9]/.test(s) && /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(s);
}

interface Scoped { slug: string; level: string; url_host: string; endpoint_class: string; zone_source_url: string }
function loadScoping(): Scoped[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, SCOPING), "utf8")) as { upgradable_list?: Scoped[] };
  return Array.isArray(raw.upgradable_list) ? raw.upgradable_list : [];
}
interface RegEntry { slug: string; name: string }
function loadRegistry(): RegEntry[] {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>).find(Array.isArray)) as Array<Record<string, unknown>>;
  return arr.map((m) => ({ slug: String(m["slug"] ?? ""), name: String(m["name"] ?? "") })).filter((m) => m.slug);
}

async function fetchJson(url: string, timeoutMs = 45_000): Promise<{ value: unknown; status: number | null; error: string | null }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-select-probe/1", accept: "application/json" } });
    if (!res.ok) return { value: null, status: res.status, error: `HTTP ${res.status}` };
    const text = await res.text();
    try { return { value: JSON.parse(text), status: res.status, error: null }; }
    catch { return { value: null, status: res.status, error: `réponse non-JSON (f=geojson non honoré ? len=${text.length}, head=${text.slice(0, 60).replace(/\s+/g, " ")})` }; }
  } catch (e) { return { value: null, status: null, error: (e as Error).message }; }
  finally { clearTimeout(t); }
}

interface Feat { properties?: Record<string, unknown> | null; geometry?: unknown }
function featureHasRealV2Proof(f: Feat): boolean {
  const p = (f.properties ?? {}) as { proof?: { geometry_source?: { sha256?: unknown; retrieved_at?: unknown } } | null };
  const gs = p.proof?.geometry_source;
  if (!gs) return false;
  const shaOk = typeof gs.sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(gs.sha256);
  const retrievedOk = typeof gs.retrieved_at === "string" && ISO_TS_RE.test(gs.retrieved_at) && !Number.isNaN(Date.parse(gs.retrieved_at));
  return shaOk && retrievedOk;
}
async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<{ keys: string[]; features: number; codes: Set<string>; levels: string[]; hasV2: boolean }> {
  const flat = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  const codes = new Set<string>(); const levels = new Set<string>();
  let features = 0; let hasV2 = false;
  for (const k of keys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { proof?: { schema_version?: unknown }; features?: Feat[] };
    if (fc.proof?.schema_version === "2.0") hasV2 = true;
    const feats = Array.isArray(fc.features) ? fc.features : [];
    features = Math.max(features, feats.length);
    for (const f of feats) {
      const p = f.properties ?? {};
      const c = canon(p["zone_code"]); if (c) codes.add(c);
      levels.add(typeof p["zone_source_level"] === "string" ? p["zone_source_level"] : "(none)");
      if (featureHasRealV2Proof(f)) hasV2 = true;
    }
  }
  return { keys, features, codes, levels: [...levels].sort(), hasV2 };
}

async function main(): Promise<void> {
  const worklistOut = arg("worklist-out");
  const diagOut = arg("diag-out");
  const scoping = loadScoping().filter((s) => s.url_host === HOST);
  const registry = loadRegistry();
  const regBySlug = new Map(registry.map((r) => [r.slug, r]));
  const s3 = s3Client();
  process.stderr.write(`[select-vv] upgradable host=${HOST} → ${scoping.length} candidats\n`);

  // 1. couche partagée : métadonnées (maxRecordCount) + énumération Code_mun ↔ Municipalite
  const base = "https://geo.victoriaville.ca/arcgis/rest/services/IntranetMRC/ZonageMunicipal/MapServer/3";
  const meta = (await fetchJson(`${base}?f=json`)).value as { maxRecordCount?: number; geometryType?: string } | null;
  const maxRecord = typeof meta?.maxRecordCount === "number" ? meta.maxRecordCount : null;
  const distinct = (await fetchJson(`${base}/query?where=1%3D1&outFields=Code_mun,Municipalite&returnDistinctValues=true&returnGeometry=false&f=json`)).value as { features?: Array<{ attributes?: Record<string, unknown> }> } | null;
  const byNorm = new Map<string, string[]>(); // normName(Municipalite) -> Code_mun[]
  for (const f of distinct?.features ?? []) {
    const code = String(f.attributes?.["Code_mun"] ?? "").trim();
    const muni = String(f.attributes?.["Municipalite"] ?? "").trim();
    if (!code || !muni) continue;
    const n = normName(muni);
    const arr = byNorm.get(n) ?? []; if (!arr.includes(code)) arr.push(code); byNorm.set(n, arr);
  }
  process.stderr.write(`[select-vv] couche partagée: maxRecordCount=${String(maxRecord)}, ${byNorm.size} noms de muni distincts\n`);

  const diag: Record<string, unknown>[] = [];
  const worklist: Array<{ slug: string; source: string; urls: string[] }> = [];
  for (const c of scoping) {
    const reg = regBySlug.get(c.slug);
    const d: Record<string, unknown> = { slug: c.slug, level: c.level, registry_name: reg?.name ?? null, shared_layer: base };
    if (!reg) { d.included = false; d.reason = "slug absent du registre municipal"; diag.push(d); process.stderr.write(`[select-vv] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }

    // 2. Résolution Code_mun par nom (correspondance EXACTE unique)
    const matches = byNorm.get(normName(reg.name)) ?? [];
    d.code_mun_candidates = matches;
    if (matches.length !== 1) { d.included = false; d.reason = `Code_mun non résolu de façon unique par nom (${matches.length} candidat(s) pour "${reg.name}") → ambigu/introuvable, SKIP`; diag.push(d); process.stderr.write(`[select-vv] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }
    const code = matches[0]!;
    d.code_mun = code;
    const geojsonUrl = canonUrl(`${base}/query?where=Code_mun='${code}'&outFields=*&f=geojson`);
    const countUrl = canonUrl(`${base}/query?where=Code_mun='${code}'&returnCountOnly=true&f=json`);
    d.geojson_url = geojsonUrl; d.count_url = countUrl;

    // 3. Servi (codes + preuve v2 ?)
    const served = await readServed(s3, c.slug);
    d.served_keys = served.keys; d.served_features = served.features; d.served_distinct_codes = served.codes.size; d.served_levels = served.levels; d.served_has_v2 = served.hasV2;
    if (served.keys.length === 0) { d.included = false; d.reason = "aucun servi (rien à upgrader)"; diag.push(d); process.stderr.write(`[select-vv] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }
    if (served.hasV2) { d.included = false; d.reason = "servi porte DÉJÀ une preuve v2 → hors périmètre upgrade"; diag.push(d); process.stderr.write(`[select-vv] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }

    // 4. count (numberMatched) + faisabilité anti-troncature
    const cnt = (await fetchJson(countUrl)).value as { count?: unknown; error?: unknown } | null;
    const count = typeof cnt?.count === "number" ? cnt.count : null;
    d.count = count;
    if (cnt && typeof cnt === "object" && "error" in cnt && cnt.error) { d.included = false; d.reason = `count query = objet d'erreur ArcGIS (${JSON.stringify(cnt.error).slice(0, 120)})`; diag.push(d); process.stderr.write(`[select-vv] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }
    if (count === null || count <= 0) { d.included = false; d.reason = `count query KO / numberMatched<=0 (${String(count)})`; diag.push(d); process.stderr.write(`[select-vv] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }
    if (maxRecord !== null && count > maxRecord) { d.included = false; d.reason = `count(${count}) > maxRecordCount(${maxRecord}) → capture mono-URL tronquerait, SKIP`; diag.push(d); process.stderr.write(`[select-vv] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }

    // 5. échantillon geojson complet (count<=maxRecord) → f=geojson honoré + overlap PAR CHAMP
    const sample = (await fetchJson(geojsonUrl)).value as { type?: unknown; features?: Feat[]; exceededTransferLimit?: unknown } | null;
    const feats = Array.isArray(sample?.features) ? sample!.features! : [];
    const isFC = sample?.type === "FeatureCollection";
    d.sample_is_featurecollection = isFC; d.sample_features = feats.length; d.exceeded_transfer_limit = sample?.exceededTransferLimit === true;
    if (!isFC || feats.length === 0) { d.included = false; d.reason = `f=geojson non honoré / échantillon vide (type=${String(sample?.type)})`; diag.push(d); process.stderr.write(`[select-vv] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }

    const keysAll = new Set<string>();
    for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keysAll.add(k);
    const fieldStats: Array<{ field: string; distinct: number; null_count: number; code_like_ratio: number; overlap_pct: number | null }> = [];
    for (const key of keysAll) {
      if (TECHNICAL_EXCLUDE.has(canonName(key))) continue;
      const dset = new Set<string>(); let nullCount = 0; let codeLike = 0; let nonNull = 0;
      for (const f of feats) {
        const raw = f.properties?.[key];
        const s = raw === null || raw === undefined ? "" : String(raw).trim();
        if (!s) { nullCount++; continue; }
        nonNull++; dset.add(canon(s)); if (isCodeLike(raw)) codeLike++;
      }
      const covered = served.codes.size > 0 ? [...served.codes].filter((x) => dset.has(x)).length : 0;
      const overlap = served.codes.size > 0 ? Math.round((covered / served.codes.size) * 1000) / 10 : null;
      fieldStats.push({ field: key, distinct: dset.size, null_count: nullCount, code_like_ratio: nonNull > 0 ? Math.round((codeLike / nonNull) * 100) / 100 : 0, overlap_pct: overlap });
    }
    fieldStats.sort((a, b) => (b.overlap_pct ?? -1) - (a.overlap_pct ?? -1) || b.distinct - a.distinct);
    d.field_overlaps = fieldStats;
    const eligible = fieldStats.filter((s) => s.null_count === 0 && s.distinct >= 3 && s.overlap_pct !== null && s.overlap_pct >= OVERLAP_MIN_PCT);
    d.resolved_code_field = eligible[0]?.field ?? null; d.resolved_overlap_pct = eligible[0]?.overlap_pct ?? null;
    if (eligible.length === 0) {
      d.included = false;
      d.reason = `aucun champ code-zone ne reproduit ≥${OVERLAP_MIN_PCT}% des codes servis sans valeur vide (top=${fieldStats.slice(0, 4).map((s) => `${s.field}:ov=${String(s.overlap_pct)}%,d=${s.distinct},null=${s.null_count}`).join(" | ")}) → ambigu, SKIP`;
      diag.push(d); process.stderr.write(`[select-vv] ${c.slug} → OUT (${String(d.reason)})\n`); continue;
    }

    d.included = true;
    worklist.push({ slug: c.slug, source: "zones-vnatif", urls: [geojsonUrl] });
    process.stderr.write(`[select-vv] ${c.slug} → IN (Code_mun=${code}, count=${count}, champ=${String(d.resolved_code_field)} overlap=${String(d.resolved_overlap_pct)}%)\n`);
    diag.push(d);
  }

  process.stderr.write(`[select-vv] worklist retenue = ${worklist.length}/${scoping.length}\n`);
  if (worklistOut) { writeFileSync(resolve(ROOT, worklistOut), `${JSON.stringify(worklist, null, 2)}\n`, "utf8"); process.stderr.write(`WORKLIST → ${worklistOut}\n`); }
  const record = { contract: "zones-vnatif-select-victoriaville/v1", date: "2026-08-10", host: HOST, platform: "arcgis-mapserver-shared-f-geojson-code-mun-filter", shared_layer: base, zone_code_field: "résolu-par-recouvrement (Disposition_spéciale attendu ; GROUPEUSAGE=affectation à ÉVITER)", candidates_total: scoping.length, selected: worklist.length, diag };
  if (diagOut) { writeFileSync(resolve(ROOT, diagOut), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`DIAG → ${diagOut}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
