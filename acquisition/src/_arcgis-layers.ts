/**
 * _arcgis-layers.ts — diagnostic (lecture seule)
 * Liste id/name/geometryType des layers d'un MapServer/FeatureServer JSON déjà
 * téléchargé, et surligne ceux dont le nom évoque le zonage/affectation.
 * USAGE : npx tsx acquisition/src/_arcgis-layers.ts <mapserver.json>
 */
import { readFileSync } from "node:fs";

const p = process.argv[2];
if (!p) { console.error("usage: <mapserver.json>"); process.exit(2); }
const j = JSON.parse(readFileSync(p, "utf8"));
const layers: Array<{ id: number; name: string; geometryType?: string; type?: string; subLayerIds?: number[] }> =
  [...(j.layers ?? []), ...(j.tables ?? [])];
const ZON = /zonage|zone|affectation|urbanis|r[eè]glement|usage|grille/i;
console.log(`[layers] ${layers.length} layers/tables in ${p}`);
for (const l of layers) {
  const flag = ZON.test(l.name ?? "") ? "  <== ZONAGE?" : "";
  const grp = l.subLayerIds ? ` group[${l.subLayerIds.join(",")}]` : "";
  console.log(`${String(l.id).padStart(4)} | ${l.geometryType ?? l.type ?? ""} | ${l.name}${grp}${flag}`);
}
