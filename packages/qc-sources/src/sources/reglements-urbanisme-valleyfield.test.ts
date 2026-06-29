import { describe, expect, it } from "vitest";

import { sha256Hex } from "../RawDocument.js";
import type { ListOptions, RawDocumentRef } from "../SourceAdapter.js";
import {
  SourceFetchError,
  type FetchLike,
} from "./avis-publics-valleyfield.js";
import { REGLEMENTS_URBANISME_SOURCE_URL } from "./reglements-urbanisme-parser.js";
import {
  createReglementsUrbanismeValleyfieldAdapter,
  isPdftotextAvailable,
  ReglementsUrbanismeValleyfieldAdapter,
  reglementPdfUrl,
} from "./reglements-urbanisme-valleyfield.js";
import {
  REGLEMENT_150_51_TEXT,
  REGLEMENT_450_02_TEXT,
} from "./reglements-urbanisme-valleyfield.fixture.js";

const FIXED_NOW = new Date("2026-06-09T09:30:00.000Z");

/** Mock fetch returning PDF-ish bytes (the content is opaque; pdfToText is injected). */
function okFetch(body: Uint8Array, contentType = "application/pdf"): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (n: string) =>
        n.toLowerCase() === "content-type" ? contentType : null,
    },
    arrayBuffer: async () => body.buffer.slice(0) as ArrayBuffer,
  });
}

/** Deterministic injected PDF→text: maps the fetched bytes to a committed excerpt. */
function fakePdfToText(text: string) {
  return async () => text;
}

async function collectRefs(
  adapter: ReglementsUrbanismeValleyfieldAdapter,
  opts: ListOptions,
) {
  const refs: RawDocumentRef[] = [];
  for await (const ref of adapter.list(opts)) refs.push(ref);
  return refs;
}

describe("ReglementsUrbanismeValleyfieldAdapter — contract identity", () => {
  it("exposes the J0 contract identity (kind reglement, Valleyfield)", () => {
    const a = createReglementsUrbanismeValleyfieldAdapter();
    expect(a.kind).toBe("reglement");
    expect(a.city).toBe("salaberry-de-valleyfield");
    expect(a.version).toBe("0.1.0");
    expect(a.sourceId).toBe("reglements-urbanisme-valleyfield");
  });

  it("list() yields the HTML listing ref + one ref per default bylaw PDF", async () => {
    const a = new ReglementsUrbanismeValleyfieldAdapter({ now: () => FIXED_NOW });
    const refs = await collectRefs(a, { city: "salaberry-de-valleyfield" });
    // listing + 150-51 + 450-02.
    expect(refs).toHaveLength(3);
    expect(refs[0]?.url).toBe(REGLEMENTS_URBANISME_SOURCE_URL);
    expect(refs[0]?.contentType).toBe("text/html");
    const pdfUrls = refs.slice(1).map((r) => r.url);
    expect(pdfUrls).toContain(reglementPdfUrl("Reglement-150-51-zonage.pdf"));
    expect(pdfUrls).toContain(reglementPdfUrl("Reglement-450-02.pdf"));
    for (const r of refs.slice(1)) expect(r.contentType).toBe("application/pdf");
  });
});

