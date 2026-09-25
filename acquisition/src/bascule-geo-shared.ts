/**
 * bascule-geo-shared.ts — I/O S3 + CORES partagés des jambes de la bascule geo
 * (contrat radar-immobilier-backups-preprod). Les 3 runners `bascule-geo-*`
 * (cas-backup, served-ids, entrypoint) importent d'ici pour ZÉRO duplication :
 * le sens-unique STRICT (lit SOURCE prod RO, écrit SEULEMENT le bucket backup),
 * le listing paginé garde-fou (`complete=false` sur troncature/erreur → refus),
 * et les deux cores fail-closed. La LOGIQUE PURE (inventaire CAS, réconciliation,
 * canonical-ids, mapping clé→refs) est capitalisée + testée dans `@sentropic/geo` ;
 * ce module ne fait que l'I/O S3 autour d'elle.
 *
 * Creds via env (cycle de rotation documenté) :
 *   SOURCE (prod, RO) : GEO_S3_SOURCE_{ENDPOINT,REGION,BUCKET,ACCESS_KEY,SECRET_KEY}
 *   BACKUP (RW)       : S3_BACKUP_{ENDPOINT,REGION,BUCKET,ACCESS_KEY,SECRET_KEY}
 */
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
// Sous-chemins `@sentropic/geo/*` (précédent `catalog/recense-platform.js`) : le bare
// specifier `@sentropic/geo` est remappé (tsconfig paths, honoré par tsx) vers
// `zonage/lotZoneJoin.ts` — la clé de jointure servie — qui NE porte PAS les fns
// bascule. On importe donc chaque module bascule par son sous-chemin, qui résout en
// source à l'exécution (tsx) et type via `@sentropic/geo/*` → `src/*`.
import {
  buildCasInventory,
  casObjectKey,
  planCasCopies,
  reconcileCasInventory,
  serializeCasInventory,
  type CasReconcileResult,
  type CasSourceEntry,
  type CasTargetEntry,
} from "@sentropic/geo/bascule/cas-inventory.js";
import {
  buildServedCanonicalIds,
  serializeServedCanonicalIds,
  type ServedLotRef,
  type ServedZoneRef,
} from "@sentropic/geo/bascule/served-canonical-ids.js";
import { collectionFeaturesToRefs, municipalSlugFromNormalizedKey } from "@sentropic/geo/bascule/served-ids-mapping.js";
import { isCanonicalGeojsonKey } from "@sentropic/geo/storage/canonical-key.js";
import { createHash } from "node:crypto";
import process from "node:process";
import { gunzipSync, gzipSync } from "node:zlib";
import { getBytes, isServedZoneKey, parseFeatureCollectionBuffer } from "./lib/s3.js";

export const CAS_PREFIX = "geo-objects/cas";

/** `normalized/` prefixes servis à Immo (contrat de jointure §2/§6). Zones sous
 *  `ca-qc-zonage/` (predicat autoritaire {@link isServedZoneKey}) ; lots enrichis
 *  servis sous `qc-lots/`, cadastre clippé source sous `qc-cadastre-lots/`. */
export const NORMALIZED_ZONES_PREFIX = "normalized/ca-qc-zonage/";
export const NORMALIZED_LOTS_ENRICHED_PREFIX = "normalized/qc-lots/";
export const NORMALIZED_LOTS_CADASTRE_PREFIX = "normalized/qc-cadastre-lots/";

// ── CLI arg helpers (partagés par les runners minces) ────────────────────────
export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
export const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

/** Client S3 depuis un préfixe de creds env (forcePathStyle, region par défaut). */
export function clientFrom(prefix: string): S3Client {
  const endpoint = process.env[`${prefix}ENDPOINT`];
  const region = process.env[`${prefix}REGION`] || "us-east-1";
  const ak = process.env[`${prefix}ACCESS_KEY`];
  const sk = process.env[`${prefix}SECRET_KEY`];
  const cfg: ConstructorParameters<typeof S3Client>[0] = { forcePathStyle: true, region };
  if (endpoint) cfg.endpoint = endpoint;
  if (ak && sk) cfg.credentials = { accessKeyId: ak, secretAccessKey: sk };
  return new S3Client(cfg);
}

