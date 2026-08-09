/** Pure, content-based rules for a captured PV body. */

export const PV_CAPTURE_OCTET_CLASSES = [
  "PV_LISIBLE_PROPRIETAIRE_CONFIRME",
  "PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME",
  "DOCUMENT_LISIBLE_NON_PV",
  "PDF_SANS_COUCHE_TEXTE",
  "PAGE_HTML",
  "HTTP_404",
  "HTTP_403",
  "HTTP_AUTRE",
  "CAPTURE_SANS_OCTETS",
  "ERREUR_EXTRACTION",
  "AUTRE",
] as const;

export type PvCaptureOctetClass = (typeof PV_CAPTURE_OCTET_CLASSES)[number];

export interface ReadablePvTextClassification {
  readonly classification:
    | "PV_LISIBLE_PROPRIETAIRE_CONFIRME"
    | "PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME"
    | "DOCUMENT_LISIBLE_NON_PV";
  readonly owner_verbatim: string | null;
  readonly pv_verbatim: string | null;
}

function folded(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstLine(text: string, predicate: (line: string) => boolean): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (predicate(line)) return line.trim().slice(0, 900) || null;
  }
  return null;
}

const PV_TEXT = /proc[èe]s[-\s]*verb(?:al|aux)|\bpv\b|s[ée]ance\s+(?:ordinaire|extraordinaire)(?:\s+du)?\s+conseil|(?:meeting )?minutes\b/i;

/**
 * A positive PV is deliberately a conjunction: PV wording and the expected
 * municipality's printed name. The latter is not inferred from URL or folder.
 */
export function classifyReadablePvText(text: string, municipalityName: string): ReadablePvTextClassification {
  const normalizedOwner = folded(municipalityName);
  const ownerVerbatim = firstLine(text, (line) => normalizedOwner.length > 0 && folded(line).includes(normalizedOwner));
  const pvVerbatim = firstLine(text, (line) => PV_TEXT.test(line));
  if (pvVerbatim === null) {
    return { classification: "DOCUMENT_LISIBLE_NON_PV", owner_verbatim: ownerVerbatim, pv_verbatim: null };
  }
  return {
    classification: ownerVerbatim === null ? "PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME" : "PV_LISIBLE_PROPRIETAIRE_CONFIRME",
    owner_verbatim: ownerVerbatim,
    pv_verbatim: pvVerbatim,
  };
}

export function startsLikeHtml(bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes.subarray(0, 4096)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  return /^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(prefix);
}

export function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}
