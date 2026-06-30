/**
 * t2-labels-gpt55.ts -- dictionary-validated GPT-5.5 positioned labels for T2
 * zoning plans whose map labels are raster/glyph-only or contaminated in the
 * selectable text layer.
 *
 * Anti-invention contract:
 *   - GPT reads only a rendered crop of the map and returns visible label text
 *     plus normalized crop coordinates.
 *   - We do not trust a returned code until it matches a UNIQUE authoritative
 *     by-law dictionary code after only light case/space/hyphen normalization.
 *   - Ambiguous, illegible, off-frame, legend/table/title/inset, and dictionary
 *     misses are dropped. The served geometry remains real cadastre downstream.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GeoRef } from "./t1-georef.js";
import {
  kindForPrefix,
  looksLikeZoneCode,
  normalizeZoneCodeText,
  splitCode,
  type ExtractLabelsResult,
  type LabelRegionFrac,
} from "./t1-labels.js";
import type { CodePoint } from "./t1-zones.js";

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
          text: { type: "string" },
          x: { type: "number", minimum: 0, maximum: 1 },
          y: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["text", "x", "y"],
      },
    },
  },
  required: ["labels"],
} as const;

export interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface Gpt55CliOptions {
  bin?: string;
  model?: string;
  effort?: string;
  timeoutMs?: number;
  codexHome?: string;
}

export interface Gpt55LabelRead {
  /** Visible text, copied from the map label. */
  text: string;
  /** Label center, fraction of rendered crop width, origin top-left. */
  x: number;
  /** Label center, fraction of rendered crop height, origin top-left. */
  y: number;
}

export interface Gpt55LabelOptions {
  dpi?: number;
  page?: number;
  slug?: string;
  /** Map crop in top-left page points: [x0,y0,x1,y1]. Defaults to geo.bbox. */
  region?: [number, number, number, number];
  /** Page-fraction masks for inset maps, legends, revision tables, etc. */
  excludeRegions?: LabelRegionFrac[];
  /** Authoritative prefix -> kind override, keyed by lower-case prefix. */
  kindByPrefix?: Record<string, string>;
  workDir?: string;
  cli?: Gpt55CliOptions;
  /** Optional path to keep the raw GPT label JSON for audit. */
  rawOut?: string;
}

export interface Gpt55LabelResult extends ExtractLabelsResult {
  nReads: number;
  nValidated: number;
  nExact: number;
  nCanonical: number;
  nRejected: number;
  nDistinct: number;
  rejectSamples: string[];
  usage: CodexUsage;
  latencyMs: number;
  crop: [number, number, number, number];
}

interface RenderedCrop {
  png: string;
  crop: [number, number, number, number];
}

function emptyUsage(): CodexUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function parseCodexUsage(stdout: string): CodexUsage {
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

function cropFromGeoBbox(geo: GeoRef): [number, number, number, number] {
  const [rx0, ry0, rx1, ry1] = geo.bbox;
  const x0 = Math.max(0, Math.min(rx0, rx1));
  const x1 = Math.min(geo.pageW, Math.max(rx0, rx1));
  const yTop0 = Math.max(0, geo.pageH - Math.max(ry0, ry1));
  const yTop1 = Math.min(geo.pageH, geo.pageH - Math.min(ry0, ry1));
  return [x0, yTop0, x1, yTop1];
}

function normalizeCrop(crop: [number, number, number, number], geo: GeoRef): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(crop[0], crop[2]));
  const x1 = Math.min(geo.pageW, Math.max(crop[0], crop[2]));
  const y0 = Math.max(0, Math.min(crop[1], crop[3]));
  const y1 = Math.min(geo.pageH, Math.max(crop[1], crop[3]));
  if (x1 - x0 <= 1 || y1 - y0 <= 1) throw new Error(`invalid GPT label crop ${crop.join(",")}`);
  return [x0, y0, x1, y1];
}

async function renderCropToPng(
  pdfPath: string,
  geo: GeoRef,
  opts: Gpt55LabelOptions,
): Promise<RenderedCrop> {
  const dpi = opts.dpi ?? 180;
  const page = opts.page ?? 1;
  const scale = dpi / 72;
  const crop = normalizeCrop(opts.region ?? cropFromGeoBbox(geo), geo);
  const workDir =
    opts.workDir ??
    join(tmpdir(), `t2gpt55-${createHash("md5").update(`${pdfPath}:${page}:${crop.join(",")}`).digest("hex").slice(0, 8)}`);
  await mkdir(workDir, { recursive: true });
  const base = join(workDir, `page-${page}-r${dpi}`);
  const png = `${base}.png`;
  if (!existsSync(png)) {
    const x = Math.round(crop[0] * scale);
    const y = Math.round(crop[1] * scale);
    const w = Math.max(2, Math.round((crop[2] - crop[0]) * scale));
    const h = Math.max(2, Math.round((crop[3] - crop[1]) * scale));
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
      const stderr = ret.stderr?.toString().trim();
      throw new Error(`pdftoppm failed for GPT label crop${stderr ? `: ${stderr.slice(0, 300)}` : ""}`);
    }
  }
  return { png, crop };
}

