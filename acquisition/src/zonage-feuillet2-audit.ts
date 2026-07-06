/**
 * zonage-feuillet2-audit.ts — DÉTECTION du bug « feuillet manquant » (READ-ONLY).
 *
 * SIGNATURE (le bug ORMSTOWN). Un muni RURAL dont le zonage a été recalé depuis
 * un « Plan général » (Feuillet 1 = territoire agricole) SANS le « Feuillet 2 =
 * périmètre urbain / village » : faute du feuillet-village, l'assignation au
 * plus-proche-label fait absorber TOUT le cœur villageois (grosse concentration
 * de lots) par UN SEUL code rural voisin. Ex. ORMSTOWN : `AC-2` = 1069 lots pour
 * 3.67 km² (≈ 292 lots/km²) alors que les zones agricoles font ~10–35 lots/km² —
 * un code rural qui a la DENSITÉ d'un centre-village = le village avalé À TORT.
 *
 * MÉTHODE (anti-invention, données S3 réelles, ZÉRO LLM). Pour chaque zonage
 * SERVI (`normalized/ca-qc-zonage/qc-zonage-<slug>.geojson`), on lit UNIQUEMENT
 * ses stats de recalage `qc-zonage-<slug>.stats.json` (produites par t1-build /
 * t2-build / t2-build-multisheet). Ce format `buildZones` porte `source`,
 * `per_feature[{zone_code,n_lots,area_km2}]`, et parfois `n_sheets_input/
 * n_sheets_included`. Les SIG opendata (schéma DIFFÉRENT, sans `per_feature`) ne
 * sont donc PAS des candidats — c'est voulu : un SIG municipal complet n'a pas de
 * feuillet-village manquant. En OPTION `--parquet`, on recoupe la fraction
 * dominante sur l'assignation lot→zone RÉELLEMENT servie à immo
 * (`normalized/qc-lot-zonage/<slug>.parquet`).
 *
 * SIGNAUX calculés par muni (tous mesurés, jamais fabriqués) :
 *   - top1_frac        : part de lots du code dominant (per_feature n_lots).
 *   - n_distinct       : nb de codes servis (grille réelle si ≥ MIN_DISTINCT ;
 *                        garde anti-#74 : un « zonage » à 1–2 codes n'est pas jugé).
 *   - dom_density      : lots/km² du code dominant (le tell « cœur villageois »).
 *   - density_ratio    : dom_density / médiane des densités par code (>>1 = anomalie).
 *   - partial_multisheet : n_sheets_included < n_sheets_input (feuillet EXCLU au
 *                        build = feuillet manquant PROUVÉ par le build lui-même).
 *
 * VERDICT :
 *   FLAG (candidat feuillet-2) ssi format buildZones (recalage de plan) ET
 *     n_distinct ≥ MIN_DISTINCT ET top1_frac ≥ TOP1_FRAC_MIN
 *     ET ( partial_multisheet  OU  village-core anomalie : density_ratio ≥
 *          DENSITY_RATIO_MIN  ou  dom_density ≥ DENSITY_ABS_MIN ).
 *   Score = 40*top1_frac + 30*(partial_multisheet) + min(30, density_ratio),
 *   trié décroissant. Le score N'AUTORISE RIEN : c'est un flag de revue ; la
 *   correction (t2-build-multisheet) garde ses PROPRES gates stricts au dépôt.
 *
 * SORTIES (locales seulement — n'écrit RIEN en S3, ne touche PAS coverage-matrix) :
 *   - liste classée imprimée (stdout) ;
 *   - rapport JSON complet (--report <path>) ;
 *   - cache stable `work/coverage/zonage-feuillet2.json`.
 *
 * Usage :
 *   npx tsx acquisition/src/zonage-feuillet2-audit.ts
 *   npx tsx acquisition/src/zonage-feuillet2-audit.ts --parquet          # recoupe l'assignation immo
 *   npx tsx acquisition/src/zonage-feuillet2-audit.ts --report work/coverage/zonage-feuillet2.json
 *   npx tsx acquisition/src/zonage-feuillet2-audit.ts --slugs ormstown,huberdeau
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { s3Client, getBytes, listSlugs } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CACHE = join(ROOT, "work", "coverage", "zonage-feuillet2.json");

const ZONES_PREFIX = "normalized/ca-qc-zonage/";
const LOTZONE_PREFIX = "normalized/qc-lot-zonage/";

// ── Seuils de la SIGNATURE (calibrés sur ORMSTOWN : AC-2 1069 lots / 3.67 km²). ──
const TOP1_FRAC_MIN = 0.4; // un seul code ≥ 40 % des lots servis = dominance anormale
const MIN_DISTINCT = 5; // grille municipale réelle (garde anti-#74 : pas 1–2 codes)
const DENSITY_RATIO_MIN = 4; // code dominant ≥ 4× la densité médiane par code = village avalé
const DENSITY_ABS_MIN = 80; // …ou densité absolue ≥ 80 lots/km² (centre-village)

interface PerFeature {
  zone_code?: string;
  n_lots?: number;
  area_km2?: number;
  kind?: string;
}

interface BuildStats {
  source?: string;
  confidence?: string;
  n_sheets_input?: number;
  n_sheets_included?: number;
  n_lots_total?: number;
  n_lots_assigned?: number;
  pct_area_covered?: number;
  per_feature?: PerFeature[];
}

type Verdict = "FLAG" | "OK" | "NOT-PLAN-RECALAGE" | "NO-STATS" | "TOO-COARSE-TO-JUDGE";

interface Row {
  slug: string;
  verdict: Verdict;
  source: string | null;
  confidence: string | null;
  n_distinct: number;
  total_lots: number;
  top1_code: string | null;
  top1_lots: number;
  top1_frac: number; // sur les lots assignés (Σ per_feature.n_lots)
  top1_area_km2: number | null;
  dom_density: number | null; // lots/km² du code dominant
  density_ratio: number | null; // dom_density / médiane
  partial_multisheet: boolean;
  n_sheets: string | null; // "included/input" si multisheet
  pct_area_covered: number | null;
  score: number;
  reasons: string[];
  // recoupement parquet (optionnel)
  parquet_top1_code?: string | null;
  parquet_top1_frac?: number | null;
  parquet_n_distinct?: number | null;
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** GET avec retry ; null SEULEMENT sur un vrai 404 (distingue absent vs throttlé). */
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

