/**
 * zones-agol-owner-harvest.ts — moisson SERVIE de grilles de zonage municipales
 * publiées par des COMPTES AGOL "prolifiques" (consultants/MRC qui publient une
 * couche `ZonageMuni_<X>` par municipalité).
 *
 * POURQUOI (lever neuf, HTTP-pur, déterministe) :
 *   `agol-mono-muni-detect` cherchait "<nomVille> zonage" muni-par-muni (top-10
 *   AGOL) → il RATE les couches dont le titre ne contient pas le nom de la ville
 *   (ex. `ZonageMuni_StAndre_MAJ2024` owner Guillaume.allard) et ne voit jamais le
 *   reste du catalogue de l'éditeur. Ici on ÉNUMÈRE tout le contenu Feature Service
 *   d'une liste d'OWNERS connus pour publier du zonage réglementaire, on mappe
 *   chaque couche à sa muni par le GATE SPATIAL (centroïde bbox → muni de registre
 *   la + proche), et on dépose les NET-NEW.
 *
 * ANTI-INVENTION STRICTE (identique à zones-arcgis-serve) :
 *   ≥3 codes distincts, ≥50% lettrés, ≤80% entiers purs, maxLen≤24, nullRatio≤0.5,
 *   diagonale bbox ≤ --maxdiag km (anti-agrégat multi-muni), muni-la-plus-proche
 *   ≤ --km. Rejet affectation/agricole (titre + champ). Idempotent : pas
 *   d'écrasement d'un slug déjà servi en S3.
 *
 * TS-only. HTTP + S3. 0 secret loggé. N'écrit PAS la matrice (S3 = vérité).
 *
 * USAGE :
 *   npx tsx src/zones-agol-owner-harvest.ts --owners a,b,c [--km 8] [--maxdiag 35] [--dry-run] [--out f.json]
 *   npx tsx src/zones-agol-owner-harvest.ts --discover-owners [--min-owner-items 2]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3Client, putBytes, exists, BUCKET } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REG = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const PREFIX = "normalized/ca-qc-zonage/";
const UA = "sentropic-geo/0.1";

interface MuniEntry { slug: string; name: string; lat: number; lon: number }
interface Args {
  owners: string[];
  km: number;
  maxDiag: number;
  dryRun: boolean;
  out: string;
  concOwners: number;
  discoverOwners: boolean;
  discoverOnly: boolean;
  ownerQueries: string[];
  minOwnerItems: number;
  maxDiscoveryItems: number;
}

// Owners "zonage" éprouvés (preuves : logs AGOL fleet 06-26 "Trouvé via AGOL ... (owner)").
const DEFAULT_OWNERS = [
  // éditeurs vus dans les logs AGOL fleet 06-26
  "Guillaume.allard", "GeoMemphre", "geomatique_vrn", "a.lachance",
  "BENGPT_ARCGIS", "m.grenierdallaire_mrcpontiac",
  // éditeurs prolifiques découverts (search global title:ZonageMuni / "Zonage Municipal")
  "VilleLAssomption", "NathalieBelanger23", "pantaleona", "Ludyvine_CNMSH",
  "j.plavallee", "DoucetMarjorie", "Geo_Rimouski", "Mguimond7",
  "jdube_mrcbellechasse", "RPDC", "agoupli_boisbriand", "rmorin_mrctemis",
  "sherbrooke.ca", "melement", "VilleLongueuil", "villedebeaupre",
  "admin_magog", "cadrin", "vthomas7",
  // découvert gz-wave1 06-30 (min-owner-items=1) : Saint-Augustin-de-Desmaures,
  // champ ZONE_26, 406 codes lettrés — titre non couvert par les seeds précédents.
  "daniel.huntington_vsad",
];
// Owners BRUITÉS à NE PAS seed par défaut (faux positifs documentés) :
//   joliveau (PLU France), UNOWACA ("vue publique" sur-matche), a.mercier.mrchsf (zonage agricole=affectation),
//   Martin_Lessard0 (milieux humides / Roussillon).
const NOISY_OWNERS = new Set(["joliveau", "UNOWACA", "a.mercier.mrchsf", "Martin_Lessard0"]);
const NOISY_OWNERS_LC = new Set([...NOISY_OWNERS].map((s) => s.toLowerCase()));

const DEFAULT_OWNER_DISCOVERY_QUERIES = [
  'title:"Zonage Municipal"',
  "title:ZonageMuni",
  'title:"Plan de zonage"',
  'title:"Zonage municipal"',
  'title:"Zonage_EnVigueur"',
  'title:"Grille de zonage"',
  'title:"Limite de zone"',
];

const ZONE_TITLE_RE = /zonage|zoning|\bzone\b|plan.?d?.?urb|r[eè]glement.*zon|grille.*zon/i;
// Titres à REJETER (faux positifs : couches démographiques/marketing/électorales,
// affectation régionale, agricole, PLU France, milieux naturels).
const AFFECT_RE = /affectation|agricole|cptaq|zone\s*verte|\bplu\b|milieux?.humide|renatural|boise|d[eé]mographi|cible|recensement|\bpopulation\b|[eé]lectoral|marketing|client|d[eé]put|circonscription|inondation|risque|incendie|d[eé]neig|collecte|stationnement/i;
// Champs à NE JAMAIS retenir comme zone_code (id technique, bylaw, surface, usage,
// adresse, code postal/propriétaire — anti faux-positif démographique).
const FIELD_EXCLUDE_RE = /objectid|shape|^fid$|globalid|superfic|^area$|longueur|length|perimet|^maj$|date|^modif$|no_?reg|reglement|^statut$|^dominante$|usage|adresse|matricule|^nom$|municipalit|codepostal|code_?postal|postal|proprietaire|propri[eé]t|courriel|email|t[eé]l[eé]phone|nom_?prop/i;
// Signature d'un VRAI code de zonage : préfixe lettre(s) + chiffre(s) (FA-2, RH-11, C-15, PU-1).
const CODE_PATTERN_RE = /^[A-Za-z]{1,5}[-_. ]?\d/;

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const csv = (k: string): string[] => (get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ownersRaw = get("owners");
  const owners = ownersRaw ? ownersRaw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_OWNERS;
  return {
    owners,
    km: Number(get("km") ?? 8),
    maxDiag: Number(get("maxdiag") ?? 45),
    dryRun: argv.includes("--dry-run"),
    out: get("out") ?? resolve(HERE, "../../work/delegation-mass/zones-agol-owner-harvest.json"),
    concOwners: Number(get("conc-owners") ?? 1),
    discoverOwners: argv.includes("--discover-owners") || argv.includes("--discover-only"),
    discoverOnly: argv.includes("--discover-only"),
    ownerQueries: csv("owner-query").length ? csv("owner-query") : DEFAULT_OWNER_DISCOVERY_QUERIES,
    minOwnerItems: Number(get("min-owner-items") ?? 2),
    maxDiscoveryItems: Number(get("max-discovery-items") ?? 800),
  };
}

async function jget<T = any>(u: string, ms = 20000): Promise<T | null> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(u, { signal: c.signal, headers: { "User-Agent": UA, Accept: "application/json" } }); if (!r.ok) return null; return await r.json() as T; }
  catch { return null; } finally { clearTimeout(t); }
}
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, dLat = (bLat - aLat) * Math.PI / 180, dLon = (bLon - aLon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function* positions(c: any): Generator<[number, number]> {
  if (!Array.isArray(c)) return;
  if (c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") { yield [c[0], c[1]]; return; }
  for (const x of c) yield* positions(x);
}

// ── AGOL: tout le contenu Feature Service d'un owner ──────────────────────────
interface AgolItem { id: string; title: string; owner: string; type: string; url: string | null }
async function searchAgolItems(query: string, maxItems: number): Promise<AgolItem[]> {
  const items: AgolItem[] = []; let start = 1;
  for (let page = 0; page < 20 && items.length < maxItems; page++) {
    const q = encodeURIComponent(`${query} (type:"Feature Service" OR type:"Map Service")`);
    const u = `https://www.arcgis.com/sharing/rest/search?f=json&q=${q}&num=100&start=${start}&sortField=title`;
    const d = await jget<{ results?: AgolItem[]; nextStart?: number }>(u);
    if (!d || !Array.isArray(d.results)) break;
    items.push(...d.results);
    if (!d.nextStart || d.nextStart < 0) break;
    start = d.nextStart; await sleep(120);
  }
  return items.slice(0, maxItems);
}

async function searchOwnerItems(owner: string): Promise<AgolItem[]> {
  return searchAgolItems(`owner:${owner}`, 2000);
}

interface DiscoveredOwner { owner: string; candidateItems: number; sampleTitles: string[] }
async function discoverOwners(seedOwners: string[], queries: string[], minItems: number, maxItems: number): Promise<DiscoveredOwner[]> {
  const known = new Set(seedOwners.map((s) => s.toLowerCase()));
  const byOwner = new Map<string, { owner: string; titles: Set<string> }>();
  for (const query of queries) {
    const items = await searchAgolItems(query, maxItems);
    console.error(`[owner-discovery] query=${JSON.stringify(query)} items=${items.length}`);
    for (const it of items) {
      if (!it.owner || !it.url) continue;
      if (known.has(it.owner.toLowerCase()) || NOISY_OWNERS_LC.has(it.owner.toLowerCase())) continue;
      if (!ZONE_TITLE_RE.test(it.title) || AFFECT_RE.test(it.title)) continue;
      const e = byOwner.get(it.owner) ?? { owner: it.owner, titles: new Set<string>() };
      e.titles.add(it.title);
      byOwner.set(it.owner, e);
    }
    await sleep(200);
  }
  return [...byOwner.values()]
    .map((e) => ({ owner: e.owner, candidateItems: e.titles.size, sampleTitles: [...e.titles].slice(0, 8) }))
    .filter((e) => e.candidateItems >= minItems)
    .sort((a, b) => b.candidateItems - a.candidateItems || a.owner.localeCompare(b.owner));
}

// ── ArcGIS service → couche(s) zonage polygonale(s) ──────────────────────────
interface FieldInfo { name: string; type: string }
async function resolvePolygonLayers(serviceUrl: string): Promise<string[]> {
  const info = await jget<{ layers?: { id: number; name: string; geometryType?: string }[] }>(`${serviceUrl}?f=json`);
  const urls: string[] = [];
  if (info && Array.isArray(info.layers) && info.layers.length) {
    for (const l of info.layers) {
      if (l.geometryType && !/Polygon/i.test(l.geometryType)) continue;
      if (AFFECT_RE.test(l.name) && !ZONE_TITLE_RE.test(l.name)) continue;
      urls.push(`${serviceUrl}/${l.id}`);
    }
  }
  if (urls.length === 0) urls.push(`${serviceUrl}/0`);
  return urls.slice(0, 12);
}

/** Cheap layer-extent centroid in WGS84 (or null if projection unknown). Used to
 *  pre-skip already-served layers without downloading every feature. */
