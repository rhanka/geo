import { describe, expect, it } from "vitest";

import { sha256Hex } from "../RawDocument.js";
import type { ListOptions, RawDocumentRef } from "../SourceAdapter.js";
import {
  createAdressesQuebecAdapter,
  AdressesQuebecAdapter,
  adressesResourceUrl,
  adressesSourceId,
  ADRESSES_QUEBEC_ADAPTER_VERSION,
} from "./adresses-quebec.js";
import {
  adressesQuebecBeauharnoisJson,
  adressesQuebecValleyfieldJson,
} from "./adresses-quebec.fixture.js";
import { SourceFetchError, type FetchLike } from "./avis-publics-valleyfield.js";

const FIXED_NOW = new Date("2026-06-08T09:30:00.000Z");

function okFetch(
  body: string,
  contentType = "application/json; charset=utf-8",
): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (n: string) =>
        n.toLowerCase() === "content-type" ? contentType : null,
    },
    arrayBuffer: async () =>
      new TextEncoder().encode(body).buffer as ArrayBuffer,
  });
}

async function collectRefs(adapter: AdressesQuebecAdapter, opts: ListOptions) {
  const refs: RawDocumentRef[] = [];
  for await (const ref of adapter.list(opts)) refs.push(ref);
  return refs;
}

function vfAdapter(
  extra: Partial<Parameters<typeof createAdressesQuebecAdapter>[0]> = {},
) {
  return new AdressesQuebecAdapter({
    codeMamh: "70052",
    city: "salaberry-de-valleyfield",
    now: () => FIXED_NOW,
    ...extra,
  });
}

describe("adressesResourceUrl / adressesSourceId (public terrAPI resource shape)", () => {
  it("builds the public per-municipality terrAPI addresses url", () => {
    expect(adressesResourceUrl("70052")).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70052/adresses?geometry=0",
    );
    expect(adressesResourceUrl("70022")).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70022/adresses?geometry=0",
    );
  });

  it("derives the stable source id matching the seed-ontology ids", () => {
    expect(adressesSourceId("70052")).toBe("adresses-quebec-70052");
    expect(adressesSourceId("70022")).toBe("adresses-quebec-70022");
  });
});

describe("AdressesQuebecAdapter (J0 contract)", () => {
  it("exposes the adresses-quebec kind, city, version and resource identity", () => {
    const a = vfAdapter();
    expect(a.kind).toBe("adresses-quebec");
    expect(a.city).toBe("salaberry-de-valleyfield");
    expect(a.version).toBe(ADRESSES_QUEBEC_ADAPTER_VERSION);
    expect(a.sourceId).toBe("adresses-quebec-70052");
    expect(a.resourceUrl).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70052/adresses?geometry=0",
    );
  });

  it("list() yields the single per-municipality resource ref", async () => {
    const a = vfAdapter();
    const refs = await collectRefs(a, { city: "salaberry-de-valleyfield" });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70052/adresses?geometry=0",
    );
    expect(refs[0]?.sourceKind).toBe("adresses-quebec");
    expect(refs[0]?.contentType).toBe("application/json");
    expect(refs[0]?.discoveredAt).toBe(FIXED_NOW.toISOString());
    expect(refs[0]?.metadata).toMatchObject({ codeMamh: "70052", geometry: "0" });
  });

  it("list() yields nothing when the signal is already aborted", async () => {
    const a = vfAdapter();
    const controller = new AbortController();
    controller.abort();
    const refs = await collectRefs(a, { signal: controller.signal });
    expect(refs).toHaveLength(0);
  });
});

