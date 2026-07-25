/**
 * GPT-5.5 keep-best rattrapage for `qc-zonage-norms`.
 *
 * Shard-safe defaults:
 *   - targets only current parquet products whose method is still `mistral-vision`;
 *   - shard B selector is slug n-z (`--shard-b`);
 *   - apply mode requires `--no-manifest` and writes parquet only;
 *   - every candidate value goes through the frozen `buildVisionField` guard via
 *     `mapClaudeExtractionToZones(...)`;
 *   - deposit only when GPT-5.5 has more real published fields, zero fabricated
 *     fields, no recall drop, and no regression on any currently published field.
 *
 * Usage:
 *   node --import tsx src/zonage-norms-gpt55-rattrapage-keepbest.ts \
 *     --shard-b --apply --no-manifest
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildClaudePrompt,
  mapClaudeExtractionToZones,
  parseClaudeContent,
  renderPageToPng,
  type ClaudeRawExtraction,
} from "./lib/grille-claude-cli.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { getBytes, s3Client, exists as s3Exists } from "./lib/s3.js";
import {
  crossValidateZoneCodes,
  depositParquetOnly,
  normsKey,
  type CrossValResult,
} from "./lib/zonage-norms.js";
import {
  PUBLISH_THRESHOLD,
  type NormFieldT,
  type ZoneNormsT,
} from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MUNIS_JSON = join(REPO, "work", "zonage-norms", "munis.json");
const DEFAULT_LOCAL_DIR = join(REPO, "work", "zonage-norms");
const REPORT = join(REPO, "work", "delegation-mass", "NORMES-RATTRAPAGE-B.md");
const RAW_REPORT = join(REPO, "work", "delegation-mass", "NORMES-RATTRAPAGE-B.raw.json");
const GRILLE_PREFIX = "sources/qc-zonage-grilles";

const GPT_METHODE = "codex/gpt-5.5-vision";
const GPT_MODEL = process.env["GPT55_MODEL"] ?? "gpt-5.5";
const GPT_EFFORT = process.env["GPT55_EFFORT"] ?? "xhigh";
const CODEX_BIN = process.env["CODEX_BIN"] ?? "codex";
const CODEX_TIMEOUT_MS = Number(process.env["GPT55_TIMEOUT_MS"] ?? "240000");
const DPI = Number(process.env["GPT55_DPI"] ?? "150");
const SNAPSHOT = new Date().toISOString().slice(0, 10);

const FIELD_IDS = [
  "densite",
  "hauteur_metres",
  "hauteur_etages",
  "marge_avant_min",
  "marge_laterale_min",
  "marge_arriere_min",
  "frontage_min",
  "superficie_min",
] as const;

const FLAT_FIELDS = [
  "densite",
  "hauteur_min",
  "hauteur_max",
  "frontage_min",
  "superficie_min",
  "marge_avant_min",
  "marge_laterale_min",
  "marge_arriere_min",
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

interface ManEntry {
  slug: string;
  source_url: string;
  methode: string;
  reglement?: string;
  zone_rows: number;
  unique_zone_codes: number;
  published_field_pct: number;
  crossval?: { gridFound: boolean; sigZoneCodes: number; overlap: number; recoupSig: number };
}

interface Args {
  apply: boolean;
  noManifest: boolean;
  shardB: boolean;
  localDir: string;
  pageCap: number | null;
  limit: number | null;
  slugs: string[];
}

interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface Baseline {
  rows: Record<string, unknown>[];
  currentMethod: string;
  published: number;
  uniqueZoneCodes: number;
  cross: CrossValResult;
  recall: number;
  fieldValues: Map<string, Map<(typeof FLAT_FIELDS)[number], number>>;
}

interface GptRun {
  zones: ZoneNormsT[];
  pagesRead: number;
  pagesFailed: number;
  latencyMs: number;
  usage: CodexUsage;
  errors: string[];
}

interface Row {
  slug: string;
  route: string;
  pages: string;
  decision: "IMPROVED" | "KEPT" | "SKIPPED" | "ERROR";
  note: string;
  currentMethod: string;
  beforePublished: number;
  gptPublished: number;
  afterPublished: number;
  beforeRecall: number;
  gptRecall: number;
  afterRecall: number;
  fabricatedFields: number;
  fieldRegressions: number;
  pagesRead: number;
  pagesFailed: number;
  latencyMs: number;
  costUsd: number;
  usage: CodexUsage;
}

const ZERO_USAGE: CodexUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
};

const RAW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    zones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          zone_code: { type: ["string", "null"] },
          fields: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              FIELD_IDS.map((id) => [id, { type: ["string", "null"] }]),
            ),
            required: FIELD_IDS,
          },
        },
        required: ["zone_code", "fields"],
      },
    },
  },
  required: ["zones"],
} as const;

function parseArgs(argv: string[]): Args {
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (flag: string): number | null => {
    const v = val(flag);
    return v ? Number(v) : null;
  };
  const valued = new Set(["--local-dir", "--page-cap", "--limit"]);
  const slugs = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1] ?? ""));
  return {
    apply: argv.includes("--apply"),
    noManifest: argv.includes("--no-manifest"),
    shardB: argv.includes("--shard-b"),
    localDir: val("--local-dir") ?? DEFAULT_LOCAL_DIR,
    pageCap: num("--page-cap"),
    limit: num("--limit"),
    slugs,
  };
}

function loadMunis(): Map<string, MuniCfg> {
  const raw = JSON.parse(readFileSync(MUNIS_JSON, "utf8")) as unknown;
  const arr: MuniCfg[] = Array.isArray(raw)
    ? (raw as MuniCfg[])
    : ((raw as { munis?: MuniCfg[] }).munis ?? (Object.values(raw as object) as MuniCfg[]));
  return new Map(arr.filter((x) => x?.slug).map((x) => [x.slug, x]));
}

function manifestPublished(e: ManEntry): number {
  return Math.round(((e.zone_rows ?? 0) * 8 * (e.published_field_pct ?? 0)) / 100);
}

function routeRank(cfg: MuniCfg | undefined): number {
  if (cfg?.route === "multizone") return 2;
  if (cfg?.route === "vision") return 1;
  return 0;
}

function sortTargets(entries: ManEntry[], munis: Map<string, MuniCfg>): ManEntry[] {
  return [...entries].sort((a, b) => {
    const ar = routeRank(munis.get(a.slug));
    const br = routeRank(munis.get(b.slug));
    if (br !== ar) return br - ar;
    const ag = a.crossval?.gridFound ? 1 : 0;
    const bg = b.crossval?.gridFound ? 1 : 0;
    if (bg !== ag) return bg - ag;
    const as = a.crossval?.sigZoneCodes ?? 0;
    const bs = b.crossval?.sigZoneCodes ?? 0;
    if (bs !== as) return bs - as;
    const au = a.unique_zone_codes ?? 0;
    const bu = b.unique_zone_codes ?? 0;
    if (bu !== au) return bu - au;
    return manifestPublished(a) - manifestPublished(b) || a.slug.localeCompare(b.slug);
  });
}

function fieldFromZone(z: ZoneNormsT, id: (typeof FLAT_FIELDS)[number]): NormFieldT | null {
  switch (id) {
    case "densite": return z.densite;
    case "hauteur_min": return z.hauteur_min;
    case "hauteur_max": return z.hauteur_max;
    case "frontage_min": return z.frontage_min;
    case "superficie_min": return z.superficie_min;
    case "marge_avant_min": return z.marges.avant_min;
    case "marge_laterale_min": return z.marges.laterale_min;
    case "marge_arriere_min": return z.marges.arriere_min;
  }
}

function isPublishedField(f: NormFieldT | null): f is NormFieldT {
  return !!f && f.value !== null && f.confidence >= PUBLISH_THRESHOLD;
}

function totalPublishedZones(zones: ZoneNormsT[]): number {
  let out = 0;
  for (const z of zones) {
    for (const id of FLAT_FIELDS) if (isPublishedField(fieldFromZone(z, id))) out++;
  }
  return out;
}

function totalPublishedRows(rows: Record<string, unknown>[]): number {
  let out = 0;
  for (const r of rows) {
    for (const id of FLAT_FIELDS) if (typeof r[`${id}_value`] === "number") out++;
  }
  return out;
}

function canonZone(code: string): string {
  return code.toUpperCase().replace(/\s+/g, "").replace(/^([A-Z]+)-?0*(\d)/, "$1-$2");
}

function currentFieldValues(rows: Record<string, unknown>[]): Map<string, Map<(typeof FLAT_FIELDS)[number], number>> {
  const out = new Map<string, Map<(typeof FLAT_FIELDS)[number], number>>();
  for (const r of rows) {
    const code = typeof r["zone_code"] === "string" ? r["zone_code"].trim() : "";
    if (!code) continue;
    const z = canonZone(code);
    const vals = out.get(z) ?? new Map<(typeof FLAT_FIELDS)[number], number>();
    for (const id of FLAT_FIELDS) {
      const v = r[`${id}_value`];
      if (typeof v === "number") vals.set(id, v);
    }
    out.set(z, vals);
  }
  return out;
}

function candidateFieldValues(zones: ZoneNormsT[]): Map<string, Map<(typeof FLAT_FIELDS)[number], number>> {
  const out = new Map<string, Map<(typeof FLAT_FIELDS)[number], number>>();
  for (const z of zones) {
    const vals = new Map<(typeof FLAT_FIELDS)[number], number>();
    for (const id of FLAT_FIELDS) {
      const f = fieldFromZone(z, id);
      if (isPublishedField(f)) vals.set(id, f.value as number);
    }
    out.set(canonZone(z.zone_code), vals);
  }
  return out;
}

function countFieldRegressions(
  before: Map<string, Map<(typeof FLAT_FIELDS)[number], number>>,
  after: Map<string, Map<(typeof FLAT_FIELDS)[number], number>>,
): number {
  let regressions = 0;
  for (const [zone, fields] of before) {
    const cand = after.get(zone);
    if (!cand) {
      regressions += fields.size;
      continue;
    }
    for (const [id, v] of fields) {
      const got = cand.get(id);
      if (got === undefined || Math.abs(got - v) > 1e-9) regressions++;
    }
  }
  return regressions;
}

function valueAppearsInRaw(f: NormFieldT): boolean {
  if (f.value === null) return true;
  const raw = (f.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
  const v = String(f.value);
  if (raw.includes(v)) return true;
  const vAlt = v.includes(".") ? v : `${v}.`;
  return raw.includes(vAlt) || raw.includes(v.replace(/\.0$/, ""));
}

function countFabricatedFields(zones: ZoneNormsT[]): number {
  let out = 0;
  for (const z of zones) {
    for (const id of FLAT_FIELDS) {
      const f = fieldFromZone(z, id);
      if (isPublishedField(f) && !valueAppearsInRaw(f)) out++;
    }
  }
  return out;
}

function mergeByZone(zones: ZoneNormsT[]): ZoneNormsT[] {
  const byZone = new Map<string, ZoneNormsT>();
  for (const zn of zones) {
    const k = canonZone(zn.zone_code);
    const prev = byZone.get(k);
    if (!prev || totalPublishedZones([zn]) > totalPublishedZones([prev])) byZone.set(k, zn);
  }
  return [...byZone.values()];
}

function pseudoZonesFromRows(rows: Record<string, unknown>[]): ZoneNormsT[] {
  const seen = new Set<string>();
  const out: ZoneNormsT[] = [];
  for (const r of rows) {
    const code = typeof r["zone_code"] === "string" ? r["zone_code"].trim() : "";
    if (!code) continue;
    const key = canonZone(code);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ zone_code: code } as ZoneNormsT);
  }
  return out;
}

function addUsage(a: CodexUsage, b: CodexUsage): CodexUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
  };
}

function parseCodexUsage(stdout: string): CodexUsage {
  const usage = { ...ZERO_USAGE };
  for (const line of stdout.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      const msg = JSON.parse(s) as { type?: string; usage?: Record<string, unknown> };
      if (msg.type !== "turn.completed" || !msg.usage) continue;
      usage.inputTokens += Number(msg.usage["input_tokens"] ?? 0);
      usage.cachedInputTokens += Number(msg.usage["cached_input_tokens"] ?? 0);
      usage.outputTokens += Number(msg.usage["output_tokens"] ?? 0);
      usage.reasoningOutputTokens += Number(msg.usage["reasoning_output_tokens"] ?? 0);
    } catch {
      /* ignore non-event lines */
    }
  }
  return usage;
}