async function layerExtentCentroid(layer: string): Promise<[number, number] | null> {
  const info = await jget<{ extent?: { xmin: number; ymin: number; xmax: number; ymax: number; spatialReference?: { wkid?: number; latestWkid?: number } } }>(`${layer}?f=json`);
  const e = info?.extent; if (!e) return null;
  const wkid = e.spatialReference?.wkid ?? e.spatialReference?.latestWkid ?? 4326;
  let lat: number, lon: number;
  if (wkid === 4326 || (Math.abs(e.xmin) <= 180 && Math.abs(e.ymin) <= 90)) { lat = (e.ymin + e.ymax) / 2; lon = (e.xmin + e.xmax) / 2; }
  else if (wkid === 102100 || wkid === 3857) { const cx = (e.xmin + e.xmax) / 2, cy = (e.ymin + e.ymax) / 2; lon = (cx / 20037508.342) * 180; lat = (Math.atan(Math.exp((cy / 20037508.342) * Math.PI)) * 360) / Math.PI - 90; }
  else return null;
  if (lat < 44 || lat > 63 || lon < -80 || lon > -56) return null;
  return [lat, lon];
}

/** Fetch every feature with ALL attributes (so we can auto-select the zone field). */
async function fetchAllFields(layer: string): Promise<any[]> {
  const feats: any[] = []; let offset = 0; const batch = 1000;
  for (let i = 0; i < 30; i++) {
    const u = `${layer}/query?where=1%3D1&outFields=*&outSR=4326&geometryPrecision=6&resultOffset=${offset}&resultRecordCount=${batch}&f=geojson`;
    const d = await jget<{ features?: any[] }>(u); const fs = d?.features ?? [];
    if (fs.length === 0) break;
    feats.push(...fs); offset += fs.length;
    if (fs.length < batch) break;
    await sleep(80);
  }
  return feats;
}

