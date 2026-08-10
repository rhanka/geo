/**
 * grille-mistral-schema — DETERMINISTIC Mistral OCR + `document_annotation` route.
 *
 * WHY THIS EXISTS
 * ---------------
 * The plain Document-AI OCR path (`grille-ocr-extractor.ts`, mistral-ocr → markdown
 * → guarded ZoneNorms) SHATTERS the wide TRANSPOSED "grille des spécifications"
 * family — zones in COLUMNS with a detached bottom "NORMES D'IMPLANTATION" block
 * (MRC Antoine-Labelle / ferme-neuve). The markdown table loses the column↔norm
 * alignment, so the mapper publishes 0% norm fields even though the grille is dense.
 *
 * This module wires the SECOND Mistral `/v1/ocr` mode — `document_annotation_format`
 * with a per-zone JSON SCHEMA (one property per norm) — as a cheap ($0.003/page)
 * deterministic fallback. Instead of markdown, Mistral fills the schema directly:
 * one object per zone-column with the VERBATIM cell string (or null) for each of the
 * 8 norms. This was proven feasible in the ferme-neuve bench (`acquisition/work/
 * fn-bench/bench.ts`, "Variant B"); that harness never persisted its output — this
 * module makes it a committed, tested, depositable route.
 *
 * ANTI-INVENTION IS INHERITED WHOLE, UNCHANGED
 * --------------------------------------------
 * The schema asks Mistral for the EXACT cell text (unit included) or an explicit
 * `null` for any empty/illegible/ambiguous cell — never an inferred value. Each
 * returned cell is then run through the FROZEN `buildVisionField` guard (parse →
 * semantic unit type-check → plausibility window) via `mapClaudeExtractionToZones`
 * (the EXACT same guarded mapper Engine B / the OCR path use). The schema read is a
 * single pass, so the guard sees the same cell string as both passes (concordance
 * auto-holds; the parse/semantic/plausibility guards gate as everywhere else). No new
 * normalisation, no guessing, no fabricated defaults — `null` beats a guessed value.
 *
 * The OCR-annotate HTTP call, the PDF slicer and the cost/page are all INJECTABLE so
 * the schema + mapper reuse are unit-testable with a canned annotation and NO network
 * / poppler dependency. The API key is read at call-time and NEVER logged.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";

import {
  FIELD_SPECS,
  type FieldId,
} from "../../../packages/qc-sources/src/sources/grille-vision-extractor.js";
import {
  resolveOcrConfig,
  slicePdf,
  type OcrProviderConfig,
} from "../../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import type { ZoneNormsT } from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import {
  mapClaudeExtractionToZones,
  type ClaudeRawExtraction,
} from "./grille-claude-cli.js";

/** Provenance `methode` tag stamped on every field this route publishes. */
export const SCHEMA_METHODE = "ocr/mistral-schema";
/**
 * $ per processed page for the OCR + document_annotation mode. The plain OCR list
 * price is $0.001/page (`MISTRAL_OCR_USD_PER_PAGE`); the structured-annotation
 * surcharge brings it to ~$0.003/page (benched estimate). Overridable per call.
 */
export const MISTRAL_SCHEMA_USD_PER_PAGE = 0.003;
/** `document_annotation` is capped at 8 pages per `/v1/ocr` request → chunk. */
export const SCHEMA_MAX_PAGES_PER_REQUEST = 8;
const MISTRAL_SCHEMA_PROVIDER = "mistral-ocr";
const MISTRAL_SCHEMA_API_BASE = "https://api.mistral.ai";
const MISTRAL_SCHEMA_API_PATH = "/v1/ocr";

// ───────────────────────────────────────────────────────────────────────────
//  JSON schema — one array of zones; one property per FROZEN norm field. Built
//  from FIELD_SPECS so this route reads the EXACT same 8 norms as every engine.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The `json_schema` handed to Mistral's `document_annotation_format`. One entry per
 * zone (read off the COLUMN headers of the transposed grille); one nullable string
 * property per norm field id + the verbatim `zone_code`. `strict: true` + all fields
 * `required` force Mistral to emit an explicit `null` for a cell it cannot read
 * rather than omit it — the anti-invention contract the guard then enforces.
 */