describe("fetch() over REAL committed terrAPI bytes (no network)", () => {
  it("returns raw bytes + download provenance + sha256, and hash() matches", async () => {
    const a = vfAdapter({
      fetchImpl: okFetch(adressesQuebecValleyfieldJson()),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);

    expect(raw.url).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70052/adresses?geometry=0",
    );
    expect(raw.httpStatus).toBe(200);
    expect(raw.sourceKind).toBe("adresses-quebec");
    expect(raw.city).toBe("salaberry-de-valleyfield");
    expect(raw.contentType).toBe("application/json; charset=utf-8");
    expect(raw.provenance.adapterVersion).toBe(ADRESSES_QUEBEC_ADAPTER_VERSION);
    expect(raw.provenance.obtentionMode).toBe("download");
    expect(raw.provenance.fetchedViaObscura).toBe(false);
    expect(raw.sha256).toBe(sha256Hex(raw.body));
    expect(a.hash(raw)).toBe(raw.sha256);
  });

  it("parseAdresses() turns fetched bytes into the REAL Valleyfield addresses (anti-invention)", async () => {
    const a = vfAdapter({
      fetchImpl: okFetch(adressesQuebecValleyfieldJson()),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);
    const { adresses } = a.parseAdresses(raw);

    expect(adresses).toHaveLength(3);
    expect(adresses[0]!.nom).toBe(
      "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5",
    );
    expect(adresses[0]!.code).toBe("000464c34bfd4f25862f208af2e3dbf5J6S6A5");
    // No geometry / no lot in the bytes — anti-invention (geom stays null).
    expect(adresses[0]!).not.toHaveProperty("geom");
  });

  it("parseAdresses() reads the REAL Beauharnois (70022) sample (different code)", async () => {
    const a = new AdressesQuebecAdapter({
      codeMamh: "70022",
      city: "beauharnois",
      now: () => FIXED_NOW,
      fetchImpl: okFetch(adressesQuebecBeauharnoisJson()),
    });
    const [ref] = await collectRefs(a, {});
    expect(ref?.url).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70022/adresses?geometry=0",
    );
    const raw = await a.fetch(ref as RawDocumentRef);
    const { adresses } = a.parseAdresses(raw);
    expect(adresses[0]!.nom).toBe("279 chemin Saint-Louis, Beauharnois J6N2J3");
  });

  it("is idempotent: re-fetching identical bytes yields the same sha256/hash", async () => {
    const a = vfAdapter({
      fetchImpl: okFetch(adressesQuebecValleyfieldJson()),
    });
    const [ref] = await collectRefs(a, {});
    const first = await a.fetch(ref as RawDocumentRef);
    const second = await a.fetch(ref as RawDocumentRef);
    expect(second.sha256).toBe(first.sha256);
    expect(a.hash(second)).toBe(a.hash(first));
  });
});

describe("typed errors (returned, never a generic throw)", () => {
  it("raises a typed http error on a non-200 response", async () => {
    const a = vfAdapter({
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    const [ref] = await collectRefs(a, {});
    await expect(a.fetch(ref as RawDocumentRef)).rejects.toMatchObject({
      kind: "http",
    });
  });

  it("raises a typed network error when the fetch rejects", async () => {
    const a = vfAdapter({
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND geoegl.msp.gouv.qc.ca");
      },
    });
    const [ref] = await collectRefs(a, {});
    const err = await a.fetch(ref as RawDocumentRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as SourceFetchError).kind).toBe("network");
  });

  it("raises a typed timeout error when the fetch aborts", async () => {
    const a = vfAdapter({
      fetchImpl: async () => {
        const e = new Error("The operation was aborted");
        e.name = "AbortError";
        throw e;
      },
    });
    const [ref] = await collectRefs(a, {});
    const err = await a.fetch(ref as RawDocumentRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as SourceFetchError).kind).toBe("timeout");
  });
});

describe("factory", () => {
  it("createAdressesQuebecAdapter builds an equivalent adapter", () => {
    const a = createAdressesQuebecAdapter({
      codeMamh: "70052",
      city: "salaberry-de-valleyfield",
    });
    expect(a).toBeInstanceOf(AdressesQuebecAdapter);
    expect(a.sourceId).toBe("adresses-quebec-70052");
  });
});
