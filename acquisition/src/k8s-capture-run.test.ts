import { describe, expect, it } from "vitest";

import { captureImage, imagePinOptsForPath, jobManifest, parseArgs } from "./k8s-capture-run.js";
import { assertPinnedImage, isPinnedCaptureImage } from "./lib/capture-image-pin.js";

const BASE = [
  "--lane", "normes",
  "--worklist", "acquisition/config/normes-col6-subpages-20260810.json",
  "--kubeconfig", "/tmp/ovh.kubeconfig",
];

describe("captureImage", () => {
  it("reads the pinned GHCR digest declared in acquisition/config/capture-image.json", () => {
    const cfg = captureImage();
    expect(cfg.image).toBe(
      "ghcr.io/rhanka/geo-capture@sha256:60f048b5ac667805bf90b3e1a1e75b3b85fd2a4dc634aa11c13fee8b27fa629b",
    );
    // The declared default is itself PINNED by construction — no mutable tag ships.
    expect(isPinnedCaptureImage(cfg.image)).toBe(true);
  });
});

describe("parseArgs", () => {
  it("defaults --image to the pinned capture digest (kills the deprecated mutable Scaleway default)", () => {
    const image = parseArgs(BASE).image;
    expect(image).toBe(captureImage().image);
    expect(isPinnedCaptureImage(image)).toBe(true);
    // regression guard: the old mutable Scaleway default is gone.
    expect(image).not.toMatch(/scw\.cloud/);
  });

  it("still honours an explicit --image override", () => {
    const pinned = `ghcr.io/rhanka/geo-capture@sha256:${"a".repeat(64)}`;
    expect(parseArgs([...BASE, "--image", pinned]).image).toBe(pinned);
  });

  it("parses the --allow-unpinned-image debug flag (default false)", () => {
    expect(parseArgs(BASE).allowUnpinnedImage).toBe(false);
    expect(parseArgs([...BASE, "--allow-unpinned-image"]).allowUnpinnedImage).toBe(true);
  });
});

// Locks the escape-hatch reachability STRUCTURALLY (peer review pv + adversarial):
// the storing/gated submission path must require a pinned image even when
// --allow-unpinned-image is passed; the debug escape hatch is dry-run-only.
describe("imagePinOptsForPath — escape-hatch is dry-run-only, storing path is hard by construction", () => {
  const UNPINNED = "ghcr.io/rhanka/geo-capture:latest";
  const PINNED = `ghcr.io/rhanka/geo-capture@sha256:${"a".repeat(64)}`;

  it("STORE path IGNORES --allow-unpinned-image → pinned required by construction", () => {
    // the flag is ignored on the store path (structural, not 'we just don't pass it')
    expect(imagePinOptsForPath("store", true)).toEqual({ allowUnpinned: false });
    expect(() => assertPinnedImage(UNPINNED, imagePinOptsForPath("store", true))).toThrow();
    // and the default (flag=false) equally requires pinned
    expect(() => assertPinnedImage(UNPINNED, imagePinOptsForPath("store", false))).toThrow();
    // a pinned image passes on the store path
    expect(() => assertPinnedImage(PINNED, imagePinOptsForPath("store", true))).not.toThrow();
  });

  it("DRY-RUN path honours the escape hatch ONLY when the flag is explicitly set", () => {
    // flag=true → escape hatch open, unpinned tolerated (debug)
    expect(imagePinOptsForPath("dry-run", true)).toEqual({ allowUnpinned: true });
    expect(() => assertPinnedImage(UNPINNED, imagePinOptsForPath("dry-run", true))).not.toThrow();
    // flag=false → dry-run STILL requires pinned (hatch opens only on explicit flag)
    expect(imagePinOptsForPath("dry-run", false)).toEqual({ allowUnpinned: false });
    expect(() => assertPinnedImage(UNPINNED, imagePinOptsForPath("dry-run", false))).toThrow();
  });
});

// §6 : le pod doit écrire là où le gate a validé. Le runner injecte le bucket gated
// (config-driven) dans S3_BUCKET du pod → une image sert prod ET préprod (l'image bake prod).
describe("jobManifest — injection S3_BUCKET (§6 : override du bucket baké dans l'image)", () => {
  const args = parseArgs(BASE);
  const key = "registry/capture-worklists/normes-x.json";

  it("injecte S3_BUCKET = le bucket gated (préprod) dans l'env du pod", () => {
    expect(jobManifest(args, key, "sentropic-geo-preprod")).toMatch(
      /- name: S3_BUCKET\n\s+value: "sentropic-geo-preprod"/,
    );
  });

  it("propage aussi le bucket prod quand c'est lui le bucket gated (même image, 2 envs)", () => {
    expect(jobManifest(args, key, "sentropic-geo")).toMatch(/- name: S3_BUCKET\n\s+value: "sentropic-geo"/);
  });
});
