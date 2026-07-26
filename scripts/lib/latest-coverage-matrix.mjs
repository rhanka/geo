/** Deterministic coverage-artifact discovery: names are the ordering contract, never mtimes. */
export function latestZoneProvenanceQualityMatrix(fileNames) {
  const matches = fileNames
    .filter((file) => /^zone-provenance-quality-matrix-\d{8}-[a-f0-9]+\.json$/.test(file))
    .sort();
  return matches.length ? matches[matches.length - 1] : null;
}
