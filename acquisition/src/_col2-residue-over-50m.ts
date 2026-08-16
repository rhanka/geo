/**
 * Sonde READ-ONLY : liste le RÉSIDU col-2 « vraie erreur » — les lots misassigned
 * dont le centroïde est à > seuil (50 m) de sa zone `code_zone` ASSIGNÉE, donc NON
 * explicable par le slop de frontière cadastre↔zonage. Demande geo-cond
 * (geocond-jointures-ack-tolerance-t2020) : ce résidu (~0,5-1,2%) ne doit PAS être
 * absorbé par la tolérance — c'est la part à garder mismatch + investiguer lot-par-lot.
 *
 * Réutilise les helpers EXACTS de l'audit KPI + la distance métrique (frame local).
 * Aucune écriture S3. HOLD respecté (mesure only).
 *
 * Usage (racine dépôt) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_col2-residue-over-50m.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client } from "./lib/s3.js";
import { loadFC, polygonsOf, lotCentroid, inCode, assignedCode, type Poly } from "./lot-zone-consistency-audit.js";
import { projConstants } from "./lib/t1-zones.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "work/coverage/col2-residue-over-50m-20260810.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const LOTS_PREFIX = "normalized/qc-lots/";
const SLUGS = ["saint-hyacinthe", "varennes", "ormstown"];
const THRESHOLD_M = 50;
const LIST_CAP = 120; // liste bornée par ville (les plus profonds), compte total conservé

type Pt = [number, number];

function distPointToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function distPointToPolys(p: Pt, polys: Poly[], mlon: number, mlat: number): number {
  const pm: Pt = [p[0] * mlon, p[1] * mlat];
  let best = Infinity;
  for (const poly of polys) for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
    const a: Pt = [ring[i]![0]! * mlon, ring[i]![1]! * mlat];
    const b: Pt = [ring[i + 1]![0]! * mlon, ring[i + 1]![1]! * mlat];
    const d = distPointToSeg(pm, a, b);
    if (d < best) best = d;
  }
  return best;
}
function noLotOf(p?: Record<string, unknown>): string {
  for (const k of ["no_lot", "NO_LOT", "lot", "numero_lot", "lot_id"]) {
    const v = p?.[k];
    if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
  }
  return "?";
}

async function main(): Promise<void> {
  const s3 = s3Client();
  const cities: Record<string, unknown>[] = [];

  for (const slug of SLUGS) {
    const zones = await loadFC(s3, [`${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`, `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`]);
    const lots = await loadFC(s3, [`${LOTS_PREFIX}qc-lots-${slug}.geojson`, `${LOTS_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`]);
    if (!zones || !lots) { cities.push({ slug, note: !zones ? "qc-zonage non servi" : "qc-lots non servi" }); continue; }

    const zoneIndex = new Map<string, Poly[]>();
    let latSum = 0, latN = 0;
    for (const z of zones) {
      const code = assignedCode(z.properties);
      if (!code) continue;
      const polys = polygonsOf(z.geometry);
      if (!polys.length) continue;
      const arr = zoneIndex.get(code) ?? [];
      arr.push(...polys);
      zoneIndex.set(code, arr);
      for (const poly of polys) for (const ring of poly) for (const pt of ring) { latSum += pt[1]!; latN++; }
    }
    const lat0 = latN ? latSum / latN : 46;
    const { mlon, mlat } = projConstants(lat0);

    const residue: Array<{ no_lot: string; assigned: string; actual: string[]; dist_m: number; multi_zone: boolean }> = [];
    let residueCount = 0;
    for (const lot of lots) {
      const code = assignedCode(lot.properties);
      if (!code) continue;
      const c = lotCentroid(lot.geometry) as Pt | null;
      if (!c) continue;
      if (inCode(c, zoneIndex.get(code))) continue;
      const actual: string[] = [];
      for (const [zc, polys] of zoneIndex) { if (zc !== code && inCode(c, polys)) { actual.push(zc); if (actual.length >= 3) break; } }
      if (actual.length === 0) continue; // outside_all, hors périmètre de ce résidu (zone-error, pas lot-error)
      const d = distPointToPolys(c, zoneIndex.get(code) ?? [], mlon, mlat);
      if (d <= THRESHOLD_M) continue;
      residueCount++;
      residue.push({ no_lot: noLotOf(lot.properties), assigned: code, actual, dist_m: Math.round(d * 10) / 10, multi_zone: lot.properties?.["multi_zone"] === true });
    }
    residue.sort((a, b) => b.dist_m - a.dist_m);
    cities.push({
      slug, threshold_m: THRESHOLD_M, residue_count: residueCount,
      residue_multi_zone: residue.filter((r) => r.multi_zone).length,
      residue_mono_zone: residue.filter((r) => !r.multi_zone).length,
      listed: Math.min(residueCount, LIST_CAP),
      residue_lots: residue.slice(0, LIST_CAP),
    });
    process.stdout.write(`${slug} residue>50m=${residueCount} (multi=${residue.filter((r) => r.multi_zone).length} mono=${residue.filter((r) => !r.multi_zone).length}) listed=${Math.min(residueCount, LIST_CAP)}\n`);
  }

  const artifact = {
    contract: "col2-residue-over-50m/20260810",
    purpose: "Résidu col-2 'vraie erreur' : lots misassigned dont le centroïde est > 50 m de sa zone assignée (non-explicable par slop de frontière). À garder mismatch même sous tolérance; candidats investigation lot-par-lot (demande geo-cond t2020).",
    threshold_m: THRESHOLD_M,
    method: "helpers KPI exacts + distance point→bords en frame local; liste bornée aux plus profonds par ville.",
    cities,
  };
  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`OUT ${OUT}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exitCode = 2; });
