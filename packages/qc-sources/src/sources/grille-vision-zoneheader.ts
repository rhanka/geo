/**
 * grille-vision-zoneheader — per-page CHAT-VISION extractor for the ONE-ZONE-PER-PAGE
 * "grille des spécifications" gabarit (voie B). Each page documents a SINGLE zone
 * named in a per-page header ("GRILLE DES SPÉCIFICATIONS  ZONE: Ha-102" / an isolated
 * corner "M-1"), with a norm matrix of several use-case VALUE COLUMNS running down.
 *
 * WHY VISION HERE (not the OCR path). The residual `zones-done / normes-non-done`
 * queue is dominated by this layout, and the ONE bounded Document-AI `/v1/ocr` call
 * the OCR path makes over a 200–600-page bylaw both overflows the page cap and,
 * empirically, 400s / misreads (a serif "I" prefix read as "1", row labels read as
 * codes). A SMALL per-page chat-vision call over the BOUNDED annex (see
 * `grille-zoneheader-locator`) reads one rendered page reliably — the same win the
 * single-zone vertical extractor already banks on saint-stanislas — while staying
 * inside the model's per-request limits.
 *
 * MAXIMAL REUSE / ANTI-INVENTION INHERITED WHOLE. This module adds NO new guard: it
 * only supplies a PROMPT tuned to the ZONE-header layout and delegates every gate to
 * the frozen single-zone pipeline (`extractZonePageFromImage` →
 *   2-pass concordance → parse → semantic unit type-check → plausibility window,
 *   via `buildVisionField`, `FIELD_SPECS`, the `ZoneNorms` schema).
 * The zone code is pinned from the reliable NATIVE-text header (`expectedZone`), so a
 * vision misread of a serif "I"/"1" prefix can never mint a wrong code. A cell that
 * is empty / a note / out-of-range / wrong-unit → null, never a fabrication.
 */
import { readFile } from "node:fs/promises";

import { assertVisionModelAllowed } from "./vision-engine-policy.js";

import {
  GrilleVisionError,
  parseVisionContent,
  extractZonePageFromPdf,
  FIELD_SPECS,
  type VisionCallImpl,
  type VisionRawExtraction,
  type VisionExtractOptions,
  type RenderImpl,
} from "./grille-vision-extractor.js";
import { type ZoneNormsT } from "./grille-specifications-parser.js";

// ───────────────────────────────────────────────────────────────────────────
//  Prompts — two INDEPENDENT reads (strict-tabular / cell-by-cell), same anti-
//  invention contract as the single-zone module, framed for the ZONE-header layout
//  with several use-case value columns (publish the LEFTMOST value column).
// ───────────────────────────────────────────────────────────────────────────

const FIELD_LINES = FIELD_SPECS.map((f) => `  - "${f.id}": ${f.label}`).join("\n");

const ZH_COMMON_RULES = `
RÈGLES ABSOLUES (anti-invention) :
- Donne la valeur EXACTE de la cellule, VERBATIM, telle qu'imprimée, unité incluse
  (ex: "7,3", "10", "3000", "0,3", "1/2"). Ne convertis pas, ne complète pas.
- Si une cellule est VIDE, illisible, "—", "s.o.", ambiguë, ou si tu n'es pas certain
  → renvoie le JSON null (pas "null", pas 0, pas une estimation). null est TOUJOURS
  préférable à une valeur devinée. N'invente jamais, ne déduis jamais d'une colonne.
- La grille documente UNE SEULE zone, nommée dans l'en-tête ("ZONE: <code>" ou un code
  isolé en haut à droite). Recopie ce code EXACTEMENT ; distingue le "I" majuscule
  serif du chiffre "1" (ex: "I01-132" n'est PAS "101-132").
- Une même norme peut avoir PLUSIEURS colonnes de valeurs (variantes d'usage a/b/c).
  Lis TOUJOURS la colonne de valeurs la PLUS À GAUCHE comme valeur représentative.

CHAMPS À EXTRAIRE (clé JSON : id de la ligne) :
${FIELD_LINES}
`;