// Champ qui DISCRIMINE la municipalité (signe d'un agrégat multi-muni → à NE PAS
// servir en mono-muni : ce serait une erreur spatiale #74).
const MUNI_FIELD_RE = /^(code_?mun|mun_?code|id_?muni|municipalit|sdr|geocode_?mun|no_?muni|cod[_]?mun)/i;
/** Nb de munis distinctes implicites dans la couche (via un champ discriminant). */
function muniDistinct(feats: any[]): number {
  if (feats.length === 0) return 0;
  const names = new Set<string>();
  for (const f of feats.slice(0, 50)) for (const k of Object.keys(f.properties ?? {})) names.add(k);
  let maxDistinct = 0;
  for (const name of names) {
    if (!MUNI_FIELD_RE.test(name)) continue;
    const vals = new Set(feats.map((f) => f.properties?.[name]).filter((v) => v != null && v !== "").map((v) => String(v).trim()));
    if (vals.size > maxDistinct) maxDistinct = vals.size;
  }
  return maxDistinct;
}

interface FieldStat { name: string; distinct: number; codeFrac: number }
/** Among string-ish attributes, pick the field that best matches a real zoning
 *  code (anti-#74 gates + code pattern), or null. Auto-discovers the right field
 *  whatever its name (Identifiant, etiquette, ZONE, code…). */
