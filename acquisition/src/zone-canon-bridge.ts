/**
 * zone-canon-bridge.ts — réconcilie un dépôt zonage déposé sous un slug NON
 * canonique (apostrophe -> tiret, ex `l-epiphanie`) vers le slug canonique
 * `norm()` (apostrophe supprimée, ex `lepiphanie`) pour lequel le cadastre et
 * les qc-lots sont nommés. Copie server-side (aucune ré-extraction), gardée :
 *
 *   - `to` DOIT avoir un cadastre exact (normalized/qc-cadastre-lots/<to>.geojson) ;
 *   - `to` NE DOIT PAS déjà avoir de zones ni de qc-lots (jamais clobber une muni
 *     déjà servie proprement) ;
 *   - `from` DOIT avoir un dépôt zones (plat ou sous-dossier).
 *
 * Idempotent, anti-invention (copie de la MÊME donnée de la MÊME ville, juste
 * re-nommée au slug canonique), n'imprime aucun secret.
 *
 *   npx tsx acquisition/src/zone-canon-bridge.ts <from>:<to> [<from>:<to> ...]
 */
import { BUCKET, copyObject, exists, s3Client } from "./lib/s3.js";

const pairs = process.argv
  .slice(2)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => {
    const [from, to] = p.split(":");
    return { from: (from ?? "").trim(), to: (to ?? "").trim() };
  })
  .filter((p) => p.from && p.to);

if (pairs.length === 0) {
  console.error("usage: npx tsx acquisition/src/zone-canon-bridge.ts <from>:<to> [...]");
  process.exit(2);
}

const s3 = s3Client();
for (const { from, to } of pairs) {
  const cadKey = `normalized/qc-cadastre-lots/${to}.geojson`;
  const toZoneKey = `normalized/ca-qc-zonage/qc-zonage-${to}.geojson`;
  const toLotsKey = `normalized/qc-lots/qc-lots-${to}.geojson`;
  const fromFlat = `normalized/ca-qc-zonage/qc-zonage-${from}.geojson`;
  const fromSub = `normalized/ca-qc-zonage/qc-zonage-${from}/qc-zonage-${from}.geojson`;

  if (!(await exists(s3, cadKey))) {
    console.log(`SKIP ${from}->${to}: cadastre canonique absent (${cadKey})`);
    continue;
  }
  if (await exists(s3, toZoneKey)) {
    console.log(`SKIP ${from}->${to}: zones canoniques existent déjà (idempotent)`);
    continue;
  }
  if (await exists(s3, toLotsKey)) {
    console.log(`SKIP ${from}->${to}: qc-lots canoniques existent déjà (ne pas clobber)`);
    continue;
  }
  const srcKey = (await exists(s3, fromFlat)) ? fromFlat : (await exists(s3, fromSub)) ? fromSub : null;
  if (!srcKey) {
    console.log(`SKIP ${from}->${to}: dépôt zones source introuvable`);
    continue;
  }
  await copyObject(s3, srcKey, toZoneKey, BUCKET);
  console.log(`BRIDGED ${from}->${to}: ${srcKey} -> ${toZoneKey}`);
}
