/**
 * grille-claude-cli — ENGINE B of the two-engine "grille des normes" extraction.
 *
 * WHY THIS EXISTS
 * ---------------
 * Engine A is the hardened Document-AI OCR path (`grille-ocr-extractor.ts`,
 * mistral-ocr-4-0 → markdown → guarded ZoneNorms). Engine B is THIS file: it reads
 * the RENDERED grille page with Claude Opus 4.8 at xhigh reasoning, driven through
 * the LOCAL `claude` CLI in headless print mode (`claude -p`). Running through the
 * CLI means the call is served by the user's Claude SUBSCRIPTION (OAuth), NOT a
 * paid Anthropic API key — verified at build time: a headless run reports
 * `apiKeySource: "none"` and a `five_hour` rate-limit window with overage REJECTED
 * (so it can never silently bill). The only cost is subscription rate-limit quota,
 * hence the runner keeps Engine B to a few concurrent lanes.
 *
 * The chat-vision Mistral-medium engine (`grille-vision-extractor.ts`'s live call)
 * is retired by this engine; we KEEP and REUSE its frozen anti-invention guard.
 *
 * ANTI-INVENTION IS INHERITED WHOLE, UNCHANGED
 * --------------------------------------------
 * Claude is instructed to return the VERBATIM cell text (unit included) or an
 * explicit `null` for any empty/illegible/ambiguous cell — never an inferred value.
 * Every returned cell is then run through the FROZEN `buildVisionField` guard from
 * `grille-vision-extractor.ts` (parse → semantic unit type-check → plausibility
 * window) — the EXACT same guard Engine A uses. The vision read is a single pass,
 * so we feed the same cell string as both passes (rawA===rawB) → the 2-pass
 * concordance guard is trivially satisfied and the remaining guards gate exactly
 * as elsewhere. No new normalisation, no guessing, no fabricated defaults.
 *
 * ONE-SHOT, NO TOOLS, ANTI-STALL
 * ------------------------------
 * The CLI is invoked with `--tools ""` (no tool use → single turn, never iterates
 * or stalls waiting on a tool), `--input-format stream-json` (the image is fed as a
 * base64 content block — no Read tool needed) and `--output-format stream-json`
 * (the only output mode the streaming input accepts). The child is killed on a hard
 * timeout. A `rate_limit_event` whose status is not "allowed" raises a typed
 * `ClaudeCliError("rate-limit")` so the runner can back off rather than spin.
 *
 * The CLI call (`ClaudeCallImpl`) and the page renderer are INJECTABLE so the
 * mapper + guard reuse are unit-testable with a canned extraction and NO `claude`
 * binary / poppler dependency in CI.
 */
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  FIELD_SPECS,
  buildVisionField,
  type FieldId,
} from "../../../packages/qc-sources/src/sources/grille-vision-extractor.js";
import {
  ZoneNorms,
  type FieldProvenanceT,
  type NormFieldT,
  type ZoneNormsT,
} from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

const execFileP = promisify(execFile);

/** Provenance `methode` tag stamped on every field Engine B publishes. */
export const CLAUDE_METHODE = "claude-cli/opus-4-8";
/** The CLI model alias / full id we pin (verified `apiKeySource: none`). */
export const CLAUDE_MODEL = "claude-opus-4-8";
/** Reasoning effort level (CLI `--effort`). */
export const CLAUDE_EFFORT = "xhigh";

// ───────────────────────────────────────────────────────────────────────────
//  Injectable seams (CLI call + page renderer) so the pipeline runs offline.
// ───────────────────────────────────────────────────────────────────────────

/** One Claude vision read of a page: the model's raw VERBATIM cell strings. */
export interface ClaudeRawExtraction {
  /** Every zone column/page the model could read off this page. */
  zones: Array<{
    /** Verbatim zone code, or null when unreadable. */
    zone_code: string | null;
    /** Per-field VERBATIM cell text, or null when empty/illegible/ambiguous. */
    fields: Partial<Record<FieldId, string | null>>;
  }>;
}

