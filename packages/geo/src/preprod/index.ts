/**
 * Preprod récup cycle — public surface (`@sentropic/geo/preprod`). Pure planning
 * + manifest helpers for the geo jamb of the prod→preprod mirror sync.
 */
export {
  COHERENCE_MANIFEST_BASENAME,
  coherenceManifestKeyFor,
  destKeyForMirror,
  planFullMirror,
  pruneBoundExceeded,
  DEFAULT_MAX_DELETE_FRACTION,
  buildCoherenceManifest,
  computeSetHash,
  type MirrorCopy,
  type MirrorPlan,
  type CoherenceManifest,
} from "./mirror.js";
