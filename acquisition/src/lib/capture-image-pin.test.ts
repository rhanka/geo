import { describe, expect, it } from "vitest";

import {
  assertPinnedImage,
  captureRetrievalDescriptor,
  captureRetrievalPrefix,
  isPinnedCaptureImage,
} from "./capture-image-pin.js";

const DIGEST = `ghcr.io/rhanka/geo-capture@sha256:${"a".repeat(64)}`;

describe("isPinnedCaptureImage", () => {
  it("accepte un digest GHCR immuable", () => {
    expect(isPinnedCaptureImage(DIGEST)).toBe(true);
  });

  it("refuse un tag Scaleway mutable", () => {
    expect(isPinnedCaptureImage("rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1")).toBe(false);
  });

  it("refuse un tag GHCR (non epingle par digest)", () => {
    expect(isPinnedCaptureImage("ghcr.io/rhanka/geo-capture:latest")).toBe(false);
  });

  it("refuse un digest tronque ou non-hex", () => {
    expect(isPinnedCaptureImage(`ghcr.io/rhanka/geo-capture@sha256:${"a".repeat(63)}`)).toBe(false);
    expect(isPinnedCaptureImage(`ghcr.io/rhanka/geo-capture@sha256:${"z".repeat(64)}`)).toBe(false);
  });

  it("refuse un autre depot, meme epingle", () => {
    expect(isPinnedCaptureImage(`ghcr.io/rhanka/geo-api@sha256:${"a".repeat(64)}`)).toBe(false);
  });
});

describe("assertPinnedImage", () => {
  it("ne jette pas sur un digest valide", () => {
    expect(() => assertPinnedImage(DIGEST)).not.toThrow();
  });

  it("jette sur un tag mutable", () => {
    expect(() => assertPinnedImage("rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1")).toThrow();
  });

  it("tolere un tag mutable UNIQUEMENT avec allowUnpinned", () => {
    expect(() => assertPinnedImage("ghcr.io/rhanka/geo-capture:latest", { allowUnpinned: true })).not.toThrow();
  });
});

describe("captureRetrieval", () => {
  it("construit un prefixe S3 deterministe", () => {
    expect(captureRetrievalPrefix("zones", "20260802T120000Z")).toBe("capture/_runs/zones-20260802T120000Z-");
  });

  it("emet un descripteur complet et recuperable sans POD_UID", () => {
    const descriptor = captureRetrievalDescriptor({
      lane: "zones",
      runStamp: "20260802T120000Z",
      shards: 1,
      image: DIGEST,
    });
    expect(descriptor.lane).toBe("zones");
    expect(descriptor.run_stamp).toBe("20260802T120000Z");
    expect(descriptor.shards).toBe(1);
    expect(descriptor.image).toBe(DIGEST);
    expect(descriptor.s3_manifest_prefix).toBe("capture/_runs/zones-20260802T120000Z-");
    expect(descriptor.note).toContain("<shard>-<POD_UID>");
  });
});
