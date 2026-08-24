/**
 * _lot-zone-refold-batch.ts — RE-FOLD lot↔zone en BATCH, IN-PROCESS, resume-safe.
 *
 * Contexte : le défaut mesuré par `lot-zone-consistency-audit.ts` (voir
 * `work/coverage/lot-zone-consistency.json`) est un `code_zone` PÉRIMÉ sur des
 * lots, contre une géométrie `qc-zonage` SERVIE et CORRECTE (cf. saint-stanislas
 * 74→7% après re-fold). La correction déterministe est la chaîne déjà committée :
 *
 *   audit AVANT → backup S3 → lot-zone-join-run → lots-enriched-run → mirror → audit APRÈS
 *
 * Ce runner ne recalcule AUCUN fold ni géométrie lui-même — il COMPOSE
 * uniquement les scripts committés (`lot-zone-consistency-audit.ts` importé
 * en process pour l'audit ; `_lot-zone-refold-s3.ts`, `lot-zone-join-run.ts`,
 * `lots-enriched-run.ts` invoqués via `execFileSync` SYNCHRONE — jamais
 * détaché, jamais `&`/`nohup`/background). C'est la contrainte du brief :
 * les runs longs lancés en sous-agent finissaient orphelins en arrière-plan ;
 * ce script tourne EN PROCESS, séquentiel, ville par ville, jusqu'à la fin
 * ou jusqu'à un abandon propre.
 *
 * GATE géométrie-suspecte : si `outside_all` domine le mismatch d'une ville
 * (> 50% des lots EN MISMATCH ont leur centroïde hors de TOUTE zone servie),
 * la géométrie de zone elle-même est suspecte (offset, pas seulement le label)
 * — la ville est SAUTÉE sans dépôt
 * (`skipped_reason: "geometry-suspect"`), plutôt que de re-déposer un fold
 * qui resterait faux.
 *
 * GATE absolue-perte / REVOKED : après dépôt, si le compte ABSOLU de lots
 * porteurs (`num_with_norms` ou `num_with_code_zone`) DÉCROÎT vs avant, le re-fold
 * est ROLLBACK (restore backup) et la ville marquée `REVOKED`. C'est le garde-fou
 * par défaut. Mais `zones` a re-déposé des géométries v2 PROUVÉES qui remplacent
 * d'anciens servis NON-PROUVÉS (zone_source_url=null) : les codes présents dans
 * l'ancien servi mais absents de la v2 sont légitimement DROPPÉS, et leurs lots
 * doivent devenir UNKNOWN-recalage (policy replace-policy ratifiée G3/G4). Le flag
 * `--allow-loss` lève CE seul gate : quand la seule cause de refus est l'absolue-
 * perte, il PROCÈDE AU DÉPÔT au lieu de REVOKER, et documente la perte au record
 * (`allow_loss.dropped_codes` : chaque code-droppé -> UNKNOWN-recalage, url:null,
 * + backup ; `lots_to_unknown` = décroissance absolue de `num_with_code_zone`).
 * `--allow-loss` NE lève PAS les autres gates : une ville à la fois geometry-suspect
 * ET loss exige les DEUX flags.
 *
 * RETRY : chaque étape réseau (audit S3, backup, join, enrich, mirror) est
 * retentée jusqu'à 2 fois sur ETIMEDOUT. Au-delà, le run entier s'ARRÊTE
 * proprement (journal écrit, message clair villes faites / ville en échec,
 * code de sortie non-zéro) — un ETIMEDOUT persistant n'est PAS une raison de
 * sauter silencieusement une ville et de continuer.
 *
 * RESUME : `--out <journal.json>` est relu au démarrage ; toute ville déjà
 * `deposited:true` dans le journal est sautée (idempotence de reprise). Les
 * villes skip (not-served / geometry-suspect / erreur) sont retentées au
 * prochain run (elles ne sont jamais devenues `deposited:true`).
 *
 * Usage :
 *   npx tsx acquisition/src/_lot-zone-refold-batch.ts \
 *     --slugs saint-gilbert,autre-slug \
 *     --max-seconds 2400 \
 *     --simplify-zones-m 1 \
 *     --out work/coverage/_refold-batch-progress.json
 *
 *   # ou depuis une liste (une ligne par slug, '#' = commentaire) :
 *   npx tsx acquisition/src/_lot-zone-refold-batch.ts \
 *     --slugs-file work/coverage/_refold-batch-slugs.txt \
 *     --out work/coverage/_refold-batch-progress.json
 *
 *   # Matérialiser des normes déjà pliées : ne pas pré-juger la géométrie,
 *   # mais révoquer sur toute perte absolue mesurée :
 *   npx tsx acquisition/src/_lot-zone-refold-batch.ts \
 *     --slugs arundel --simplify-zones-m 0 --allow-geometry-suspect \
 *     --out work/coverage/immo-bprime-normes-lots-rematerialization-20260726.json
 *
 *   # Re-fold contre une v2 PROUVÉE plus petite : accepter la perte absolue
 *   # (codes-droppés -> UNKNOWN-recalage) plutôt que de révoquer, en la documentant :
 *   npx tsx acquisition/src/_lot-zone-refold-batch.ts \
 *     --slugs saint-hippolyte,saint-colomban --allow-loss \
 *     --out work/coverage/refold-allowloss-20260810-progress.json
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { auditCity, type CityReport } from "./lot-zone-consistency-audit.js";
import { exists, getJson, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ_DIR = join(HERE, ".."); // acquisition/ — cwd pour npx tsx (résout node_modules/.bin/tsx local)
const JOIN_RUN = join(HERE, "lot-zone-join-run.ts");
const ENRICH_RUN = join(HERE, "lots-enriched-run.ts");
const S3_HELPER = join(HERE, "_lot-zone-refold-s3.ts");

const MAX_RETRIES = 2;
const OUTSIDE_ALL_SKIP_FRACTION = 0.5;
const EXAMPLE_LIMIT = 3;
// Sous `--allow-loss`, l'audit-before sert à ÉNUMÉRER les codes-droppés (codes
// assignés dont les lots sortent de toute zone v2). On lève alors le plafond
// d'exemples pour capturer l'ensemble des codes concernés, pas un échantillon de 3.
// (borné pour éviter une explosion mémoire sur une grosse ville pathologique.)
const LOSS_AUDIT_EXAMPLE_LIMIT = 50_000;

// ── erreurs de contrôle ──────────────────────────────────────────────────────

/** Un ETIMEDOUT a survécu à `MAX_RETRIES` tentatives — abandon du BATCH entier. */
class ExhaustedTimeoutError extends Error {}

