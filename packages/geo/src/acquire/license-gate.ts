/**
 * License gate. Redistribution permission is a first-class concern. The
 * acquisition engine blocks proprietary/incompatible sources, while allowing
 * official public sources explicitly marked `demo-unverified` to be acquired
 * with visible API rights metadata for demo-only consumption.
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

/** Resolve the effective API publication/use profile for a manifest. */
export function publicationRightsProfile(
  manifest: SourceManifest,
): NonNullable<SourceManifest["rightsProfile"]> {
  if (manifest.rightsProfile) return manifest.rightsProfile;
  return isRedistributable(manifest) ? "open" : "blocked";
}

/**
 * Assert that `manifest` may be acquired by this engine. Redistributable
 * sources are allowed as `open`; official public sources explicitly marked
 * `demo-unverified` are allowed for demo-only API publication. Everything else
 * is blocked before network access or persistence.
 */
export function assertRedistributable(manifest: SourceManifest): void {
  const profile = publicationRightsProfile(manifest);
  if (isRedistributable(manifest) || profile === "demo-unverified") return;
  const license = resolveManifestLicense(manifest);
  throw new LicenseError(
    `Source "${manifest.id}" is licensed as "${license.id}" (${license.title}), ` +
      `which does not permit redistribution and is not marked demo-unverified. ` +
      `Acquisition is blocked before re-hosting.`,
  );
}
