/**
 * Pure, additive merge of verified density readings into flat norms rows.
 *
 * Existing non-density cells and their row-level provenance are never changed.
 * Density gets its own source columns so enriching an existing row cannot
 * re-attribute unrelated height/margin/lot norms to the new document.
 */
import { canonZone } from "./zonage-norms.js";

export interface DensityNormPatch {
  zoneCode: string;
  value: number;
  unit: "logements/terrain" | "logements/batiment" | "log/ha";
  raw: string;
  proof: string;
  page: number;
  sourceUrl: string;
  method: string;
  snapshot: string;
  legalDate: string;
  legalDateEvidence: string;
}

export interface DensityMergeResult {
  rows: Record<string, unknown>[];
  inserted: number;
  enriched: number;
  unchanged: number;
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function assertPatch(patch: DensityNormPatch): void {
  if (!patch.zoneCode.trim()) throw new Error("density patch without zoneCode");
  if (!Number.isFinite(patch.value) || patch.value < 0) {
    throw new Error(`density patch ${patch.zoneCode}: invalid value`);
  }
  if (!patch.raw.trim() || !patch.proof.trim()) {
    throw new Error(`density patch ${patch.zoneCode}: verbatim evidence missing`);
  }
  if (
    !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(patch.legalDate)
    || !patch.legalDateEvidence.trim()
  ) {
    throw new Error(`density patch ${patch.zoneCode}: dated legal evidence missing`);
  }
  if (!patch.sourceUrl.startsWith("https://")) {
    throw new Error(`density patch ${patch.zoneCode}: non-HTTPS source`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.snapshot)) {
    throw new Error(`density patch ${patch.zoneCode}: invalid snapshot date`);
  }
}

function densityColumns(patch: DensityNormPatch): Record<string, unknown> {
  return {
    densite_value: patch.value,
    densite_raw: patch.raw,
    densite_unit: patch.unit,
    densite_confidence: 1,
    densite_source_url: patch.sourceUrl,
    densite_methode: patch.method,
    densite_snapshot: patch.snapshot,
    densite_proof: patch.proof,
    densite_legal_date: patch.legalDate,
    densite_legal_date_evidence: patch.legalDateEvidence,
    densite_page_source: `PAGE ${patch.page} ZONE ${patch.zoneCode}`,
  };
}

/**
 * Fill an absent density or insert a new zone row. A pre-existing, different
 * non-null density is a hard refusal: the function never decides which source
 * wins. Canonical duplicate rows are likewise refused.
 */
export function mergeDensityNormRows(
  existingRows: readonly Record<string, unknown>[],
  patches: readonly DensityNormPatch[],
): DensityMergeResult {
  const rows = existingRows.map((row) => ({ ...row }));
  const rowIndex = new Map<string, number>();
  const duplicateExisting = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const code = String(row["zone_code"] ?? "").trim();
    if (!code) continue;
    const key = canonZone(code);
    if (duplicateExisting.has(key)) continue;
    if (rowIndex.has(key)) {
      rowIndex.delete(key);
      duplicateExisting.add(key);
      continue;
    }
    rowIndex.set(key, index);
  }

  const patchByZone = new Map<string, DensityNormPatch>();
  for (const patch of patches) {
    assertPatch(patch);
    const key = canonZone(patch.zoneCode);
    const previous = patchByZone.get(key);
    if (
      previous
      && (previous.value !== patch.value || previous.unit !== patch.unit || previous.raw !== patch.raw)
    ) {
      throw new Error(`divergent density patches for ${patch.zoneCode}`);
    }
    if (!previous) patchByZone.set(key, patch);
  }

  let inserted = 0;
  let enriched = 0;
  let unchanged = 0;
  for (const [key, patch] of patchByZone) {
    if (duplicateExisting.has(key)) {
      throw new Error(`duplicate existing canonical zone_code targeted by density patch: ${patch.zoneCode}`);
    }
    const index = rowIndex.get(key);
    const additions = densityColumns(patch);
    if (index === undefined) {
      rows.push({
        zone_code: patch.zoneCode,
        zone_page: `PAGE ${patch.page} ZONE ${patch.zoneCode}`,
        ...additions,
        _source_url: patch.sourceUrl,
        _methode: patch.method,
        _snapshot: patch.snapshot,
      });
      rowIndex.set(key, rows.length - 1);
      inserted++;
      continue;
    }

    const row = rows[index]!;
    if (present(row["densite_value"])) {
      if (
        row["densite_value"] !== patch.value
        || row["densite_unit"] !== patch.unit
      ) {
        throw new Error(
          `existing density conflict for ${patch.zoneCode}: `
          + `${String(row["densite_value"])} ${String(row["densite_unit"])} `
          + `<> ${patch.value} ${patch.unit}`,
        );
      }
      unchanged++;
    } else {
      enriched++;
    }
    Object.assign(row, additions);
  }

  return { rows, inserted, enriched, unchanged };
}