/** Listing paginé complet {key,size} ; `complete=false` si tronqué/erreur (garde-fou). */
export async function listAll(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<{ keys: { key: string; size: number }[]; complete: boolean }> {
  const keys: { key: string; size: number }[] = [];
  try {
    let token: string | undefined;
    do {
      const out = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of out.Contents ?? []) if (typeof o.Key === "string") keys.push({ key: o.Key, size: o.Size ?? 0 });
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return { keys, complete: true };
  } catch {
    return { keys, complete: false };
  }
}

/** sha256 d'une clé `…/cas/<sha256>.<ext>` = son adresse de contenu. */
export function shaOfCasKey(key: string): string | null {
  const m = /\/cas\/([0-9a-f]{64})(?:\.[^/]+)?$/.exec(key);
  return m ? m[1]! : null;
}

// ── Contexte bascule (deux jeux de creds, un cycle) ──────────────────────────
export interface BasculeCtx {
  readonly source: S3Client;
  readonly backup: S3Client;
  readonly srcBucket: string;
  readonly bakBucket: string;
  readonly cycleId: string;
  readonly dryRun: boolean;
}

/** Assemble le contexte depuis l'env (buckets requis → fail-closed). */
export function ctxFromEnv(cycleId: string, dryRun: boolean): BasculeCtx {
  const srcBucket = process.env["GEO_S3_SOURCE_BUCKET"];
  const bakBucket = process.env["S3_BACKUP_BUCKET"];
  if (!srcBucket || !bakBucket) {
    throw new Error("bascule-geo: GEO_S3_SOURCE_BUCKET et S3_BACKUP_BUCKET requis");
  }
  return {
    source: clientFrom("GEO_S3_SOURCE_"),
    backup: clientFrom("S3_BACKUP_"),
    srcBucket,
    bakBucket,
    cycleId,
    dryRun,
  };
}

/** Le préfixe du set de ce cycle (`geo-objects/prod/sets/<cycleId>`). */
export function setPrefix(cycleId: string): string {
  return `geo-objects/prod/sets/${cycleId}`;
}

// ── CORE 1 : CAS backup (jambe IRREMPLAÇABLE) ────────────────────────────────
export interface CasBackupResult {
  readonly inventoryKey: string;
  readonly count: number;
  readonly totalBytes: number;
  readonly setHash: string;
  readonly copies: { readonly planned: number; readonly done: number; readonly deduped: number };
  readonly reconcile: CasReconcileResult;
}

/**
 * Copie content-addressed dédupliquée du set irremplaçable prod → bucket backup,
 * PUIS réconciliation sha256 fail-closed. Sens-unique strict. Ne fait AUCUN
 * `process.exit` : rend le résultat (dont `reconcile.ok`) ; l'appelant décide.
 */
export async function runCasBackup(ctx: BasculeCtx, opts: { sourcePrefix: string }): Promise<CasBackupResult> {
  const { source, backup, srcBucket, bakBucket, cycleId, dryRun } = ctx;

  // 1) Set irremplaçable source (content-addressed) → entrées {sha256,size,sourceKey}.
  const srcListing = await listAll(source, srcBucket, `${opts.sourcePrefix}/`);
  if (!srcListing.complete) throw new Error("bascule-geo cas: listing SOURCE incomplet — refus (garde-fou set partiel)");
  const entries: CasSourceEntry[] = [];
  for (const o of srcListing.keys) {
    const sha = shaOfCasKey(o.key);
    if (sha) entries.push({ sourceKey: o.key, sha256: sha, size: o.size });
  }
  const inventory = buildCasInventory(cycleId, entries);

  // 2) Dédup contre le backup existant → plan de copies.
  const bakListing = await listAll(backup, bakBucket, `${CAS_PREFIX}/`);
  if (!bakListing.complete) throw new Error("bascule-geo cas: listing BACKUP incomplet — refus");
  const existing = new Set<string>();
  for (const o of bakListing.keys) {
    const s = o.key.slice(CAS_PREFIX.length + 1);
    if (s) existing.add(s);
  }
  const toCopy = planCasCopies(inventory, existing);

  // 3) Copie get→put streaming (creds séparées) vers geo-objects/cas/<sha256>.
  const bySha = new Map(inventory.entries.map((e) => [e.sha256, e]));
  let copied = 0;
  for (const sha of toCopy) {
    const e = bySha.get(sha)!;
    if (dryRun) {
      copied++;
      continue;
    }
    const g = await source.send(new GetObjectCommand({ Bucket: srcBucket, Key: e.sourceKey }));
    await backup.send(
      new PutObjectCommand({
        Bucket: bakBucket,
        Key: casObjectKey(sha, CAS_PREFIX),
        Body: g.Body as unknown as Uint8Array,
        ContentLength: e.size,
      }),
    );
    copied++;
  }

  // 4) Inventaire du cycle → sets/<cycleId>/inventory.json.
  const inventoryKey = `${setPrefix(cycleId)}/inventory.json`;
  if (!dryRun) {
    await backup.send(
      new PutObjectCommand({
        Bucket: bakBucket,
        Key: inventoryKey,
        Body: serializeCasInventory(inventory),
        ContentType: "application/json",
      }),
    );
  }

  // 5) Réconciliation sha256 fail-closed : chaque sha présent, taille correcte.
  const bakAfter = await listAll(backup, bakBucket, `${CAS_PREFIX}/`);
  const target = new Map<string, CasTargetEntry>();
  for (const o of bakAfter.keys) target.set(o.key, { size: o.size });
  const reconcile = reconcileCasInventory(inventory, target, CAS_PREFIX);

  return {
    inventoryKey,
    count: inventory.count,
    totalBytes: inventory.totalBytes,
    setHash: inventory.setHash,
    copies: { planned: toCopy.length, done: copied, deduped: inventory.count - toCopy.length },
    reconcile,
  };
}

// ── CORE 2 : served-ids (jambe SERVI) ────────────────────────────────────────
export interface ServedIdsResult {
  readonly prefix: string;
  readonly servedIdsKey: string;
  readonly servedCount: number;
  /** sha256 du set trié NON compressé (les octets hashés dans geo.json s3_servi.sha256). */
  readonly sha256: string;
  /** Identité du set = même digest que `sha256` (le set EST la liste triée d'ids). */
  readonly setHash: string;
  readonly collections: { readonly zones: number; readonly lots: number };
  /** Réconciliation lecture-arrière du .gz déposé (fail-closed). `true` en dry-run. */
  readonly reconciled: boolean;
}

/** Profondeur de chemin (segments `/`) — pour préférer le sous-dossier au plat. */
function keyDepth(key: string): number {
  return key.split("/").length;
}

/** Une clé de zone servie par slug : sous-dossier prioritaire sur le plat (geo-api). */
function chooseZoneKeys(keys: readonly string[]): string[] {
  const bySlug = new Map<string, string>();
  for (const key of keys) {
    if (!isServedZoneKey(key)) continue;
    const slug = municipalSlugFromNormalizedKey(key);
    const prev = bySlug.get(slug);
    if (!prev || keyDepth(key) > keyDepth(prev)) bySlug.set(slug, key);
  }
  return [...bySlug.values()];
}

/** Une clé de lots par slug : enrichi (`qc-lots/`) prioritaire sur cadastre. */
function chooseLotKeys(enriched: readonly string[], cadastre: readonly string[]): string[] {
  const bySlug = new Map<string, string>();
  for (const key of cadastre) if (isCanonicalGeojsonKey(key)) bySlug.set(municipalSlugFromNormalizedKey(key), key);
  for (const key of enriched) if (isCanonicalGeojsonKey(key)) bySlug.set(municipalSlugFromNormalizedKey(key), key);
  return [...bySlug.values()];
}

/**
 * Construit + dépose le set served-ids du cycle : lit `normalized/` (zones + lots)
 * depuis la SOURCE feature-par-feature (buffer, jamais de string géante), mappe via
 * le seam pur `@sentropic/geo`, canonicalise/trie/dédup via `buildServedCanonicalIds`,
 * gzip → PutObject `sets/<cycleId>/served-ids.ndjson.gz` sur le backup, puis
 * réconcilie le .gz déposé (gunzip → sha256 == sha256 du set) fail-closed. Ne fait
 * AUCUN `process.exit`.
 */
export async function runServedIds(ctx: BasculeCtx): Promise<ServedIdsResult> {
  const { source, backup, srcBucket, bakBucket, cycleId, dryRun } = ctx;

  const zoneListing = await listAll(source, srcBucket, NORMALIZED_ZONES_PREFIX);
  if (!zoneListing.complete) throw new Error("bascule-geo served: listing ZONES incomplet — refus");
  const lotsEnrichedListing = await listAll(source, srcBucket, NORMALIZED_LOTS_ENRICHED_PREFIX);
  if (!lotsEnrichedListing.complete) throw new Error("bascule-geo served: listing LOTS(enrichi) incomplet — refus");
  const lotsCadastreListing = await listAll(source, srcBucket, NORMALIZED_LOTS_CADASTRE_PREFIX);
  if (!lotsCadastreListing.complete) throw new Error("bascule-geo served: listing LOTS(cadastre) incomplet — refus");

  const zoneKeys = chooseZoneKeys(zoneListing.keys.map((o) => o.key));
  const lotKeys = chooseLotKeys(
    lotsEnrichedListing.keys.map((o) => o.key),
    lotsCadastreListing.keys.map((o) => o.key),
  );

  const zones: ServedZoneRef[] = [];
  const lots: ServedLotRef[] = [];
  for (const key of zoneKeys) {
    const fc = parseFeatureCollectionBuffer(await getBytes(source, key, srcBucket), key);
    zones.push(...collectionFeaturesToRefs(key, "zones", fc.features as { properties?: Record<string, unknown> | null }[]).zones);
  }
  for (const key of lotKeys) {
    const fc = parseFeatureCollectionBuffer(await getBytes(source, key, srcBucket), key);
    lots.push(...collectionFeaturesToRefs(key, "lots", fc.features as { properties?: Record<string, unknown> | null }[]).lots);
  }

  const ids = buildServedCanonicalIds({ zones, lots });
  const serialized = serializeServedCanonicalIds(ids);
  const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
  const gz = gzipSync(Buffer.from(serialized, "utf8"));

  const prefix = setPrefix(cycleId);
  const servedIdsKey = `${prefix}/served-ids.ndjson.gz`;

  let reconciled = true;
  if (!dryRun) {
    await backup.send(
      new PutObjectCommand({
        Bucket: bakBucket,
        Key: servedIdsKey,
        Body: gz,
        ContentType: "application/gzip",
      }),
    );
    // Réconciliation : relire le .gz déposé, gunzip, re-hasher le set décompressé.
    const back = gunzipSync(await getBytes(backup, servedIdsKey, bakBucket)).toString("utf8");
    reconciled = createHash("sha256").update(back, "utf8").digest("hex") === sha256;
  }

  return {
    prefix,
    servedIdsKey,
    servedCount: ids.length,
    sha256,
    setHash: sha256,
    collections: { zones: zoneKeys.length, lots: lotKeys.length },
    reconciled,
  };
}
