/**
 * grille-ocr-extractor — PRODUCTION OCR path for the Québec "grille des
 * spécifications" / multi-zone grilles (zones-in-columns), promoted out of the
 * `acquisition/src/bench` spike (BENCH-OCR.md, 2026-06-23) into a first-class,
 * backend-parametrable extractor.
 *
 * WHY THIS EXISTS (the bench verdict, measured)
 * ---------------------------------------------
 * The chat-vision path (`grille-vision-multizone` → `/v1/chat/completions`,
 * `mistral-medium-latest`, 2 passes/page) is EXPENSIVE and BRITTLE on dense
 * multi-zone grids: it returned malformed JSON on 13-column sheets (stratford,
 * total failure) and cost 5–10× more for equal-or-lower recall. The Document-AI
 * OCR path (`/v1/ocr`, `mistral-ocr-latest`, ~$1/1000 pages) is 5–10× cheaper,
 * 3–10× faster, and more robust on exactly those multi-zone grilles. This module
 * is that OCR path, made production-grade and backend-agnostic.
 *
 * WHAT IT DOES
 * ------------
 *   1. OCR a BOUNDED page-set of a grille PDF to per-page GitHub-flavoured
 *      markdown (the OCR call is an injectable seam — see `OcrCallImpl`).
 *   2. Detect the TRANSPOSED grille table(s) on each page (zone codes are COLUMNS,
 *      norm labels are ROWS) and map each zone column → the SAME `ZoneNorms` grid
 *      the chat-vision and native-text paths produce.
 *   3. Run every cell through the FROZEN per-cell guard `buildVisionField`
 *      (parse → semantic unit type-check → plausibility window) — the value
 *      published is the VERBATIM markdown cell or `null`, NEVER a fabrication.
 *
 * ANTI-INVENTION (identical contract to every other path). The OCR is a single
 * read, so we feed the same cell string as BOTH passes (rawA===rawB) → the 2-pass
 * concordance guard is trivially satisfied, and the remaining three guards still
 * gate exactly as elsewhere: a cell that is a note / cross-ref / out-of-range /
 * wrong-unit → `null`. No new normalisation, no guessing.
 *
 * BACKEND-PARAMETRABLE (so Chandra OCR — the user's self-hosted "OCR 2" — can be
 * branched WITHOUT touching this file). The OCR call is selected from the
 * environment via `resolveOcrConfig`:
 *   - `OCR_PROVIDER`  : "mistral-ocr" (default) | "chandra" | any tag
 *   - `OCR_MODEL`     : default "mistral-ocr-latest"
 *   - `OCR_API_BASE`  : default "https://api.mistral.ai"
 *   - `OCR_API_PATH`  : default "/v1/ocr"
 *   - `OCR_API_KEY`   : falls back to `MISTRAL_API_KEY` (NEVER logged)
 *   - `OCR_USD_PER_PAGE` : default 0.001 (mistral-ocr-latest list price)
 * `createMistralOcrHttpCall` speaks the Mistral `/v1/ocr` JSON contract directly
 * (no `mistral-ocr` npm lib dependency — keeps this package self-contained). Any
 * backend with a DIFFERENT wire shape plugs in by supplying its own `OcrCallImpl`
 * (or its own `parseResponse`) — the rest of the pipeline never changes.
 *
 * COST. Billing is per processed page; the real count is read from the OCR
 * response (`usage_info.pages_processed`). To hold cost on huge PDFs we slice the
 * wanted pages into a tiny temp PDF (poppler) BEFORE the call.
 */
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  FIELD_SPECS,
  buildVisionField,
  type FieldId,
} from "./grille-vision-extractor.js";
import {
  ZoneNorms,
  type FieldProvenanceT,
  type NormFieldT,
  type ZoneNormsT,
} from "./grille-specifications-parser.js";

const execFileP = promisify(execFile);

/** Default Document-AI OCR model (Mistral). */
export const DEFAULT_OCR_MODEL = "mistral-ocr-latest";
/** mistral-ocr-latest list price: ~$1 per 1000 pages processed. */
export const MISTRAL_OCR_USD_PER_PAGE = 0.001;
/** Default provenance `methode` when none is supplied (matches the bench tag). */
export const DEFAULT_OCR_METHODE = "mistral-ocr";

// ───────────────────────────────────────────────────────────────────────────
//  Injectable OCR seam (so the mapper is unit-testable with canned markdown and
//  no network). Production = a live `/v1/ocr` call (or the `mistral-ocr` lib).
// ───────────────────────────────────────────────────────────────────────────

