/**
 * Sonde READ-ONLY : chiffre l'artefact col-2 par TOLÉRANCE DE FRONTIÈRE, pour le
 * dossier décision A/B (demande geo-cond geocond-jointures-ack-evidence-circularity-t2014).
 *
 * Garde-fou anti-circularité (geo-cond) : un audit « cohérence aire-majorité »
 * alors que l'assignation EST aire-majorité serait TAUTOLOGIQUE (100% par
 * construction, gaming). Le bon signal indépendant = la DISTANCE MÉTRIQUE du
 * centroïde du lot à sa zone `code_zone` ASSIGNÉE (géométrie servie courante).
 * Si un lot « misassigned » (centroïde hors zone assignée) a son centroïde à
 * quelques mètres de la frontière de sa zone assignée, c'est un artefact de
 * DÉSALIGNEMENT cadastre↔zonage, PAS une erreur. Ce script chiffre la
 * distribution de ces distances → à quelle tolérance X (m) le mismatch s'effondre.
 *
 * Réutilise les helpers EXACTS de l'audit KPI (loadFC/polygonsOf/lotCentroid/
 * inCode/assignedCode) + projConstants (frame métrique local, comme lot-zone-join).
 * Aucune écriture S3. HOLD respecté (mesure only).
 *
 * Usage (racine dépôt) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_col2-boundary-tolerance-quantify.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client } from "./lib/s3.js";
import { loadFC, polygonsOf, lotCentroid, inCode, assignedCode, type Poly } from "./lot-zone-consistency-audit.js";
import { projConstants } from "./lib/t1-zones.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "work/coverage/col2-boundary-tolerance-quantify-20260810.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const LOTS_PREFIX = "normalized/qc-lots/";
const SLUGS = ["saint-hyacinthe", "varennes", "ormstown"]; // cas propres (aire-maj vs v2 courante)
const TOLERANCES_M = [0, 2, 5, 10, 25, 50];

type Pt = [number, number];

function distPointToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Distance métrique min du point aux bords de polygones, en frame local (mlon,mlat). */
function distPointToPolys(p: Pt, polys: Poly[], mlon: number, mlat: number): number {
  const pm: Pt = [p[0] * mlon, p[1] * mlat];
  let best = Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const a: Pt = [ring[i]![0]! * mlon, ring[i]![1]! * mlat];
        const b: Pt = [ring[i + 1]![0]! * mlon, ring[i + 1]![1]! * mlat];
        const d = distPointToSeg(pm, a, b);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

async function main(): Promise<void> {
  const s3 = s3Client();
  const rows: Record<string, unknown>[] = [];

  for (const slug of SLUGS) {
    const zones = await loadFC(s3, [`${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`, `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`]);
    const lots = await loadFC(s3, [`${LOTS_PREFIX}qc-lots-${slug}.geojson`, `${LOTS_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`]);
    if (!zones || !lots) { rows.push({ slug, note: !zones ? "qc-zonage non servi" : "qc-lots non servi" }); continue; }

    const zoneIndex = new Map<string, Poly[]>();
    let latSum = 0, latN = 0;
    for (const z of zones) {
      const code = assignedCode(z.properties);
      if (!code) continue;
      const polys = polygonsOf(z.geometry);
      if (!polys.length) continue;
      (zoneIndex.get(code) ?? zoneIndex.set(code, []).get(code)!).push(...polys);
      for (const poly of polys) for (const ring of poly) for (const pt of ring) { latSum += pt[1]!; latN++; }
    }
    const lat0 = latN ? latSum / latN : 46;
    const { mlon, mlat } = projConstants(lat0);

    let assigned = 0, matched = 0, misassigned = 0, outside = 0;
    const distBuckets = TOLERANCES_M.map(() => 0); // misassigned dont dist ≤ tol
    const dists: number[] = [];
    for (const lot of lots) {
      const code = assignedCode(lot.properties);
      if (!code) continue;
      const c = lotCentroid(lot.geometry) as Pt | null;
      if (!c) continue;
      assigned++;
      if (inCode(c, zoneIndex.get(code))) { matched++; continue; }
      // hors zone assignée → est-ce dans une AUTRE zone (misassigned) ou nulle part (outside) ?
      let inOther = false;
      for (const [zc, polys] of zoneIndex) { if (zc !== code && inCode(c, polys)) { inOther = true; break; } }
      if (!inOther) { outside++; continue; }
      misassigned++;
      const d = distPointToPolys(c, zoneIndex.get(code) ?? [], mlon, mlat);
      dists.push(d);
      for (let i = 0; i < TOLERANCES_M.length; i++) if (d <= TOLERANCES_M[i]!) distBuckets[i]!++;
    }
    // mismatch au sens KPI = (misassigned+outside)/assigned ; avec tolérance X, un
    // misassigned dont dist≤X est reclassé "matched-within-tolerance".
    const pct = (n: number): number => (assigned ? Math.round((n / assigned) * 10000) / 100 : 0);
    const mismatchByTol = TOLERANCES_M.map((tol, i) => ({
      tolerance_m: tol,
      mismatch_pct: pct(misassigned - distBuckets[i]! + outside),
      misassigned_within_tol: distBuckets[i]!,
    }));
    dists.sort((a, b) => a - b);
    const median = dists.length ? dists[Math.floor(dists.length / 2)]! : null;
    rows.push({
      slug, assigned, matched, misassigned, outside,
      mismatch_pct_strict: pct(misassigned + outside),
      misassigned_centroid_dist_median_m: median === null ? null : Math.round(median * 100) / 100,
      mismatch_by_tolerance: mismatchByTol,
    });
    process.stdout.write(
      `${slug} assigned=${assigned} strict_mismatch=${pct(misassigned + outside)}% misassigned=${misassigned} ` +
        `dist_median=${median === null ? "—" : median.toFixed(1)}m | ` +
        mismatchByTol.map((m) => `${m.tolerance_m}m:${m.mismatch_pct}%`).join(" ") + "\n",
    );
  }

  const artifact = {
    contract: "col2-boundary-tolerance-quantify/20260810",
    purpose: "Distance métrique centroïde→zone assignée des lots misassigned : à quelle tolérance X(m) le mismatch col-2 s'effondre (= preuve non-tautologique de l'artefact désalignement, garde-fou anti-circularité geo-cond).",
    method: "helpers KPI exacts (auditCity) + distance point-bords en frame local-equirectangulaire (projConstants). misassigned dont centroïde ≤ X m de sa zone assignée = artefact de frontière.",
    slugs: SLUGS,
    cities: rows,
  };
  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`OUT ${OUT}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exitCode = 2; });
