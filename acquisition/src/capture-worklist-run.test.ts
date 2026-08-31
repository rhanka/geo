import { describe, expect, it } from "vitest";

import { assertPodCaptureBucket } from "./capture-worklist-run.js";
import { s3Target } from "./lib/s3.js";

// §6 defense-in-depth : l'override S3_BUCKET rend le bucket du pod env-influençable, MAIS le pod
// re-valide `resolveBucket()` contre l'allowlist campagne FERMÉE AVANT tout I/O. Un ENV arbitraire
// (pod-env compromis, run manuel, misconfig) est refusé fail-closed — jamais écrit. Préserve le
// principe « JAMAIS un ENV S3_BUCKET libre/arbitraire » (object-store-campaign-gate) que #293 a posé.
describe("assertPodCaptureBucket — §6 fail-closed pod-side (re-valide resolveBucket)", () => {
  it("accepte le bucket préprod injecté par le runner gaté (allowlist)", () => {
    expect(assertPodCaptureBucket({ S3_BUCKET: "sentropic-geo-preprod" })).toBe("sentropic-geo-preprod");
  });

  it("accepte le défaut baké config-driven quand aucun S3_BUCKET", () => {
    expect(assertPodCaptureBucket({})).toBe(s3Target().bucket);
  });

  it("REJETTE un S3_BUCKET arbitraire hors-allowlist (fail-closed, ne write jamais)", () => {
    expect(() => assertPodCaptureBucket({ S3_BUCKET: "attacker-bucket" })).toThrow(/hors de l'allowlist campagne/);
    expect(() => assertPodCaptureBucket({ S3_BUCKET: "sentropic-geo-EVIL" })).toThrow(/fail-closed/);
    expect(() => assertPodCaptureBucket({ S3_BUCKET: "sentropic-geo-preprod-attacker" })).toThrow();
  });

  it("un S3_BUCKET vide/blanc retombe sur le défaut baké (pas d'override arbitraire)", () => {
    expect(assertPodCaptureBucket({ S3_BUCKET: "   " })).toBe(s3Target().bucket);
  });
});