function selectZoneField(feats: any[]): { field: string; stat: FieldStat } | null {
  if (feats.length === 0) return null;
  const names = new Set<string>();
  for (const f of feats.slice(0, 50)) for (const k of Object.keys(f.properties ?? {})) names.add(k);
  let best: { field: string; stat: FieldStat } | null = null;
  for (const name of names) {
    if (FIELD_EXCLUDE_RE.test(name)) continue;
    const raw = feats.map((f) => f.properties?.[name]).filter((v) => v != null && v !== "");
    if (raw.length / feats.length < 0.5) continue; // nullRatio gate
    const codes = raw.map((v) => String(v).trim());
    if (codes.some((s) => s.length > 24)) continue;
    const distinct = new Set(codes).size;
    if (distinct < 3) continue;
    const withLetter = codes.filter((s) => /[A-Za-z]/.test(s)).length / codes.length;
    if (withLetter < 0.5) continue;
    const pureInt = codes.filter((s) => /^\d+$/.test(s)).length / codes.length;
    if (pureInt > 0.8) continue;
    const codeFrac = codes.filter((s) => CODE_PATTERN_RE.test(s)).length / codes.length;
    const stat: FieldStat = { name, distinct, codeFrac };
    // préfère la signature code (lettre+chiffre), puis le plus de codes distincts.
    if (!best || codeFrac > best.stat.codeFrac + 0.05 || (Math.abs(codeFrac - best.stat.codeFrac) <= 0.05 && distinct > best.stat.distinct)) {
      best = { field: name, stat };
    }
  }
  return best;
}

