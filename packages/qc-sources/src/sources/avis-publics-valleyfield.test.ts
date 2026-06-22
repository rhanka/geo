import { describe, expect, it } from "vitest";

import { sha256Hex } from "../RawDocument.js";
import type { ListOptions, RawDocumentRef } from "../SourceAdapter.js";
import {
  AVIS_PUBLICS_SOURCE_URL,
  parseAvisPublics,
} from "./avis-publics-parser.js";
import {
  AvisPublicsValleyfieldAdapter,
  createAvisPublicsValleyfieldAdapter,
  SourceFetchError,
  type FetchLike,
} from "./avis-publics-valleyfield.js";
import { AVIS_PUBLICS_FIXTURE_HTML } from "./avis-publics-valleyfield.fixture.js";

const FIXED_NOW = new Date("2026-06-08T09:30:00.000Z");

function okFetch(body: string, contentType = "text/html; charset=utf-8"): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  });
}

async function collectRefs(adapter: AvisPublicsValleyfieldAdapter, opts: ListOptions) {
  const refs: RawDocumentRef[] = [];
  for await (const ref of adapter.list(opts)) refs.push(ref);
  return refs;
}

describe("parseAvisPublics (recorded real fixture)", () => {
  const items = parseAvisPublics(AVIS_PUBLICS_FIXTURE_HTML);

  it("parses every notice anchor", () => {
    expect(items).toHaveLength(4);
  });

  it("extracts verbatim title, ISO date, absolute PDF url and type", () => {
    const first = items[0];
    expect(first?.title).toBe("Dérogations mineures du 20 mai 2026");
    expect(first?.dateIso).toBe("2026-05-20");
    expect(first?.url).toBe(
      "https://dua3m7xvptjbw.cloudfront.net/documents/avis/2026-05-20-Avis-de-derogation-mineure.pdf",
    );
    expect(first?.type).toBe("derogation-mineure");
  });

  it("decodes entities and extracts bylaws", () => {
    const eev = items.find((i) => i.type === "entree-en-vigueur");
    expect(eev?.title).toBe("Avis public d'entrée en vigueur des règlements 209-47 et 216-34");
    expect(eev?.bylaws).toEqual(["209-47", "216-34"]);
  });
});

describe("AvisPublicsValleyfieldAdapter", () => {
  it("exposes the J0 contract identity", () => {
    const a = createAvisPublicsValleyfieldAdapter();
    expect(a.kind).toBe("avis-publics");
    expect(a.city).toBe("salaberry-de-valleyfield");
    expect(a.version).toBe("0.1.0");
  });

  it("list() yields the single index ref", async () => {
    const a = new AvisPublicsValleyfieldAdapter({ now: () => FIXED_NOW });
    const refs = await collectRefs(a, { city: "salaberry-de-valleyfield" });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe(AVIS_PUBLICS_SOURCE_URL);
    expect(refs[0]?.sourceKind).toBe("avis-publics");
    expect(refs[0]?.discoveredAt).toBe(FIXED_NOW.toISOString());
  });

  it("fetch() returns raw bytes + provenance + sha256, and hash() matches", async () => {
    const a = new AvisPublicsValleyfieldAdapter({
      fetchImpl: okFetch(AVIS_PUBLICS_FIXTURE_HTML),
      now: () => FIXED_NOW,
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);

    expect(raw.url).toBe(AVIS_PUBLICS_SOURCE_URL);
    expect(raw.httpStatus).toBe(200);
    expect(raw.contentType).toBe("text/html; charset=utf-8");
    expect(raw.provenance.adapterVersion).toBe("0.1.0");
    expect(raw.provenance.fetchedViaObscura).toBe(false);
    expect(raw.sha256).toBe(sha256Hex(raw.body));
    expect(a.hash(raw)).toBe(raw.sha256);
  });

  it("parseItems() turns fetched bytes into structured notices", async () => {
    const a = new AvisPublicsValleyfieldAdapter({
      fetchImpl: okFetch(AVIS_PUBLICS_FIXTURE_HTML),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);
    expect(a.parseItems(raw)).toHaveLength(4);
  });

  it("raises a typed http error (never a generic throw) on non-200", async () => {
    const a = new AvisPublicsValleyfieldAdapter({
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    const [ref] = await collectRefs(a, {});
    await expect(a.fetch(ref as RawDocumentRef)).rejects.toMatchObject({
      kind: "http",
    });
  });

  it("raises a typed network error when fetch rejects", async () => {
    const a = new AvisPublicsValleyfieldAdapter({
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    });
    const [ref] = await collectRefs(a, {});
    const err = await a.fetch(ref as RawDocumentRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as SourceFetchError).kind).toBe("network");
  });
});
