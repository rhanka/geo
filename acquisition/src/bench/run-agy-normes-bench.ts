/**
 * run-agy-normes-bench — the agy / GEMINI 3.5 Flash (High) volet of the vision/OCR
 * benchmark for the `qc-zonage-norms` residue. A strict MIRROR of
 * run-claude48-normes-bench: SAME sample (work/bench/sample-20.json), SAME per-slug
 * windows (work/bench/windows.json), SAME correctness metric (crossValidateZoneCodes
 * against the muni SIG grille), SAME anti-invention guard (buildVisionField, inherited
 * whole via grille-agy-cli → grille-claude-cli). Only the vision engine changes:
 * Engine C = `agy -p` (Gemini 3.5 Flash High) instead of Engine B = `claude -p`.
 *
 * ANTI-POLLUTION (bench-only): reads S3 truth-ground READ-ONLY (SIG grille +
 * norms-manifest), NEVER deposits, NEVER touches coverage-matrix.json / the norms
 * manifest / provenance. All output lands under work/bench/ (default agy-results.json).
 *
 * Usage:
 *   npx tsx acquisition/src/bench/run-agy-normes-bench.ts --probe
 *   npx tsx acquisition/src/bench/run-agy-normes-bench.ts \
 *      [--sample work/bench/sample-20.json] [--slugs a,b,c] [--max-pages 6] \
 *      [--lanes 1] [--dpi 150] [--limit N] [--timeout-ms 180000] \
 *      [--price-in <usd/Mtok>] [--price-out <usd/Mtok>] [--out work/bench] [--resume]
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runAgyCli,
  buildAgyImagePrompt,
  parseAgyContent,
  mapAgyExtractionToZones,
  AgyCliError,
  AGY_MODEL,
  AGY_METHODE,
} from "../lib/grille-agy-cli.js";
import { renderPageToPng } from "../lib/grille-claude-cli.js";
import {
  pickWindow,
  loadWindows,
  localGrille as findGrille,
} from "./normes-bench-window.js";
import type { ZoneNormsT } from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { s3Client, getBytes, exists } from "../lib/s3.js";
import {
  crossValidateZoneCodes,
  publishedFieldPct,
  resolveGridKey,
  normsKey,
  ZONAGE_NORMS_MANIFEST_KEY,
  type CrossValResult,
} from "../lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const WORK = join(REPO, "work", "zonage-norms");
const BENCH_DIR = join(REPO, "work", "bench");

function arg(k: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
function has(k: string): boolean {
  return process.argv.includes(`--${k}`);
}

interface ManEntry {
  slug: string;
  unique_zone_codes?: number;
  published_field_pct?: number;
  methode?: string;
}

interface BenchRow {
  slug: string;
  pdfPages: number;
  textChars: number;
  layout: string;
  windowFirst: number;
  windowLast: number;
  gridFound: boolean;
  sigZoneCodes: number;
  pagesRead: number;
  pagesFailed: number;
  zonesRead: number;
  uniqueCodes: number;
  overlap: number;
  numericBridged: number;
  recoupExtracted: number;
  recoupSig: number;
  publishedFieldPct: number;
  hallucinationCodes: string[];
  inTokens: number;
  outTokens: number;
  thinkingTokens: number;
  estCostUsd: number; // token-priced estimate (agy bills credits; $ is indicative)
  seconds: number;
  existingUniqueCodes: number;
  existingPublishedPct: number;
  existingMethode: string;
  rateLimited: boolean;
  error?: string;
}

function loadSampleSlugs(): string[] {
  const slugsArg = arg("slugs");
  if (slugsArg) return slugsArg.split(",").map((s) => s.trim()).filter(Boolean);
  const samplePath = arg("sample") ?? join(BENCH_DIR, "sample-20.json");
  if (!existsSync(samplePath)) throw new Error(`sample file not found: ${samplePath} (pass --slugs or create it)`);
  const raw = JSON.parse(readFileSync(samplePath, "utf8")) as unknown;
  const arr: unknown = Array.isArray(raw) ? raw : (raw as { slugs?: unknown }).slugs;
  if (!Array.isArray(arr)) throw new Error("sample file must be an array or { slugs: [...] }");
  return arr.map((x) => (typeof x === "string" ? x : (x as { slug: string }).slug)).filter(Boolean);
}

function publishedCount(z: ZoneNormsT): number {
  const fs = [
    z.densite, z.hauteur_min, z.hauteur_max, z.frontage_min, z.superficie_min,
    z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min,
  ];
  return fs.filter((f) => f && f.value !== null).length;
}
function mergeByZone(zones: ZoneNormsT[]): ZoneNormsT[] {
  const byZone = new Map<string, ZoneNormsT>();
  for (const zn of zones) {
    const k = zn.zone_code.toUpperCase().replace(/\s+/g, "");
    const prev = byZone.get(k);
    if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(k, zn);
  }
  return [...byZone.values()];
}

async function main(): Promise<void> {
  await mkdir(BENCH_DIR, { recursive: true });
  const probe = has("probe");
  const maxPages = Number(arg("max-pages") ?? "6");
  const lanes = Number(arg("lanes") ?? "1");
  const dpi = Number(arg("dpi") ?? "150");
  const timeoutMs = Number(arg("timeout-ms") ?? "180000");
  const priceIn = arg("price-in") ? Number(arg("price-in")) : 0; // $/Mtok input
  const priceOut = arg("price-out") ? Number(arg("price-out")) : 0; // $/Mtok output
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const outDir = arg("out") ?? BENCH_DIR;
  await mkdir(outDir, { recursive: true });

  let slugs = loadSampleSlugs();
  if (limit !== undefined) slugs = slugs.slice(0, limit);

  const WINDOWS = loadWindows(BENCH_DIR);
  const s3 = s3Client();

  const manBySlug = new Map<string, ManEntry>();
  try {
    if (await exists(s3, ZONAGE_NORMS_MANIFEST_KEY)) {
      const man = JSON.parse((await getBytes(s3, ZONAGE_NORMS_MANIFEST_KEY)).toString("utf8")) as { entries?: ManEntry[] };
      for (const e of man.entries ?? []) manBySlug.set(e.slug, e);
    }
  } catch {
    /* manifest optional */
  }
  const snapshot = new Date().toISOString().slice(0, 10);

  // ── PROBE MODE — classify + SIG truth-ground, no agy. ──
  if (probe) {
    const rows: Array<Record<string, unknown>> = [];
    for (const slug of slugs) {
      const pdf = findGrille(WORK, slug);
      if (!pdf) {
        rows.push({ slug, staged: false });
        console.error(`[probe] ${slug} staged=false`);
        continue;
      }
      const w = pickWindow(pdf, maxPages, WINDOWS[slug]);
      const gk = await resolveGridKey(s3, slug).catch(() => null);
      let sigCodes = 0;
      if (gk) sigCodes = (await crossValidateZoneCodes(s3, slug, [])).sigZoneCodes;
      const deposited = await exists(s3, normsKey(slug)).catch(() => false);
      rows.push({
        slug, staged: true, pdfPages: w.pageCount, textChars: w.textChars, layout: w.layout,
        window: `${w.first}..${w.last}`, sigFound: Boolean(gk), sigZoneCodes: sigCodes, deposited,
      });
      console.error(`[probe] ${slug} pages=${w.pageCount} chars=${w.textChars} layout=${w.layout} win=${w.first}..${w.last} sig=${Boolean(gk)}(${sigCodes})`);
    }
    await writeFile(join(outDir, "agy-probe.json"), JSON.stringify({ generated: new Date().toISOString(), maxPages, rows }, null, 2));
    console.log(JSON.stringify({ probe: true, n: rows.length, out: join(outDir, "agy-probe.json") }, null, 2));
    return;
  }

  // ── RUN MODE ──
  console.error(`[bench-agy] model="${AGY_MODEL}" slugs=${slugs.length} lanes=${lanes} maxPages=${maxPages} dpi=${dpi}`);
  const rows: BenchRow[] = [];
  let globalRateLimited = false;

  const resultsPath = join(outDir, "agy-results.json");
  const done = new Set<string>();
  if (has("resume") && existsSync(resultsPath)) {
    try {
      const prev = JSON.parse(readFileSync(resultsPath, "utf8")) as { rows?: BenchRow[] };
      for (const r of prev.rows ?? []) { rows.push(r); done.add(r.slug); }
      console.error(`[bench-agy] resume: ${done.size} slug(s) already done — skipping`);
    } catch {
      /* ignore */
    }
  }
  const writeResults = async (): Promise<void> => {
    const agg = aggregate(rows);
    await writeFile(resultsPath, JSON.stringify({ generated: new Date().toISOString(), model: AGY_MODEL, methode: AGY_METHODE, maxPages, dpi, priceIn, priceOut, aggregate: agg, rows }, null, 2));
    await writeFile(join(outDir, "agy-normes-bench.md"), renderMarkdown(rows, agg, maxPages, dpi));
  };

  const processCity = async (slug: string): Promise<void> => {
    const man = manBySlug.get(slug);
    const row: BenchRow = {
      slug, pdfPages: 0, textChars: 0, layout: "?", windowFirst: 0, windowLast: 0,
      gridFound: false, sigZoneCodes: 0, pagesRead: 0, pagesFailed: 0, zonesRead: 0,
      uniqueCodes: 0, overlap: 0, numericBridged: 0, recoupExtracted: 0, recoupSig: 0,
      publishedFieldPct: 0, hallucinationCodes: [], inTokens: 0, outTokens: 0, thinkingTokens: 0,
      estCostUsd: 0, seconds: 0,
      existingUniqueCodes: man?.unique_zone_codes ?? 0, existingPublishedPct: man?.published_field_pct ?? 0,
      existingMethode: man?.methode ?? "—", rateLimited: false,
    };
    try {
      const pdf = findGrille(WORK, slug);
      if (!pdf) { row.error = "no staged grille.pdf"; return; }
      const w = pickWindow(pdf, maxPages, WINDOWS[slug]);
      row.pdfPages = w.pageCount;
      row.textChars = w.textChars;
      row.layout = w.layout;
      row.windowFirst = w.first;
      row.windowLast = w.last;
      if (w.last < w.first) { row.error = "empty window (0-page or unreadable pdf)"; return; }

      const allZones: ZoneNormsT[] = [];
      const t0 = Date.now();
      for (let truePage = w.first; truePage <= w.last && !globalRateLimited; truePage++) {
        let png: string | null = null;
        try {
          png = await renderPageToPng(pdf, truePage, dpi);
          const run = await runAgyCli(buildAgyImagePrompt(png), { model: AGY_MODEL, timeoutMs });
          if (has("dump-raw")) {
            await writeFile(join(outDir, `agy-raw-${slug}-p${truePage}.txt`), run.resultText).catch(() => undefined);
          }
          row.inTokens += run.usage.inputTokens;
          row.outTokens += run.usage.outputTokens;
          row.thinkingTokens += run.usage.thinkingTokens;
          const extraction = parseAgyContent(run.resultText);
          allZones.push(...mapAgyExtractionToZones(extraction, truePage, { source_url: pdf, snapshot, methode: AGY_METHODE }));
          row.pagesRead++;
        } catch (e) {
          if (e instanceof AgyCliError && e.kind === "rate-limit") {
            globalRateLimited = true;
            row.rateLimited = true;
            break;
          }
          row.pagesFailed++;
          const kind = e instanceof AgyCliError ? e.kind : "throw";
          console.error(`  [${slug} p${truePage}] FAIL ${kind}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
        } finally {
          if (png) await rm(dirname(png), { recursive: true, force: true }).catch(() => undefined);
        }
      }
      row.seconds = Math.round((Date.now() - t0) / 100) / 10;
      row.estCostUsd = Math.round(((row.inTokens / 1e6) * priceIn + (row.outTokens / 1e6) * priceOut) * 1e4) / 1e4;

      const merged = mergeByZone(allZones);
      row.zonesRead = merged.length;
      row.publishedFieldPct = publishedFieldPct(merged);
      const cv: CrossValResult = await crossValidateZoneCodes(s3, slug, merged);
      row.gridFound = cv.gridFound;
      row.sigZoneCodes = cv.sigZoneCodes;
      row.uniqueCodes = cv.extractedZoneCodes;
      row.overlap = cv.overlap;
      row.numericBridged = cv.numericBridged;
      row.recoupExtracted = Math.round(cv.recoupExtracted * 1000) / 1000;
      row.recoupSig = Math.round(cv.recoupSig * 1000) / 1000;
      row.hallucinationCodes = cv.extractedNotInSig;
    } catch (e) {
      row.error = (e instanceof Error ? e.message : String(e)).slice(0, 180);
    } finally {
      rows.push(row);
      await writeResults().catch(() => undefined);
      console.error(
        `[${slug}] pagesRead=${row.pagesRead}/${row.pagesRead + row.pagesFailed} zones=${row.zonesRead} ` +
          `codes=${row.uniqueCodes} overlap=${row.overlap}/${row.sigZoneCodes} ` +
          `recoupE=${row.recoupExtracted} recoupSig=${row.recoupSig} pub%=${row.publishedFieldPct} ` +
          `tok=${row.inTokens}/${row.outTokens}(+${row.thinkingTokens}th) ${row.seconds}s ` +
          `${row.rateLimited ? "RATE-LIMITED " : ""}${row.error ? "ERR:" + row.error : ""}`,
      );
    }
  };

  let next = 0;
  const runners = Array.from({ length: Math.max(1, lanes) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= slugs.length) return;
      if (done.has(slugs[i]!)) continue;
      if (globalRateLimited) {
        const man = manBySlug.get(slugs[i]!);
        rows.push({
          slug: slugs[i]!, pdfPages: 0, textChars: 0, layout: "?", windowFirst: 0, windowLast: 0,
          gridFound: false, sigZoneCodes: 0, pagesRead: 0, pagesFailed: 0, zonesRead: 0, uniqueCodes: 0,
          overlap: 0, numericBridged: 0, recoupExtracted: 0, recoupSig: 0, publishedFieldPct: 0,
          hallucinationCodes: [], inTokens: 0, outTokens: 0, thinkingTokens: 0, estCostUsd: 0, seconds: 0,
          existingUniqueCodes: man?.unique_zone_codes ?? 0, existingPublishedPct: man?.published_field_pct ?? 0,
          existingMethode: man?.methode ?? "—", rateLimited: true, error: "skipped (global rate-limit)",
        });
        continue;
      }
      await processCity(slugs[i]!);
    }
  });
  await Promise.all(runners);

  await writeResults();
  const agg = aggregate(rows);
  console.log(JSON.stringify({ done: true, cities: rows.length, aggregate: agg, out: resultsPath }, null, 2));
}

interface Agg {
  cities: number;
  citiesWithSig: number;
  citiesWithZones: number;
  meanRecoupExtracted: number;
  meanRecoupSig: number;
  meanPublishedFieldPct: number;
  totalOverlap: number;
  totalSigCodes: number;
  totalUniqueCodes: number;
  totalInTokens: number;
  totalOutTokens: number;
  totalThinkingTokens: number;
  totalEstCostUsd: number;
  totalSeconds: number;
  secondsPerCity: number;
  rateLimitedCities: number;
}

function mean(xs: number[]): number {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : 0;
}

function aggregate(rows: BenchRow[]): Agg {
  const withZones = rows.filter((r) => r.zonesRead > 0);
  const withSig = rows.filter((r) => r.gridFound);
  const withSigZones = rows.filter((r) => r.gridFound && r.zonesRead > 0);
  const totalSec = rows.reduce((a, r) => a + r.seconds, 0);
  return {
    cities: rows.length,
    citiesWithSig: withSig.length,
    citiesWithZones: withZones.length,
    meanRecoupExtracted: mean(withSigZones.map((r) => r.recoupExtracted)),
    meanRecoupSig: mean(withSigZones.map((r) => r.recoupSig)),
    meanPublishedFieldPct: mean(withZones.map((r) => r.publishedFieldPct)),
    totalOverlap: rows.reduce((a, r) => a + r.overlap, 0),
    totalSigCodes: withSig.reduce((a, r) => a + r.sigZoneCodes, 0),
    totalUniqueCodes: rows.reduce((a, r) => a + r.uniqueCodes, 0),
    totalInTokens: rows.reduce((a, r) => a + r.inTokens, 0),
    totalOutTokens: rows.reduce((a, r) => a + r.outTokens, 0),
    totalThinkingTokens: rows.reduce((a, r) => a + r.thinkingTokens, 0),
    totalEstCostUsd: Math.round(rows.reduce((a, r) => a + r.estCostUsd, 0) * 1e4) / 1e4,
    totalSeconds: Math.round(totalSec * 10) / 10,
    secondsPerCity: rows.length ? Math.round((totalSec / rows.length) * 10) / 10 : 0,
    rateLimitedCities: rows.filter((r) => r.rateLimited).length,
  };
}

function renderMarkdown(rows: BenchRow[], agg: Agg, maxPages: number, dpi: number): string {
  const L: string[] = [];
  L.push(`# Benchmark agy — Gemini 3.5 Flash (High) — grilles de normes (vision)`);
  L.push("");
  L.push(`_Généré ${new Date().toISOString()} · modèle ${AGY_MODEL} · route Engine-C \`agy -p\` (@image, --output-format json, --dangerously-skip-permissions) · fenêtre ≤ ${maxPages} pages/ville · dpi ${dpi}._`);
  L.push("");
  L.push("**Correctness** = recoupement avec la couche SIG (vérité-terrain). `recoupE` = overlap/codes-lus (précision) · `recoupSig` = overlap/codes-SIG (rappel, borné par la fenêtre). `pub%` = champs-normes publiés (verbatim-ou-null, guard buildVisionField). Hallucination = codes lus absents du SIG.");
  L.push("");
  L.push("**Conso** = tokens in/out (+thinking) + temps. agy facture des CRÉDITS d'abonnement ; `$est` = estimation via --price-in/--price-out (0 si non fourni).");
  L.push("");
  L.push("| ville | layout | pages | fenêtre | SIG | zones | codes | overlap | recoupE | recoupSig | pub% | halluc | tok in/out(+th) | $est | s |");
  L.push("|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const r of [...rows].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const halluc = r.gridFound && r.uniqueCodes > 0 ? `${r.uniqueCodes - r.overlap}/${r.uniqueCodes}` : "—";
    const err = r.error ? ` ⚠️${r.error}` : r.rateLimited ? " ⚠️rate-limit" : "";
    L.push(
      `| ${r.slug}${err} | ${r.layout} | ${r.pdfPages} | ${r.windowFirst}-${r.windowLast} | ${r.gridFound ? r.sigZoneCodes : "—"} | ${r.zonesRead} | ${r.uniqueCodes} | ${r.overlap} | ${r.recoupExtracted} | ${r.recoupSig} | ${r.publishedFieldPct} | ${halluc} | ${r.inTokens}/${r.outTokens}(+${r.thinkingTokens}) | ${r.estCostUsd.toFixed(3)} | ${r.seconds} |`,
    );
  }
  L.push("");
  L.push("## Agrégats");
  L.push("");
  L.push(`- Villes: ${agg.cities} · avec SIG: ${agg.citiesWithSig} · avec zones lues: ${agg.citiesWithZones} · rate-limited: ${agg.rateLimitedCities}`);
  L.push(`- **Correctness moyenne** (villes SIG∧zones): recoupExtracted=${agg.meanRecoupExtracted} · recoupSig=${agg.meanRecoupSig} · publishedFieldPct=${agg.meanPublishedFieldPct}%`);
  L.push(`- Overlap total ${agg.totalOverlap} / codes-SIG ${agg.totalSigCodes} · codes-lus total ${agg.totalUniqueCodes}`);
  L.push(`- **Conso**: tokens in=${agg.totalInTokens} out=${agg.totalOutTokens} thinking=${agg.totalThinkingTokens} · $est total=${agg.totalEstCostUsd} · temps total=${agg.totalSeconds}s · temps/ville=${agg.secondsPerCity}s`);
  L.push("");
  return L.join("\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
