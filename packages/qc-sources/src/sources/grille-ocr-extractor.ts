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

/**
 * Match a French norm-row label to a FieldId (verbatim-anchored, no guessing).
 *
 * The synonym table is WIDE because the QC "grille des spécifications" family uses
 * many surface forms for the same 8 norms — "Marge de recul avant minimale",
 * "Nombre d'étages du bâtiment principal", "Pourcentage maximal d'occupation du
 * sol", "Largeur minimale du terrain", … A whole family of grilles (valcourt-type
 * Excel sheets) carries REAL values but was published at 0% fields purely because
 * these labels mapped to nothing. ANTI-INVENTION: this maps LABELS → the CORRECT
 * field only; it never touches cell VALUES (those stay verbatim, gated downstream)
 * and never over-maps (e.g. a "somme des marges" or a floor-area "rapport
 * plancher/terrain" is a DIFFERENT norm → left unmapped rather than mis-folded).
 */
export function labelToFieldId(label: string): FieldId | null {
  const s = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[*_`]/g, "") // strip markdown emphasis (OCR bolds section titles)
    .replace(/\s+/g, " ")
    .trim();

  // A SUM of margins ("somme minimale des marges de recul latérales") is its OWN
  // distinct norm — NEVER fold it into a marge_* minimum (anti-over-mapping).
  if (/\bsomme\b/.test(s)) return null;

  // Order matters: most specific first.
  // ── Marges de recul (avant / latérale / arrière); "de recul" is optional and
  //    "minimale"/"min." may sit on the label OR be implicit. A "…maximale" marge
  //    is a different bound → excluded via !/max/. ──
  if (/marge.*avant/.test(s) && !/max/.test(s)) return "marge_avant_min";
  if (/marge.*(laterale|lateral)/.test(s) && !/max/.test(s)) return "marge_laterale_min";
  if (/marge.*arriere/.test(s) && !/max/.test(s)) return "marge_arriere_min";

  // ── Hauteur — étages vs mètres. "Nombre d'étages …" carries no "hauteur" word,
  //    so match it explicitly; a bare "…(m)"/"mètre(s)" hauteur → metres. An
  //    ambiguous unit-less "hauteur" is left UNMAPPED (null beats a wrong window). ──
  if (/(hauteur|nombre|nbre|\bnb\b).*etage/.test(s)) return "hauteur_etages";
  if (/\betages?\b/.test(s)) return "hauteur_etages";
  if (/hauteur.*(metre|\(m\)|\bm\b)/.test(s)) return "hauteur_metres";

  // ── Largeur frontale / façade minimale du terrain ou du lot (frontage). ──
  if (/(largeur|facade|frontage|frontale).*min/.test(s)) return "frontage_min";
  if (/min.*(largeur|facade|frontage|frontale)/.test(s)) return "frontage_min";

  // ── Superficie / aire minimale du terrain ou du lot. ──
  if (/(superficie|aire).*min/.test(s)) return "superficie_min";
  if (/min.*(superficie|aire)/.test(s)) return "superficie_min";

  // ── Densité : coefficient / indice / rapport / pourcentage / % d'occupation ou
  //    d'emprise AU SOL (CES). A "rapport plancher/terrain" (COS floor-area ratio)
  //    is a DIFFERENT quantity → it lacks "occupation|emprise …sol" so it never
  //    matches here (anti-over-mapping). ──
  if (/(coefficient|indice|rapport|pourcentage|%).*(occupation|emprise).*sol/.test(s))
    return "densite";
  if (/(occupation|emprise).*sol/.test(s)) return "densite";
  if (/\(ces\)|\bc\.e\.s\.?\b/.test(s)) return "densite";

  return null;
}

/**
 * The bound we publish for a field, used to pick the RIGHT sub-row when a norm is
 * split across "- minimum" / "- maximum" (or "principal"/"accessoire") lines under
 * a section header (valcourt 2-tier grille). We publish hauteur as a MAX and every
 * dimensional minimum as a MIN, so a "maximum" sub-row wins for hauteur and a
 * "minimum" sub-row wins for the mins; an unlabelled sub-row (e.g. "bâtiment
 * principal", read first) is the neutral default. Anti-invention: this only
 * chooses WHICH verbatim cell to keep — it never alters a value.
 */
const PREFERRED_BOUND: Partial<Record<FieldId, "min" | "max">> = {
  hauteur_etages: "max",
  hauteur_metres: "max",
  marge_avant_min: "min",
  marge_laterale_min: "min",
  marge_arriere_min: "min",
  frontage_min: "min",
  superficie_min: "min",
};

/**
 * Priority of a value-row for a field given its (sub-)label. 2 = the preferred
 * bound's own row, 1 = an unlabelled/neutral row (default, first-seen wins), 0 =
 * the opposite bound. A higher priority row with a real value overrides a lower one.
 */
function subRowRank(label: string, field: FieldId): number {
  const pref = PREFERRED_BOUND[field];
  if (!pref) return 1;
  const s = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hasMax = /\bmax/.test(s);
  const hasMin = /\bmin/.test(s);
  if (pref === "max") return hasMax ? 2 : hasMin ? 0 : 1;
  return hasMin ? 2 : hasMax ? 0 : 1;
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

/** Does this cell look like a zone code header (e.g. "Ra-1", "A.2", "A-Z", "Cons 1")? */
export function looksLikeZoneCode(c: string): boolean {
  const s = c.trim();
  if (!s || s.length > 12) return false;
  // Allow up to a 4-letter alpha prefix: real QC grille prefixes run to 4 chars
  // ("Cons 1", "AFT1", "VILL 2"). A 3-letter cap silently dropped whole "grille des
  // spécifications" feuillets (e.g. Stratford "Cons 1".."Cons 12") below the
  // zone-header detection threshold, losing every zone on those pages.
  return (
    /^[A-Za-z]{0,4}[ .-]?\d{1,4}([ .-]?\d{1,3})?$/.test(s) ||
    /^[A-Za-z]-?[A-Za-z0-9]{1,3}$/.test(s)
  );
}

export interface MarkdownTable {
  /** Ordered zone codes (left→right), from the standalone zone-header row. */
  zoneCodes: string[];
  /** All body rows (already split into cells). */
  rows: string[][];
  /**
   * Column INDEX (in the split row) of each zone code, when the header was an
   * in-table row. Data-row values are read at THESE indices — not right-aligned —
   * so a trailing padding column (the valcourt Excel sheets emit a stray empty
   * cell after the last zone) can never shift a value into the wrong zone.
   * Absent for a text-line header (values then right-align, as before).
   */
  zoneCols?: number[];
}

/** A header row match: the ordered zone codes and their original column indices. */
interface HeaderMatch {
  codes: string[];
  cols: number[];
}

/** A single uppercase letter — an ambiguous-but-real zone code (Stratford "Q", "P"). */
const MONO_LETTER_CODE = /^[A-Z]$/;

/**
 * A LETTER-prefixed zone code ("AG-1", "AFD-6", "Ra-101"): 1–4 leading letters,
 * an optional separator, then digits. Unlike `looksLikeZoneCode` this REQUIRES a
 * letter prefix, so a bare numeric DATA cell ("12", "30") never matches — that is
 * what lets `asMidBlockZoneHeader` split a stacked second zone-band without ever
 * mistaking a row of values for a header.
 */
const ALPHA_ZONE_CODE = /^[A-Za-z]{1,4}[ .-]?\d{1,4}(?:[ .-]?\d{1,3})?$/;

/** A bare numeric suffix (the MRC-Portneuf "feuillet" family lists 101, 102, …). */
function looksLikeBareNumber(c: string): boolean {
  return /^\d{1,4}$/.test(c.trim());
}

/**
 * Detect a standalone zone-header row: a row whose cells are ALL (or almost all)
 * zone-code-looking. The QC "grille des spécifications" emits the zone header on
 * its OWN markdown line, separate from the data rows, so we anchor on it.
 *
 * Single uppercase-letter codes (Stratford feuillet 8 "P 1 … I 2 Q") are real but
 * too ambiguous to anchor a header alone, so they count only as WEAK support: the
 * row still needs ≥2 strong (prefix+digit) codes, and the dominance bar is 70 %
 * (was 80 % with mono-letters counted as noise, which dropped whole headers when a
 * lone "Q" rode along).
 */
function asZoneHeader(cells: string[]): HeaderMatch | null {
  const nonEmpty = cells
    .map((c, i) => ({ c: c.trim(), i }))
    .filter((x) => x.c.length > 0);
  if (nonEmpty.length < 2) return null;
  const strong = nonEmpty.filter((x) => looksLikeZoneCode(x.c)).length;
  const mono = nonEmpty.filter(
    (x) => !looksLikeZoneCode(x.c) && MONO_LETTER_CODE.test(x.c),
  ).length;
  if (strong < 2) return null;
  if (strong + mono < Math.ceil(nonEmpty.length * 0.7)) return null;
  return { codes: nonEmpty.map((x) => x.c), cols: nonEmpty.map((x) => x.i) };
}

/**
 * Detect a SECOND (or third…) zone-header band stacked inside the SAME OCR table
 * block. Wide QC grilles (valcourt: 27 zones) exceed the page width, so the Excel
 * export wraps the columns into successive bands — "AG-1 … AF-1", then "AF-2 …
 * AFD-6" — that mistral-ocr emits as one continuous pipe block. Without splitting,
 * every band after the first is read as data under the first band's zones (its
 * real zones lost, its values mis-attributed).
 *
 * To split SAFELY we require ≥2 LETTER-prefixed codes (`ALPHA_ZONE_CODE`) that
 * DOMINATE the row: a row of bare numeric VALUES ("12 12 30 …") has zero
 * letter-prefixed cells and so is never mistaken for a header (anti-invention).
 */
function asMidBlockZoneHeader(cells: string[]): HeaderMatch | null {
  const nonEmpty = cells
    .map((c, i) => ({ c: c.trim(), i }))
    .filter((x) => x.c.length > 0);
  if (nonEmpty.length < 2) return null;
  const alpha = nonEmpty.filter((x) => ALPHA_ZONE_CODE.test(x.c));
  if (alpha.length < 2) return null;
  if (alpha.length < Math.ceil(nonEmpty.length * 0.7)) return null;
  return { codes: alpha.map((x) => x.c), cols: alpha.map((x) => x.i) };
}

/**
 * Extract a zone PREFIX from a "Zones …" label cell that sits in the row ABOVE a
 * numeric header (the MRC-Portneuf family splits the prefix off the suffix list):
 *   "Zones Ra"  ·  "Zones M"  ·  "Zones agricoles dynamiques AD"
 *   "Zones résidentielles de moyenne densité **Rb**"
 * Returns the trailing short capital-initial token ("Ra", "M", "AD", "Rb"), read
 * VERBATIM (never invented) — or null when no such code is present.
 */
export function zonePrefixFromRow(cells: string[]): string | null {
  for (const raw of cells) {
    const c = raw.replace(/[*_`]/g, "").trim();
    if (!/\bzones?\b/i.test(c)) continue;
    const tokens = c.split(/\s+/);
    for (let k = tokens.length - 1; k >= 0; k--) {
      const t = tokens[k]!;
      if (/^zones?$/i.test(t)) continue;
      // A zone prefix is a short, capital-initial code: "Ra", "Rb", "AD", "M", "A".
      if (/^[A-Z][A-Za-z]{0,3}\d{0,2}$/.test(t)) return t;
    }
  }
  return null;
}

