/**
 * zones-arcgis-serve.ts — dépôt SERVI d'une grille de zonage municipale depuis
 * UNE couche ArcGIS FeatureServer mono-muni, avec gate spatial + anti-invention
 * STRICTE et champ zone_code EXPLICITE (jamais deviné).
 *
 * POURQUOI un outil dédié : `agol-mono-muni-detect` / `zones-obscura-run`
 * choisissent le champ zone automatiquement et peuvent tomber sur l'id séquentiel
 * (NO_ZONAGE/NumZone = piège #74). Ici le champ réglementaire RÉEL est passé en
 * argument après vérification humaine, et le dépôt est refusé si le champ ressemble
 * à un id séquentiel (>80% d'entiers purs) ou si <3 codes distincts, ou si le
 * centroïde de l'emprise est à >--km du centroïde registre de la muni cible.
 *
 * Schéma de serving (identique aux flat files existants servis par geo-api) :
 *   { zone_code, kind:null, affectation:null, num_zone:null, source, confidence }
 * Sortie : normalized/ca-qc-zonage/qc-zonage-<slug>.geojson  (flat, servi tel quel).
 *
 * TS-only. HTTP + S3. Aucun secret loggé. N'écrit PAS la matrice (S3 = vérité).
 *
 * USAGE :
 *   npx tsx src/zones-arcgis-serve.ts --slug vercheres --layer <FeatureServer/2> \
 *       --zone-field zonage [--km 6] [--dry-run]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client, putBytes, exists } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REG = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const PREFIX = "normalized/ca-qc-zonage/";
const UA = "sentropic-geo/0.1";

interface MuniEntry { slug: string; name: string; lat: number; lon: number }
interface Args { slug: string; layer: string; zoneField: string; km: number; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const slug = get("slug"); const layer = get("layer"); const zoneField = get("zone-field");
  if (!slug || !layer || !zoneField) { console.error("usage: --slug <s> --layer <FeatureServer/N> --zone-field <field> [--km 6] [--dry-run]"); process.exit(2); }
  return { slug, layer, zoneField, km: Number(get("km") ?? 6), dryRun: argv.includes("--dry-run") };
}

async function jget(u: string, ms = 20000): Promise<any> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(u, { signal: c.signal, headers: { "User-Agent": UA, Accept: "application/json" } }); if (!r.ok) return null; return await r.json(); }
  catch { return null; } finally { clearTimeout(t); }
}
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

async function fetchAll(layer: string, field: string): Promise<any[]> {
  const feats: any[] = []; let offset = 0; const batch = 1000;
  for (;;) {
    const u = `${layer}/query?where=1%3D1&outFields=${encodeURIComponent(field)}&outSR=4326&geometryPrecision=6&resultOffset=${offset}&resultRecordCount=${batch}&f=geojson`;
    const d = await jget(u); const fs = d?.features ?? [];
    if (fs.length === 0) break;
    feats.push(...fs); offset += fs.length;
    if (fs.length < batch) break;
  }
  return feats;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const reg = JSON.parse(readFileSync(REG, "utf8")) as MuniEntry[];
  const muni = reg.find((m) => m.slug === a.slug);
  if (!muni) { console.error(`[serve] slug "${a.slug}" absent du registre — abandon`); process.exit(1); }

  console.error(`[serve] ${a.slug} <= ${a.layer} (champ=${a.zoneField})`);
  const feats = await fetchAll(a.layer, a.zoneField);
  if (feats.length === 0) { console.error(`[serve] 0 feature téléchargée — abandon`); process.exit(1); }

  // anti-invention: distinct codes, lettres présentes, pas un id séquentiel.
  const raw = feats.map((f) => f.properties?.[a.zoneField]).filter((v) => v != null && v !== "");
  const codes = raw.map((v) => String(v).trim());
  const distinct = new Set(codes);
  const withLetter = codes.filter((s) => /[A-Za-z]/.test(s)).length;
  const pureInt = codes.filter((s) => /^\d+$/.test(s)).length;
  const maxLen = Math.max(...codes.map((s) => s.length));
  const nullRatio = 1 - raw.length / feats.length;
  console.error(`[serve] feats=${feats.length} nonnull=${raw.length} distinct=${distinct.size} withLetter=${(withLetter / codes.length).toFixed(2)} pureInt=${(pureInt / codes.length).toFixed(2)} maxLen=${maxLen} nullRatio=${nullRatio.toFixed(2)} sample=${JSON.stringify([...distinct].slice(0, 10))}`);
  if (distinct.size < 3) { console.error(`[serve] REJET anti-invention: <3 codes distincts`); process.exit(1); }
  if (withLetter / codes.length < 0.5) { console.error(`[serve] REJET anti-invention: <50% des codes contiennent une lettre (id séquentiel ?)`); process.exit(1); }
  if (pureInt / codes.length > 0.8) { console.error(`[serve] REJET anti-invention: >80% d'entiers purs (piège #74)`); process.exit(1); }
  if (maxLen > 24) { console.error(`[serve] REJET: code trop long (maxLen=${maxLen})`); process.exit(1); }
  if (nullRatio > 0.5) { console.error(`[serve] REJET: trop de null (${nullRatio.toFixed(2)})`); process.exit(1); }

  // gate spatial: centroïde bbox vs centroïde registre de la muni cible.
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
  for (const f of feats) for (const [x, y] of positions(f.geometry?.coordinates)) { if (!Number.isFinite(x) || !Number.isFinite(y)) continue; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); n++; }
  if (n === 0) { console.error(`[serve] REJET: aucune position géométrique`); process.exit(1); }
  const cLon = (minx + maxx) / 2, cLat = (miny + maxy) / 2;
  const distKm = haversineKm(cLat, cLon, muni.lat, muni.lon);
  // muni registre la plus proche (doit être la cible)
  const nearest = reg.map((m) => ({ m, d: haversineKm(cLat, cLon, m.lat, m.lon) })).sort((x, y) => x.d - y.d)[0]!;
  console.error(`[serve] bbox centre=[${cLat.toFixed(4)},${cLon.toFixed(4)}] dist(${a.slug})=${distKm.toFixed(2)}km  nearest=${nearest.m.slug}@${nearest.d.toFixed(2)}km`);
  if (distKm > a.km) { console.error(`[serve] REJET gate spatial: ${distKm.toFixed(2)}km > ${a.km}km`); process.exit(1); }
  if (nearest.m.slug !== a.slug) { console.error(`[serve] REJET gate spatial: muni la plus proche = ${nearest.m.slug} ≠ ${a.slug}`); process.exit(1); }

  // normalisation schéma serving
  const out = {
    type: "FeatureCollection",
    features: feats.map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: { zone_code: String(f.properties?.[a.zoneField]).trim() || null, kind: null, affectation: null, num_zone: null, source: a.layer, confidence: "arcgis-zone-vector" },
    })),
  };
  const key = `${PREFIX}qc-zonage-${a.slug}.geojson`;
  if (a.dryRun) { console.error(`[serve] DRY-RUN ok: aurait écrit ${key} (${out.features.length} zones)`); return; }
  const s3 = s3Client();
  if (await exists(s3, key)) { console.error(`[serve] ATTENTION: ${key} existe déjà — abandon (pas d'écrasement)`); process.exit(1); }
  await putBytes(s3, key, JSON.stringify(out), "application/geo+json");
  console.error(`[serve] DÉPOSÉ ${key} (${out.features.length} zones, ${distinct.size} codes distincts)`);
}
main().catch((e) => { console.error("[serve] FATAL:", e instanceof Error ? e.message : String(e)); process.exit(1); });