function buildZhPromptA(expectedZone: string | undefined): string {
  const hint = expectedZone
    ? `La page documente la zone "${expectedZone}". Confirme-le via l'en-tête.`
    : `Lis le code de zone dans l'en-tête (haut de la grille).`;
  return `Tu lis une "grille des spécifications" municipale québécoise (une seule zone par page).
${hint}
${ZH_COMMON_RULES}
Réponds STRICTEMENT en JSON avec cette forme :
{
  "zone_code": <code de l'en-tête, ou null>,
  "usages": [<catégories d'usage autorisées, verbatim>],
  "fields": { "<id>": <verbatim cellule colonne gauche | null>, ... }
}`;
}

function buildZhPromptB(expectedZone: string | undefined): string {
  const hint = expectedZone
    ? `Cette fiche concerne la zone "${expectedZone}".`
    : `Identifie d'abord le code de zone en en-tête.`;
  // Deliberately reworded + reordered for a genuinely independent second read.
  return `Analyse ligne par ligne cette fiche réglementaire d'urbanisme (Québec, grille des
spécifications, une zone par page). ${hint} Pour CHAQUE ligne de norme listée, recopie MOT
POUR MOT le contenu de la première case de valeur (colonne la plus à gauche), sans rien ajouter.
${ZH_COMMON_RULES}
Format de sortie JSON exigé :
{
  "zone_code": <code de zone ou null>,
  "usages": [<usages autorisés, verbatim>],
  "fields": { "<id>": <contenu exact de la case gauche | null>, ... }
}`;
}

// ───────────────────────────────────────────────────────────────────────────
//  Production vision call — Mistral chat/completions with the rendered page image.
//  Same contract as MistralVisionGrille (reads MISTRAL_API_KEY at call-time,
//  injectable apiBase/model, never logs the key). Implements `VisionCallImpl` so it
//  drops straight into the frozen `extractZonePageFromImage` pipeline.
// ───────────────────────────────────────────────────────────────────────────

interface MistralChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class MistralVisionZoneHeader {
  private readonly apiBase: string;
  private readonly model: string;

  constructor(opts: { apiBase?: string; model?: string } = {}) {
    this.apiBase = opts.apiBase ?? "https://api.mistral.ai";
    // BANNED: mistral-medium-latest (ADR-0024) — no default, guard hard-fails it.
    this.model = assertVisionModelAllowed(opts.model);
  }

  readonly extract: VisionCallImpl = async (
    imagePath: string,
    pass: 0 | 1,
    expectedZone: string | undefined,
  ): Promise<VisionRawExtraction> => {
    const apiKey = process.env["MISTRAL_API_KEY"];
    if (!apiKey) {
      throw new GrilleVisionError("missing-api-key", "MISTRAL_API_KEY is not set");
    }
    const bytes = await readFile(imagePath);
    const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
    const prompt = pass === 0 ? buildZhPromptA(expectedZone) : buildZhPromptB(expectedZone);
    const body = {
      model: this.model,
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
    let res: Response;
    try {
      res = await fetch(`${this.apiBase}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new GrilleVisionError("network", e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new GrilleVisionError("http", `HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    let json: MistralChatResponse;
    try {
      json = (await res.json()) as MistralChatResponse;
    } catch (e) {
      throw new GrilleVisionError("parse", `response JSON parse: ${e instanceof Error ? e.message : String(e)}`);
    }
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new GrilleVisionError("parse", "no message content in vision response");
    }
    return parseVisionContent(content);
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Top-level: extract ONE one-zone-per-page grille page → guarded ZoneNorms via the
//  frozen 2-pass pipeline, using the ZONE-header-tuned vision call.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Render a one-zone-per-page grille page and run the frozen 2-pass vision pipeline
 * with the ZONE-header-tuned prompt. `expectedZone` (the reliable NATIVE-text header
 * code) pins the zone; a higher `dpi` sharpens dense scans. Returns a guarded
 * `ZoneNorms`. Delegates ALL guard logic to `extractZonePageFromPdf` (anti-invention
 * inherited whole).
 */
export function extractZoneHeaderPageFromPdf(
  pdfPath: string,
  page: number,
  opts: VisionExtractOptions & { render?: RenderImpl; dpi?: number },
): Promise<ZoneNormsT> {
  const vision = opts.vision ?? new MistralVisionZoneHeader().extract;
  return extractZonePageFromPdf(pdfPath, page, { ...opts, vision });
}
