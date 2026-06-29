import { describe, expect, it } from "vitest";

import { sha256Hex } from "../RawDocument.js";
import type { ListOptions, RawDocumentRef } from "../SourceAdapter.js";
import {
  AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL,
  extractBylaws,
  inferAvisType,
  parseAvisPublics,
  parseAvisPublicsWordpress,
} from "./avis-publics-parser.js";
import {
  AvisPublicsBeauharnoisAdapter,
  createAvisPublicsBeauharnoisAdapter,
} from "./avis-publics-beauharnois.js";
import { SourceFetchError, type FetchLike } from "./avis-publics-valleyfield.js";
import { AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML } from "./avis-publics-beauharnois.fixture.js";

const FIXED_NOW = new Date("2026-06-08T09:30:00.000Z");

function okFetch(body: string, contentType = "text/html; charset=UTF-8"): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  });
}

async function collectRefs(adapter: AvisPublicsBeauharnoisAdapter, opts: ListOptions) {
  const refs: RawDocumentRef[] = [];
  for await (const ref of adapter.list(opts)) refs.push(ref);
  return refs;
}

describe("parseAvisPublics — Beauharnois WordPress fixture (recorded real bytes)", () => {
  const items = parseAvisPublics(AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML);

  it("parses every <details> notice block", () => {
    expect(items).toHaveLength(4);
  });

  it("dispatches WordPress markup to the WordPress parser", () => {
    // Same result whether called via the dispatcher or the WordPress parser.
    expect(parseAvisPublicsWordpress(AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML)).toHaveLength(4);
  });

  it("extracts the verbatim <summary> title + PDF url + type for the dérogation", () => {
    const dm = items.find((i) => i.type === "derogation-mineure");
    expect(dm?.title).toBe("Avis public : demande de dérogation mineure DM-2026-0037");
    expect(dm?.url).toBe(
      "https://ville.beauharnois.qc.ca/wp-content/uploads/AP_DM-2026-0037.pdf",
    );
    // DM-2026-0037 is the dérogation file id, NOT a bylaw → no bylaw captured.
    expect(dm?.bylaws).toEqual([]);
    // No date is shown on the WordPress block → honest NON_DISPONIBLE.
    expect(dm?.dateIso).toBe("non-disponible");
  });

  it("captures bylaw 701-102 for the consultation / projet de règlement", () => {
    const consultation = items.find((i) => i.title.includes("consultation"));
    expect(consultation?.type).toBe("consultation");
    expect(consultation?.bylaws).toContain("701-102");
    expect(consultation?.url).toBe(
      "https://ville.beauharnois.qc.ca/wp-content/uploads/PROJETREG-701-102.pdf",
    );
  });

  it("captures year-prefixed bylaws (2026-11, 2022-18) from the entrée-en-vigueur", () => {
    const eev = items.find(
      (i) => i.type === "entree-en-vigueur" && i.title.includes("2026-11"),
    );
    expect(eev?.bylaws).toEqual(expect.arrayContaining(["2026-11", "2022-18"]));
  });
});

describe("avis-publics parser helpers — Beauharnois numbering schemes", () => {
  it("extractBylaws keeps year-prefixed numbers but excludes the 4-digit DM file id", () => {
    expect(extractBylaws("Règlement 2026-11 modifiant le Règlement 2022-18")).toEqual(
      expect.arrayContaining(["2026-11", "2022-18"]),
    );
    expect(extractBylaws("demande de dérogation mineure DM-2026-0037")).toEqual([]);
    // Valleyfield sequential numbering still works.
    expect(extractBylaws("règlements 209-47 et 216-34")).toEqual(["209-47", "216-34"]);
  });

  it("inferAvisType classifies the Beauharnois filename codes", () => {
    expect(inferAvisType("AP_DM-2026-0037")).toBe("derogation-mineure");
    expect(inferAvisType("AEV_REG_2026-11")).toBe("entree-en-vigueur");
    expect(inferAvisType("PROJETREG 701-102")).toBe("projet-reglement");
  });
});

describe("AvisPublicsBeauharnoisAdapter", () => {
  it("exposes the J0 contract identity", () => {
    const a = createAvisPublicsBeauharnoisAdapter();
    expect(a.kind).toBe("avis-publics");
    expect(a.city).toBe("beauharnois");
    expect(a.version).toBe("0.1.0");
  });

  it("list() yields the single index ref", async () => {
    const a = new AvisPublicsBeauharnoisAdapter({ now: () => FIXED_NOW });
    const refs = await collectRefs(a, { city: "beauharnois" });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe(AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL);
    expect(refs[0]?.sourceKind).toBe("avis-publics");
    expect(refs[0]?.discoveredAt).toBe(FIXED_NOW.toISOString());
  });

  it("fetch() returns raw bytes + provenance + sha256, and hash() matches", async () => {
    const a = new AvisPublicsBeauharnoisAdapter({
      fetchImpl: okFetch(AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML),
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

  it("parseItems() turns fetched bytes into the four structured notices", async () => {
    const a = new AvisPublicsBeauharnoisAdapter({
      fetchImpl: okFetch(AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);
    expect(a.parseItems(raw)).toHaveLength(4);
  });

  it("raises a typed http error (never a generic throw) on non-200", async () => {
    const a = new AvisPublicsBeauharnoisAdapter({
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
    const a = new AvisPublicsBeauharnoisAdapter({
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
