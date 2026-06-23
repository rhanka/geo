/**
 * Chemin B — `mistral-ocr` Document-AI path (endpoint POST /v1/ocr, model
 * `mistral-ocr-latest`, via `client.ocr.process` wrapped by the `mistral-ocr`
 * npm lib's `convertPdf`). This is the path graphify uses for PDF→markdown.
 *
 * WHAT THIS ADAPTER DOES (and what it deliberately does NOT do)
 * -------------------------------------------------------------
 * It OCRs a BOUNDED slice of a grille PDF to per-page GitHub-flavoured markdown,
 * then maps the markdown grille table → the SAME `ZoneNorms` grid as Chemin A,
 * reusing the FROZEN per-cell guard `buildVisionField` from the vision extractor.
 *
 * ANTI-INVENTION (identical contract to Chemin A): every published value is the
 * VERBATIM markdown cell text put through `buildVisionField` (parse → semantic
 * unit type-check → plausibility window) or `null`. The OCR is a single read, so
 * we feed the same cell string as BOTH passes (rawA===rawB) → the 2-pass
 * concordance guard is trivially satisfied, and the remaining three guards still
 * gate exactly as for Chemin A. No new normalisation, no guessing: a cell that is
 * a note / cross-ref / out-of-range → null, never a fabricated norm.
 *
 * COST / BUDGET. `mistral-ocr-latest` bills per processed PAGE (~$1 / 1000 pages
 * = $0.001/page). To hold the bench budget on huge PDFs (300–450 pages) we slice
 * the wanted pages into a tiny temp PDF with poppler `pdfseparate`+`pdfunite`
 * BEFORE uploading, so we only ever pay for the pages we bench. The real page
 * count billed is read back from `ocrResponse.usageInfo.pagesProcessed`.
 *
 * The grille format is TRANSPOSED: norm labels run DOWN as table rows, zone codes
 * are COLUMNS. We detect the zone-code header row, then for each norm row match
 * its French label to a `FieldId` and read each zone column's cell.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
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

export const OCR_METHODE = "mistral-ocr";
/** mistral-ocr-latest list price: ~$1 per 1000 pages processed. */
export const MISTRAL_OCR_USD_PER_PAGE = 0.001;

// ───────────────────────────────────────────────────────────────────────────
//  Injectable OCR seam (so the mapper is unit-testable with canned markdown and
//  no network). Production = the live `mistral-ocr` `convertPdf`.
// ───────────────────────────────────────────────────────────────────────────

export interface OcrPageResult {
  /** Per-page GitHub-flavoured markdown emitted by mistral-ocr. */
  markdown: string;
}
export interface OcrResult {
  pages: OcrPageResult[];
  /** Pages actually billed by Document-AI (drives the real $ cost). */
  pagesProcessed: number;
}
/** (pdfPath) → OCR result over the WHOLE pdf passed (caller slices first). */
export type OcrCallImpl = (pdfPath: string) => Promise<OcrResult>;

/**
 * Live mistral-ocr call. Dynamically imports the `mistral-ocr` lib exactly like
 * graphify (`loadMistralOcrModule`) and reads MISTRAL_API_KEY from the env
 * (NEVER logged). Returns per-page markdown + the billed page count.
 */
export const liveMistralOcr: OcrCallImpl = async (pdfPath) => {
  const apiKey = process.env["MISTRAL_API_KEY"];
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not set (load sentropic/.env)");
  const mod = (await import("mistral-ocr")) as unknown as {
    convertPdf: (
      input: string,
      opts: { apiKey: string; generateDocx: boolean; logger: false },
    ) => Promise<{
      ocrResponse: {
        pages: Array<{ markdown: string }>;
        usageInfo?: { pagesProcessed?: number };
      };
    }>;
  };
  const res = await mod.convertPdf(pdfPath, { apiKey, generateDocx: false, logger: false });
  const pages = (res.ocrResponse.pages ?? []).map((p) => ({ markdown: p.markdown ?? "" }));
  const pagesProcessed = res.ocrResponse.usageInfo?.pagesProcessed ?? pages.length;
  return { pages, pagesProcessed };
};

// ───────────────────────────────────────────────────────────────────────────
//  PDF slicing — extract a bounded page set to a tiny temp PDF (cost guard).
// ───────────────────────────────────────────────────────────────────────────

