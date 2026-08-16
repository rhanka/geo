// Diagnostic sonde (read-only): inspect an ArcGIS Web Map /data JSON and summarize its
// operationalLayers — title, url (hosted service ref) OR embedded featureCollection, layerType,
// geometryType, field names, and a few sample feature attribute rows. Used to decide whether a
// www.arcgis.com item (Web Map) exposes a queryable/automatable zoning polygon layer.
// Run: npx tsx acquisition/src/_zones-otherhttp-webmap-inspect-20260810.ts <path-to-webmap-json>
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: <webmap-json>'); process.exit(1); }
const wm = JSON.parse(readFileSync(path, 'utf8'));

const layers: any[] = wm.operationalLayers ?? [];
console.log('operationalLayers=', layers.length);
for (const [i, l] of layers.entries()) {
  console.log(`\n[${i}] title=${JSON.stringify(l.title)} layerType=${l.layerType} id=${l.id}`);
  console.log('    url=', l.url ?? '(none)');
  console.log('    itemId=', l.itemId ?? '(none)');
  const fc = l.featureCollection;
  if (fc && Array.isArray(fc.layers)) {
    for (const [j, sub] of fc.layers.entries()) {
      const ld = sub.layerDefinition ?? {};
      const geomType = ld.geometryType ?? sub.geometryType;
      const fields = (ld.fields ?? []).map((f: any) => f.name);
      const feats = sub.featureSet?.features ?? [];
      console.log(`    embedded-layer[${j}] name=${JSON.stringify(ld.name)} geometryType=${geomType} features=${feats.length}`);
      console.log('      fields=', fields.join(','));
      const displayField = ld.displayField;
      console.log('      displayField=', displayField);
      for (const f of feats.slice(0, 3)) console.log('      sample.attrs=', JSON.stringify(f.attributes));
    }
  }
}