/**
 * Detect a bare-numeric header row (cells are 101, 102, …) whose zone PREFIX lives
 * in `prevCells` ("Zones Ra" → Ra-101, Ra-102…). This is the dominant MRC-Portneuf
 * "FEUILLETS DES USAGES/NORMES" layout (portneuf, saint-raymond, cap-sante,
 * saint-marc-des-carrieres). Without it the suffixes are read as bare "101", which
 * (a) is the wrong code and (b) COLLIDES every feuillet's 101 into one zone — e.g.
 * portneuf collapsed from 161 real zones to 36. Returns prefixed codes or null.
 */
function asPrefixedNumericHeader(cells: string[], prevCells?: string[]): HeaderMatch | null {
  if (!prevCells) return null;
  const nonEmpty = cells
    .map((c, i) => ({ c: c.trim(), i }))
    .filter((x) => x.c.length > 0);
  if (nonEmpty.length < 2) return null;
  const numeric = nonEmpty.filter((x) => looksLikeBareNumber(x.c));
  if (numeric.length < 2 || numeric.length < Math.ceil(nonEmpty.length * 0.8)) return null;
  const prefix = zonePrefixFromRow(prevCells);
  if (!prefix) return null;
  return { codes: numeric.map((x) => `${prefix}-${x.c}`), cols: numeric.map((x) => x.i) };
}