/** Injectable Claude call: (pngPath, pageNumber) → raw extraction. */
export type ClaudeCallImpl = (
  imagePath: string,
  page: number,
) => Promise<ClaudeRawExtraction>;

/** Injectable page renderer: (pdfPath, page) → PNG file path. */
export type RenderImpl = (pdfPath: string, page: number) => Promise<string>;

// ───────────────────────────────────────────────────────────────────────────
//  Prompt — strict, anti-invention, handles BOTH grille layouts (multizone where
//  zones are columns, and vertical 1-zone/page). Field list built from FIELD_SPECS
//  so Engine A and Engine B read the EXACT same norm set.
// ───────────────────────────────────────────────────────────────────────────

const FIELD_LINES = FIELD_SPECS.map((f) => `  - "${f.id}": ${f.label}`).join("\n");

export function buildClaudePrompt(): string {
  return `Tu lis l'IMAGE d'une "grille des usages et des normes" (ou "grille des spécifications") municipale québécoise.
Deux dispositions existent : (a) MULTIZONE — plusieurs zones en COLONNES, les normes en LIGNES ; (b) VERTICALE — UNE seule zone par page.

RÈGLES ABSOLUES (anti-invention) :
- Donne la valeur EXACTE de la cellule, VERBATIM, telle qu'imprimée, unité incluse
  (ex: "7.5", "7,5 m", "1/2", "2787", "60", "0,3"). Ne convertis pas, ne complète pas, ne calcule pas.
- Si une cellule est VIDE, illisible, ambiguë, ou si tu n'es pas certain → renvoie null
  (le JSON null, pas la chaîne "null", pas 0, pas une estimation). null est TOUJOURS préférable à une valeur devinée.
- N'invente JAMAIS une valeur. Ne déduis JAMAIS la valeur d'une zone à partir d'une autre colonne.
- Lis le code de zone EXACTEMENT comme imprimé dans l'en-tête de colonne (ou la boîte "ZONE").
- Traite CHAQUE colonne de zone présente sur la page (en disposition multizone, il peut y en avoir 10+).

CHAMPS À EXTRAIRE par zone (clé JSON : ligne de la grille) :
${FIELD_LINES}

Réponds STRICTEMENT et UNIQUEMENT avec ce JSON (aucun texte autour, aucune balise) :
{"zones":[{"zone_code":"<code verbatim ou null>","fields":{"<id>":"<verbatim cellule ou null>", ...}}, ...]}`;
}

// ───────────────────────────────────────────────────────────────────────────
//  Parse the model's JSON text into a normalised ClaudeRawExtraction. Tolerant of
//  ```json fences and of leading/trailing prose. Anti-invention: anything we
//  cannot read becomes null (never a fabricated default).
// ───────────────────────────────────────────────────────────────────────────

