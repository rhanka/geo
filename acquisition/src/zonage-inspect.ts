/**
 * zonage-inspect.ts — inspecteur READ-ONLY (anti-invention) des sources de
 * zonage en S3, pour DÉCIDER comment servir une ville focus sans rien inventer.
 *
 * Trois modes, aucun n'écrit en S3 :
 *
 *   --reatt [--focus] [--haute]
 *       Dump la réattribution reverse-géocodée
 *       `exchange/geo-immo/grilles-reattribution.json` :
 *       collection_id → municipalite_reelle (slug canonique) + confiance.
 *       `--focus` ne garde que les villes focus-30. `--haute` ne garde que
 *       confiance HAUTE. C'est la source de vérité pour savoir quelle grille
 *       ArcGIS mono-muni correspond réellement à quelle ville.
 *
 *   --dir <dir>
 *       Inspecte UN dir agrégat `ca-qc-zonage-…-arcgis` : nb features, toutes
 *       les clés de propriétés, pour chaque clé candidate-muni ses valeurs
 *       distinctes (+ combien mappent un slug canonique), les champs
 *       candidats code-zone avec échantillons, et le centroïde bbox + la muni
 *       du registre la plus proche (vérif spatiale). Permet de trancher
 *       mono-muni vs agrégat, et quel est le BON champ zone_code.
 *
 *   --find <slug[,slug…]>
 *       Pour chaque slug focus, liste les dirs `*-arcgis` dont la
 *       réattribution pointe vers ce slug (toute confiance), avec le détail.
 *       Sert à trouver la grille mono-muni d'une ville donnée.
 *
 *   --sweep [--km <n>]
 *       Balaye TOUS les dirs `*-arcgis`, calcule le centroïde bbox de chaque,
 *       et reporte la muni FOCUS du registre la plus proche + distance + le
 *       meilleur champ candidat code-zone. Détecte les grilles MONO-MUNI d'une
 *       ville focus cachées sous un id de compte ArcGIS non encore réattribué
 *       (≤ --km, déf. 8). C'est le filet anti-faux-négatif avant de déclarer
 *       une ville "acquisition à part".
 *
 * TS-only. Aucun secret loggé. AUCUNE écriture S3.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { s3Client, getBytes, exists, BUCKET } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MUNI_REGISTRY = resolve(REPO, "packages/qc-sources/src/geo/municipalities.qc.json");
const PREFIX = "normalized/ca-qc-zonage/";
const REATT_KEY = "exchange/geo-immo/grilles-reattribution.json";

const FOCUS = new Set([
  "longueuil", "rosemere", "westmount", "hampstead", "cote-saint-luc", "dorval", "chambly",
  "saint-lambert", "mont-royal", "montreal-ouest", "brossard", "sainte-catherine", "la-prairie",
  "delson", "candiac", "montreal-est", "lile-dorval", "saint-constant", "saint-bruno-de-montarville",
  "carignan", "dollard-des-ormeaux", "pointe-claire", "saint-philippe", "saint-mathieu",
  "chateauguay", "sainte-julie", "saint-basile-le-grand", "varennes", "kirkland", "boucherville",
]);

interface MuniEntry { slug: string; name: string; lat: number; lon: number }
interface GeoFeature { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }
interface GeoJSON { type: string; features: GeoFeature[]; [k: string]: unknown }
interface ReattEntry { collection_id?: string; municipalite_reelle?: string; confiance?: string; [k: string]: unknown }

function toSlug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function stripAdminPrefix(s: string): string {
  return s.replace(/^(municipalit[ée]\s+(du\s+canton\s+de\s+|du\s+|de\s+|des\s+|d')?|ville\s+de\s+|ville\s+|paroisse\s+(de\s+)?|canton\s+(de\s+)?|sd\s+de\s+|vl\s+de\s+|m\s+de\s+|p\s+de\s+|v\s+de\s+)/i, "").trim();
}
function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") { yield [coords[0] as number, coords[1] as number]; return; }
  for (const c of coords) yield* positions(c);
}
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180, dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function loadRegistry(): { bySlug: Map<string, MuniEntry>; byName: Map<string, MuniEntry>; all: MuniEntry[] } {
  const raw = JSON.parse(readFileSync(MUNI_REGISTRY, "utf8")) as MuniEntry[];
  const bySlug = new Map<string, MuniEntry>(), byName = new Map<string, MuniEntry>();
  for (const e of raw) { if (!e.slug) continue; bySlug.set(e.slug, e); byName.set(toSlug(e.name), e); }
  return { bySlug, byName, all: raw };
}

function geojsonKey(dir: string): string { const base = dir.replace(/^ca-/, ""); return `${PREFIX}${dir}/${base}.geojson`; }

async function loadReatt(s3: S3Client): Promise<ReattEntry[]> {
  const j = JSON.parse((await getBytes(s3, REATT_KEY)).toString("utf8"));
  return (j.reattributions ?? j ?? []) as ReattEntry[];
}

async function modeReatt(s3: S3Client, focusOnly: boolean, hauteOnly: boolean): Promise<void> {
  const reatt = await loadReatt(s3);
  console.log(`[reatt] ${reatt.length} entrées dans ${REATT_KEY}`);
  const rows = reatt.map((r) => ({ col: r.collection_id ?? "", slug: toSlug(stripAdminPrefix(String(r.municipalite_reelle ?? ""))), muni: r.municipalite_reelle ?? "", conf: r.confiance ?? "" }))
    .filter((r) => (!focusOnly || FOCUS.has(r.slug)) && (!hauteOnly || r.conf === "HAUTE"))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  console.log(`[reatt] affichées=${rows.length} (focus=${focusOnly} haute=${hauteOnly})`);
  for (const r of rows) console.log(`  ${r.conf.padEnd(8)} ${r.slug.padEnd(28)} <= ${r.col}  (muni="${r.muni}")`);
  // récap focus: quels focus ont AU MOINS une réattribution
  if (focusOnly) {
    const have = new Set(rows.map((r) => r.slug));
    const missing = [...FOCUS].filter((s) => !have.has(s)).sort();
    console.log(`[reatt] focus avec réattribution: ${have.size}/${FOCUS.size}`);
    console.log(`[reatt] focus SANS réattribution: ${missing.length} → ${missing.join(", ")}`);
  }
}

async function modeFind(s3: S3Client, slugs: string[]): Promise<void> {
  const reatt = await loadReatt(s3);
  for (const want of slugs) {
    const matches = reatt.filter((r) => toSlug(stripAdminPrefix(String(r.municipalite_reelle ?? ""))) === want);
    console.log(`\n[find] ${want}: ${matches.length} grille(s) ArcGIS réattribuée(s)`);
    for (const m of matches) console.log(`   conf=${m.confiance} col=${m.collection_id} muni="${m.municipalite_reelle}"`);
  }
}

async function listAggregateDirs(s3: S3Client): Promise<string[]> {
  const out: string[] = [];
  const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, Delimiter: "/", MaxKeys: 1000 }));
  for (const cp of r.CommonPrefixes ?? []) {
    const d = cp.Prefix!.slice(PREFIX.length).replace(/\/$/, "");
    if (d.startsWith("ca-qc-zonage-") && d.endsWith("-arcgis")) out.push(d);
  }
  return out.sort();
}

/** bbox centroïde [lon,lat] (ou null) + nb positions. */
function bboxCentroid(feats: GeoFeature[]): { ctr: [number, number] | null; n: number } {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
  for (const f of feats) { if (!f.geometry) continue; for (const [x, y] of positions(f.geometry.coordinates)) { if (!Number.isFinite(x) || !Number.isFinite(y)) continue; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; n++; } }
  if (n === 0 || !Number.isFinite(minx)) return { ctr: null, n: 0 };
  return { ctr: [(minx + maxx) / 2, (miny + maxy) / 2], n };
}