interface Verdict { ok: boolean; reason: string; slug?: string; distinct?: number; feats?: number; out?: any }
function evaluate(feats: any[], field: string, reg: MuniEntry[], km: number, maxDiag: number, source: string): Verdict {
  if (feats.length === 0) return { ok: false, reason: "0 feature" };
  const raw = feats.map((f) => f.properties?.[field]).filter((v) => v != null && v !== "");
  if (raw.length === 0) return { ok: false, reason: "champ vide" };
  const codes = raw.map((v) => String(v).trim());
  const distinct = new Set(codes);
  const withLetter = codes.filter((s) => /[A-Za-z]/.test(s)).length;
  const pureInt = codes.filter((s) => /^\d+$/.test(s)).length;
  const maxLen = Math.max(...codes.map((s) => s.length));
  const nullRatio = 1 - raw.length / feats.length;
  if (distinct.size < 3) return { ok: false, reason: `<3 codes distincts (${distinct.size})` };
  if (withLetter / codes.length < 0.5) return { ok: false, reason: `<50% lettrés (${(withLetter / codes.length).toFixed(2)})` };
  if (pureInt / codes.length > 0.8) return { ok: false, reason: `>80% entiers purs (${(pureInt / codes.length).toFixed(2)})` };
  if (maxLen > 24) return { ok: false, reason: `maxLen ${maxLen}` };
  if (nullRatio > 0.5) return { ok: false, reason: `nullRatio ${nullRatio.toFixed(2)}` };

  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
  for (const f of feats) for (const [x, y] of positions(f.geometry?.coordinates)) { if (!Number.isFinite(x) || !Number.isFinite(y)) continue; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); n++; }
  if (n === 0) return { ok: false, reason: "aucune géométrie" };
  const cLon = (minx + maxx) / 2, cLat = (miny + maxy) / 2;
  if (cLat < 44 || cLat > 63 || cLon < -80 || cLon > -56) return { ok: false, reason: `centre hors-QC [${cLat.toFixed(2)},${cLon.toFixed(2)}]` };
  const diag = haversineKm(miny, minx, maxy, maxx);
  if (diag > maxDiag) return { ok: false, reason: `bbox agrégat (diag ${diag.toFixed(0)}km > ${maxDiag})` };
  const nearest = reg.map((m) => ({ m, d: haversineKm(cLat, cLon, m.lat, m.lon) })).sort((x, y) => x.d - y.d)[0]!;
  if (nearest.d > km) return { ok: false, reason: `muni la + proche ${nearest.m.slug} à ${nearest.d.toFixed(1)}km > ${km}` };

  const out = {
    type: "FeatureCollection",
    features: feats.map((f) => ({ type: "Feature", geometry: f.geometry, properties: { zone_code: String(f.properties?.[field]).trim() || null, kind: null, affectation: null, num_zone: null, source, confidence: "agol-owner-zone-vector" } })),
  };
  return { ok: true, reason: "ok", slug: nearest.m.slug, distinct: distinct.size, feats: feats.length, out };
}