/** slug servi extrait du « rest » listSlugs (suffixe .geojson déjà retiré ;
 *  layout plat `qc-zonage-<slug>` OU sous-dossier `qc-zonage-<slug>/qc-zonage-<slug>`). */
function slugOfZoneRest(rest: string): string | null {
  return rest.match(/^qc-zonage-([^/]+)(?:\/qc-zonage-\1)?$/)?.[1] ?? null;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function statsKeyFor(s3: S3Client, slug: string): Promise<{ key: string; buf: Buffer } | null> {
  const flat = `${ZONES_PREFIX}qc-zonage-${slug}.stats.json`;
  const sub = `${ZONES_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.stats.json`;
  for (const key of [flat, sub]) {
    const buf = await getOrNull(s3, key);
    if (buf) return { key, buf };
  }
  return null;
}

/** Distribution lot→zone RÉELLEMENT servie à immo (recoupement optionnel). */
async function parquetDistribution(
  s3: S3Client,
  slug: string,
): Promise<{ top1_code: string | null; top1_frac: number; n_distinct: number } | null> {
  const buf = await getOrNull(s3, `${LOTZONE_PREFIX}${slug}.parquet`);
  if (!buf) return null;
  const rows = await readParquetRowsFromBuffer(buf, ["zone_code"]);
  const hist = new Map<string, number>();
  let withZone = 0;
  for (const r of rows) {
    const zc = (r as Record<string, unknown>)["zone_code"];
    if (zc == null || !String(zc).trim()) continue;
    withZone++;
    const k = String(zc);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  if (withZone === 0) return { top1_code: null, top1_frac: 0, n_distinct: 0 };
  let top1c: string | null = null;
  let top1n = 0;
  for (const [k, n] of hist) if (n > top1n) ((top1n = n), (top1c = k));
  return { top1_code: top1c, top1_frac: top1n / withZone, n_distinct: hist.size };
}

function classify(slug: string, stats: BuildStats | null): Row {
  const base: Row = {
    slug,
    verdict: "NO-STATS",
    source: null,
    confidence: null,
    n_distinct: 0,
    total_lots: 0,
    top1_code: null,
    top1_lots: 0,
    top1_frac: 0,
    top1_area_km2: null,
    dom_density: null,
    density_ratio: null,
    partial_multisheet: false,
    n_sheets: null,
    pct_area_covered: null,
    score: 0,
    reasons: [],
  };
  if (!stats) return base;

  // Format buildZones (recalage de plan) ? sinon SIG opendata / autre → pas candidat.
  const feats = (stats.per_feature ?? []).filter((f) => f.zone_code && Number(f.n_lots) > 0);
  base.source = stats.source ?? null;
  base.confidence = stats.confidence ?? null;
  base.pct_area_covered = typeof stats.pct_area_covered === "number" ? stats.pct_area_covered : null;
  if (feats.length === 0 || !stats.source) {
    base.verdict = "NOT-PLAN-RECALAGE";
    return base;
  }

  const totalLots = feats.reduce((a, f) => a + Number(f.n_lots ?? 0), 0);
  base.total_lots = totalLots;
  base.n_distinct = feats.length;
  const partial =
    typeof stats.n_sheets_input === "number" &&
    typeof stats.n_sheets_included === "number" &&
    stats.n_sheets_included < stats.n_sheets_input;
  base.partial_multisheet = partial;
  if (typeof stats.n_sheets_input === "number" && typeof stats.n_sheets_included === "number") {
    base.n_sheets = `${stats.n_sheets_included}/${stats.n_sheets_input}`;
  }

  const sorted = [...feats].sort((a, b) => Number(b.n_lots ?? 0) - Number(a.n_lots ?? 0));
  const top1 = sorted[0]!;
  base.top1_code = String(top1.zone_code);
  base.top1_lots = Number(top1.n_lots ?? 0);
  base.top1_frac = totalLots ? base.top1_lots / totalLots : 0;
  base.top1_area_km2 = typeof top1.area_km2 === "number" ? Number(top1.area_km2.toFixed(4)) : null;
  const domDensity = base.top1_area_km2 && base.top1_area_km2 > 0 ? base.top1_lots / base.top1_area_km2 : null;
  base.dom_density = domDensity != null ? Number(domDensity.toFixed(1)) : null;
  const densities = feats
    .filter((f) => typeof f.area_km2 === "number" && f.area_km2! > 0)
    .map((f) => Number(f.n_lots ?? 0) / f.area_km2!);
  const medDensity = median(densities);
  base.density_ratio = domDensity != null && medDensity > 0 ? Number((domDensity / medDensity).toFixed(2)) : null;

  // Garde anti-#74 : une « grille » à 1–2 codes n'est pas jugeable (pas une vraie grille).
  if (base.n_distinct < MIN_DISTINCT) {
    base.verdict = "TOO-COARSE-TO-JUDGE";
    return base;
  }

  const villageCore =
    (base.density_ratio != null && base.density_ratio >= DENSITY_RATIO_MIN) ||
    (base.dom_density != null && base.dom_density >= DENSITY_ABS_MIN);
  const dominant = base.top1_frac >= TOP1_FRAC_MIN;

  if (dominant && (partial || villageCore)) {
    base.verdict = "FLAG";
    if (partial) base.reasons.push(`feuillet EXCLU au build (${base.n_sheets} feuillets retenus)`);
    base.reasons.push(`code dominant ${base.top1_code}=${(base.top1_frac * 100).toFixed(1)}% des lots`);
    if (base.density_ratio != null && base.density_ratio >= DENSITY_RATIO_MIN)
      base.reasons.push(`densité ${base.dom_density} lots/km² = ${base.density_ratio}× la médiane (cœur villageois avalé)`);
    else if (base.dom_density != null && base.dom_density >= DENSITY_ABS_MIN)
      base.reasons.push(`densité ${base.dom_density} lots/km² (centre-village)`);
    base.score =
      Math.round(40 * base.top1_frac + (partial ? 30 : 0) + Math.min(30, base.density_ratio ?? 0));
  } else {
    base.verdict = "OK";
  }
  return base;
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const withParquet = argv.includes("--parquet");
  const reportPath = arg(argv, "report");
  const conc = Number(arg(argv, "concurrency") ?? "10");
  const only = arg(argv, "slugs")?.split(",").map((s) => s.trim()).filter(Boolean);

  const s3 = s3Client();

  // Ensemble SERVI = tout qc-zonage-<slug>.geojson déposé (plat ou sous-dossier).
  const rests = await listSlugs(s3, ZONES_PREFIX, ".geojson", false);
  let served = [...new Set(rests.map(slugOfZoneRest).filter((s): s is string => !!s))].sort();
  if (only && only.length) served = served.filter((s) => only.includes(s));
  console.error(`[feuillet2] zonages servis : ${served.length}${only ? ` (filtré → ${served.length})` : ""}`);

  const rows = await pool(served, conc, async (slug) => {
    const st = await statsKeyFor(s3, slug);
    const row = classify(slug, st ? (JSON.parse(st.buf.toString("utf8")) as BuildStats) : null);
    if (withParquet && (row.verdict === "FLAG" || row.verdict === "OK")) {
      const pq = await parquetDistribution(s3, slug);
      if (pq) {
        row.parquet_top1_code = pq.top1_code;
        row.parquet_top1_frac = Number(pq.top1_frac.toFixed(4));
        row.parquet_n_distinct = pq.n_distinct;
      }
    }
    return row;
  });
  rows.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

  const flagged = rows.filter((r) => r.verdict === "FLAG");
  const planRecalages = rows.filter((r) => r.verdict === "FLAG" || r.verdict === "OK" || r.verdict === "TOO-COARSE-TO-JUDGE");

  const summary = {
    generatedAt: new Date().toISOString(),
    thresholds: { TOP1_FRAC_MIN, MIN_DISTINCT, DENSITY_RATIO_MIN, DENSITY_ABS_MIN },
    zonesServed: served.length,
    planRecalages: planRecalages.length,
    flagged: flagged.length,
    partialMultisheet: flagged.filter((r) => r.partial_multisheet).length,
    flaggedSlugs: flagged.map((r) => r.slug),
  };

  writeFileSync(CACHE, JSON.stringify({ ...summary, flagged, all: rows }, null, 2));

  const report = { ...summary, flagged, planRecalages: planRecalages.map((r) => ({ ...r })) };
  if (reportPath) {
    const p = resolve(ROOT, reportPath);
    writeFileSync(p, JSON.stringify(report, null, 2));
    console.error(`[feuillet2] rapport → ${p}`);
  }

  console.log(
    `FEUILLET-2 : ${summary.zonesServed} servis — recalages-de-plan ${summary.planRecalages} — ` +
      `FLAGGÉS ${summary.flagged} (dont ${summary.partialMultisheet} multisheet-partiel)`,
  );
  for (const r of flagged) {
    const pq = r.parquet_top1_frac != null ? ` | immo ${r.parquet_top1_code}=${(r.parquet_top1_frac * 100).toFixed(1)}%` : "";
    console.log(
      `  #${r.score} ${r.slug} [${r.source}] ${r.top1_code}=${(r.top1_frac * 100).toFixed(1)}% ` +
        `(${r.top1_lots}/${r.total_lots} lots, ${r.top1_area_km2}km², ${r.dom_density} l/km², ×${r.density_ratio} méd, ` +
        `n_codes=${r.n_distinct}${r.n_sheets ? `, feuillets=${r.n_sheets}` : ""})${pq}`,
    );
    console.log(`      → ${r.reasons.join(" ; ")}`);
  }

  // Diagnostic de calibration : recalages-de-plan NON flaggés les plus proches de
  // la signature (part dominante la plus haute). Aide un relecteur à juger le seuil.
  const nearMiss = rows
    .filter((r) => r.verdict === "OK")
    .sort((a, b) => b.top1_frac - a.top1_frac || (b.density_ratio ?? 0) - (a.density_ratio ?? 0))
    .slice(0, 12);
  if (nearMiss.length) {
    console.log(`  — near-miss (recalage-de-plan OK, part dominante la plus haute) :`);
    for (const r of nearMiss) {
      console.log(
        `      ${r.slug} [${r.source}] ${r.top1_code}=${(r.top1_frac * 100).toFixed(1)}% ` +
          `(${r.dom_density} l/km², ×${r.density_ratio} méd, n_codes=${r.n_distinct}, aire ${r.pct_area_covered}%)`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
