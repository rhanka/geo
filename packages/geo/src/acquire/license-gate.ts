/**
 * License gate. Redistribution permission is a first-class concern: the
 * acquisition engine refuses to persist or return data whose license is not
 * `redistributable`. This gate MUST be called before any acquisition output
 * leaves the engine.
 */

import type { SourceManifest } from "@sentropic/geo-core";
import { isRedistributable, resolveManifestLicense } from "@sentropic/geo-core";

/** Thrown when a manifest's license forbids re-hosting / republication. */
export class LicenseError extends Error {
  override readonly name = "LicenseError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Assert that `manifest` may be redistributed. Throws {@link LicenseError} with
 * a clear, actionable message otherwise. Safe to call repeatedly; it is a
 * no-op when the license permits redistribution.
 */
export function assertRedistributable(manifest: SourceManifest): void {
  if (isRedistributable(manifest)) return;
  const license = resolveManifestLicense(manifest);
  throw new LicenseError(
    `Source "${manifest.id}" is licensed as "${license.id}" (${license.title}), ` +
      `which does not permit redistribution. Acquisition is blocked: this engine ` +
      `only re-hosts datasets under a redistributable license.`,
  );
}
