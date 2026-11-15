/** Display mirror (SPEC_DISPLAY_MIRROR.md): build, serve, publish-time hook, prewarm. */

export {
  artifactKey,
  buildDisplayMirror,
  currentKey,
  DISPLAY_MAX_FEATURE_BYTES,
  DISPLAY_PROFILE,
  DisplayTooLargeError,
  displayVersion,
  manifestKey,
  parseManifest,
  type DisplayArtifact,
  type DisplayEncoding,
  type DisplayManifest,
} from "./mirror.js";
export { DisplayService, type DisplayResult, type DisplayServiceOptions } from "./service.js";
export {
  DISPLAY_PUBLISH_FAILED,
  displayMirrorFreshness,
  ensureDisplayMirror,
  isDisplayPublishedCollection,
  publishDisplayMirror,
  resolvePublishedCollection,
  TILES_PUBLISH_FAILED,
  type TilesPublishOutcome,
  type EnsureAction,
  type EnsureOptions,
  type EnsureResult,
  type MirrorFreshness,
  type PublishOptions,
  type PublishOutcome,
  type PublishResolution,
  type StaleReason,
} from "./publish.js";
export {
  listDisplaySources,
  prewarmDisplayMirrors,
  warmViaApi,
  type ApiWarmResult,
  type DisplaySource,
  type PrewarmOptions,
  type PrewarmReport,
  type PrewarmResult,
  type TilesStepResult,
} from "./prewarm.js";
