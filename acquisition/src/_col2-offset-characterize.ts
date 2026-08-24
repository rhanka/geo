/**
 * Sonde READ-ONLY : caractérise les villes col-2 à RÉSIDU DUR dominant (offset
 * systématique) pour ROUTER la correction (part 'vraie erreur', mon lane).
 *
 * geo-lot (scale 529634c5) : quelques villes ont un résidu>50m à ~100% avec une
 * médiane-ratés serrée (~51m) = OFFSET UNIFORME, pas du bruit de bord. Hypothèse :
 * un décalage uniforme entre la couche LOT (cadastre MERN) et la couche ZONE
 * servie = misregistration de SOURCE (datum/version), PAS une erreur d'assignation
 * jointure (un re-fold aire-majorité serait tout aussi décalé). Ce script mesure le
 * VECTEUR d'offset (médiane dx,dy mètres du centroïde du lot au point le plus proche
 * de sa zone assignée) + sa CONSISTANCE → confirme uniforme (→ route source
 * zones/cadastre) vs dispersé (→ vraies erreurs par lot).
 *
 * Réutilise helpers KPI exacts + projConstants. Aucune écriture S3.
 * Usage : NODE_OPTIONS=--dns-result-order=ipv4first npx tsx acquisition/src/_col2-offset-characterize.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client } from "./lib/s3.js";
import { loadFC, polygonsOf, lotCentroid, inCode, assignedCode, type Poly } from "./lot-zone-consistency-audit.js";
import { projConstants } from "./lib/t1-zones.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "work/coverage/col2-offset-characterize-20260815.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const LOTS_PREFIX = "normalized/qc-lots/";
const slugArg = process.argv.indexOf("--slugs");
const SLUGS = slugArg >= 0 && process.argv[slugArg + 1]
  ? process.argv[slugArg + 1]!.split(",").map((s) => s.trim()).filter(Boolean)
  : ["amherst", "boischatel", "beaupre", "mille-isles", "saint-raphael", "saint-hyacinthe"];
const T = 10;

type Pt = [number, number];

/** Point le plus proche sur un segment [a,b] (frame métrique). */
function closestOnSeg(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return [a[0], a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return [a[0] + t * dx, a[1] + t * dy];
}
/** Point le plus proche sur les bords des polygones + distance, en frame métrique. */
function nearestOnPolys(pm: Pt, polys: Poly[], mlon: number, mlat: number): { d: number; q: Pt } {
  let best = Infinity, bq: Pt = pm;
  for (const poly of polys) for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
    const a: Pt = [ring[i]![0]! * mlon, ring[i]![1]! * mlat];
    const b: Pt = [ring[i + 1]![0]! * mlon, ring[i + 1]![1]! * mlat];
    const q = closestOnSeg(pm, a, b);
    const d = Math.hypot(pm[0] - q[0], pm[1] - q[1]);
    if (d < best) { best = d; bq = q; }
  }
  return { d: best, q: bq };
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

async function main(): Promise<void> {
  const s3 = s3Client();
  const cities: Record<string, unknown>[] = [];
  for (const slug of SLUGS) {
    // NESTED avant FLAT — geo-api sert le sous-dossier quand il existe (CLAUDE.md) ;
    // c'est ce que voit immo + ce que scanne le scale geo-lot. Lire flat d'abord
    // donnait des zones PÉRIMÉES sur les villes où flat≠nested (boischatel/beaupre).
    const zones = await loadFC(s3, [`${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`, `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`]);
    const lots = await loadFC(s3, [`${LOTS_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`, `${LOTS_PREFIX}qc-lots-${slug}.geojson`]);
    if (!zones || !lots) { cities.push({ slug, note: !zones ? "qc-zonage non servi" : "qc-lots non servi" }); continue; }
    const zoneIndex = new Map<string, Poly[]>();
    const allCodes = new Set<string>();
    let latSum = 0, latN = 0;
    for (const z of zones) {
      const code = assignedCode(z.properties);
      if (!code) continue;
      allCodes.add(code);
      const polys = polygonsOf(z.geometry);
      if (!polys.length) continue;
      const arr = zoneIndex.get(code) ?? [];
      arr.push(...polys);
      zoneIndex.set(code, arr);
      for (const poly of polys) for (const ring of poly) for (const pt of ring) { latSum += pt[1]!; latN++; }
    }
    const lat0 = latN ? latSum / latN : 46;
    const { mlon, mlat } = projConstants(lat0);

    let assigned = 0, mismatch = 0, codeMissing = 0, codeMissingContained = 0, codeMissingOutside = 0;
    const dxs: number[] = [], dys: number[] = [], mags: number[] = [], angs: number[] = [];
    const inAnyZone = (p: Pt): boolean => { for (const polys of zoneIndex.values()) if (inCode(p, polys)) return true; return false; };
    for (const lot of lots) {
      const code = assignedCode(lot.properties);
      if (!code) continue;
      const c = lotCentroid(lot.geometry) as Pt | null;
      if (!c) continue;
      assigned++;
      const polys = zoneIndex.get(code);
      if (!polys) {
        // code assigné ABSENT des zones servies. Contenu dans une AUTRE zone
        // (mislabellé → re-fold assigne le code contenant, ferme le mismatch) vs
        // hors de toute zone (offset géométrique aussi → re-fold ne suffit pas).
        codeMissing++;
        if (inAnyZone(c)) codeMissingContained++; else codeMissingOutside++;
        continue;
      }
      if (inCode(c, polys)) continue;
      const pm: Pt = [c[0] * mlon, c[1] * mlat];
      const { d, q } = nearestOnPolys(pm, polys, mlon, mlat);
      if (d <= T) continue;
      mismatch++;
      // vecteur du centroïde VERS sa zone (direction où le lot devrait bouger pour être cohérent)
      const dx = q[0] - pm[0], dy = q[1] - pm[1];
      dxs.push(dx); dys.push(dy); mags.push(d); angs.push(Math.atan2(dy, dx));
    }
    // consistance directionnelle : longueur du vecteur moyen unitaire (1=uniforme, 0=aléatoire)
    let sx = 0, sy = 0;
    for (const a of angs) { sx += Math.cos(a); sy += Math.sin(a); }
    const R = angs.length ? Math.hypot(sx, sy) / angs.length : 0;
    const medDx = median(dxs), medDy = median(dys);
    const verdict = R >= 0.7 && median(mags) > 20
      ? "OFFSET UNIFORME (misregistration source lot↔zone : datum/version) — route zones/cadastre, PAS re-fold jointures"
      : R < 0.4
        ? "DISPERSÉ (pas d'offset systématique) — vraies erreurs par lot ou gros-lots"
        : "MIXTE";
    const cmVerdict = codeMissing > 0
      ? (codeMissingContained >= codeMissingOutside
          ? "codeMissing MAJORITÉ CONTENUE → RE-FOLD ferme (assigne le code contenant)"
          : "codeMissing MAJORITÉ HORS-ZONE → offset géométrique aussi, re-fold partiel")
      : null;
    cities.push({
      slug, assigned, mismatch, code_missing_assigned: codeMissing,
      code_missing_contained: codeMissingContained, code_missing_outside: codeMissingOutside,
      median_miss_m: Math.round(median(mags) * 10) / 10,
      offset_vector_m: { dx: Math.round(medDx * 10) / 10, dy: Math.round(medDy * 10) / 10, mag: Math.round(Math.hypot(medDx, medDy) * 10) / 10 },
      direction_consistency_R: Math.round(R * 100) / 100,
      verdict, code_missing_verdict: cmVerdict,
    });
    process.stdout.write(`${slug} assigned=${assigned} mismatch=${mismatch} codeMissing=${codeMissing}(contained=${codeMissingContained}/outside=${codeMissingOutside}) medMiss=${Math.round(median(mags))}m offset=(${Math.round(medDx)},${Math.round(medDy)})m mag=${Math.round(Math.hypot(medDx, medDy))}m R=${Math.round(R * 100) / 100} → ${codeMissing > 0 ? cmVerdict!.split(" →")[0] : verdict.split(" —")[0]}\n`);
  }
  writeFileSync(OUT, `${JSON.stringify({ contract: "col2-offset-characterize/20260815", purpose: "Router la part 'vraie erreur' col-2: offset uniforme (misregistration source) vs dispersé (erreurs par lot). R=longueur vecteur directionnel moyen (1=uniforme).", threshold_m: T, cities }, null, 2)}\n`, "utf8");
  process.stdout.write(`OUT ${OUT}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exitCode = 2; });
