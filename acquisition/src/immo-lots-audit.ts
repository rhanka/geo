/**
 * immo-lots-audit.ts — DIMENSION TRACKÉE « IMMO LOTS » (READ-ONLY par défaut).
 *
 * Les produits servis `normalized/qc-lots/qc-lots-<slug>.geojson` portent des champs
 * d'ENRICHISSEMENT IMMO (déposés par `lots-enriched-run.ts`) qui n'ont AUCUNE place
 * dans la couverture cadastre/zones/normes/pv/tod/pmtiles :
 *   - surface_m2  : aire polygone reprojetée (mesurée, jamais devinée)
 *   - adresse     : adresse civique (jointure rôle foncier MAMH par n° de lot)
 *   - code_postal : RTA/FSA (géocodage inverse du centroïde, StatCan 2021)
 *   - folded-normes : normes de zonage foldées (hauteur_max_value, densite_value…)
 *   - in_tod      : jointure TOD (PMAD CMM/CMQ) — champ SCOPÉ (N/A hors Grand Montréal / région de Québec)
 *
 * Ce script les TRACKE comme une dimension à part entière, SANS toucher à la
 * coverage-matrix (qui ne modélise que cadastre/zones/normes/pv/tod/pmtiles).
 *
 * MÉTHODE (anti-invention, chiffres RÉELS S3, ZÉRO LLM) — pour chaque muni qui a un
 * qc-lots servi, on lit son sidecar `qc-lots-<slug>.stats.json` (déposé par
 * lots-enriched-run) et on agrège la couverture par champ :
 *   - couverture agrégée = lot-pondérée : Σ num_with_<champ> / Σ num_lots
 *     (sur les munis servis avec stats ; in_tod pondéré sur les munis à produit TOD) ;
 *   - couverture par muni = num_with_<champ>/num_lots (stockée dans le cache) ;
 *   - N munis servis en qc-lots / municipalityCount (1106).
 *
 * SORTIES :
 *   - CACHE stable `work/coverage/immo-lots.json` (indicateur lu par loop-supervise —
 *     PAS de S3 dans le tick) ;
 *   - rapport JSON complet (--report <path>), avec le détail par muni ;
 *   - CAPITALISATION TRACK (--apply-track) : un workpackage racine
 *     `immo-lots-enrichment` avec UN item chore par champ (couverture = avancement) ;
 *     la réalisation de chaque item reflète sa couverture (≥95% → done, >0 →
 *     in-progress, 0 → to-do ; in_tod = scopé → in-progress). Idempotent : items
 *     matchés par leur CLÉ de champ stable (le % courant vit dans le cache/report et
 *     dans la réalisation, jamais figé dans le titre). Ces titres ne matchent PAS le
 *     parseur de `sync-track-from-coverage` (pas de `couche/voie · slug [status] —`),
 *     donc la synchro couverture ne les touche pas.
 *
 * Usage :
 *   npx tsx acquisition/src/immo-lots-audit.ts                 # audit + cache (dry track)
 *   npx tsx acquisition/src/immo-lots-audit.ts --report work/coverage/immo-lots.report.json
 *   npx tsx acquisition/src/immo-lots-audit.ts --apply-track   # capitalise le WP dans le track
 *   npx tsx acquisition/src/immo-lots-audit.ts --brief         # juste la ligne indicateur
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { getJson, listSlugs, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MATRIX = join(ROOT, "work", "coverage", "coverage-matrix.json");
const CACHE = join(ROOT, "work", "coverage", "immo-lots.json");
const TRACK_EVENTS_DIR = join(ROOT, "work", "coverage", "track-events");
const OUT_PREFIX = "normalized/qc-lots/";
const WORKSPACE = "ws:5ce6fe34225640473edb8b90faa6935c9a961036c94d4915a4ff9368e947e068";
const IMMO_WP_TITLE = "immo-lots-enrichment";

/** Seuils de réalisation « couverture = avancement » (données réelles S3). */
const DONE_PCT = 95; // champ lot-pondéré ≥95% ⇒ done
// (>0 ⇒ in-progress ; 0 ⇒ to-do)

// ── Champs IMMO trackés ───────────────────────────────────────────────────────
type Scope = "all" | "tod";
interface FieldDef {
  key: string; // clé STABLE (idempotence track + colonnes cache)
  label: string; // libellé humain (titre item track)
  scope: Scope; // "all" = tous les lots servis ; "tod" = munis à produit TOD (CMM/CMQ)
  numOf: (s: LotsStats) => number; // # lots portant le champ (réel, jamais deviné)
}