function prompt(slug: string | undefined, page: number): string {
  return [
    `GPT-5.5 OCR pour etiquettes de carte de zonage${slug ? `: ${slug}` : ""}, page ${page}.`,
    "N'utilise aucun outil, aucune commande shell et aucun fichier externe. Lis uniquement l'image jointe.",
    "",
    "Lis les ETIQUETTES DE ZONE visibles dans cette image de carte municipale.",
    "Retourne seulement les codes de zone imprimes sur la carte principale.",
    "",
    "Regles absolues anti-invention:",
    "- Recopie le texte visible VERBATIM: lettres, chiffres, traits d'union ou espaces tels qu'imprimes.",
    "- N'ajoute jamais un code attendu, une sequence, un prefixe ou un suffixe qui n'est pas clairement visible.",
    "- Si un libelle est partiel, flou, ambigu, coupe par le bord, ou si tu hesites, omets-le.",
    "- Exclure les noms de rues, numeros de lots, echelles, titres, legendes, tableaux de revision, grilles de reglement, notes, noms de ville et cartes en encart.",
    "- Si le meme code apparait a plusieurs endroits de la carte principale, retourne chaque occurrence visible une seule fois.",
    "- x et y sont le CENTRE du libelle dans l'image jointe, fractions 0..1, origine en haut a gauche.",
    "",
    'Reponds strictement en JSON: {"labels":[{"text":"H-101","x":0.5,"y":0.5}]}',
  ].join("\n");
}

export function parseGpt55LabelContent(content: string): Gpt55LabelRead[] {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const obj = JSON.parse(cleaned) as { labels?: unknown };
  const labels = Array.isArray(obj.labels) ? obj.labels : [];
  const out: Gpt55LabelRead[] = [];
  for (const raw of labels) {
    const r = raw as Record<string, unknown>;
    const text = typeof r["text"] === "string" ? r["text"].trim() : "";
    const x = Number(r["x"]);
    const y = Number(r["y"]);
    if (!text || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ text, x, y });
  }
  return out;
}

