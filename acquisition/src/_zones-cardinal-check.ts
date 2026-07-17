/**
 * _zones-cardinal-check.ts — imprime la position cardinale RÉELLE de chaque zone
 * servie, pour confronter le dépôt à la lecture visuelle du plan.
 *
 * WHY (mémoire projet [[flip180-passe-tous-les-gates]]) : un flip 180° franchit
 * résidu + holdout + gate spatial (le spatial le note parfois MEILLEUR). Le seul
 * test qui le tue est le **cardinal tiers** : comparer où une zone est DESSINÉE
 * sur la feuille (donnée tierce, lue à l'œil) et où elle est SERVIE au sol. Un
 * flip inverse les deux axes ; une pose juste les préserve.
 *
 * Ce script ne juge rien tout seul : il MESURE et imprime. L'agent confronte à sa
 * lecture du plan. Il n'écrit rien et ne sert rien.
 *
 * Usage : npx tsx acquisition/src/_zones-cardinal-check.ts <zones.geojson> [--codes A1-1,A1-3]
 */
import { readFileSync } from "node:fs";

import type { Feature, FeatureCollection, Position } from "geojson";

const path = process.argv[2];
if (!path) {
  console.log("usage: _zones-cardinal-check.ts <zones.geojson> [--codes A,B]");
  process.exit(1);
}
const only = (() => {
  const i = process.argv.indexOf("--codes");
  return i >= 0 && process.argv[i + 1] ? new Set(process.argv[i + 1]!.split(",")) : null;
})();

const fc = JSON.parse(readFileSync(path, "utf8")) as FeatureCollection;

/** Centroïde de surface approché : moyenne des sommets de tous les anneaux. */
function centroid(f: Feature): { lon: number; lat: number } | null {
  const acc: Position[] = [];
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      acc.push(c as Position);
      return;
    }
    for (const s of c) walk(s);
  };
  walk((f.geometry as { coordinates?: unknown })?.coordinates);
  if (!acc.length) return null;
  return {
    lon: acc.reduce((s, p) => s + (p[0] as number), 0) / acc.length,
    lat: acc.reduce((s, p) => s + (p[1] as number), 0) / acc.length,
  };
}

type Row = { code: string; lon: number; lat: number; lots: number };
const rows: Row[] = [];
for (const f of fc.features ?? []) {
  const code = String((f.properties as Record<string, unknown>)?.zone_code ?? "?");
  if (only && !only.has(code)) continue;
  const c = centroid(f);
  if (!c) continue;
  rows.push({ code, lon: c.lon, lat: c.lat, lots: Number((f.properties as Record<string, unknown>)?.n_lots ?? 0) });
}

console.log(`features=${fc.features?.length ?? 0} · mesurées=${rows.length}\n`);
console.log("=== DU NORD AU SUD (lat décroissante) ===");
for (const r of [...rows].sort((a, b) => b.lat - a.lat)) {
  console.log(`  ${r.code.padEnd(10)} lat=${r.lat.toFixed(4)}  lon=${r.lon.toFixed(4)}  lots=${r.lots}`);
}
console.log("\n=== DE L'OUEST A L'EST (lon croissante) ===");
for (const r of [...rows].sort((a, b) => a.lon - b.lon)) {
  console.log(`  ${r.code.padEnd(10)} lon=${r.lon.toFixed(4)}  lat=${r.lat.toFixed(4)}  lots=${r.lots}`);
}
