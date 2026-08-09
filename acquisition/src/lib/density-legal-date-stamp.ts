/**
 * Add a legally reviewed entry-into-force date to already deposited density
 * rows.  This is intentionally NOT a density merge: it preserves every value
 * and every density-source field, and targets a zone code by strict equality.
 */

export interface DensityLegalDateStamp {
  zoneCode: string;
  legalDate: string;
  legalDateEvidence: string;
}

export interface DensityLegalDateStampResult {
  rows: Record<string, unknown>[];
  stamped: number;
  unchanged: number;
}

function filled(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function assertStamp(stamp: DensityLegalDateStamp): void {
  if (!stamp.zoneCode.trim()) throw new Error("legal-date stamp without exact zoneCode");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp.legalDate)) {
    throw new Error(`legal-date stamp ${stamp.zoneCode}: date must be ISO YYYY-MM-DD`);
  }
  if (!stamp.legalDateEvidence.trim()) {
    throw new Error(`legal-date stamp ${stamp.zoneCode}: verbatim evidence missing`);
  }
}

/**
 * Stamp exact existing zone codes only.  No case fold, whitespace fold,
 * canonicalisation, prefix, suffix, or numeric bridge is permitted here.
 */
export function stampDensityLegalDateRows(
  existingRows: readonly Record<string, unknown>[],
  stamps: readonly DensityLegalDateStamp[],
): DensityLegalDateStampResult {
  const rows = existingRows.map((row) => ({ ...row }));
  const stampsByCode = new Map<string, DensityLegalDateStamp>();
  for (const stamp of stamps) {
    assertStamp(stamp);
    if (stampsByCode.has(stamp.zoneCode)) {
      throw new Error(`duplicate exact legal-date stamp zone_code: ${stamp.zoneCode}`);
    }
    stampsByCode.set(stamp.zoneCode, stamp);
  }

  let stamped = 0;
  let unchanged = 0;
  for (const [zoneCode, stamp] of stampsByCode) {
    const matches = rows.filter((row) => row["zone_code"] === zoneCode);
    if (matches.length !== 1) {
      throw new Error(`exact zone_code ${zoneCode}: expected one row, found ${matches.length}`);
    }
    const row = matches[0]!;
    if (!filled(row["densite_value"])) {
      throw new Error(`exact zone_code ${zoneCode}: cannot date an absent density`);
    }
    const densityProvenance = ["densite_source_url", "densite_source_sha256", "densite_source_storage_key"]
      .every((field) => filled(row[field]));
    // Rows deposited by the base grille parser predate density-specific columns;
    // their row-level source trio remains the provenance of the density itself.
    const baseProvenance = ["_source_url", "_methode", "_snapshot"]
      .every((field) => filled(row[field]));
    if (!densityProvenance && !baseProvenance) {
      throw new Error(`exact zone_code ${zoneCode}: immutable density provenance missing`);
    }
    const currentDate = row["densite_legal_date"];
    const currentEvidence = row["densite_legal_date_evidence"];
    if (currentDate === undefined || currentDate === null) {
      row["densite_legal_date"] = stamp.legalDate;
      row["densite_legal_date_evidence"] = stamp.legalDateEvidence;
      stamped++;
      continue;
    }
    if (currentDate === stamp.legalDate && currentEvidence === stamp.legalDateEvidence) {
      unchanged++;
      continue;
    }
    throw new Error(
      `exact zone_code ${zoneCode}: existing legal date conflicts (${String(currentDate)} <> ${stamp.legalDate})`,
    );
  }
  return { rows, stamped, unchanged };
}
