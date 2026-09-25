/**
 * bascule-geo-cas-backup.ts — RUNNER MINCE de la jambe geo IRREMPLAÇABLE du cycle
 * de bascule (§ contrat radar-immobilier-backups-preprod). Copie content-addressed
 * dédupliquée du set irremplaçable prod → bucket de backup, PUIS réconciliation
 * sha256 fail-closed. La LOGIQUE est capitalisée + testée dans `@sentropic/geo`
 * (`buildCasInventory` / `planCasCopies` / `reconcileCasInventory` / `casObjectKey`)
 * et l'I/O S3 partagée dans `bascule-geo-shared.ts` (`runCasBackup`) ; ce script ne
 * fait que le CLI (args, sortie JSON, exit).
 *
 * Sens-unique STRICT : lit la source (prod, RO), écrit SEULEMENT le bucket backup.
 * Dédup : un `geo-objects/cas/<sha256>` déjà présent n'est pas recopié. Preuve de
 * restaurabilité = la réconciliation (chaque sha de l'inventaire présent, taille
 * correcte), pas le succès de la copie.
 *
 * Creds via `.env` (cycle de rotation documenté, cf. GEO_CRED_CYCLE.md) :
 *   SOURCE (prod, RO) : GEO_S3_SOURCE_{ENDPOINT,REGION,BUCKET,ACCESS_KEY,SECRET_KEY}
 *   BACKUP (RW)       : S3_BACKUP_{ENDPOINT,REGION,BUCKET,ACCESS_KEY,SECRET_KEY}
 * Usage : NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/bascule-geo-cas-backup.ts --cycle-id <CYCLE_ID> [--source-prefix raw] [--dry-run]
 */
import process from "node:process";
import { arg, ctxFromEnv, hasFlag, runCasBackup } from "./bascule-geo-shared.js";

async function main(): Promise<void> {
  const cycleId = arg("cycle-id") ?? process.env["CYCLE_ID"];
  if (!cycleId) throw new Error("bascule-geo-cas-backup: --cycle-id (ou CYCLE_ID) requis");
  const sourcePrefix = arg("source-prefix") ?? "raw";
  const dryRun = hasFlag("dry-run");

  const ctx = ctxFromEnv(cycleId, dryRun);
  const r = await runCasBackup(ctx, { sourcePrefix });

  console.log(
    JSON.stringify(
      {
        cycleId,
        dryRun,
        source_prefix: sourcePrefix,
        inventory: {
          count: r.count,
          totalBytes: r.totalBytes,
          sha256set: r.setHash,
          inventory_key: r.inventoryKey,
        },
        copies: r.copies,
        reconcile: {
          ok: r.reconcile.ok,
          checked: r.reconcile.checked,
          missing: r.reconcile.missing.length,
          sizeMismatch: r.reconcile.sizeMismatch.length,
        },
      },
      null,
      2,
    ),
  );
  if (!r.reconcile.ok) {
    console.error("RÉCONCILIATION ÉCHOUÉE (fail-closed) — backup incomplet/corrompu.");
    process.exit(4);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
