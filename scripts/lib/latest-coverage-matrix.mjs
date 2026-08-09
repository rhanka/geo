/** Deterministic coverage-artifact discovery: names are the ordering contract, never mtimes. */

// `zone-provenance-quality-matrix-<stamp>-<hash>.json`, where <stamp> is either a
// date (legacy artefacts) or a second-precision instant. The hash is a CONTENT tag,
// not a clock: sorting whole filenames let it decide between two same-day runs, so
// the report once read 23 v2 while the newest measurement said 36. Order on the
// stamp alone; the hash only breaks a tie between two stamps that are equal.
const MATRIX_RE = /^zone-provenance-quality-matrix-(\d{8}(?:T\d{6}Z)?)-([a-f0-9]+)\.json$/;

export function latestZoneProvenanceQualityMatrix(fileNames) {
  let best = null;
  for (const file of fileNames) {
    const match = MATRIX_RE.exec(file);
    if (!match) continue;
    // A date-only stamp is the START of its day, so a timestamped run from the same
    // day always wins — padding it with zeroes says exactly that.
    const key = match[1].length === 8 ? `${match[1]}T000000Z` : match[1];
    const candidate = { file, key, hash: match[2] };
    if (
      best === null
      || candidate.key > best.key
      || (candidate.key === best.key && candidate.hash > best.hash)
    ) best = candidate;
  }
  return best ? best.file : null;
}
