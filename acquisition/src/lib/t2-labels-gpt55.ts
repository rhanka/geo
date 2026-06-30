/**
 * t2-labels-gpt55.ts -- GPT-5.5 positioned OCR for T2 zoning plans.
 *
 * The model is used only to read visible map labels and their positions from a
 * rasterized map crop. Codes are emitted only after dictionary validation using
 * the same anti-invention snap guard as the Pointe-Claire OCR path.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GeoRef } from "./t1-georef.js";
import { looksLikeZoneCode, splitCode, kindForPrefix, type ExtractLabelsResult } from "./t1-labels.js";
import type { CodePoint } from "./t1-zones.js";

export interface Gpt55LabelOptions {
  dpi?: number;
  page?: number;
  region?: [number, number, number, number];
  workDir?: string;
  bin?: string;
  model?: string;
  effort?: string;
  timeoutMs?: number;
  codexHome?: string;
}

export interface Gpt55Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface Gpt55LabelResult extends ExtractLabelsResult {
  ocr_engine: "gpt-5.5-vision";
  dict_size: number;
  image_path: string;
  n_model_labels: number;
  n_exact: number;
  n_distance1: number;
  n_canonical: number;
  n_validated: number;
  n_rejected: number;
  n_distinct: number;
  snap_rate_pct: number;
  reject_samples: string[];
  rejectSamples: string[];
  usage: Gpt55Usage;
  latency_ms: number;
}

interface RawModelLabel {
  code: string;
  x: number;
  y: number;
}

interface RawModelOutput {
  labels: RawModelLabel[];
}

export interface Gpt55LabelRead {
  text: string;
  x: number;
  y: number;
}

export interface Gpt55ValidatedLabels extends ExtractLabelsResult {
  nValidated: number;
  nExact: number;
  nCanonical: number;
  nRejected: number;
  nDistinct: number;
  rejectSamples: string[];
}

const LABEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          x: { type: "number", minimum: 0, maximum: 1 },
          y: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["code", "x", "y"],
      },
    },
  },
  required: ["labels"],
} as const;

function emptyUsage(): Gpt55Usage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function parseUsage(stdout: string): Gpt55Usage {
  const usage = emptyUsage();
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
      /* ignore non-event JSON */
    }
  }
  return usage;
}

function renderRegion(
  pdfPath: string,
  page: number,
  dpi: number,
  region: [number, number, number, number],
  workDir: string,
): string {
  const scale = dpi / 72;
  const [rx0, ry0, rx1, ry1] = region;
  const x = Math.max(0, Math.round(rx0 * scale));
  const y = Math.max(0, Math.round(ry0 * scale));
  const w = Math.max(1, Math.round((rx1 - rx0) * scale));
  const h = Math.max(1, Math.round((ry1 - ry0) * scale));
  const base = join(workDir, `gpt55-p${page}-d${dpi}-${x}-${y}-${w}-${h}`);
  const png = `${base}.png`;
  if (existsSync(png)) return png;
  const ret = spawnSync("pdftoppm", [
    "-singlefile",
    "-r",
    String(dpi),
    "-f",
    String(page),
    "-l",
    String(page),
    "-x",
    String(x),
    "-y",
    String(y),
    "-W",
    String(w),
    "-H",
    String(h),
    "-png",
    pdfPath,
    base,
  ]);
  if (ret.status !== 0 || !existsSync(png)) {
    const err = ret.error ? ` (${ret.error.message})` : "";
    throw new Error(`pdftoppm failed for GPT-5.5 crop ${x},${y} ${w}x${h}${err}`);
  }
  return png;
}

function prompt(slug: string, dict: string[]): string {
  const codes = dict.join(", ");
  return [
    `Extract zoning map labels for ${slug}.`,
    "Use only the attached image. Do not use tools, shell commands, URLs, memory, or external files.",
    "Return only labels that are visibly printed inside the map frame as spatial zone labels.",
    "Do not return legend text, title-block text, street names, scale text, revision tables, or a non-spatial code list.",
    "A valid zone label must contain at least one letter and at least one digit.",
    "For every label, return the verbatim visible code and the label centre as x,y normalized from 0 to 1 in this image crop, with x from left to right and y from top to bottom.",
    "If a code or position is uncertain, skip it. Never infer missing labels and never place a code from the dictionary unless it is visible on the map.",
    `Official code dictionary for validation context: ${codes}`,
  ].join("\n\n");
}

