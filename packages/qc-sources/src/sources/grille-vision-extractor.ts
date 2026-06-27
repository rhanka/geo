/**
 * grille-vision-extractor — OCR-VISION 2nd-pass for the Québec "grille des usages
 * et des normes" pages that the native-text horizontal parser
 * (`grille-specifications-parser.ts`) CANNOT read.
 *
 * WHY THIS EXISTS (design `docs/spec/normes-extraction-retenu.md` §3 routeur +
 * §5(iv); decision `docs/spec/normes-reglements-decisions.md` #4): the horizontal
 * parser handles Excel-generated grilles where zones are ROWS and norms are
 * COLUMNS (pilot Sherbrooke 1200). The MAJORITY of QC municipalities publish the
 * grille in the VERTICAL "1 zone / page" form — norm labels run down a rotated
 * left column, the zone(s) are columns, and cells use glyphs (◼/□). That layout
 * is native-text but `pdftotext -layout` returns a SCRAMBLED, un-tabular dump
 * (verified on the pilot below). A vision model reading the RENDERED PAGE
 * reconstructs the spatial table that text extraction loses.
 *
 * PILOT (vertical, native-text, 1 zone/page): Saint-Stanislas-de-Kostka,
 * Règlement de zonage 330-2018 — Annexe A "GRILLES DES USAGES ET NORMES PAR ZONE"
 *   https://st-stanislas-de-kostka.ca/assets/files/upload/annexes-reglement330.pdf
 * Each page carries a "ZONE (Plan général)" box naming the page's zone (e.g.
 * "A-2"); the leftmost value column is that zone.
 *
 * ANTI-INVENTION IS ABSOLUTE (MVP metric "0 norme fausse servie comme certaine").
 * The model is INSTRUCTED to return the VERBATIM cell text (unit included) and an
 * explicit `null` for any empty / illegible / ambiguous cell — never an inferred
 * or completed value. We then add three HARD guards on top of the model output:
 *
 *   1. DOUBLE-PASS CONCORDANCE (design §5(iv)): the page is read TWICE with two
 *      DIFFERENT prompts (so a prompt artefact does not reproduce). A field is
 *      eligible for publication ONLY when the two passes agree VERBATIM on the
 *      raw cell text. Divergence → value:null + flag:"divergence-2-passes"
 *      (never "take pass A" — a coin-flip is an invention).
 *   2. SEMANTIC UNIT TYPE-CHECK (design §6c): a "marge"/"hauteur" cell carrying an
 *      `m²` unit (or a "superficie" carrying a bare `m`) is a misread/décalage and
 *      is rejected even if the number is plausible.
 *   3. PLAUSIBILITY WINDOWS (design §5(iii)): hauteur 1–60 m, marge 0–30 m,
 *      superficie ≥150 m², frontage ≥6 m, étages 1–20, densité 0–100 %. A value
 *      outside its window is refused (null + flag).
 *
 * Confidence is PER FIELD = min(concordance, semantic, plausibility) ∈ {0, ~0.92}.
 * A field publishes its `value` only at/above PUBLISH_THRESHOLD; otherwise
 * value:null + flag + the verbatim `raw` is kept (never discarded). `methode` on
 * every field's provenance is "mistral-vision".
 *
 * The actual network call (`VisionCallImpl`) and the page renderer
 * (`RenderImpl`) are INJECTABLE so the whole pipeline is unit-testable with a
 * fixture response and NO network / poppler dependency in CI.
 *
 * WHY NOT REUSE graphify's Mistral wrapper. The graphify skill (`@sentropic/
 * graphify`, `/home/antoinefa/src/graphify`) delegates to the `mistral-ocr`
 * package, which hits Mistral's Document-AI `POST /v1/ocr` endpoint
 * (`client.ocr.process`, model `mistral-ocr-latest`). That endpoint returns
 * page MARKDOWN — it transcribes the document, it does NOT do prompt-driven
 * structured field extraction. On a VERTICAL grille the markdown is just the
 * same scrambled un-tabular dump (the table never linearises), so we would still
 * have to re-parse it — and, crucially, we could not impose the per-cell
 * anti-invention contract (explicit `null` for empty/ambiguous cells, verbatim
 * only). What we need is the chat/vision `image_url` path with a STRICT custom
 * prompt + `response_format: json_object` — and NO existing wrapper (graphify,
 * mistral-ocr, sentropic, radar) exposes that. So we call the Mistral chat API
 * directly, mirroring the in-repo `VoxtralTranscriber` contract (read
 * MISTRAL_API_KEY at call-time, injectable apiBase/model, never log the key).
 * Probed live 2026-06-21 on the pilot A-2 page: model returned
 * `{"zone":"A-2","avant_min":"7.5¹"}` — verbatim incl. the superscript — in ~2.5s
 * for ~2.1k prompt tokens.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  PUBLISH_THRESHOLD,
  ZoneNorms,
  normalizeUnit,
  type FieldProvenanceT,
  type NormFieldT,
  type NormUnitT,
  type ZoneNormsT,
} from "./grille-specifications-parser.js";

const execFileP = promisify(execFile);

// ───────────────────────────────────────────────────────────────────────────
//  Confidence a published vision field carries. Vision extraction is inherently
//  less certain than a structurally-verified native-text cell, so we cap it just
//  above the publish threshold: a field that survives BOTH passes' concordance +
//  the type/plausibility guards is trustworthy, but never asserted at 1.0.
// ───────────────────────────────────────────────────────────────────────────
export const VISION_PUBLISH_CONFIDENCE = 0.92;

/** The vision method tag stamped on every field's provenance. */
export const VISION_METHODE = "mistral-vision";

