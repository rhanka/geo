/**
 * Sonde READ-ONLY : chiffre l'AMPLEUR de l'artefact col-2 « centroïde vs
 * aire-majorité » par ville, pour le dossier décision A/B routé archi+qa+owner
 * (demande geo-cond geocond-jointures-hold-col2-methodo-20260810t2005).
 *
 * L'audit col-2 (lot-zone-consistency-audit.ts) flagge un lot MISASSIGNED quand
 * son CENTROÏDE tombe hors de sa zone `code_zone` assignée (servie par
 * AIRE-MAJORITÉ). Question A/B : ce mismatch est-il un pur artefact de méthode
 * (lots STRADDLING = multi_zone, où centroïde ≠ zone d'aire-majoritaire) ou
 * inclut-il de vraies erreurs (misassigned MONO-zone) ?
 *
 * Ce script réutilise les helpers EXACTS de l'audit (même méthode, zéro
 * divergence) et décompose, par ville, misassigned ∩ multi_zone (artefact
 * attendu) vs misassigned ∩ mono-zone (erreur potentielle). Aucune écriture S3.
 *
 * ⚠ Lecture: brossard/boucherville servis NON encore re-foldés contre la v2
 * zones 0dcb13a0 → leur mismatch mêle artefact + gap-non-refoldé (noté).
 * saint-hyacinthe = cas PROPRE (code_zone = aire-majorité contre la v2 servie).
 *
 * Usage (racine dépôt) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_col2-artifact-quantify.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client } from "./lib/s3.js";
import { loadFC, polygonsOf, lotCentroid, inCode, assignedCode, type Poly } from "./lot-zone-consistency-audit.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "work/coverage/col2-artifact-quantify-20260810.json");

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const LOTS_PREFIX = "normalized/qc-lots/";

const CLEAN = ["saint-hyacinthe"];
const NOT_REFOLDED = ["brossard", "boucherville"];
const CONTEXT = ["varennes", "ormstown", "sorel-tracy", "drummondville"];

interface CityArtifact {
  slug: string;
  refold_state: "clean-area-majority-vs-current-v2" | "served-not-refolded-to-new-v2" | "context";
  lots: number;
  assigned: number;
  matched: number;
  misassigned_total: number;
  misassigned_multi_zone: number;
  misassigned_mono_zone: number;
  outside_all: number;
  multi_zone_total: number;
  mismatch_pct: number;
  note?: string;
}

async function quantify(
  s3: ReturnType<typeof s3Client>,
  slug: string,
  refoldState: CityArtifact["refold_state"],
): Promise<CityArtifact> {
  const c: CityArtifact = {
    slug, refold_state: refoldState, lots: 0, assigned: 0, matched: 0,
    misassigned_total: 0, misassigned_multi_zone: 0, misassigned_mono_zone: 0,
    outside_all: 0, multi_zone_total: 0, mismatch_pct: 0,
  };
  const zones = await loadFC(s3, [`${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`, `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`]);
  const lots = await loadFC(s3, [`${LOTS_PREFIX}qc-lots-${slug}.geojson`, `${LOTS_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`]);
  if (!zones) { c.note = "qc-zonage non servi"; return c; }
  if (!lots) { c.note = "qc-lots non servi"; return c; }

  const zoneIndex = new Map<string, Poly[]>();
  for (const z of zones) {
    const code = assignedCode(z.properties);
    if (!code) continue;
    const polys = polygonsOf(z.geometry);
    if (!polys.length) continue;
    const arr = zoneIndex.get(code) ?? [];
    arr.push(...polys);
    zoneIndex.set(code, arr);
  }

  for (const lot of lots) {
    c.lots++;
    const isMulti = lot.properties?.["multi_zone"] === true;
    if (isMulti) c.multi_zone_total++;
    const code = assignedCode(lot.properties);
    if (!code) continue;
    const centroid = lotCentroid(lot.geometry);
    if (!centroid) continue;
    c.assigned++;
    if (inCode(centroid, zoneIndex.get(code))) { c.matched++; continue; }
    let inSomeOther = false;
    for (const [zc, polys] of zoneIndex) { if (zc !== code && inCode(centroid, polys)) { inSomeOther = true; break; } }
    if (inSomeOther) {
      c.misassigned_total++;
      if (isMulti) c.misassigned_multi_zone++; else c.misassigned_mono_zone++;
    } else {
      c.outside_all++;
    }
  }
  c.mismatch_pct = c.assigned ? Math.round(((c.misassigned_total + c.outside_all) / c.assigned) * 10000) / 100 : 0;
  return c;
}

async function main(): Promise<void> {
  const s3 = s3Client();
  const rows: CityArtifact[] = [];
  for (const slug of CLEAN) rows.push(await quantify(s3, slug, "clean-area-majority-vs-current-v2"));
  for (const slug of NOT_REFOLDED) rows.push(await quantify(s3, slug, "served-not-refolded-to-new-v2"));
  for (const slug of CONTEXT) rows.push(await quantify(s3, slug, "context"));

  const artifact = {
    contract: "col2-artifact-quantify/20260810",
    purpose: "Chiffrer l'artefact col-2 centroïde-vs-aire-majorité (décision A/B, archi+qa+owner). misassigned_multi_zone = artefact attendu (straddling); misassigned_mono_zone = erreur potentielle.",
    method: "réutilise loadFC/polygonsOf/lotCentroid/inCode/assignedCode de lot-zone-consistency-audit.ts (méthode KPI exacte); multi_zone lu de la propriété servie du lot.",
    caveat: "brossard/boucherville servis PAS re-foldés contre v2 zones 0dcb13a0 → mismatch mêle artefact + gap; saint-hyacinthe = cas propre.",
    cities: rows,
  };
  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  for (const r of rows) {
    process.stdout.write(
      `${r.slug} [${r.refold_state}] lots=${r.lots} assigned=${r.assigned} mismatch=${r.mismatch_pct}% ` +
        `misassigned=${r.misassigned_total} (multi=${r.misassigned_multi_zone} mono=${r.misassigned_mono_zone}) ` +
        `outside=${r.outside_all} multi_zone_total=${r.multi_zone_total}${r.note ? ` note=${r.note}` : ""}\n`,
    );
  }
  process.stdout.write(`OUT ${OUT}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exitCode = 2; });
