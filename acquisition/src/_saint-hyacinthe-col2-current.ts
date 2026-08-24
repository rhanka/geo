/**
 * Sonde READ-ONLY : état col-2 (cohérence lot↔zone) COURANT de saint-hyacinthe,
 * post lot-lane PR#172 (re-fold zone_code 100%). Demandé par geo-cond pour
 * déconflicter avant tout re-fold jointures : le dry-run f2033439 (1245
 * reassignables) PRÉCÈDE #172, donc potentiellement périmé / risque double-write.
 *
 * Réutilise `auditCity` (export de lot-zone-consistency-audit.ts) SANS déclencher
 * l'écriture du REPORT partagé work/coverage/lot-zone-consistency.json (celle-ci
 * ne vit que dans main() du runner). Aucune écriture. Usage (racine dépôt) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_saint-hyacinthe-col2-current.ts
 */
import { s3Client } from "./lib/s3.js";
import { auditCity } from "./lot-zone-consistency-audit.js";

async function main(): Promise<void> {
  const s3 = s3Client();
  const r = await auditCity(s3, "saint-hyacinthe", 5);
  process.stdout.write(
    `saint-hyacinthe col-2 COURANT (audit distance): lots=${r.lots} assigned=${r.assigned} ` +
      `coherent=${r.coherent} mismatch=${r.mismatch} résidu>50m=${r.residue_hard} outside_all=${r.outside_all} ` +
      `unassigned=${r.unassigned} mismatch_pct=${r.mismatch_pct}% résidu_pct=${r.residue_hard_pct}% ` +
      `grain=${r.grain} médiane-ratés=${r.off_median_m}m${r.note ? ` note=${r.note}` : ""}\n`,
  );
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exitCode = 2; });
