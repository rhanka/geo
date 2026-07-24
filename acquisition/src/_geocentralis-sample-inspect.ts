/** _geocentralis-sample-inspect.ts — READ-ONLY : inspecte un GeoJSON WFS local.
 * Imprime les clés de props, un échantillon de valeurs identifiantes, et les codes de zone distincts.
 * USAGE : npx tsx acquisition/src/_geocentralis-sample-inspect.ts <path.json>
 */
import { readFileSync } from "node:fs";
const path = process.argv[2]!;
const fc = JSON.parse(readFileSync(path, "utf8"));
const feats: any[] = fc.features ?? [];
console.log(`features=${feats.length} numberMatched=${fc.numberMatched ?? "?"} numberReturned=${fc.numberReturned ?? "?"}`);
const keys = new Set<string>();
for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
console.log("prop_keys:", [...keys].sort().join(", "));
const p0 = feats[0]?.properties ?? {};
const idish: Record<string, unknown> = {};
for (const k of Object.keys(p0)) if (/muni|nom|zon|code|id_/i.test(k)) idish[k] = p0[k];
console.log("sample_feature_identifiers:", JSON.stringify(idish));
// distinct values for label-ish keys
for (const k of ["etiquette_1", "etiquette_2", "etiquette_3", "description", "type_cover", "annee"]) {
  const vals = new Set<string>();
  for (const f of feats) { const v = f.properties?.[k]; if (v != null) vals.add(String(v)); }
  console.log(`distinct[${k}] (${vals.size}):`, [...vals].sort().slice(0, 60).join(" | "));
}
