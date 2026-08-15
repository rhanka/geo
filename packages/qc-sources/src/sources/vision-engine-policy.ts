// ───────────────────────────────────────────────────────────────────────────
//  Vision-engine policy — OWNER BAN (2026-08-14, ADR-0024, CLAUDE.md).
//
//  `mistral-medium-latest` (Mistral vision-chat) is BANNED. It never delivered a
//  usable structured extraction and it drove a 480 € Mistral.ai bill: the normes
//  lane ran 319 municipalités through the 2-passes/page vision-chat route
//  (proof: work/coverage/normes-provenance.json, méthode "mistral-vision" ×319).
//  The ONLY Mistral use ever sanctioned is the cheap Document-AI OCR path
//  (`/v1/ocr`, `mistral-ocr-latest`) — never the chat/vision model.
//
//  No code path may resolve a Mistral vision-chat model. Any attempt fails LOUDLY
//  (this is the "vert par omission = rouge" discipline: a silent expensive default
//  is a defect). A sanctioned replacement vision engine (a stronger model behind
//  the gateway, keeping the strict per-cell JSON contract) is pending
//  double-consensus + geo-archi ratification — until then the vision route is
//  intentionally inoperative; the native/OCR routes are unaffected.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Models that are BANNED as a VISION-CHAT engine. Kept deliberately narrow to the
 * Mistral vision-chat lineage the owner banned (`mistral-medium-*` and its retired
 * predecessor `pixtral-*`). The sanctioned OCR model `mistral-ocr-*` and the audio
 * model `voxtral-*` are NOT vision-chat and are NOT matched here.
 */
export const BANNED_VISION_MODEL_PATTERN = /mistral-medium|pixtral/i;

export class BannedVisionEngineError extends Error {
  constructor(model: string) {
    super(
      `Vision engine "${model}" is BANNED (owner 2026-08-14, ADR-0024). ` +
        `Mistral vision-chat (mistral-medium-latest / pixtral) never worked and drove ` +
        `a 480 € Mistral.ai bill. Only /v1/ocr (mistral-ocr-latest) is sanctioned for ` +
        `Mistral; the replacement vision engine is pending double-consensus + geo-archi. ` +
        `Pass an explicit sanctioned model. See docs/decisions.md (ADR-0024) and CLAUDE.md.`,
    );
    this.name = "BannedVisionEngineError";
  }
}

/**
 * Gate every resolved vision-chat model through this. Throws {@link BannedVisionEngineError}
 * when the model is unset (the old `mistral-medium-latest` default is gone) or matches the
 * banned vision-chat lineage. Returns the model unchanged when it is allowed.
 */
export function assertVisionModelAllowed(model: string | undefined): string {
  if (model === undefined || model.trim() === "") {
    // No default: the removed default was the banned mistral-medium-latest. A caller
    // must pass an explicit sanctioned model — silence must not resurrect the ban.
    throw new BannedVisionEngineError("<no vision model configured — the mistral-medium-latest default is banned>");
  }
  if (BANNED_VISION_MODEL_PATTERN.test(model)) {
    throw new BannedVisionEngineError(model);
  }
  return model;
}
