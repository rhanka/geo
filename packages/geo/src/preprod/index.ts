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
  PREPROD_NATIVE_FAMILIES,
  isPreprodNativeCollectionId,
  isPreprodNativeKey,
  prodMirrorCollectionIds,
  type MirrorCopy,
  type MirrorPlan,
  type CoherenceManifest,
  type PreprodNativeFamily,
} from "./mirror.js";
