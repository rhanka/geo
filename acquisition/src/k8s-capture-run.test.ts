import { describe, expect, it } from "vitest";

import { captureImage, parseArgs } from "./k8s-capture-run.js";
import { isPinnedCaptureImage } from "./lib/capture-image-pin.js";

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
