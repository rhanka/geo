/**
 * grille-vision-multizone — vision extractor for the Québec "GRILLE DES
 * SPÉCIFICATIONS" format (MRC de Portneuf / many Estrie & rural munis), where ONE
 * page carries MANY zones side-by-side: norm labels run DOWN as rows, and several
 * zone codes are COLUMNS across the page (e.g. a "Feuillet des normes" page with
 * columns Ra-1, Ra-2, Ra-3, …). The single-zone vertical extractor
 * (`grille-vision-extractor.ts`) reads ONE zone column per page and so cannot
 * read these multi-zone sheets; the native-text horizontal parser
 * (`grille-specifications-parser.ts`) rejects them (different title + orientation).
 *
 * WHY VISION, NOT NATIVE TEXT. `pdftotext -layout` DOES linearise these pages, but
 * the zone-column headers are cramped and run together ("AFT1-1AFT1-2AFT1-3") and
 * the value cells are sparsely positioned, so a character-column native parser has
 * a real décalage risk on exactly the multi-column alignment that matters. A vision
 * model reading the RENDERED PAGE reconstructs the per-column cells reliably (probed
 * live 2026-06-22 on a Stratford "GRILLE DES SPÉCIFICATIONS" page: asked for one
 * named column it returned the correct verbatim cell).
 *
 * ANTI-INVENTION IS ABSOLUTE and INHERITED WHOLE from `grille-vision-extractor`:
 * this module adds NO new normalisation and NO new guard logic. It reuses
 *   - the SAME field specs (`FIELD_SPECS`),
 *   - the SAME per-cell guard (`buildVisionField`: 2-pass concordance → parse →
 *     semantic unit type-check → plausibility window), and
 *   - the SAME `ZoneNorms` zod schema + `VISION_PUBLISH_CONFIDENCE`.
 * The ONLY differences are (a) the prompt asks for ALL zone columns at once and
 * (b) the page is read TWICE (two prompts), then EACH zone's EACH cell is matched
 * across the two passes with the frozen guard. A zone present in only one pass, or
 * a cell whose two reads disagree, is refused (value:null + flag). `null` always
 * beats a fabricated norm.
 *
 * The vision call + page render are INJECTABLE (same seams as the single-zone
 * module) so the pipeline is unit-testable with a canned response and no network.
 */
import { readFile } from "node:fs/promises";

import {
  FIELD_SPECS,
  buildVisionField,
  renderPageToPng,
  VISION_METHODE,
  GrilleVisionError,
  type FieldId,
  type RenderImpl,
} from "./grille-vision-extractor.js";
import {
  ZoneNorms,
  type FieldProvenanceT,
  type NormFieldT,
  type ZoneNormsT,
} from "./grille-specifications-parser.js";

// ───────────────────────────────────────────────────────────────────────────
//  Raw multi-zone vision extraction: one page → many zones, each with verbatim
//  per-field cell strings (or null). Mirrors VisionRawExtraction but per-zone.
// ───────────────────────────────────────────────────────────────────────────

export interface MultiZoneRawZone {
  /** Verbatim zone code header for this column (e.g. "Ra-1", "AFT1-3"), or null. */
  zone_code: string | null;
  /** Verbatim usage categories marked permitted in this column (may be empty). */
  usages: string[];
  /** Per-field VERBATIM cell text for this zone's column, null when empty/illegible. */
  fields: Partial<Record<FieldId, string | null>>;
}

export interface MultiZoneRawExtraction {
  zones: MultiZoneRawZone[];
}

/** Injectable multi-zone vision call: image + pass index → all-zone raw extraction. */
export type MultiZoneVisionCallImpl = (
  imagePath: string,
  pass: 0 | 1,
) => Promise<MultiZoneRawExtraction>;

// ───────────────────────────────────────────────────────────────────────────
//  Prompts — two independent reads (same anti-invention contract as the single-
//  zone module, transposed to "return EVERY zone column").
// ───────────────────────────────────────────────────────────────────────────

const FIELD_LINES = FIELD_SPECS.map((f) => `  - "${f.id}": ${f.label}`).join("\n");