const ZONE_CANDS = ["no_zone", "NO_ZONE", "Zonage", "ZONAGE", "zone_code", "ETIQUETTE", "NUM_ZONE", "ZONE", "Zone", "zone", "Zonage_ID", "ZoneNumber", "NumZone"];
/** 1er champ candidat code-zone court non-null ≥50%, + échantillon. */
function bestZoneField(feats: GeoFeature[]): { field: string; sample: string[] } | null {
  const n = feats.length || 1;
  const keys = new Set<string>(); for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  for (const c of ZONE_CANDS) {
    if (!keys.has(c)) continue;
    let nonNull = 0, shortc = 0; const sample: string[] = [];
    for (const f of feats) { const v = f.properties?.[c]; if (v === null || v === undefined || v === "") continue; nonNull++; const s = String(v).trim(); if (s.length <= 24) shortc++; if (sample.length < 4) sample.push(s); }
    if (nonNull / n >= 0.5 && shortc / Math.max(nonNull, 1) >= 0.7) return { field: c, sample };
  }
  return null;
}

async function modeSweep(s3: S3Client, km: number): Promise<void> {
  const { all } = loadRegistry();
  const focusMunis = all.filter((e) => FOCUS.has(e.slug));
  const dirs = await listAggregateDirs(s3);
  console.log(`[sweep] ${dirs.length} dirs | seuil focus=${km}km`);
  const hits: string[] = [];
  for (const dir of dirs) {
    let feats: GeoFeature[];
    try { feats = (JSON.parse((await getBytes(s3, geojsonKey(dir))).toString("utf8")) as GeoJSON).features ?? []; }
    catch (e) { console.log(`  ERR ${dir}: ${(e as Error).message}`); continue; }
    const { ctr, n } = bboxCentroid(feats);
    if (!ctr || n === 0) { continue; }
    const near = focusMunis.map((e) => ({ e, d: haversineKm(ctr, [e.lon, e.lat]) })).sort((a, b) => a.d - b.d)[0];
    if (!near || near.d > km) continue;
    const zf = bestZoneField(feats);
    const line = `  FOCUS-NEAR ${near.e.slug.padEnd(26)} ${near.d.toFixed(1).padStart(5)}km  feats=${String(feats.length).padStart(5)}  zone=${zf ? zf.field : "—"}  sample=${zf ? JSON.stringify(zf.sample) : "[]"}  <= ${dir}`;
    console.log(line);
    hits.push(line);
  }
  console.log(`[sweep] dirs proches (<=${km}km) d'une ville focus: ${hits.length}`);
}

