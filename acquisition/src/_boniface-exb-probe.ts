/**
 * _boniface-exb-probe.ts — diagnostic (lecture seule)
 * Résout la config d'une app ArcGIS ExperienceBuilder (portal item data) et
 * énumère les data sources FeatureServer/MapServer référencées, puis liste les
 * layers dont le nom évoque le zonage/affectation. But: trouver une géométrie de
 * zonage MUNICIPAL EN VIGUEUR pour saint-boniface (codes num. 101-105), PAS une
 * couche d'affectation/CPTAQ décorative.
 * USAGE : npx tsx acquisition/src/_boniface-exb-probe.ts <portalItemId> <portalBase>
 */
const itemId = process.argv[2] ?? "1d197457c38f4586a2defe89463f7054";
const base = (process.argv[3] ?? "https://carto2.mrc-maskinonge.qc.ca/portal").replace(/\/$/, "");
const ZON = /zonage|\bzone\b|affectation|urbanis|r[eè]glement|usage|grille|pz|cptaq/i;

async function j(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 geo-diagnostic" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function collectUrls(obj: any, out: Set<string>) {
  if (obj == null) return;
  if (typeof obj === "string") {
    if (/https?:\/\/[^\s"']*(FeatureServer|MapServer)/i.test(obj)) out.add(obj);
    return;
  }
  if (Array.isArray(obj)) { for (const v of obj) collectUrls(v, out); return; }
  if (typeof obj === "object") { for (const v of Object.values(obj)) collectUrls(v, out); }
}

(async () => {
  const dataUrl = `${base}/sharing/rest/content/items/${itemId}/data?f=json`;
  console.log(`[exb] fetch ${dataUrl}`);
  let cfg: any;
  try { cfg = await j(dataUrl); } catch (e) { console.error(`[exb] item data failed: ${(e as Error).message}`); process.exit(1); }
  const urls = new Set<string>();
  collectUrls(cfg, urls);
  // normalize FeatureServer/MapServer roots
  const roots = new Set<string>();
  for (const u of urls) {
    const m = u.match(/^(https?:\/\/.*?\/(?:FeatureServer|MapServer))/i);
    if (m) roots.add(m[1]);
  }
  console.log(`[exb] ${urls.size} service urls, ${roots.size} distinct roots`);
  for (const root of roots) {
    console.log(`\n=== ${root}`);
    try {
      const meta = await j(`${root}?f=json`);
      const layers = [...(meta.layers ?? []), ...(meta.tables ?? [])];
      for (const l of layers) {
        const flag = ZON.test(l.name ?? "") ? "  <== ZONAGE?" : "";
        console.log(`  ${String(l.id).padStart(3)} | ${l.geometryType ?? l.type ?? ""} | ${l.name}${flag}`);
      }
    } catch (e) { console.log(`  (root meta failed: ${(e as Error).message})`); }
  }
})();

export {};
