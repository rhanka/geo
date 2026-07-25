/**
 * zonage-reacquire-audit.ts — QUALITÉ des zones SERVIES (READ-ONLY par défaut).
 *
 * « servi » ≠ « bon ». Une ville dont `zones` est `done` peut avoir en S3 un SIG
 * qui est en réalité :
 *   - une couche d'AFFECTATION (catégories grossières AGR/URB/IND/CON… — peu de
 *     codes, alpha-only, non-municipale), OU
 *   - un MILLÉSIME DISJOINT de la grille de normes municipale (numéros de zones
 *     d'un autre règlement → overlap≈0 avec la grille extraite, ex. Mont-Tremblant
 *     SIG CO-939/VA-5xx vs grille RA-106).
 * Ces villes sont À RÉ-ACQUÉRIR (vrai zonage municipal, autre source — comme
 * repentigny/beaupré via `zonage-opendata-deposit.ts` / FeatureServer ville).
 *
 * MÉTHODE (anti-invention, données S3 réelles, ZÉRO LLM) — pour chaque ville
 * `zones=done` qui a AUSSI une grille de normes déposée (`published_field_pct>0`) :
 *   1. overlap manifeste > 0 → OK (joignable) : la grille recoupe déjà le SIG.
 *   2. overlap manifeste == 0 → on RECALCULE l'overlap avec le canon
 *      `canonicalizeZoneCodeForJoin` + le PONT NUMÉRIQUE (millésime) — EXACTEMENT
 *      le gate de dépôt (`overlapWithNumericBridge`, cf. crossval-refresh) :
 *        · overlap recalculé > 0  → OK : c'était un faux-négatif de FORMAT que le
 *          canon/pont rapproche (déjà géré — PAS à ré-acquérir ; la ligne
 *          `needsManifestRefresh` signale que le manifeste est à rafraîchir) ;
 *        · overlap recalculé == 0 → À RÉ-ACQUÉRIR : le SIG est vraiment DISJOINT
 *          de la grille municipale. Sous-classé sur les codes SIG réels :
 *            - `affectation`        : codes SIG peu nombreux ET majoritairement
 *              alpha-only (sans chiffre) = catégories d'affectation ;
 *            - `millesime-disjoint` : codes SIG numériques mais numéros disjoints.
 *   3. pas de grille normes déposée → INDÉTERMINÉ (rien pour trancher).
 *   4. grille présente mais `published_field_pct==0` → INDÉTERMINÉ (grille suspecte,
 *      on ne peut pas incriminer le SIG).
 *
 * SORTIES :
 *   - rapport JSON complet (--report <path>) ;
 *   - CACHE stable `work/coverage/zones-quality.json` (indicateur qualité-aware lu
 *     par `loop-supervise.ts` — pas de S3 dans le tick) ;
 *   - CAPITALISATION TRACK (--apply-track) : un item `zones-reacquire · <slug> — …`
 *     par ville à-ré-acquérir, sous le workpackage `zones-reacquire` (niché sous
 *     « couche: zones »), en reste-à-faire (to-do). Idempotent (skip si déjà là).
 *     Ces titres ne matchent PAS le parseur de `sync-track-from-coverage` (pas de
 *     `couche/voie · slug [status] —`), donc la synchro couverture ne les touche pas.
 *
 * Usage :
 *   npx tsx acquisition/src/zonage-reacquire-audit.ts                    # audit + cache (dry track)
 *   npx tsx acquisition/src/zonage-reacquire-audit.ts --report work/coverage/zones-reacquire.json
 *   npx tsx acquisition/src/zonage-reacquire-audit.ts --apply-track      # capitalise dans le track
 *   npx tsx acquisition/src/zonage-reacquire-audit.ts --brief            # juste la ligne indicateur (recompute)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { s3Client, getBytes } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  readManifest,
  normsKey,
  gridKey,
  ZONAGE_GRIDS_PREFIX,
  sigZoneCodesFromGeojson,
  canonZone,
  overlapWithNumericBridge,
  type Manifest,
  type ManifestEntry,
} from "./lib/zonage-norms.js";
import { FOCUS_30_SLUGS } from "./focus30-status.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MATRIX = join(ROOT, "work", "coverage", "coverage-matrix.json");
const QUALITY_CACHE = join(ROOT, "work", "coverage", "zones-quality.json");
const TRACK_EVENTS_DIR = join(ROOT, "work", "coverage", "track-events");
const WORKSPACE = "ws:5ce6fe34225640473edb8b90faa6935c9a961036c94d4915a4ff9368e947e068";
const REACQUIRE_WP_TITLE = "zones-reacquire — SIG affectation/millésime disjoint (ré-acquérir vrai zonage municipal)";

// Seuils du DISCRIMINATEUR « quel côté est une vraie grille municipale ? » (données
// réelles S3, calibrés sur l'inspection des 37 candidats overlap=0). L'enjeu : ne
// PAS incriminer un SIG PARFAIT (ex. dorval 220 codes U-1-01…) quand c'est la GRILLE
// de normes extraite qui est garbage (lettres seules A..L, vide, mots d'usage
// ISOLÉ/JUMELÉ, types d'enseigne ÀPLAT/SANDWICH). Ces cas-là = ré-EXTRAIRE les
// normes, PAS ré-acquérir le SIG.
const HEALTHY_SIG_MIN = 12; // un SIG « vraie grille municipale » ≥12 codes numériques réels
const HEALTHY_EXT_MIN = 8; // une grille extraite exploitable ≥8 codes réels
const AFFECTATION_MAX_CODES = 12; // affectation = peu de codes (catégories grossières)
const AFFECTATION_MAX_DIGIT_FRAC = 0.5; // < moitié des codes SIG portent un chiffre ⇒ catégories
const SUSPECT_MIN_FIELD_PCT = 3; // grille avec <3% de champs publiés ⇒ extraction quasi vide
const MAX_ALPHA_RUN = 6; // un vrai code n'a pas de plage alpha > 6 (mot épelé ⇒ garbage)
const GRANULARITY_PREFIX_FRAC = 0.4; // ≥40% des codes ext sont préfixes d'un code SIG ⇒ granularité (pas disjoint)

type Klass = "OK" | "REACQUIRE" | "NORMES_SUSPECT" | "INDETERMINATE";
type Sub =
  | "sig-no-codes" // SIG geojson sans champ de code de zone (0–2 codes) → SIG inexploitable
  | "affectation" // SIG = peu de catégories alpha (affectation, non-municipal)
  | "disjoint" // SIG ET grille substantiels mais numérotation disjointe (millésime) — vérifier
  | "grille-garbage" // SIG sain, grille extraite garbage/vide/trop mince → ré-extraire normes
  | "grille-granularite" // SIG plus fin que la grille (T-1.1-003 ⊃ T-1.1) → format, SIG sain
  | "weak-both" // les deux côtés trop faibles/non-numériques pour trancher
  | "grille-suspect" // parquet illisible / champ0
  | "no-grid" // SIG geojson introuvable malgré zones=done
  | "no-norms"; // aucune grille de normes déposée

interface Row {
  slug: string;
  hasNorms: boolean;
  fieldPct: number;
  manifestOverlap: number;
  recomputed: boolean;
  needsManifestRefresh: boolean;
  gridFound: boolean;
  sigCodes: number;
  extractedCodes: number;
  sigNumeric: number; // codes SIG « vrais codes numériques »
  extNumeric: number; // codes grille « vrais codes numériques »
  sigDigitFrac: number; // fraction des codes SIG portant un chiffre
  granularityFrac: number; // fraction des codes ext préfixes d'un code SIG
  overlap: number;
  alphaFrac: number | null;
  sigSample: string[];
  extSample: string[];
  klass: Klass;
  sub: Sub | null;
  inFocus30: boolean;
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * GET an object with RETRY on transient errors (throttling / socket), returning
 * `null` ONLY on a true 404 (NoSuchKey/NotFound). Relying on the shared `exists()`
 * (which swallows EVERY error as "absent") made the audit non-deterministic: a
 * throttled HEAD silently reclassified a muni as INDÉTERMINÉ. This distinguishes
 * "really absent" from "transiently failed" so the indicator is stable run-to-run.
 */
