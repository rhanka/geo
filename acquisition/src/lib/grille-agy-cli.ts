/**
 * grille-agy-cli — ENGINE C of the "grille des normes" extraction: Google Gemini
 * (via the local `agy` CLI, Gemini 3.5 Flash High) reading the RENDERED grille page.
 *
 * WHY THIS EXISTS
 * ---------------
 * Engine A = hardened Document-AI OCR (mistral-ocr-4-0). Engine B = Claude Opus 4.8
 * xhigh through `claude -p` (grille-claude-cli.ts). Engine C is THIS file: the SAME
 * vision read, but served by the user's `agy` subscription (Gemini). It is a strict
 * MIRROR of Engine B and REUSES Engine B's frozen pieces WHOLE:
 *   - buildClaudePrompt()          — the exact anti-invention prompt (verbatim-or-null)
 *   - parseClaudeContent()         — tolerant {zones:[{zone_code,fields}]} JSON parse
 *   - mapClaudeExtractionToZones() — the guarded mapper (buildVisionField on every cell)
 *   - renderPageToPng()            — poppler one-page render
 * so a fabricated value is structurally impossible on Engine C exactly as on Engine B.
 *
 * HOW agy INGESTS THE IMAGE (differs from Claude, discovered by probe)
 * -------------------------------------------------------------------
 * `agy` does NOT accept `--input-format stream-json` (the flag is unknown), so we
 * cannot feed a base64 image content-block the way Engine B does. Instead agy is a
 * Claude-Code-style CLI that expands an `@<abs-path>` file reference IN THE PROMPT
 * into an attached image (verified: a PNG `@ref` is read and described). The read is
 * performed by agy's built-in Read tool, so the call needs
 * `--dangerously-skip-permissions` to auto-approve that single, local, non-stalling
 * tool use (there is no `--tools ""` equivalent). We pin structured output with
 * `--output-format json`, which returns `{response, usage:{input_tokens,
 * output_tokens, thinking_tokens,...}, duration_seconds, status}` — giving us the
 * model's text AND raw token usage in one shot.
 *
 * ONE-SHOT, ANTI-STALL
 * --------------------
 * Print mode (`-p`) is one-shot and NEVER interactive (interactive hangs). A hard
 * SIGKILL timer bounds every page; agy's own `--print-timeout` is set to match. An
 * empty `response` (agy occasionally loops on a page and returns no final text) is
 * raised as `AgyCliError("empty")` so the runner skips that page rather than
 * publishing zero-zone garbage. A non-SUCCESS status or a rate/quota signal raises a
 * typed error so the runner can back off.
 *
 * The CLI call and the page renderer are INJECTABLE so the mapper + guard reuse are
 * unit-testable with a canned extraction and NO `agy` binary / poppler in CI.
 */
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import {
  buildClaudePrompt,
  parseClaudeContent,
  mapClaudeExtractionToZones,
  renderPageToPng,
  type ClaudeRawExtraction,
  type ClaudeMapOptions,
} from "./grille-claude-cli.js";
import type { ZoneNormsT } from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

// ───────────────────────────────────────────────────────────────────────────
//  Re-exports so Engine C consumers never reach back into Engine B by name.
//  The raw-extraction shape, the JSON parse and the guarded mapper are ENGINE-
//  AGNOSTIC (they only know {zones:[{zone_code,fields}]}); reusing them verbatim
//  is what makes Engine C's anti-invention IDENTICAL to Engine B's.
// ───────────────────────────────────────────────────────────────────────────
export type AgyRawExtraction = ClaudeRawExtraction;
export type AgyMapOptions = ClaudeMapOptions;
/** JSON text → normalised extraction (verbatim-or-null). Reused from Engine B. */
export const parseAgyContent = parseClaudeContent;
/** Guarded map of one page's extraction → ZoneNorms[] (buildVisionField). Reused. */
export const mapAgyExtractionToZones = mapClaudeExtractionToZones;

/** Provenance `methode` tag stamped on every field Engine C publishes. */
export const AGY_METHODE = "agy-cli/gemini-3.5-flash-high";
/** The agy model display name (as listed by `agy models`) passed to `--model`. */
export const AGY_MODEL = "Gemini 3.5 Flash (High)";

// ───────────────────────────────────────────────────────────────────────────
//  Injectable seams (same shape as Engine B).
// ───────────────────────────────────────────────────────────────────────────

/** One agy vision read of a page: raw VERBATIM cell strings. */
export type AgyCallImpl = (
  imagePath: string,
  page: number,
) => Promise<AgyRawExtraction>;