/** Slice `pages` (1-based) of `pdfPath` into ONE temp PDF; returns its path + cleanup. */
export async function slicePdf(
  pdfPath: string,
  pages: number[],
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "ocr-bench-slice-"));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => undefined);
  const parts: string[] = [];
  for (const p of pages) {
    const out = join(dir, `p${String(p).padStart(4, "0")}.pdf`);
    await execFileP("pdfseparate", ["-f", String(p), "-l", String(p), pdfPath, out]);
    parts.push(out);
  }
  const merged = join(dir, "slice.pdf");
  if (parts.length === 1) {
    await execFileP("cp", [parts[0]!, merged]);
  } else {
    await execFileP("pdfunite", [...parts, merged]);
  }
  return { path: merged, cleanup };
}

// ───────────────────────────────────────────────────────────────────────────
//  Markdown grille parsing — TRANSPOSED table (zones in columns) → ZoneNorms[].
// ───────────────────────────────────────────────────────────────────────────

/** Match a French norm-row label to a FieldId (verbatim-anchored, no guessing). */
function labelToFieldId(label: string): FieldId | null {
  const s = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  // Order matters: most specific first.
  if (/marge.*avant/.test(s) && /min/.test(s)) return "marge_avant_min";
  if (/marge.*(laterale|lateral)/.test(s) && /min/.test(s)) return "marge_laterale_min";
  if (/marge.*arriere/.test(s) && /min/.test(s)) return "marge_arriere_min";
  if (/marge.*avant/.test(s) && !/max/.test(s)) return "marge_avant_min";
  if (/marge.*(laterale|lateral)/.test(s) && !/max/.test(s)) return "marge_laterale_min";
  if (/marge.*arriere/.test(s) && !/max/.test(s)) return "marge_arriere_min";
  if (/hauteur.*(etage)/.test(s) && /max/.test(s)) return "hauteur_etages";
  if (/hauteur.*(metre|metr)/.test(s) && /max/.test(s)) return "hauteur_metres";
  if (/hauteur.*(metre|metr)/.test(s)) return "hauteur_metres";
  if (/hauteur.*(etage)/.test(s)) return "hauteur_etages";
  if (/(façade|facade|frontale|largeur).*min/.test(s)) return "frontage_min";
  if (/(superficie|aire).*(min)/.test(s)) return "superficie_min";
  if (/(indice|coefficient).*(occupation|emprise|sol)/.test(s)) return "densite";
  return null;
}

/** Split one GitHub-markdown table row into trimmed cells (drops outer pipes). */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

/** Does this cell look like a zone code header (e.g. "Ra-1", "A.2", "A-Z", "1")? */
function looksLikeZoneCode(c: string): boolean {
  const s = c.trim();
  if (!s || s.length > 12) return false;
  return /^[A-Za-z]{0,3}[ .-]?\d{1,4}([ .-]?\d{1,3})?$/.test(s) || /^[A-Za-z]-?[A-Za-z0-9]{1,3}$/.test(s);
}

interface MarkdownTable {
  /** Ordered zone codes (left→right), from the standalone zone-header row. */
  zoneCodes: string[];
  /** All body rows (already split into cells). */
  rows: string[][];
}

/**
 * Detect a standalone zone-header row: a row whose cells are ALL (or almost all)
 * zone-code-looking (e.g. `| 1 | 2 | … | 8 |` or `| A.1 | A.2 | … |`). The QC
 * "grille des spécifications" emits the zone header on its OWN markdown line,
 * separate from the data rows, so we anchor on it and then align each data row's
 * TRAILING N cells to the N zones (robust to variable leading label columns).
 */
function asZoneHeader(cells: string[]): string[] | null {
  const nonEmpty = cells.filter((c) => c.length > 0);
  if (nonEmpty.length < 2) return null;
  const zoneish = nonEmpty.filter(looksLikeZoneCode).length;
  // Require the row to be dominated by zone-code-looking cells (≥80%).
  if (zoneish < 2 || zoneish < Math.ceil(nonEmpty.length * 0.8)) return null;
  return nonEmpty.map((c) => c.trim());
}