/** Signal interne : arrêter proprement la boucle `main()` (pas une vraie panne). */
class BatchAbortError extends Error {
  constructor(
    public readonly slugFailed: string,
    message: string,
  ) {
    super(message);
  }
}

// ── args ─────────────────────────────────────────────────────────────────────

interface Args {
  slugs: string[];
  maxSeconds: number;
  simplifyZonesM: number;
  /** Materialisation de normes : laisse la garde de compteurs décider du rollback. */
  allowGeometrySuspect: boolean;
  /**
   * Lève le SEUL gate absolue-perte : dépose-avec-perte-documentée (codes-droppés
   * -> UNKNOWN-recalage) au lieu de REVOKER. Ne lève AUCUN autre gate.
   */
  allowLoss: boolean;
  /** Évite les audits géométriques hors périmètre quand seuls les compteurs Immo sont requis. */
  metricsOnly: boolean;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let slugsFile: string | null = null;
  let maxSeconds = 2400;
  // La simplification peut déplacer une frontière et faire perdre de vrais
  // lots. Le re-fold de matérialisation doit donc reprendre la géométrie servie
  // à l'identique; l'opt-in explicite reste disponible pour les diagnostics.
  let simplifyZonesM = 0;
  let allowGeometrySuspect = false;
  let allowLoss = false;
  let metricsOnly = false;
  let out = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--slugs") {
      slugs.push(
        ...String(argv[++i] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (a === "--slugs-file") slugsFile = String(argv[++i] ?? "");
    else if (a === "--max-seconds") maxSeconds = Math.max(1, Number(argv[++i] ?? "2400") || 2400);
    else if (a === "--simplify-zones-m") simplifyZonesM = Math.max(0, Number(argv[++i] ?? "1") || 0);
    else if (a === "--allow-geometry-suspect") allowGeometrySuspect = true;
    else if (a === "--allow-loss") allowLoss = true;
    else if (a === "--metrics-only") metricsOnly = true;
    else if (a === "--out") out = String(argv[++i] ?? "");
    else throw new Error(`unknown argument: ${a}`);
  }
  if (slugsFile) {
    for (const line of readFileSync(slugsFile, "utf8").split("\n")) {
      const s = line.trim();
      if (s && !s.startsWith("#")) slugs.push(s);
    }
  }
  const uniqueSlugs = [...new Set(slugs)];
  if (uniqueSlugs.length === 0) throw new Error("pass --slugs a,b,c and/or --slugs-file <path>");
  if (!out) throw new Error("--out <path> required (resume-safe progress journal)");
  return { slugs: uniqueSlugs, maxSeconds, simplifyZonesM, allowGeometrySuspect, allowLoss, metricsOnly, out };
}

// ── journal (resume-safe) ────────────────────────────────────────────────────

interface AuditSnapshot {
  lots: number;
  assigned: number;
  denom: number;
  coherent: number;
  mismatch: number;
  residue_hard: number;
  outside_all: number; // lots EN MISMATCH hors de toute zone servie (⊆ mismatch) — signal géométrie-suspecte
  unassigned: number;
  unknown_eval_unit: number;
  mismatch_pct: number;
  note?: string;
}

/**
 * Compteurs absolus du produit qc-lots réellement servi.  Ils viennent du
 * fichier stats écrit dans la même transaction que le GeoJSON par
 * lots-enriched-run; ils sont donc la mesure contractuelle du KPI Immo, pas un
 * pourcentage dont le dénominateur pourrait se rétrécir.
 */
interface LotMetrics {
  stats_key: string;
  num_lots: number;
  num_with_norms: number;
  num_with_code_zone: number;
  num_with_adresse: number | null;
}

/**
 * Un code présent dans l'ancien servi mais DROPPÉ par la géométrie v2 : ses lots
 * deviennent UNKNOWN-recalage (JAMAIS N-A, JAMAIS unassigned-silencieux). Aucune
 * valeur inventée — `prior_level`/`url` sont null tant que l'audit ne les porte pas
 * (verbatim-ou-null).
 */
interface DroppedCode {
  code: string;
  /** zone_source_level de l'ancien servi — non porté par l'audit -> null. */
  prior_level: string | null;
  /** ancien servi non-prouvé (zone_source_url=null) : recalage requis. */
  url: null;
  status: "UNKNOWN-recalage";
  /** clé S3 du backup horodaté d'où recaler. */
  backup: string;
}

/**
 * Trace du dépôt-avec-perte autorisé par `--allow-loss`. Renseigné UNIQUEMENT quand
 * le flag a levé le gate absolue-perte ; `null` sur tout autre dépôt/skip.
 */
interface AllowLoss {
  applied: true;
  /** motif absolue-perte mesuré (regressionReason). */
  regression: string;
  /** décroissance absolue de num_with_code_zone = volume de lots -> UNKNOWN (autoritaire). */
  lots_to_unknown: number;
  /** décroissance absolue de num_with_norms (perte de normes associée). */
  norms_to_unknown: number;
  /** clé S3 du backup horodaté du produit servi qc-lots. */
  backup: string;
  dropped_codes: DroppedCode[];
  /** d'où vient l'énumération dropped_codes (honnêteté sur ce qui est compté). */
  dropped_codes_basis: string;
}

interface JournalEntry {
  slug: string;
  deposited: boolean;
  skipped_reason: string | null;
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
  backup_ts: string | null;
  mirror: "mirrored" | "flat-only" | null;
  join_summary: string | null;
  enrich_summary: string | null;
  lot_metrics_before: LotMetrics | null;
  /** Mesure du candidat, avant un éventuel rollback. */
  lot_metrics_after: LotMetrics | null;
  /** Surface effectivement servie à la fin (égale à before après rollback). */
  lot_metrics_final: LotMetrics | null;
  complete_before: boolean;
  complete_after: boolean;
  complete_final: boolean;
  /**
   * Dépôt-avec-perte-documentée : non-null UNIQUEMENT quand `--allow-loss` a levé
   * la révocation absolue-perte. Documente les codes-droppés (-> UNKNOWN-recalage).
   */
  allow_loss: AllowLoss | null;
  started_at: string;
  finished_at: string;
}

interface JournalFile {
  generated_at: string;
  simplify_zones_m: number;
  entries: JournalEntry[];
}

function trimReport(r: CityReport): AuditSnapshot {
  return {
    lots: r.lots,
    assigned: r.assigned,
    denom: r.denom,
    coherent: r.coherent,
    mismatch: r.mismatch,
    residue_hard: r.residue_hard,
    outside_all: r.outside_all,
    unassigned: r.unassigned,
    unknown_eval_unit: r.unknown_eval_unit,
    mismatch_pct: r.mismatch_pct,
    ...(r.note ? { note: r.note } : {}),
  };
}

function loadJournal(path: string): Map<string, JournalEntry> {
  const map = new Map<string, JournalEntry>();
  if (!existsSync(path)) return map;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as JournalFile;
    for (const e of raw.entries ?? []) if (e?.slug) map.set(e.slug, e);
  } catch (err) {
    console.error(
      `[refold-batch] WARN: journal existant illisible (${path}), on repart de zéro (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  return map;
}

function saveJournal(path: string, map: Map<string, JournalEntry>, simplifyZonesM: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: JournalFile = {
    generated_at: new Date().toISOString(),
    simplify_zones_m: simplifyZonesM,
    entries: [...map.values()],
  };
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n", "utf8");
}

function isComplete(metrics: LotMetrics | null): boolean {
  // Un zéro porteur est inconnu, jamais "complete" par vacuité.
  return metrics !== null && metrics.num_with_norms > 0 && metrics.num_with_norms === metrics.num_lots;
}

/**
 * geo-api préfère le sous-dossier lorsqu'il existe.  Lire cette stats en
 * priorité garantit que la mesure avant/après vise bien le produit consommé;
 * le runner miroir le rend identique au plat après dépôt.
 */
async function readLotMetrics(s3: S3Client, slug: string): Promise<LotMetrics | null> {
  const keys = [
    `normalized/qc-lots/qc-lots-${slug}/qc-lots-${slug}.stats.json`,
    `normalized/qc-lots/qc-lots-${slug}.stats.json`,
  ];
  for (const key of keys) {
    if (!(await exists(s3, key))) continue;
    const raw = await getJson(s3, key) as Record<string, unknown>;
    const numLots = raw["num_lots"];
    const withNorms = raw["num_with_norms"];
    const withCode = raw["num_with_zone_code"];
    const role = raw["role"];
    const withAdresse = role && typeof role === "object" && !Array.isArray(role)
      ? (role as Record<string, unknown>)["num_with_adresse"]
      : null;
    if (
      typeof numLots !== "number" || !Number.isFinite(numLots) ||
      typeof withNorms !== "number" || !Number.isFinite(withNorms) ||
      typeof withCode !== "number" || !Number.isFinite(withCode)
    ) {
      throw new Error(`${slug}: stats qc-lots invalides (${key})`);
    }
    return {
      stats_key: key,
      num_lots: numLots,
      num_with_norms: withNorms,
      num_with_code_zone: withCode,
      num_with_adresse: typeof withAdresse === "number" && Number.isFinite(withAdresse) ? withAdresse : null,
    };
  }
  return null;
}

function regressionReason(before: LotMetrics, after: LotMetrics): string | null {
  const losses: string[] = [];
  if (after.num_with_norms < before.num_with_norms) {
    losses.push(`normes ${before.num_with_norms}->${after.num_with_norms}`);
  }
  if (after.num_with_code_zone < before.num_with_code_zone) {
    losses.push(`code_zone ${before.num_with_code_zone}->${after.num_with_code_zone}`);
  }
  return losses.length ? losses.join(", ") : null;
}

/** `dir/base.ext` -> `dir/_replaced/base.ext.<ts>` (même idiome que `_lot-zone-refold-s3.ts`). */
function backupKeyFor(key: string, ts: string): string {
  const slash = key.lastIndexOf("/");
  return `${key.slice(0, slash)}/_replaced/${key.slice(slash + 1)}.${ts}`;
}

/**
 * Construit la trace `allow_loss` d'un dépôt-avec-perte (flag `--allow-loss`).
 *
 * Anti-invention : AUCUN réseau-fetch neuf, aucune valeur fabriquée. Tout dérive de
 * ce que l'audit et les compteurs absolus ont DÉJÀ mesuré :
 *   - `lots_to_unknown` = décroissance absolue de num_with_code_zone (volume exact
 *     de lots qui perdent leur code -> UNKNOWN-recalage) ; mesure AUTORITAIRE.
 *   - `dropped_codes` = codes assignés dont le centroïde sort de TOUTE zone servie v2
 *     (`outside_all`, `actual` vide) dans l'audit-before. Ce sont précisément les lots
 *     que le re-fold (aire-majorité) laissera sans code : leur code d'origine est
 *     DROPPÉ par la v2. On EXCLUT les `misassigned` (leur code peut encore exister ;
 *     l'inclure fabriquerait un code-droppé). `prior_level`/`url` restent null.
 */
function buildAllowLoss(
  regression: string,
  before: CityReport | null,
  metricsBefore: LotMetrics,
  metricsAfter: LotMetrics,
  slug: string,
  ts: string,
): AllowLoss {
  const backup = backupKeyFor(`normalized/qc-lots/qc-lots-${slug}.geojson`, ts);
  const dropped = new Map<string, DroppedCode>();
  for (const ex of before?.examples ?? []) {
    if (ex.actual.length === 0 && ex.assigned && !dropped.has(ex.assigned)) {
      dropped.set(ex.assigned, {
        code: ex.assigned,
        prior_level: null,
        url: null,
        status: "UNKNOWN-recalage",
        backup,
      });
    }
  }
  return {
    applied: true,
    regression,
    lots_to_unknown: Math.max(0, metricsBefore.num_with_code_zone - metricsAfter.num_with_code_zone),
    norms_to_unknown: Math.max(0, metricsBefore.num_with_norms - metricsAfter.num_with_norms),
    backup,
    dropped_codes: [...dropped.values()],
    dropped_codes_basis: before
      ? `codes assignés outside_all de l'audit-before (échantillon jusqu'à ${LOSS_AUDIT_EXAMPLE_LIMIT} exemples); ` +
        "lots_to_unknown = décroissance absolue num_with_code_zone (volume perdu autoritaire)"
      : "audit-before indisponible (metrics-only): dropped_codes non énumérables; " +
        "lots_to_unknown = décroissance absolue num_with_code_zone (volume perdu autoritaire)",
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Timestamp compact (même idiome que `_lot-zone-refold-s3.ts`). */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "") + "Z";
}

function isTimeoutish(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown; stderr?: unknown; stdout?: unknown };
  const text = [err?.message, err?.stderr, err?.stdout]
    .filter((v) => v !== undefined && v !== null)
    .map(String)
    .join(" \n ");
  return err?.code === "ETIMEDOUT" || /ETIMEDOUT/i.test(text);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Exécute `fn`, retente jusqu'à `maxRetries` fois UNIQUEMENT sur une erreur
 * ETIMEDOUT (GET/PUT réseau). Toute autre erreur (métier, ex. "zones not
 * found") remonte IMMÉDIATEMENT sans retry — un ETIMEDOUT épuisé lève
 * `ExhaustedTimeoutError`, qui déclenche l'abandon propre du batch entier.
 */
async function withRetry<T>(label: string, fn: () => Promise<T> | T, maxRetries = MAX_RETRIES): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!isTimeoutish(e)) throw e;
      attempt++;
      if (attempt > maxRetries) {
        throw new ExhaustedTimeoutError(
          `${label}: ETIMEDOUT persiste après ${maxRetries} retries (${errMsg(e)})`,
        );
      }
      console.error(`[refold-batch] ${label}: ETIMEDOUT, retry ${attempt}/${maxRetries}`);
    }
  }
}

/** Invoque un runner committé via `npx tsx <script> ...args`, SYNCHRONE, jamais détaché. */
function runChildSync(label: string, scriptPath: string, args: string[]): string {
  try {
    return execFileSync("npx", ["tsx", scriptPath, ...args], {
      cwd: ACQ_DIR,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; status?: number | null; signal?: string | null };
    const detail = [err.message, err.stdout, err.stderr].filter(Boolean).join("\n---\n").slice(0, 4000);
    throw new Error(`${label} failed (status=${err.status ?? "?"} signal=${err.signal ?? "?"}): ${detail}`);
  }
}

/**
 * `lot-zone-join-run.ts` / `lots-enriched-run.ts` avalent les erreurs PAR
 * VILLE (catch interne → `SKIP <slug> <reason>` + `continue`) et ne
 * ré-exit(1) QUE dans des cas précis (`--all`/`--served` absent + entrée
 * absente de `summaries`) — un run mono-slug qui échoue à l'intérieur de
 * `runCity` ressort donc avec `DONE ok=0 ...` et EXIT CODE 0. Il faut lire
 * stdout, pas seulement le code de sortie, pour détecter cet échec silencieux.
 */
function checkForSkip(stdout: string, slug: string, label: string): void {
  const skipPrefix = `SKIP ${slug} `;
  const skipLine = stdout.split("\n").find((l) => l.startsWith(skipPrefix));
  if (skipLine) throw new Error(`${label}: ${skipLine.slice(skipPrefix.length)}`);
  if (/^DONE ok=0 /m.test(stdout)) {
    throw new Error(`${label}: DONE ok=0 (aucune ville traitée, pas de ligne SKIP explicite)`);
  }
}

function firstLineStartingWith(stdout: string, prefix: string): string | null {
  const line = stdout.split("\n").find((l) => l.startsWith(prefix));
  return line ? line.trim() : null;
}

// ── pipeline par ville ───────────────────────────────────────────────────────

async function processSlug(
  s3: S3Client,
  slug: string,
  args: Args,
  journalMap: Map<string, JournalEntry>,
): Promise<void> {
  const startedAt = new Date().toISOString();
  let before: CityReport | null = null;
  let metricsBefore: LotMetrics | null = null;
  let metricsAfter: LotMetrics | null = null;
  let ts: string | null = null;

  const finalizeSkip = (reason: string, finalMetrics: LotMetrics | null = metricsBefore): void => {
    const entry: JournalEntry = {
      slug,
      deposited: false,
      skipped_reason: reason,
      before: before ? trimReport(before) : null,
      after: null,
      backup_ts: ts,
      mirror: null,
      join_summary: null,
      enrich_summary: null,
      lot_metrics_before: metricsBefore,
      lot_metrics_after: metricsAfter,
      lot_metrics_final: finalMetrics,
      complete_before: isComplete(metricsBefore),
      complete_after: isComplete(metricsAfter),
      complete_final: isComplete(finalMetrics),
      allow_loss: null,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    journalMap.set(slug, entry);
    saveJournal(args.out, journalMap, args.simplifyZonesM);
    console.log(`SKIP ${slug}: ${reason}`);
  };

  try {
    if (!args.metricsOnly) {
      // Sous --allow-loss, l'audit-before énumère les codes-droppés : on lève le
      // plafond d'exemples pour tous les capturer (sinon échantillon de 3).
      const beforeExampleLimit = args.allowLoss ? LOSS_AUDIT_EXAMPLE_LIMIT : EXAMPLE_LIMIT;
      before = await withRetry(`audit-before ${slug}`, () => auditCity(s3, slug, beforeExampleLimit));
      if (before.note) {
        finalizeSkip(`not-served: ${before.note}`);
        return;
      }
    }
    metricsBefore = await withRetry(`metrics-before ${slug}`, () => readLotMetrics(s3, slug));
    if (!metricsBefore) {
      finalizeSkip("metrics-unavailable: qc-lots stats absent; ne pas écraser sans mesure absolue", null);
      return;
    }

    // Signal géométrie-suspecte : parmi les lots EN MISMATCH (d>10m), quelle
    // fraction a son centroïde hors de TOUTE zone servie (offset de géométrie de
    // zone plutôt qu'erreur d'étiquette). `outside_all ⊆ mismatch` → ratio ≤ 1.
    const mismatchTotal = before?.mismatch ?? 0;
    if (before && !args.allowGeometrySuspect && mismatchTotal > 0 && before.outside_all / mismatchTotal > OUTSIDE_ALL_SKIP_FRACTION) {
      finalizeSkip(
        `geometry-suspect (outside_all=${before.outside_all}/${mismatchTotal} mismatch, ` +
          `mismatch_pct=${before.mismatch_pct}%) — ne dépose pas`,
      );
      return;
    }
    if (before && args.allowGeometrySuspect && mismatchTotal > 0 && before.outside_all / mismatchTotal > OUTSIDE_ALL_SKIP_FRACTION) {
      console.log(
        `[refold-batch] ${slug}: geometry-suspect admis pour matérialisation; ` +
          `la garde des compteurs absolus décidera du rollback`,
      );
    }
    if (before) {
      console.log(
        `[refold-batch] ${slug}: audit-before lots=${before.lots} assigned=${before.assigned} ` +
          `mismatch=${before.mismatch_pct}% (mismatch=${before.mismatch} résidu>50m=${before.residue_hard} outside_all=${before.outside_all} unassigned=${before.unassigned})`,
      );
    }

    ts = stamp();
    runChildSync("backup", S3_HELPER, ["--slug", slug, "--mode", "backup", "--ts", ts]);
    console.log(`[refold-batch] ${slug}: backup ts=${ts} ok`);

    const joinOut = await withRetry(`lot-zone-join ${slug}`, () =>
      runChildSync("lot-zone-join", JOIN_RUN, ["--slug", slug, "--simplify-zones-m", String(args.simplifyZonesM)]),
    );
    checkForSkip(joinOut, slug, "lot-zone-join");
    const joinSummary = firstLineStartingWith(joinOut, `OK ${slug} `);
    console.log(`[refold-batch] ${slug}: lot-zone-join ${joinSummary ?? "ok (pas de ligne OK trouvée)"}`);

    const enrichArgs = args.metricsOnly
      ? ["--slugs", slug, "--no-role", "--no-fsa", "--preserve-existing-optional-attrs"]
      : ["--slugs", slug];
    const enrichOut = await withRetry(`lots-enriched ${slug}`, () =>
      runChildSync("lots-enriched", ENRICH_RUN, enrichArgs),
    );
    checkForSkip(enrichOut, slug, "lots-enriched");
    const enrichSummary = firstLineStartingWith(enrichOut, `OK ${slug} `);
    console.log(`[refold-batch] ${slug}: lots-enriched ${enrichSummary ?? "ok (pas de ligne OK trouvée)"}`);

    const subdirKey = `normalized/qc-lots/qc-lots-${slug}/qc-lots-${slug}.geojson`;
    const hasSubdir = await withRetry(`subdir-check ${slug}`, () => exists(s3, subdirKey));
    let mirror: JournalEntry["mirror"] = "flat-only";
    if (hasSubdir) {
      await withRetry(`mirror ${slug}`, () => runChildSync("mirror", S3_HELPER, ["--slug", slug, "--mode", "mirror"]));
      mirror = "mirrored";
    }
    console.log(`[refold-batch] ${slug}: mirror=${mirror}`);

    const after = args.metricsOnly ? null : await withRetry(`audit-after ${slug}`, () => auditCity(s3, slug, EXAMPLE_LIMIT));
    metricsAfter = await withRetry(`metrics-after ${slug}`, () => readLotMetrics(s3, slug));
    if (!metricsAfter) {
      throw new Error(`${slug}: stats qc-lots absentes après dépôt`);
    }
    if (after) {
      console.log(
        `[refold-batch] ${slug}: audit-after mismatch=${after.mismatch_pct}% ` +
          `(mismatch=${after.mismatch} résidu>50m=${after.residue_hard} outside_all=${after.outside_all} unassigned=${after.unassigned})`,
      );
    }

    const regression = regressionReason(metricsBefore, metricsAfter);
    if (regression && !args.allowLoss) {
      console.error(`[refold-batch] ${slug}: ROLLBACK requis — perte absolue ${regression}`);
      await withRetry(`rollback ${slug}`, () => runChildSync("rollback", S3_HELPER, ["--slug", slug, "--mode", "restore", "--ts", ts!]));
      const restored = await withRetry(`metrics-restored ${slug}`, () => readLotMetrics(s3, slug));
      if (!restored || regressionReason(metricsBefore, restored) || regressionReason(restored, metricsBefore)) {
        throw new Error(
          `${slug}: rollback non vérifié (avant=${JSON.stringify(metricsBefore)} final=${JSON.stringify(restored)})`,
        );
      }
      const entry: JournalEntry = {
        slug,
        deposited: false,
        skipped_reason: `REVOKED: perte absolue ${regression}`,
        before: before ? trimReport(before) : null,
        after: after ? trimReport(after) : null,
        backup_ts: ts,
        mirror,
        join_summary: joinSummary,
        enrich_summary: enrichSummary,
        lot_metrics_before: metricsBefore,
        lot_metrics_after: metricsAfter,
        lot_metrics_final: restored,
        complete_before: isComplete(metricsBefore),
        complete_after: isComplete(metricsAfter),
        complete_final: isComplete(restored),
        allow_loss: null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      };
      journalMap.set(slug, entry);
      saveJournal(args.out, journalMap, args.simplifyZonesM);
      console.log(`REVOKED ${slug}: ${regression}`);
      return;
    }

    // --allow-loss : la perte absolue est ADMISE (codes-droppés -> UNKNOWN-recalage).
    // On NE rollback PAS ; on garde l'état re-foldé et on documente la perte au record.
    const allowLoss = regression
      ? buildAllowLoss(regression, before, metricsBefore, metricsAfter, slug, ts!)
      : null;
    if (allowLoss) {
      console.log(
        `[refold-batch] ${slug}: ALLOW-LOSS dépôt-avec-perte — ${regression} ` +
          `(lots_to_unknown=${allowLoss.lots_to_unknown} dropped_codes=${allowLoss.dropped_codes.length} ` +
          `[${allowLoss.dropped_codes.map((d) => d.code).join(",") || "aucun énuméré"}])`,
      );
    }

    const entry: JournalEntry = {
      slug,
      deposited: true,
      skipped_reason: null,
      before: before ? trimReport(before) : null,
      after: after ? trimReport(after) : null,
      backup_ts: ts,
      mirror,
      join_summary: joinSummary,
      enrich_summary: enrichSummary,
      lot_metrics_before: metricsBefore,
      lot_metrics_after: metricsAfter,
      lot_metrics_final: metricsAfter,
      complete_before: isComplete(metricsBefore),
      complete_after: isComplete(metricsAfter),
      complete_final: isComplete(metricsAfter),
      allow_loss: allowLoss,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    journalMap.set(slug, entry);
    saveJournal(args.out, journalMap, args.simplifyZonesM);
    console.log(
      `OK ${slug}: ` +
        (before && after ? `mismatch ${before.mismatch_pct}% -> ${after.mismatch_pct}% ` : "métriques absolues vérifiées ") +
        (allowLoss ? `(deposited=true, allow-loss lots_to_unknown=${allowLoss.lots_to_unknown}) ` : "(deposited=true)"),
    );
  } catch (e) {
    if (e instanceof ExhaustedTimeoutError) {
      const entry: JournalEntry = {
        slug,
        deposited: false,
        skipped_reason: `ABORT: ${e.message}`,
        before: before ? trimReport(before) : null,
        after: null,
        backup_ts: ts,
        mirror: null,
        join_summary: null,
        enrich_summary: null,
        lot_metrics_before: metricsBefore,
        lot_metrics_after: metricsAfter,
        lot_metrics_final: metricsBefore,
        complete_before: isComplete(metricsBefore),
        complete_after: isComplete(metricsAfter),
        complete_final: isComplete(metricsBefore),
        allow_loss: null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      };
      journalMap.set(slug, entry);
      saveJournal(args.out, journalMap, args.simplifyZonesM);
      throw new BatchAbortError(slug, e.message);
    }
    finalizeSkip(errMsg(e));
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const journalMap = loadJournal(args.out);
  const s3 = s3Client();

  const already = args.slugs.filter((s) => journalMap.get(s)?.deposited === true);
  const pending = args.slugs.filter((s) => journalMap.get(s)?.deposited !== true);
  if (already.length) console.log(`RESUME: ${already.length} déjà deposited=true, sautées: ${already.join(", ")}`);
  console.log(
      `[refold-batch] slugs=${args.slugs.length} pending=${pending.length} ` +
      `max_seconds=${args.maxSeconds} simplify_zones_m=${args.simplifyZonesM} ` +
      `allow_geometry_suspect=${args.allowGeometrySuspect} allow_loss=${args.allowLoss} ` +
      `metrics_only=${args.metricsOnly} out=${args.out}`,
  );

  const doneThisRun: string[] = [];
  const deadline = Date.now() + args.maxSeconds * 1000;
  for (let i = 0; i < pending.length; i++) {
    if (Date.now() >= deadline) {
      const remaining = pending.slice(i);
      console.log(
        `[refold-batch] CHECKPOINT time-box reached after ${doneThisRun.length} muni(s); ` +
        `remaining=${remaining.length} journal=${args.out}`,
      );
      return;
    }
    const slug = pending[i]!;
    try {
      await processSlug(s3, slug, args, journalMap);
      doneThisRun.push(slug);
    } catch (e) {
      if (e instanceof BatchAbortError) {
        const remaining = pending.slice(i + 1);
        console.error(`\n[refold-batch] ABORT sur "${e.slugFailed}": ${e.message}`);
        console.error(`[refold-batch] villes faites ce run: ${doneThisRun.length ? doneThisRun.join(", ") : "(aucune)"}`);
        console.error(`[refold-batch] ville en échec: ${e.slugFailed}`);
        console.error(`[refold-batch] non tentées: ${remaining.length ? remaining.join(", ") : "(aucune)"}`);
        console.error(`[refold-batch] journal: ${args.out}`);
        process.exitCode = 1;
        return;
      }
      throw e;
    }
    if (Date.now() >= deadline && i + 1 < pending.length) {
      const remaining = pending.slice(i + 1);
      console.log(
        `[refold-batch] CHECKPOINT time-box reached after ${doneThisRun.length} muni(s); ` +
        `remaining=${remaining.length} journal=${args.out}`,
      );
      return;
    }
  }

  const finalEntries = args.slugs.map((s) => journalMap.get(s)).filter((e): e is JournalEntry => !!e);
  const deposited = finalEntries.filter((e) => e.deposited).length;
  const skipped = finalEntries.filter((e) => !e.deposited).length;
  console.log(
    `\n[refold-batch] DONE slugs=${args.slugs.length} deposited=${deposited} skipped=${skipped} journal=${args.out}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
