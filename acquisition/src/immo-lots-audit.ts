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
 *   - CAPITALISATION TRACK (--apply-track) : un workpackage RACINE par champ
 *     `immo-lots <field>` avec UN item chore par muni dans le périmètre du champ.
 *     Le rollup track porte donc le vrai N-done/N-total ; les munis sous le seuil
 *     restent visibles comme feuilles à faire. Les titres ne matchent PAS le parseur
 *     de `sync-track-from-coverage` (pas de `couche/voie · slug [status] —`), donc la
 *     synchro couverture atomique ne les touche pas.
 *
 * Usage :
 *   npx tsx acquisition/src/immo-lots-audit.ts                 # audit + cache (dry track)
 *   npx tsx acquisition/src/immo-lots-audit.ts --report work/coverage/immo-lots.report.json
 *   npx tsx acquisition/src/immo-lots-audit.ts --apply-track   # capitalise le WP dans le track
 *   npx tsx acquisition/src/immo-lots-audit.ts --brief         # juste la ligne indicateur
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { getJson, listSlugs, s3Client } from "./lib/s3.js";
import { applyImmoLotsTrack, immoFieldTrackTotals } from "./immo-lots-track.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MATRIX = join(ROOT, "work", "coverage", "coverage-matrix.json");
const CACHE = join(ROOT, "work", "coverage", "immo-lots.json");
const OUT_PREFIX = "normalized/qc-lots/";

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
  normesStatus?: string;
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
  perMuni: MuniRow[];
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
    cities: Record<string, Record<string, { status?: string }> | undefined>;
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
    rows.push({
      slug,
      numLots,
      todPresent: st.tod_present === true,
      numInTod: st.num_in_tod ?? 0,
      normesStatus: matrix.cities[slug]?.["normes"]?.status,
      fieldPct,
      fieldNum,
    });
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
    perMuni: rows.slice().sort((a, b) => a.slug.localeCompare(b.slug)),
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
      perMuni: rows.slice().sort((a, b) => b.numLots - a.numLots),
    };
    writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    console.error(`[immo-lots] rapport → ${p}`);
  }

  // Track capitalisation: one top-level WP per field, one leaf per in-scope muni.
  const totals = immoFieldTrackTotals(summary);
  console.error(
    `[track] immo-lots WPs cibles : ${totals
      .map((t) => `${t.key}=${t.done}/${t.total}`)
      .join(" ")}. ` +
      `Réalisations champ agrégées : ${fields.map((f) => `${f.key}=${f.realization}`).join(" ")}`,
  );
  if (applyTrackFlag) {
    const result = applyImmoLotsTrack({ summary, trackBin, cwd: ROOT });
    console.error(
      `[track] immo-lots appliqué : fieldWpsCreated=${result.fieldWpsCreated} ` +
        `leavesCreated=${result.leavesCreated} realizeEvents=${result.realizeEvents} ` +
        `coarseLeavesCancelled=${result.coarseLeavesCancelled}`,
    );
  } else {
    console.error("[track] DRY — passer --apply-track pour capitaliser dans le track.");
  }

  for (const l of indicatorLines(summary)) console.log(l);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