/**
 * Detect a zone header emitted as a STANDALONE text line OUTSIDE the markdown table
 * (mistral-ocr sometimes lifts the header out of the grid):
 *   "B1 B2 B3 B4 B5 M1 M2 M3 M4 M5 M6 M7 M8 M9 M10"
 * Every whitespace-separated token must be a strong zone code (one prose word
 * disqualifies the whole line, so this never fires on a caption/sentence).
 */
export function asTextLineZoneHeader(line: string): string[] | null {
  const s = line.replace(/[#*_`|]/g, " ").trim();
  if (!s) return null;
  const tokens = s.split(/\s+/);
  if (tokens.length < 3) return null;
  if (!tokens.every(looksLikeZoneCode)) return null;
  return tokens;
}

/** Find every markdown table on a page that carries a (recoverable) zone header. */
export function findGrilleTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split("\n");
  const tables: MarkdownTable[] = [];
  let i = 0;
  // Track the last non-empty TEXT line before a table block, so a zone header that
  // mistral-ocr emitted outside the grid ("B1 B2 … M10") can still anchor a table.
  let precedingText = "";
  while (i < lines.length) {
    if (!lines[i]!.includes("|")) {
      if (lines[i]!.trim()) precedingText = lines[i]!;
      i++;
      continue;
    }
    const blockPrecedingText = precedingText;
    const block: string[] = [];
    while (i < lines.length && lines[i]!.includes("|")) {
      block.push(lines[i]!);
      i++;
    }
    precedingText = "";
    if (block.length < 2) continue;
    const rows = block.map(splitRow).filter((r) => !isSeparatorRow(r));
    // Locate the FIRST zone-header row (first one wins). Try the numeric-with-prefix
    // form FIRST (so "Zones Ra" + "101 102 …" → Ra-101…, not bare 101), then the
    // ordinary alpha-coded standalone header.
    let header: HeaderMatch | null = null;
    let headerIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 8); r++) {
      const prev = r > 0 ? rows[r - 1] : undefined;
      const numeric = asPrefixedNumericHeader(rows[r]!, prev);
      if (numeric) {
        header = numeric;
        headerIdx = r;
        break;
      }
      const h = asZoneHeader(rows[r]!);
      if (h) {
        header = h;
        headerIdx = r;
        break;
      }
    }
    // Fallback: no in-table header, but the text line just above the block is a
    // standalone zone-code row → every block row is data under that header
    // (right-aligned, since a text line carries no column indices).
    if (!header || headerIdx < 0) {
      const textHeader = asTextLineZoneHeader(blockPrecedingText);
      if (textHeader) {
        tables.push({ zoneCodes: textHeader, rows });
        continue;
      }
      continue;
    }
    // Walk the rest of the block, splitting it into successive zone BANDS: each
    // time a further zone-header row appears (a stacked column-group — valcourt
    // AG-1…AF-1 then AF-2…AFD-6), close the current table and open the next. Bare
    // numeric value rows never trip `asMidBlockZoneHeader` (letter prefix required),
    // so this only ever recovers real extra zones — it never invents one.
    let curHeader = header;
    let curRows: string[][] = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const prev = rows[r - 1]!;
      const next = asPrefixedNumericHeader(rows[r]!, prev) ?? asMidBlockZoneHeader(rows[r]!);
      if (next) {
        tables.push({ zoneCodes: curHeader.codes, rows: curRows, zoneCols: curHeader.cols });
        curHeader = next;
        curRows = [];
        continue;
      }
      curRows.push(rows[r]!);
    }
    tables.push({ zoneCodes: curHeader.codes, rows: curRows, zoneCols: curHeader.cols });
  }
  return tables;
}