export function buildAnnotationSchema(): Record<string, unknown> {
  const props: Record<string, unknown> = {
    zone_code: {
      type: "string",
      description:
        "code de zone VERBATIM. Grille TRANSPOSÉE : l'en-tête de colonne (ex: COM-01, FOR-12). " +
        "Grille d'UNE SEULE ZONE PAR PAGE : la boîte de titre « Zone : XXX » (ex: AD-102). " +
        "JAMAIS un numéro de colonne de classe d'usages (1, 2, 3, 4) ni un numéro de ligne.",
    },
  };
  for (const spec of FIELD_SPECS) {
    props[spec.id] = {
      type: ["string", "null"],
      description: `${spec.label} — valeur EXACTE de la cellule, VERBATIM (unité incluse), sinon null`,
    };
    // ROUND-TRIP anchor (design §6b): the VERBATIM printed label the value was
    // read from. A label naming another object ("Dimension minimum (façade)" for
    // a LOT width) lets the mapper refuse a plausible-but-misrowed value.
    props[`${spec.id}__libelle`] = {
      type: ["string", "null"],
      description:
        `Libellé EXACT, VERBATIM, de la LIGNE (ou de l'en-tête) d'où provient "${spec.id}" ` +
        `— recopie l'intitulé imprimé tel quel ; null si la valeur est null.`,
    };
    // MULTI-COLONNES (design §6a). Quand une grille « 1 zone par page » range ses
    // normes en COLONNES DE CLASSES D'USAGES, la norme n'est pas une propriété de
    // la zone seule : marge avant 6 m (habitation) vs 10 m (agricole). Ce canal
    // rend la divergence VISIBLE pour que le mapper la refuse au lieu de servir
    // silencieusement la première colonne.
    props[`${spec.id}__colonnes`] = {
      type: ["string", "null"],
      description:
        `Toutes les valeurs imprimées de la ligne "${spec.id}", UNE PAR COLONNE NON VIDE, ` +
        `VERBATIM, séparées par " | " (ex: "6 | 10"). Une seule colonne remplie → une seule ` +
        `valeur. Aucune valeur → null. N'harmonise pas, ne choisis pas.`,
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      zones: {
        type: "array",
        description:
          "Une entrée par CODE DE ZONE lu dans les EN-TÊTES DE COLONNE de la grille transposée. " +
          "Descends CHAQUE colonne indépendamment ; n'invente jamais, ne déduis jamais depuis une autre colonne. " +
          "CAS PARTICULIER — grille d'UNE seule zone dont les colonnes sont des CLASSES D'USAGES " +
          "(colonnes numérotées 1, 2, 3…) : émets UNE ENTRÉE PAR COLONNE NON VIDE, toutes portant " +
          "le MÊME zone_code — celui de la boîte « Zone : XXX », JAMAIS le numéro de colonne. " +
          "Ne fusionne pas les colonnes toi-même (le lecteur refuse les normes qui divergent " +
          "d'une classe à l'autre).",
        items: {
          type: "object",
          additionalProperties: false,
          properties: props,
          required: [
            "zone_code",
            ...FIELD_SPECS.flatMap((f) => [f.id, `${f.id}__libelle`, `${f.id}__colonnes`]),
          ],
        },
      },
    },
    required: ["zones"],
  };
}

/** Runtime counterpart of the JSON schema sent to Mistral. */
function annotationResponseSchema(): z.ZodType<unknown> {
  const fields: Record<string, z.ZodTypeAny> = { zone_code: z.string() };
  for (const spec of FIELD_SPECS) {
    fields[spec.id] = z.string().nullable();
    fields[`${spec.id}__libelle`] = z.string().nullable();
    fields[`${spec.id}__colonnes`] = z.string().nullable();
  }
  return z.object({ zones: z.array(z.object(fields).strict()) }).strict();
}

/** Reject a malformed provider annotation before a guarded mapper sees it. */
export function parseMistralSchemaAnnotation(raw: unknown): unknown {
  const result = annotationResponseSchema().safeParse(raw);
  if (!result.success) {
    throw new Error(`mistral-schema annotation invalid: ${result.error.issues[0]?.message ?? "unknown schema error"}`);
  }
  return result.data;
}

