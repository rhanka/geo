/**
 * Neutral zoning-event type classification from municipal source wording.
 *
 * This module deliberately has no dependency on the immo event projection or
 * its taxonomy: each result is licensed by a marker present in `span` itself.
 */
import type { ZoningEventType } from "./zoning-events-emit.js";

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("fr-CA");
}

function isAgriculturalDisposition(value: string): boolean {
  return /\b(?:alienation|exclusion)\b[\s\S]{0,80}\bzone\s+agricole\b/u.test(value)
    || /\bzone\s+agricole\b[\s\S]{0,80}\b(?:alienation|exclusion)\b/u.test(value);
}

function isZoningChange(value: string): boolean {
  return /\bre[-\s]?zonage\b/u.test(value)
    || /\bchangement\s+de\s+zonage\b/u.test(value)
    || /\bmodifi(?:cation|e|er|ant|ee|ees|es)\b[\s\S]{0,80}\bzonage\b/u.test(value)
    || /\bamendement\b[\s\S]{0,96}\breglement\b[\s\S]{0,48}\bzonage\b/u.test(value)
    || /\breglement(?:\s+(?:(?:numero|no|n[°o])\s*)?\d[\d.-]*)?\s+(?:de|du)\s+zonage\b/u.test(value);
}

/**
 * Classify one verbatim municipal span in the neutral geo vocabulary.
 *
 * The explicit public-process markers take priority over a generic zoning
 * change.  `projet de règlement` is lower: in a first/second-project title it
 * often accompanies a directly stated substantive zoning amendment, which is
 * the more specific neutral event.  With no such amendment it remains the
 * documented process stage.  A span with no listed marker is honestly
 * classified as `autre`, never guessed from its URL, date, or another system.
 */
export function classifyMunicipalZoningEventType(span: string): ZoningEventType {
  const value = fold(span);

  if (/\bppcmoi\b/u.test(value)
    || /\bprojet\s+particulier\s+(?:de\s+)?(?:construction|modification|occupation)\b/u.test(value)) {
    return "ppcmoi";
  }
  if (/\bcptaq\b/u.test(value) || isAgriculturalDisposition(value)) return "cptaq";
  if (/\bderogation(?:s)?\b/u.test(value)) return "derogation-mineure";

  // PIIA is a named but deliberately unmapped municipal matter, not a proxy
  // for a neighbouring zoning or project-regulation phrase.
  if (/\bpiia\b/u.test(value)) return "autre";

  if (/\bentree\s+en\s+vigueur\b/u.test(value)) return "entree-en-vigueur";
  if (/\bconsultation\s+publique\b/u.test(value)
    || /\bassemblee\s+publique\s+de\s+consultation\b/u.test(value)) {
    return "consultation";
  }
  if (isZoningChange(value)) return "changement-de-zonage";
  if (/\b(?:premier|second)?\s*projet\s+(?:de|du)\s+reglement\b/u.test(value)) {
    return "projet-reglement";
  }
  if (/\bregistre\b[\s\S]{0,80}\breferend/u.test(value)) return "registre-referendaire";
  return "autre";
}
