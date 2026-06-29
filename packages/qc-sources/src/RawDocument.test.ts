import { describe, expect, it } from "vitest";

import {
  buildRawDocumentRecord,
  extForContentType,
  rawDocumentId,
  RawDocumentRecordSchema,
  rawStorageKey,
  sha256Hex,
} from "./RawDocument.js";

const PROVENANCE = {
  version: "0.1.0",
  userAgent: "radar-immobilier/0.1 (+contact)",
  viaObscura: false,
} as const;

describe("sha256Hex", () => {
  it("is a 64-char lowercase hex digest, stable for identical bytes", () => {
    const a = sha256Hex(new TextEncoder().encode("hello"));
    const b = sha256Hex("hello");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
    expect(a).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("rawDocumentId", () => {
  it("is deterministic and namespaced by source + sha256", () => {
    expect(rawDocumentId("avis-publics-valleyfield", "abc123")).toBe(
      "raw:avis-publics-valleyfield:abc123",
    );
  });
});

describe("extForContentType", () => {
  it("maps common content types, ignoring charset and case", () => {
    expect(extForContentType("text/html; charset=utf-8")).toBe("html");
    expect(extForContentType("application/pdf")).toBe("pdf");
    expect(extForContentType("APPLICATION/JSON")).toBe("json");
    expect(extForContentType("something/unknown")).toBe("bin");
  });
});

describe("rawStorageKey (content-addressed, no fetch date)", () => {
  it("builds raw/<source>/cas/<sha>.<ext> — no date partition", () => {
    const key = rawStorageKey({
      source: "avis-publics-valleyfield",
      sha256: "deadbeef",
      contentType: "text/html",
    });
    expect(key).toBe("raw/avis-publics-valleyfield/cas/deadbeef.html");
    expect(key).not.toMatch(/\/\d{4}\/\d{2}\/\d{2}\//);
  });
});

describe("buildRawDocumentRecord", () => {
  const body = new TextEncoder().encode("<html>avis</html>");

  it("computes sha256, idempotent id and storage key, and validates", () => {
    const rec = buildRawDocumentRecord({
      source: "avis-publics-valleyfield",
      sourceUrl: "https://www.ville.valleyfield.qc.ca/avis-publics",
      body,
      fetchedAt: "2026-06-08T09:30:00.000Z",
      contentType: "text/html; charset=utf-8",
      provenance: PROVENANCE,
    });

    expect(() => RawDocumentRecordSchema.parse(rec)).not.toThrow();
    expect(rec.sha256).toBe(sha256Hex(body));
    expect(rec.id).toBe(rawDocumentId("avis-publics-valleyfield", rec.sha256));
    expect(rec.storageKey).toBe(
      `raw/avis-publics-valleyfield/cas/${rec.sha256}.html`,
    );
    expect(rec.bytesLen).toBe(body.byteLength);
    expect(rec.provenance.viaObscura).toBe(false);
  });

  it("is idempotent: byte-identical content yields the same id + key", () => {
    const a = buildRawDocumentRecord({
      source: "avis-publics-valleyfield",
      sourceUrl: "https://www.ville.valleyfield.qc.ca/avis-publics",
      body,
      fetchedAt: "2026-06-08T09:30:00.000Z",
      contentType: "text/html",
      provenance: PROVENANCE,
    });
    const b = buildRawDocumentRecord({
      source: "avis-publics-valleyfield",
      sourceUrl: "https://www.ville.valleyfield.qc.ca/avis-publics",
      body,
      fetchedAt: "2026-06-08T09:30:00.000Z",
      contentType: "text/html",
      provenance: PROVENANCE,
    });
    expect(a.id).toBe(b.id);
    expect(a.storageKey).toBe(b.storageKey);
  });

  it("dedups across fetches: same content fetched on different days → same key", () => {
    const common = {
      source: "avis-publics-valleyfield",
      sourceUrl: "https://www.ville.valleyfield.qc.ca/avis-publics",
      body,
      contentType: "text/html",
      provenance: PROVENANCE,
    } as const;
    const day1 = buildRawDocumentRecord({
      ...common,
      fetchedAt: "2026-06-08T09:30:00.000Z",
    });
    const day2 = buildRawDocumentRecord({
      ...common,
      fetchedAt: "2026-09-15T23:59:00.000Z",
    });
    // The whole point of CAS: re-fetching the identical doc must NOT create a
    // second object (HEAD-skip works), so the keys must match despite the dates.
    expect(day2.storageKey).toBe(day1.storageKey);
  });

  it("carries the ciblagePlanId into provenance when supplied", () => {
    const rec = buildRawDocumentRecord({
      source: "avis-publics-valleyfield",
      sourceUrl: "https://www.ville.valleyfield.qc.ca/avis-publics",
      body,
      fetchedAt: "2026-06-08T09:30:00.000Z",
      contentType: "text/html",
      provenance: { ...PROVENANCE, ciblagePlanId: "plan-42" },
    });
    expect(rec.provenance.ciblagePlanId).toBe("plan-42");
  });

  it("persists optional source title and publishedAt without affecting CAS identity", () => {
    const base = {
      source: "proces-verbaux-testville",
      sourceUrl: "https://testville.qc.ca/pv/2026-06-01.pdf",
      body,
      fetchedAt: "2026-06-08T09:30:00.000Z",
      contentType: "application/pdf",
      provenance: PROVENANCE,
    } as const;
    const withMeta = buildRawDocumentRecord({
      ...base,
      title: "Séance ordinaire du 1 juin 2026",
      publishedAt: "2026-06-01",
    });
    const withoutMeta = buildRawDocumentRecord(base);

    expect(withMeta.title).toBe("Séance ordinaire du 1 juin 2026");
    expect(withMeta.publishedAt).toBe("2026-06-01");
    expect(withMeta.id).toBe(withoutMeta.id);
    expect(withMeta.storageKey).toBe(withoutMeta.storageKey);
  });

  it("rejects a non-hex sha (schema guard)", () => {
    expect(() =>
      RawDocumentRecordSchema.parse({
        id: "raw:x:nothex",
        source: "x",
        sourceUrl: "https://example.com",
        sha256: "NOTHEX",
        fetchedAt: "2026-06-08T09:30:00.000Z",
        storageKey: "raw/x/2026/06/08/nothex.html",
        contentType: "text/html",
        provenance: PROVENANCE,
        bytesLen: 1,
      }),
    ).toThrow();
  });
});
