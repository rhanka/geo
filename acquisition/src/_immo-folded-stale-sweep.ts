/**
 * _immo-folded-stale-sweep.ts — distingue STALE (immo-lots lane) de CEILING
 * (normes lane) parmi les munis folded-normes bas.
 *
 * Le folded% bas a deux causes très différentes :
 *   STALE   : les codes de zone servis recouvrent LARGEMENT les codes normes
 *             (ratio common/zones élevé) mais le geojson servi n'a jamais été
 *             foldé -> lot-zone-join + lots-enriched LE corrige (ma lane).
 *   CEILING : la grille normes ne couvre qu'une fraction des zones
 *             (ratio bas) -> déficit STRUCTUREL amont (grille incomplète) =
 *             lane normes. Re-enrich ne gagne RIEN.
 *
 * Le discriminant décisif est le ratio common/zones (proxy $0 du match-rate),
 * PAS le simple fait que la ville ait des normes. Lecture seule S3.
 *
 *   tsx src/_immo-folded-stale-sweep.ts [--max-folded 5] [--min-lots 400] \
 *       [--max-lots 50000] [--ratio 0.7] [--limit 120]
 */
import { readFile } from "node:fs/promises";

import type { S3Client } from "@aws-sdk/client-s3";
import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { exists, getBytes, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

const ZONES_PREFIX = "normalized/ca-qc-zonage/";
const NORMS_PREFIX = "registry/qc-zonage-norms/";

interface PerMuni {
  slug: string;
  numLots: number;
  normesStatus?: string;
  fieldPct: Record<string, number>;
}

function num(name: string, d: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : d;
}

async function resolveZonesKey(s3: S3Client, slug: string): Promise<string | null> {
  for (const key of [
    `${ZONES_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONES_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ]) {
    if (await exists(s3, key)) return key;
  }
  return null;
}

async function normsCodes(s3: S3Client, key: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const row of await readParquetRowsFromBuffer(await getBytes(s3, key))) {
    const c = row["zone_code"];
    if (c === null || c === undefined || !String(c).trim()) continue;
    out.add(canonicalizeZoneCodeForJoin(String(c)));
  }
  return out;
}

async function zoneCodes(s3: S3Client, key: string): Promise<Set<string>> {
  const out = new Set<string>();
  const fc = (await getGeoJsonFeatureCollection(s3, key)) as {
    features?: Array<{ properties?: Record<string, unknown> | null }>;
  };
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    for (const k of ["zone_code", "Zonage", "code_zone", "ZONE", "zone"]) {
      const v = p[k];
      if (v !== null && v !== undefined && String(v).trim()) {
        out.add(canonicalizeZoneCodeForJoin(String(v)));
        break;
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const maxFolded = num("max-folded", 5);
  const minLots = num("min-lots", 400);
  const maxLots = num("max-lots", 50000);
  const ratioBar = num("ratio", 0.7);
  const limit = num("limit", 120);

  const audit = JSON.parse(await readFile("work/coverage/immo-lots.json", "utf8")) as { perMuni: PerMuni[] };
  let rows = audit.perMuni
    .filter((m) => (m.fieldPct["folded-normes"] ?? 0) <= maxFolded)
    .filter((m) => m.normesStatus === "done")
    .filter((m) => m.numLots >= minLots && m.numLots <= maxLots)
    .sort((a, b) => b.numLots - a.numLots);
  if (limit > 0) rows = rows.slice(0, limit);

  const s3 = s3Client();
  const stale: string[] = [];
  console.log(`sweep folded<=${maxFolded}% normes=done lots∈[${minLots},${maxLots}] ratio>=${ratioBar} n=${rows.length}`);
  for (const m of rows) {
    try {
      const zk = await resolveZonesKey(s3, m.slug);
      const nk = `${NORMS_PREFIX}qc-zonage-norms-${m.slug}.parquet`;
      if (!zk || !(await exists(s3, nk))) {
        console.log(`SKIP ${m.slug} lots=${m.numLots} (no zones or norms deposit)`);
        continue;
      }
      const [zc, nc] = await Promise.all([zoneCodes(s3, zk), normsCodes(s3, nk)]);
      let common = 0;
      for (const c of zc) if (nc.has(c)) common++;
      const ratio = zc.size ? common / zc.size : 0;
      const verdict = ratio >= ratioBar && common > 0 ? "STALE" : "CEILING";
      if (verdict === "STALE") stale.push(m.slug);
      console.log(
        `${verdict}\t${m.slug}\tlots=${m.numLots}\tfolded=${(m.fieldPct["folded-normes"] ?? 0).toFixed(1)}%\t` +
          `zones=${zc.size} normes=${nc.size} common=${common} ratio=${ratio.toFixed(2)}`,
      );
    } catch (e) {
      console.log(`ERR ${m.slug} ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nSTALE (${stale.length}): ${stale.join(",")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
