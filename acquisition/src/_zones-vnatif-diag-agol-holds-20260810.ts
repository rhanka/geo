/**
 * _zones-vnatif-diag-agol-holds-20260810.ts — sonde ciblée (read-only) sur les 3 HOLD
 * AGOL (beaupre, gore, saint-ludger) : pour chaque champ non-technique (et pour chaque
 * groupe muni des couches partagées), affiche distinct / overlap avec les codes servis
 * et le nearest, afin de statuer SKIP-légitime vs champ mal résolu. NE DÉPOSE RIEN.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exists, getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const MUNIS_PATH = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
function canon(v: unknown): string { return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

interface Reg { slug: string; lat: number; lon: number }
function loadRegistry(): Reg[] {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>).find(Array.isArray)) as Array<Record<string, unknown>>;
  return arr.map((m) => ({ slug: String(m["slug"] ?? ""), lat: Number(m["lat"]), lon: Number(m["lon"]) })).filter((m) => m.slug && Number.isFinite(m.lat) && Number.isFinite(m.lon));
}
function hav(a: number, b: number, c: number, d: number): number { const R = 6371, dLat = ((c - a) * Math.PI) / 180, dLon = ((d - b) * Math.PI) / 180; const x = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }
function* pos(coords: unknown): Generator<[number, number]> { if (!Array.isArray(coords)) return; if (typeof coords[0] === "number" && typeof coords[1] === "number") { yield [coords[0], coords[1]]; return; } for (const c of coords) yield* pos(c); }
interface Feat { properties?: Record<string, unknown> | null; geometry?: unknown }
function nearest(feats: Feat[], reg: Reg[]): { slug: string | null; km: number | null } {
  let a = Infinity, b = Infinity, c = -Infinity, dd = -Infinity;
  for (const f of feats) for (const [x, y] of pos((f.geometry as { coordinates?: unknown } | null)?.coordinates)) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > dd) dd = y; }
  if (![a, b, c, dd].every(Number.isFinite)) return { slug: null, km: null };
  const clat = (b + dd) / 2, clon = (a + c) / 2; let best: { slug: string; km: number } | null = null;
  for (const m of reg) { const km = hav(m.lat, m.lon, clat, clon); if (!best || km < best.km) best = { slug: m.slug, km }; }
  return { slug: best?.slug ?? null, km: best ? Math.round(best.km * 100) / 100 : null };
}
async function fetchJson(url: string): Promise<unknown> { const r = await fetch(url, { headers: { "User-Agent": "sentropic-geo-diag/1", accept: "application/json" } }); return r.json(); }
async function served(s3: ReturnType<typeof s3Client>, slug: string): Promise<Set<string>> {
  const codes = new Set<string>();
  for (const k of [`${S3_PREFIX}qc-zonage-${slug}.geojson`, `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`]) {
    if (!(await exists(s3, k))) continue;
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { features?: Feat[] };
    for (const f of fc.features ?? []) { const c = canon(f.properties?.["zone_code"]); if (c) codes.add(c); }
  }
  return codes;
}
function overlapAllFields(feats: Feat[], sc: Set<string>): Array<{ field: string; distinct: number; nnull: number; overlap: number }> {
  const keys = new Set<string>(); for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  const out: Array<{ field: string; distinct: number; nnull: number; overlap: number }> = [];
  for (const key of keys) {
    const dset = new Set<string>(); let nn = 0;
    for (const f of feats) { const raw = f.properties?.[key]; const s = raw === null || raw === undefined ? "" : String(raw).trim(); if (!s) nn++; else dset.add(canon(s)); }
    const cov = sc.size ? [...sc].filter((c) => dset.has(c)).length : 0;
    out.push({ field: key, distinct: dset.size, nnull: nn, overlap: sc.size ? Math.round((cov / sc.size) * 1000) / 10 : 0 });
  }
  return out.sort((x, y) => y.overlap - x.overlap || y.distinct - x.distinct).slice(0, 8);
}

const TARGETS: Array<{ slug: string; layer: string; muniField?: string }> = [
  { slug: "beaupre", layer: "https://services6.arcgis.com/osUKB2jztkflrQhx/arcgis/rest/services/Zonage/FeatureServer/17" },
  { slug: "gore", layer: "https://services9.arcgis.com/iZcAwIV2GibwcZLe/arcgis/rest/services/Zonage/FeatureServer/0", muniField: "co_mun" },
  { slug: "saint-ludger", layer: "https://services6.arcgis.com/qVhfI6UTbRNL5Gfd/arcgis/rest/services/Zonage/FeatureServer/5", muniField: "MUNI" },
];

async function main(): Promise<void> {
  const reg = loadRegistry(); const s3 = s3Client();
  for (const t of TARGETS) {
    const sc = await served(s3, t.slug);
    const gj = (await fetchJson(`${t.layer}/query?where=1%3D1&outFields=*&f=geojson`)) as { features?: Feat[] };
    const feats = gj.features ?? [];
    process.stdout.write(`\n==== ${t.slug} (served_codes=${sc.size}, layer_feats=${feats.length}) ====\n`);
    if (!t.muniField) {
      process.stdout.write(`  WHOLE LAYER nearest=${JSON.stringify(nearest(feats, reg))}\n`);
      for (const r of overlapAllFields(feats, sc)) process.stdout.write(`    ${r.field}: distinct=${r.distinct} nnull=${r.nnull} overlap=${r.overlap}%\n`);
      // échantillon de valeurs du meilleur champ suspect
      const zvals = [...new Set(feats.map((f) => String(f.properties?.["ZONE_"] ?? f.properties?.["ZONE"] ?? "")))].slice(0, 15);
      process.stdout.write(`    ZONE(_) sample: ${JSON.stringify(zvals)}\n`);
    } else {
      const groups = new Map<string, Feat[]>();
      for (const f of feats) { const raw = f.properties?.[t.muniField]; if (raw === null || raw === undefined || !String(raw).trim()) continue; const k = String(raw); const arr = groups.get(k) ?? []; arr.push(f); groups.set(k, arr); }
      for (const [v, g] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const near = nearest(g, reg);
        const top = overlapAllFields(g, sc)[0];
        process.stdout.write(`  ${t.muniField}=${v}: feats=${g.length} nearest=${near.slug}(${near.km}km) bestField=${top?.field} overlap=${top?.overlap}%\n`);
      }
    }
    process.stdout.write(`  served sample: ${JSON.stringify([...sc].slice(0, 15))}\n`);
  }
}
main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