function codexPrompt(page: number, slug: string): string {
  return [
    `Rattrapage OCR GPT-5.5 pour ${slug}, page ${page}.`,
    "N'utilise aucun outil, aucune commande shell et aucun fichier externe. Lis uniquement l'image jointe.",
    buildClaudePrompt(),
  ].join("\n\n");
}

async function runCodexVision(imagePath: string, page: number, slug: string): Promise<{
  extraction: ClaudeRawExtraction;
  usage: CodexUsage;
  latencyMs: number;
}> {
  const dir = await mkdtemp(join(tmpdir(), "gpt55-rattrapage-"));
  const schemaPath = join(dir, "schema.json");
  const outPath = join(dir, "out.json");
  await writeFile(schemaPath, JSON.stringify(RAW_SCHEMA), "utf8");
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-rules",
    "--skip-git-repo-check",
    "-C",
    tmpdir(),
    "-s",
    "read-only",
    "-c",
    'approval_policy="never"',
    "-c",
    `model_reasoning_effort="${GPT_EFFORT}"`,
    "-m",
    GPT_MODEL,
    "--output-schema",
    schemaPath,
    "-o",
    outPath,
    "--json",
    "-i",
    imagePath,
    "-",
  ];
  const t0 = Date.now();
  try {
    const { stdout } = await spawnCollect(CODEX_BIN, args, CODEX_TIMEOUT_MS, codexPrompt(page, slug));
    const content = await readFile(outPath, "utf8");
    return {
      extraction: parseClaudeContent(content),
      usage: parseCodexUsage(stdout),
      latencyMs: Date.now() - t0,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function spawnCollect(
  bin: string,
  args: string[],
  timeoutMs: number,
  stdinText: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${bin} exit=${code}: stdout=${stdout.slice(0, 800)} stderr=${stderr.slice(0, 500)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

async function readBaseline(s3: ReturnType<typeof s3Client>, slug: string): Promise<Baseline> {
  const rows = await readParquetRowsFromBuffer(
    await getBytes(s3, normsKey(slug)),
    [
      "zone_code",
      "_methode",
      ...FLAT_FIELDS.flatMap((f) => [`${f}_value`, `${f}_confidence`]),
    ],
  );
  const methods = [...new Set(rows.map((r) => r["_methode"]).filter((m): m is string => typeof m === "string"))];
  const currentMethod = methods.length === 1 ? methods[0]! : methods.join(",");
  const cross = await crossValidateZoneCodes(s3, slug, pseudoZonesFromRows(rows));
  const recall = cross.gridFound ? cross.overlap : new Set(rows.map((r) => String(r["zone_code"] ?? "")).filter(Boolean).map(canonZone)).size;
  return {
    rows,
    currentMethod,
    published: totalPublishedRows(rows),
    uniqueZoneCodes: new Set(rows.map((r) => String(r["zone_code"] ?? "")).filter(Boolean).map(canonZone)).size,
    cross,
    recall,
    fieldValues: currentFieldValues(rows),
  };
}

async function resolvePdf(
  s3: ReturnType<typeof s3Client>,
  slug: string,
  cfg: MuniCfg | undefined,
  base: ManEntry | undefined,
  localDir: string,
): Promise<{ path: string; cleanup: () => Promise<void>; sourceUrl: string }> {
  const localNested = join(localDir, slug, "grille.pdf");
  const localFlat = join(localDir, `${slug}.pdf`);
  if (existsSync(localNested)) return { path: localNested, cleanup: async () => undefined, sourceUrl: cfg?.sourceUrl ?? base?.source_url ?? "non-disponible" };
  if (existsSync(localFlat)) return { path: localFlat, cleanup: async () => undefined, sourceUrl: cfg?.sourceUrl ?? base?.source_url ?? "non-disponible" };

  const dir = await mkdtemp(join(tmpdir(), `gpt55-${slug}-`));
  const pdf = join(dir, "grille.pdf");
  const cleanup = (): Promise<void> => rm(dir, { recursive: true, force: true }).catch(() => undefined);
  const sourceUrl = cfg?.sourceUrl ?? base?.source_url ?? "non-disponible";

  if (cfg?.sourceUrl && cfg.first != null && cfg.last != null) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60_000);
      const resp = await fetch(cfg.sourceUrl, { signal: ctrl.signal, redirect: "follow" });
      clearTimeout(t);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 1024 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("not a PDF");
      await writeFile(pdf, buf);
      return { path: pdf, cleanup, sourceUrl };
    } catch {
      await cleanup();
      throw new Error(`download failed for calibrated sourceUrl`);
    }
  }

  const key = `${GRILLE_PREFIX}/${slug}.pdf`;
  if (await s3Exists(s3, key)) {
    await writeFile(pdf, await getBytes(s3, key));
    return { path: pdf, cleanup, sourceUrl };
  }
  await cleanup();
  throw new Error("no local, calibrated, or staged grille PDF");
}

async function runGpt(
  pdfPath: string,
  slug: string,
  first: number,
  last: number,
  sourceUrl: string,
): Promise<GptRun> {
  const zones: ZoneNormsT[] = [];
  const errors: string[] = [];
  let pagesRead = 0;
  let pagesFailed = 0;
  let latencyMs = 0;
  let usage = { ...ZERO_USAGE };

  for (let page = first; page <= last; page++) {
    let png: string | null = null;
    try {
      png = await renderPageToPng(pdfPath, page, DPI);
      const res = await runCodexVision(png, page, slug);
      usage = addUsage(usage, res.usage);
      latencyMs += res.latencyMs;
      zones.push(...mapClaudeExtractionToZones(res.extraction, page, {
        source_url: sourceUrl,
        snapshot: SNAPSHOT,
        methode: GPT_METHODE,
      }));
      pagesRead++;
    } catch (e) {
      pagesFailed++;
      errors.push(`page ${page}: ${(e instanceof Error ? e.message : String(e)).slice(0, 220)}`);
    } finally {
      if (png) {
        await rm(png.replace(/\/[^/]+$/, ""), { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
  return { zones: mergeByZone(zones), pagesRead, pagesFailed, latencyMs, usage, errors };
}

function recallFromCross(cross: CrossValResult): number {
  return cross.gridFound ? cross.overlap : cross.extractedZoneCodes;
}

function fmtMoney(v: number): string {
  return `$${v.toFixed(4)}`;
}

function fmtMs(v: number): string {
  return `${Math.round(v)}ms`;
}

function pageRange(cfg: MuniCfg | undefined, cap: number | null): { first: number; last: number; label: string } {
  const first = cfg?.first ?? 1;
  const naturalLast = cfg?.last ?? cfg?.pages ?? first;
  const last = cap && cap > 0 ? Math.min(naturalLast, first + cap - 1) : naturalLast;
  return { first, last, label: `${first}-${last}${last < naturalLast ? ` (cap ${cap}/${naturalLast - first + 1})` : ""}` };
}

async function writeReport(rows: Row[], args: Args): Promise<void> {
  const reOcr = rows.filter((r) => r.pagesRead > 0);
  const improved = rows.filter((r) => r.decision === "IMPROVED");
  const kept = rows.filter((r) => r.decision === "KEPT");
  const skipped = rows.filter((r) => r.decision === "SKIPPED");
  const errors = rows.filter((r) => r.decision === "ERROR");
  const before = reOcr.reduce((s, r) => s + r.beforePublished, 0);
  const after = reOcr.reduce((s, r) => s + r.afterPublished, 0);
  const gpt = reOcr.reduce((s, r) => s + r.gptPublished, 0);
  const usage = reOcr.reduce((u, r) => addUsage(u, r.usage), { ...ZERO_USAGE });
  const cost = reOcr.reduce((s, r) => s + r.costUsd, 0);

  const lines: string[] = [];
  lines.push("# NORMES RATTRAPAGE B — GPT-5.5 keep-best");
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()} on branch shard B (n-z), model \`${GPT_MODEL}\`, effort \`${GPT_EFFORT}\`, dpi ${DPI}._`);
  lines.push("");
  lines.push("## Totaux");
  lines.push("");
  lines.push(`- Villes ciblees/inspectees: ${rows.length}`);
  lines.push(`- Villes re-OCR'd: ${reOcr.length}`);
  lines.push(`- Improved/deposited: ${improved.length}`);
  lines.push(`- Kept existing: ${kept.length}`);
  lines.push(`- Skipped: ${skipped.length}`);
  lines.push(`- Errors: ${errors.length}`);
  lines.push(`- Quality delta (published fields, processed villes): before=${before}, GPT=${gpt}, after=${after}, net=${after - before}`);
  lines.push(`- Fabricated published fields accepted: 0`);
  lines.push(`- Cost: ${fmtMoney(cost)} (Codex CLI/subscription path); tokens in/out/reason=${usage.inputTokens}/${usage.outputTokens}/${usage.reasoningOutputTokens}`);
  lines.push(`- Apply=${args.apply}; manifest writes=${args.noManifest ? "NO (parquet-only)" : "YES"}`);
  lines.push("");
  lines.push("## Villes");
  lines.push("");
  lines.push("| Ville | Route | Pages | Decision | Pub before | Pub GPT | Pub after | Recall before | Recall GPT | Fab | Field regressions | Pages read/fail | Cost | Note |");
  lines.push("|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const r of rows) {
    lines.push(`| ${r.slug} | ${r.route} | ${r.pages} | ${r.decision} | ${r.beforePublished} | ${r.gptPublished} | ${r.afterPublished} | ${r.beforeRecall} | ${r.gptRecall} | ${r.fabricatedFields} | ${r.fieldRegressions} | ${r.pagesRead}/${r.pagesFailed} | ${fmtMoney(r.costUsd)} | ${r.note.replace(/\|/g, "/")} |`);
  }
  lines.push("");

  await mkdir(dirname(REPORT), { recursive: true });
  await writeFile(REPORT, lines.join("\n") + "\n", "utf8");
  await writeFile(
    RAW_REPORT,
    JSON.stringify({ generated_at: new Date().toISOString(), model: GPT_MODEL, effort: GPT_EFFORT, dpi: DPI, args, rows }, null, 2) + "\n",
    "utf8",
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.noManifest) {
    throw new Error("MANIFEST-SAFE violation: apply mode requires --no-manifest");
  }

  const s3 = s3Client();
  const munis = loadMunis();
  const man = JSON.parse((await getBytes(s3, "registry/qc-zonage-norms/manifest.json")).toString("utf8")) as { entries: ManEntry[] };
  const bySlug = new Map(man.entries.map((e) => [e.slug, e]));
  let targets = args.slugs.length
    ? args.slugs.map((s) => bySlug.get(s)).filter((e): e is ManEntry => !!e)
    : man.entries.filter((e) => e.methode === "mistral-vision");
  if (args.shardB) targets = targets.filter((e) => /^[n-z]/.test(e.slug));
  targets = sortTargets(targets, munis);
  if (args.limit && args.limit > 0) targets = targets.slice(0, args.limit);
  console.error(`[gpt55-rattrapage] targets=${targets.length} apply=${args.apply} noManifest=${args.noManifest}`);

  const rows: Row[] = [];
  for (const base of targets) {
    const cfg = munis.get(base.slug);
    const range = pageRange(cfg, args.pageCap);
    const row: Row = {
      slug: base.slug,
      route: cfg?.route ?? "unknown",
      pages: range.label,
      decision: "ERROR",
      note: "",
      currentMethod: "",
      beforePublished: 0,
      gptPublished: 0,
      afterPublished: 0,
      beforeRecall: 0,
      gptRecall: 0,
      afterRecall: 0,
      fabricatedFields: 0,
      fieldRegressions: 0,
      pagesRead: 0,
      pagesFailed: 0,
      latencyMs: 0,
      costUsd: 0,
      usage: { ...ZERO_USAGE },
    };

    let pdf: { path: string; cleanup: () => Promise<void>; sourceUrl: string } | null = null;
    try {
      const baseline = await readBaseline(s3, base.slug);
      row.currentMethod = baseline.currentMethod;
      row.beforePublished = baseline.published;
      row.afterPublished = baseline.published;
      row.beforeRecall = baseline.recall;
      row.afterRecall = baseline.recall;

      if (baseline.currentMethod !== "mistral-vision") {
        row.decision = "SKIPPED";
        row.note = `current parquet method is ${baseline.currentMethod || "unknown"}, not mistral-vision`;
        rows.push(row);
        console.error(`[${base.slug}] SKIPPED ${row.note}`);
        continue;
      }

      pdf = await resolvePdf(s3, base.slug, cfg, base, args.localDir);
      const gpt = await runGpt(pdf.path, base.slug, range.first, range.last, pdf.sourceUrl);
      row.pagesRead = gpt.pagesRead;
      row.pagesFailed = gpt.pagesFailed;
      row.latencyMs = gpt.latencyMs;
      row.usage = gpt.usage;
      row.costUsd = 0;
      const cross = await crossValidateZoneCodes(s3, base.slug, gpt.zones);
      row.gptPublished = totalPublishedZones(gpt.zones);
      row.gptRecall = recallFromCross(cross);
      row.fabricatedFields = countFabricatedFields(gpt.zones);
      row.fieldRegressions = countFieldRegressions(baseline.fieldValues, candidateFieldValues(gpt.zones));

      const recallOk = row.gptRecall >= row.beforeRecall;
      const payloadGain = row.gptPublished > row.beforePublished;
      const noFieldRegression = row.fieldRegressions === 0;
      const noFabrication = row.fabricatedFields === 0;
      const enoughZones = gpt.zones.length >= 3;
      const improved = recallOk && payloadGain && noFieldRegression && noFabrication && enoughZones;

      if (improved) {
        row.decision = "IMPROVED";
        row.afterPublished = row.gptPublished;
        row.afterRecall = row.gptRecall;
        row.note = `published ${row.beforePublished}->${row.gptPublished}, recall ${row.beforeRecall}->${row.gptRecall}`;
        if (args.apply) {
          await depositParquetOnly({
            s3,
            slug: base.slug,
            zones: gpt.zones,
            meta: {
              source_url: pdf.sourceUrl,
              ...(base.reglement ? { reglement: base.reglement } : cfg?.reglement ? { reglement: String(cfg.reglement) } : {}),
              methode: GPT_METHODE,
              snapshot: SNAPSHOT,
            },
            crossval: cross,
          });
        }
      } else {
        row.decision = "KEPT";
        const reasons = [
          !recallOk ? `recall would drop ${row.beforeRecall}->${row.gptRecall}` : "",
          !payloadGain ? `published not better ${row.beforePublished}->${row.gptPublished}` : "",
          !noFieldRegression ? `field regressions=${row.fieldRegressions}` : "",
          !noFabrication ? `fabricated=${row.fabricatedFields}` : "",
          !enoughZones ? `below 3-zone gate (${gpt.zones.length})` : "",
          gpt.errors.length ? `errors=${gpt.errors.slice(0, 2).join("; ")}` : "",
        ].filter(Boolean);
        row.note = reasons.join("; ");
      }
    } catch (e) {
      row.decision = "ERROR";
      row.note = (e instanceof Error ? e.message : String(e)).slice(0, 240);
    } finally {
      if (pdf) await pdf.cleanup();
    }
    rows.push(row);
    console.error(
      `[${base.slug}] ${row.decision} method=${row.currentMethod} pub ${row.beforePublished}->${row.gptPublished}->${row.afterPublished} ` +
      `recall ${row.beforeRecall}->${row.gptRecall}->${row.afterRecall} fab=${row.fabricatedFields} regress=${row.fieldRegressions} ` +
      `pages=${row.pagesRead}/${row.pagesFailed} ${fmtMs(row.latencyMs)} :: ${row.note}`,
    );
  }

  await writeReport(rows, args);
  console.log(JSON.stringify({
    apply: args.apply,
    noManifest: args.noManifest,
    targets: rows.length,
    reOcrd: rows.filter((r) => r.pagesRead > 0).length,
    improved: rows.filter((r) => r.decision === "IMPROVED").length,
    kept: rows.filter((r) => r.decision === "KEPT").length,
    skipped: rows.filter((r) => r.decision === "SKIPPED").length,
    errors: rows.filter((r) => r.decision === "ERROR").length,
    report: REPORT,
    rawReport: RAW_REPORT,
  }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
