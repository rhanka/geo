import { describe, expect, it } from "vitest";

import { sha256Hex } from "../RawDocument.js";
import type { ListOptions, RawDocumentRef } from "../SourceAdapter.js";
import {
  AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL,
  AVIS_PUBLICS_SOURCE_URL,
} from "./avis-publics-parser.js";
import {
  AvisPublicsGenericAdapter,
  BEAUHARNOIS_AVIS_CONFIG,
  createAvisPublicsAdapter,
  createAvisPublicsBeauharnoisGenericAdapter,
  createAvisPublicsValleyfieldGenericAdapter,
  isAvisLieAuZonage,
  VALLEYFIELD_AVIS_CONFIG,
} from "./avis-publics-generic.js";
import {
  SourceFetchError,
  type FetchLike,
} from "./avis-publics-valleyfield.js";
import { AVIS_PUBLICS_FIXTURE_HTML } from "./avis-publics-valleyfield.fixture.js";
import { AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML } from "./avis-publics-beauharnois.fixture.js";

const FIXED_NOW = new Date("2026-06-08T09:30:00.000Z");

function okFetch(body: string, contentType = "text/html; charset=utf-8"): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  });
}

async function collectRefs(adapter: AvisPublicsGenericAdapter, opts: ListOptions) {
  const refs: RawDocumentRef[] = [];
  for await (const ref of adapter.list(opts)) refs.push(ref);
  return refs;
}

// ─────────────────────────────────────────────────────────────────────────────
// isAvisLieAuZonage — zonage detection
// ─────────────────────────────────────────────────────────────────────────────

