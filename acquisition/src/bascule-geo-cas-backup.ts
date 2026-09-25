/**
 * bascule-geo-cas-backup.ts — RUNNER MINCE de la jambe geo IRREMPLAÇABLE du cycle
 * de bascule (§ contrat radar-immobilier-backups-preprod). Copie content-addressed
 * dédupliquée du set irremplaçable prod → bucket de backup, PUIS réconciliation
 * sha256 fail-closed. La LOGIQUE est capitalisée + testée dans `@sentropic/geo`
 * (`buildCasInventory` / `planCasCopies` / `reconcileCasInventory` / `casObjectKey`) ;
 * ce script ne fait que l'I/O S3 autour d'elle.
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
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  buildCasInventory,
  casObjectKey,
  planCasCopies,
  reconcileCasInventory,
  serializeCasInventory,
  type CasSourceEntry,
  type CasTargetEntry,
} from "@sentropic/geo";
import process from "node:process";

const CAS_PREFIX = "geo-objects/cas";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

function clientFrom(prefix: string): S3Client {
  const endpoint = process.env[`${prefix}ENDPOINT`];
  const region = process.env[`${prefix}REGION`] || "us-east-1";
  const ak = process.env[`${prefix}ACCESS_KEY`];
  const sk = process.env[`${prefix}SECRET_KEY`];
  const cfg: ConstructorParameters<typeof S3Client>[0] = { forcePathStyle: true, region };
  if (endpoint) cfg.endpoint = endpoint;
  if (ak && sk) cfg.credentials = { accessKeyId: ak, secretAccessKey: sk };
  return new S3Client(cfg);
}

/** Full paginated listing of {key,size}; `complete` false if truncated/errored (garde-fou). */
async function listAll(client: S3Client, bucket: string, prefix: string): Promise<{ keys: { key: string; size: number }[]; complete: boolean }> {
  const keys: { key: string; size: number }[] = [];
  try {
    let token: string | undefined;
    do {
      const out = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of out.Contents ?? []) if (typeof o.Key === "string") keys.push({ key: o.Key, size: o.Size ?? 0 });
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return { keys, complete: true };
  } catch (e) {
    return { keys, complete: false };
  }
}

/** sha256 of a `raw/<src>/cas/<sha256>.<ext>` key = its content address (basename sans extension). */
function shaOfCasKey(key: string): string | null {
  const m = /\/cas\/([0-9a-f]{64})(?:\.[^/]+)?$/.exec(key);
  return m ? m[1]! : null;
}

async function main(): Promise<void> {
  const cycleId = arg("cycle-id") ?? process.env["CYCLE_ID"];
  if (!cycleId) throw new Error("bascule-geo-cas-backup: --cycle-id (ou CYCLE_ID) requis");
  const sourcePrefix = arg("source-prefix") ?? "raw";
  const dryRun = hasFlag("dry-run");

  const source = clientFrom("GEO_S3_SOURCE_");
  const backup = clientFrom("S3_BACKUP_");
  const srcBucket = process.env["GEO_S3_SOURCE_BUCKET"];
  const bakBucket = process.env["S3_BACKUP_BUCKET"];
  if (!srcBucket || !bakBucket) throw new Error("bascule-geo-cas-backup: GEO_S3_SOURCE_BUCKET et S3_BACKUP_BUCKET requis");

  // 1) Set irremplaçable source (content-addressed) → entrées {sha256,size,sourceKey}.
  const srcListing = await listAll(source, srcBucket, `${sourcePrefix}/`);
  if (!srcListing.complete) throw new Error("bascule-geo-cas-backup: listing SOURCE incomplet — refus (garde-fou anti set partiel)");
  const entries: CasSourceEntry[] = [];
  for (const o of srcListing.keys) {
    const sha = shaOfCasKey(o.key);
    if (sha) entries.push({ sourceKey: o.key, sha256: sha, size: o.size });
  }
  const inventory = buildCasInventory(cycleId, entries);

  // 2) Dédup contre le backup existant → plan de copies.
  const bakListing = await listAll(backup, bakBucket, `${CAS_PREFIX}/`);
  if (!bakListing.complete) throw new Error("bascule-geo-cas-backup: listing BACKUP incomplet — refus");
  const existing = new Set<string>();
  for (const o of bakListing.keys) { const s = o.key.slice(CAS_PREFIX.length + 1); if (s) existing.add(s); }
  const toCopy = planCasCopies(inventory, existing);

  // 3) Copie get→put streaming (creds séparées) vers geo-objects/cas/<sha256>.
  const bySha = new Map(inventory.entries.map((e) => [e.sha256, e]));
  let copied = 0;
  for (const sha of toCopy) {
    const e = bySha.get(sha)!;
    if (dryRun) { copied++; continue; }
    const g = await source.send(new GetObjectCommand({ Bucket: srcBucket, Key: e.sourceKey }));
    await backup.send(new PutObjectCommand({ Bucket: bakBucket, Key: casObjectKey(sha, CAS_PREFIX), Body: g.Body as unknown as Uint8Array, ContentLength: e.size }));
    copied++;
  }

  // 4) Inventaire du cycle → sets/<CYCLE_ID>/inventory.json.
  const inventoryKey = `geo-objects/prod/sets/${cycleId}/inventory.json`;
  if (!dryRun) {
    await backup.send(new PutObjectCommand({ Bucket: bakBucket, Key: inventoryKey, Body: serializeCasInventory(inventory), ContentType: "application/json" }));
  }

  // 5) Réconciliation sha256 fail-closed : chaque sha de l'inventaire présent, taille correcte.
  const bakAfter = await listAll(backup, bakBucket, `${CAS_PREFIX}/`);
  const target = new Map<string, CasTargetEntry>();
  for (const o of bakAfter.keys) target.set(o.key, { size: o.size });
  const recon = reconcileCasInventory(inventory, target, CAS_PREFIX);

  console.log(JSON.stringify({
    cycleId, dryRun, source_prefix: sourcePrefix,
    inventory: { count: inventory.count, totalBytes: inventory.totalBytes, sha256set: inventory.setHash, inventory_key: inventoryKey },
    copies: { planned: toCopy.length, done: copied, deduped: inventory.count - toCopy.length },
    reconcile: { ok: recon.ok, checked: recon.checked, missing: recon.missing.length, sizeMismatch: recon.sizeMismatch.length },
  }, null, 2));
  if (!recon.ok) { console.error("RÉCONCILIATION ÉCHOUÉE (fail-closed) — backup incomplet/corrompu."); process.exit(4); }
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