// ───────────────────────────────────────────────────────────────────────────
//  The fields we ask the vision model to read off ONE zone column, with the
//  semantic dimension + plausibility window each must satisfy (design §5/§6).
//  These mirror the ZoneNorms output shape.
// ───────────────────────────────────────────────────────────────────────────

type FieldId =
  | "hauteur_etages"
  | "hauteur_metres"
  | "marge_avant_min"
  | "marge_laterale_min"
  | "marge_arriere_min"
  | "frontage_min"
  | "superficie_min"
  | "densite";

interface FieldSpec {
  id: FieldId;
  /** Human label as it appears on the QC grille (used in the prompt). */
  label: string;
  /** Unit the column declares — passed as fallback to `normalizeUnit`. */
  fallbackUnit: NormUnitT;
  /** Semantic dimension the cell must carry (anti-décalage type-check). */
  semantic: "length" | "area" | "count" | "pct";
  /** Plausibility window [min, max] for a PUBLISHED value. */
  plausible: [number, number];
}

/**
 * The norm cells we extract from the named zone's column. Hauteur is published as
 * étages (`hauteur_etages`, a "x/y" min/max range string) and/or metres
 * (`hauteur_metres`); the ZoneNorms mapping below routes them into hauteur_max.
 */
const FIELD_SPECS: ReadonlyArray<FieldSpec> = [
  {
    id: "hauteur_etages",
    label: "Hauteur en étages min / max",
    fallbackUnit: "etages",
    semantic: "count",
    plausible: [1, 20],
  },
  {
    id: "hauteur_metres",
    label: "Hauteur en mètres min / max",
    fallbackUnit: "m",
    semantic: "length",
    plausible: [1, 60],
  },
  {
    id: "marge_avant_min",
    label: "Marge avant minimale (mètre)",
    fallbackUnit: "m",
    semantic: "length",
    plausible: [0, 30],
  },
  {
    id: "marge_laterale_min",
    label: "Marge latérale minimale (mètre)",
    fallbackUnit: "m",
    semantic: "length",
    plausible: [0, 30],
  },
  {
    id: "marge_arriere_min",
    label: "Marge arrière minimale (mètre)",
    fallbackUnit: "m",
    semantic: "length",
    plausible: [0, 30],
  },
  {
    id: "frontage_min",
    label: "Largeur frontale minimale du lot (mètre)",
    fallbackUnit: "m",
    semantic: "length",
    plausible: [6, 10000],
  },
  {
    id: "superficie_min",
    label: "Superficie minimale du lot (mètre carré)",
    fallbackUnit: "m2",
    semantic: "area",
    plausible: [150, 10_000_000],
  },
  {
    id: "densite",
    label: "Coefficient d'emprise au sol maximal (ou % d'occupation au sol)",
    fallbackUnit: null,
    semantic: "pct",
    plausible: [0, 100],
  },
];