async function runGpt55LabelVision(
  imagePath: string,
  opts: Gpt55LabelOptions,
): Promise<{ labels: Gpt55LabelRead[]; usage: CodexUsage; latencyMs: number }> {
  const dir = await mkdtemp(join(tmpdir(), "t2gpt55-labels-"));
  const schemaPath = join(dir, "schema.json");
  const outPath = join(dir, "out.json");
  await writeFile(schemaPath, JSON.stringify(LABEL_SCHEMA), "utf8");
  const bin = opts.cli?.bin ?? process.env["CODEX_BIN"] ?? "codex";
  const model = opts.cli?.model ?? process.env["GPT55_MODEL"] ?? "gpt-5.5";
  const effort = opts.cli?.effort ?? process.env["GPT55_EFFORT"] ?? "xhigh";
  const timeoutMs = opts.cli?.timeoutMs ?? Number(process.env["GPT55_TIMEOUT_MS"] ?? "240000");
  const env = {
    ...process.env,
    ...(opts.cli?.codexHome ?? process.env["GPT55_CODEX_HOME"]
      ? { CODEX_HOME: opts.cli?.codexHome ?? process.env["GPT55_CODEX_HOME"] }
      : {}),
  };
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
    const { stdout } = await spawnCollect(bin, args, timeoutMs, prompt(opts.slug, opts.page ?? 1), env);
    const content = await readFile(outPath, "utf8");
    if (opts.rawOut) await writeFile(opts.rawOut, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    return {
      labels: parseGpt55LabelContent(content),
      usage: parseCodexUsage(stdout),
      latencyMs: Date.now() - t0,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function canonicalCodeKey(text: string): string {
  return text
    .trim()
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

function codeLikeText(text: string): string {
  return normalizeZoneCodeText(text.replace(/[–—−]/g, "-").replace(/[^A-Za-z0-9.\-\s]/g, ""));
}

function inExcludedRegion(px: number, pyTop: number, geo: GeoRef, regions: LabelRegionFrac[] | undefined): boolean {
  if (!regions?.length) return false;
  return regions.some((r) => {
    const x0 = Math.min(r.fx0, r.fx1) * geo.pageW;
    const x1 = Math.max(r.fx0, r.fx1) * geo.pageW;
    const y0 = Math.min(r.fy0, r.fy1) * geo.pageH;
    const y1 = Math.max(r.fy0, r.fy1) * geo.pageH;
    return px >= x0 && px <= x1 && pyTop >= y0 && pyTop <= y1;
  });
}

function rejectSample(map: Map<string, number>, reason: string): void {
  map.set(reason, (map.get(reason) ?? 0) + 1);
}

export function validateGpt55LabelReads(
  reads: Gpt55LabelRead[],
  geo: GeoRef,
  validCodes: string[],
  opts: Pick<Gpt55LabelOptions, "region" | "excludeRegions" | "kindByPrefix"> = {},
): Omit<Gpt55LabelResult, "usage" | "latencyMs"> {
  const crop = normalizeCrop(opts.region ?? cropFromGeoBbox(geo), geo);
  const dictByKey = new Map<string, string[]>();
  for (const code of validCodes) {
    const key = canonicalCodeKey(code);
    if (!key) continue;
    const arr = dictByKey.get(key) ?? [];
    arr.push(code);
    dictByKey.set(key, arr);
  }

  const [rx0, ry0, rx1, ry1] = geo.bbox;
  const bx0 = Math.min(rx0, rx1);
  const bx1 = Math.max(rx0, rx1);
  const by0 = Math.min(ry0, ry1);
  const by1 = Math.max(ry0, ry1);
  const padX = (bx1 - bx0) * 0.05;
  const padY = (by1 - by0) * 0.05;

  const raw: CodePoint[] = [];
  const rejects = new Map<string, number>();
  let nCodeLike = 0;
  let nExact = 0;
  let nCanonical = 0;
  let rejectedOutside = 0;
  for (const r of reads) {
    if (r.x < 0 || r.x > 1 || r.y < 0 || r.y > 1) {
      rejectSample(rejects, "bad-position");
      continue;
    }
    const candidate = codeLikeText(r.text);
    if (!looksLikeZoneCode(candidate)) {
      rejectSample(rejects, "not-code-like");
      continue;
    }
    nCodeLike++;
    const px = crop[0] + r.x * (crop[2] - crop[0]);
    const pyTop = crop[1] + r.y * (crop[3] - crop[1]);
    const pyUser = geo.pageH - pyTop;
    if (
      px < bx0 - padX ||
      px > bx1 + padX ||
      pyUser < by0 - padY ||
      pyUser > by1 + padY ||
      inExcludedRegion(px, pyTop, geo, opts.excludeRegions)
    ) {
      rejectedOutside++;
      rejectSample(rejects, "outside-map-frame");
      continue;
    }
    const key = canonicalCodeKey(candidate);
    const dictMatches = dictByKey.get(key) ?? [];
    if (dictMatches.length !== 1) {
      rejectSample(rejects, dictMatches.length > 1 ? "ambiguous-dict-code" : "not-in-dictionary");
      continue;
    }
    const code = dictMatches[0]!;
    if (candidate.toUpperCase() === code.toUpperCase()) nExact++;
    else nCanonical++;
    const [lon, lat] = geo.topLeftToLonLat(px, pyTop);
    const { prefix } = splitCode(code);
    const kind = opts.kindByPrefix?.[prefix.toLowerCase()] ?? kindForPrefix(prefix);
    raw.push({ code, prefix, kind, lon, lat });
  }

  const M = 111320;
  const codePoints: CodePoint[] = [];
  for (const p of raw) {
    const dup = codePoints.find(
      (q) =>
        q.code === p.code &&
        Math.hypot((q.lon - p.lon) * M * Math.cos((p.lat * Math.PI) / 180), (q.lat - p.lat) * M) < 35,
    );
    if (!dup) codePoints.push(p);
  }
  const distinct = new Set(codePoints.map((c) => c.code));
  const nValidated = nExact + nCanonical;
  return {
    codePoints,
    nWords: reads.length,
    nReads: reads.length,
    nCodeLike,
    nInsideFrame: codePoints.length,
    rejectedOutsideFrame: rejectedOutside,
    nValidated,
    nExact,
    nCanonical,
    nRejected: reads.length - nValidated,
    nDistinct: distinct.size,
    rejectSamples: [...rejects.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k}:${v}`),
    crop,
  };
}

export async function extractLabelsGpt55(
  pdfPath: string,
  geo: GeoRef,
  validCodes: string[],
  opts: Gpt55LabelOptions = {},
): Promise<Gpt55LabelResult> {
  const rendered = await renderCropToPng(pdfPath, geo, opts);
  const res = await runGpt55LabelVision(rendered.png, { ...opts, region: rendered.crop });
  const validated = validateGpt55LabelReads(res.labels, geo, validCodes, {
    ...opts,
    region: rendered.crop,
  });
  return {
    ...validated,
    usage: res.usage,
    latencyMs: res.latencyMs,
  };
}
