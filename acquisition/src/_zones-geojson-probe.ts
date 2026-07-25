// Probe a local zoning GeoJSON: feature count, property keys, candidate zone_code values.
// Usage: npx tsx acquisition/src/_zones-geojson-probe.ts <path>
import { readFileSync } from 'node:fs';
const p = process.argv[2];
const raw = JSON.parse(readFileSync(p, 'utf8'));
const feats: any[] = raw.features || [];
console.log('name', raw.name, 'type', raw.type, 'features', feats.length);
const keyCount: Record<string, number> = {};
for (const f of feats) for (const k of Object.keys(f.properties || {})) keyCount[k] = (keyCount[k] || 0) + 1;
console.log('property keys:', JSON.stringify(keyCount));
// sample first 5 features' properties
for (const f of feats.slice(0, 5)) console.log('props', JSON.stringify(f.properties));
// find likely zone code field: distinct non-numeric-only values
for (const k of Object.keys(keyCount)) {
  const vals = feats.map((f) => f.properties?.[k]).filter((v) => v != null);
  const distinct = new Set(vals.map((v) => String(v)));
  const lettered = [...distinct].filter((v) => /[A-Za-z].*\d|\d.*[A-Za-z]/.test(v));
  console.log(`  field ${k}: distinct=${distinct.size} lettered=${lettered.length} sample=${JSON.stringify([...distinct].slice(0, 8))}`);
}
const geomTypes: Record<string, number> = {};
for (const f of feats) geomTypes[f.geometry?.type || 'null'] = (geomTypes[f.geometry?.type || 'null'] || 0) + 1;
console.log('geom types', JSON.stringify(geomTypes));