// ───────────────────────────────────────────────────────────────────────────
//  Injectable seams (network + poppler) so the pipeline runs offline in tests.
// ───────────────────────────────────────────────────────────────────────────

/** What a single vision pass returns: the model's raw verbatim cell strings. */
export interface VisionRawExtraction {
  /** Verbatim text of the "ZONE (Plan général)" box, or null if not found. */
  zone_code: string | null;
  /** Verbatim usage categories named on the column (free, may be empty). */
  usages: string[];
  /** Per-field VERBATIM cell text, or null when empty/illegible/ambiguous. */
  fields: Partial<Record<FieldId, string | null>>;
}

/**
 * Injectable vision call: render-page-PNG-path + a pass index → raw extraction.
 * Production = `MistralVisionGrille.extract`. Tests = a function returning a
 * canned `VisionRawExtraction` (no network).
 */
export type VisionCallImpl = (
  imagePath: string,
  pass: 0 | 1,
  expectedZone: string | undefined,
) => Promise<VisionRawExtraction>;

/** Injectable page renderer: (pdfPath, pageNumber) → PNG file path. */
export type RenderImpl = (pdfPath: string, page: number) => Promise<string>;

// ───────────────────────────────────────────────────────────────────────────
//  Page renderer (poppler `pdftoppm`). Shelled out; injectable above.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Render ONE PDF page to a PNG at `dpi` (default 200) using poppler's pdftoppm.
 * Returns the PNG path inside a fresh temp dir the caller is responsible for
 * cleaning (the extractor cleans it). Never loads the whole PDF into memory.
 */
export async function renderPageToPng(
  pdfPath: string,
  page: number,
  dpi = 200,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "grille-vision-"));
  const prefix = join(dir, "page");
  // pdftoppm -png -r <dpi> -f <page> -l <page> <pdf> <prefix>
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
  // pdftoppm zero-pads the page suffix to the document's digit width; resolve it.
  const { stdout } = await execFileP("ls", [dir]);
  const png = stdout
    .split("\n")
    .map((s) => s.trim())
    .find((f) => f.startsWith("page") && f.endsWith(".png"));
  if (!png) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw new GrilleVisionError("render", `pdftoppm produced no PNG for page ${page}`);
  }
  return join(dir, png);
}

// ───────────────────────────────────────────────────────────────────────────
//  Prompts. TWO DIFFERENT prompts (one strict-tabular, one cell-by-cell) so the
//  two passes are genuinely independent reads — a prompt artefact in one is
//  unlikely to recur in the other, which is what makes concordance meaningful.
// ───────────────────────────────────────────────────────────────────────────

const FIELD_LINES = FIELD_SPECS.map((f) => `  - "${f.id}": ${f.label}`).join("\n");

const COMMON_RULES = `
RÈGLES ABSOLUES (anti-invention) :
- Donne la valeur EXACTE de la cellule, VERBATIM, telle qu'imprimée, unité incluse
  (ex: "7.5", "7,5 m", "1/2", "2787", "60", "0,3"). Ne convertis pas, ne complète pas.
- Si une cellule est VIDE, illisible, ambiguë, ou si tu n'es pas certain → renvoie null
  (le JSON null, pas la chaîne "null", pas 0, pas une estimation). null est TOUJOURS
  préférable à une valeur devinée.
- N'invente jamais une valeur. Ne déduis jamais à partir d'autres colonnes.
- Lis UNIQUEMENT la colonne de la zone "ZONE (Plan général)" (la colonne de gauche
  des valeurs). Ignore les autres colonnes de zones.

CHAMPS À EXTRAIRE (clé JSON : libellé de la ligne) :
${FIELD_LINES}
`;