describe("isAvisLieAuZonage — détection avis liés au zonage", () => {
  it("détecte un avis de type ppcmoi (positif)", () => {
    expect(
      isAvisLieAuZonage({
        title: "Assemblée publique de consultation à propos de la demande PPCMOI2026-0066",
        dateLabel: "20 mai 2026",
        dateIso: "2026-05-20",
        url: "https://example.com/ppcmoi.pdf",
        type: "ppcmoi",
        bylaws: [],
      }),
    ).toBe(true);
  });

  it("détecte un projet de règlement de zonage (positif)", () => {
    expect(
      isAvisLieAuZonage({
        title: "Assemblée publique de consultation sur le premier projet du règlement 701-102 modifiant le règlement de zonage 701",
        dateLabel: "non-disponible",
        dateIso: "non-disponible",
        url: "https://example.com/projetreg.pdf",
        type: "consultation",
        bylaws: ["701-102"],
      }),
    ).toBe(true);
  });

  it("détecte un avis d'entrée en vigueur règlement de zonage (positif)", () => {
    expect(
      isAvisLieAuZonage({
        title: "Avis public d'entrée en vigueur des règlements 209-47 et 216-34 — règlement de zonage",
        dateLabel: "20 mai 2026",
        dateIso: "2026-05-20",
        url: "https://example.com/aev.pdf",
        type: "entree-en-vigueur",
        bylaws: ["209-47", "216-34"],
      }),
    ).toBe(true);
  });

  it("détecte un changement de zonage explicite (positif)", () => {
    expect(
      isAvisLieAuZonage({
        title: "Avis public — demande de changement de zonage secteur nord",
        dateLabel: "non-disponible",
        dateIso: "non-disponible",
        url: "https://example.com/czoning.pdf",
        type: "autre",
        bylaws: [],
      }),
    ).toBe(true);
  });

  it("ne classe pas une dérogation mineure sans zonage comme zonage (négatif)", () => {
    expect(
      isAvisLieAuZonage({
        title: "Dérogations mineures du 20 mai 2026",
        dateLabel: "20 mai 2026",
        dateIso: "2026-05-20",
        url: "https://example.com/dm.pdf",
        type: "derogation-mineure",
        bylaws: [],
      }),
    ).toBe(false);
  });

  it("ne classe pas une entrée en vigueur sécurité incendie comme zonage (négatif)", () => {
    expect(
      isAvisLieAuZonage({
        title: "Avis d'entrée en vigueur : Règlement 2026-07 concernant la prévention en matière de sécurité incendie",
        dateLabel: "non-disponible",
        dateIso: "non-disponible",
        url: "https://example.com/incendie.pdf",
        type: "entree-en-vigueur",
        bylaws: [],
      }),
    ).toBe(false);
  });

  it("ne classe pas un avis de vente pour taxes comme zonage (négatif)", () => {
    expect(
      isAvisLieAuZonage({
        title: "Avis public de vente pour défaut de paiement de taxes municipales",
        dateLabel: "non-disponible",
        dateIso: "non-disponible",
        url: "https://example.com/vente.pdf",
        type: "vente-pour-taxes",
        bylaws: [],
      }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Valleyfield — fixture réelle (Craft CMS)
// ─────────────────────────────────────────────────────────────────────────────

describe("AvisPublicsGenericAdapter — Valleyfield (Craft CMS fixture réelle)", () => {
  it("exposes the J0 contract identity for Valleyfield", () => {
    const a = createAvisPublicsValleyfieldGenericAdapter();
    expect(a.kind).toBe("avis-publics");
    expect(a.city).toBe("salaberry-de-valleyfield");
    expect(a.version).toBe("0.1.0");
  });

  it("list() yields the single index ref with correct URL and metadata", async () => {
    const a = new AvisPublicsGenericAdapter(VALLEYFIELD_AVIS_CONFIG, {
      now: () => FIXED_NOW,
    });
    const refs = await collectRefs(a, { city: "salaberry-de-valleyfield" });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe(AVIS_PUBLICS_SOURCE_URL);
    expect(refs[0]?.sourceKind).toBe("avis-publics");
    expect(refs[0]?.city).toBe("salaberry-de-valleyfield");
    expect(refs[0]?.discoveredAt).toBe(FIXED_NOW.toISOString());
    expect(refs[0]?.metadata).toMatchObject({ avisSourceId: "avis-publics-valleyfield" });
  });

  it("list() stops early when signal is already aborted", async () => {
    const a = new AvisPublicsGenericAdapter(VALLEYFIELD_AVIS_CONFIG);
    const controller = new AbortController();
    controller.abort();
    const refs = await collectRefs(a, { signal: controller.signal });
    expect(refs).toHaveLength(0);
  });

  it("fetch() returns raw bytes + provenance + sha256, and hash() matches", async () => {
    const a = new AvisPublicsGenericAdapter(VALLEYFIELD_AVIS_CONFIG, {
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
    expect(raw.provenance.obtentionMode).toBe("scraping");
    expect(raw.sha256).toBe(sha256Hex(raw.body));
    expect(a.hash(raw)).toBe(raw.sha256);
  });

  it("parseItems() turns fetched bytes into 4 structured notices", async () => {
    const a = new AvisPublicsGenericAdapter(VALLEYFIELD_AVIS_CONFIG, {
      fetchImpl: okFetch(AVIS_PUBLICS_FIXTURE_HTML),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);
    const items = a.parseItems(raw);
    expect(items).toHaveLength(4);
  });

  it("parseItemsZonage() retains only the PPCMOI notice from the Valleyfield fixture", async () => {
    const a = new AvisPublicsGenericAdapter(VALLEYFIELD_AVIS_CONFIG, {
      fetchImpl: okFetch(AVIS_PUBLICS_FIXTURE_HTML),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);
    const zonageItems = a.parseItemsZonage(raw);
    // The fixture has 1 PPCMOI notice: PPCMOI2026-0066.
    expect(zonageItems).toHaveLength(1);
    expect(zonageItems[0]?.type).toBe("ppcmoi");
    expect(zonageItems[0]?.title).toContain("PPCMOI2026-0066");
  });

  it("raises a typed http error (never a generic throw) on non-200", async () => {
    const a = new AvisPublicsGenericAdapter(VALLEYFIELD_AVIS_CONFIG, {
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    const [ref] = await collectRefs(a, {});
    const err = await a.fetch(ref as RawDocumentRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as SourceFetchError).kind).toBe("http");
  });

  it("raises a typed network error when fetch rejects", async () => {
    const a = new AvisPublicsGenericAdapter(VALLEYFIELD_AVIS_CONFIG, {
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

// ─────────────────────────────────────────────────────────────────────────────
// Beauharnois — fixture réelle (WordPress block editor)
// ─────────────────────────────────────────────────────────────────────────────

describe("AvisPublicsGenericAdapter — Beauharnois (WordPress fixture réelle)", () => {
  it("exposes the J0 contract identity for Beauharnois", () => {
    const a = createAvisPublicsBeauharnoisGenericAdapter();
    expect(a.kind).toBe("avis-publics");
    expect(a.city).toBe("beauharnois");
    expect(a.version).toBe("0.1.0");
  });

  it("list() yields the single index ref with correct URL and metadata", async () => {
    const a = new AvisPublicsGenericAdapter(BEAUHARNOIS_AVIS_CONFIG, {
      now: () => FIXED_NOW,
    });
    const refs = await collectRefs(a, { city: "beauharnois" });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe(AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL);
    expect(refs[0]?.sourceKind).toBe("avis-publics");
    expect(refs[0]?.city).toBe("beauharnois");
    expect(refs[0]?.discoveredAt).toBe(FIXED_NOW.toISOString());
    expect(refs[0]?.metadata).toMatchObject({ avisSourceId: "avis-publics-beauharnois" });
  });

  it("fetch() returns raw bytes + provenance + sha256, and hash() matches", async () => {
    const a = new AvisPublicsGenericAdapter(BEAUHARNOIS_AVIS_CONFIG, {
      fetchImpl: okFetch(AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML, "text/html; charset=UTF-8"),
      now: () => FIXED_NOW,
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);

    expect(raw.url).toBe(AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL);
    expect(raw.httpStatus).toBe(200);
    expect(raw.provenance.adapterVersion).toBe("0.1.0");
    expect(raw.provenance.fetchedViaObscura).toBe(false);
    expect(raw.sha256).toBe(sha256Hex(raw.body));
    expect(a.hash(raw)).toBe(raw.sha256);
  });

  it("parseItems() turns fetched bytes into 4 structured notices", async () => {
    const a = new AvisPublicsGenericAdapter(BEAUHARNOIS_AVIS_CONFIG, {
      fetchImpl: okFetch(AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);
    expect(a.parseItems(raw)).toHaveLength(4);
  });

  it("parseItemsZonage() retains the 701-102 projet-règlement-de-zonage notice", async () => {
    const a = new AvisPublicsGenericAdapter(BEAUHARNOIS_AVIS_CONFIG, {
      fetchImpl: okFetch(AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);
    const zonageItems = a.parseItemsZonage(raw);
    // The Beauharnois fixture has 1 notice referencing "règlement de zonage 701".
    expect(zonageItems).toHaveLength(1);
    expect(zonageItems[0]?.title).toContain("701-102");
    expect(zonageItems[0]?.title.toLowerCase()).toContain("règlement de zonage");
  });

  it("raises a typed http error on non-200", async () => {
    const a = new AvisPublicsGenericAdapter(BEAUHARNOIS_AVIS_CONFIG, {
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    const [ref] = await collectRefs(a, {});
    const err = await a.fetch(ref as RawDocumentRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as SourceFetchError).kind).toBe("http");
  });

  it("raises a typed network error when fetch rejects", async () => {
    const a = new AvisPublicsGenericAdapter(BEAUHARNOIS_AVIS_CONFIG, {
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    const [ref] = await collectRefs(a, {});
    const err = await a.fetch(ref as RawDocumentRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as SourceFetchError).kind).toBe("network");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic factory
// ─────────────────────────────────────────────────────────────────────────────

describe("createAvisPublicsAdapter — generic factory", () => {
  it("constructs any city from a config object", () => {
    const config = {
      citySlug: "test-ville",
      avisIndexUrl: "https://example.com/avis",
      sourceId: "avis-publics-test-ville",
    };
    const a = createAvisPublicsAdapter(config);
    expect(a.city).toBe("test-ville");
    expect(a.kind).toBe("avis-publics");
  });
});
