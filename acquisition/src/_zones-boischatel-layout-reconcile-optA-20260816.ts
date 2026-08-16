/**
 * _zones-boischatel-layout-reconcile-optA-20260816.ts — OPTION A (réconciliation-layout CAPTURE-FREE).
 *
 * CONTEXTE : geo-api sert le layout NESTED quand flat+nested coexistent. Pour boischatel le NESTED est
 * une couche MRC-affectation MAL-DÉPOSÉE (17 polys, zone_code=null, champ Affectatio) alors que le vrai
 * zonage municipal (55 zones georéférencées t2-gcp3) n'existe que dans le FLAT → 4072 lots hors-zone.
 *
 * DÉCISION (geo-cond) : « pas de delete-only » LEVÉ POUR CE CAS PRÉCIS (nested-affectation-null-prouvé-bug,
 * backup réversible, scopé). FIX = BACKUP vérifié du nested vers _replaced/ PUIS suppression du nested, si
 * bien que geo-api retombe sur le FLAT (layout unique, comme amherst). On NE TOUCHE PAS le flat. On NE
 * FABRIQUE AUCUNE preuve v2 (la v2-proof boischatel reste legacy, différée recalage — KPI séparé).
 *
 * GARDE DURE : le backup DOIT exister + être lisible + non-vide + JSON.parse OK + 17 features affectation
 * AVANT tout delete. Si la vérif du backup échoue → NE SUPPRIME PAS, sort en erreur.
 *
 * Convention de nommage backup : miroir de beaupré (commit cea1a7c7,
 * _zones-col2-reacq-deposit-20260816.ts backupStamp()) :
 *   normalized/ca-qc-zonage/_replaced/qc-zonage-boischatel__nested-misdeposit.<stamp>.geojson
 *
 * --commit : exécute backup+vérif+delete+vérif. Défaut : dry-run (état courant + chemin backup planifié).
 * --out f.json : écrit le record machine.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-boischatel-layout-reconcile-optA-20260816.ts [--commit] \
 *     --out work/coverage/zones-boischatel-layout-reconcile-optA-record-20260816.json
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { copyObject, deleteObject, exists, getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SLUG = "boischatel";
const S3_PREFIX = "normalized/ca-qc-zonage/";
const FLAT_KEY = `${S3_PREFIX}qc-zonage-${SLUG}.geojson`;
const NESTED_KEY = `${S3_PREFIX}qc-zonage-${SLUG}/qc-zonage-${SLUG}.geojson`;
const NESTED_PREFIX = `${S3_PREFIX}qc-zonage-${SLUG}/`;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}
function has(name: string): boolean { return process.argv.includes(`--${name}`); }
function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
/** Miroir EXACT de backupStamp() du dépôt beaupré (cea1a7c7). */
function backupStamp(): string { return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z"; }

interface Feat { geometry?: { type?: string } | null; properties?: Record<string, unknown> | null }
interface FC { type?: string; features?: Feat[] }

function summarize(fc: FC): { feature_count: number; distinct_zone_code_canon: number; empty_zone_code_features: number; has_affectatio_field: boolean } {
  const feats = Array.isArray(fc.features) ? fc.features : [];
  const codes = new Set<string>();
  let empty = 0;
  let hasAffectatio = false;
  for (const f of feats) {
    const p = f.properties ?? {};
    if ("Affectatio" in p) hasAffectatio = true;
    const c = canon(p["zone_code"]);
    if (c) codes.add(c); else empty++;
  }
  return { feature_count: feats.length, distinct_zone_code_canon: codes.size, empty_zone_code_features: empty, has_affectatio_field: hasAffectatio };
}

async function main(): Promise<void> {
  requireS3();
  const commit = has("commit");
  const out = arg("out");
  const s3 = s3Client();
  const record: Record<string, unknown> = {
    contract: "zones-boischatel-layout-reconcile-optA/v1",
    date: "2026-08-16",
    mode: commit ? "commit" : "dry-run",
    decision: "OPTION A — geo-cond a LEVÉ « pas de delete-only » pour CE cas scopé (nested-affectation-null-prouvé-bug, backup réversible). Backup vérifié du nested puis suppression; geo-api retombe sur le flat. Flat NON touché; aucune preuve v2 fabriquée.",
    flat_key: FLAT_KEY,
    nested_key: NESTED_KEY,
    generated_at_utc: new Date().toISOString(),
  };

  // ── État courant (avant) ──
  const flatExistsBefore = await exists(s3, FLAT_KEY);
  const nestedExistsBefore = await exists(s3, NESTED_KEY);
  record.flat_exists_before = flatExistsBefore;
  record.nested_exists_before = nestedExistsBefore;
  if (!flatExistsBefore) { record.statut = "STOP"; record.raison = "FLAT absent — refus de supprimer le nested sans zonage de repli"; emit(record, out); throw new Error(String(record.raison)); }
  if (!nestedExistsBefore) { record.statut = "NOOP"; record.raison = "NESTED déjà absent — rien à réconcilier (geo-api sert déjà le flat)"; emit(record, out); return; }

  const flatFc = JSON.parse((await getBytes(s3, FLAT_KEY)).toString("utf8")) as FC;
  const nestedFc = JSON.parse((await getBytes(s3, NESTED_KEY)).toString("utf8")) as FC;
  const flatBefore = summarize(flatFc);
  const nestedBefore = summarize(nestedFc);
  record.flat_before = flatBefore;
  record.nested_before = nestedBefore;

  // Vérif de la cible AVANT toute action : flat=55 vrai zonage, nested=affectation-null (17 feat, 0 code).
  const flatOk = flatBefore.feature_count === 55 && flatBefore.distinct_zone_code_canon === 55 && flatBefore.empty_zone_code_features === 0;
  const nestedIsAffectationNull = nestedBefore.distinct_zone_code_canon === 0 && nestedBefore.empty_zone_code_features === nestedBefore.feature_count && nestedBefore.has_affectatio_field;
  record.target_flat_is_55_real = flatOk;
  record.target_nested_is_affectation_null = nestedIsAffectationNull;
  if (!flatOk || !nestedIsAffectationNull) {
    record.statut = "STOP";
    record.raison = `cible non conforme (flat 55 réel=${flatOk}, nested affectation-null=${nestedIsAffectationNull}) — refus d'agir sur une hypothèse fausse`;
    emit(record, out);
    throw new Error(String(record.raison));
  }

  // TOUS les objets sous le préfixe nested (le « dossier nested »). Découvert au dry-run :
  // la geojson servie + un sidecar .meta.json. On backup + supprime TOUT le dossier pour
  // que geo-api retombe proprement sur le flat (layout unique, comme amherst — pas d'orphelin).
  const nestedPrefixObjects = (await listObjectEntries(s3, NESTED_PREFIX)).map((e) => e.key);
  record.nested_prefix_objects_before = nestedPrefixObjects;
  if (!nestedPrefixObjects.includes(NESTED_KEY)) {
    record.statut = "STOP";
    record.raison = `la clé servie nested ${NESTED_KEY} n'est pas listée sous le préfixe — refus d'agir`;
    emit(record, out);
    throw new Error(String(record.raison));
  }

  const stamp = backupStamp();
  // Chemin backup de la geojson servie (miroir beaupré) ; le sidecar prend le MÊME stamp.
  const backupKey = `${S3_PREFIX}_replaced/qc-zonage-${SLUG}__nested-misdeposit.${stamp}.geojson`;
  record.backup_key = backupKey;
  const backupDestFor = (srcKey: string): string => {
    if (srcKey === NESTED_KEY) return backupKey;
    // sidecar(s) : conserve le suffixe après le nom de base servi.
    const suffix = srcKey.slice(NESTED_PREFIX.length).replace(/^qc-zonage-boischatel/, "");
    return `${S3_PREFIX}_replaced/qc-zonage-${SLUG}__nested-misdeposit.${stamp}${suffix}`;
  };
  const plan = nestedPrefixObjects.map((src) => ({ src, dest: backupDestFor(src), is_served_geojson: src === NESTED_KEY }));
  record.backup_plan = plan;

  if (!commit) {
    record.statut = "DRY-RUN-OK";
    record.raison = `prêt : backup ${plan.length} objet(s) du dossier nested -> _replaced/ (stamp ${stamp}), vérif de CHAQUE backup, puis delete de tout le dossier (relancer avec --commit)`;
    emit(record, out);
    return;
  }

  // ── 1) BACKUP D'ABORD (tous les objets du dossier nested) ──
  const backups: Array<Record<string, unknown>> = [];
  let allBackupsVerified = true;
  for (const item of plan) {
    await copyObject(s3, item.src, item.dest);
    process.stderr.write(`[optA] backup ${item.src} -> s3://${item.dest}\n`);
    // ── 2) HARD GUARD : vérifier CHAQUE backup AVANT tout delete ──
    const bExists = await exists(s3, item.dest);
    let bLen = 0;
    let bParseOk = false;
    let bSummary: ReturnType<typeof summarize> | null = null;
    if (bExists) {
      const b = await getBytes(s3, item.dest);
      bLen = b.length;
      try { const parsed = JSON.parse(b.toString("utf8")) as FC; bParseOk = true; if (item.is_served_geojson) bSummary = summarize(parsed); }
      catch { bParseOk = false; }
    }
    // La geojson servie DOIT vérifier 17 feat affectation ; les sidecars : exists + non-vide + JSON OK.
    const verified = item.is_served_geojson
      ? (bExists && bLen > 0 && bParseOk && !!bSummary && bSummary.feature_count === 17 && bSummary.distinct_zone_code_canon === 0 && bSummary.has_affectatio_field)
      : (bExists && bLen > 0 && bParseOk);
    if (!verified) allBackupsVerified = false;
    backups.push({ src: item.src, dest: item.dest, is_served_geojson: item.is_served_geojson, exists: bExists, bytes_len: bLen, parse_ok: bParseOk, summary: bSummary, verified });
  }
  record.backups = backups;
  record.backup_verified = allBackupsVerified;
  // Backup principal (geojson) exposé à plat pour le report.
  const primary = backups.find((b) => b.is_served_geojson);
  record.backup_exists = primary?.exists ?? false;
  record.backup_bytes_len = primary?.bytes_len ?? 0;
  record.backup_summary = primary?.summary ?? null;
  if (!allBackupsVerified) {
    record.statut = "STOP-BACKUP-GUARD";
    record.raison = `au moins un backup NON vérifiable — AUCUN DELETE exécuté (${JSON.stringify(backups.map((b) => ({ dest: b.dest, verified: b.verified })))})`;
    record.deleted = false;
    emit(record, out);
    throw new Error(String(record.raison));
  }
  process.stderr.write(`[optA] ${backups.length} backup(s) VÉRIFIÉ(s) — delete du dossier nested autorisé\n`);

  // ── 3) DELETE du dossier nested (tous les objets) ──
  const deletedKeys: string[] = [];
  for (const item of plan) { await deleteObject(s3, item.src); deletedKeys.push(item.src); process.stderr.write(`[optA] deleteObject ${item.src}\n`); }
  record.deleted = true;
  record.deleted_keys = deletedKeys;

  // ── 4) VÉRIF post-delete ──
  const nestedExistsAfter = await exists(s3, NESTED_KEY);
  const flatExistsAfter = await exists(s3, FLAT_KEY);
  record.nested_exists_after = nestedExistsAfter;
  record.flat_exists_after = flatExistsAfter;
  let flatAfter: ReturnType<typeof summarize> | null = null;
  if (flatExistsAfter) flatAfter = summarize(JSON.parse((await getBytes(s3, FLAT_KEY)).toString("utf8")) as FC);
  record.flat_after = flatAfter;
  const nestedPrefixAfter = (await listObjectEntries(s3, NESTED_PREFIX)).map((e) => e.key);
  record.nested_prefix_objects_after = nestedPrefixAfter;
  const flatIntact = !!flatAfter && flatAfter.feature_count === 55 && flatAfter.distinct_zone_code_canon === 55 && flatAfter.empty_zone_code_features === 0;
  record.flat_intact_55_zones = flatIntact;

  record.readback_ok = nestedExistsAfter === false && flatExistsAfter === true && flatIntact && nestedPrefixAfter.length === 0;
  record.statut = record.readback_ok ? "EXECUTED-option-A" : "EXECUTED-READBACK-FAIL";
  record.raison = record.readback_ok
    ? `OPTION A exécutée : dossier nested (${deletedKeys.length} objet(s)) backupé sous _replaced/ (stamp ${stamp}) + supprimé ; préfixe nested vide ; flat intact (55 zones réelles) ; geo-api sert désormais le flat (layout unique, comme amherst). Aucune preuve v2 fabriquée.`
    : `delete effectué mais readback inattendu (nested_gone=${nestedExistsAfter === false}, flat_present=${flatExistsAfter}, flat_intact=${flatIntact}, nested_prefix_empty=${nestedPrefixAfter.length === 0}) — VÉRIFIER`;
  emit(record, out);
  if (!record.readback_ok) throw new Error(String(record.raison));
}

function emit(record: Record<string, unknown>, out: string | undefined): void {
  if (out) { writeFileSync(resolve(ROOT, out), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`RECORD → ${out}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