export interface OcrMapOptions {
  source_url: string;
  snapshot: string;
  /** Provenance method tag (e.g. "ocr/mistral-ocr"). Default "mistral-ocr". */
  methode?: string;
  /**
   * VERBATIM zone code to pin for a SINGLE-ZONE-per-page "grille des spécifications"
   * (Nicolet-family) page, OVERRIDING the code the OCR markdown carries. mistral-ocr
   * misreads a serif "I" prefix as "1" (renders "ZONE: I01-132" → "ZONE: 101-132"),
   * which then matches no SIG code. The runner reads the code from the PDF's own
   * native text layer (where it is correct) and passes it here — anti-invention: it
   * is still the grille's own verbatim header code, just from the reliable source.
   */
  zoneCode?: string;
  /**
   * Single-zone-header handling. "auto" (default): when a page carries a "ZONE: <code>"
   * header AND the numbered NORMES-PRESCRITES matrix, read it as ONE zone (leftmost
   * value column). "off": always use the transposed (zones-in-columns) mapper.
   */
  zoneHeaderMode?: "auto" | "off";
}

// ───────────────────────────────────────────────────────────────────────────
//  SINGLE-ZONE-per-page "grille des spécifications" (Nicolet-family). The whole
//  page documents ONE zone named in a "ZONE: <code>" header (top-right); the norm
//  matrix is a fixed set of NUMBERED rows (1..60) grouped under section titles
//  (CATÉGORIES D'USAGES · NORMES PRESCRITES · STRUCTURE · TERRAIN DESSERVI ·
//  MARGES · BÂTIMENT · RAPPORTS), each norm row carrying a "min."/"max." bound and
//  one value column PER intra-zone use-case variant. We publish the LEFTMOST value
//  column as the zone's representative norm (the same convention the frozen vision
//  extractor uses — "lis la colonne de gauche des valeurs"). Zone codes and cell
//  values are read VERBATIM; a wrong-unit / out-of-range / empty cell → null.
// ───────────────────────────────────────────────────────────────────────────

