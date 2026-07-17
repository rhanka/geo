/**
 * Falsifie une orientation de recalage par la POSITION CARDINALE de zones repérées.
 *
 * Motif : sur un plan rural point-symétrique, le disambig par lot-assignment (§7.2) peut
 * rester muet (marge tight << 15 pt : les deux rotations sont basses, signature rurale
 * §7.4). Le serving large (1500 m) ne discrimine pas non plus l'orientation (§8). Il faut
 * alors une preuve TIERCE au calage.
 *
 * Ce script en fournit une, décisive et vérifiable : l'opérateur lit sur le plan rendu la
 * position d'une zone (« 202 est tout au NORD, près de Shawinigan »), puis ce script
 * MESURE le centroïde réellement servi de cette zone dans le GeoJSON produit. Un flip 180°
 * inverse les latitudes/longitudes : l'attendu et le mesuré se contredisent. C'est le même
 * principe que la couverture-lots (§8) — une donnée tierce arbitre le calage — mais il
 * discrimine l'ORIENTATION là où les cutoffs sont muets.
 *
 * N'invente rien : ne fait que comparer un ORDRE attendu (saisi par l'opérateur depuis le
 * plan) à l'ordre MESURÉ dans la géométrie servie. Rapporte, ne dépose pas.
 *
 * Usage :
 *   npx tsx acquisition/src/_zone-cardinal-check.ts --geojson <fichier.geojson> \
 *     --north 202 --south 223            # 202 doit être plus au nord que 223
 *     [--east 236 --west 229]            # 236 doit être plus à l'est que 229
 */
import { readFileSync } from "node:fs";
import type { Feature, FeatureCollection, Position } from "geojson";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const path = arg("geojson");
if (!path) throw new Error("required: --geojson <fichier.geojson>");

const fc = JSON.parse(readFileSync(path, "utf8")) as FeatureCollection;

function coords(f: Feature): Position[] {
  const out: Position[] = [];
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") out.push(c as Position);
    else c.forEach(walk);
  };
  walk((f.geometry as { coordinates?: unknown })?.coordinates);
  return out;
}

function centroid(code: string): { lon: number; lat: number; n: number } | undefined {
  const f = fc.features.find((x) => String(x.properties?.zone_code) === code);
  if (!f) return undefined;
  const cs = coords(f);
  if (!cs.length) return undefined;
  const lon = cs.reduce((s, c) => s + Number(c[0]), 0) / cs.length;
  const lat = cs.reduce((s, c) => s + Number(c[1]), 0) / cs.length;
  return { lon, lat, n: cs.length };
}

let failures = 0;
let checks = 0;

function compare(aCode: string, bCode: string, axis: "lat" | "lon", label: string): void {
  const a = centroid(aCode);
  const b = centroid(bCode);
  if (!a || !b) {
    console.log(`  SKIP ${label}: zone ${!a ? aCode : bCode} absente du servi`);
    return;
  }
  checks++;
  const av = axis === "lat" ? a.lat : a.lon;
  const bv = axis === "lat" ? b.lat : b.lon;
  const ok = av > bv;
  const delta = Math.abs(av - bv);
  const unit = axis === "lat" ? "° lat" : "° lon";
  console.log(
    `  ${ok ? "OK  " : "FAIL"} ${label}: ${aCode}=${av.toFixed(4)} vs ${bCode}=${bv.toFixed(4)} (Δ ${delta.toFixed(4)}${unit})`,
  );
  if (!ok) failures++;
}

console.log(`geojson=${path} features=${fc.features.length}`);
console.log("attendu (lu sur le plan) vs mesuré (géométrie servie) :");

const north = arg("north");
const south = arg("south");
if (north && south) compare(north, south, "lat", `${north} plus au NORD que ${south}`);

const east = arg("east");
const west = arg("west");
if (east && west) compare(east, west, "lon", `${east} plus à l'EST que ${west}`);

if (!checks) {
  console.error("ABORT: aucune comparaison exécutable (zones absentes ?)");
  process.exit(1);
}

if (failures) {
  console.error(`\nVERDICT: ORIENTATION FALSIFIÉE — ${failures}/${checks} contradiction(s). NE PAS SERVIR.`);
  process.exit(1);
}
console.log(`\nVERDICT: orientation COHÉRENTE avec le plan — ${checks}/${checks} vérifiée(s).`);
