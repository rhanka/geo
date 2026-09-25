/**
 * bascule-geo-entrypoint.ts — ORCHESTRATEUR du cycle de bascule geo
 * (§ contrat radar-immobilier-backups-preprod, prod→backup→préprod). Compose, dans
 * l'ordre et TOUT fail-closed (exit non-zéro à la moindre incohérence) :
 *   (a) CAS backup  — jambe IRREMPLAÇABLE (copie content-addressed + réconciliation) ;
 *   (b) served-ids  — jambe SERVI (set canonique trié/dédup, gzip → backup, réconcilié) ;
 *   (c) geo.json    — reçu de cycle (`buildGeoReceipt`, pg:null : préprod geo S3-only)
 *                     → PutObject `sets/<CYCLE_ID>/geo.json`. Écrit SEULEMENT si (a)+(b)
 *                     ont réconcilié (jamais de reçu pour un cycle cassé) ;
 *   (d) réconciliation sha256 fail-closed — (a) et (b) réconcilient déjà côté objet ;
 *                     l'entrypoint refuse d'émettre le reçu tant que les deux ne sont pas OK ;
 *   (e) hook migration modèle — `resolveModelMigrationChain` (registry vide au départ),
 *                     modèles via env `GEO_S3_MODEL_RESTORED`/`GEO_S3_MODEL_EXPECTED`
 *                     (absents → skip propre ; changement non couvert → throw fail-closed).
 *
 * Env : CYCLE_ID (requis), WATERMARK (défaut = CYCLE_ID), SNAPSHOT_AT (optionnel),
 *   GEO_S3_MODEL_RESTORED / GEO_S3_MODEL_EXPECTED (optionnels), + creds
 *   GEO_S3_SOURCE_* (prod, RO) et S3_BACKUP_* (RW). `--dry-run` supporté.
 * Usage : NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/bascule-geo-entrypoint.ts [--cycle-id <CYCLE_ID>] [--source-prefix raw] [--dry-run]
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
// Sous-chemins bascule (cf. bascule-geo-shared) : le bare `@sentropic/geo` est remappé
// vers `zonage/lotZoneJoin.ts` et ne porte pas ces fns.
import { buildGeoReceipt, serializeGeoReceipt } from "@sentropic/geo/bascule/geo-receipt.js";
import { resolveModelMigrationChain } from "@sentropic/geo/bascule/model-migration.js";
import process from "node:process";
import { arg, ctxFromEnv, hasFlag, runCasBackup, runServedIds } from "./bascule-geo-shared.js";

function fail(reason: string, payload: unknown): never {
  console.log(JSON.stringify(payload, null, 2));
  console.error(reason);
  process.exit(4);
}

async function main(): Promise<void> {
  const cycleId = arg("cycle-id") ?? process.env["CYCLE_ID"];
  if (!cycleId) throw new Error("bascule-geo-entrypoint: --cycle-id (ou CYCLE_ID) requis");
  const watermark = process.env["WATERMARK"] || cycleId;
  const snapshotAt = process.env["SNAPSHOT_AT"] || undefined;
  const sourcePrefix = arg("source-prefix") ?? "raw";
  const dryRun = hasFlag("dry-run");
  const at = new Date().toISOString();

  const ctx = ctxFromEnv(cycleId, dryRun);

  // (a) CAS backup (jambe IRREMPLAÇABLE) — réconciliation fail-closed.
  const cas = await runCasBackup(ctx, { sourcePrefix });
  if (!cas.reconcile.ok) {
    fail("RÉCONCILIATION CAS ÉCHOUÉE (fail-closed) — pas de reçu émis.", {
      cycleId,
      dryRun,
      stage: "cas",
      cas: { inventory_key: cas.inventoryKey, count: cas.count, reconcile_ok: cas.reconcile.ok },
    });
  }

  // (b) served-ids (jambe SERVI) — réconciliation lecture-arrière fail-closed.
  const servi = await runServedIds(ctx);
  if (!servi.reconciled) {
    fail("RÉCONCILIATION served-ids ÉCHOUÉE (fail-closed) — pas de reçu émis.", {
      cycleId,
      dryRun,
      stage: "served",
      served: { served_ids_key: servi.servedIdsKey, served_count: servi.servedCount, reconciled: servi.reconciled },
    });
  }

  // (c)+(d) geo.json — émis SEULEMENT après réconciliation des deux jambes.
  const receipt = buildGeoReceipt({
    cycleId,
    watermark,
    at,
    snapshotAt,
    pg: null, // préprod geo S3-only : PostGIS re-dérivable, non restauré.
    irremplacable: { inventoryKey: cas.inventoryKey, sha256set: cas.setHash, count: cas.count },
    servi: {
      prefix: servi.prefix,
      servedCount: servi.servedCount,
      setHash: servi.setHash,
      servedIdsKey: servi.servedIdsKey,
      sha256: servi.sha256,
    },
  });
  const geoJsonKey = `${servi.prefix}/geo.json`;
  if (!dryRun) {
    await ctx.backup.send(
      new PutObjectCommand({
        Bucket: ctx.bakBucket,
        Key: geoJsonKey,
        Body: serializeGeoReceipt(receipt),
        ContentType: "application/json",
      }),
    );
  }

  // (e) hook migration modèle S3 post-restore — registry vide, fail-closed.
  const restoredModel = process.env["GEO_S3_MODEL_RESTORED"];
  const expectedModel = process.env["GEO_S3_MODEL_EXPECTED"];
  let migration: { skipped: true } | { skipped: false; status: string; chain: number };
  if (restoredModel && expectedModel) {
    const plan = resolveModelMigrationChain(restoredModel, expectedModel, []);
    migration = { skipped: false, status: plan.status, chain: plan.chain.length };
  } else {
    migration = { skipped: true };
  }

  console.log(
    JSON.stringify(
      {
        cycleId,
        watermark,
        dryRun,
        at,
        cas: {
          inventory_key: cas.inventoryKey,
          count: cas.count,
          totalBytes: cas.totalBytes,
          sha256set: cas.setHash,
          copies: cas.copies,
          reconcile_ok: cas.reconcile.ok,
        },
        served: {
          served_ids_key: servi.servedIdsKey,
          served_count: servi.servedCount,
          sha256: servi.sha256,
          collections: servi.collections,
          reconciled: servi.reconciled,
        },
        geo_json_key: geoJsonKey,
        migration,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