function buildPromptA(expectedZone: string | undefined): string {
  const zoneHint = expectedZone
    ? `La page concerne la zone "${expectedZone}". Vérifie-le via la boîte "ZONE (Plan général)".`
    : `Lis le code de zone dans la boîte "ZONE (Plan général)".`;
  return `Tu lis une "grille des usages et des normes" municipale québécoise (format vertical, 1 zone par page).
${zoneHint}
${COMMON_RULES}
Réponds STRICTEMENT en JSON avec cette forme :
{
  "zone_code": <texte de la boîte ZONE, ou null>,
  "usages": [<catégories d'usage cochées, verbatim>],
  "fields": { "<id>": <verbatim cellule | null>, ... }
}`;
}

function buildPromptB(expectedZone: string | undefined): string {
  const zoneHint = expectedZone
    ? `Cette page documente la zone "${expectedZone}".`
    : `Identifie d'abord le code de zone.`;
  // Deliberately reworded + reordered framing for an independent second read.
  return `Analyse cellule par cellule cette fiche réglementaire d'urbanisme (Québec).
${zoneHint} Pour CHAQUE ligne de norme listée, recopie le contenu de la case
correspondante de la colonne de la zone, MOT POUR MOT, sans rien ajouter.
${COMMON_RULES}
Format de sortie JSON exigé :
{
  "zone_code": <code de zone ou null>,
  "usages": [<usages, verbatim>],
  "fields": { "<id>": <contenu exact de la case ou null>, ... }
}`;
}

// ───────────────────────────────────────────────────────────────────────────
//  Production vision call — Mistral chat/completions with an image (base64 data
//  URL). Mirrors the in-repo `VoxtralTranscriber` contract: reads MISTRAL_API_KEY
//  at call-time, injectable apiBase/model, never logs the key.
// ───────────────────────────────────────────────────────────────────────────

interface MistralChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class MistralVisionGrille {
  private readonly apiBase: string;
  private readonly model: string;

  constructor(opts: { apiBase?: string; model?: string } = {}) {
    this.apiBase = opts.apiBase ?? "https://api.mistral.ai";
    // Mistral Medium 3.x is the current vision flagship (pixtral-* is retired).
    this.model = opts.model ?? "mistral-medium-latest";
  }

