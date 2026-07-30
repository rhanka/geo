import { createHash } from "node:crypto";

export type PvHtmlResourceVerdict = "HTML_PV_BODY" | "HTML_PORTAL_OR_SOFT_404";

export interface PvHtmlResourceAssessment {
  readonly verdict: PvHtmlResourceVerdict;
  readonly reason: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly title: string | null;
  readonly evidence: string;
  readonly visible_text_excerpt: string;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("fr-CA");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function visibleText(html: string): string {
  return decodeEntities(html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/giu, " ")
    .replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function titleOf(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  const title = match ? visibleText(match[1]!) : "";
  return title ? title.slice(0, 500) : null;
}

function evidenceFor(text: string, patterns: readonly RegExp[]): string {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = Math.max(0, match.index - 120);
    return text.slice(start, Math.min(text.length, match.index + match[0].length + 180));
  }
  return text.slice(0, 300);
}

/**
 * Decide whether an HTML response is itself a PV body. Navigation pages,
 * Google/Drive viewers, soft-404s and error pages remain explicit non-PV
 * verdicts. The requested URL is accepted only for audit provenance; it never
 * contributes to the semantic decision.
 */
export function assessPvHtmlResource(bytes: Uint8Array, _requestedUrl: string, municipalityName: string): PvHtmlResourceAssessment {
  const html = Buffer.from(bytes).toString("utf8");
  const text = visibleText(html);
  const foldedText = fold(text);
  const owner = fold(municipalityName).trim();
  const soft404Patterns = [
    /\b(?:404|not found|page not found|page introuvable|access denied|acces refuse|forbidden)\b/iu,
    /\b(?:erreur|error)\b.{0,60}\b(?:page|document|requete|request)\b/iu,
  ];
  const portalPatterns = [
    /\bgoogle\s+(?:drive|viewer)\b/iu,
    /\b(?:liste des? documents?|seances? du conseil|proces verbaux)\b/iu,
    /\b(?:login|connexion|javascript est requis|enable javascript)\b/iu,
  ];
  const pvBodyPatterns = [
    /\bproces[- ]verbal de la seance\b/iu,
    /\b(?:sont|etaient) presents?\b/iu,
    /\bresolution\s+(?:no\.?|numero)?\s*[0-9]/iu,
    /\badoption du proces-verbal\b/iu,
  ];
  const pvSignals = pvBodyPatterns.filter((pattern) => pattern.test(foldedText)).length;
  const hasOwner = owner.length > 0 && foldedText.includes(owner);
  const hasDate = /\b(?:19|20)\d{2}\b/iu.test(text) && /\b(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/iu.test(foldedText);
  const soft404 = soft404Patterns.find((pattern) => pattern.test(foldedText));
  const portal = portalPatterns.find((pattern) => pattern.test(foldedText));
  const isPvBody = soft404 === undefined && portal === undefined && pvSignals >= 2 && hasOwner && hasDate;
  const reason = isPvBody
    ? "HTML contient un corps de PV avec propriétaire, date et marqueurs de séance"
    : soft404 !== undefined
      ? "HTML désigne une page d'erreur ou un soft-404"
      : portal !== undefined
        ? "HTML désigne un portail, une page d'index ou un viewer"
        : "HTML ne contient pas les preuves suffisantes d'un corps de PV";
  const evidencePatterns = isPvBody ? pvBodyPatterns : soft404 !== undefined ? soft404Patterns : portal !== undefined ? portalPatterns : pvBodyPatterns;
  return {
    verdict: isPvBody ? "HTML_PV_BODY" : "HTML_PORTAL_OR_SOFT_404",
    reason,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    title: titleOf(html),
    evidence: evidenceFor(text, evidencePatterns),
    visible_text_excerpt: text.slice(0, 600),
  };
}
