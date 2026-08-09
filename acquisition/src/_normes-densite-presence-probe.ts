/**
 * _normes-densite-presence-probe.ts — les normes acquises PORTENT-ELLES une densité ?
 *
 * Le diagnostic B' classait 44 villes en `a_fold_never_ran` avec 47 680
 * « cellules à changer ». Ce compte est un artefact : il comparait
 * `properties[field]` (absent = undefined) à `norms[field] ?? null`, donc tout
 * champ vide DES DEUX CÔTÉS comptait comme un changement — d'où exactement
 * `matched × 16` partout. Le pli réel rend `cellsChanged=0`.
 *
 * La vraie question n'est donc pas « le pli a-t-il tourné » mais « y a-t-il une
 * densité à plier ». Sans densité dans les normes acquises, aucun delta 4a n'est
 * possible, quel que soit le nombre de plis.
 *
 * Lecture seule stricte. N'écrit rien.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_normes-densite-presence-probe.ts
 */
import { getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";
import diagnose from "../../work/coverage/immo-bprime-normes-fold-diagnose-20260726.json" with { type: "json" };

interface Row { slug: string; primary_cause: string; served_norms_key: string | null }

function nonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

async function main(): Promise<void> {
  const s3 = s3Client();
  const rows = (diagnose as { rows: Row[] }).rows;
  // On ne se limite PAS aux 44 : la question « y a-t-il une densite » vaut pour
  // toutes les collections B' sans effet, quelle que soit la cause imputee.
  const targets = rows.filter((row) => row.served_norms_key !== null);

  let withDensity = 0;
  let withoutDensity = 0;
  let unreadable = 0;
  const detail: Array<{ slug: string; cause: string; rows: number; densite: number; hauteur: number }> = [];

  for (const row of targets) {
    let features: Array<{ properties?: Record<string, unknown> }>;
    try {
      const parsed = await getGeoJsonFeatureCollection<{ properties?: Record<string, unknown> }>(
        s3, row.served_norms_key as string,
      );
      features = parsed.features ?? [];
    } catch {
      // Une lecture qui echoue est une mesure d'absence de MESURE, pas une
      // absence de densite : elle est comptee a part et jamais fondue dans
      // `sans_densite`.
      unreadable += 1;
      continue;
    }
    let densite = 0;
    let hauteur = 0;
    for (const feature of features) {
      const props = feature.properties ?? {};
      if (nonEmpty(props["densite_value"])) densite += 1;
      if (nonEmpty(props["hauteur_max_value"])) hauteur += 1;
    }
    if (densite > 0) withDensity += 1;
    else withoutDensity += 1;
    detail.push({ slug: row.slug, cause: row.primary_cause, rows: features.length, densite, hauteur });
  }

  const byCause: Record<string, { avec: number; sans: number }> = {};
  for (const entry of detail) {
    byCause[entry.cause] ??= { avec: 0, sans: 0 };
    if (entry.densite > 0) byCause[entry.cause]!.avec += 1;
    else byCause[entry.cause]!.sans += 1;
  }

  console.log(JSON.stringify({
    collections_normes_lues: detail.length,
    illisibles: unreadable,
    avec_densite: withDensity,
    sans_densite: withoutDensity,
    par_cause: byCause,
    avec_densite_slugs: detail.filter((d) => d.densite > 0).map((d) => `${d.slug} ${d.densite}/${d.rows}`),
  }, null, 1));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