const FIELDS: readonly FieldDef[] = [
  { key: "surface_m2", label: "superficie polygone (m²)", scope: "all", numOf: (s) => s.num_with_surface ?? 0 },
  { key: "adresse", label: "adresse civique (rôle foncier MAMH)", scope: "all", numOf: (s) => s.role?.num_with_adresse ?? 0 },
  {
    key: "code_postal",
    label: "RTA/FSA (géocodage inverse centroïde)",
    scope: "all",
    numOf: (s) => s.code_postal?.num_with_code_postal ?? 0,
  },
  { key: "folded-normes", label: "normes zonage foldées (hauteur_max…)", scope: "all", numOf: (s) => s.num_with_norms ?? 0 },
  { key: "in_tod", label: "jointure TOD (PMAD CMM/CMQ) — scopé", scope: "tod", numOf: (s) => s.num_joined_tod ?? 0 },
];

// ── Forme (partielle, défensive) des sidecars stats déposés par lots-enriched-run ──
interface LotsStats {
  slug: string;
  num_lots?: number;
  num_with_zone_code?: number;
  num_with_norms?: number;
  num_with_surface?: number;
  num_joined_tod?: number;
  num_in_tod?: number;
  tod_present?: boolean;
  code_postal?: { num_with_code_postal?: number; pct_with_code_postal?: number } | null;
  role?: { num_with_adresse?: number; pct_with_adresse?: number; code_geo?: string | null } | null;
}

interface MuniRow {
  slug: string;
  numLots: number;
  todPresent: boolean;
  numInTod: number;
  /** couverture par champ (%) pour ce muni. */
  fieldPct: Record<string, number>;
  fieldNum: Record<string, number>;
}

interface FieldAgg {
  key: string;
  label: string;
  scope: Scope;
  numWith: number; // Σ lots portant le champ
  denom: number; // Σ lots dans le périmètre du champ (all = tous ; tod = munis TOD)
  pct: number; // couverture lot-pondérée
  munisFull: number; // # munis à ≥90% pour ce champ
  munisAny: number; // # munis à >0% pour ce champ
  realization: "to-do" | "in-progress" | "done";
}

interface Summary {
  generatedAt: string;
  totalMunis: number; // municipalityCount matrice (1106)
  servedMunis: number; // # qc-lots geojson servis
  statsMunis: number; // # sidecars stats lisibles (base du calcul)
  missingStats: number; // servis sans sidecar stats
  totalLots: number; // Σ num_lots (munis avec stats)
  todMunis: number; // # munis à produit TOD
  todLots: number; // Σ num_lots des munis TOD
  numInTod: number; // Σ lots dans une aire TOD
  fields: FieldAgg[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Bounded-concurrency map (mirrors zonage-reacquire-audit.pool). */
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

/** Slugs qui ont un qc-lots servi (le set que consomme immo). */
async function enumerateServedSlugs(s3: S3Client): Promise<string[]> {
  return (await listSlugs(s3, OUT_PREFIX, ".geojson", true))
    .filter((s) => s.startsWith("qc-lots-"))
    .map((s) => s.replace(/^qc-lots-/, ""))
    .sort();
}

/** Sidecar stats d'un muni, avec retry léger ; null si vraiment absent/illisible. */
async function readStats(s3: S3Client, slug: string, attempts = 3): Promise<LotsStats | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await getJson<LotsStats>(s3, `${OUT_PREFIX}qc-lots-${slug}.stats.json`);
    } catch (e: unknown) {
      const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
      const code = err?.name ?? err?.Code ?? "";
      if (code === "NoSuchKey" || code === "NotFound" || err?.$metadata?.httpStatusCode === 404) return null;
      if (i === attempts - 1) return null;
      await sleep(150 * (i + 1));
    }
  }
  return null;
}

function pct(num: number, denom: number): number {
  return denom > 0 ? Math.round((10000 * num) / denom) / 100 : 0;
}

