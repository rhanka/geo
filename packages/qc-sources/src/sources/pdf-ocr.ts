/**
 * pdf-ocr — OCR utility for scanned (image-only) PDF procès-verbaux.
 *
 * Context
 * -------
 * Many Québec municipal PV PDFs are produced by flatbed scanners and contain
 * NO embedded text layer.  `pdftotext` (or `pdf-parse`) returns an empty
 * string for these files, making zonage-change detection impossible.
 *
 * This module provides:
 *   1. `isScannedPdf(text, pages?)` — heuristic: is the extracted text so
 *      short (relative to page count) that OCR is required?
 *   2. `ocrPdfToText(pdfBuffer, opts?)` — extract text from a scanned PDF via
 *      an injectable OCR implementation.  The default implementation invokes
 *      `tesseract` (via the system PATH) if it is available; if not, it throws
 *      `OcrUnavailableError` with actionable instructions.
 *
 * Design principles
 * -----------------
 * - Injectable: the `OcrImpl` function type allows full mocking in unit tests
 *   (no real binary required in the test container, which ships without OCR
 *   tools).  Pattern mirrors `TranscribeImpl` in voxtral-transcriber.ts.
 * - Honest: nothing is fabricated.  When OCR is unavailable the error message
 *   names the missing tool and the apt install command.  No silent fallback to
 *   empty string.
 * - No PII: the function processes bytes in memory; it never writes to disk
 *   outside of OS-level temp files created and cleaned up by `tesseractImpl`.
 * - Side-effect-free at import: probing for `tesseract` happens lazily, only
 *   when `ocrPdfToText` is first called without a custom `ocrImpl`.
 *
 * OCR tool availability (as of 2026-06-10)
 * -----------------------------------------
 * The Docker api container (`node:24-bookworm-slim`) does NOT ship with
 * tesseract, ocrmypdf, pdftoppm, or pdfimages.  Tesseract 5.3.0 is available
 * in the Debian Bookworm apt repository and can be installed with:
 *
 *   apt-get install -y tesseract-ocr tesseract-ocr-fra poppler-utils
 *
 * Until the Dockerfile is updated, `defaultOcrImpl` throws `OcrUnavailableError`
 * in the test container.  All unit tests use a mock `OcrImpl` and pass.
 *
 * Wire-up
 * -------
 * This file is intentionally self-contained.  It is NOT imported by
 * `proces-verbaux-generic.ts`, `index.ts`, or `ALL_PV_CITIES` — those are
 * managed by other agents.  The cable-in will happen in a follow-up branch.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of an OCR operation on one PDF buffer.
 */
export interface OcrResult {
  /** Full extracted text, UTF-8.  Empty string when the document is blank. */
  readonly text: string;
  /**
   * Detected or assumed language code (ISO 639-1 / tesseract lang code).
   * `"fra"` by default for Québec municipal documents.
   */
  readonly lang: string;
  /**
   * Number of PDF pages that were OCR'd.
   * Undefined when the implementation does not report this.
   */
  readonly pageCount?: number;
}

/**
 * Injectable OCR implementation.
 *
 * Receives the raw PDF bytes and options, returns an `OcrResult`.
 *
 * - Production: `tesseractImpl` (calls `tesseract` CLI via `pdftoppm` + piping).
 * - Tests: any function returning a canned `OcrResult`.
 */
export type OcrImpl = (
  pdfBuffer: Uint8Array,
  opts?: OcrOptions,
) => Promise<OcrResult>;

/** Options accepted by `ocrPdfToText`. */
export interface OcrOptions {
  /**
   * Tesseract language(s), e.g. `"fra"`, `"fra+eng"`.
   * Defaults to `"fra"` (French — Québec municipal documents).
   */
  lang?: string;
  /** Abort signal. */
  signal?: AbortSignal;
  /**
   * Override the default OCR implementation.
   * Pass a mock in tests; omit in production (uses `tesseractImpl`).
   */
  ocrImpl?: OcrImpl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when no OCR implementation is available (tool not on PATH, no
 * `ocrImpl` override provided).
 *
 * Error code `"ocr-unavailable"` is stable — callers can `instanceof` or
 * match on `.code`.
 */
export class OcrUnavailableError extends Error {
  readonly code = "ocr-unavailable" as const;

  constructor(missingTool: string) {
    super(
      `OCR unavailable: '${missingTool}' not found on PATH. ` +
        `Install with: apt-get install -y tesseract-ocr tesseract-ocr-fra poppler-utils`,
    );
    this.name = "OcrUnavailableError";
  }
}

/**
 * Thrown when the OCR process exits with a non-zero status or produces no
 * usable output.
 */
export class OcrProcessError extends Error {
  readonly code = "ocr-process-error" as const;

