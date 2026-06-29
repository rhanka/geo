/**
 * Chemin B — `mistral-ocr` Document-AI path (endpoint POST /v1/ocr, model
 * `mistral-ocr-latest`).
 *
 * PROMOTED TO PROD. The mapping logic this spike validated (markdown grille →
 * guarded `ZoneNorms`, PDF slicing, the per-cell anti-invention guard) now lives
 * in the package: `@geo/qc-sources` → `grille-ocr-extractor.ts`. The proven live
 * call via the `mistral-ocr` npm lib lives in `../lib/ocr.ts`. This file is kept
 * as a THIN shim so the existing bench driver (`run-ocr-bench.ts`) is unchanged;
 * it re-exports the promoted symbols and wires `runOcrPath` to the lib call.
 */
import {
  extractGrilleOcrFromPdf,
  MISTRAL_OCR_USD_PER_PAGE,
  type OcrCallImpl,
  type OcrMapOptions,
  type OcrPathResult,
} from "../../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import { liveMistralOcrLib } from "../lib/ocr.js";

export {
  slicePdf,
  findGrilleTables,
  mapMarkdownPageToZones,
  MISTRAL_OCR_USD_PER_PAGE,
  type OcrCallImpl,
  type OcrPageResult,
  type OcrResult,
  type OcrMapOptions,
  type OcrPathResult,
} from "../../../packages/qc-sources/src/sources/grille-ocr-extractor.js";

export const OCR_METHODE = "mistral-ocr";
/** The proven live mistral-ocr lib call (re-exported under the bench's old name). */
export const liveMistralOcr: OcrCallImpl = liveMistralOcrLib;

/**
 * Full Chemin B over a bounded page set: slice → OCR → map → guarded ZoneNorms[].
 * `ocr` is injectable (defaults to the proven `mistral-ocr` lib call).
 */
export async function runOcrPath(
  pdfPath: string,
  pages: number[],
  opts: OcrMapOptions & { ocr?: OcrCallImpl },
): Promise<OcrPathResult> {
  return extractGrilleOcrFromPdf(pdfPath, pages, {
    ...opts,
    ocr: opts.ocr ?? liveMistralOcr,
    costPerPage: MISTRAL_OCR_USD_PER_PAGE,
  });
}
