/**
 * GPT-5.5 vision path for grille des normes extraction.
 *
 * This mirrors the bench path in acquisition/src/bench/run-gpt55-ocr-bench.ts:
 * render a PDF page to PNG, call `codex exec -m gpt-5.5` with a strict output
 * schema, parse the raw `{zones:[...]}` JSON, then map every verbatim-or-null
 * cell through `mapClaudeExtractionToZones(...)`. That mapper calls the frozen
 * `buildVisionField` guard; no norm parsing or value normalisation lives here.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildClaudePrompt,
  mapClaudeExtractionToZones,
  parseClaudeContent,
  renderPageToPng,
  type ClaudeRawExtraction,
} from "./grille-claude-cli.js";
import type { ZoneNormsT } from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

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

export const GPT55_METHODE = "codex/gpt-5.5-vision";
export const GPT55_DEFAULT_MODEL = "gpt-5.5";
export const GPT55_DEFAULT_EFFORT = "xhigh";

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

export interface Gpt55PageResult {
  extraction: ClaudeRawExtraction;
  usage: CodexUsage;
  latencyMs: number;
  stderr: string;
}

export interface Gpt55ExtractOptions {
  source_url: string;
  snapshot: string;
  methode?: string;
  dpi?: number;
  cli?: Gpt55CliOptions;
}

export interface Gpt55PathResult {
  zones: ZoneNormsT[];
  pagesRead: number;
  pagesFailed: number;
  durationMs: number;
  usage: CodexUsage;
  reasons: string[];
}

function emptyUsage(): CodexUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

export function addCodexUsage(a: CodexUsage, b: CodexUsage): CodexUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
  };
}

function codexPrompt(page: number, slug?: string): string {
  return [
    `OCR GPT-5.5 pour ${slug ?? "ville"}, page ${page}.`,
    "N'utilise aucun outil, aucune commande shell et aucun fichier externe. Lis uniquement l'image jointe.",
    buildClaudePrompt(),
  ].join("\n\n");
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

export async function runGpt55Vision(
  imagePath: string,
  page: number,
  slug: string,
  opts: Gpt55CliOptions = {},
): Promise<Gpt55PageResult> {
  const dir = await mkdtemp(join(tmpdir(), "gpt55-ocr-"));
  const schemaPath = join(dir, "schema.json");
  const outPath = join(dir, "out.json");
  await writeFile(schemaPath, JSON.stringify(RAW_SCHEMA), "utf8");

  const bin = opts.bin ?? process.env["CODEX_BIN"] ?? "codex";
  const model = opts.model ?? process.env["GPT55_MODEL"] ?? GPT55_DEFAULT_MODEL;
  const effort = opts.effort ?? process.env["GPT55_EFFORT"] ?? GPT55_DEFAULT_EFFORT;
  const timeoutMs = opts.timeoutMs ?? Number(process.env["GPT55_TIMEOUT_MS"] ?? "240000");
  const env = {
    ...process.env,
    ...(opts.codexHome ?? process.env["GPT55_CODEX_HOME"]
      ? { CODEX_HOME: opts.codexHome ?? process.env["GPT55_CODEX_HOME"] }
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
    const { stdout, stderr } = await spawnCollect(bin, args, timeoutMs, codexPrompt(page, slug), env);
    const content = await readFile(outPath, "utf8");
    return {
      extraction: parseClaudeContent(content),
      usage: parseCodexUsage(stdout),
      latencyMs: Date.now() - t0,
      stderr,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function extractGrilleGpt55FromPdf(
  pdfPath: string,
  pages: number[],
  slug: string,
  opts: Gpt55ExtractOptions,
): Promise<Gpt55PathResult> {
  const dpi = opts.dpi ?? Number(process.env["GPT55_DPI"] ?? "150");
  const methode = opts.methode ?? GPT55_METHODE;
  const t0 = Date.now();
  const zones: ZoneNormsT[] = [];
  const reasons: string[] = [];
  let pagesRead = 0;
  let pagesFailed = 0;
  let usage = emptyUsage();

  for (const page of pages) {
    let png: string | null = null;
    try {
      png = await renderPageToPng(pdfPath, page, dpi);
      const res = await runGpt55Vision(png, page, slug, opts.cli);
      usage = addCodexUsage(usage, res.usage);
      zones.push(...mapClaudeExtractionToZones(res.extraction, page, {
        source_url: opts.source_url,
        snapshot: opts.snapshot,
        methode,
      }));
      pagesRead++;
    } catch (e) {
      pagesFailed++;
      reasons.push(`page ${page}: ${(e instanceof Error ? e.message : String(e)).slice(0, 1200)}`);
    } finally {
      if (png) {
        await rm(png.replace(/\/[^/]+$/, ""), { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    }
  }

  return {
    zones,
    pagesRead,
    pagesFailed,
    durationMs: Date.now() - t0,
    usage,
    reasons,
  };
}