async function listServed(s3: any): Promise<Set<string>> {
  const served = new Set<string>(); let token: string | undefined;
  do {
    const r: any = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) { const m = (o.Key as string).match(/qc-zonage-([^/]+?)\.geojson$/); if (m) served.add(m[1]); const d = (o.Key as string).match(/ca-qc-zonage\/([^/]+)\//); if (d) served.add(d[1].replace(/^qc-zonage-/, "")); }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return served;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const reg = JSON.parse(readFileSync(REG, "utf8")) as MuniEntry[];
  const s3 = s3Client();
  const served = await listServed(s3);
  const discoveredOwners = a.discoverOwners
    ? await discoverOwners(a.owners, a.ownerQueries, a.minOwnerItems, a.maxDiscoveryItems)
    : [];
  // --discover-only : liste les nouveaux owners candidats (nom + titres échantillon)
  // SANS moisson lourde. Sert à jauger cheaply l'espace fresh (ex. single-item à
  // min-owner-items=1) avant d'engager un harvest ciblé via --owners.
  if (a.discoverOnly) {
    const report = { generatedAt: new Date().toISOString(), mode: "discover-only", minOwnerItems: a.minOwnerItems, seedOwners: a.owners, discoveredCount: discoveredOwners.length, discoveredOwners };
    writeFileSync(a.out, JSON.stringify(report, null, 2) + "\n");
    console.error(`\n=== DISCOVER-ONLY : ${discoveredOwners.length} nouveaux owners (min-items=${a.minOwnerItems}) ===`);
    for (const o of discoveredOwners) console.error(`  ${o.owner}  (${o.candidateItems} items) :: ${o.sampleTitles.slice(0, 4).join(" | ")}`);
    console.error(`rapport → ${a.out}`);
    return;
  }
  const owners = [...a.owners, ...discoveredOwners.map((o) => o.owner)];
  console.error(`[owner-harvest] owners=${owners.length} (seed=${a.owners.length}, discovered=${discoveredOwners.length}) km=${a.km} maxdiag=${a.maxDiag} dryRun=${a.dryRun} | servedS3=${served.size}`);

  const deposits: { slug: string; owner: string; title: string; layer: string; field: string; feats: number; distinct: number }[] = [];
  const skips: { owner: string; title: string; reason: string }[] = [];
  const seenSlug = new Set<string>();

  for (const owner of owners) {
    const items = await searchOwnerItems(owner);
    const zoneItems = items.filter((it) => it.url && ZONE_TITLE_RE.test(it.title) && !AFFECT_RE.test(it.title));
    console.error(`\n[owner ${owner}] ${items.length} services, ${zoneItems.length} candidats zonage`);
    for (const it of zoneItems) {
      const svc = (it.url as string).replace(/\/\d+$/, "");
      const layers = await resolvePolygonLayers(svc);
      let best: { v: Verdict; field: string; layer: string } | null = null;
      let lastReason = "pas de couche polygone exploitable";
      for (const layer of layers) {
        // pré-skip cheap: centroïde d'emprise → slug déjà servi ? on évite le download lourd.
        const ctr = await layerExtentCentroid(layer);
        if (ctr) {
          const near = reg.map((m) => ({ m, d: haversineKm(ctr[0], ctr[1], m.lat, m.lon) })).sort((x, y) => x.d - y.d)[0]!;
          if (near.d <= a.km && (served.has(near.m.slug) || seenSlug.has(near.m.slug))) { lastReason = `déjà servi (extent): ${near.m.slug}`; continue; }
        }
        const feats = await fetchAllFields(layer);
        const nMuni = muniDistinct(feats);
        if (nMuni > 1) { lastReason = `agrégat multi-muni (${nMuni} munis via champ discriminant) — refus mono-serve`; continue; }
        const sel = selectZoneField(feats);
        if (!sel) { lastReason = "aucun champ code-zone valide"; continue; }
        const v = evaluate(feats, sel.field, reg, a.km, a.maxDiag, layer);
        if (!v.ok) { lastReason = v.reason; continue; }
        if (!best || (v.distinct ?? 0) > (best.v.distinct ?? 0)) best = { v, field: sel.field, layer };
      }
      if (!best) { skips.push({ owner, title: it.title, reason: lastReason }); console.error(`  · SKIP "${it.title}" — ${lastReason}`); continue; }
      const { v, field, layer } = best;
      const slug = v.slug!;
      if (served.has(slug) || seenSlug.has(slug)) { skips.push({ owner, title: it.title, reason: `déjà servi: ${slug}` }); console.error(`  · SKIP "${it.title}" — slug déjà servi (${slug})`); continue; }
      const key = `${PREFIX}qc-zonage-${slug}.geojson`;
      if (a.dryRun) {
        console.error(`  ✔ DRY ${slug} <= "${it.title}" (${v.feats} z., ${v.distinct} codes, champ ${field})`);
      } else {
        if (await exists(s3, key)) { skips.push({ owner, title: it.title, reason: `exists race: ${slug}` }); continue; }
        await putBytes(s3, key, JSON.stringify(v.out), "application/geo+json");
        console.error(`  ✔ DÉPOSÉ ${slug} <= "${it.title}" (${v.feats} z., ${v.distinct} codes, champ ${field})`);
      }
      seenSlug.add(slug);
      deposits.push({ slug, owner, title: it.title, layer, field, feats: v.feats!, distinct: v.distinct! });
    }
  }

  const report = { generatedAt: new Date().toISOString(), dryRun: a.dryRun, seedOwners: a.owners, discoveredOwners, owners, depositsCount: deposits.length, deposits, skipsCount: skips.length, skips };
  writeFileSync(a.out, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n=== ${a.dryRun ? "DRY " : ""}DÉPÔTS net-new=${deposits.length} [${deposits.map((d) => d.slug).join(",")}]`);
  console.error(`rapport → ${a.out}`);
}
main().catch((e) => { console.error("[owner-harvest] FATAL:", e instanceof Error ? e.message : String(e)); process.exit(1); });
