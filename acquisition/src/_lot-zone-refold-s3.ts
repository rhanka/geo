/**
 * _lot-zone-refold-s3.ts — I/O S3 sûr pour le RE-FOLD de cohérence lot↔zone.
 *
 * Contexte : re-dériver `code_zone` des lots par aire-majorité contre la géométrie
 * `qc-zonage` SERVIE ACTUELLE (voir `lot-zone-consistency-audit.ts`). La chaîne
 * committée `lot-zone-join-run.ts` → `lots-enriched-run.ts` recalcule et re-dépose,
 * mais elle ÉCRASE les objets S3 SANS sauvegarde et n'écrit QUE la clé plate
 * `normalized/qc-lots/qc-lots-<slug>.geojson`. Or geo-api résout vers le
 * SOUS-DOSSIER quand il existe (mémoire fold-double-key-s3-serving) : mettre à jour
 * la seule clé plate laisserait le sous-dossier périmé SERVI.
 *
 * Cet utilitaire compose UNIQUEMENT les helpers S3 committés (`lib/s3.ts`) :
 *   - report  : liste les clés existantes (plate/sous-dossier, parquet, stats) + tailles.
 *   - backup  : copie chaque clé existante vers `<dir>/_replaced/<basename>.<ts>`
 *               (idiome zones-*-run.ts ; NON-DESTRUCTIF, garde par exists).
 *   - mirror  : recopie la clé PLATE qc-lots (geojson + stats) vers le SOUS-DOSSIER
 *               pour que les DEUX layouts servis soient identiques et frais.
 *   - verify  : relit une clé geojson servie et rapporte le nb de features + le
 *               `code_zone` des lots demandés (--lots), preuve de fraîcheur post-dépôt.
 *
 * Il ne recalcule AUCUN fold ni géométrie — c'est le rôle des runners committés.
 *
 * Usage :
 *   npx tsx acquisition/src/_lot-zone-refold-s3.ts --slug saint-stanislas-de-kostka --mode report
 *   npx tsx acquisition/src/_lot-zone-refold-s3.ts --slug saint-stanislas-de-kostka --mode backup
 *   npx tsx acquisition/src/_lot-zone-refold-s3.ts --slug saint-stanislas-de-kostka --mode mirror
 *   npx tsx acquisition/src/_lot-zone-refold-s3.ts --slug saint-stanislas-de-kostka --mode verify \
 *       --lots 5684764,5124384,5124470
 */
import type { S3Client } from "@aws-sdk/client-s3";

import {
  BUCKET,
  copyObject,
  exists,
  getBytes,
  getGeoJsonFeatureCollection,
  objectHead,
  putBytes,
  s3Client,
} from "./lib/s3.js";

interface KeySpec {
  label: string;
  key: string;
  contentType: string;
}

/** Les objets servis / dérivés touchés par un re-fold lot↔zone d'un slug. */
function keySet(slug: string): {
  lotsFlat: KeySpec;
  lotsSubdir: KeySpec;
  lotsStatsFlat: KeySpec;
  lotsStatsSubdir: KeySpec;
  zonageParquet: KeySpec;
  zonageStats: KeySpec;
} {
  return {
    lotsFlat: {
      label: "qc-lots geojson (plate)",
      key: `normalized/qc-lots/qc-lots-${slug}.geojson`,
      contentType: "application/geo+json",
    },
    lotsSubdir: {
      label: "qc-lots geojson (sous-dossier)",
      key: `normalized/qc-lots/qc-lots-${slug}/qc-lots-${slug}.geojson`,
      contentType: "application/geo+json",
    },
    lotsStatsFlat: {
      label: "qc-lots stats (plate)",
      key: `normalized/qc-lots/qc-lots-${slug}.stats.json`,
      contentType: "application/json",
    },
    lotsStatsSubdir: {
      label: "qc-lots stats (sous-dossier)",
      key: `normalized/qc-lots/qc-lots-${slug}/qc-lots-${slug}.stats.json`,
      contentType: "application/json",
    },
    zonageParquet: {
      label: "qc-lot-zonage parquet",
      key: `normalized/qc-lot-zonage/${slug}.parquet`,
      contentType: "application/octet-stream",
    },
    zonageStats: {
      label: "qc-lot-zonage stats",
      key: `normalized/qc-lot-zonage/${slug}.stats.json`,
      contentType: "application/json",
    },
  };
}

