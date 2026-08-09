export type DensityDocumentDisposition =
  | "publishable"
  | "excluded-undated"
  | "excluded-project"
  | "corroboration-only"
  | "refused-unanchored"
  | "refused-no-publishable-density"
  | "refused-no-sig-overlap";

export interface DensityDocumentReviewFacts {
  documentAnchored: boolean;
  projectExcluded: boolean;
  legalDate: string | null;
  parsedNorms: number;
  matchedNorms: number;
  corroborationOnly: boolean;
}

export interface DensityNormReading {
  zoneCode: string;
  value: number;
  unit: string;
}

export interface DensityDocumentReference {
  id: string;
  slug: string;
  owner: string;
  legalDate: string | null;
  norms: readonly DensityNormReading[];
}

export interface CorroborationValidation {
  historicalDocumentId: string;
  referenceDocumentId: string;
  exactMatchRequired: boolean;
  comparedNorms: number;
  exactMatches: number;
}

function legalDateRange(value: string): { start: number; end: number } {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) throw new Error(`date légale non ISO: ${value}`);
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  if (
    month !== null
    && (month < 1 || month > 12)
    || day !== null
    && (day < 1 || day > new Date(Date.UTC(year, month!, 0)).getUTCDate())
  ) {
    throw new Error(`date légale invalide: ${value}`);
  }
  const start = Date.UTC(year, (month ?? 1) - 1, day ?? 1);
  const end = day !== null
    ? start
    : month !== null
      ? Date.UTC(year, month, 0)
      : Date.UTC(year, 11, 31);
  return { start, end };
}

const normKey = (zoneCode: string): string => zoneCode.trim().toUpperCase();

/**
 * Prove that a corroborating document belongs to the same owner and collection,
 * predates the selected reference, and (when requested) contributes no unique
 * or divergent density reading.
 */
export function validateHistoricalCorroboration(
  historical: DensityDocumentReference,
  reference: DensityDocumentReference,
  exactMatchRequired: boolean,
): CorroborationValidation {
  if (historical.id === reference.id) {
    throw new Error(`${historical.id}: une corroboration ne peut pas se référencer elle-même`);
  }
  if (historical.slug !== reference.slug) {
    throw new Error(`${historical.id}: collection différente de ${reference.id}`);
  }
  if (historical.owner !== reference.owner) {
    throw new Error(`${historical.id}: propriétaire différent de ${reference.id}`);
  }
  if (historical.legalDate === null || reference.legalDate === null) {
    throw new Error(`${historical.id}: corroboration ou référence non datée`);
  }
  const historicalDate = legalDateRange(historical.legalDate);
  const referenceDate = legalDateRange(reference.legalDate);
  if (historicalDate.end >= referenceDate.start) {
    throw new Error(
      `${historical.id}: date ${historical.legalDate} non antérieure à `
      + `${reference.id} (${reference.legalDate})`,
    );
  }

  const referenceNorms = new Map<string, DensityNormReading>();
  for (const norm of reference.norms) {
    const key = normKey(norm.zoneCode);
    const previous = referenceNorms.get(key);
    if (
      previous
      && (previous.value !== norm.value || previous.unit !== norm.unit)
    ) {
      throw new Error(`${reference.id}: référence divergente pour ${norm.zoneCode}`);
    }
    referenceNorms.set(key, norm);
  }

  let exactMatches = 0;
  for (const norm of historical.norms) {
    const selected = referenceNorms.get(normKey(norm.zoneCode));
    if (
      selected
      && selected.value === norm.value
      && selected.unit === norm.unit
    ) {
      exactMatches++;
      continue;
    }
    if (exactMatchRequired) {
      throw new Error(
        selected
          ? `${historical.id}: lecture divergente pour ${norm.zoneCode}`
          : `${historical.id}: lecture unique absente de ${reference.id}: ${norm.zoneCode}`,
      );
    }
  }
  if (exactMatchRequired && exactMatches !== historical.norms.length) {
    throw new Error(`${historical.id}: corroboration exacte incomplète`);
  }
  return {
    historicalDocumentId: historical.id,
    referenceDocumentId: reference.id,
    exactMatchRequired,
    comparedNorms: historical.norms.length,
    exactMatches,
  };
}

/**
 * Classify a reviewed density document without promoting historical evidence
 * to the current served reference.
 *
 * Exclusions remain fail-closed and take precedence. A dated, matched older
 * grid may corroborate a newer source, but never contributes reference patches.
 */
export function densityDocumentDisposition(
  facts: DensityDocumentReviewFacts,
): DensityDocumentDisposition {
  if (facts.projectExcluded) return "excluded-project";
  if (!facts.documentAnchored) return "refused-unanchored";
  if (facts.legalDate === null) return "excluded-undated";
  if (facts.parsedNorms === 0) return "refused-no-publishable-density";
  if (facts.matchedNorms === 0) return "refused-no-sig-overlap";
  if (facts.corroborationOnly) return "corroboration-only";
  return "publishable";
}
