/**
 * _zones-vnatif-select-altus-20260810.ts — SÉLECTION + validation LIVE de la
 * worklist ALTUS (les munis UPGRADABLE hébergés sur gis.altusquebec.com).
 *
 * Plateforme : ArcGIS MapServer `gis.altusquebec.com` qui HONORE `f=geojson`
 * (différent de la recette géoCentralis WFS). Chaque muni du scoping porte comme
 * zone_source_url une couche MapServer `.../MapServer/<n>`. La forme de requête
 * geojson est :
 *   <layer>/query?where=1=1&outFields=*&f=geojson
 * et le comptage source (numberMatched) via :
 *   <layer>/query?where=1=1&returnCountOnly=true&f=json   → { count }
 *
 * Read-only : ne lit QUE le scoping (upgradable_list). Puis PROBE la source ArcGIS
 * en direct pour confirmer, AVANT inclusion :
 *   - count query rend { count } > 0 (numberMatched>0) ;
 *   - la couche est polygonale et porte un champ `Zone` (code-zone altus, ex "A-123") ;
 *   - la requête f=geojson est réellement HONORÉE (JSON.parse d'un petit échantillon
 *     → FeatureCollection non-vide, champ `Zone` non-vide) — si le MapServer refuse
 *     f=geojson (HTML / objet d'erreur), le muni est SKIP (raison enregistrée, jamais forcé) ;
 *   - anti-troncature de faisabilité : count <= maxRecordCount (sinon la capture
 *     mono-URL tronquerait ; SKIP). L'anti-troncature dure (numberReturned==numberMatched)
 *     est ré-opposée au DÉPÔT sur les octets capturés + count live.
 *
 * L'URL rédigée dans la worklist est CANONICALISÉE via `new URL().toString()` : c'est
 * exactement la forme que le chokepoint de capture inscrit au manifeste
 * (`redactUrlForManifest` = `new URL(url).toString()`), donc `findLine(line.url===url)`
 * du dépôt est byte-exact par construction.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-select-altus-20260810.ts \
 *     --worklist-out work/coverage/zones-vnatif-capture-worklist-altus-20260810.json \
 *     --diag-out work/coverage/_zones-vnatif-select-altus-20260810.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = "gis.altusquebec.com";
const SCOPING = "work/coverage/zones-v2-upgrade-scoping-20260810.json";
// Le champ code-zone n'est PAS uniforme sur altus (vérifié LIVE) : gaspe/murdochville=`Zone`
// ("A-123"), les couches Num_Zone portent le code complet dans `Usage` ("15-RE"), les couches
// `Zonage` dans `Zonage` ("43-I"). La sélection ne FIGE donc pas le champ : elle confirme juste
// que la source rend du geojson exploitable avec ≥1 champ code-zone plausible ; le DÉPÔT résout
// le champ EXACT par recouvrement ≥90% avec les codes déjà servis (anti-invention, jamais deviné).
const TECHNICAL_EXCLUDE = new Set<string>([
  "OBJECTID", "OBJECTID_1", "ID", "SHAPE", "SHAPE_LENGTH", "SHAPE_AREA", "SHAPE_LENG",
  "CREATED_USER", "CREATED_DATE", "LAST_EDITED_USER", "LAST_EDITED_DATE", "NUM_FICHIER",
  "NO_CERTIFICAT", "NO_ILOT", "CODE_MUN", "NOM_MUN", "MUN", "NUMERO_REGLEMENT", "ADOPTE", "EN_VIGUEUR",
]);
function canonName(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function isCodeLike(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return s.length > 0 && s.length <= 24 && /[A-Za-z]/.test(s) && /[0-9]/.test(s) && /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(s);
}

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function canonUrl(raw: string): string { return new URL(raw).toString(); }

interface Scoped { slug: string; level: string; url_host: string; endpoint_class: string; zone_source_url: string }
function loadScoping(): Scoped[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, SCOPING), "utf8")) as { upgradable_list?: Scoped[] };
  return Array.isArray(raw.upgradable_list) ? raw.upgradable_list : [];
}

async function fetchJson(url: string, timeoutMs = 40_000): Promise<{ value: unknown; status: number | null; error: string | null }> {
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

async function main(): Promise<void> {
  const worklistOut = arg("worklist-out");
  const diagOut = arg("diag-out");
  const scoping = loadScoping();
  const candidates = scoping.filter((s) => s.url_host === HOST);
  process.stderr.write(`[select-altus] upgradable host=${HOST} → ${candidates.length} candidats\n`);

  const diag: Record<string, unknown>[] = [];
  const worklist: Array<{ slug: string; source: string; urls: string[] }> = [];
  for (const c of candidates) {
    const base = c.zone_source_url.replace(/\/+$/, "");
    const geojsonUrl = canonUrl(`${base}/query?where=1=1&outFields=*&f=geojson`);
    const countUrl = canonUrl(`${base}/query?where=1=1&returnCountOnly=true&f=json`);
    const metaUrl = canonUrl(`${base}?f=json`);
    const sampleUrl = canonUrl(`${base}/query?where=1=1&outFields=*&f=geojson&resultRecordCount=100`);
    const d: Record<string, unknown> = { slug: c.slug, level: c.level, endpoint_class: c.endpoint_class, base_layer_url: base, geojson_url: geojsonUrl, count_url: countUrl };

    // 1. count (numberMatched)
    const cnt = await fetchJson(countUrl);
    const count = (cnt.value as { count?: unknown } | null)?.count;
    d.count = typeof count === "number" ? count : null; d.count_status = cnt.status; d.count_error = cnt.error;
    if (typeof count !== "number" || count <= 0) {
      d.included = false; d.reason = `count query KO / numberMatched<=0 (${String(cnt.error ?? count)})`; diag.push(d);
      process.stderr.write(`[select-altus] ${c.slug} → OUT (${String(d.reason)})\n`); continue;
    }

    // 2. meta : polygone + maxRecordCount
    const meta = await fetchJson(metaUrl);
    const mv = meta.value as { geometryType?: unknown; maxRecordCount?: unknown; fields?: Array<{ name?: unknown; type?: unknown }> } | null;
    const geomType = typeof mv?.geometryType === "string" ? mv.geometryType : null;
    const maxRecord = typeof mv?.maxRecordCount === "number" ? mv.maxRecordCount : null;
    const fieldNames = Array.isArray(mv?.fields) ? mv!.fields.map((f) => String(f.name ?? "")) : [];
    d.geometry_type = geomType; d.max_record_count = maxRecord; d.field_names = fieldNames;
    if (!geomType || !/Polygon/i.test(geomType)) {
      d.included = false; d.reason = `couche non-polygonale (${String(geomType)})`; diag.push(d);
      process.stderr.write(`[select-altus] ${c.slug} → OUT (${String(d.reason)})\n`); continue;
    }
    if (maxRecord !== null && count > maxRecord) {
      d.included = false; d.reason = `count(${count}) > maxRecordCount(${maxRecord}) → capture mono-URL tronquerait, SKIP`; diag.push(d);
      process.stderr.write(`[select-altus] ${c.slug} → OUT (${String(d.reason)})\n`); continue;
    }

    // 3. échantillon geojson : f=geojson honoré + ≥1 champ code-zone plausible
    const sample = await fetchJson(sampleUrl);
    const sv = sample.value as { type?: unknown; features?: Array<{ properties?: Record<string, unknown> | null; geometry?: unknown }> } | null;
    const isFC = sv?.type === "FeatureCollection" && Array.isArray(sv?.features);
    d.sample_is_featurecollection = isFC; d.sample_features = Array.isArray(sv?.features) ? sv!.features.length : 0; d.sample_error = sample.error;
    if (!isFC || !sv || sv.features!.length === 0) {
      d.included = false; d.reason = `f=geojson non honoré / échantillon vide (${String(sample.error ?? "type=" + String(sv?.type))})`; diag.push(d);
      process.stderr.write(`[select-altus] ${c.slug} → OUT (${String(d.reason)})\n`); continue;
    }
    const sampleFeats = sv.features!;
    const allKeys = new Set<string>();
    for (const f of sampleFeats) for (const k of Object.keys(f.properties ?? {})) allKeys.add(k);
    const candidates: Array<{ field: string; distinct: number; codeLikeRatio: number; sample: unknown[] }> = [];
    for (const key of allKeys) {
      if (TECHNICAL_EXCLUDE.has(canonName(key))) continue;
      const distinct = new Set<string>(); let codeLike = 0; let nonNull = 0; const s: unknown[] = [];
      for (const f of sampleFeats) {
        const raw = f.properties?.[key];
        const str = raw === null || raw === undefined ? "" : String(raw).trim();
        if (str) { nonNull++; distinct.add(str.toUpperCase()); if (isCodeLike(raw)) codeLike++; }
        if (s.length < 6) s.push(raw);
      }
      candidates.push({ field: key, distinct: distinct.size, codeLikeRatio: nonNull > 0 ? codeLike / nonNull : 0, sample: s });
    }
    // Un champ code-zone plausible = ≥3 valeurs distinctes ET ≥50% code-like (lettre+chiffre).
    const plausible = candidates.filter((c2) => c2.distinct >= 3 && c2.codeLikeRatio >= 0.5)
      .sort((a, b) => b.codeLikeRatio - a.codeLikeRatio || b.distinct - a.distinct);
    d.candidate_fields = candidates.sort((a, b) => b.distinct - a.distinct).slice(0, 12);
    d.plausible_code_fields = plausible.map((p) => `${p.field}(distinct=${p.distinct},codeLike=${(p.codeLikeRatio * 100).toFixed(0)}%)`);
    if (plausible.length === 0) {
      d.included = false; d.reason = `aucun champ code-zone plausible (≥3 distinct & ≥50% code-like) dans l'échantillon → ambigu, SKIP`; diag.push(d);
      process.stderr.write(`[select-altus] ${c.slug} → OUT (${String(d.reason)})\n`); continue;
    }

    d.included = true;
    worklist.push({ slug: c.slug, source: "zones-vnatif", urls: [geojsonUrl] });
    process.stderr.write(`[select-altus] ${c.slug} → IN (count=${count}, plausible=[${plausible.slice(0, 3).map((p) => p.field).join(",")}])\n`);
    diag.push(d);
  }

  process.stderr.write(`[select-altus] worklist retenue = ${worklist.length}/${candidates.length}\n`);
  if (worklistOut) { writeFileSync(resolve(ROOT, worklistOut), `${JSON.stringify(worklist, null, 2)}\n`, "utf8"); process.stderr.write(`WORKLIST → ${worklistOut}\n`); }
  const record = { contract: "zones-vnatif-select-altus/v1", date: "2026-08-10", host: HOST, platform: "arcgis-mapserver-f-geojson", zone_code_field: "résolu-par-recouvrement-au-dépôt (Zone|Zonage|Usage selon la couche)", candidates_total: candidates.length, selected: worklist.length, diag };
  if (diagOut) { writeFileSync(resolve(ROOT, diagOut), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`DIAG → ${diagOut}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