function realizationFor(field: FieldDef, agg: { pct: number; munisAny: number }): FieldAgg["realization"] {
  if (field.scope === "tod") {
    // in_tod : scopé (N/A hors CMM/CMQ) → jamais "done" (partiel par nature). Populé si ≥1 muni TOD.
    return agg.munisAny > 0 ? "in-progress" : "to-do";
  }
  if (agg.pct >= DONE_PCT) return "done";
  if (agg.pct > 0) return "in-progress";
  return "to-do";
}

function aggregate(rows: MuniRow[], totalLots: number, todLots: number): FieldAgg[] {
  return FIELDS.map((f) => {
    let numWith = 0;
    let munisFull = 0;
    let munisAny = 0;
    for (const r of rows) {
      if (f.scope === "tod" && !r.todPresent) continue;
      numWith += r.fieldNum[f.key] ?? 0;
      const p = r.fieldPct[f.key] ?? 0;
      if (p >= 90) munisFull++;
      if (p > 0) munisAny++;
    }
    const denom = f.scope === "tod" ? todLots : totalLots;
    const p = pct(numWith, denom);
    return {
      key: f.key,
      label: f.label,
      scope: f.scope,
      numWith,
      denom,
      pct: p,
      munisFull,
      munisAny,
      realization: realizationFor(f, { pct: p, munisAny }),
    };
  });
}

// ── Track capitalisation (modèle zonage-reacquire-audit) ─────────────────────

interface TrackItem {
  id: string;
  title: string;
  kind?: string;
}

/**
 * Items déjà créés, relus depuis `.track/events.jsonl` (autoritatif : porte TOUS les
 * `item.created` de tout kind, y compris workpackage/feature — contrairement à
 * `track item ls` qui n'expose que les feuilles chore). Premier created par id.
 */
function readCreatedItems(cwd: string): TrackItem[] {
  const path = join(cwd, ".track", "events.jsonl");
  if (!existsSync(path)) return [];
  const out: TrackItem[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const e = JSON.parse(line) as { type?: string; aggregateId?: string; payload?: { kind?: string; title?: string } };
    if (e.type !== "item.created" || !e.aggregateId || !e.payload?.title) continue;
    if (seen.has(e.aggregateId)) continue;
    seen.add(e.aggregateId);
    out.push({ id: e.aggregateId, title: e.payload.title, kind: e.payload.kind });
  }
  return out;
}

interface TrackLsItem {
  id: string;
  title: string;
  realization: "to-do" | "in-progress" | "done" | "cancelled" | "rejected";
}

/** Réalisation courante des feuilles, rejouée depuis `.track/events.jsonl` (autoritatif). */
function loadTrackRealizations(_trackBin: string, cwd: string): Map<string, TrackLsItem["realization"]> {
  const map = new Map<string, TrackLsItem["realization"]>();
  const path = join(cwd, ".track", "events.jsonl");
  if (!existsSync(path)) return map;
  const titleById = new Map<string, string>();
  const realizationById = new Map<string, TrackLsItem["realization"]>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const e = JSON.parse(line) as {
      type?: string;
      aggregateId?: string;
      payload?: { kind?: string; title?: string; to?: TrackLsItem["realization"] };
    };
    if (!e.aggregateId) continue;
    if (e.type === "item.created" && e.payload?.title) {
      titleById.set(e.aggregateId, e.payload.title);
      if (!realizationById.has(e.aggregateId)) realizationById.set(e.aggregateId, "to-do");
    } else if (e.type === "realization.transition" && e.payload?.to) {
      realizationById.set(e.aggregateId, e.payload.to);
    }
  }
  for (const [id, title] of titleById) map.set(title, realizationById.get(id) ?? "to-do");
  return map;
}

