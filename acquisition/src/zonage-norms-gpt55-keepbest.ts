/**
 * GPT-5.5 keep-best rattrapage for qc-zonage-norms shard A.
 *
 * Scope is intentionally narrow:
 *   - select live manifest entries whose methode is "mistral-vision" and whose
 *     slug starts with a..m;
 *   - run GPT-5.5 vision through the same bench path and frozen guard;
 *   - deposit parquet-only, strictly when recall/published fields improve with
 *     zero regression versus the actual current parquet when readable;
 *   - never update the shared manifest.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ParquetReader } from "@dsnp/parquetjs";

import type { S3Client } from "@aws-sdk/client-s3";

import {
  PUBLISH_THRESHOLD,
  type NormFieldT,
  type ZoneNormsT,
} from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { s3Client, getBytes, exists } from "./lib/s3.js";
import {
  crossValidateZoneCodes,
  depositParquetOnly,
  normsKey,
  type CrossValResult,
  type ManifestEntry,
} from "./lib/zonage-norms.js";
import {
  extractGrilleGpt55FromPdf,
  GPT55_DEFAULT_EFFORT,
  GPT55_DEFAULT_MODEL,
  GPT55_METHODE,
  Gpt55UsageLimitError,
  type CodexUsage,
} from "./lib/grille-gpt55-codex.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MUNIS_JSON = join(REPO, "work", "zonage-norms", "munis.json");
const LOCAL_GRILLE_DIR = join(REPO, "work", "zonage-norms");
const GRILLE_PREFIX = "sources/qc-zonage-grilles";
const REPORT = join(REPO, "work", "delegation-mass", "NORMES-RATTRAPAGE-A.md");
const RAW = join(REPO, "work", "delegation-mass", "NORMES-RATTRAPAGE-A.raw.json");
const MANIFEST_KEY = "registry/qc-zonage-norms/manifest.json";

const NORM_VALUE_COLS = [
  "densite_value",
  "hauteur_min_value",
  "hauteur_max_value",
  "frontage_min_value",
  "superficie_min_value",
  "marge_avant_min_value",
  "marge_laterale_min_value",
  "marge_arriere_min_value",
] as const;

const NORM_RAW_COLS = [
  "densite_raw",
  "hauteur_min_raw",
  "hauteur_max_raw",
  "frontage_min_raw",
  "superficie_min_raw",
  "marge_avant_min_raw",
  "marge_laterale_min_raw",
  "marge_arriere_min_raw",
] as const;

interface MuniCfg {
  slug: string;
  route?: string;
  first?: number;
  last?: number;
  pages?: number;
  reglement?: string | number;
  sourceUrl?: string;
}

interface LiveManifest {
  entries: ManifestEntry[];
}

interface Args {
  apply: boolean;
  noManifest: boolean;
  maxCities: number;
  pageCap: number;
  lanes: number;
  resume: boolean;
  retryErrors: boolean;
  report: string;
  raw: string;
  pageCacheDir: string;
  slugs: Set<string>;
  dpi: number;
  timeoutMs: number;
}

type Decision = "DEPOSIT-GPT55" | "KEEP-EXISTING" | "ERROR" | "SKIP-NO-PDF";

interface BaselineMetrics {
  source: "current-parquet" | "manifest";
  methode: string;
  rows: number;
  uniqueZoneCodes: number;
  published: number;
  recall: number;
  crossval: CrossValResult;
  pageHints: number[];
  falseValues: number;
  note?: string;
}

interface RunRow {
  slug: string;
  decision: Decision;
  deposited: boolean;
  baselineSource: string;
  baselineMethode: string;
  baselineRecall: number;
  baselinePublished: number;
  afterRecall: number;
  afterPublished: number;
  gptRecall: number;
  gptPublished: number;
  gptZones: number;
  gptFalseValues: number;
  pagesPlanned: number;
  pagesRead: number;
  pagesFailed: number;
  pageWindow: string;
  pdfSource: string;
  usage: CodexUsage;
  latencyMs: number;
  costUsd: number;
  note: string;
  errors: string[];
  retestedAt: string;
}

interface RawFile {
  generated_at: string;
  model: string;
  effort: string;
  dpi: number;
  apply: boolean;
  no_manifest: boolean;
  manifest_sha256_before: string;
  manifest_sha256_after?: string;
  targets: string[];
  rows: RunRow[];
}

function argVal(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseArgs(argv: string[]): Args {
  const optFlags = new Set([
    "--max-cities",
    "--page-cap",
    "--lanes",
    "--report",
    "--raw",
    "--page-cache-dir",
    "--dpi",
    "--timeout-ms",
  ]);
  const slugs = argv.filter((a, i) => !a.startsWith("--") && !optFlags.has(argv[i - 1] ?? ""));
  return {
    apply: argv.includes("--apply"),
    noManifest: argv.includes("--no-manifest"),
    maxCities: Number(argVal(argv, "--max-cities") ?? "0"),
    pageCap: Number(argVal(argv, "--page-cap") ?? "0"),
    lanes: Number(argVal(argv, "--lanes") ?? "1"),
    resume: argv.includes("--resume"),
    retryErrors: argv.includes("--retry-errors"),
    report: argVal(argv, "--report") ?? REPORT,
    raw: argVal(argv, "--raw") ?? RAW,
    pageCacheDir: argVal(argv, "--page-cache-dir") ?? join(REPO, "work", "delegation-mass", "gpt55-page-cache"),
    slugs: new Set(slugs),
    dpi: Number(argVal(argv, "--dpi") ?? process.env["GPT55_DPI"] ?? "150"),
    timeoutMs: Number(argVal(argv, "--timeout-ms") ?? process.env["GPT55_TIMEOUT_MS"] ?? "240000"),
  };
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function loadMunis(): Map<string, MuniCfg> {
  if (!existsSync(MUNIS_JSON)) return new Map();
  const raw = JSON.parse(readFileSync(MUNIS_JSON, "utf8")) as unknown;
  const arr: MuniCfg[] = Array.isArray(raw)
    ? (raw as MuniCfg[])
    : ((raw as { munis?: MuniCfg[] }).munis ?? []);
  return new Map(arr.filter((m) => m.slug).map((m) => [m.slug, m]));
}

function validHttpUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url) && !/non-disponible/i.test(url);
}

function pageSpan(cfg?: MuniCfg): number | null {
  if (cfg?.first != null && cfg.last != null && cfg.last >= cfg.first) return cfg.last - cfg.first + 1;
  return null;
}

function manifestPublished(e: ManifestEntry): number {
  return Math.round((e.zone_rows * 8 * e.published_field_pct) / 100);
}

function targetSort(a: ManifestEntry, b: ManifestEntry, munis: Map<string, MuniCfg>): number {
  const ac = munis.get(a.slug);
  const bc = munis.get(b.slug);
  const ar = ac?.route === "multizone" ? 3 : ac?.route === "vision" ? 2 : 1;
  const br = bc?.route === "multizone" ? 3 : bc?.route === "vision" ? 2 : 1;
  if (br !== ar) return br - ar;
  const ad = manifestPublished(a) / Math.max(1, a.unique_zone_codes * 8);
  const bd = manifestPublished(b) / Math.max(1, b.unique_zone_codes * 8);
  if (ad !== bd) return ad - bd;
  if (b.unique_zone_codes !== a.unique_zone_codes) return b.unique_zone_codes - a.unique_zone_codes;
  const ap = pageSpan(ac) ?? 0;
  const bp = pageSpan(bc) ?? 0;
  if (bp !== ap) return bp - ap;
  return a.slug.localeCompare(b.slug);
}

function pdfPageCount(pdfPath: string): number {
  const r = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

function pdftotextPages(pdfPath: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) return [];
  const pages = r.stdout.split("\f");
  if (pages[pages.length - 1] === "") pages.pop();
  return pages;
}

function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function likelyGrillePage(text: string): boolean {
  const t = foldText(text);
  if (t.trim().length < 30) return false;
  const strongGrid =
    /grille[s]? (des |d[' ]|de )?(usages|usage|normes|specifications|zonage)/i.test(t) ||
    /annexe\s+[a-z0-9-]+\s+.*grille/i.test(t);
  if (strongGrid) return true;
  const zoneCodes = t.match(/\b[a-z]{1,4}\s*-\s*\d{1,4}[a-z]?(?:\s*-\s*\d{1,2})?\b/gi) ?? [];
  const normPair =
    /(marge[\s\S]{0,240}hauteur|hauteur[\s\S]{0,240}marge|superficie[\s\S]{0,240}marge|largeur[\s\S]{0,240}hauteur)/i.test(t);
  const tableSignal = /(\|\s*){3,}|_{8,}|\.{5,}|\t/.test(t);
  return zoneCodes.length >= 3 && normPair && tableSignal;
}

function candidatePagesFromText(pdfPath: string): number[] {
  const texts = pdftotextPages(pdfPath);
  const pages: number[] = [];
  texts.forEach((text, idx) => {
    if (likelyGrillePage(text)) pages.push(idx + 1);
  });
  return pages;
}

function findLocalGrille(slug: string): string | null {
  const dir = join(LOCAL_GRILLE_DIR, slug);
  if (!existsSync(dir)) return null;
  try {
    const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return null;
    const pref = pdfs.find((f) => /grille|original|annexe/i.test(f)) ?? pdfs[0]!;
    return join(dir, pref);
  } catch {
    return null;
  }
}

async function downloadPdf(url: string, dest: string): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1024 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new Error("not a PDF");
    }
    await writeFile(dest, buf);
  } finally {
    clearTimeout(t);
  }
}

async function resolvePdf(
  s3: S3Client,
  slug: string,
  base: ManifestEntry,
  cfg: MuniCfg | undefined,
  dir: string,
): Promise<{ path: string; sourceUrlMeta: string; kind: string; notes: string[] }> {
  const notes: string[] = [];
  const stagedKey = `${GRILLE_PREFIX}/${slug}.pdf`;
  const local = findLocalGrille(slug);
  const out = join(dir, "grille.pdf");
  const cfgUrl = validHttpUrl(cfg?.sourceUrl) ? cfg!.sourceUrl! : undefined;
  const baseUrl = validHttpUrl(base.source_url) ? base.source_url : undefined;
  const hasRange = cfg?.first != null && cfg.last != null;

  const tryUrl = async (url: string, kind: string): Promise<{ path: string; sourceUrlMeta: string; kind: string } | null> => {
    try {
      await downloadPdf(url, out);
      return { path: out, sourceUrlMeta: url, kind };
    } catch (e) {
      notes.push(`${kind} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      return null;
    }
  };

  if (hasRange) {
    if (cfgUrl) {
      const r = await tryUrl(cfgUrl, "munis-url");
      if (r) return { ...r, notes };
    }
    if (baseUrl && baseUrl !== cfgUrl) {
      const r = await tryUrl(baseUrl, "manifest-url");
      if (r) return { ...r, notes };
    }
  }

  if (await exists(s3, stagedKey)) {
    await writeFile(out, await getBytes(s3, stagedKey));
    return { path: out, sourceUrlMeta: baseUrl ?? cfgUrl ?? base.source_url ?? "non-disponible", kind: "s3-staged", notes };
  }

  if (local) {
    return { path: local, sourceUrlMeta: cfgUrl ?? baseUrl ?? base.source_url ?? "non-disponible", kind: "local", notes };
  }

  if (!hasRange) {
    if (cfgUrl) {
      const r = await tryUrl(cfgUrl, "munis-url");
      if (r) return { ...r, notes };
    }
    if (baseUrl && baseUrl !== cfgUrl) {
      const r = await tryUrl(baseUrl, "manifest-url");
      if (r) return { ...r, notes };
    }
  }

  throw new Error(notes.length ? notes.join("; ") : "no PDF source (S3/local/url)");
}

function pageList(first: number, last: number): number[] {
  const pages: number[] = [];
  for (let p = first; p <= last; p++) pages.push(p);
  return pages;
}

function applyPageCap(pages: number[], cap: number): number[] {
  return cap > 0 ? pages.slice(0, cap) : pages;
}

function selectPages(
  cfg: MuniCfg | undefined,
  pageCount: number,
  baselineHints: number[],
  pageCap: number,
  textCandidates: number[] = [],
): number[] {
  if (cfg?.first != null && cfg.last != null) {
    return applyPageCap(pageList(cfg.first, Math.min(cfg.last, pageCount || cfg.last)), pageCap);
  }
  const hinted = baselineHints.filter((p) => p >= 1 && (!pageCount || p <= pageCount));
  if (hinted.length) return applyPageCap([...new Set(hinted)].sort((a, b) => a - b), pageCap);
  const candidates = textCandidates.filter((p) => p >= 1 && (!pageCount || p <= pageCount));
  if (candidates.length) return applyPageCap([...new Set(candidates)].sort((a, b) => a - b), pageCap);
  return applyPageCap(pageList(1, Math.max(1, pageCount)), pageCap);
}

function pageWindow(pages: number[]): string {
  if (pages.length === 0) return "-";
  const ranges: string[] = [];
  let start = pages[0]!;
  let prev = start;
  for (const p of pages.slice(1)) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    ranges.push(start === prev ? String(start) : `${start}-${prev}`);
    start = prev = p;
  }
  ranges.push(start === prev ? String(start) : `${start}-${prev}`);
  return ranges.join(",");
}

function publishedCount(z: ZoneNormsT): number {
  const fs = [
    z.densite,
    z.hauteur_min,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges.avant_min,
    z.marges.laterale_min,
    z.marges.arriere_min,
  ];
  return fs.filter((f) => f && f.value !== null).length;
}

function totalPublished(zones: ZoneNormsT[]): number {
  return zones.reduce((s, z) => s + publishedCount(z), 0);
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

function allFields(z: ZoneNormsT): NormFieldT[] {
  return [
    z.densite,
    z.hauteur_min,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges.avant_min,
    z.marges.laterale_min,
    z.marges.arriere_min,
  ].filter((f): f is NormFieldT => f !== null);
}

function valueAppearsInRaw(value: unknown, rawValue: unknown): boolean {
  if (value === null || value === undefined) return true;
  const raw = String(rawValue ?? "").replace(/\s/g, "").replace(/,/g, ".");
  if (!raw) return false;
  const v = String(value);
  if (raw.includes(v)) return true;
  return raw.includes(v.replace(/\.0$/, "")) || raw.includes(v.includes(".") ? v : `${v}.`);
}

function falseValuesFromZones(zones: ZoneNormsT[]): number {
  let falseValues = 0;
  for (const z of zones) {
    for (const f of allFields(z)) {
      if (f.value !== null && f.confidence >= PUBLISH_THRESHOLD && !valueAppearsInRaw(f.value, f.raw)) {
        falseValues++;
      }
    }
  }
  return falseValues;
}

async function readParquetRowsFromS3(
  s3: S3Client,
  slug: string,
  columns: string[],
): Promise<Record<string, unknown>[]> {
  const dir = await mkdtemp(join(tmpdir(), "norms-pq-"));
  const path = join(dir, "in.parquet");
  try {
    await writeFile(path, await getBytes(s3, normsKey(slug)));
    const reader = await ParquetReader.openFile(path);
    const cursor = reader.getCursor(columns as never);
    const rows: Record<string, unknown>[] = [];
    let row: Record<string, unknown> | null;
    while ((row = (await cursor.next()) as Record<string, unknown> | null)) {
      if (Object.keys(row).length === 0) break;
      rows.push(row);
    }
    await reader.close();
    return rows;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function canonZone(code: unknown): string {
  return String(code ?? "").toUpperCase().replace(/\s+/g, "");
}

function fakeZones(codes: string[]): ZoneNormsT[] {
  return codes.map((zone_code) => ({ zone_code }) as ZoneNormsT);
}

function publishedFromParquet(rows: Record<string, unknown>[]): number {
  let published = 0;
  for (const row of rows) {
    for (const col of NORM_VALUE_COLS) {
      if (row[col] !== null && row[col] !== undefined) published++;
    }
  }
  return published;
}

function falseValuesFromParquet(rows: Record<string, unknown>[]): number {
  let falseValues = 0;
  for (const row of rows) {
    for (let i = 0; i < NORM_VALUE_COLS.length; i++) {
      const value = row[NORM_VALUE_COLS[i]!];
      if (value !== null && value !== undefined && !valueAppearsInRaw(value, row[NORM_RAW_COLS[i]!])) {
        falseValues++;
      }
    }
  }
  return falseValues;
}

function pageHintsFromRows(rows: Record<string, unknown>[]): number[] {
  const pages = new Set<number>();
  for (const row of rows) {
    const m = String(row["zone_page"] ?? "").match(/\bPAGE\s+(\d+)\b/i);
    if (m) pages.add(Number(m[1]));
  }
  return [...pages].sort((a, b) => a - b);
}

async function currentBaseline(
  s3: S3Client,
  slug: string,
  base: ManifestEntry,
): Promise<BaselineMetrics> {
  const manifestCross: CrossValResult = {
    gridFound: base.crossval?.gridFound ?? false,
    sigZoneCodes: base.crossval?.sigZoneCodes ?? 0,
    extractedZoneCodes: base.unique_zone_codes,
    overlap: base.crossval?.overlap ?? 0,
    recoupExtracted: base.crossval?.recoupExtracted ?? 0,
    recoupSig: base.crossval?.recoupSig ?? 0,
    extractedNotInSig: [],
  };
  try {
    const rows = await readParquetRowsFromS3(s3, slug, [
      "zone_code",
      "zone_page",
      "_methode",
      ...NORM_VALUE_COLS,
      ...NORM_RAW_COLS,
    ]);
    const codes = [...new Set(rows.map((r) => String(r["zone_code"] ?? "")).filter(Boolean))];
    const cross = await crossValidateZoneCodes(s3, slug, fakeZones(codes));
    const recall = cross.gridFound ? cross.overlap : cross.extractedZoneCodes;
    return {
      source: "current-parquet",
      methode: String(rows[0]?.["_methode"] ?? base.methode),
      rows: rows.length,
      uniqueZoneCodes: new Set(codes.map(canonZone)).size,
      published: publishedFromParquet(rows),
      recall,
      crossval: cross,
      pageHints: pageHintsFromRows(rows),
      falseValues: falseValuesFromParquet(rows),
    };
  } catch (e) {
    const recall = manifestCross.gridFound ? manifestCross.overlap : base.unique_zone_codes;
    return {
      source: "manifest",
      methode: base.methode,
      rows: base.zone_rows,
      uniqueZoneCodes: base.unique_zone_codes,
      published: manifestPublished(base),
      recall,
      crossval: manifestCross,
      pageHints: [],
      falseValues: 0,
      note: `parquet baseline unreadable: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`,
    };
  }
}

function emptyUsage(): CodexUsage {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
}

function addUsage(a: CodexUsage, b: CodexUsage): CodexUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
  };
}

function loadRaw(path: string): RawFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RawFile;
  } catch {
    return null;
  }
}

function rowHitUsageLimit(row: RunRow): boolean {
  return row.errors.some((e) => /usage limit|try again at/i.test(e)) || /usage limit|try again at/i.test(row.note);
}

async function writeRaw(path: string, raw: RawFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(raw, null, 2) + "\n", "utf8");
}

function totals(rows: RunRow[]): {
  improved: number;
  kept: number;
  errors: number;
  skipped: number;
  reocrd: number;
  beforePublished: number;
  afterPublished: number;
  beforeRecall: number;
  afterRecall: number;
  falseValues: number;
  usage: CodexUsage;
  pagesRead: number;
  pagesFailed: number;
  latencyMs: number;
} {
  return rows.reduce((a, r) => {
    a.improved += r.decision === "DEPOSIT-GPT55" ? 1 : 0;
    a.kept += r.decision === "KEEP-EXISTING" ? 1 : 0;
    a.errors += r.decision === "ERROR" ? 1 : 0;
    a.skipped += r.decision === "SKIP-NO-PDF" ? 1 : 0;
    a.reocrd += r.pagesRead > 0 ? 1 : 0;
    a.beforePublished += r.baselinePublished;
    a.afterPublished += r.afterPublished;
    a.beforeRecall += r.baselineRecall;
    a.afterRecall += r.afterRecall;
    a.falseValues += r.gptFalseValues;
    a.usage = addUsage(a.usage, r.usage);
    a.pagesRead += r.pagesRead;
    a.pagesFailed += r.pagesFailed;
    a.latencyMs += r.latencyMs;
    return a;
  }, {
    improved: 0,
    kept: 0,
    errors: 0,
    skipped: 0,
    reocrd: 0,
    beforePublished: 0,
    afterPublished: 0,
    beforeRecall: 0,
    afterRecall: 0,
    falseValues: 0,
    usage: emptyUsage(),
    pagesRead: 0,
    pagesFailed: 0,
    latencyMs: 0,
  });
}

async function writeReport(path: string, raw: RawFile): Promise<void> {
  const t = totals(raw.rows);
  const sorted = [...raw.rows].sort((a, b) => a.slug.localeCompare(b.slug));
  const lines: string[] = [];
  lines.push("# NORMES RATTRAPAGE A — GPT-5.5 keep-best");
  lines.push("");
  lines.push(`_Genere ${new Date().toISOString()} — modele ${raw.model}, effort ${raw.effort}, dpi ${raw.dpi}._`);
  lines.push("");
  lines.push("## Hard numbers");
  lines.push("");
  lines.push(`- Scope manifest: ${raw.targets.length} villes methode=mistral-vision, slug a-m.`);
  lines.push(`- Villes re-OCR'd: ${t.reocrd}; pages GPT lues: ${t.pagesRead}; pages echouees: ${t.pagesFailed}.`);
  lines.push(`- GPT-5.5 improved/deposited: ${t.improved}; kept existing better/equal: ${t.kept}; errors: ${t.errors}; no PDF: ${t.skipped}.`);
  lines.push(`- Aggregate published fields: ${t.beforePublished} -> ${t.afterPublished} (delta ${t.afterPublished - t.beforePublished}).`);
  lines.push(`- Aggregate recall: ${t.beforeRecall} -> ${t.afterRecall} (delta ${t.afterRecall - t.beforeRecall}).`);
  lines.push(`- Anti-invention spot metric: GPT false published fields=${t.falseValues}; guard path=mapClaudeExtractionToZones -> buildVisionField.`);
  lines.push(`- Cost: $0.0000 Codex CLI/subscription path; tokens in/out/reason=${t.usage.inputTokens}/${t.usage.outputTokens}/${t.usage.reasoningOutputTokens}; latency=${Math.round(t.latencyMs / 1000)}s.`);
  lines.push(`- Manifest SHA256 before/after: ${raw.manifest_sha256_before} -> ${raw.manifest_sha256_after ?? "n/r"}.`);
  lines.push(`- Apply mode: ${raw.apply}; parquet-only (--no-manifest): ${raw.no_manifest}.`);
  lines.push("");
  lines.push("## Villes re-OCR'd");
  lines.push("");
  lines.push("| ville | decision | baseline | recall before->gpt->after | published before->gpt->after | pages | false | note |");
  lines.push("|---|---|---|---:|---:|---:|---:|---|");
  for (const r of sorted.filter((x) => x.pagesRead > 0 || x.decision !== "SKIP-NO-PDF")) {
    lines.push(
      `| ${r.slug} | ${r.decision}${r.deposited ? " (depot)" : ""} | ${r.baselineMethode}/${r.baselineSource} | ` +
      `${r.baselineRecall}->${r.gptRecall}->${r.afterRecall} | ` +
      `${r.baselinePublished}->${r.gptPublished}->${r.afterPublished} | ` +
      `${r.pagesRead}/${r.pagesPlanned} (${r.pageWindow}) | ${r.gptFalseValues} | ${r.note.replace(/\|/g, "/")} |`,
    );
  }
  const noPdf = sorted.filter((x) => x.decision === "SKIP-NO-PDF");
  if (noPdf.length) {
    lines.push("");
    lines.push("## No PDF");
    lines.push("");
    for (const r of noPdf) lines.push(`- ${r.slug}: ${r.note}`);
  }
  lines.push("");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lines.join("\n"), "utf8");
}

async function pool<T>(items: T[], lanes: number, worker: (item: T, idx: number) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, lanes) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
}

function initialRow(slug: string, baseline: BaselineMetrics): RunRow {
  return {
    slug,
    decision: "ERROR",
    deposited: false,
    baselineSource: baseline.source,
    baselineMethode: baseline.methode,
    baselineRecall: baseline.recall,
    baselinePublished: baseline.published,
    afterRecall: baseline.recall,
    afterPublished: baseline.published,
    gptRecall: 0,
    gptPublished: 0,
    gptZones: 0,
    gptFalseValues: 0,
    pagesPlanned: 0,
    pagesRead: 0,
    pagesFailed: 0,
    pageWindow: "-",
    pdfSource: "-",
    usage: emptyUsage(),
    latencyMs: 0,
    costUsd: 0,
    note: baseline.note ?? "",
    errors: [],
    retestedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.noManifest) {
    throw new Error("--apply requires --no-manifest; this shard must deposit parquet-only");
  }
  const s3 = s3Client();
  const manifestBytes = await getBytes(s3, MANIFEST_KEY);
  const manifestHashBefore = sha256(manifestBytes);
  const man = JSON.parse(manifestBytes.toString("utf8")) as LiveManifest;
  const munis = loadMunis();
  let targets = man.entries
    .filter((e) => e.methode === "mistral-vision" && /^[a-m]/.test(e.slug))
    .filter((e) => args.slugs.size === 0 || args.slugs.has(e.slug))
    .sort((a, b) => targetSort(a, b, munis));
  if (args.maxCities > 0) targets = targets.slice(0, args.maxCities);

  const previous = args.resume ? loadRaw(args.raw) : null;
  const raw: RawFile = previous ?? {
    generated_at: new Date().toISOString(),
    model: process.env["GPT55_MODEL"] ?? GPT55_DEFAULT_MODEL,
    effort: process.env["GPT55_EFFORT"] ?? GPT55_DEFAULT_EFFORT,
    dpi: args.dpi,
    apply: args.apply,
    no_manifest: args.noManifest,
    manifest_sha256_before: manifestHashBefore,
    targets: targets.map((e) => e.slug),
    rows: [],
  };
  raw.apply = args.apply;
  raw.no_manifest = args.noManifest;
  raw.targets = targets.map((e) => e.slug);
  raw.manifest_sha256_before = raw.manifest_sha256_before || manifestHashBefore;

  const rowsBySlug = new Map(raw.rows.map((r) => [r.slug, r]));
  const pending = targets.filter((e) => {
    const prev = rowsBySlug.get(e.slug);
    if (!prev) return true;
    if (rowHitUsageLimit(prev)) return true;
    return args.retryErrors && (prev.decision === "ERROR" || prev.decision === "SKIP-NO-PDF");
  });

  console.error(
    `[gpt55-keepbest] targets=${targets.length} pending=${pending.length} apply=${args.apply} noManifest=${args.noManifest} lanes=${args.lanes}`,
  );

  const snapshot = new Date().toISOString().slice(0, 10);

  const processEntry = async (base: ManifestEntry): Promise<void> => {
    const baseline = await currentBaseline(s3, base.slug, base);
    const row = initialRow(base.slug, baseline);
    const cfg = munis.get(base.slug);
    const dir = await mkdtemp(join(tmpdir(), `gpt55-${base.slug}-`));
    let recordRow = true;
    try {
      const pdf = await resolvePdf(s3, base.slug, base, cfg, dir);
      row.pdfSource = pdf.kind;
      if (pdf.notes.length) row.errors.push(...pdf.notes);
      const pageCount = pdfPageCount(pdf.path);
      const textCandidates = cfg?.first == null && baseline.pageHints.length === 0
        ? candidatePagesFromText(pdf.path)
        : [];
      if (textCandidates.length > 0 && textCandidates.length < pageCount) {
        row.errors.push(`text page selector: ${textCandidates.length}/${pageCount} candidate pages`);
      }
      const pages = selectPages(cfg, pageCount, baseline.pageHints, args.pageCap, textCandidates);
      row.pagesPlanned = pages.length;
      row.pageWindow = pageWindow(pages);
      if (pages.length === 0) throw new Error("no pages selected");

      const res = await extractGrilleGpt55FromPdf(pdf.path, pages, base.slug, {
        source_url: pdf.sourceUrlMeta,
        snapshot,
        methode: GPT55_METHODE,
        dpi: args.dpi,
        cli: { timeoutMs: args.timeoutMs },
        pageCacheDir: join(args.pageCacheDir, base.slug),
        onPage: (ev) => {
          console.error(
            `[${base.slug}] page ${ev.page} ${ev.ok ? "ok" : "failed"}${ev.cached ? " cached" : ""} ${Math.round(ev.latencyMs / 1000)}s` +
            (ev.error ? ` :: ${ev.error.slice(0, 120)}` : ""),
          );
        },
      });
      row.pagesRead = res.pagesRead;
      row.pagesFailed = res.pagesFailed;
      row.usage = res.usage;
      row.latencyMs = res.durationMs;
      row.errors.push(...res.reasons);

      const zones = mergeByZone(res.zones);
      const cross = zones.length
        ? await crossValidateZoneCodes(s3, base.slug, zones)
        : baseline.crossval;
      row.gptZones = zones.length;
      row.gptPublished = totalPublished(zones);
      row.gptRecall = cross.gridFound ? cross.overlap : cross.extractedZoneCodes;
      row.gptFalseValues = falseValuesFromZones(zones);

      const recallOk = row.gptRecall >= baseline.recall;
      const payloadOk = row.gptPublished >= baseline.published;
      const strictGain = row.gptRecall > baseline.recall || row.gptPublished > baseline.published;
      const enoughZones = zones.length >= 3;
      const noFabrication = row.gptFalseValues === 0;
      const improved = recallOk && payloadOk && strictGain && enoughZones && noFabrication;

      if (improved) {
        row.decision = "DEPOSIT-GPT55";
        row.afterRecall = row.gptRecall;
        row.afterPublished = row.gptPublished;
        row.note = `recall ${baseline.recall}->${row.gptRecall}, published ${baseline.published}->${row.gptPublished}`;
        if (args.apply) {
          await depositParquetOnly({
            s3,
            slug: base.slug,
            zones,
            meta: {
              source_url: pdf.sourceUrlMeta,
              ...(base.reglement ? { reglement: base.reglement } : cfg?.reglement ? { reglement: String(cfg.reglement) } : {}),
              methode: GPT55_METHODE,
              snapshot,
            },
            crossval: cross,
          });
          row.deposited = true;
        }
      } else {
        row.decision = "KEEP-EXISTING";
        row.afterRecall = baseline.recall;
        row.afterPublished = baseline.published;
        row.note = !noFabrication ? `anti-invention failed (${row.gptFalseValues})`
          : !enoughZones ? "moins de 3 zones extraites"
          : !recallOk ? `recall regresserait ${baseline.recall}->${row.gptRecall}`
          : !payloadOk ? `payload regresserait ${baseline.published}->${row.gptPublished}`
          : "aucun gain strict (egalite)";
      }
    } catch (e) {
      if (e instanceof Gpt55UsageLimitError) {
        recordRow = false;
        throw e;
      }
      row.decision = /no PDF source|failed|HTTP|not a PDF/.test(e instanceof Error ? e.message : String(e))
        ? "SKIP-NO-PDF"
        : "ERROR";
      row.note = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      row.afterRecall = baseline.recall;
      row.afterPublished = baseline.published;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if (!recordRow) return;
      rowsBySlug.set(base.slug, row);
      raw.rows = targets.map((t) => rowsBySlug.get(t.slug)).filter((r): r is RunRow => !!r);
      await writeRaw(args.raw, raw);
      await writeReport(args.report, raw);
      console.error(
        `[${base.slug}] ${row.decision}${row.deposited ? " deposited" : ""} ` +
        `pub ${row.baselinePublished}->${row.gptPublished}->${row.afterPublished} ` +
        `recall ${row.baselineRecall}->${row.gptRecall}->${row.afterRecall} ` +
        `pages ${row.pagesRead}/${row.pagesPlanned} false=${row.gptFalseValues} :: ${row.note}`,
      );
    }
  };

  await pool(pending, args.lanes, async (entry) => { await processEntry(entry); });

  raw.manifest_sha256_after = sha256(await getBytes(s3, MANIFEST_KEY));
  raw.rows = targets.map((t) => rowsBySlug.get(t.slug)).filter((r): r is RunRow => !!r);
  await writeRaw(args.raw, raw);
  await writeReport(args.report, raw);

  const t = totals(raw.rows);
  console.log(JSON.stringify({
    apply: args.apply,
    noManifest: args.noManifest,
    targets: targets.length,
    processed: raw.rows.length,
    reocrd: t.reocrd,
    improved: t.improved,
    kept: t.kept,
    errors: t.errors,
    skipNoPdf: t.skipped,
    publishedBefore: t.beforePublished,
    publishedAfter: t.afterPublished,
    recallBefore: t.beforeRecall,
    recallAfter: t.afterRecall,
    falseValues: t.falseValues,
    costUsd: 0,
    manifestUnchanged: raw.manifest_sha256_before === raw.manifest_sha256_after,
    report: args.report,
    raw: args.raw,
  }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
