/**
 * OCR backend resolver for the `qc-zonage-norms` production runner.
 *
 * The PURE OCR pipeline (markdown → guarded ZoneNorms, slicing, the generic
 * `/v1/ocr` HTTP call, env config) lives in `@geo/qc-sources`
 * (`grille-ocr-extractor.ts`) so it is self-contained and unit-tested. THIS file
 * is the thin acquisition-side wiring that:
 *
 *   1. exposes the PROVEN `mistral-ocr` npm-lib call (`liveMistralOcrLib`) — the
 *      exact path benched in `work/coverage/BENCH-OCR.md` (Chemin B). The lib
 *      uploads the PDF + calls `client.ocr.process` (model `mistral-ocr-latest`)
 *      and is the default for the `mistral-ocr` provider.
 *   2. `resolveOcrCall(env)` — reads the SAME env contract as the package
 *      (`OCR_PROVIDER`/`OCR_MODEL`/`OCR_API_BASE`/`OCR_API_KEY`/…) and returns the
 *      right `OcrCallImpl`:
 *        - provider "mistral-ocr" on the default Mistral base → the proven lib;
 *        - any other provider (e.g. "chandra") OR a custom `OCR_API_BASE` → the
 *          generic `/v1/ocr` HTTP call from the package.
 *      To bracket a backend with a DIFFERENT wire shape, add a branch here (or
 *      pass a bespoke `OcrCallImpl`); nothing else in the chain changes.
 *
 * The key is read at call-time and NEVER logged.
 */
import {
  createMistralOcrHttpCall,
  ocrMethodeTag,
  resolveOcrConfig,
  type EnvLike,
  type OcrCallImpl,
  type OcrProviderConfig,
  type OcrResult,
} from "../../../packages/qc-sources/src/sources/grille-ocr-extractor.js";

/**
 * The PROVEN Mistral Document-AI call via the `mistral-ocr` npm lib (`convertPdf`
 * → `POST /v1/ocr`, model `mistral-ocr-latest`). Reads MISTRAL_API_KEY from the
 * env; never logs it. Returns per-page markdown + the billed page count.
 */
export const liveMistralOcrLib: OcrCallImpl = async (pdfPath: string): Promise<OcrResult> => {
  const apiKey = process.env["OCR_API_KEY"] ?? process.env["MISTRAL_API_KEY"];
  if (!apiKey) throw new Error("MISTRAL_API_KEY / OCR_API_KEY is not set (load sentropic/.env)");
  // Honor OCR_MODEL (e.g. "mistral-ocr-4-0") so the proven npm-lib path pins the
  // EXACT model rather than the lib's built-in default ("mistral-ocr-latest"). Read
  // at call-time, never logged. Unset → the lib keeps its own default.
  const model = process.env["OCR_MODEL"];
  const mod = (await import("mistral-ocr")) as unknown as {
    convertPdf: (
      input: string,
      opts: { apiKey: string; generateDocx: boolean; logger: false; model?: string },
    ) => Promise<{
      ocrResponse: {
        pages: Array<{ markdown: string }>;
        usageInfo?: { pagesProcessed?: number };
      };
    }>;
  };
  const res = await mod.convertPdf(pdfPath, {
    apiKey,
    generateDocx: false,
    logger: false,
    ...(model ? { model } : {}),
  });
  const pages = (res.ocrResponse.pages ?? []).map((p) => ({ markdown: p.markdown ?? "" }));
  const pagesProcessed = res.ocrResponse.usageInfo?.pagesProcessed ?? pages.length;
  return { pages, pagesProcessed };
};

export interface ResolvedOcr {
  call: OcrCallImpl;
  config: OcrProviderConfig;
  /** Provenance `methode` tag stamped on every deposited field. */
  methode: string;
  /** $ per processed page (for cost reporting). */
  costPerPage: number;
}

/** True when the config points at the default Mistral cloud OCR (not a custom host). */
function isDefaultMistral(c: OcrProviderConfig): boolean {
  return c.provider === "mistral-ocr" && c.apiBase === "https://api.mistral.ai";
}

/**
 * Resolve the OCR call + metadata from the environment. Defaults to the proven
 * `mistral-ocr` lib; a custom `OCR_API_BASE` or non-mistral `OCR_PROVIDER`
 * (e.g. Chandra) switches to the generic `/v1/ocr` HTTP call.
 */
export function resolveOcrCall(env: EnvLike = process.env): ResolvedOcr {
  const config = resolveOcrConfig(env);
  const call = isDefaultMistral(config) ? liveMistralOcrLib : createMistralOcrHttpCall(config);
  return { call, config, methode: ocrMethodeTag(config), costPerPage: config.costPerPage };
}