/** Injectable page renderer: (pdfPath, page) → PNG file path. */
export type RenderImpl = (pdfPath: string, page: number) => Promise<string>;

// ───────────────────────────────────────────────────────────────────────────
//  Prompt — the FROZEN Engine-B prompt, with the page image attached via an
//  `@<abs-path>` reference PREPENDED so agy loads it before reading the rules.
// ───────────────────────────────────────────────────────────────────────────

/** The engine-agnostic anti-invention prompt body (identical to Engine B). */
export const AGY_BASE_PROMPT = buildClaudePrompt();

/** Full agy prompt for one page: attach the PNG via @ref, then the frozen rules. */
export function buildAgyImagePrompt(imagePath: string): string {
  return `LIS ATTENTIVEMENT CETTE IMAGE : @${imagePath}\n\n${AGY_BASE_PROMPT}`;
}

// ───────────────────────────────────────────────────────────────────────────
//  agy CLI call — headless `agy -p`, one-shot, structured json output.
// ───────────────────────────────────────────────────────────────────────────

export interface AgyUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
}

export interface AgyCliOptions {
  /** Binary to invoke (default "agy"). */
  bin?: string;
  /** Model display name (default AGY_MODEL). */
  model?: string;
  /** Hard SIGKILL timeout per page in ms (default 180000). */
  timeoutMs?: number;
}

/** Outcome of one raw agy invocation (before JSON-content parsing). */
export interface AgyCliRunResult {
  /** The model's final assistant text (the json `response` field). */
  resultText: string;
  /** Raw token usage reported by agy. */
  usage: AgyUsage;
  /** agy-reported wall time (seconds → ms). */
  durationMs: number;
}

const RATE_RE = /\b(rate[-\s]?limit|quota|resource[-\s]?exhausted|429|too many requests)\b/i;

/**
 * Spawn `agy -p <prompt-with-@image>` and return the final text + token usage.
 * Throws `AgyCliError("rate-limit")` on a quota/429 signal, `AgyCliError("timeout")`
 * when the child exceeds `timeoutMs` (it is killed), `AgyCliError("empty")` on a
 * SUCCESS with no text (agy looped), and `AgyCliError("cli")` otherwise.
 */