async function getOrNull(s3: S3Client, key: string, attempts = 4): Promise<Buffer | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await getBytes(s3, key);
    } catch (e: unknown) {
      const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
      const code = err?.name ?? err?.Code ?? "";
      const status = err?.$metadata?.httpStatusCode;
      if (code === "NoSuchKey" || code === "NotFound" || status === 404) return null;
      if (i === attempts - 1) throw e;
      await sleep(150 * (i + 1));
    }
  }
  return null;
}

/** Distinct raw zone codes from a slug's already-fetched parquet buffer. */
function zoneCodesFromParquet(buf: Buffer): Promise<string[]> {
  return readParquetRowsFromBuffer(buf).then((rows) => {
    const codes = new Set<string>();
    for (const r of rows) {
      const zc = (r as Record<string, unknown>)["zone_code"];
      if (zc != null && String(zc).trim()) codes.add(String(zc));
    }
    return [...codes];
  });
}

/** Fetch the SIG grille geojson (both corpus layouts) with retry; null iff truly absent. */
async function fetchGridGeojson(s3: S3Client, slug: string): Promise<string | null> {
  const flat = gridKey(slug);
  const sub = `${ZONAGE_GRIDS_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  for (const k of [flat, sub]) {
    const buf = await getOrNull(s3, k);
    if (buf) return buf.toString("utf8");
  }
  return null;
}

/** Longest run of consecutive letters (accents incl.) in a code. */
function longestAlphaRun(code: string): number {
  const runs = code.match(/[A-Za-zÀ-ÿ]+/g);
  let max = 0;
  for (const r of runs ?? []) if (r.length > max) max = r.length;
  return max;
}

/**
 * Is a canonical code a plausible REAL zone code (vs garbage / usage word / bare
 * index)? Requires a digit, length 2..16, and no spelled-out word (alpha run
 * ≤ MAX_ALPHA_RUN). Rejects: "" , "A".."L" (no digit), "ISOLÉ"/"SANDWICH" (no
 * digit), "BIFAMILIALEH-2" (12-letter run), "1".."8" (len<2 bare index). Accepts:
 * "H-1", "RA-106", "ZONEHA-100" (ZONEHA is a 6-letter wart), "8060A21".
 */
function isRealCode(code: string): boolean {
  if (code.length < 2 || code.length > 16) return false;
  if (!/\d/.test(code)) return false;
  return longestAlphaRun(code) <= MAX_ALPHA_RUN;
}

function countReal(codes: Iterable<string>): number {
  let n = 0;
  for (const c of codes) if (isRealCode(c)) n++;
  return n;
}

function digitFraction(codes: Iterable<string>): number {
  let total = 0;
  let d = 0;
  for (const c of codes) {
    total++;
    if (/\d/.test(c)) d++;
  }
  return total ? d / total : 0;
}

/** Fraction of SIG canonical codes that carry NO digit run (affectation categories). */
function alphaOnlyFraction(codes: Iterable<string>): number {
  return 1 - digitFraction(codes);
}

/**
 * Fraction of REAL extracted codes that are a strict PREFIX FAMILY of some SIG code
 * (ext "T-1.1" ⊂ sig "T-1.1-003", separated by `-`/`.`) — the signature of a SIG
 * that is simply MORE GRANULAR than the by-law grille (same zoning, finer polygons),
 * NOT a disjoint SIG. Guards against calling a granularity mismatch a "reacquire".
 */
function granularityPrefixFraction(ext: Set<string>, sig: Set<string>): number {
  const extReal = [...ext].filter(isRealCode);
  if (extReal.length === 0) return 0;
  const sigArr = [...sig];
  let hit = 0;
  for (const e of extReal) {
    if (sigArr.some((s) => s.length > e.length && s.startsWith(e) && /[-.]/.test(s[e.length]!))) hit++;
  }
  return hit / extReal.length;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

interface Matrix {
  cities: Record<string, Record<string, { status?: string }>>;
}

async function classify(
  s3: S3Client,
  slug: string,
  entry: ManifestEntry | undefined,
  inFocus30: boolean,
): Promise<Row> {
  const base: Row = {
    slug,
    hasNorms: !!entry,
    fieldPct: entry?.published_field_pct ?? 0,
    manifestOverlap: entry?.crossval?.overlap ?? 0,
    recomputed: false,
    needsManifestRefresh: false,
    gridFound: entry?.crossval?.gridFound ?? false,
    sigCodes: entry?.crossval?.sigZoneCodes ?? 0,
    extractedCodes: entry?.unique_zone_codes ?? 0,
    sigNumeric: 0,
    extNumeric: 0,
    sigDigitFrac: 0,
    granularityFrac: 0,
    overlap: entry?.crossval?.overlap ?? 0,
    alphaFrac: null,
    sigSample: [],
    extSample: [],
    klass: "INDETERMINATE",
    sub: null,
    inFocus30,
  };

  // No deposited norms grille → cannot judge the SIG.
  if (!entry) {
    base.sub = "no-norms";
    return base;
  }
  // Grille with zero published norm fields → suspect grille, cannot incriminate SIG.
  if ((entry.published_field_pct ?? 0) === 0) {
    base.sub = "grille-suspect";
    return base;
  }
  // Manifest already records a positive overlap → the grille joins the SIG → OK.
  if ((entry.crossval?.overlap ?? 0) > 0) {
    base.klass = "OK";
    return base;
  }

  // Manifest overlap == 0 → RECOMPUTE with canon + numeric bridge (authoritative).
  base.recomputed = true;
  const parquet = await getOrNull(s3, normsKey(slug));
  if (!parquet) {
    // Parquet truly absent (manifest lag) → cannot recompute; INDETERMINATE.
    base.sub = "grille-suspect";
    return base;
  }
  const extractedSet = new Set((await zoneCodesFromParquet(parquet)).map(canonZone));
  const geojson = await fetchGridGeojson(s3, slug);
  if (geojson === null) {
    base.gridFound = false;
    base.sub = "no-grid"; // zones=done but SIG geojson not found → cannot crossval
    return base;
  }
  base.gridFound = true;
  const sigSet = sigZoneCodesFromGeojson(geojson);
  const { overlap } = overlapWithNumericBridge(extractedSet, sigSet);
  base.sigCodes = sigSet.size;
  base.extractedCodes = extractedSet.size;
  base.overlap = overlap;
  base.alphaFrac = alphaOnlyFraction(sigSet);
  base.sigNumeric = countReal(sigSet);
  base.extNumeric = countReal(extractedSet);
  base.sigDigitFrac = digitFraction(sigSet);
  base.granularityFrac = granularityPrefixFraction(extractedSet, sigSet);
  base.sigSample = [...sigSet].slice(0, 12);
  base.extSample = [...extractedSet].slice(0, 12);

  if (overlap > 0) {
    // Format false-negative that the bridge fixes → OK (NOT to re-acquire).
    base.klass = "OK";
    base.needsManifestRefresh = true;
    return base;
  }

  // overlap == 0 with a real grille → decide WHICH SIDE is the real municipal grille.
  const sigHealthy = base.sigNumeric >= HEALTHY_SIG_MIN;
  const extHealthy = base.extNumeric >= HEALTHY_EXT_MIN && (entry.published_field_pct ?? 0) >= SUSPECT_MIN_FIELD_PCT;

  // ── SIG is the problem → À RÉ-ACQUÉRIR ───────────────────────────────────────
  if (sigSet.size === 0) {
    // SIG geojson exposes NO zone code in any whitelisted field → unusable SIG.
    base.klass = "REACQUIRE";
    base.sub = "sig-no-codes";
    return base;
  }
  if (sigSet.size <= 2) {
    // SIG carries 1–2 codes only: few alpha categories ⇒ affectation, else a
    // degenerate SIG with essentially no usable grille ⇒ sig-no-codes.
    base.klass = "REACQUIRE";
    base.sub = base.sigDigitFrac < AFFECTATION_MAX_DIGIT_FRAC ? "affectation" : "sig-no-codes";
    return base;
  }
  if (sigSet.size <= AFFECTATION_MAX_CODES && base.sigDigitFrac < AFFECTATION_MAX_DIGIT_FRAC) {
    // Few, mostly alpha-only codes → affectation categories (not municipal zoning).
    base.klass = "REACQUIRE";
    base.sub = "affectation";
    return base;
  }
  if (sigHealthy && extHealthy && base.granularityFrac < GRANULARITY_PREFIX_FRAC) {
    // BOTH sides are substantial grilles that do not join → genuinely disjoint
    // numbering / by-law vintage (mont-tremblant CO-9xx vs RA-106). Candidate —
    // human review recommended before re-acquiring.
    base.klass = "REACQUIRE";
    base.sub = "disjoint";
    return base;
  }

  // ── SIG is fine → the NORMES GRILLE is the problem (NOT a zones-reacquire) ────
  if (sigHealthy) {
    base.klass = "NORMES_SUSPECT";
    base.sub = base.granularityFrac >= GRANULARITY_PREFIX_FRAC ? "grille-granularite" : "grille-garbage";
    return base;
  }

  // ── Neither side is a confident municipal grille → cannot decide ─────────────
  base.klass = "INDETERMINATE";
  base.sub = "weak-both";
  return base;
}

// ── Track capitalisation ────────────────────────────────────────────────────

interface TrackItem { id: string; title: string; kind?: string }

/**
 * Existing items read from the authoritative `.track/events.jsonl` — NOT from
 * `track item ls`, which returns ONLY leaf chores (no workpackage/feature nodes),
 * so a WP idempotency check against it would always miss and DUPLICATE the WP on
 * re-apply. The events log carries every `item.created` of every kind (mirrors
 * coverage-to-track.readLeafIdsByTitle). First-created title per id (titles unique).
 */
function readCreatedItems(cwd: string): TrackItem[] {
  const path = join(cwd, ".track", "events.jsonl");
  if (!existsSync(path)) return [];
  const out: TrackItem[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const e = JSON.parse(line) as {
      type?: string;
      aggregateId?: string;
      payload?: { kind?: string; title?: string };
    };
    if (e.type !== "item.created" || !e.aggregateId || !e.payload?.title) continue;
    if (seen.has(e.aggregateId)) continue;
    seen.add(e.aggregateId);
    out.push({ id: e.aggregateId, title: e.payload.title, kind: e.payload.kind });
  }
  return out;
}

function trackIngest(trackBin: string, file: string, cwd: string): string[] {
  const out = execFileSync(trackBin, ["ingest", file, "--workspace", WORKSPACE], {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("no-op"));
}

function childTitle(r: Row): string {
  const sub =
    r.sub === "affectation"
      ? "affectation"
      : r.sub === "sig-no-codes"
        ? "sans codes de zone"
        : "millésime disjoint";
  return `zones-reacquire · ${r.slug} — SIG ${sub} (sig=${r.sigCodes} ext=${r.extractedCodes} overlap=0) → ré-acquérir vrai zonage municipal`;
}

interface TrackPlan {
  wpExists: boolean;
  createWp: boolean;
  toCreate: Row[]; // reacquire rows missing a track item
  alreadyPresent: string[];
}

function planTrack(items: TrackItem[], reacquire: Row[]): TrackPlan {
  const wp = items.find((it) => it.title === REACQUIRE_WP_TITLE);
  const existingChildBySlug = new Set(
    items
      .map((it) => it.title.match(/^zones-reacquire · ([^ ]+) —/)?.[1])
      .filter((s): s is string => !!s),
  );
  const toCreate: Row[] = [];
  const alreadyPresent: string[] = [];
  for (const r of reacquire) {
    if (existingChildBySlug.has(r.slug)) alreadyPresent.push(r.slug);
    else toCreate.push(r);
  }
  return { wpExists: !!wp, createWp: !wp, toCreate, alreadyPresent };
}

function applyTrack(trackBin: string, cwd: string, items: TrackItem[], reacquire: Row[], plan: TrackPlan): void {
  mkdirSync(TRACK_EVENTS_DIR, { recursive: true });
  // Phase 1 — ensure the parent workpackage (nested under « couche: zones »).
  let wpId = items.find((it) => it.title === REACQUIRE_WP_TITLE)?.id;
  if (!wpId) {
    const zonesWp = items.find((it) => it.title === "couche: zones");
    const wpFile = join(TRACK_EVENTS_DIR, "reacquire-wp.jsonl");
    writeFileSync(
      wpFile,
      JSON.stringify({
        v: 1,
        kind: "item.create",
        payload: {
          kind: "feature",
          title: REACQUIRE_WP_TITLE,
          workspace: WORKSPACE,
          role: "workpackage",
          ...(zonesWp ? { parentId: zonesWp.id } : {}),
        },
      }) + "\n",
      "utf8",
    );
    const ids = trackIngest(trackBin, wpFile, cwd);
    wpId = ids[0];
    // eslint-disable-next-line no-console
    console.error(`[track] créé workpackage zones-reacquire id=${wpId}${zonesWp ? " (sous couche: zones)" : ""}`);
  }
  if (!wpId) throw new Error("workpackage zones-reacquire introuvable après ingest");

  // Phase 2 — children (chore, to-do) for each missing reacquire slug.
  if (plan.toCreate.length === 0) {
    // eslint-disable-next-line no-console
    console.error("[track] aucun nouvel item à créer (tous déjà présents).");
    return;
  }
  const childFile = join(TRACK_EVENTS_DIR, "reacquire-children.jsonl");
  const events = plan.toCreate.map((r) => ({
    v: 1,
    kind: "item.create",
    payload: { kind: "chore", title: childTitle(r), workspace: WORKSPACE, parentId: wpId },
  }));
  writeFileSync(childFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  const ids = trackIngest(trackBin, childFile, cwd);
  // eslint-disable-next-line no-console
  console.error(`[track] créé ${ids.length} item(s) zones-reacquire (reste-à-faire, to-do).`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const brief = argv.includes("--brief");
  const applyTrackFlag = argv.includes("--apply-track");
  const reportPath = arg(argv, "report");
  const trackBin = arg(argv, "track-bin") ?? "track";
  const conc = Number(arg(argv, "concurrency") ?? "10");

  const s3 = s3Client();
  const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as Matrix;
  const zonesDone = Object.keys(matrix.cities)
    .filter((slug) => matrix.cities[slug]?.["zones"]?.status === "done")
    .sort();

  const man: Manifest = await readManifest(s3);
  const bySlug = new Map<string, ManifestEntry>(man.entries.map((e) => [e.slug, e]));
  const focus30 = new Set(FOCUS_30_SLUGS);

  // Fast bucketing without S3: OK-by-manifest / no-norms / needs-recompute (overlap0).
  const needRecompute = zonesDone.filter((s) => {
    const e = bySlug.get(s);
    return e && (e.published_field_pct ?? 0) > 0 && (e.crossval?.overlap ?? 0) === 0;
  });
  console.error(
    `[audit] zones=done ${zonesDone.length} — avec grille normes ${zonesDone.filter((s) => bySlug.has(s)).length} — ` +
      `à recalculer (overlap0) ${needRecompute.length}`,
  );

  const rows: Row[] = [];
  // Rows that need no S3 recompute (OK-by-manifest, no-norms, field0).
  for (const slug of zonesDone) {
    const e = bySlug.get(slug);
    const needs = !!e && (e.published_field_pct ?? 0) > 0 && (e.crossval?.overlap ?? 0) === 0;
    if (needs) continue;
    rows.push(await classify(s3, slug, e, focus30.has(slug)));
  }
  // Rows that need the authoritative recompute (bounded S3 fan-out).
  const recomputed = await pool(needRecompute, conc, (slug) =>
    classify(s3, slug, bySlug.get(slug), focus30.has(slug)),
  );
  rows.push(...recomputed);
  rows.sort((a, b) => a.slug.localeCompare(b.slug));

  const ok = rows.filter((r) => r.klass === "OK");
  const reacquire = rows.filter((r) => r.klass === "REACQUIRE");
  const normesSuspect = rows.filter((r) => r.klass === "NORMES_SUSPECT");
  const indet = rows.filter((r) => r.klass === "INDETERMINATE");
  const affect = reacquire.filter((r) => r.sub === "affectation");
  const noCodes = reacquire.filter((r) => r.sub === "sig-no-codes");
  const disjoint = reacquire.filter((r) => r.sub === "disjoint");
  const needsRefresh = ok.filter((r) => r.needsManifestRefresh);

  const f = (rs: Row[]): Row[] => rs.filter((r) => r.inFocus30);
  const focusServed = zonesDone.filter((s) => focus30.has(s));

  const summary = {
    generatedAt: new Date().toISOString(),
    zonesDone: zonesDone.length,
    withNormsGrille: rows.filter((r) => r.hasNorms).length,
    ok: ok.length,
    reacquire: reacquire.length,
    reacquireAffectation: affect.length,
    reacquireSigNoCodes: noCodes.length,
    reacquireDisjoint: disjoint.length,
    normesSuspect: normesSuspect.length,
    indeterminate: indet.length,
    needsManifestRefresh: needsRefresh.length,
    focus30: {
      zonesServed: focusServed.length,
      ok: f(ok).length,
      reacquire: f(reacquire).length,
      normesSuspect: f(normesSuspect).length,
      indeterminate: f(indet).length,
      reacquireSlugs: f(reacquire).map((r) => r.slug),
      normesSuspectSlugs: f(normesSuspect).map((r) => r.slug),
    },
    reacquireSlugs: reacquire.map((r) => r.slug),
    reacquireAffectationSlugs: affect.map((r) => r.slug),
    reacquireSigNoCodesSlugs: noCodes.map((r) => r.slug),
    reacquireDisjointSlugs: disjoint.map((r) => r.slug),
    normesSuspectSlugs: normesSuspect.map((r) => r.slug),
    needsManifestRefreshSlugs: needsRefresh.map((r) => r.slug),
  };

  // Human indicator line(s).
  const line =
    `ZONAGE QUALITÉ : ${summary.zonesDone} servis — ` +
    `OK-joignable=${summary.ok} | à-ré-acquérir(SIG)=${summary.reacquire} ` +
    `(affectation ${summary.reacquireAffectation} / sans-codes ${summary.reacquireSigNoCodes} / disjoint ${summary.reacquireDisjoint}) | ` +
    `normes-à-ré-extraire(SIG-ok)=${summary.normesSuspect} | ` +
    `indéterminé=${summary.indeterminate} (sans grille pour trancher)` +
    (summary.needsManifestRefresh ? ` | +${summary.needsManifestRefresh} manifeste-à-rafraîchir` : "");
  const focusLine =
    `  focus-30 : ${summary.focus30.zonesServed} servis — ` +
    `OK=${summary.focus30.ok} | à-réacq=${summary.focus30.reacquire} | normes-suspect=${summary.focus30.normesSuspect} | indét=${summary.focus30.indeterminate}` +
    (summary.focus30.reacquireSlugs.length ? ` [réacq: ${summary.focus30.reacquireSlugs.join(", ")}]` : "");

  if (brief) {
    console.log(line);
    console.log(focusLine);
    return;
  }

  // Always refresh the stable cache read by loop-supervise (indicator qualité-aware).
  writeFileSync(QUALITY_CACHE, JSON.stringify(summary, null, 2));

  // Priorities: focus-30 first, then most zone codes (proxy for big city / much data).
  const priorities = [...reacquire]
    .sort(
      (a, b) =>
        Number(b.inFocus30) - Number(a.inFocus30) ||
        Math.max(b.sigCodes, b.extractedCodes) - Math.max(a.sigCodes, a.extractedCodes),
    )
    .slice(0, 12);

  const detail = (r: Row) => ({
    slug: r.slug,
    inFocus30: r.inFocus30,
    klass: r.klass,
    sub: r.sub,
    sigCodes: r.sigCodes,
    extractedCodes: r.extractedCodes,
    sigNumeric: r.sigNumeric,
    extNumeric: r.extNumeric,
    sigDigitFrac: Math.round(r.sigDigitFrac * 1000) / 1000,
    granularityFrac: Math.round(r.granularityFrac * 1000) / 1000,
    fieldPct: r.fieldPct,
    sigSample: r.sigSample,
    extSample: r.extSample,
  });
  const report = {
    ...summary,
    thresholds: {
      HEALTHY_SIG_MIN,
      HEALTHY_EXT_MIN,
      AFFECTATION_MAX_CODES,
      AFFECTATION_MAX_DIGIT_FRAC,
      SUSPECT_MIN_FIELD_PCT,
      MAX_ALPHA_RUN,
      GRANULARITY_PREFIX_FRAC,
    },
    priorities: priorities.map(detail),
    reacquireDetail: reacquire.map(detail),
    normesSuspectDetail: normesSuspect.map(detail),
  };
  if (reportPath) {
    const p = resolve(ROOT, reportPath);
    writeFileSync(p, JSON.stringify(report, null, 2));
    console.error(`[audit] rapport → ${p}`);
  }

  // Track capitalisation.
  if (reacquire.length > 0) {
    const items = readCreatedItems(ROOT);
    const plan = planTrack(items, reacquire);
    console.error(
      `[track] workpackage zones-reacquire ${plan.wpExists ? "existe" : "à créer"} ; ` +
        `${plan.toCreate.length} item(s) à créer, ${plan.alreadyPresent.length} déjà présent(s).`,
    );
    if (applyTrackFlag) applyTrack(trackBin, ROOT, items, reacquire, plan);
    else console.error("[track] DRY — passer --apply-track pour capitaliser dans le track.");
  }

  console.log(line);
  console.log(focusLine);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
