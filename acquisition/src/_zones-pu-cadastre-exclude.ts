/**
 * _zones-pu-cadastre-exclude.ts — $0 helper: EXCLUDE a périmètre-urbain box from
 * a municipality's cadastre before a T1 rural-sheet build, so the rural sheet's
 * nearest-label aggregation does NOT swallow a village core it never labels
 * (family documented in memory zones-feuillet-perimetre-urbain-lane: the rural
 * sheet flattens the village to a grey "voir feuillet urbain" renvoi with NO
 * zone label inside it — serving it anyway assigns the village's lots the
 * SURROUNDING rural zone_code, a categorical fabrication).
 *
 * This is the mirror of _zones-pu-cadastre-subset.ts (which KEEPS only the PU
 * box, to seed a later chamfer recalage of the urban sheet). Here we KEEP
 * everything EXCEPT the box, so the rural build serves real verbatim codes for
 * the territory it actually labels, and leaves the unlabelled village as an
 * honest hole (0 servi there) instead of a false code.
 *
 * The box is given directly in PDF page points, TOP-LEFT origin (x0,y0,x1,y1),
 * read off a render of the embedded-georef PDF (see geo.topLeftToLonLat) — NOT
 * a fraction, so no pageW/pageH bookkeeping is needed by the caller.
 *
 * Usage:
 *   npx tsx acquisition/src/_zones-pu-cadastre-exclude.ts \
 *     --pdf <georef.pdf> --box x0,y0,x1,y1 \
 *     --cadastre-s3 normalized/qc-cadastre-lots/<slug>.geojson \
 *     --out work/cadastre/<slug>-minus-pu.geojson
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Feature, FeatureCollection, Position } from "geojson";

import { extractGeoRef } from "./lib/t1-georef.js";
import { getBytes, s3Client } from "./lib/s3.js";

function opt(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function centroid(f: Feature): [number, number] | null {
  const g = f.geometry;
  if (!g || g.type === "GeometryCollection") return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      sx += c[0] as number;
      sy += c[1] as number;
      n++;
      return;
    }
    for (const x of c) walk(x);
  };
  walk((g as { coordinates: Position[] }).coordinates);
  return n ? [sx / n, sy / n] : null;
}

async function main(): Promise<void> {
  const pdf = opt("pdf");
  const boxRaw = opt("box");
  const cadastreS3Key = opt("cadastre-s3");
  const outPath = opt("out");
  const padM = Number(opt("pad-m") ?? "150");
  if (!pdf || !boxRaw || !cadastreS3Key || !outPath) {
    throw new Error(
      "required: --pdf <georef.pdf> --box x0,y0,x1,y1 --cadastre-s3 <key> --out <out.geojson>",
    );
  }
  if (!existsSync(pdf)) throw new Error(`introuvable: ${pdf}`);
  const box = boxRaw.split(",").map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) {
    throw new Error(`--box doit être x0,y0,x1,y1 (points PDF, top-left) — reçu ${boxRaw}`);
  }
  const [bx0, by0, bx1, by1] = box as [number, number, number, number];

  const geo = extractGeoRef(readFileSync(pdf), pdf);
  if (!geo) throw new Error(`aucun géoréf embarqué dans ${pdf}`);

  const corners: Array<[number, number]> = [
    [bx0, by0],
    [bx1, by0],
    [bx1, by1],
    [bx0, by1],
  ];
  const ll = corners.map(([x, y]) => geo.topLeftToLonLat(x, y));
  let lon0 = Math.min(...ll.map((p) => p[0]));
  let lon1 = Math.max(...ll.map((p) => p[0]));
  let lat0 = Math.min(...ll.map((p) => p[1]));
  let lat1 = Math.max(...ll.map((p) => p[1]));
  const midLat = (lat0 + lat1) / 2;
  const dLat = padM / 111320;
  const dLon = padM / (111320 * Math.cos((midLat * Math.PI) / 180));
  lon0 -= dLon;
  lon1 += dLon;
  lat0 -= dLat;
  lat1 += dLat;

  console.log(
    `[pu-exclude] geo=${geo.crsName} résidu ${geo.maxResidualM.toFixed(2)}m · box(pt,top-left)=[${box.join(",")}]`,
  );
  console.log(
    `[pu-exclude] bbox exclue (WGS84, pad ${padM}m) = ${lon0.toFixed(6)},${lat0.toFixed(6)},${lon1.toFixed(6)},${lat1.toFixed(6)}`,
  );

  const s3 = s3Client();
  const cadBuf = await getBytes(s3, cadastreS3Key);
  const fc = JSON.parse(cadBuf.toString("utf8")) as FeatureCollection;
  let nExcluded = 0;
  const kept = (fc.features ?? []).filter((f) => {
    const c = centroid(f);
    if (!c) return true;
    const inside = c[0] >= lon0 && c[0] <= lon1 && c[1] >= lat0 && c[1] <= lat1;
    if (inside) nExcluded++;
    return !inside;
  });

  console.log(
    `[pu-exclude] cadastre: ${fc.features?.length ?? 0} lots → ${nExcluded} exclus (PU) → ${kept.length} conservés`,
  );
  if (nExcluded === 0) {
    console.warn("[pu-exclude] AVERTISSEMENT: 0 lot exclu — le --box est peut-être faux (rien filtré)");
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ type: "FeatureCollection", features: kept }));
  console.log(`[pu-exclude] écrit ${outPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
