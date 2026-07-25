/**
 * _boniface-carto-extract.ts — diagnostic (lecture seule)
 * Extrait de TOUTES les pages HTML harvestées d'un slug les URLs qui ressemblent
 * à un service GIS (carto/arcgis/wfs/wms/jmap/igo/goazimut/MapServer/FeatureServer/
 * GetCapabilities/geoserver), pour retrouver la source vectorielle EN VIGUEUR.
 * USAGE : npx tsx acquisition/src/_boniface-carto-extract.ts <dir>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "work/zonage-norms/saint-boniface";
const SERVICE_RE = /https?:\/\/[^\s"'<>()\\]+/gi;
const KEEP = /carto|arcgis|wfs|wms|jmap|k2geospatial|igo|geoegl|goazimut|gonet|mapserver|featureserver|getcapabilities|geoserver|maskinonge|azimut|sigale|geocentriq|token/i;

const hits = new Map<string, Set<string>>(); // url -> files
for (const f of readdirSync(dir)) {
  const p = join(dir, f);
  if (!statSync(p).isFile() || !/\.html?$/i.test(f)) continue;
  const html = readFileSync(p, "latin1"); // pages iso-8859-1
  const m = html.match(SERVICE_RE) ?? [];
  for (const u0 of m) {
    const u = u0.replace(/&amp;/g, "&");
    if (!KEEP.test(u)) continue;
    if (!hits.has(u)) hits.set(u, new Set());
    hits.get(u)!.add(f);
  }
}
const rows = [...hits.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log(`[extract] ${rows.length} service-like URLs in ${dir}`);
for (const [u, files] of rows) console.log(`${u}\t<= ${[...files].join(",")}`);
