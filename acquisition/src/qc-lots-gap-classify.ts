/**
 * qc-lots-gap-classify.ts — classe les gap_slugs de qc-lots-gap en trois seaux,
 * en LECTURE PURE S3 + référence munis (aucune écriture, aucun secret imprimé) :
 *
 *   REAL     : vraie muni (municipalities.qc.json) avec couche zones → producible
 *              (à backfiller via lot-zone-join-run + lots-enriched-run).
 *   PURGE    : dépôt zonage mal nommé (ARTEFACT) dont on peut prouver la sûreté :
 *              soit la base n'est pas une vraie muni (owner ArcGIS / nom poubelle),
 *              soit la vraie muni de base est DÉJÀ servie proprement ailleurs
 *              (qc-zonage-<base>.geojson propre présent).
 *   HOLD     : ARTEFACT dont la base EST une vraie muni MAIS sans dépôt propre —
 *              on NE purge PAS (risque de supprimer la seule couche zonage). À revoir.
 *
 * Un slug est ARTEFACT s'il matche un des motifs de mauvais nommage :
 *   - suffixe `-arcgis`               (dump ArcGIS mal ré-injecté)
 *   - `.geojson.` interne            (double extension horodatée)
 *   - `__subdir`                     (sous-dossier ré-aplati)
 *   - `__qc-zonage-`                 (clé imbriquée ré-aplatie)
 *   - horodatage `YYYY-MM-DDT`       (dépôt versionné laissé en place)
 *
 *   npx tsx acquisition/src/qc-lots-gap-classify.ts [--json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";
import { computeGap } from "./qc-lots-gap.js";

const ZONES_PREFIX = "normalized/ca-qc-zonage/";

const TS = /\d{4}-\d{2}-\d{2}T/;

function isArtefact(slug: string): boolean {
  return (
    /-arcgis$/.test(slug) ||
    /\.geojson\./.test(slug) ||
    /__subdir/.test(slug) ||
    /__qc-zonage-/.test(slug) ||
    TS.test(slug)
  );
}

/** Réduit un slug artefact à la muni de base la plus plausible. */
function baseMuni(slug: string): string {
  let s = slug;
  s = s.replace(/-arcgis$/, "");
  s = s.replace(/__subdir.*$/, "");
  s = s.replace(/__qc-zonage-.*$/, "");
  s = s.replace(/\.geojson\..*$/, "");
  s = s.replace(/\.geojson$/, "");
  return s;
}

async function listZoneSlugs(s3: ReturnType<typeof s3Client>): Promise<Set<string>> {
  const out = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ZONES_PREFIX, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of r.Contents ?? []) {
      const m = (o.Key ?? "").match(/qc-zonage-([^/]+)\.geojson$/);
      if (m) out.add(m[1]!);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

interface Row {
  slug: string;
  isArtefact: boolean;
  isRealMuni: boolean;
  base: string;
  baseIsRealMuni: boolean;
  baseServedClean: boolean;
  hasCad: boolean;
  bucket: "REAL" | "PURGE" | "HOLD";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const emitIdx = argv.indexOf("--emit-purge");
  const emitPath = emitIdx >= 0 ? argv[emitIdx + 1] : null;
  const here = dirname(fileURLToPath(import.meta.url));
  const muniPath = join(here, "..", "..", "packages", "qc-sources", "src", "geo", "municipalities.qc.json");
  const munis = JSON.parse(readFileSync(muniPath, "utf8")) as { slug: string }[];
  const realMuni = new Set(munis.map((m) => m.slug));

  const s3 = s3Client();
  const zoneSlugs = await listZoneSlugs(s3);
  // Dépôt zonage PROPRE = présent, non-artefact, et vraie muni.
  const cleanZone = (slug: string): boolean => zoneSlugs.has(slug) && !isArtefact(slug) && realMuni.has(slug);

  const gap = await computeGap(s3);
  const cadStatus = new Map(gap.rows.map((r) => [r.slug, r.hasCad]));

  const rows: Row[] = [];
  for (const slug of gap.rows.map((r) => r.slug)) {
    const artefact = isArtefact(slug);
    const real = realMuni.has(slug);
    const base = baseMuni(slug);
    const baseReal = realMuni.has(base);
    const baseClean = cleanZone(base);
    let bucket: Row["bucket"];
    if (!artefact && real) bucket = "REAL";
    else if (artefact && (!baseReal || baseClean)) bucket = "PURGE";
    else bucket = "HOLD"; // artefact dont la base est une vraie muni sans dépôt propre
    rows.push({
      slug,
      isArtefact: artefact,
      isRealMuni: real,
      base,
      baseIsRealMuni: baseReal,
      baseServedClean: baseClean,
      hasCad: cadStatus.get(slug) ?? false,
      bucket,
    });
  }

  const real = rows.filter((r) => r.bucket === "REAL");
  const purge = rows.filter((r) => r.bucket === "PURGE");
  const hold = rows.filter((r) => r.bucket === "HOLD");

  if (emitPath) {
    writeFileSync(emitPath, purge.map((r) => r.slug).join("\n") + "\n", "utf8");
    console.error(`wrote ${purge.length} purge slugs -> ${emitPath}`);
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          gap: rows.length,
          real: real.map((r) => ({ slug: r.slug, hasCad: r.hasCad })),
          purge: purge.map((r) => ({ slug: r.slug, base: r.base, baseServedClean: r.baseServedClean })),
          hold: hold.map((r) => ({ slug: r.slug, base: r.base })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`GAP=${rows.length} | REAL=${real.length} PURGE=${purge.length} HOLD=${hold.length}`);
  console.log(`\nREAL (backfill) — ${real.length}`);
  for (const r of real) console.log(`  ${r.slug} cad=${r.hasCad ? "Y" : "N"}`);
  console.log(`\nHOLD (artefact base=vraie-muni SANS dépôt propre — NE PAS purger) — ${hold.length}`);
  for (const r of hold) console.log(`  ${r.slug} -> base=${r.base}`);
  console.log(`\nPURGE (artefact sûr) — ${purge.length}`);
  for (const r of purge) console.log(`  ${r.slug} -> base=${r.base} baseClean=${r.baseServedClean ? "Y" : "N/na"}`);
  console.log(`\nPURGE_CSV: ${purge.map((r) => r.slug).join(",")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
