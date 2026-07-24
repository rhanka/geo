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
 * (> 50% de misassigned+outside_all), la géométrie de zone elle-même est
 * suspecte (pas seulement le label) — la ville est SAUTÉE sans dépôt
 * (`skipped_reason: "geometry-suspect"`), plutôt que de re-déposer un fold
 * qui resterait faux.
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
 *     --simplify-zones-m 1 \
 *     --out work/coverage/_refold-batch-progress.json
 *
 *   # ou depuis une liste (une ligne par slug, '#' = commentaire) :
 *   npx tsx acquisition/src/_lot-zone-refold-batch.ts \
 *     --slugs-file work/coverage/_refold-batch-slugs.txt \
 *     --out work/coverage/_refold-batch-progress.json
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { auditCity, type CityReport } from "./lot-zone-consistency-audit.js";
import { exists, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ_DIR = join(HERE, ".."); // acquisition/ — cwd pour npx tsx (résout node_modules/.bin/tsx local)
const JOIN_RUN = join(HERE, "lot-zone-join-run.ts");
const ENRICH_RUN = join(HERE, "lots-enriched-run.ts");
const S3_HELPER = join(HERE, "_lot-zone-refold-s3.ts");

const MAX_RETRIES = 2;
const OUTSIDE_ALL_SKIP_FRACTION = 0.5;
const EXAMPLE_LIMIT = 3;

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
  simplifyZonesM: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let slugsFile: string | null = null;
  let simplifyZonesM = 1;
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
    else if (a === "--simplify-zones-m") simplifyZonesM = Math.max(0, Number(argv[++i] ?? "1") || 0);
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
  return { slugs: uniqueSlugs, simplifyZonesM, out };
}

// ── journal (resume-safe) ────────────────────────────────────────────────────

interface AuditSnapshot {
  lots: number;
  assigned: number;
  matched: number;
  misassigned: number;
  outside_all: number;
  unassigned: number;
  mismatch_pct: number;
  note?: string;
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
    matched: r.matched,
    misassigned: r.misassigned,
    outside_all: r.outside_all,
    unassigned: r.unassigned,
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

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      const backoffMs = 1500 * attempt;
      console.error(`[refold-batch] ${label}: ETIMEDOUT, retry ${attempt}/${maxRetries} dans ${backoffMs}ms`);
      await sleep(backoffMs);
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
  let ts: string | null = null;

  const finalizeSkip = (reason: string): void => {
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
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    journalMap.set(slug, entry);
    saveJournal(args.out, journalMap, args.simplifyZonesM);
    console.log(`SKIP ${slug}: ${reason}`);
  };

  try {
    before = await withRetry(`audit-before ${slug}`, () => auditCity(s3, slug, EXAMPLE_LIMIT));
    if (before.note) {
      finalizeSkip(`not-served: ${before.note}`);
      return;
    }

    const mismatchTotal = before.misassigned + before.outside_all;
    if (mismatchTotal > 0 && before.outside_all / mismatchTotal > OUTSIDE_ALL_SKIP_FRACTION) {
      finalizeSkip(
        `geometry-suspect (outside_all=${before.outside_all}/${mismatchTotal} mismatch, ` +
          `mismatch_pct=${before.mismatch_pct}%) — ne dépose pas`,
      );
      return;
    }
    console.log(
      `[refold-batch] ${slug}: audit-before lots=${before.lots} assigned=${before.assigned} ` +
        `mismatch=${before.mismatch_pct}% (misassigned=${before.misassigned} outside_all=${before.outside_all} unassigned=${before.unassigned})`,
    );

    ts = stamp();
    runChildSync("backup", S3_HELPER, ["--slug", slug, "--mode", "backup", "--ts", ts]);
    console.log(`[refold-batch] ${slug}: backup ts=${ts} ok`);

    const joinOut = await withRetry(`lot-zone-join ${slug}`, () =>
      runChildSync("lot-zone-join", JOIN_RUN, ["--slug", slug, "--simplify-zones-m", String(args.simplifyZonesM)]),
    );
    checkForSkip(joinOut, slug, "lot-zone-join");
    const joinSummary = firstLineStartingWith(joinOut, `OK ${slug} `);
    console.log(`[refold-batch] ${slug}: lot-zone-join ${joinSummary ?? "ok (pas de ligne OK trouvée)"}`);

    const enrichOut = await withRetry(`lots-enriched ${slug}`, () =>
      runChildSync("lots-enriched", ENRICH_RUN, ["--slugs", slug]),
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

    const after = await withRetry(`audit-after ${slug}`, () => auditCity(s3, slug, EXAMPLE_LIMIT));
    console.log(
      `[refold-batch] ${slug}: audit-after mismatch=${after.mismatch_pct}% ` +
        `(misassigned=${after.misassigned} outside_all=${after.outside_all} unassigned=${after.unassigned})`,
    );

    const entry: JournalEntry = {
      slug,
      deposited: true,
      skipped_reason: null,
      before: trimReport(before),
      after: trimReport(after),
      backup_ts: ts,
      mirror,
      join_summary: joinSummary,
      enrich_summary: enrichSummary,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    journalMap.set(slug, entry);
    saveJournal(args.out, journalMap, args.simplifyZonesM);
    console.log(`OK ${slug}: mismatch ${before.mismatch_pct}% -> ${after.mismatch_pct}% (deposited=true)`);
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
      `simplify_zones_m=${args.simplifyZonesM} out=${args.out}`,
  );

  const doneThisRun: string[] = [];
  for (let i = 0; i < pending.length; i++) {
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
