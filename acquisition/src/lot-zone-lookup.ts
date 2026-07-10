/**
 * lot-zone-lookup.ts -- inspect the deposited LOT -> ZONE -> NORMS assignment for
 * one or more specific cadastral lots.
 *
 * Read-only diagnostic over the `normalized/qc-lot-zonage/<slug>.parquet` deposit
 * produced by lot-zone-join-run.ts. Matches lots by digit-only lot number so the
 * caller can pass "5094305", "5 094 305", or "5-094-305" interchangeably. Prints
 * the assigned zone_code, dominant_fraction, multi_zone flag, and (if present) a
 * short preview of the folded norms. Anti-invention: reports exactly what is
 * deposited; a lot with no row or no zone is reported as such, never guessed.
 *
 * Usage:
 *   tsx src/lot-zone-lookup.ts --slug mont-tremblant --lots "5094305,4651262"
 */
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

import { getBytes, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { haversineKm } from "./lib/zone-serve.js";

const OUT_PREFIX = "normalized/qc-lot-zonage/";
const CAD_PREFIX = "normalized/qc-cadastre-lots/";
const ZONES_PREFIX = "normalized/ca-qc-zonage/";

function arg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf("--" + key);
  return i >= 0 ? argv[i + 1] : undefined;
}

function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function coordsOf(geom: Geometry | null): Position[] {
  const out: Position[] = [];
  const walk = (g: Geometry | null): void => {
    if (!g) return;
    if (g.type === "Polygon") for (const r of g.coordinates) out.push(...r);
    else if (g.type === "MultiPolygon") for (const p of g.coordinates) for (const r of p) out.push(...r);
    else if (g.type === "Point") out.push(g.coordinates);
  };
  walk(geom);
  return out;
}

function centroidOf(geom: Geometry | null): [number, number] | null {
  const cs = coordsOf(geom);
  if (cs.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const c of cs) {
    sx += c[0]!;
    sy += c[1]!;
  }
  return [sx / cs.length, sy / cs.length];
}

function lotNumberOf(props: Record<string, unknown> | null): unknown {
  const p = props ?? {};
  return p["NO_LOT"] ?? p["no_lot"] ?? p["noLot"] ?? p["lot_id"] ?? p["geoId"] ?? p["id"] ?? null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slug = arg(argv, "slug");
  const lotsArg = arg(argv, "lots") ?? arg(argv, "lot");
  if (!slug || !lotsArg) throw new Error('usage: tsx src/lot-zone-lookup.ts --slug <slug> --lots "5094305,4651262"');
  const wanted = new Set(lotsArg.split(",").map((l) => digitsOnly(l)).filter(Boolean));

  const s3 = s3Client();
  const key = `${OUT_PREFIX}${slug}.parquet`;
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, key), [
    "lot_id",
    "zone_code",
    "dominant_fraction",
    "multi_zone",
    "zone_codes",
    "norms",
  ]);
  console.log(`LOOKUP ${slug} parquet=${key} rows=${rows.length} wanted=${[...wanted].join(",")}`);

  for (const want of wanted) {
    const hits = rows.filter((r) => digitsOnly(r["lot_id"]) === want);
    if (hits.length === 0) {
      console.log(`  lot=${want} -> ABSENT (no row in deposit)`);
      continue;
    }
    for (const r of hits) {
      const zone = r["zone_code"] === null || r["zone_code"] === undefined ? "UNASSIGNED" : String(r["zone_code"]);
      let normFields = "-";
      if (r["norms"]) {
        try {
          const n = JSON.parse(String(r["norms"])) as Record<string, unknown>;
          normFields = Object.keys(n)
            .filter((k) => k !== "zone_code" && !k.startsWith("_") && n[k] !== null && n[k] !== undefined)
            .slice(0, 8)
            .join(",");
        } catch {
          normFields = "unparseable";
        }
      }
      console.log(
        `  lot=${String(r["lot_id"])} zone_code=${zone} dominant_fraction=${String(r["dominant_fraction"])} ` +
          `multi_zone=${String(r["multi_zone"])} zone_codes=${JSON.stringify(r["zone_codes"] ?? [])} norms=[${normFields}]`,
      );
    }
  }

  if (!argv.includes("--with-centroid")) return;

  // Locate each wanted lot in the cadastre and report its centroid + the nearest
  // served zone feature (interior point) so we can see whether an UNASSIGNED lot
  // is out of the served plan's reach or just missing a nearby label.
  const cad = (await getGeoJsonFeatureCollection<Feature<Geometry, Record<string, unknown> | null>>(
    s3,
    `${CAD_PREFIX}${slug}.geojson`,
  )) as FeatureCollection<Geometry, Record<string, unknown> | null>;
  const zones = (await getGeoJsonFeatureCollection<Feature<Geometry, Record<string, unknown> | null>>(
    s3,
    `${ZONES_PREFIX}qc-zonage-${slug}.geojson`,
  )) as FeatureCollection<Geometry, Record<string, unknown> | null>;
  const zonePoints = zones.features
    .map((f) => ({ code: String((f.properties ?? {})["zone_code"] ?? "?"), c: centroidOf(f.geometry) }))
    .filter((z): z is { code: string; c: [number, number] } => z.c !== null);

  for (const want of wanted) {
    const feat = cad.features.find((f) => digitsOnly(lotNumberOf(f.properties)) === want);
    if (!feat) {
      console.log(`  CENTROID lot=${want} -> NOT IN CADASTRE`);
      continue;
    }
    const c = centroidOf(feat.geometry);
    if (!c) {
      console.log(`  CENTROID lot=${want} -> no geometry`);
      continue;
    }
    let nearest = { code: "?", km: Infinity };
    for (const z of zonePoints) {
      const km = haversineKm(c, z.c);
      if (km < nearest.km) nearest = { code: z.code, km };
    }
    console.log(
      `  CENTROID lot=${want} lon=${c[0].toFixed(6)} lat=${c[1].toFixed(6)} ` +
        `nearest_served_zone=${nearest.code} dist=${nearest.km.toFixed(2)}km`,
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