/** Timestamp compact (idiome zones-*-run.ts), unique à la milliseconde. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "") + "Z";
}

/** `dir/base.ext` -> `dir/_replaced/base.ext.<ts>` (backup horodaté frère). */
function backupKeyFor(key: string, ts: string): string {
  const slash = key.lastIndexOf("/");
  const dir = key.slice(0, slash);
  const base = key.slice(slash + 1);
  return `${dir}/_replaced/${base}.${ts}`;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function headSize(s3: S3Client, key: string): Promise<number | null> {
  const h = await objectHead(s3, key);
  if (!h.exists) return null;
  // objectHead ne renvoie pas la taille ; HEAD via getBytes serait coûteux.
  // On lit la taille par un HEAD dédié seulement en report (petit volume attendu
  // pour parquet/stats ; le geojson peut être gros mais un HEAD reste léger).
  return await sizeOf(s3, key);
}

async function sizeOf(s3: S3Client, key: string): Promise<number | null> {
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return typeof r.ContentLength === "number" ? r.ContentLength : null;
  } catch {
    return null;
  }
}

/** Taille via HEAD qui PROPAGE l'erreur réseau (pour que withRetry puisse rejouer). */
async function sizeOfStrict(s3: S3Client, key: string): Promise<number | null> {
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return typeof r.ContentLength === "number" ? r.ContentLength : null;
}

