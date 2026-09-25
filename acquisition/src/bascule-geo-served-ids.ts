/**
 * bascule-geo-served-ids.ts — RUNNER MINCE de la jambe SERVI du cycle de bascule
 * (§ contrat radar-immobilier-backups-preprod). Lit `normalized/` (zones + lots)
 * depuis la SOURCE prod (RO), émet le set canonique served-ids trié/dédup, le gzip
 * et le dépose sur le bucket BACKUP (`sets/<CYCLE_ID>/served-ids.ndjson.gz`), puis
 * réconcilie le .gz déposé fail-closed. La LOGIQUE (mapping clé→refs, canonical-ids,
 * I/O) est capitalisée dans `@sentropic/geo` + `bascule-geo-shared.ts` ; ce script
 * ne fait que le CLI (args, sortie JSON, exit).
 *
 * Le sha256 loggé est celui du set trié NON compressé (node:crypto) — il va dans
 * geo.json `s3_servi.sha256`, calculé identiquement des deux côtés du diff immo.
 *
 * Creds via env (cf. bascule-geo-shared) :
 *   SOURCE (prod, RO) : GEO_S3_SOURCE_{ENDPOINT,REGION,BUCKET,ACCESS_KEY,SECRET_KEY}
 *   BACKUP (RW)       : S3_BACKUP_{ENDPOINT,REGION,BUCKET,ACCESS_KEY,SECRET_KEY}
 * Usage : NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/bascule-geo-served-ids.ts --cycle-id <CYCLE_ID> [--dry-run]
 */
import process from "node:process";
import { arg, ctxFromEnv, hasFlag, runServedIds } from "./bascule-geo-shared.js";

async function main(): Promise<void> {
  const cycleId = arg("cycle-id") ?? process.env["CYCLE_ID"];
  if (!cycleId) throw new Error("bascule-geo-served-ids: --cycle-id (ou CYCLE_ID) requis");
  const dryRun = hasFlag("dry-run");

  const ctx = ctxFromEnv(cycleId, dryRun);
  const r = await runServedIds(ctx);

  console.log(
    JSON.stringify(
      {
        cycleId,
        dryRun,
        served: {
          served_ids_key: r.servedIdsKey,
          served_count: r.servedCount,
          sha256: r.sha256,
          set_hash: r.setHash,
          collections: r.collections,
        },
        reconcile: { ok: r.reconciled },
      },
      null,
      2,
    ),
  );
  if (!r.reconciled) {
    console.error("RÉCONCILIATION served-ids ÉCHOUÉE (fail-closed) — .gz déposé != set calculé.");
    process.exit(4);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