/** This route must never inherit a generic or self-hosted OCR provider override. */
export function assertMistralSchemaConfig(config: OcrProviderConfig): void {
  if (config.provider !== MISTRAL_SCHEMA_PROVIDER) {
    throw new Error(`mistral-schema requires provider ${MISTRAL_SCHEMA_PROVIDER}, got ${config.provider}`);
  }
  if (config.apiBase !== MISTRAL_SCHEMA_API_BASE || config.apiPath !== MISTRAL_SCHEMA_API_PATH) {
    throw new Error(`mistral-schema requires ${MISTRAL_SCHEMA_API_BASE}${MISTRAL_SCHEMA_API_PATH}`);
  }
  if (!/^mistral-ocr(?:-|$)/.test(config.model)) {
    throw new Error(`mistral-schema requires a Mistral OCR model, got ${config.model}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Annotation → ClaudeRawExtraction (verbatim-or-null). Reuses the SAME shape the
//  guarded mapper consumes, so anti-invention is inherited whole.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Normalise Mistral's `document_annotation` object into a `ClaudeRawExtraction`.
 * A non-string / empty / missing cell becomes `null` (never a fabricated default);
 * `zone_code` with no readable text becomes `null` and is dropped downstream.
 */
export function extractionFromAnnotationZones(raw: unknown): ClaudeRawExtraction {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const zonesRaw = Array.isArray(rec["zones"]) ? (rec["zones"] as unknown[]) : [];
  const zones: ClaudeRawExtraction["zones"] = [];
  for (const zr of zonesRaw) {
    const z = (zr ?? {}) as Record<string, unknown>;
    const codeRaw = z["zone_code"];
    const code =
      typeof codeRaw === "string" && codeRaw.trim() ? codeRaw.trim() : null;
    const fields: Partial<Record<FieldId, string | null>> = {};
    const labels: Partial<Record<FieldId, string | null>> = {};
    const columns: Partial<Record<FieldId, string | null>> = {};
    for (const spec of FIELD_SPECS) {
      const v = z[spec.id];
      fields[spec.id] = typeof v === "string" && v.trim() ? v : null;
      const l = z[`${spec.id}__libelle`];
      labels[spec.id] = typeof l === "string" && l.trim() ? l : null;
      const c = z[`${spec.id}__colonnes`];
      columns[spec.id] = typeof c === "string" && c.trim() ? c : null;
    }
    zones.push({ zone_code: code, fields, labels, columns });
  }
  return { zones };
}

// ───────────────────────────────────────────────────────────────────────────
//  Injectable OCR-annotate seam (so the pipeline runs offline in tests).
// ───────────────────────────────────────────────────────────────────────────

export interface SchemaAnnotateResult {
  /** Parsed `document_annotation` object (already `JSON.parse`d if it came back as a string). */
  annotation: unknown;
  /** Pages actually billed by the backend (drives the real $ cost). */
  pagesProcessed: number;
}

/** One OCR+annotation read of a sliced PDF: (slicePath, 0-based pageIdxs) → annotation. */
export type SchemaAnnotateCall = (
  slicePath: string,
  pageIdxs: number[],
) => Promise<SchemaAnnotateResult>;

/** Injectable PDF slicer (defaults to the frozen `slicePdf`). */
export type SlicePdfImpl = (
  pdfPath: string,
  pages: number[],
) => Promise<{ path: string; cleanup: () => Promise<void> }>;

/**
 * Production annotate call: POST `${apiBase}${apiPath}` with the Mistral Document-AI
 * body + `document_annotation_format:{type:"json_schema", json_schema:{…, strict:true}}`.
 * Reads `config.apiKey` at call-time; NEVER logs it. `fetchImpl` is injectable.
 */
export function createMistralSchemaAnnotateCall(
  config: OcrProviderConfig = resolveOcrConfig(),
  fetchImpl: typeof fetch = fetch,
): SchemaAnnotateCall {
  assertMistralSchemaConfig(config);
  const schema = buildAnnotationSchema();
  return async (slicePath: string, pageIdxs: number[]): Promise<SchemaAnnotateResult> => {
    if (!config.apiKey) {
      throw new Error(
        `mistral-schema: no API key for provider "${config.provider}" (set OCR_API_KEY or MISTRAL_API_KEY)`,
      );
    }
    const bytes = await readFile(slicePath);
    const body = {
      model: config.model,
      document: {
        type: "document_url" as const,
        document_url: `data:application/pdf;base64,${bytes.toString("base64")}`,
      },
      pages: pageIdxs,
      document_annotation_format: {
        type: "json_schema",
        json_schema: { name: "grille_transposee", schema, strict: true },
      },
      include_image_base64: false,
    };
    const endpoint = `${config.apiBase}${config.apiPath}`;
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(`mistral-schema HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const da = json["document_annotation"];
    const annotation = parseMistralSchemaAnnotation(typeof da === "string" ? JSON.parse(da) : da);
    const pagesProcessed =
      (json["usage_info"] as { pages_processed?: number } | undefined)?.pages_processed ??
      pageIdxs.length;
    return { annotation, pagesProcessed };
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Top-level: extract a bounded page set's ZoneNorms via the schema route.
// ───────────────────────────────────────────────────────────────────────────

export interface SchemaExtractOptions {
  source_url: string;
  snapshot: string;
  /** Provenance methode (default `ocr/mistral-schema`). */
  methode?: string;
  /** Injected annotate call (defaults to the live `/v1/ocr` document_annotation call). */
  annotate?: SchemaAnnotateCall;
  /** Injected PDF slicer (defaults to the frozen `slicePdf`). */
  slice?: SlicePdfImpl;
  /** $ per processed page (default `MISTRAL_SCHEMA_USD_PER_PAGE`). */
  costPerPage?: number;
  /** Pages per `/v1/ocr` request (default 8 — the document_annotation cap). */
  maxPagesPerRequest?: number;
}

export interface SchemaExtractResult {
  /** Flat guarded ZoneNorms across every chunk (caller merges by zone_code). */
  zones: ZoneNormsT[];
  pagesProcessed: number;
  usd: number;
  latencyMs: number;
  chunksRead: number;
  chunksFailed: number;
  reasons: string[];
}

/**
 * Slice `pages` (1-based) into ≤8-page chunks, OCR+annotate each, map every chunk's
 * annotation → guarded ZoneNorms via `mapClaudeExtractionToZones` (buildVisionField
 * on every cell). One failing chunk is skipped with a reason (never aborts the run).
 * Returns the FLAT zone list — the caller merges by zone_code (more-published wins)
 * and applies the anti-invention gates + deposit.
 */
export async function extractGrilleSchemaFromPdf(
  pdfPath: string,
  pages: number[],
  opts: SchemaExtractOptions,
): Promise<SchemaExtractResult> {
  const annotate = opts.annotate ?? createMistralSchemaAnnotateCall();
  const slice = opts.slice ?? slicePdf;
  const costPerPage = opts.costPerPage ?? MISTRAL_SCHEMA_USD_PER_PAGE;
  const step = opts.maxPagesPerRequest ?? SCHEMA_MAX_PAGES_PER_REQUEST;
  const methode = opts.methode ?? SCHEMA_METHODE;

  const t0 = Date.now();
  const zones: ZoneNormsT[] = [];
  const reasons: string[] = [];
  let pagesProcessed = 0;
  let chunksRead = 0;
  let chunksFailed = 0;

  for (let i = 0; i < pages.length; i += step) {
    const chunk = pages.slice(i, i + step);
    let cleanup: (() => Promise<void>) | null = null;
    try {
      const sliced = await slice(pdfPath, chunk);
      cleanup = sliced.cleanup;
      // `pages` in the /v1/ocr body is 0-based WITHIN the sliced document.
      const pageIdxs = chunk.map((_, k) => k);
      const { annotation, pagesProcessed: pp } = await annotate(sliced.path, pageIdxs);
      pagesProcessed += pp;
      const extraction = extractionFromAnnotationZones(parseMistralSchemaAnnotation(annotation));
      // Provenance page anchor = the chunk's first real (1-based) PDF page.
      zones.push(
        ...mapClaudeExtractionToZones(extraction, chunk[0]!, {
          source_url: opts.source_url,
          snapshot: opts.snapshot,
          methode,
        }),
      );
      chunksRead++;
    } catch (e) {
      chunksFailed++;
      reasons.push(
        `pages ${chunk[0]}-${chunk[chunk.length - 1]}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`,
      );
    } finally {
      if (cleanup) await cleanup();
    }
  }

  return {
    zones,
    pagesProcessed,
    usd: pagesProcessed * costPerPage,
    latencyMs: Date.now() - t0,
    chunksRead,
    chunksFailed,
    reasons,
  };
}