export async function runAgyCli(
  fullPrompt: string,
  opts: AgyCliOptions = {},
): Promise<AgyCliRunResult> {
  const bin = opts.bin ?? "agy";
  const model = opts.model ?? AGY_MODEL;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  // agy's own print wait — a hair under our SIGKILL so agy returns its json first.
  const printTimeout = `${Math.max(30, Math.floor(timeoutMs / 1000) - 5)}s`;

  const args = [
    "-p",
    fullPrompt,
    "--model",
    model,
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
    "--print-timeout",
    printTimeout,
  ];

  return await new Promise<AgyCliRunResult>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new AgyCliError("timeout", `agy -p exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AgyCliError("spawn", e.message));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const parsed = extractAgyJson(stdout);
      if (!parsed) {
        if (RATE_RE.test(stderr) || RATE_RE.test(stdout)) {
          return reject(new AgyCliError("rate-limit", "agy quota/rate-limit signal"));
        }
        return reject(
          new AgyCliError("cli", `agy -p exit=${code} no-json ${stderr.slice(0, 200)}`),
        );
      }
      const status = String(parsed["status"] ?? "");
      if (status && status.toUpperCase() !== "SUCCESS") {
        if (RATE_RE.test(status) || RATE_RE.test(stderr)) {
          return reject(new AgyCliError("rate-limit", `agy status=${status}`));
        }
        return reject(new AgyCliError("cli", `agy status=${status} ${stderr.slice(0, 160)}`));
      }
      const resultText = typeof parsed["response"] === "string" ? (parsed["response"] as string) : "";
      if (!resultText.trim()) {
        return reject(new AgyCliError("empty", "agy returned SUCCESS with empty response"));
      }
      const u = (parsed["usage"] ?? {}) as Record<string, unknown>;
      const num = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
      const durSec =
        typeof parsed["duration_seconds"] === "number" ? (parsed["duration_seconds"] as number) : 0;
      resolve({
        resultText,
        usage: {
          inputTokens: num("input_tokens"),
          outputTokens: num("output_tokens"),
          thinkingTokens: num("thinking_tokens"),
          totalTokens: num("total_tokens"),
        },
        durationMs: Math.round(durSec * 1000),
      });
    });
  });
}

/** Pull the agy `--output-format json` object out of stdout (tolerant of noise). */
export function extractAgyJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const o = JSON.parse(s) as unknown;
      return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const whole = tryParse(trimmed);
  if (whole && ("response" in whole || "usage" in whole || "status" in whole)) return whole;
  // Fall back: scan lines for the object that carries a usage/response/status key.
  for (const line of trimmed.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    const o = tryParse(s);
    if (o && ("response" in o || "usage" in o || "status" in o)) return o;
  }
  // Last resort: outermost {...} slice.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return tryParse(trimmed.slice(first, last + 1));
  return null;
}

/** Production agy call: render-PNG @ref → `agy -p` → parsed raw extraction. */
export function createAgyCliCall(opts: AgyCliOptions = {}): AgyCallImpl {
  return async (imagePath: string): Promise<AgyRawExtraction> => {
    const run = await runAgyCli(buildAgyImagePrompt(imagePath), opts);
    return parseAgyContent(run.resultText);
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Top-level: extract a bounded page range's ZoneNorms via Engine C. Renders ONE
//  page at a time and deletes the PNG right after the read (disk-quota friendly).
// ───────────────────────────────────────────────────────────────────────────

export interface AgyExtractOptions extends AgyMapOptions {
  /** Injected agy call (defaults to the live `agy -p` call). */
  agy?: AgyCallImpl;
  /** Injected page renderer (defaults to poppler pdftoppm). */
  render?: RenderImpl;
  /** Render DPI (default 150). */
  dpi?: number;
  /** Per-page CLI options (model/timeout). */
  cli?: AgyCliOptions;
}

export interface AgyPathResult {
  zones: ZoneNormsT[];
  pagesRead: number;
  pagesFailed: number;
  durationMs: number;
  usage: AgyUsage;
  reasons: string[];
  /** True when a rate-limit event aborted the remaining pages. */
  rateLimited: boolean;
}

/**
 * Render + agy-read pages [first,last] of `pdfPath` → flat ZoneNorms[]. Pages that
 * error (parse/timeout/empty) are skipped with a reason; a rate-limit aborts the
 * rest of the range. The caller merges zones by code across pages.
 */
export async function extractGrilleAgyFromPdf(
  pdfPath: string,
  first: number,
  last: number,
  opts: AgyExtractOptions,
): Promise<AgyPathResult> {
  const dpi = opts.dpi ?? 150;
  const t0 = Date.now();
  const zones: ZoneNormsT[] = [];
  const reasons: string[] = [];
  const usage: AgyUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 };
  let pagesRead = 0;
  let pagesFailed = 0;
  let rateLimited = false;

  for (let truePage = first; truePage <= last && !rateLimited; truePage++) {
    let png: string | null = null;
    try {
      png = opts.render ? await opts.render(pdfPath, truePage) : await renderPageToPng(pdfPath, truePage, dpi);
      // When the caller injected `agy`, use it (test seam); else run the live call
      // AND accumulate token usage from the same invocation.
      let extraction: AgyRawExtraction;
      if (opts.agy) {
        extraction = await opts.agy(png, truePage);
      } else {
        const run = await runAgyCli(buildAgyImagePrompt(png), opts.cli);
        usage.inputTokens += run.usage.inputTokens;
        usage.outputTokens += run.usage.outputTokens;
        usage.thinkingTokens += run.usage.thinkingTokens;
        usage.totalTokens += run.usage.totalTokens;
        extraction = parseAgyContent(run.resultText);
      }
      zones.push(...mapAgyExtractionToZones(extraction, truePage, opts));
      pagesRead++;
    } catch (e) {
      if (e instanceof AgyCliError && e.kind === "rate-limit") {
        rateLimited = true;
        reasons.push(`page ${truePage}: rate-limit (aborting)`);
      } else {
        pagesFailed++;
        reasons.push(`page ${truePage}: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      }
    } finally {
      if (png) await rm(dirname(png), { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return { zones, pagesRead, pagesFailed, durationMs: Date.now() - t0, usage, reasons, rateLimited };
}

// ───────────────────────────────────────────────────────────────────────────
//  Error type (mirrors ClaudeCliError).
// ───────────────────────────────────────────────────────────────────────────

export type AgyCliErrorKind = "spawn" | "cli" | "timeout" | "rate-limit" | "empty" | "parse" | "render";

export class AgyCliError extends Error {
  constructor(
    readonly kind: AgyCliErrorKind,
    readonly detail: string,
  ) {
    super(`[grille-agy-cli:${kind}] ${detail}`);
    this.name = "AgyCliError";
  }
}