async function modeDir(s3: S3Client, dir: string): Promise<void> {
  const { bySlug, byName, all } = loadRegistry();
  const gkey = geojsonKey(dir);
  if (!(await exists(s3, gkey))) { console.log(`[dir] ABSENT: ${gkey}`); return; }
  const gj = JSON.parse((await getBytes(s3, gkey)).toString("utf8")) as GeoJSON;
  const feats = gj.features ?? [];
  console.log(`[dir] ${dir}`);
  console.log(`[dir] features=${feats.length}  key=${gkey}`);

  // toutes les clés
  const keys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  console.log(`[dir] propKeys (${keys.size}): ${[...keys].join(", ")}`);

  // pour chaque clé: distinct count + combien mappent un slug canonique
  console.log(`[dir] --- analyse muni-candidates (clé: distinct, mappés-slug, top5 valeurs) ---`);
  for (const k of keys) {
    const vals = new Map<string, number>();
    for (const f of feats) { const v = f.properties?.[k]; if (v === null || v === undefined || v === "") continue; const s = String(v); vals.set(s, (vals.get(s) ?? 0) + 1); }
    if (vals.size === 0 || vals.size > 60) {
      // trop de valeurs distinctes → probable code-zone/texte, pas muni; on skip l'analyse muni mais on note
      continue;
    }
    let mapped = 0;
    for (const v of vals.keys()) { const s = toSlug(stripAdminPrefix(v)); if (byName.has(s) || bySlug.has(s)) mapped++; }
    const top = [...vals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, n]) => `${v}(${n})`);
    console.log(`   ${k}: distinct=${vals.size} mappés-slug=${mapped} top=${JSON.stringify(top)}`);
  }

  // candidats code-zone: champs avec valeurs courtes alphanum
  console.log(`[dir] --- candidats code-zone (distinct, %nonnull, %court, échantillon) ---`);
  const n = feats.length || 1;
  for (const k of keys) {
    let nonNull = 0, shortCodes = 0; const sample: string[] = []; const distinct = new Set<string>();
    for (const f of feats) { const v = f.properties?.[k]; if (v === null || v === undefined || v === "") continue; nonNull++; const s = String(v).trim(); distinct.add(s); if (s.length > 0 && s.length <= 24) shortCodes++; if (sample.length < 8 && /[A-Za-z]/.test(s) && /\d/.test(s)) sample.push(s); }
    const pctNonNull = ((nonNull / n) * 100).toFixed(0), pctShort = ((shortCodes / Math.max(nonNull, 1)) * 100).toFixed(0);
    if (sample.length === 0) { for (const f of feats) { const v = f.properties?.[k]; if (v === null || v === undefined || v === "") continue; const s = String(v).trim(); if (sample.length < 8) sample.push(s); else break; } }
    if (Number(pctNonNull) >= 30 && Number(pctShort) >= 50)
      console.log(`   ${k}: distinct=${distinct.size} nonnull=${pctNonNull}% court=${pctShort}% sample=${JSON.stringify(sample)}`);
  }

  // bbox centroïde + muni registre la plus proche
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, np = 0;
  for (const f of feats) { if (!f.geometry) continue; for (const [x, y] of positions(f.geometry.coordinates)) { if (!Number.isFinite(x) || !Number.isFinite(y)) continue; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; np++; } }
  if (np > 0) {
    const ctr: [number, number] = [(minx + maxx) / 2, (miny + maxy) / 2];
    console.log(`[dir] bbox=[${minx.toFixed(4)},${miny.toFixed(4)} .. ${maxx.toFixed(4)},${maxy.toFixed(4)}] centre=[${ctr[0].toFixed(4)},${ctr[1].toFixed(4)}] (${np} positions)`);
    const near = all.map((e) => ({ e, d: haversineKm(ctr, [e.lon, e.lat]) })).sort((a, b) => a.d - b.d).slice(0, 5);
    console.log(`[dir] munis registre les + proches du centre bbox:`);
    for (const { e, d } of near) console.log(`   ${e.slug.padEnd(28)} ${d.toFixed(1)}km`);
  } else {
    console.log(`[dir] AUCUNE position géométrique exploitable`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const s3 = s3Client();
  if (argv.includes("--reatt")) { await modeReatt(s3, argv.includes("--focus"), argv.includes("--haute")); return; }
  const findIdx = argv.indexOf("--find");
  if (findIdx >= 0) { await modeFind(s3, (argv[findIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)); return; }
  if (argv.includes("--sweep")) { const ki = argv.indexOf("--km"); await modeSweep(s3, ki >= 0 ? Number(argv[ki + 1]) : 8); return; }
  const dirIdx = argv.indexOf("--dir");
  if (dirIdx >= 0) { await modeDir(s3, argv[dirIdx + 1] ?? ""); return; }
  console.error("usage: zonage-inspect.ts (--reatt [--focus] [--haute] | --find <slug,…> | --dir <dir> | --sweep [--km <n>])");
  process.exit(2);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