/** Rejoue une opération S3 sur erreur réseau transitoire (ETIMEDOUT & co). */
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      const transient = /ETIMEDOUT|ECONNRESET|EAI_AGAIN|EPIPE|socket hang up|timeout|TimeoutError|NetworkingError/i.test(msg);
      if (!transient || attempt === tries) throw e;
      console.log(`  RETRY(${attempt}/${tries}) ${label}: ${msg}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

/**
 * RESTORE : recopie chaque backup horodaté (`_replaced/<base>.<ts>`) vers sa clé
 * SERVIE d'origine (ROLLBACK d'un re-fold). GARDE-FOU : si l'un des 4 backups CŒUR
 * (qc-lots geojson+stats plats, qc-lot-zonage parquet+stats) est absent pour ce ts,
 * on n'écrit RIEN pour ce slug (pas de restauration partielle, pas de fabrication).
 * Les 2 layouts sous-dossier qc-lots sont restaurés en plus SI un backup existe.
 */
async function restore(s3: S3Client, slug: string): Promise<void> {
  const ts = arg("ts");
  if (!ts) {
    console.error("restore exige --ts <timestamp-du-backup>");
    process.exit(2);
  }
  const ks = keySet(slug);
  const core: KeySpec[] = [ks.lotsFlat, ks.lotsStatsFlat, ks.zonageParquet, ks.zonageStats];
  const optional: KeySpec[] = [ks.lotsSubdir, ks.lotsStatsSubdir];
  console.log(`# RESTORE (rollback) ts=${ts} — ${slug}`);

  // Phase 1 : PROUVER que les 4 backups cœur existent AVANT toute écriture.
  const missingCore: string[] = [];
  for (const spec of core) {
    const src = backupKeyFor(spec.key, ts);
    const present = await withRetry(`exists ${src}`, () => exists(s3, src));
    console.log(`  probe backup   ${present ? "PRESENT" : "ABSENT "}  ${src}`);
    if (!present) missingCore.push(src);
  }
  if (missingCore.length) {
    console.log(`# RESTORE ABORT — ${missingCore.length} backup(s) cœur introuvable(s) pour ts=${ts} : AUCUNE écriture.`);
    console.log(`# ROLLBACK: ECHEC(backup-manquant) ${slug}`);
    return;
  }

  // Phase 2 : restaurer cœur (tous présents) + sous-dossier (si backup présent).
  let restored = 0, failed = 0, skipped = 0;
  for (const spec of [...core, ...optional]) {
    const src = backupKeyFor(spec.key, ts);
    try {
      if (!(await withRetry(`exists ${src}`, () => exists(s3, src)))) {
        console.log(`  SKIP(no-backup) ${spec.label.padEnd(34)} ${src}`);
        skipped++;
        continue;
      }
      const srcSize = await withRetry(`size ${src}`, () => sizeOfStrict(s3, src));
      await withRetry(`copy ${src}`, () => copyObject(s3, src, spec.key));
      const dstSize = await withRetry(`size ${spec.key}`, () => sizeOfStrict(s3, spec.key));
      const sizeOk = srcSize !== null && dstSize !== null && srcSize === dstSize;
      console.log(
        `  ${sizeOk ? "RESTORE ok    " : "RESTORE ⚠SIZE "} ${spec.key}  <-  ${src}  (backup=${srcSize} restauré=${dstSize})`,
      );
      restored++;
    } catch (e) {
      console.log(`  FAIL           ${spec.label.padEnd(34)} ${src}  ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
      failed++;
    }
  }
  const ok = failed === 0 && restored >= core.length;
  console.log(`# RESTORE terminé : restauré=${restored} skip=${skipped} échec=${failed}`);
  console.log(`# ROLLBACK: ${ok ? "OK" : "ECHEC"} ${slug}`);
}

async function report(s3: S3Client, slug: string): Promise<void> {
  const ks = keySet(slug);
  console.log(`# REPORT layout S3 — ${slug}`);
  for (const spec of Object.values(ks)) {
    const size = await headSize(s3, spec.key);
    console.log(
      `  ${size === null ? "ABSENT " : "PRESENT"}  ${spec.label.padEnd(34)} ${spec.key}` +
        (size !== null ? `  (${size} o)` : ""),
    );
  }
}

async function backup(s3: S3Client, slug: string): Promise<void> {
  const ts = arg("ts") ?? stamp();
  const ks = keySet(slug);
  console.log(`# BACKUP horodaté ts=${ts} — ${slug}`);
  let done = 0;
  for (const spec of Object.values(ks)) {
    if (!(await exists(s3, spec.key))) {
      console.log(`  SKIP(absent)   ${spec.label.padEnd(34)} ${spec.key}`);
      continue;
    }
    const dest = backupKeyFor(spec.key, ts);
    if (await exists(s3, dest)) {
      console.log(`  SKIP(déjà)     ${dest}`);
      continue;
    }
    await copyObject(s3, spec.key, dest);
    // Preuve : le backup existe et n'est pas vide.
    const sz = await sizeOf(s3, dest);
    console.log(`  BACKUP ok      ${spec.key}  ->  ${dest}  (${sz ?? "?"} o)`);
    done++;
  }
  console.log(`# BACKUP terminé : ${done} objet(s) sauvegardé(s), ts=${ts}`);
}

async function mirror(s3: S3Client, slug: string): Promise<void> {
  const ks = keySet(slug);
  console.log(`# MIRROR plate -> sous-dossier — ${slug}`);
  const pairs: Array<[KeySpec, KeySpec]> = [
    [ks.lotsFlat, ks.lotsSubdir],
    [ks.lotsStatsFlat, ks.lotsStatsSubdir],
  ];
  for (const [src, dst] of pairs) {
    if (!(await exists(s3, src.key))) {
      console.log(`  SKIP(src absent) ${src.key}`);
      continue;
    }
    const body = await getBytes(s3, src.key);
    await putBytes(s3, dst.key, body, dst.contentType);
    const sz = await sizeOf(s3, dst.key);
    console.log(`  MIRROR ok      ${src.key}  ->  ${dst.key}  (${sz ?? "?"} o)`);
  }
}

/** Normalise un no_lot : retire tous les espaces (contrat de jointure). */
function normLot(v: unknown): string {
  return String(v ?? "").replace(/\s/g, "");
}

async function verify(s3: S3Client, slug: string): Promise<void> {
  const wantLots = new Set(
    (arg("lots") ?? "")
      .split(",")
      .map((s) => normLot(s))
      .filter(Boolean),
  );
  const ks = keySet(slug);
  for (const spec of [ks.lotsFlat, ks.lotsSubdir]) {
    if (!(await exists(s3, spec.key))) {
      console.log(`# VERIFY ${spec.label}: ABSENT ${spec.key}`);
      continue;
    }
    const fc = await getGeoJsonFeatureCollection<{
      properties?: Record<string, unknown> | null;
    }>(s3, spec.key);
    const feats = fc.features ?? [];
    let withCode = 0;
    const hits: Array<{ no_lot: string; code_zone: unknown }> = [];
    for (const f of feats) {
      const p = f.properties ?? {};
      const cz = p["code_zone"] ?? p["zone_code"];
      if (cz !== null && cz !== undefined && cz !== "") withCode++;
      if (wantLots.size) {
        const nl = normLot(p["no_lot"] ?? p["NO_LOT"] ?? p["lot_id"]);
        if (wantLots.has(nl)) hits.push({ no_lot: String(p["no_lot"] ?? p["NO_LOT"] ?? nl), code_zone: cz });
      }
    }
    console.log(
      `# VERIFY ${spec.label}: features=${feats.length} with_code_zone=${withCode} ` +
        `(${feats.length ? Math.round((1000 * withCode) / feats.length) / 10 : 0}%)`,
    );
    for (const h of hits) console.log(`    lot ${h.no_lot} -> code_zone=${JSON.stringify(h.code_zone)}`);
  }
}

async function main(): Promise<void> {
  const slug = arg("slug");
  const mode = arg("mode");
  if (!slug || !mode) {
    console.error("usage: --slug <slug> --mode <report|backup|restore|mirror|verify> [--lots a,b,c] [--ts <ts>]");
    process.exit(2);
  }
  const s3 = s3Client();
  switch (mode) {
    case "report":
      await report(s3, slug);
      break;
    case "backup":
      await backup(s3, slug);
      break;
    case "restore":
      await restore(s3, slug);
      break;
    case "mirror":
      await mirror(s3, slug);
      break;
    case "verify":
      await verify(s3, slug);
      break;
    default:
      console.error(`mode inconnu: ${mode}`);
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