  readonly extract: VisionCallImpl = async (
    imagePath: string,
    pass: 0 | 1,
    expectedZone: string | undefined,
  ): Promise<VisionRawExtraction> => {
    const apiKey = process.env["MISTRAL_API_KEY"];
    if (!apiKey) {
      throw new GrilleVisionError(
        "missing-api-key",
        "MISTRAL_API_KEY is not set in the environment",
      );
    }

    const bytes = await readFile(imagePath);
    const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
    const prompt = pass === 0 ? buildPromptA(expectedZone) : buildPromptB(expectedZone);

    const body = {
      model: this.model,
      // temperature 0 for the strict pass; a small bump for the second so the two
      // reads are not identical samples (design §3: "température/seed différent").
      temperature: pass === 0 ? 0 : 0.3,
      response_format: { type: "json_object" as const },
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: prompt },
            { type: "image_url" as const, image_url: dataUrl },
          ],
        },
      ],
    };

    const endpoint = `${this.apiBase}/v1/chat/completions`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new GrilleVisionError(
        "network",
        e instanceof Error ? e.message : String(e),
      );
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        // ignore
      }
      throw new GrilleVisionError("http", `HTTP ${res.status}: ${detail}`);
    }

    let json: MistralChatResponse;
    try {
      json = (await res.json()) as MistralChatResponse;
    } catch (e) {
      throw new GrilleVisionError(
        "parse",
        `response JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new GrilleVisionError("parse", "no message content in vision response");
    }
    return parseVisionContent(content);
  };
}

/**
 * Parse the model's JSON string into a normalised `VisionRawExtraction`. Tolerant
 * of a model that wraps the JSON in ```json fences. Anti-invention: anything we
 * cannot read becomes null (never a fabricated default).
 */
export function parseVisionContent(content: string): VisionRawExtraction {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new GrilleVisionError(
      "parse",
      `model did not return JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const rec = (obj ?? {}) as Record<string, unknown>;
  const zoneRaw = rec["zone_code"];
  const usagesRaw = rec["usages"];
  const fieldsRaw = (rec["fields"] ?? {}) as Record<string, unknown>;

  const fields: Partial<Record<FieldId, string | null>> = {};
  for (const spec of FIELD_SPECS) {
    const v = fieldsRaw[spec.id];
    fields[spec.id] =
      typeof v === "string" ? v : v === null || v === undefined ? null : String(v);
  }
  return {
    zone_code: typeof zoneRaw === "string" && zoneRaw.trim() ? zoneRaw.trim() : null,
    usages: Array.isArray(usagesRaw)
      ? usagesRaw.filter((u): u is string => typeof u === "string")
      : [],
    fields,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Guards: per-field concordance + semantic type-check + plausibility → NormField.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Canonicalise a zone CODE for cross-pass concordance (NOT for display — we keep
 * the verbatim form for that). Two faithful reads of the SAME zone box can differ
 * in surface form between the two independent passes: a leading "ZONE" label, the
 * "(Plan général)" suffix, or a space/dash/long-dash between the letters and the
 * number ("A-2" / "A 2" / "Zone A-2" / "A–2"). We strip those so the two reads
 * concord, while two reads of a GENUINELY different code ("A-2" / "A-3") stay
 * distinct → divergence → refuse (anti-invention preserved). Returns null for an
 * empty/absent code (so two null reads do NOT spuriously "agree" on a code).
 */
export function canonZoneCode(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const c = s
    .toUpperCase()
    .replace(/\bZONE\b/g, " ")
    .replace(/\(\s*PLAN\s+G[ÉE]N[ÉE]RAL\s*\)/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/([A-Z])\s+(\d)/g, "$1-$2")
    .replace(/\s+/g, "")
    .trim();
  return c.length > 0 ? c : null;
}

/** Normalise a verbatim cell for textual (glyph-level) comparison. */
function canonRaw(s: string | null | undefined): string {
  if (s === null || s === undefined) return "∅";
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    // unify the visually-identical "absent" markers so "—" and "-" concord
    .replace(/[—–]/g, "-");
}

/**
 * Concordance KEY for a cell, used to decide whether the two passes AGREE.
 *
 * Concordance is SEMANTIC, not glyph-level: a faithful read of the same cell can
 * legitimately differ in surface form between two independent passes — FR decimal
 * comma vs dot ("7,5" / "7.5"), a stray OCR mark on a superscript ("7.5'" /
 * "7.5"), trailing unit spacing. What must NOT differ is the MEANING. So we key on
 * the NORMALISED {value, unit} (or, for an empty cell, the absent marker), letting
 * verbatim `raw` differ while still publishing. A genuinely different number ("3"
 * vs "5") produces a different key → divergence → null (anti-invention preserved).
 *
 * Both null/absent reads share one key ("∅"); a parsed number keys as
 * "<value>:<unit>"; an unparseable-but-present cell keys on its canonical text so
 * two different notes still diverge.
 */
function concordKey(
  raw: string | null | undefined,
  fallbackUnit: NormUnitT,
): string {
  if (raw === null || raw === undefined || raw.trim() === "") return "∅";
  const n = normalizeUnit(raw, fallbackUnit);
  if (n.absent) return "∅";
  if (n.value === null) return `txt:${canonRaw(raw)}`;
  return `${n.value}:${n.unit ?? "?"}`;
}

function semanticUnitMatches(
  semantic: FieldSpec["semantic"],
  unit: NormUnitT,
): boolean {
  switch (semantic) {
    case "length":
      return unit === "m" || unit === null;
    case "area":
      return unit === "m2" || unit === null;
    case "count":
      return unit === "etages" || unit === null;
    case "pct":
      return unit === "pct" || unit === null;
    default:
      return true;
  }
}

/**
 * Build ONE guarded NormField from the two passes' verbatim cell strings.
 *
 * Decision order (each failure → value:null + a specific flag, raw KEPT):
 *   a. concordance — the two passes must agree verbatim on the cell text.
 *   b. parse — the cell must yield a finite number (a "x/y" étage range parses
 *      its first number; a pure note / cross-ref → null).
 *   c. semantic — the cell's explicit unit must fit the field's dimension.
 *   d. plausibility — the value must sit inside the field's window.
 * Only when all pass does `value` publish at VISION_PUBLISH_CONFIDENCE.
 */
export function buildVisionField(
  spec: FieldSpec,
  rawA: string | null | undefined,
  rawB: string | null | undefined,
  provenance: FieldProvenanceT,
): NormFieldT {
  // The verbatim text we keep is pass A's (or B's when A is null/empty).
  const raw = (rawA ?? rawB ?? "").toString();

  // GUARD a — SEMANTIC concordance of the two independent reads (value+unit, not
  // glyph; see concordKey). Different MEANING → refuse (anti-invention).
  if (concordKey(rawA, spec.fallbackUnit) !== concordKey(rawB, spec.fallbackUnit)) {
    return {
      value: null,
      raw,
      unit: null,
      confidence: 0,
      flag: "divergence-2-passes",
      _provenance: provenance,
    };
  }

  const norm = normalizeUnit(raw, spec.fallbackUnit);

  // A concordant but explicitly-absent cell ("—"/"s.o."/empty) → null, NOT a
  // refusal: it is a faithful read of an empty cell (confidence in the read is
  // high, but there is simply no value).
  if (norm.value === null) {
    return {
      value: null,
      raw,
      unit: norm.unit,
      confidence: norm.absent ? VISION_PUBLISH_CONFIDENCE : 0,
      flag: norm.absent ? "absent" : "non-numerique",
      _provenance: provenance,
    };
  }

  // GUARD c — semantic unit type-check (anti-décalage / misread).
  if (!semanticUnitMatches(spec.semantic, norm.unit)) {
    return {
      value: null,
      raw,
      unit: norm.unit,
      confidence: 0,
      flag: "unite-incoherente",
      _provenance: provenance,
    };
  }

  // GUARD d — plausibility window.
  const [lo, hi] = spec.plausible;
  if (norm.value < lo || norm.value > hi) {
    return {
      value: null,
      raw,
      unit: norm.unit,
      confidence: 0,
      flag: "hors-plage",
      _provenance: provenance,
    };
  }

  return {
    value: norm.value,
    raw,
    unit: norm.unit,
    confidence: VISION_PUBLISH_CONFIDENCE,
    _provenance: provenance,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Top-level: extract ONE zone-page's ZoneNorms via the 2-pass vision pipeline.
// ───────────────────────────────────────────────────────────────────────────

export interface VisionExtractOptions {
  source_url: string;
  snapshot: string;
  /** Expected zone code for this page (from the page's "ZONE" box / discovery). */
  expectedZone?: string;
  /** Injected vision call (defaults to a live Mistral call). */
  vision?: VisionCallImpl;
}

/**
 * Run the 2-pass vision extraction over an already-rendered page IMAGE and return
 * a guarded `ZoneNorms`. `imagePath` is a PNG of one grille page; `vision` is the
 * injected (or live) two-pass model call.
 */
export async function extractZonePageFromImage(
  imagePath: string,
  opts: VisionExtractOptions,
): Promise<ZoneNormsT> {
  const vision = opts.vision ?? new MistralVisionGrille().extract;

  const passA = await vision(imagePath, 0, opts.expectedZone);
  const passB = await vision(imagePath, 1, opts.expectedZone);

  // Zone code: trust it only if BOTH passes agree (and, when provided, it matches
  // the expected zone). Otherwise fall back to the expected zone, or refuse.
  // Concordance is on the CANONICAL code (canonZoneCode), not glyph-level, so a
  // "Zone A-2" / "A 2" / "A-2" surface difference between the two passes still
  // concords while a genuinely different code refuses — we keep pass A's verbatim
  // form for display.
  const zoneCanonA = canonZoneCode(passA.zone_code);
  const zoneConcord =
    zoneCanonA !== null && zoneCanonA === canonZoneCode(passB.zone_code)
      ? passA.zone_code
      : null;
  const zoneCode = zoneConcord ?? opts.expectedZone ?? null;
  if (!zoneCode) {
    throw new GrilleVisionError(
      "no-zone",
      "could not determine zone_code (passes disagree and no expectedZone given)",
    );
  }

  const provenance = (): FieldProvenanceT => ({
    source_url: opts.source_url,
    methode: VISION_METHODE,
    snapshot: opts.snapshot,
    page: `ZONE ${zoneCode}`,
  });

  const field = (id: FieldId): NormFieldT => {
    const spec = FIELD_SPECS.find((s) => s.id === id)!;
    return buildVisionField(spec, passA.fields[id], passB.fields[id], provenance());
  };

  // Hauteur: prefer the métres field when it publishes; else fall back to étages.
  const hauteurMetres = field("hauteur_metres");
  const hauteurEtages = field("hauteur_etages");
  const hauteurMax = hauteurMetres.value !== null ? hauteurMetres : hauteurEtages;

  // Usages: keep only those both passes named (verbatim, order-insensitive).
  const usagesA = new Set(passA.usages.map(canonRaw));
  const usages = passB.usages.filter((u) => usagesA.has(canonRaw(u)));

  const zn: ZoneNormsT = {
    zone_code: zoneCode,
    zone_page: `ZONE ${zoneCode}`,
    usages,
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
  return ZoneNorms.parse(zn);
}

/**
 * Full pipeline from a PDF page: render → 2-pass vision → guarded ZoneNorms.
 * The temp render dir is cleaned afterwards. `render` is injectable for tests.
 */
export async function extractZonePageFromPdf(
  pdfPath: string,
  page: number,
  opts: VisionExtractOptions & { render?: RenderImpl; dpi?: number },
): Promise<ZoneNormsT> {
  const render: RenderImpl =
    opts.render ?? ((p, n) => renderPageToPng(p, n, opts.dpi ?? 200));
  const imagePath = await render(pdfPath, page);
  try {
    return await extractZonePageFromImage(imagePath, opts);
  } finally {
    // Clean the temp dir the renderer created (best-effort).
    const dir = imagePath.replace(/\/[^/]+$/, "");
    if (dir.includes("grille-vision-")) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

// Re-export the field specs for tests / callers that want the plausibility table.
export { FIELD_SPECS };
export type { FieldId, FieldSpec };

// ───────────────────────────────────────────────────────────────────────────
//  Error type (mirrors VoxtralTranscriberError).
// ───────────────────────────────────────────────────────────────────────────

export type GrilleVisionErrorKind =
  | "missing-api-key"
  | "network"
  | "http"
  | "parse"
  | "render"
  | "no-zone";

export class GrilleVisionError extends Error {
  constructor(
    readonly kind: GrilleVisionErrorKind,
    readonly detail: string,
  ) {
    super(`[grille-vision:${kind}] ${detail}`);
    this.name = "GrilleVisionError";
  }
}
