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