/** Find every markdown table on a page that carries a standalone zone header. */
export function findGrilleTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split("\n");
  const tables: MarkdownTable[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.includes("|")) {
      i++;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && lines[i]!.includes("|")) {
      block.push(lines[i]!);
      i++;
    }
    if (block.length < 2) continue;
    const rows = block.map(splitRow).filter((r) => !isSeparatorRow(r));
    // Locate the standalone zone-header row (first one wins).
    let header: string[] | null = null;
    let headerIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 6); r++) {
      const h = asZoneHeader(rows[r]!);
      if (h) {
        header = h;
        headerIdx = r;
        break;
      }
    }
    if (!header) continue;
    tables.push({ zoneCodes: header, rows: rows.slice(headerIdx + 1) });
  }
  return tables;
}

export interface OcrMapOptions {
  source_url: string;
  snapshot: string;
}

/**
 * Map a page's OCR markdown → guarded ZoneNorms[] (one per zone column). Each
 * cell is run through the FROZEN `buildVisionField` guard with the OCR cell as
 * both passes (concordance trivially holds; parse/semantic/plausibility gate).
 */
export function mapMarkdownPageToZones(
  markdown: string,
  page: number,
  opts: OcrMapOptions,
): ZoneNormsT[] {
  const tables = findGrilleTables(markdown);
  const out: ZoneNormsT[] = [];
  const seen = new Set<string>();
  for (const table of tables) {
    const n = table.zoneCodes.length;
    // For each zone column, collect its per-field verbatim cell text.
    const perZone = new Map<string, Partial<Record<FieldId, string | null>>>();
    for (const code of table.zoneCodes) if (!perZone.has(code)) perZone.set(code, {});
    for (const row of table.rows) {
      // A data row's TRAILING N cells are the per-zone values; the cells before
      // are the (category +) norm label. Skip rows that don't carry N values.
      if (row.length < n + 1) continue;
      const values = row.slice(row.length - n);
      const label = row.slice(0, row.length - n).join(" ").trim();
      const fieldId = labelToFieldId(label);
      if (!fieldId) continue;
      table.zoneCodes.forEach((code, idx) => {
        const cell = values[idx];
        const fields = perZone.get(code)!;
        // Keep the FIRST non-empty read for this field (a label can recur).
        if (fields[fieldId] === undefined) {
          fields[fieldId] = cell && cell.length ? cell : null;
        }
      });
    }
    for (const [code, fields] of perZone) {
      const key = code.toUpperCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const provenance = (): FieldProvenanceT => ({
        source_url: opts.source_url,
        methode: OCR_METHODE,
        snapshot: opts.snapshot,
        page: `PAGE ${page} ZONE ${code}`,
      });
      const field = (id: FieldId): NormFieldT => {
        const spec = FIELD_SPECS.find((s) => s.id === id)!;
        const raw = fields[id] ?? null;
        // OCR is a single read → feed as both passes (concordance auto-holds).
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
  }
  return out;
}

export interface OcrPathResult {
  zones: ZoneNormsT[];
  pagesProcessed: number;
  usd: number;
  latencyMs: number;
}

/**
 * Full Chemin B over a bounded page set: slice → OCR → map every page's markdown
 * → guarded ZoneNorms[]. `ocr` is injectable (defaults to the live mistral-ocr).
 */
export async function runOcrPath(
  pdfPath: string,
  pages: number[],
  opts: OcrMapOptions & { ocr?: OcrCallImpl },
): Promise<OcrPathResult> {
  const ocr = opts.ocr ?? liveMistralOcr;
  const { path: slicePath, cleanup } = await slicePdf(pdfPath, pages);
  try {
    const t0 = Date.now();
    const res = await ocr(slicePath);
    const latencyMs = Date.now() - t0;
    const zones: ZoneNormsT[] = [];
    res.pages.forEach((p, idx) => {
      zones.push(...mapMarkdownPageToZones(p.markdown, pages[idx] ?? idx + 1, opts));
    });
    return {
      zones,
      pagesProcessed: res.pagesProcessed,
      usd: res.pagesProcessed * MISTRAL_OCR_USD_PER_PAGE,
      latencyMs,
    };
  } finally {
    await cleanup();
  }
}

// Keep writeFile import meaningful for potential markdown sidecar debugging.
void writeFile;