export interface OcrPageResult {
  /** Per-page GitHub-flavoured markdown emitted by the OCR backend. */
  markdown: string;
}
export interface OcrResult {
  pages: OcrPageResult[];
  /** Pages actually billed by the backend (drives the real $ cost). */
  pagesProcessed: number;
}
/** (pdfPath) → OCR result over the WHOLE pdf passed (caller slices first). */
export type OcrCallImpl = (pdfPath: string) => Promise<OcrResult>;

// ───────────────────────────────────────────────────────────────────────────
//  Backend configuration (env-driven). Branching Chandra is a config change.
// ───────────────────────────────────────────────────────────────────────────

export interface OcrProviderConfig {
  /** Backend tag, e.g. "mistral-ocr" | "chandra". */
  provider: string;
  /** Model id passed to the backend. */
  model: string;
  /** API base URL (no trailing slash needed). */
  apiBase: string;
  /** API path for the OCR endpoint (default "/v1/ocr"). */
  apiPath: string;
  /** Bearer API key (NEVER logged). May be "" — the live call then throws. */
  apiKey: string;
  /** $ per processed page (for cost reporting / budget guards). */
  costPerPage: number;
}

/** A minimal env shape (process.env-compatible). */
export type EnvLike = Record<string, string | undefined>;

/**
 * Resolve the OCR backend config from the environment. Mistral-OCR is the
 * default; setting `OCR_PROVIDER=chandra` + `OCR_API_BASE=…` (+ `OCR_API_KEY`)
 * points the SAME `/v1/ocr` JSON contract at the self-hosted Chandra endpoint.
 */
export function resolveOcrConfig(env: EnvLike = process.env): OcrProviderConfig {
  const usd = env["OCR_USD_PER_PAGE"];
  return {
    provider: env["OCR_PROVIDER"] ?? DEFAULT_OCR_METHODE,
    model: env["OCR_MODEL"] ?? DEFAULT_OCR_MODEL,
    apiBase: (env["OCR_API_BASE"] ?? "https://api.mistral.ai").replace(/\/+$/, ""),
    apiPath: env["OCR_API_PATH"] ?? "/v1/ocr",
    apiKey: env["OCR_API_KEY"] ?? env["MISTRAL_API_KEY"] ?? "",
    costPerPage: usd !== undefined && usd !== "" ? Number(usd) : MISTRAL_OCR_USD_PER_PAGE,
  };
}

/** Provenance `methode` tag for a given backend config (audit which OCR ran). */
export function ocrMethodeTag(config: OcrProviderConfig): string {
  return `ocr/${config.provider}`;
}

// ───────────────────────────────────────────────────────────────────────────
//  Live HTTP OCR call — Mistral `/v1/ocr` JSON contract, spoken directly (no
//  npm-lib dependency). Reads the key from the config at call-time; never logs it.
//  `fetchImpl` is injectable for offline unit tests.
// ───────────────────────────────────────────────────────────────────────────

/** Loose view of the `/v1/ocr` JSON body (tolerant of snake_case + camelCase). */
interface OcrHttpResponse {
  pages?: Array<{ markdown?: string | null }>;
  usage_info?: { pages_processed?: number };
  usageInfo?: { pagesProcessed?: number };
}

/** Parse a `/v1/ocr` JSON body into our normalised `OcrResult`. */
export function parseOcrHttpResponse(json: unknown): OcrResult {
  const body = (json ?? {}) as OcrHttpResponse;
  const pages = (body.pages ?? []).map((p) => ({ markdown: p.markdown ?? "" }));
  const pagesProcessed =
    body.usage_info?.pages_processed ??
    body.usageInfo?.pagesProcessed ??
    pages.length;
  return { pages, pagesProcessed };
}

/**
 * Build an `OcrCallImpl` that POSTs a base64 PDF to `${apiBase}${apiPath}` using
 * the Mistral Document-AI JSON shape:
 *   { model, document: { type: "document_url", document_url: "data:…;base64,…" } }
 * Works as-is for Mistral and for any Chandra deployment that mirrors that
 * contract; otherwise supply a bespoke `OcrCallImpl`.
 */