/** Fold a label for keyword matching: lowercase, strip accents + markdown emphasis. */
function foldLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tolerant "ZONE: <code>" header reader. Accepts an optional colon and arbitrary
 * spacing ("ZONE: I01-132", "ZONE:C01-181", "ZONE  H01-104") and the OCR-misread
 * digit-prefixed form ("101-132"). Returns the VERBATIM captured code (long dashes
 * normalised to "-") or null. A bare "ZONES" band header (valcourt) never matches:
 * the capture requires an immediate <alnum>-<digits> code, which "ZONES  |" lacks.
 */
const ZONE_HEADER_RE =
  /\bZONE\s*:?\s*([A-Za-z0-9]{1,4}[-–—]\d{1,4}(?:[-–—]\d{1,3})?)/i;
export function parseZoneHeader(text: string): string | null {
  const m = text.match(ZONE_HEADER_RE);
  if (!m?.[1]) return null;
  return m[1].replace(/[–—]/g, "-").trim();
}

/** The Nicolet-family "grille des spécifications" carries a NORMES PRESCRITES band. */
export function isNumberedGrilleSpec(markdown: string): boolean {
  return /NORMES\s+PRESCRITES/i.test(markdown);
}

/** Section context while walking a numbered grille-spec page. */
type GrilleSection = "usages" | "terrain" | "marges" | "batiment" | "rapports" | "other";

/** Update the section context from a NON-value (title/label) row's text. */
function detectSection(label: string, prev: GrilleSection): GrilleSection {
  const s = foldLabel(label);
  if (/\bmarges?\b/.test(s)) return "marges";
  if (/\bbatiment\b/.test(s)) return "batiment";
  if (/\brapports?\b/.test(s)) return "rapports";
  if (/\bterrain\b/.test(s)) return "terrain"; // "terrain desservi" · "terrain d'angle/intérieur"
  if (/categories|usages|structure/.test(s)) return "usages";
  if (/dispositions|notes/.test(s)) return "other";
  return prev;
}

/**
 * Map a TERSE Nicolet norm label to a FieldId GIVEN the section it sits under —
 * the terse labels ("avant (m)", "largeur (m)") are ambiguous without it: "largeur"
 * is the terrain FRONTAGE under TERRAIN but the building width (unmapped) under
 * BÂTIMENT. Anti-over-mapping: "latérale sur rue" (a distinct margin), "profondeur",
 * "superficie d'implantation", "logement/bâtiment", "plancher/terrain (C.O.S.)" all
 * stay UNMAPPED (a wrong fold is worse than a null).
 */
function sectionedLabelToFieldId(label: string, section: GrilleSection): FieldId | null {
  const s = foldLabel(label);
  switch (section) {
    case "marges":
      if (/avant/.test(s)) return "marge_avant_min";
      if (/arriere/.test(s)) return "marge_arriere_min";
      if (/lateral/.test(s) && !/sur\s+rue/.test(s)) return "marge_laterale_min";
      return null;
    case "terrain":
      if (/superficie/.test(s)) return "superficie_min";
      if (/largeur/.test(s)) return "frontage_min";
      return null; // profondeur → unmapped
    case "batiment":
      if (/hauteur/.test(s) && /etage/.test(s)) return "hauteur_etages";
      if (/hauteur/.test(s) && /\(m\)|metre/.test(s)) return "hauteur_metres";
      return null; // largeur (building) · superficie d'implantation → unmapped
    case "rapports":
      if (/espace\s+bati\s*\/\s*terrain|emprise/.test(s)) return "densite";
      return null; // logement/bâtiment · plancher/terrain (C.O.S. — floor ratio) → unmapped
    default:
      return null;
  }
}

