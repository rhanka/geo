/** Display mirror (SPEC_DISPLAY_MIRROR.md): build, serve, publish-time hook, prewarm. */

export {
  artifactKey,
  buildDisplayMirror,
  currentKey,
  DISPLAY_PROFILE,
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
} from "./prewarm.js";