describe("ReglementsUrbanismeValleyfieldAdapter — fetch + PDF→text", () => {
  it("fetch() of a PDF returns raw bytes + extracted text + provenance, hash matches", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const a = new ReglementsUrbanismeValleyfieldAdapter({
      fetchImpl: okFetch(pdfBytes),
      pdfToText: fakePdfToText(REGLEMENT_150_51_TEXT),
      now: () => FIXED_NOW,
    });
    const refs = await collectRefs(a, {});
    const pdfRef = refs.find((r) => r.contentType === "application/pdf")!;
    const raw = await a.fetch(pdfRef);

    expect(raw.httpStatus).toBe(200);
    expect(raw.contentType).toBe("application/pdf");
    expect(raw.body).toEqual(pdfBytes);
    // The extracted text is attached (the parseable projection of the binary).
    expect(raw.text).toBe(REGLEMENT_150_51_TEXT);
    expect(raw.provenance.adapterVersion).toBe("0.1.0");
    expect(raw.provenance.fetchedViaObscura).toBe(false);
    expect(raw.provenance.obtentionMode).toBe("download");
    expect(raw.sha256).toBe(sha256Hex(raw.body));
    expect(a.hash(raw)).toBe(raw.sha256);
  });

  it("parseDocument() turns the fetched bylaw into structured Bylaw + Zone records", async () => {
    const a = new ReglementsUrbanismeValleyfieldAdapter({
      fetchImpl: okFetch(new Uint8Array([1, 2, 3])),
      pdfToText: fakePdfToText(REGLEMENT_150_51_TEXT),
    });
    const refs = await collectRefs(a, {});
    const pdfRef = refs.find((r) => r.contentType === "application/pdf")!;
    const raw = await a.fetch(pdfRef);
    const doc = a.parseDocument(raw);
    expect(doc.primaryNumero).toBe("150-51");
    expect(doc.bylaws.map((b) => b.numero)).toEqual(["150-51", "150"]);
    expect(doc.zones.map((z) => z.code)).toContain("H-521");
  });

  it("450-02 yields bylaws but NO zones (honest)", async () => {
    const a = new ReglementsUrbanismeValleyfieldAdapter({
      fetchImpl: okFetch(new Uint8Array([1])),
      pdfToText: fakePdfToText(REGLEMENT_450_02_TEXT),
    });
    const [, pdfRef] = await collectRefs(a, {});
    const raw = await a.fetch(pdfRef as RawDocumentRef);
    const doc = a.parseDocument(raw);
    expect(doc.bylaws.map((b) => b.numero)).toEqual(["450-02", "450"]);
    expect(doc.zones).toEqual([]);
  });
});

describe("ReglementsUrbanismeValleyfieldAdapter — typed errors (never a raw throw)", () => {
  it("raises a typed http error on non-200", async () => {
    const a = new ReglementsUrbanismeValleyfieldAdapter({
      fetchImpl: async () => ({
        ok: false,
        status: 502,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    const [, pdfRef] = await collectRefs(a, {});
    const err = await a.fetch(pdfRef as RawDocumentRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as SourceFetchError).kind).toBe("http");
  });

  it("raises a typed network error when fetch rejects", async () => {
    const a = new ReglementsUrbanismeValleyfieldAdapter({
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    });
    const [, pdfRef] = await collectRefs(a, {});
    const err = await a.fetch(pdfRef as RawDocumentRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as SourceFetchError).kind).toBe("network");
  });

  it("raises a typed parse error when PDF→text fails", async () => {
    const a = new ReglementsUrbanismeValleyfieldAdapter({
      fetchImpl: okFetch(new Uint8Array([0x25, 0x50])),
      pdfToText: async () => {
        throw new SourceFetchError("parse", "pdftotext exited 1", "x");
      },
    });
    const [, pdfRef] = await collectRefs(a, {});
    const err = await a.fetch(pdfRef as RawDocumentRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as SourceFetchError).kind).toBe("parse");
  });
});

describe("isPdftotextAvailable (poppler preflight)", () => {
  it("resolves to a boolean and never throws, whatever the runtime", async () => {
    // Contract: a missing binary must resolve(false), not reject — so the
    // worker preflight can turn the silent 0-signal false-negative into a
    // loud diagnostic without crashing.
    const available = await isPdftotextAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("mirrors the exact `pdftotext -v` probe it implements, on any host", async () => {
    // Self-consistent — do NOT assume the ambient image ships poppler. The
    // published-monorepo CI runs on a plain ubuntu-latest without poppler-utils,
    // so a hard `toBe(true)` is environment coupling. Instead assert the helper
    // reflects reality, computed independently with the same predicate it uses
    // (`pdftotext -v` exit 0), so it is correct with OR without poppler. Image
    // provisioning is the Docker build's job, not this unit test's.
    const { spawnSync } = await import("node:child_process");
    const probe = spawnSync("pdftotext", ["-v"], { stdio: "ignore" });
    const onPath = !probe.error && probe.status === 0;
    await expect(isPdftotextAvailable()).resolves.toBe(onPath);
  });
});