/** A norm value row carries a "min." / "max." bound cell; find its index (or -1). */
function boundCellIndex(cells: string[]): number {
  return cells.findIndex((c) => /^(min|max)\.?$/i.test(c.trim()));
}

/** Rank a value row's bound for a field (mirrors PREFERRED_BOUND: prefer the max
 *  sub-row for hauteur, the min sub-row for every dimensional minimum). */
function boundRank(field: FieldId, bound: string): number {
  const pref = PREFERRED_BOUND[field];
  if (!pref) return 1;
  const isMax = /max/i.test(bound);
  const isMin = /min/i.test(bound);
  if (pref === "max") return isMax ? 2 : isMin ? 0 : 1;
  return isMin ? 2 : isMax ? 0 : 1;
}

/**
 * Map ONE single-zone "grille des spécifications" page → [ZoneNorms] (0 or 1). The
 * zone is `opts.zoneCode` (native-text override) or the page's own "ZONE:" header;
 * with neither, nothing is emitted (anti-invention — no header, no zone). Every
 * norm's value is the LEFTMOST value column, run through the frozen per-cell guard.
 */
export function mapZoneHeaderGrillePage(
  markdown: string,
  page: number,
  opts: OcrMapOptions,
): ZoneNormsT[] {
  const methode = opts.methode ?? DEFAULT_OCR_METHODE;
  const zoneCode = opts.zoneCode ?? parseZoneHeader(markdown);
  if (!zoneCode) return [];

  const fields: Partial<Record<FieldId, string | null>> = {};
  const ranks: Partial<Record<FieldId, number>> = {};
  let section: GrilleSection = "other";

  for (const line of markdown.split("\n")) {
    const isTable = line.includes("|");
    const cells = isTable ? splitRow(line) : [line.replace(/[#*_`]/g, " ").trim()];
    if (isTable && isSeparatorRow(cells)) continue;
    const bi = isTable ? boundCellIndex(cells) : -1;
    if (bi < 0) {
      // Non-value row → it may set the section context (MARGES / TERRAIN / BÂTIMENT…).
      section = detectSection(cells.join(" "), section);
      continue;
    }
    const label = cells.slice(0, bi).join(" ");
    const field = sectionedLabelToFieldId(label, section);
    if (!field) continue;
    // LEFTMOST value column = the zone's representative use-case (frozen convention).
    const raw = cells[bi + 1];
    const val = raw && raw.trim().length ? raw.trim() : null;
    const rank = boundRank(field, cells[bi]!);
    const prev = ranks[field];
    if (prev === undefined) {
      fields[field] = val;
      ranks[field] = rank;
    } else if (rank > prev && val !== null) {
      fields[field] = val;
      ranks[field] = rank;
    }
  }

  const provenance = (): FieldProvenanceT => ({
    source_url: opts.source_url,
    methode,
    snapshot: opts.snapshot,
    page: `PAGE ${page} ZONE ${zoneCode}`,
  });
  const field = (id: FieldId): NormFieldT => {
    const spec = FIELD_SPECS.find((s) => s.id === id)!;
    const raw = fields[id] ?? null;
    return buildVisionField(spec, raw, raw, provenance());
  };
  const hauteurMetres = field("hauteur_metres");
  const hauteurEtages = field("hauteur_etages");
  const hauteurMax = hauteurMetres.value !== null ? hauteurMetres : hauteurEtages;
  const zn: ZoneNormsT = {
    zone_code: zoneCode,
    zone_page: `PAGE ${page} ZONE ${zoneCode}`,
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
  return [ZoneNorms.parse(zn)];
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
  // SINGLE-ZONE-per-page "grille des spécifications" (Nicolet-family): a "ZONE:
  // <code>" header + the numbered NORMES-PRESCRITES matrix. Route it to the
  // single-zone mapper (leftmost value column). Distinct from the transposed
  // (zones-in-columns) grid below — the transposed grilles carry no "ZONE:" header
  // and no NORMES-PRESCRITES band, so this never fires on them.
  if ((opts.zoneHeaderMode ?? "auto") !== "off") {
    const headerCode = opts.zoneCode ?? parseZoneHeader(markdown);
    if (headerCode && isNumberedGrilleSpec(markdown)) {
      return mapZoneHeaderGrillePage(markdown, page, { ...opts, zoneCode: headerCode });
    }
  }
  const tables = findGrilleTables(markdown);
  const out: ZoneNormsT[] = [];
  const seen = new Set<string>();
  for (const table of tables) {
    const codes = table.zoneCodes;
    const n = codes.length;
    const cols = table.zoneCols;
    const minCol = cols && cols.length ? Math.min(...cols) : -1;
    // For each zone column, collect its per-field verbatim cell text + the rank of
    // the sub-row that supplied it (so a "- maximum" row can override a "- minimum").
    const perZone = new Map<string, Partial<Record<FieldId, string | null>>>();
    const perRank = new Map<string, Partial<Record<FieldId, number>>>();
    for (const code of codes)
      if (!perZone.has(code)) {
        perZone.set(code, {});
        perRank.set(code, {});
      }
    // Section context for the QC 2-tier grille: the norm LABEL sits on its own row
    // ("Marge de recul avant minimale (mètres):") with EMPTY value cells, and the
    // VALUES follow one row below under "bâtiment principal" / "- maximum" / etc.
    // We carry the mapped field forward from the header row to those value rows.
    let section: FieldId | null = null;
    for (const row of table.rows) {
      let values: (string | undefined)[];
      let label: string;
      if (cols) {
        // Column-index aligned: read each zone's value at its header column; the
        // label is everything left of the first zone column.
        values = cols.map((ci) => row[ci]);
        label = row.slice(0, minCol).join(" ").trim();
      } else {
        // Text-line header (no columns) → right-align, as before.
        if (row.length < n + 1) continue;
        values = row.slice(row.length - n);
        label = row.slice(0, row.length - n).join(" ").trim();
      }
      const nonEmpty = values.filter((v) => v && v.trim().length).length;
      const ownField = labelToFieldId(label);

      // (1) A section-header row carries NO values on its own line: its label SETS
      //     the section context (or, mapping to nothing — a title like "Somme…" /
      //     "Hauteur du bâtiment principal:" — CLEARS it, closing the prior section).
      if (nonEmpty === 0) {
        section = ownField;
        continue;
      }
      // (2) A self-contained data row (label + values on one line — Sherbrooke-flat,
      //     the classic single-row grille) OR (3) a continuation value row under an
      //     open section (valcourt "bâtiment principal"). Resolve the field, then
      //     record each zone's verbatim cell (higher-ranked sub-row wins).
      const field = ownField ?? section;
      if (!field) continue;
      if (ownField) section = null; // a titled value row closes any open section
      const rank = subRowRank(label, field);
      codes.forEach((code, idx) => {
        const cell = values[idx];
        const val = cell && cell.trim().length ? cell : null;
        const fields = perZone.get(code)!;
        const ranks = perRank.get(code)!;
        const prev = ranks[field];
        if (prev === undefined) {
          // First read of this field (records null too, so an empty first cell is
          // a faithful "no value here" — matches the frozen first-seen semantics).
          fields[field] = val;
          ranks[field] = rank;
        } else if (rank > prev && val !== null) {
          // A higher-priority sub-row (e.g. a "maximum" over a "minimum") with a
          // real value overrides. Anti-invention: it only swaps WHICH verbatim cell.
          fields[field] = val;
          ranks[field] = rank;
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

/**
 * DETERMINISTIC NATIVE-TEXT ($0, no LLM) parser for the SAME single-zone numbered
 * "grille des spécifications" layout — the preferred path when the PDF carries a
 * real text layer (the Nicolet-family grilles are native text, not scans). It
 * reads `pdftotext -layout` output: the zone code from the "ZONE:" header and,
 * for each numbered norm row, the LEFTMOST value token AFTER its "min."/"max."
 * bound, section-disambiguated exactly like the OCR mapper. Avoids the OCR pitfall
 * entirely (mistral-ocr misreads the "I" prefix AND can read row labels as codes);
 * every value is a verbatim token, gated by the frozen `buildVisionField`.
 *
 * Returns [] when there is no "ZONE:" header (anti-invention: no header, no zone) —
 * the caller then falls back to OCR/vision for that page (image-only scan).
 */
export function parseNumberedGrilleNativePage(
  layoutText: string,
  page: number,
  opts: OcrMapOptions,
): ZoneNormsT[] {
  const methode = opts.methode ?? "native-text/grille-spec";
  const zoneCode = opts.zoneCode ?? parseZoneHeader(layoutText);
  if (!zoneCode) return [];

  const fields: Partial<Record<FieldId, string | null>> = {};
  const ranks: Partial<Record<FieldId, number>> = {};
  let section: GrilleSection = "other";

  for (const raw of layoutText.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    // A norm value row carries a standalone "min."/"max." bound (the word boundary +
    // lookahead keep "minimum"/"maximum" prose out). No bound → it may set the section.
    const bm = line.match(/(?:^|\s)(min|max)\.?(?=\s|$)/i);
    if (!bm) {
      section = detectSection(line, section);
      continue;
    }
    const label = line.slice(0, bm.index).trim();
    const field = sectionedLabelToFieldId(label, section);
    if (!field) continue;
    const after = line.slice((bm.index ?? 0) + bm[0].length);
    // LEFTMOST value column = the first numeric token (or a "-" absent marker) after
    // the bound. A row with no value tail (e.g. an empty "arrière" min) → null.
    const tok = after.match(/(-|\d+(?:[.,]\d+)?)/);
    const val = tok ? tok[1]! : null;
    const rank = boundRank(field, bm[1]!);
    const prev = ranks[field];
    if (prev === undefined) {
      fields[field] = val;
      ranks[field] = rank;
    } else if (rank > prev && val !== null) {
      fields[field] = val;
      ranks[field] = rank;
    }
  }

  const provenance = (): FieldProvenanceT => ({
    source_url: opts.source_url,
    methode,
    snapshot: opts.snapshot,
    page: `PAGE ${page} ZONE ${zoneCode}`,
  });
  const field = (id: FieldId): NormFieldT => {
    const spec = FIELD_SPECS.find((s) => s.id === id)!;
    const r = fields[id] ?? null;
    return buildVisionField(spec, r, r, provenance());
  };
  const hauteurMetres = field("hauteur_metres");
  const hauteurEtages = field("hauteur_etages");
  const hauteurMax = hauteurMetres.value !== null ? hauteurMetres : hauteurEtages;
  const zn: ZoneNormsT = {
    zone_code: zoneCode,
    zone_page: `PAGE ${page} ZONE ${zoneCode}`,
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
  return [ZoneNorms.parse(zn)];
}

/**
 * Map a whole OCR result (per page) back to ZoneNorms[], page numbers aligned.
 * `zoneCodes` (optional, aligned to `pages`) supplies a VERBATIM native-text zone
 * header per page for the single-zone "grille des spécifications" layout, so the
 * reliable text-layer code (e.g. "I01-132") overrides the OCR misread ("101-132").
 */
export function mapOcrResultToZones(
  result: OcrResult,
  pages: number[],
  opts: OcrMapOptions,
  zoneCodes?: (string | undefined)[],
): ZoneNormsT[] {
  const zones: ZoneNormsT[] = [];
  result.pages.forEach((p, idx) => {
    const zc = zoneCodes?.[idx];
    const pageOpts = zc ? { ...opts, zoneCode: zc } : opts;
    zones.push(...mapMarkdownPageToZones(p.markdown, pages[idx] ?? idx + 1, pageOpts));
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
  opts: OcrMapOptions & {
    ocr?: OcrCallImpl;
    costPerPage?: number;
    /** Verbatim native-text zone header per page (aligned to `pages`), for the
     *  single-zone "grille des spécifications" layout (overrides OCR misreads). */
    zoneCodes?: (string | undefined)[];
  },
): Promise<OcrPathResult> {
  const ocr = opts.ocr ?? createMistralOcrHttpCall(resolveOcrConfig());
  const costPerPage = opts.costPerPage ?? MISTRAL_OCR_USD_PER_PAGE;
  const { path: slicePath, cleanup } = await slicePdf(pdfPath, pages);
  try {
    const t0 = Date.now();
    const res = await ocr(slicePath);
    const latencyMs = Date.now() - t0;
    const zones = mapOcrResultToZones(res, pages, opts, opts.zoneCodes);
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