export function parseClaudeContent(content: string): ClaudeRawExtraction {
  let text = content.trim();
  // Strip a leading ```json / ``` fence and trailing ``` if present.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // If there is surrounding prose, isolate the outermost JSON object.
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) text = text.slice(first, last + 1);
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new ClaudeCliError(
      "parse",
      `model did not return JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const rec = (obj ?? {}) as Record<string, unknown>;
  const zonesRaw = Array.isArray(rec["zones"]) ? (rec["zones"] as unknown[]) : [];
  const zones: ClaudeRawExtraction["zones"] = [];
  for (const zr of zonesRaw) {
    const z = (zr ?? {}) as Record<string, unknown>;
    const codeRaw = z["zone_code"];
    const fieldsRaw = (z["fields"] ?? {}) as Record<string, unknown>;
    const fields: Partial<Record<FieldId, string | null>> = {};
    for (const spec of FIELD_SPECS) {
      const v = fieldsRaw[spec.id];
      fields[spec.id] =
        typeof v === "string"
          ? v
          : v === null || v === undefined
            ? null
            : String(v);
    }
    zones.push({
      zone_code:
        typeof codeRaw === "string" && codeRaw.trim() ? codeRaw.trim() : null,
      fields,
    });
  }
  return { zones };
}

// ───────────────────────────────────────────────────────────────────────────
//  Map ONE page's Claude extraction → guarded ZoneNorms[] (one per zone). EXACT
//  mirror of `mapMarkdownPageToZones`: every cell goes through `buildVisionField`
//  with the read as both passes (concordance auto-holds; parse/semantic/
//  plausibility gate). zone_code with no readable text is dropped (never invented).
// ───────────────────────────────────────────────────────────────────────────

export interface ClaudeMapOptions {
  source_url: string;
  snapshot: string;
  methode?: string;
}

export function mapClaudeExtractionToZones(
  extraction: ClaudeRawExtraction,
  page: number,
  opts: ClaudeMapOptions,
): ZoneNormsT[] {
  const methode = opts.methode ?? CLAUDE_METHODE;
  const out: ZoneNormsT[] = [];
  const seen = new Set<string>();
  for (const z of extraction.zones) {
    if (!z.zone_code) continue;
    const code = z.zone_code;
    const key = code.toUpperCase().replace(/\s+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const provenance = (): FieldProvenanceT => ({
      source_url: opts.source_url,
      methode,
      snapshot: opts.snapshot,
      page: `PAGE ${page} ZONE ${code}`,
    });
    const field = (id: FieldId): NormFieldT => {
      const spec = FIELD_SPECS.find((s) => s.id === id)!;
      const raw = z.fields[id] ?? null;
      // Single read → feed as both passes (concordance auto-holds; rest gates).
      return buildVisionField(spec, raw, raw, provenance());
    };
    const hauteurMetres = field("hauteur_metres");
    const hauteurEtages = field("hauteur_etages");
    const hauteurMax = hauteurMetres.value !== null ? hauteurMetres : hauteurEtages;
    const zn: ZoneNormsT = {
      zone_code: code,
      zone_page: `PAGE ${page} ZONE ${code}`,
      usages: [],
      densite: field("densite"),
      hauteur_min: null,
      hauteur_max: hauteurMax,
      marges: {
        avant_min: field("marge_avant_min"),
        laterale_min: field("marge_laterale_min"),
        arriere_min: field("marge_arriere_min"),
      },
      frontage_min: field("frontage_min"),
      superficie_min: field("superficie_min"),
    };
    out.push(ZoneNorms.parse(zn));
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
//  Page renderer — gs /prepress slice (the compact ~200 KB path Engine A uses,
//  NOT pdfseparate+pdfunite) → pdftoppm one page → PNG. Injectable above.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Slice a contiguous [first,last] page range out of `pdfPath` into ONE compact
 * temp PDF via ghostscript /prepress (consolidates shared resources; never
 * downsamples). Returns the slice path + its 1-based page count + a cleanup fn.
 */
export async function sliceGrillePages(
  pdfPath: string,
  first: number,
  last: number,
): Promise<{ path: string; pages: number; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "claude-slice-"));
  const out = join(dir, "slice.pdf");
  const cleanup = (): Promise<void> =>
    rm(dir, { recursive: true, force: true }).catch(() => undefined);
  await execFileP(
    "gs",
    [
      "-sDEVICE=pdfwrite",
      "-dNOPAUSE",
      "-dBATCH",
      "-dQUIET",
      "-dSAFER",
      "-dPDFSETTINGS=/prepress",
      `-dFirstPage=${first}`,
      `-dLastPage=${last}`,
      `-sOutputFile=${out}`,
      pdfPath,
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (!existsSync(out)) {
    await cleanup();
    throw new ClaudeCliError("render", `gs produced no slice for pages ${first}-${last}`);
  }
  return { path: out, pages: last - first + 1, cleanup };
}

/**
 * Render ONE page (1-based, WITHIN the given pdf) to a PNG at `dpi`. Returns the
 * PNG path; the caller deletes it after the model read (disk-quota friendly).
 */
export async function renderPageToPng(
  pdfPath: string,
  page: number,
  dpi = 150,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-png-"));
  const prefix = join(dir, "page");
  await execFileP("pdftoppm", [
    "-png",
    "-r",
    String(dpi),
    "-f",
    String(page),
    "-l",
    String(page),
    pdfPath,
    prefix,
  ]);
  const { stdout } = await execFileP("ls", [dir]);
  const png = stdout
    .split("\n")
    .map((s) => s.trim())
    .find((f) => f.startsWith("page") && f.endsWith(".png"));
  if (!png) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw new ClaudeCliError("render", `pdftoppm produced no PNG for page ${page}`);
  }
  return join(dir, png);
}

// ───────────────────────────────────────────────────────────────────────────
//  Production Claude CLI call — headless `claude -p`, one-shot, no tools, on the
//  user's SUBSCRIPTION (OAuth, apiKeySource=none). Streaming-json in (image as a
//  base64 content block) + streaming-json out (parse the final result message).
// ───────────────────────────────────────────────────────────────────────────

export interface ClaudeCliOptions {
  /** Binary to invoke (default "claude"). */
  bin?: string;
  /** Model alias / id (default CLAUDE_MODEL). */
  model?: string;
  /** Reasoning effort (default CLAUDE_EFFORT). */
  effort?: string;
  /** Hard timeout per page in ms (default 180000). Child is killed past this. */
  timeoutMs?: number;
}

/** Outcome of one raw CLI invocation (before JSON-content parsing). */
interface ClaudeCliRunResult {
  /** The model's final assistant text (the `result` message's `.result`). */
  resultText: string;
  /** Would-be API cost reported by the CLI (informational; subscription = $0). */
  costUsdEquivalent: number;
  /** Wall time of the invocation. */
  durationMs: number;
}

/**
 * Spawn `claude -p` with a stream-json user message carrying the prompt + the page
 * PNG (base64), collect the stream-json output, and return the final result text.
 * Throws `ClaudeCliError("rate-limit")` on a rejected rate-limit event, and
 * `ClaudeCliError("timeout")` if the child exceeds the timeout (it is killed).
 */
export async function runClaudeCli(
  imagePath: string,
  prompt: string,
  opts: ClaudeCliOptions = {},
): Promise<ClaudeCliRunResult> {
  const bin = opts.bin ?? "claude";
  const model = opts.model ?? CLAUDE_MODEL;
  const effort = opts.effort ?? CLAUDE_EFFORT;
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const bytes = await readFile(imagePath);
  const userMessage = {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: bytes.toString("base64"),
          },
        },
      ],
    },
  };

  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--effort",
    effort,
    "--tools",
    "",
    "--no-session-persistence",
  ];

  const t0 = Date.now();
  return await new Promise<ClaudeCliRunResult>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let rateLimited = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new ClaudeCliError("timeout", `claude -p exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    const fail = (e: ClaudeCliError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(e);
    };

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (e) => fail(new ClaudeCliError("spawn", e.message)));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Parse the stream-json lines: find the result message + rate-limit events.
      let resultText: string | null = null;
      let costUsd = 0;
      let resultIsError = false;
      for (const line of stdout.split("\n")) {
        const s = line.trim();
        if (!s.startsWith("{")) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(s) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (msg["type"] === "rate_limit_event") {
          const info = (msg["rate_limit_info"] ?? {}) as Record<string, unknown>;
          if (info["status"] && info["status"] !== "allowed") rateLimited = true;
        }
        if (msg["type"] === "result") {
          resultText = typeof msg["result"] === "string" ? (msg["result"] as string) : null;
          costUsd = typeof msg["total_cost_usd"] === "number" ? (msg["total_cost_usd"] as number) : 0;
          resultIsError = msg["is_error"] === true;
        }
      }
      if (rateLimited) {
        reject(new ClaudeCliError("rate-limit", "subscription rate-limit window exhausted"));
        return;
      }
      if (code !== 0 || resultIsError || resultText === null) {
        reject(
          new ClaudeCliError(
            "cli",
            `claude -p exit=${code} is_error=${resultIsError} ${stderr.slice(0, 200)}`,
          ),
        );
        return;
      }
      resolve({ resultText, costUsdEquivalent: costUsd, durationMs: Date.now() - t0 });
    });

    // Feed the single user message then close stdin (one-shot).
    child.stdin.write(JSON.stringify(userMessage) + "\n");
    child.stdin.end();
  });
}

