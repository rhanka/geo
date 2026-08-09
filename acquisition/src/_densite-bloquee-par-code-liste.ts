/**
 * _densite-bloquee-par-code-liste.ts — les villes où une densité ACQUISE
 * n'atteint pas le zonage servi parce que les codes de zone ne s'apparient pas.
 *
 * C'est le seul levier 4a que la mesure soutient encore. Le pli des normes a été
 * exécuté sur 45 objets servis sans changer une seule cellule : la classe
 * `a_fold_never_ran` du diagnostic était un artefact (`undefined !== null`), et
 * le pli avait déjà tourné. Restent les collections où les normes portent une
 * densité mais où `fold_matched_polygones = 0`.
 *
 * Cette passe LISTE, elle ne résout pas. Décider que `10-F` vaut `F-10` sans
 * l'avoir lu dans la grille source écrirait une densité sur la mauvaise zone —
 * un effet densifiant fabriqué en production chez un tiers.
 *
 * Lecture seule stricte. N'écrit rien.
 *
 * Usage :
 *   npx tsx acquisition/src/_densite-bloquee-par-code-liste.ts <densite-probe.json>
 */
import { readFileSync } from "node:fs";

import diagnose from "../../work/coverage/immo-bprime-normes-fold-diagnose-20260726.json" with { type: "json" };

interface Row {
  slug: string;
  primary_cause: string;
  zonage_polygones: number;
  norms_unique_zone_codes: number;
  fold_matched_polygones: number;
}

function main(): void {
  const probePath = process.argv[2];
  if (probePath === undefined) throw new Error("usage: <chemin du rapport de la sonde densite>");
  const probe = readFileSync(probePath, "utf8");
  // La sonde imprime "slug n/m" pour chaque collection portant une densite.
  const density = new Map<string, string>(
    [...probe.matchAll(/"([a-z0-9-]+) (\d+)\/(\d+)"/g)].map((m) => [m[1]!, `${m[2]}/${m[3]}`]),
  );

  const rows = (diagnose as { rows: Row[] }).rows.filter(
    (row) => row.primary_cause === "c_zone_code_no_overlap" && density.has(row.slug),
  );

  for (const row of rows) {
    console.log(
      `${row.slug.padEnd(34)} densite ${(density.get(row.slug) ?? "").padEnd(9)} ` +
      `polygones ${String(row.zonage_polygones).padStart(5)}  codes_normes ${String(row.norms_unique_zone_codes).padStart(4)}  ` +
      `apparies ${row.fold_matched_polygones}`,
    );
  }
  console.log(`\nN = ${rows.length}`);
}

main();
