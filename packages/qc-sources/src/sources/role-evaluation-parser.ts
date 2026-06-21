import { z } from "zod";

import { NON_DISPONIBLE } from "./avis-publics-parser.js";

/**
 * Pure parser for the MAMH "rôle d'évaluation foncière" XML (one record per
 * `RLUEx` block). REAL coded fields are extracted verbatim from the committed
 * samples (SPEC_PLAN_SCRAPING / `_spikes/roles-evaluation-fonciere-mamh`):
 *
 *   RLM01A   municipality MAMH code (e.g. "70052")
 *   RLM02A   role year (e.g. "2026")
 *   RL0103Ax cadastre lot number(s) NO_LOT (authoritative)        → Lot mentions
 *   RL0104A/B/C  matricule parts (5114-86-8189)                   → Valuation key
 *   RL0401A  role reference date (validity-time start)
 *   RL0402A  land value (valeur du terrain)
 *   RL0404A  total value (valeur de l'immeuble)                   → OntoValuation.valeur
 *
 * Anti-invention: a field absent from the bytes becomes `non-disponible` (or
 * `null` for numbers). The owner (PII, LFM 72 + Loi 25) is NEVER extracted —
 * always `non-disponible`. The parser is regex-based (no XML dep), mirroring the
 * dependency-free `avis-publics-parser`; the MAMH layout is flat and stable.
 */

/** One évaluation unit (one `RLUEx` block) — the real fields radar models. */
export const RoleEvaluationUnit = z.object({
  /** Cadastre lot numbers (RL0103Ax), authoritative province-wide keys. */
  noLots: z.array(z.string().min(1)).default([]),
  /** Assembled matricule RL0104A-RL0104B-RL0104C, or non-disponible. */
  matricule: z.string().min(1),
  /** Total value RL0404A (valeur de l'immeuble) in CAD; null when absent. */
  valeur: z.number().nonnegative().nullable().default(null),
  /** Land value RL0402A (valeur du terrain) in CAD; null when absent. */
  valeurTerrain: z.number().nonnegative().nullable().default(null),
  /** Role reference date RL0401A (ISO), or non-disponible. */
  valeurDate: z.string().min(1),
  /** PII excluded (§7.4): always non-disponible. */
  owner: z.literal("non-disponible"),
});
export type RoleEvaluationUnitT = z.infer<typeof RoleEvaluationUnit>;

export const RoleEvaluation = z.object({
  /** Municipality MAMH code RLM01A (e.g. "70052"), or non-disponible. */
  codeMamh: z.string().min(1),
  /** Role year RLM02A (e.g. "2026"), or non-disponible. */
  year: z.string().min(1),
  units: z.array(RoleEvaluationUnit).default([]),
});
export type RoleEvaluationT = z.infer<typeof RoleEvaluation>;

/** First captured value of `<TAG>…</TAG>` within `scope`, trimmed; or null. */
function firstTag(scope: string, tag: string): string | null {
  const m = scope.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return m?.[1] != null ? m[1].trim() : null;
}

/** All captured values of `<TAG>…</TAG>` within `scope`, in document order. */
function allTags(scope: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "gi");
  for (const m of scope.matchAll(re)) {
    const v = m[1]?.trim();
    if (v) out.push(v);
  }
  return out;
}

/** Parse an integer-CAD value; null when absent/unparseable (anti-invention). */
function toCad(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number.parseInt(raw.replace(/\s/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Parse one `RLUEx` évaluation-unit block into a typed unit. */
function parseUnit(block: string): RoleEvaluationUnitT {
  const noLots = Array.from(new Set(allTags(block, "RL0103Ax")));

  const a = firstTag(block, "RL0104A");
  const b = firstTag(block, "RL0104B");
  const c = firstTag(block, "RL0104C");
  const matricule =
    a && b && c ? `${a}-${b}-${c}` : NON_DISPONIBLE;

  const valeur = toCad(firstTag(block, "RL0404A"));
  const valeurTerrain = toCad(firstTag(block, "RL0402A"));
  const valeurDate = firstTag(block, "RL0401A") ?? NON_DISPONIBLE;

  return RoleEvaluationUnit.parse({
    noLots,
    matricule,
    valeur,
    valeurTerrain,
    valeurDate,
    owner: "non-disponible",
  });
}

/** Parse a MAMH role XML document into header + évaluation units. */
export function parseRoleEvaluation(xml: string): RoleEvaluationT {
  const codeMamh = firstTag(xml, "RLM01A") ?? NON_DISPONIBLE;
  const year = firstTag(xml, "RLM02A") ?? NON_DISPONIBLE;

  const units: RoleEvaluationUnitT[] = [];
  const blockRe = /<RLUEx>([\s\S]*?)<\/RLUEx>/gi;
  for (const m of xml.matchAll(blockRe)) {
    const block = m[1];
    if (block) units.push(parseUnit(block));
  }

  return RoleEvaluation.parse({ codeMamh, year, units });
}