function spawnCollect(
  bin: string,
  args: string[],
  timeoutMs: number,
  stdinText: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
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

async function runGpt55(
  imagePath: string,
  slug: string,
  dict: string[],
  opts: Gpt55LabelOptions,
): Promise<{ raw: RawModelOutput; usage: Gpt55Usage; latencyMs: number }> {
  const dir = await mkdtemp(join(tmpdir(), "t2-labels-gpt55-"));
  const schemaPath = join(dir, "schema.json");
  const outPath = join(dir, "out.json");
  await writeFile(schemaPath, JSON.stringify(LABEL_SCHEMA), "utf8");

  const bin = opts.bin ?? process.env["CODEX_BIN"] ?? "codex";
  const model = opts.model ?? process.env["GPT55_MODEL"] ?? "gpt-5.5";
  const effort = opts.effort ?? process.env["GPT55_EFFORT"] ?? "xhigh";
  const timeoutMs = opts.timeoutMs ?? Number(process.env["GPT55_TIMEOUT_MS"] ?? "240000");
  const codexHome = opts.codexHome ?? process.env["GPT55_CODEX_HOME"];
  const env = { ...process.env, ...(codexHome ? { CODEX_HOME: codexHome } : {}) };
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
    `model_reasoning_effort="${effort}"`,
    "-m",
    model,
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
    const { stdout } = await spawnCollect(bin, args, timeoutMs, prompt(slug, dict), env);
    const raw = JSON.parse(await readFile(outPath, "utf8")) as RawModelOutput;
    return { raw, usage: parseUsage(stdout), latencyMs: Date.now() - t0 };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function normalizeForSnap(text: string): string {
  return text.replace(/[^A-Za-z0-9.]/g, "").toLowerCase();
}

function reject(rejects: Map<string, number>, reason: string): void {
  rejects.set(reason, (rejects.get(reason) ?? 0) + 1);
}

export function validateGpt55LabelReads(
  reads: Gpt55LabelRead[],
  geo: GeoRef,
  validCodes: string[],
  opts: { region?: [number, number, number, number] } = {},
): Gpt55ValidatedLabels {
  const region = opts.region ?? [0, 0, geo.pageW, geo.pageH];
  const [rx0, ry0, rx1, ry1] = region;
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  const byCanon = new Map<string, string[]>();
  for (const code of validCodes) {
    const c = normalizeForSnap(String(code));
    if (!c) continue;
    const arr = byCanon.get(c) ?? [];
    arr.push(String(code));
    byCanon.set(c, arr);
  }

  let nCodeLike = 0;
  let nOutside = 0;
  let nExact = 0;
  let nCanonical = 0;
  let nRejected = 0;
  const rejects = new Map<string, number>();
  const rawPoints: Array<{ code: string; lon: number; lat: number }> = [];
  for (const read of reads) {
    const x = Number(read.x);
    const y = Number(read.y);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
      nOutside++;
      reject(rejects, "outside-image");
      continue;
    }
    const cleaned = String(read.text ?? "").replace(/[^A-Za-z0-9.\- ]/g, "").trim();
    if (!looksLikeZoneCode(cleaned)) {
      nRejected++;
      reject(rejects, "not-code-like");
      continue;
    }
    nCodeLike++;
    const candidates = byCanon.get(normalizeForSnap(cleaned)) ?? [];
    if (candidates.length === 0) {
      nRejected++;
      reject(rejects, "not-in-dictionary");
      continue;
    }
    if (candidates.length > 1) {
      nRejected++;
      reject(rejects, "ambiguous-dict-code");
      continue;
    }
    const code = candidates[0]!;
    if (cleaned === code) nExact++;
    else nCanonical++;
    const pageX = rx0 + x * rw;
    const pageYTop = ry0 + y * rh;
    const [lon, lat] = geo.topLeftToLonLat(pageX, pageYTop);
    rawPoints.push({ code, lon, lat });
  }

  const M = 111320;
  const kept: typeof rawPoints = [];
  for (const p of rawPoints) {
    const dup = kept.find(
      (q) =>
        q.code === p.code &&
        Math.hypot((q.lon - p.lon) * M * Math.cos((p.lat * Math.PI) / 180), (q.lat - p.lat) * M) < 35,
    );
    if (!dup) kept.push(p);
  }
  const codePoints: CodePoint[] = kept.map((p) => {
    const { prefix } = splitCode(p.code);
    return { code: p.code, prefix, kind: kindForPrefix(prefix), lon: p.lon, lat: p.lat };
  });
  return {
    codePoints,
    nWords: reads.length,
    nCodeLike,
    nInsideFrame: codePoints.length,
    rejectedOutsideFrame: nOutside,
    nValidated: nExact + nCanonical,
    nExact,
    nCanonical,
    nRejected,
    nDistinct: new Set(codePoints.map((c) => c.code)).size,
    rejectSamples: [...rejects.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k}:${v}`),
  };
}

export async function extractLabelsGpt55(
  pdfPath: string,
  geo: GeoRef,
  validCodes: string[],
  slug: string,
  opts: Gpt55LabelOptions = {},
): Promise<Gpt55LabelResult> {
  const dpi = opts.dpi ?? 140;
  const page = opts.page ?? 1;
  const region = opts.region ?? [0, 0, geo.pageW, geo.pageH];
  const workDir =
    opts.workDir ?? join(tmpdir(), `t2gpt55-${createHash("md5").update(`${pdfPath}:${slug}`).digest("hex").slice(0, 8)}`);
  await mkdir(workDir, { recursive: true });

  const dict = [...validCodes];
  const imagePath = renderRegion(pdfPath, page, dpi, region, workDir);
  const { raw, usage, latencyMs } = await runGpt55(imagePath, slug, dict, opts);
  const validated = validateGpt55LabelReads(
    (raw.labels ?? []).map((l) => ({ text: l.code, x: l.x, y: l.y })),
    geo,
    dict,
    { region },
  );
  const snapRate = validated.nCodeLike > 0 ? (100 * validated.nValidated) / validated.nCodeLike : 0;
  return {
    ...validated,
    ocr_engine: "gpt-5.5-vision",
    dict_size: dict.length,
    image_path: imagePath,
    n_model_labels: raw.labels?.length ?? 0,
    n_exact: validated.nExact,
    n_distance1: 0,
    n_canonical: validated.nCanonical,
    n_validated: validated.nValidated,
    n_rejected: validated.nRejected,
    n_distinct: validated.nDistinct,
    snap_rate_pct: Number(snapRate.toFixed(1)),
    reject_samples: validated.rejectSamples,
    rejectSamples: validated.rejectSamples,
    usage,
    latency_ms: latencyMs,
  };
}