const MZ_COMMON_RULES = `
RÈGLES ABSOLUES (anti-invention) :
- Pour CHAQUE colonne de zone, donne la valeur EXACTE de chaque cellule, VERBATIM,
  telle qu'imprimée, unité incluse (ex: "7.5", "7,5 m", "1/2", "2787", "60", "0,3").
  Ne convertis pas, ne complète pas, ne déduis pas d'une autre colonne.
- Si une cellule est VIDE, illisible, ambiguë, ou si tu n'es pas certain → renvoie
  le JSON null (pas "null", pas 0, pas une estimation). null est TOUJOURS préférable
  à une valeur devinée.
- Recopie le code de zone EXACTEMENT comme imprimé en en-tête de colonne
  (ex: "Ra-1", "A 14", "AFT1-3", "Îlot 85").
- N'invente JAMAIS une colonne de zone qui n'existe pas. Ne fusionne pas deux zones.

CHAMPS À EXTRAIRE par zone (clé JSON : libellé de la ligne) :
${FIELD_LINES}
`;

function buildMzPromptA(): string {
  return `Tu lis une "GRILLE DES SPÉCIFICATIONS" municipale québécoise. Les ZONES sont en
COLONNES (en-têtes en haut de la grille). Les NORMES et usages sont en LIGNES à gauche.
Lis TOUTES les colonnes de zones de cette page.
${MZ_COMMON_RULES}
Réponds STRICTEMENT en JSON :
{
  "zones": [
    { "zone_code": <code en-tête colonne>, "usages": [<usages cochés, verbatim>],
      "fields": { "<id>": <verbatim cellule | null>, ... } },
    ...
  ]
}`;
}

function buildMzPromptB(): string {
  // Reworded + reframed for a genuinely independent second read.
  return `Analyse colonne par colonne ce tableau réglementaire d'urbanisme (Québec,
"grille des spécifications"). Chaque colonne correspond à une zone identifiée par son
code en en-tête. Pour CHAQUE zone et CHAQUE ligne de norme listée, recopie MOT POUR MOT
le contenu de la case, sans rien ajouter.
${MZ_COMMON_RULES}
Format de sortie JSON exigé :
{
  "zones": [
    { "zone_code": <code de zone>, "usages": [<usages, verbatim>],
      "fields": { "<id>": <contenu exact de la case | null>, ... } },
    ...
  ]
}`;
}

// ───────────────────────────────────────────────────────────────────────────
//  Production multi-zone vision call (Mistral chat + image). Same contract as
//  the single-zone MistralVisionGrille: reads MISTRAL_API_KEY at call-time,
//  injectable apiBase/model, never logs the key.
// ───────────────────────────────────────────────────────────────────────────

interface MistralChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class MistralVisionMultiZone {
  private readonly apiBase: string;
  private readonly model: string;

  constructor(opts: { apiBase?: string; model?: string } = {}) {
    this.apiBase = opts.apiBase ?? "https://api.mistral.ai";
    this.model = opts.model ?? "mistral-medium-latest";
  }

  readonly extract: MultiZoneVisionCallImpl = async (imagePath, pass) => {
    const apiKey = process.env["MISTRAL_API_KEY"];
    if (!apiKey) {
      throw new GrilleVisionError("missing-api-key", "MISTRAL_API_KEY is not set");
    }
    const bytes = await readFile(imagePath);
    const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
    const prompt = pass === 0 ? buildMzPromptA() : buildMzPromptB();
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
    return parseMultiZoneContent(content);
  };
}