export function createMistralOcrHttpCall(
  config: OcrProviderConfig,
  fetchImpl: typeof fetch = fetch,
): OcrCallImpl {
  return async (pdfPath: string): Promise<OcrResult> => {
    if (!config.apiKey) {
      throw new OcrExtractorError(
        "missing-api-key",
        `no API key for OCR provider "${config.provider}" (set OCR_API_KEY or MISTRAL_API_KEY)`,
      );
    }
    const bytes = await readFile(pdfPath);
    const dataUrl = `data:application/pdf;base64,${bytes.toString("base64")}`;
    const endpoint = `${config.apiBase}${config.apiPath}`;
    const requestBody = {
      model: config.model,
      document: { type: "document_url" as const, document_url: dataUrl },
      include_image_base64: false,
    };
    let res: Response;
    try {
      res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    } catch (e) {
      throw new OcrExtractorError("network", e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new OcrExtractorError("http", `HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      throw new OcrExtractorError(
        "parse",
        `OCR response JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return parseOcrHttpResponse(json);
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  PDF slicing — extract a bounded page set to a tiny temp PDF (cost guard).
// ───────────────────────────────────────────────────────────────────────────

/** Slice `pages` (1-based) of `pdfPath` into ONE temp PDF; returns its path + cleanup. */
export async function slicePdf(
  pdfPath: string,
  pages: number[],
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "ocr-slice-"));
  const cleanup = (): Promise<void> =>
    rm(dir, { recursive: true, force: true }).catch(() => undefined);
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
export function labelToFieldId(label: string): FieldId | null {
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
  if (/(facade|frontale|largeur).*min/.test(s)) return "frontage_min";
  if (/(superficie|aire).*(min)/.test(s)) return "superficie_min";
  if (/(indice|coefficient).*(occupation|emprise|sol)/.test(s)) return "densite";
  return null;
}

/** Split one GitHub-markdown table row into trimmed cells (drops outer pipes). */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

/** Does this cell look like a zone code header (e.g. "Ra-1", "A.2", "A-Z", "1")? */
export function looksLikeZoneCode(c: string): boolean {
  const s = c.trim();
  if (!s || s.length > 12) return false;
  return (
    /^[A-Za-z]{0,3}[ .-]?\d{1,4}([ .-]?\d{1,3})?$/.test(s) ||
    /^[A-Za-z]-?[A-Za-z0-9]{1,3}$/.test(s)
  );
}

export interface MarkdownTable {
  /** Ordered zone codes (left→right), from the standalone zone-header row. */
  zoneCodes: string[];
  /** All body rows (already split into cells). */
  rows: string[][];
}

/**
 * Detect a standalone zone-header row: a row whose cells are ALL (or almost all)
 * zone-code-looking. The QC "grille des spécifications" emits the zone header on
 * its OWN markdown line, separate from the data rows, so we anchor on it.
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
  /** Provenance method tag (e.g. "ocr/mistral-ocr"). Default "mistral-ocr". */
  methode?: string;
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
  const methode = opts.methode ?? DEFAULT_OCR_METHODE;
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
        methode,
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

/** Map a whole OCR result (per page) back to ZoneNorms[], page numbers aligned. */
export function mapOcrResultToZones(
  result: OcrResult,
  pages: number[],
  opts: OcrMapOptions,
): ZoneNormsT[] {
  const zones: ZoneNormsT[] = [];
  result.pages.forEach((p, idx) => {
    zones.push(...mapMarkdownPageToZones(p.markdown, pages[idx] ?? idx + 1, opts));
  });
  return zones;
}

export interface OcrPathResult {
  zones: ZoneNormsT[];
  pagesProcessed: number;
  usd: number;
  latencyMs: number;
}

/**
 * Full OCR path over a bounded page set: slice → OCR → map every page's markdown
 * → guarded ZoneNorms[]. `ocr` is injectable (defaults to the env-configured live
 * Mistral `/v1/ocr` call); `costPerPage` defaults to the mistral-ocr list price.
 */
export async function extractGrilleOcrFromPdf(
  pdfPath: string,
  pages: number[],
  opts: OcrMapOptions & { ocr?: OcrCallImpl; costPerPage?: number },
): Promise<OcrPathResult> {
  const ocr = opts.ocr ?? createMistralOcrHttpCall(resolveOcrConfig());
  const costPerPage = opts.costPerPage ?? MISTRAL_OCR_USD_PER_PAGE;
  const { path: slicePath, cleanup } = await slicePdf(pdfPath, pages);
  try {
    const t0 = Date.now();
    const res = await ocr(slicePath);
    const latencyMs = Date.now() - t0;
    const zones = mapOcrResultToZones(res, pages, opts);
    return {
      zones,
      pagesProcessed: res.pagesProcessed,
      usd: res.pagesProcessed * costPerPage,
      latencyMs,
    };
  } finally {
    await cleanup();
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Error type (mirrors GrilleVisionError).
// ───────────────────────────────────────────────────────────────────────────

export type OcrExtractorErrorKind =
  | "missing-api-key"
  | "network"
  | "http"
  | "parse";

export class OcrExtractorError extends Error {
  constructor(
    readonly kind: OcrExtractorErrorKind,
    readonly detail: string,
  ) {
    super(`[grille-ocr:${kind}] ${detail}`);
    this.name = "OcrExtractorError";
  }
}