function trackIngest(trackBin: string, file: string, cwd: string): string[] {
  const out = execFileSync(trackBin, ["ingest", file, "--workspace", WORKSPACE], {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("no-op"));
}

const RANK: Record<string, number> = { "to-do": 0, "in-progress": 1, done: 2 };

/** Transitions item.realize forward-only de `from` vers `to` (jamais en arrière). */
function realizeSteps(itemId: string, from: string, to: FieldAgg["realization"]): object[] {
  const cur = RANK[from] ?? 0;
  const tgt = RANK[to] ?? 0;
  const steps: object[] = [];
  if (tgt >= 1 && cur < 1) steps.push({ v: 1, kind: "item.realize", payload: { itemId, to: "in-progress" } });
  if (tgt >= 2 && cur < 2) steps.push({ v: 1, kind: "item.realize", payload: { itemId, to: "done" } });
  return steps;
}

function childTitle(f: FieldAgg): string {
  return `immo-lots · ${f.key} — ${f.label}`;
}

interface TrackPlan {
  wpExists: boolean;
  toCreate: FieldAgg[]; // champs sans item track
  present: FieldAgg[]; // champs déjà présents
}

function planTrack(items: TrackItem[], fields: FieldAgg[]): TrackPlan {
  const wp = items.find((it) => it.title === IMMO_WP_TITLE);
  const existingKeys = new Set(
    items.map((it) => it.title.match(/^immo-lots · ([a-z0-9_-]+) —/)?.[1]).filter((s): s is string => !!s),
  );
  const toCreate: FieldAgg[] = [];
  const present: FieldAgg[] = [];
  for (const f of fields) (existingKeys.has(f.key) ? present : toCreate).push(f);
  return { wpExists: !!wp, toCreate, present };
}

function applyTrack(trackBin: string, cwd: string, fields: FieldAgg[]): void {
  mkdirSync(TRACK_EVENTS_DIR, { recursive: true });

  // Phase 1 — workpackage racine `immo-lots-enrichment` (idempotent).
  let items = readCreatedItems(cwd);
  let wpId = items.find((it) => it.title === IMMO_WP_TITLE)?.id;
  if (!wpId) {
    const wpFile = join(TRACK_EVENTS_DIR, "immo-lots-wp.jsonl");
    writeFileSync(
      wpFile,
      JSON.stringify({
        v: 1,
        kind: "item.create",
        payload: { kind: "feature", title: IMMO_WP_TITLE, workspace: WORKSPACE, role: "workpackage" },
      }) + "\n",
      "utf8",
    );
    const ids = trackIngest(trackBin, wpFile, cwd);
    wpId = ids[0];
    // eslint-disable-next-line no-console
    console.error(`[track] créé workpackage immo-lots-enrichment id=${wpId}`);
    items = readCreatedItems(cwd);
  }
  if (!wpId) throw new Error("workpackage immo-lots-enrichment introuvable après ingest");

  // Phase 2 — un item chore par champ manquant (parent = WP).
  const plan = planTrack(items, fields);
  if (plan.toCreate.length > 0) {
    const childFile = join(TRACK_EVENTS_DIR, "immo-lots-children.jsonl");
    const events = plan.toCreate.map((f) => ({
      v: 1,
      kind: "item.create",
      payload: { kind: "chore", title: childTitle(f), workspace: WORKSPACE, parentId: wpId },
    }));
    writeFileSync(childFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    const ids = trackIngest(trackBin, childFile, cwd);
    // eslint-disable-next-line no-console
    console.error(`[track] créé ${ids.length} item(s) champ immo-lots (${plan.toCreate.map((f) => f.key).join(", ")}).`);
    items = readCreatedItems(cwd);
  } else {
    // eslint-disable-next-line no-console
    console.error("[track] tous les items champ déjà présents.");
  }

  // Phase 3 — réalisation « couverture = avancement » (forward-only).
  const idByTitle = new Map(items.map((it) => [it.title, it.id]));
  const realizations = loadTrackRealizations(trackBin, cwd);
  const events: object[] = [];
  for (const f of fields) {
    const title = childTitle(f);
    const id = idByTitle.get(title);
    if (!id) continue;
    const cur = realizations.get(title) ?? "to-do";
    events.push(...realizeSteps(id, cur, f.realization));
  }
  if (events.length > 0) {
    const realizeFile = join(TRACK_EVENTS_DIR, "immo-lots-realizes.jsonl");
    writeFileSync(realizeFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    trackIngest(trackBin, realizeFile, cwd);
    // eslint-disable-next-line no-console
    console.error(`[track] appliqué ${events.length} transition(s) item.realize (couverture → avancement).`);
  } else {
    // eslint-disable-next-line no-console
    console.error("[track] réalisation déjà à jour (aucune transition).");
  }
}

// ── Human indicator line ──────────────────────────────────────────────────────

function fieldOf(fields: FieldAgg[], key: string): FieldAgg {
  return fields.find((f) => f.key === key)!;
}

function indicatorLines(sm: Summary): string[] {
  const g = (k: string): string => `${k} ${fieldOf(sm.fields, k).pct}%`;
  const line =
    `IMMO LOTS : ${sm.servedMunis} munis servis /${sm.totalMunis} — ` +
    `${g("surface_m2")} | ${g("adresse")} | ${g("code_postal")} | ${g("folded-normes")} | ` +
    `${g("in_tod")} scoped (${sm.todMunis} munis TOD; true=${sm.numInTod}/${sm.todLots} lots)` +
    (sm.missingStats ? ` | ${sm.missingStats} sans-stats` : "");
  const detail =
    `  détail : ${sm.statsMunis} munis mesurés · ${sm.totalLots} lots — ` +
    sm.fields
      .filter((f) => f.scope === "all")
      .map((f) => `${f.key}=${f.munisFull}munis≥90%`)
      .join(" ");
  return [line, detail];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const brief = argv.includes("--brief");
  const applyTrackFlag = argv.includes("--apply-track");
  const reportPath = arg(argv, "report");
  const trackBin = arg(argv, "track-bin") ?? "track";
  const conc = Number(arg(argv, "concurrency") ?? "12");

  const s3 = s3Client();
  const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as {
    municipalityCount?: number;
    cities: Record<string, unknown>;
  };
  const totalMunis = matrix.municipalityCount ?? Object.keys(matrix.cities).length;

  const served = await enumerateServedSlugs(s3);
  console.error(`[immo-lots] qc-lots servis : ${served.length} — lecture des sidecars stats…`);

  const stats = await pool(served, conc, (slug) => readStats(s3, slug));
  const rows: MuniRow[] = [];
  let missingStats = 0;
  for (let i = 0; i < served.length; i++) {
    const st = stats[i];
    const slug = served[i]!;
    if (!st) {
      missingStats++;
      continue;
    }
    const numLots = st.num_lots ?? 0;
    const fieldNum: Record<string, number> = {};
    const fieldPct: Record<string, number> = {};
    for (const f of FIELDS) {
      const n = f.numOf(st);
      fieldNum[f.key] = n;
      fieldPct[f.key] = pct(n, numLots);
    }
    rows.push({ slug, numLots, todPresent: st.tod_present === true, numInTod: st.num_in_tod ?? 0, fieldPct, fieldNum });
  }

  const totalLots = rows.reduce((s, r) => s + r.numLots, 0);
  const todRows = rows.filter((r) => r.todPresent);
  const todLots = todRows.reduce((s, r) => s + r.numLots, 0);
  const numInTod = todRows.reduce((s, r) => s + r.numInTod, 0);
  const fields = aggregate(rows, totalLots, todLots);

  const summary: Summary = {
    generatedAt: new Date().toISOString(),
    totalMunis,
    servedMunis: served.length,
    statsMunis: rows.length,
    missingStats,
    totalLots,
    todMunis: todRows.length,
    todLots,
    numInTod,
    fields,
  };

  if (brief) {
    for (const l of indicatorLines(summary)) console.log(l);
    return;
  }

  // Cache stable (indicateur lu par loop-supervise — 0 S3 dans le tick).
  writeFileSync(CACHE, JSON.stringify(summary, null, 2) + "\n");
  console.error(`[immo-lots] cache → ${CACHE}`);

  // Rapport complet (par muni) optionnel.
  if (reportPath) {
    const p = resolve(ROOT, reportPath);
    const report = {
      ...summary,
      thresholds: { DONE_PCT },
      perMuni: rows
        .slice()
        .sort((a, b) => b.numLots - a.numLots)
        .map((r) => ({ slug: r.slug, numLots: r.numLots, todPresent: r.todPresent, fieldPct: r.fieldPct })),
    };
    writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    console.error(`[immo-lots] rapport → ${p}`);
  }

  // Track capitalisation.
  const items = readCreatedItems(ROOT);
  const plan = planTrack(items, fields);
  console.error(
    `[track] workpackage immo-lots-enrichment ${plan.wpExists ? "existe" : "à créer"} ; ` +
      `${plan.toCreate.length} item(s) champ à créer, ${plan.present.length} présent(s). ` +
      `Réalisations cibles : ${fields.map((f) => `${f.key}=${f.realization}`).join(" ")}`,
  );
  if (applyTrackFlag) applyTrack(trackBin, ROOT, fields);
  else console.error("[track] DRY — passer --apply-track pour capitaliser dans le track.");

  for (const l of indicatorLines(summary)) console.log(l);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
