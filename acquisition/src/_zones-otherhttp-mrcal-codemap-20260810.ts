// Diagnostic sonde (read-only): map each `code` (muni geographic code) in the shared
// sig.mrcal.ca EVALUATION/sde_zonage_s FeatureServer/0 layer to the nearest registry
// municipality (anti-homonym, geometry-grounded), and list distinct `zonage` (zone-code)
// values per code. Also reports rouyn-noranda MUNICIPALITE cardinality. Confirms the
// per-muni WHERE filter + zone-code field before building the capture worklist.
// Run: npx tsx acquisition/src/_zones-otherhttp-mrcal-codemap-20260810.ts
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MRCAL = 'https://sig.mrcal.ca/server/rest/services/EVALUATION/sde_zonage_s/FeatureServer/0';
const CODES = ['79005','79010','79015','79022','79025','79030','79037','79047','79050','79060','79065','79078','79088','79097','79105','79110','79115','NR790'];
const TARGETS = ['chute-saint-philippe','lac-des-ecorces','lascension'];

interface Muni { slug: string; name: string; lat: number; lon: number }
function loadRegistry(): Muni[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, 'packages/qc-sources/src/geo/municipalities.qc.json'), 'utf8')) as any[];
  return raw.map((m) => ({ slug: String(m.slug ?? ''), name: String(m.name ?? ''), lat: Number(m.lat), lon: Number(m.lon) }))
    .filter((m) => m.slug && Number.isFinite(m.lat) && Number.isFinite(m.lon));
}
function haversineKm(a: number, b: number, c: number, d: number): number {
  const R = 6371, dLat = ((c - a) * Math.PI) / 180, dLon = ((d - b) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function* positions(coords: any): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') { yield [coords[0], coords[1]]; return; }
  for (const c of coords) yield* positions(c);
}
async function getJson(url: string): Promise<any> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 60000);
  try { const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

async function main() {
  const reg = loadRegistry();
  const targetReg = reg.filter((m) => TARGETS.includes(m.slug));
  console.log('=== target registry ==='); for (const m of targetReg) console.log(' ', m.slug, m.name, m.lat, m.lon);

  console.log('\n=== per-code centroid -> nearest muni + zonage values ===');
  const map: Record<string, any> = {};
  for (const code of CODES) {
    const url = `${MRCAL}/query?where=${encodeURIComponent(`code='${code}'`)}&outFields=code,zonage&returnGeometry=true&outSR=4326&f=geojson`;
    let gj: any;
    try { gj = await getJson(url); } catch (e) { console.log(code, 'ERROR', (e as Error).message); continue; }
    const feats = gj.features ?? [];
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const zon = new Set<string>();
    for (const f of feats) {
      const z = f.properties?.zonage; if (z != null && String(z).trim()) zon.add(String(z).trim());
      for (const [x, y] of positions(f.geometry?.coordinates)) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    }
    const clat = (miny + maxy) / 2, clon = (minx + maxx) / 2;
    let best: { slug: string; km: number } | null = null;
    for (const m of reg) { const km = haversineKm(m.lat, m.lon, clat, clon); if (!best || km < best.km) best = { slug: m.slug, km }; }
    map[code] = { nearest: best?.slug, km: best ? Math.round(best.km * 100) / 100 : null, features: feats.length, distinct_zonage: zon.size, sample_zonage: [...zon].slice(0, 8) };
    console.log(`${code}: nearest=${best?.slug} km=${map[code].km} feats=${feats.length} distinct_zonage=${zon.size} sample=${JSON.stringify([...zon].slice(0,8))}`);
  }
  console.log('\n=== CODE for each TARGET (nearest match) ===');
  for (const slug of TARGETS) {
    const hits = Object.entries(map).filter(([, v]) => v.nearest === slug).map(([c]) => c);
    console.log(`  ${slug}: code(s)=${JSON.stringify(hits)}`);
  }

  console.log('\n=== rouyn-noranda MUNICIPALITE cardinality ===');
  const rn = 'https://carte.rouyn-noranda.ca/arcgis/rest/services/Donnees_ouvertes/Donnees_ouvertes/MapServer/5';
  try {
    const grp = await getJson(`${rn}/query?where=1%3D1&groupByFieldsForStatistics=MUNICIPALITE&outStatistics=%5B%7B%22statisticType%22%3A%22count%22%2C%22onStatisticField%22%3A%22OBJECTID%22%2C%22outStatisticFieldName%22%3A%22n%22%7D%5D&returnGeometry=false&f=json`);
    console.log('  MUNICIPALITE groups=', JSON.stringify(grp.features?.map((f: any) => f.attributes)));
    const cnt = await getJson(`${rn}/query?where=1%3D1&returnCountOnly=true&f=json`);
    console.log('  total count=', cnt.count);
  } catch (e) { console.log('  rn ERROR', (e as Error).message); }
}
main().catch((e) => { console.error(e); process.exit(1); });