  constructor(
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`OCR process failed (exit ${exitCode ?? "?"}) — ${stderr.trim()}`);
    this.name = "OcrProcessError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanned-PDF heuristic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum meaningful characters per page for a PDF to be considered
 * "text-bearing" (i.e. pdftotext produced usable output).
 *
 * Empirical threshold:
 * - A typical Québec PV page has 1 500–4 000 chars.
 * - A fully scanned page returns 0–50 chars (BOM, form-feed, stray bytes).
 * - We use 100 chars/page as a conservative threshold.
 */
export const MIN_CHARS_PER_PAGE = 100;

/**
 * Return `true` when the text extracted by `pdftotext` (or equivalent) is so
 * sparse that OCR is likely required to recover the actual content.
 *
 * @param extractedText  The raw text string returned by pdftotext / pdf-parse.
 * @param pageCount      Estimated number of pages (default 1 when unknown).
 *
 * @example
 *   // A 10-page scanned PV: pdftotext returned 40 chars total → scanned
 *   isScannedPdf("  \f  \f  \n", 10)  // → true
 *
 *   // A 10-page text PV: pdftotext returned 25 000 chars → not scanned
 *   isScannedPdf(normalPvText, 10)    // → false
 */
export function isScannedPdf(extractedText: string, pageCount = 1): boolean {
  const safePages = Math.max(1, pageCount);
  // Strip pure whitespace (space, tab, newline, form-feed) and the
  // UTF-8 BOM (U+FEFF) before measuring actual content density.
  // Explicit replacements avoid ESLint no-control-regex violations.
  const withoutSpace = extractedText.replace(/\s/g, "");
  const meaningfulChars = withoutSpace.replace(/\uFEFF/g, "");
  const charsPerPage = meaningfulChars.length / safePages;
  return charsPerPage < MIN_CHARS_PER_PAGE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default (production) OCR implementation — tesseract via pdftoppm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a CLI tool is on PATH without throwing.
 * Returns the resolved path or `null`.
 */
async function whichTool(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", [name]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Production `OcrImpl` that uses:
 *   1. `pdftoppm`  (poppler-utils) — rasterises PDF pages to PPM images
 *   2. `tesseract` — recognises text from each image
 *
 * Both tools must be on PATH.  If either is missing the function throws
 * `OcrUnavailableError` with install instructions.
 *
 * Language defaults to `"fra"` (French).  Pass `opts.lang` to override.
 *
 * The function creates an OS temp directory, writes the PDF, runs pdftoppm,
 * then runs tesseract on each output image, concatenates the results, and
 * cleans up — even on error.
 */
export async function tesseractImpl(
  pdfBuffer: Uint8Array,
  opts?: OcrOptions,
): Promise<OcrResult> {
  // Probe for required tools (lazy, first call only in practice).
  const [tesseractPath, pdftoppmPath] = await Promise.all([
    whichTool("tesseract"),
    whichTool("pdftoppm"),
  ]);

  if (!tesseractPath) throw new OcrUnavailableError("tesseract");
  if (!pdftoppmPath) throw new OcrUnavailableError("pdftoppm");

  const lang = opts?.lang ?? "fra";
  const signal = opts?.signal;

  let tmpDir: string | null = null;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), "radar-ocr-"));

    // Write the PDF to disk.
    const pdfPath = join(tmpDir, "input.pdf");
    await writeFile(pdfPath, pdfBuffer);

    // Rasterise all pages at 300 DPI for reliable OCR quality.
    const ppmPrefix = join(tmpDir, "page");
    await execFileAsync(pdftoppmPath, ["-r", "300", pdfPath, ppmPrefix], {
      signal: signal as AbortSignal | undefined,
    });

    // Collect generated PPM files (sorted for consistent page order).
    const { stdout: lsOut } = await execFileAsync(
      "find",
      [tmpDir, "-name", "page-*.ppm", "-o", "-name", "page*.ppm"],
      { signal: signal as AbortSignal | undefined },
    );
    const ppmFiles = lsOut
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .sort();

    if (ppmFiles.length === 0) {
      // PDF may be empty or pdftoppm produced no output.
      return { text: "", lang, pageCount: 0 };
    }

    // Run tesseract on each page and concatenate the output.
    const pageTexts: string[] = [];
    for (const ppmFile of ppmFiles) {
      const outBase = ppmFile.replace(/\.ppm$/, "-ocr");
      await execFileAsync(
        tesseractPath,
        [ppmFile, outBase, "-l", lang, "--oem", "1", "--psm", "3"],
        { signal: signal as AbortSignal | undefined },
      );
      const txtPath = `${outBase}.txt`;
      const pageText = await readFile(txtPath, "utf-8");
      pageTexts.push(pageText);
    }

    const text = pageTexts.join("\f"); // form-feed between pages (pdftotext convention)
    return { text, lang, pageCount: ppmFiles.length };
  } catch (err) {
    // Re-throw our own typed errors as-is.
    if (err instanceof OcrUnavailableError || err instanceof OcrProcessError) {
      throw err;
    }
    // Wrap unexpected subprocess errors.
    if (err && typeof err === "object" && "code" in err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string };
      throw new OcrProcessError(
        (e as unknown as { code?: number }).code ?? null,
        e.stderr ?? String(err),
      );
    }
    throw err;
  } finally {
    // Always clean up temp directory.
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract text from a scanned (image-only) PDF using OCR.
 *
 * @param pdfBuffer  Raw PDF bytes (from fetch().arrayBuffer() or S3 getObject).
 * @param opts       Options: `lang`, `signal`, `ocrImpl` override.
 *
 * @throws `OcrUnavailableError` when no OCR tool is found and no `ocrImpl`
 *         override is provided.
 * @throws `OcrProcessError` when the OCR subprocess exits with an error.
 *
 * @example
 *   // Production (requires tesseract + pdftoppm in container):
 *   const { text } = await ocrPdfToText(buffer, { lang: "fra" });
 *
 *   // In tests (mock impl, no real tool needed):
 *   const mockOcr: OcrImpl = async () => ({ text: "Avis de motion…", lang: "fra" });
 *   const { text } = await ocrPdfToText(buffer, { ocrImpl: mockOcr });
 */
export async function ocrPdfToText(
  pdfBuffer: Uint8Array,
  opts?: OcrOptions,
): Promise<OcrResult> {
  const impl = opts?.ocrImpl ?? tesseractImpl;
  return impl(pdfBuffer, opts);
}
