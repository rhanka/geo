// Diagnostic sonde (read-only): pre-check source-identity overlap BEFORE spending a capture job.
// For each candidate muni, read the SERVED collection zone_code values from S3 and compare with
// the LIVE source zone-code field values, reporting overlap% (served codes covered by source) and
// whether the served already carries a v2 proof (out of upgrade scope). De-risks the deposit.
// Run: NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
//   npx tsx acquisition/src/_zones-otherhttp-overlap-precheck-20260810.ts
import { exists, getBytes, s3Client } from './lib/s3.js';

const S3_PREFIX = 'normalized/ca-qc-zonage/';
const ISO = /^sha256:[a-f0-9]{64}$/;
function canon(v: unknown): string { return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

interface Cand { slug: string; url: string; field: string }
const CANDS: Cand[] = [
  { slug: 'chute-saint-philippe', field: 'zonage', url: "https://sig.mrcal.ca/server/rest/services/EVALUATION/sde_zonage_s/FeatureServer/0/query?where=code%3D%2779065%27&outFields=zonage&returnGeometry=false&f=json" },
  { slug: 'lac-des-ecorces', field: 'zonage', url: "https://sig.mrcal.ca/server/rest/services/EVALUATION/sde_zonage_s/FeatureServer/0/query?where=code%3D%2779078%27&outFields=zonage&returnGeometry=false&f=json" },
  { slug: 'lascension', field: 'zonage', url: "https://sig.mrcal.ca/server/rest/services/EVALUATION/sde_zonage_s/FeatureServer/0/query?where=code%3D%2779050%27&outFields=zonage&returnGeometry=false&f=json" },
  { slug: 'rouyn-noranda', field: 'NO_ZONE', url: "https://carte.rouyn-noranda.ca/arcgis/rest/services/Donnees_ouvertes/Donnees_ouvertes/MapServer/5/query?where=1%3D1&outFields=NO_ZONE&returnGeometry=false&resultRecordCount=4000&f=json" },
];

async function getJson(url: string): Promise<any> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 60000);
  try { const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
function keyFor(slug: string) { return { flat: `${S3_PREFIX}qc-zonage-${slug}.geojson`, nested: `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` }; }

async function main() {
  const s3 = s3Client();
  for (const c of CANDS) {
    const out: any = { slug: c.slug, field: c.field };
    // served
    const { flat, nested } = keyFor(c.slug);
    const keys: string[] = [];
    if (await exists(s3, flat)) keys.push(flat);
    if (await exists(s3, nested)) keys.push(nested);
    const served = new Set<string>(); let features = 0; let levels = new Set<string>(); let hasV2 = false;
    for (const k of keys) {
      const fc = JSON.parse((await getBytes(s3, k)).toString('utf8'));
      if (fc.proof?.schema_version === '2.0') hasV2 = true;
      const feats = fc.features ?? []; features = Math.max(features, feats.length);
      for (const f of feats) {
        const p = f.properties ?? {};
        const z = canon(p.zone_code); if (z) served.add(z);
        levels.add(typeof p.zone_source_level === 'string' ? p.zone_source_level : '(none)');
        const gs = f.properties?.proof?.geometry_source;
        if (gs && typeof gs.sha256 === 'string' && ISO.test(gs.sha256)) hasV2 = true;
      }
    }
    out.served_keys = keys; out.served_features = features; out.served_distinct_codes = served.size;
    out.served_levels = [...levels].sort(); out.served_has_v2_proof = hasV2;
    // source
    let src = new Set<string>(); let srcCount = 0; let err: string | null = null;
    try {
      const gj = await getJson(c.url);
      if (gj.error) { err = JSON.stringify(gj.error).slice(0, 120); }
      const feats = gj.features ?? []; srcCount = feats.length;
      for (const f of feats) { const z = canon(f.attributes?.[c.field]); if (z) src.add(z); }
      out.source_exceededTransferLimit = gj.exceededTransferLimit === true;
    } catch (e) { err = (e as Error).message; }
    out.source_error = err; out.source_features = srcCount; out.source_distinct_codes = src.size;
    // overlap: served codes covered by source
    const uncovered = [...served].filter((z) => !src.has(z)).sort();
    const covered = served.size - uncovered.length;
    out.covered = covered; out.uncovered = uncovered.length;
    out.overlap_pct = served.size > 0 ? Math.round((covered / served.size) * 1000) / 10 : null;
    out.uncovered_sample = uncovered.slice(0, 12);
    out.source_sample = [...src].slice(0, 10);
    console.log(JSON.stringify(out));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
