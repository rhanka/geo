/** Strictly exact fold of density legal-date provenance onto served polygons. */

export interface ServedDensityLegalDate {
  zoneCode: string;
  legalDate: string;
  legalDateEvidence: string;
}

export interface ExactLegalDateFoldResult {
  matched: number;
  changed: number;
}

function sameOrAbsent(current: unknown, wanted: string): boolean {
  return current === undefined || current === null || current === wanted;
}

/**
 * Fold metadata only on literal `zone_code` equality.  It deliberately does
 * no case, whitespace, separator, prefix, or canonical matching.
 */
export function foldExactDensityLegalDate(
  features: Array<{ properties?: Record<string, unknown> | null }>,
  stamp: ServedDensityLegalDate,
): ExactLegalDateFoldResult {
  let matched = 0;
  let changed = 0;
  for (const feature of features) {
    const properties = feature.properties ?? {};
    feature.properties = properties;
    if (properties["zone_code"] !== stamp.zoneCode) continue;
    matched++;
    if (typeof properties["densite_value"] !== "number" || !Number.isFinite(properties["densite_value"])) {
      throw new Error(`exact zone_code ${stamp.zoneCode}: served density is absent`);
    }
    if (!sameOrAbsent(properties["densite_legal_date"], stamp.legalDate)) {
      throw new Error(`exact zone_code ${stamp.zoneCode}: served legal date conflicts`);
    }
    if (!sameOrAbsent(properties["densite_legal_date_evidence"], stamp.legalDateEvidence)) {
      throw new Error(`exact zone_code ${stamp.zoneCode}: served legal evidence conflicts`);
    }
    if (properties["densite_legal_date"] !== stamp.legalDate) {
      properties["densite_legal_date"] = stamp.legalDate;
      changed++;
    }
    if (properties["densite_legal_date_evidence"] !== stamp.legalDateEvidence) {
      properties["densite_legal_date_evidence"] = stamp.legalDateEvidence;
      changed++;
    }
  }
  return { matched, changed };
}