/** Parse the model JSON into a normalised MultiZoneRawExtraction (anti-invention). */
export function parseMultiZoneContent(content: string): MultiZoneRawExtraction {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new GrilleVisionError("parse", `model did not return JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const rec = (obj ?? {}) as Record<string, unknown>;
  const zonesRaw = Array.isArray(rec["zones"]) ? (rec["zones"] as unknown[]) : [];
  const zones: MultiZoneRawZone[] = [];
  for (const zr of zonesRaw) {
    const z = (zr ?? {}) as Record<string, unknown>;
    const zoneCode = typeof z["zone_code"] === "string" && z["zone_code"].trim() ? z["zone_code"].trim() : null;
    const usagesRaw = z["usages"];
    const fieldsRaw = (z["fields"] ?? {}) as Record<string, unknown>;
    const fields: Partial<Record<FieldId, string | null>> = {};
    for (const spec of FIELD_SPECS) {
      const v = fieldsRaw[spec.id];
      fields[spec.id] = typeof v === "string" ? v : v === null || v === undefined ? null : String(v);
    }
    zones.push({
      zone_code: zoneCode,
      usages: Array.isArray(usagesRaw) ? usagesRaw.filter((u): u is string => typeof u === "string") : [],
      fields,
    });
  }
  return { zones };
}

// ───────────────────────────────────────────────────────────────────────────
//  Top-level: extract every zone of ONE multi-zone page via the 2-pass pipeline.
// ───────────────────────────────────────────────────────────────────────────

export interface MultiZoneExtractOptions {
  source_url: string;
  snapshot: string;
  /** Injected vision call (defaults to a live Mistral call). */
  vision?: MultiZoneVisionCallImpl;
}

/** Canonicalise a zone code for cross-pass matching (case/space-insensitive). */
function canonZoneKey(code: string): string {
  return code.toUpperCase().replace(/\s+/g, "");
}

/**
 * Run the 2-pass multi-zone vision extraction over a rendered page image. Returns
 * one guarded `ZoneNorms` per zone column that BOTH passes saw (a zone present in
 * only one pass is dropped — never half-invented). Each cell goes through the
 * SAME frozen `buildVisionField` guard as the single-zone extractor.
 */
export async function extractMultiZonePageFromImage(
  imagePath: string,
  opts: MultiZoneExtractOptions,
): Promise<ZoneNormsT[]> {
  const vision = opts.vision ?? new MistralVisionMultiZone().extract;
  const passA = await vision(imagePath, 0);
  const passB = await vision(imagePath, 1);

  // Index pass B by canonical zone code so we can pair columns across passes.
  const bByZone = new Map<string, MultiZoneRawZone>();
  for (const z of passB.zones) {
    if (z.zone_code) bByZone.set(canonZoneKey(z.zone_code), z);
  }

  const out: ZoneNormsT[] = [];
  const seen = new Set<string>();
  for (const za of passA.zones) {
    if (!za.zone_code) continue;
    const key = canonZoneKey(za.zone_code);
    if (seen.has(key)) continue; // a model that repeats a column → keep first only
    const zb = bByZone.get(key);
    if (!zb) continue; // zone only in pass A → drop (concordance failed for the column)
    seen.add(key);

    const provenance = (): FieldProvenanceT => ({
      source_url: opts.source_url,
      methode: VISION_METHODE,
      snapshot: opts.snapshot,
      page: `ZONE ${za.zone_code}`,
    });

    const field = (id: FieldId): NormFieldT => {
      const spec = FIELD_SPECS.find((s) => s.id === id)!;
      return buildVisionField(spec, za.fields[id], zb.fields[id], provenance());
    };

    const hauteurMetres = field("hauteur_metres");
    const hauteurEtages = field("hauteur_etages");
    const hauteurMax = hauteurMetres.value !== null ? hauteurMetres : hauteurEtages;

    // Usages: keep only those both passes named for this zone (verbatim).
    const usagesA = new Set(za.usages.map((u) => u.trim().toLowerCase()));
    const usages = zb.usages.filter((u) => usagesA.has(u.trim().toLowerCase()));

    const zn: ZoneNormsT = {
      zone_code: za.zone_code,
      zone_page: `ZONE ${za.zone_code}`,
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
    out.push(ZoneNorms.parse(zn));
  }
  return out;
}

/**
 * Full pipeline from a PDF page: render → 2-pass multi-zone vision → guarded
 * ZoneNorms[]. The temp render dir is cleaned afterwards. `render` injectable.
 */
export async function extractMultiZonePageFromPdf(
  pdfPath: string,
  page: number,
  opts: MultiZoneExtractOptions & { render?: RenderImpl; dpi?: number },
): Promise<ZoneNormsT[]> {
  const render: RenderImpl = opts.render ?? ((p, n) => renderPageToPng(p, n, opts.dpi ?? 200));
  const imagePath = await render(pdfPath, page);
  try {
    return await extractMultiZonePageFromImage(imagePath, opts);
  } finally {
    const dir = imagePath.replace(/\/[^/]+$/, "");
    if (dir.includes("grille-vision-")) {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
