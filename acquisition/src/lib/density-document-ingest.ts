/**
 * Fail-closed validation for a discovery report consumed by the density
 * ingest. Campaigns may be smaller than the original closed 56-city corpus,
 * but every declared target must have one completed report row.
 */
export function assertClosedDensityDiscoveryReport(
  value: {
    scopeCount?: unknown;
    completedCount?: unknown;
    rows?: unknown;
  },
): asserts value is {
  scopeCount: number;
  completedCount: number;
  rows: unknown[];
} {
  if (
    !Number.isInteger(value.scopeCount)
    || (value.scopeCount as number) < 1
    || value.completedCount !== value.scopeCount
    || !Array.isArray(value.rows)
    || value.rows.length !== value.scopeCount
  ) {
    throw new Error("rapport de découverte incomplet ou incohérent");
  }
}

/**
 * Return a served zone code only when it is byte-for-byte identical to the
 * code printed by the reviewed document. No punctuation, prefix, case, or
 * component-order normalization is permitted in this path.
 */
export function exactDensitySigZoneCode(
  documentCode: string,
  servedCodes: Iterable<string>,
): string | null {
  for (const servedCode of servedCodes) {
    if (servedCode === documentCode) return servedCode;
  }
  return null;
}