/** Production Claude call: render-PNG → `claude -p` → parsed raw extraction. */
export function createClaudeCliCall(opts: ClaudeCliOptions = {}): ClaudeCallImpl {
  const prompt = buildClaudePrompt();
  return async (imagePath: string): Promise<ClaudeRawExtraction> => {
    const run = await runClaudeCli(imagePath, prompt, opts);
    return parseClaudeContent(run.resultText);
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Top-level: extract a bounded page range's ZoneNorms via Engine B.
//  Renders ONE page at a time and deletes the PNG right after the read (so at most
//  one PNG + one slice PDF sit on disk per city — disk-quota friendly).
// ───────────────────────────────────────────────────────────────────────────

export interface ClaudeExtractOptions extends ClaudeMapOptions {
  /** Injected Claude call (defaults to the live `claude -p` call). */
  claude?: ClaudeCallImpl;
  /** Injected page renderer (defaults to gs-slice + pdftoppm). */
  render?: RenderImpl;
  /** Render DPI (default 150). */
  dpi?: number;
  /** Per-page CLI options (model/effort/timeout). */
  cli?: ClaudeCliOptions;
}

export interface ClaudePathResult {
  zones: ZoneNormsT[];
  pagesRead: number;
  pagesFailed: number;
  durationMs: number;
  /** Sum of CLI-reported would-be API cost (subscription = $0 actually billed). */
  costUsdEquivalent: number;
  reasons: string[];
  /** True when a rate-limit event aborted the remaining pages. */
  rateLimited: boolean;
}

/**
 * Render + Claude-read pages [first,last] of `pdfPath` → flat ZoneNorms[]. Pages
 * that error (parse/timeout) are skipped with a reason; a rate-limit aborts the
 * rest of the range (so the runner can stop launching Engine B globally). The
 * caller merges zones by code across pages.
 */
export async function extractGrilleClaudeFromPdf(
  pdfPath: string,
  first: number,
  last: number,
  opts: ClaudeExtractOptions,
): Promise<ClaudePathResult> {
  const claude = opts.claude ?? createClaudeCliCall(opts.cli);
  const dpi = opts.dpi ?? 150;
  const t0 = Date.now();
  const zones: ZoneNormsT[] = [];
  const reasons: string[] = [];
  let pagesRead = 0;
  let pagesFailed = 0;
  let costUsd = 0;
  let rateLimited = false;

  const slice = await sliceGrillePages(pdfPath, first, last);
  try {
    for (let p = 0; p < slice.pages && !rateLimited; p++) {
      const truePage = first + p;
      let png: string | null = null;
      try {
        // render uses the SLICE's local 1-based page index (p+1).
        png = opts.render
          ? await opts.render(pdfPath, truePage)
          : await renderPageToPng(slice.path, p + 1, dpi);
        const extraction = await claude(png, truePage);
        zones.push(...mapClaudeExtractionToZones(extraction, truePage, opts));
        pagesRead++;
      } catch (e) {
        if (e instanceof ClaudeCliError && e.kind === "rate-limit") {
          rateLimited = true;
          reasons.push(`page ${truePage}: rate-limit (aborting)`);
        } else {
          pagesFailed++;
          reasons.push(
            `page ${truePage}: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`,
          );
        }
      } finally {
        if (png) {
          await rm(png.replace(/\/[^/]+$/, ""), { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
      }
    }
  } finally {
    await slice.cleanup();
  }
  return {
    zones,
    pagesRead,
    pagesFailed,
    durationMs: Date.now() - t0,
    costUsdEquivalent: costUsd,
    reasons,
    rateLimited,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Error type (mirrors GrilleVisionError / OcrExtractorError).
// ───────────────────────────────────────────────────────────────────────────

export type ClaudeCliErrorKind =
  | "spawn"
  | "cli"
  | "timeout"
  | "rate-limit"
  | "parse"
  | "render";

export class ClaudeCliError extends Error {
  constructor(
    readonly kind: ClaudeCliErrorKind,
    readonly detail: string,
  ) {
    super(`[grille-claude-cli:${kind}] ${detail}`);
    this.name = "ClaudeCliError";
  }
}
