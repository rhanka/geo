import { validateSourceManifest } from "@sentropic/geo-core";
import { sha256Hex } from "@sentropic/geo-acquire";
import { describe, expect, it } from "vitest";

import {
  ADRESSES_QUEBEC_ADAPTER_VERSION,
  ADRESSES_SOURCE_ID,
  adressesManifest,
  adressesResourceUrl,
  adressesSourceId,
  fetchAndParseQcCivicAddresses,
  fetchQcCivicAddresses,
} from "./adapter.js";
import { TERRAPI_ADRESSES_VALLEYFIELD_JSON } from "./fixtures.js";

const FIXED_NOW = new Date("2026-06-14T09:30:00.000Z");

/** A hermetic fetch returning `body` with a 200 and the given content-type. */
function okFetch(
  body: string,
  contentType = "application/json; charset=utf-8",
): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": contentType },
    })) as unknown as typeof fetch;
}

describe("adressesResourceUrl / adressesSourceId (REAL terrAPI shape, from immo)", () => {
  it("builds the public per-municipality terrAPI addresses url (geometry=0)", () => {
    expect(adressesResourceUrl("70052")).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70052/adresses?geometry=0",
    );
    expect(adressesResourceUrl("70022")).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70022/adresses?geometry=0",
    );
  });

  it("derives the stable per-municipality source id (matches immo seed ids)", () => {
    expect(adressesSourceId("70052")).toBe("adresses-quebec-70052");
    expect(adressesSourceId("70022")).toBe("adresses-quebec-70022");
  });
});

describe("adressesManifest", () => {
  it("is a valid SourceManifest under CC-BY 4.0 for Québec", () => {
    const result = validateSourceManifest(adressesManifest);
    expect(result.ok).toBe(true);
    expect(adressesManifest.id).toBe(ADRESSES_SOURCE_ID);
    expect(adressesManifest.jurisdiction).toEqual({ country: "CA", subdivision: "CA-QC" });
    expect(adressesManifest.license).toBe("cc-by-4.0");
  });
});

describe("fetchQcCivicAddresses (injectable fetch, no network)", () => {
  it("fetches the real terrAPI url and returns raw bytes + provenance", async () => {
    const raw = await fetchQcCivicAddresses({
      codeMamh: "70052",
      fetchImpl: okFetch(TERRAPI_ADRESSES_VALLEYFIELD_JSON),
      now: () => FIXED_NOW,
    });
    expect(raw.url).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70052/adresses?geometry=0",
    );
    expect(raw.sourceId).toBe("adresses-quebec-70052");
    expect(raw.contentType).toBe("application/json; charset=utf-8");
    expect(raw.fetchedAt).toBe(FIXED_NOW.toISOString());
    expect(raw.adapterVersion).toBe(ADRESSES_QUEBEC_ADAPTER_VERSION);
    expect(raw.sha256).toBe(sha256Hex(raw.body));
  });

  it("passes the requested url through to the injected fetch", async () => {
    let seen = "";
    const spy = (async (url: string | URL | Request) => {
      seen = String(url);
      return new Response(TERRAPI_ADRESSES_VALLEYFIELD_JSON, { status: 200 });
    }) as unknown as typeof fetch;
    await fetchQcCivicAddresses({ codeMamh: "70022", fetchImpl: spy });
    expect(seen).toBe(
      "https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/70022/adresses?geometry=0",
    );
  });

  it("throws a kind-tagged http error on a non-2xx response", async () => {
    const fail = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(
      fetchQcCivicAddresses({ codeMamh: "70052", fetchImpl: fail }),
    ).rejects.toMatchObject({ kind: "http" });
  });

  it("throws a kind-tagged network error when the fetch rejects", async () => {
    const fail = (async () => {
      throw new Error("getaddrinfo ENOTFOUND geoegl.msp.gouv.qc.ca");
    }) as unknown as typeof fetch;
    const err = await fetchQcCivicAddresses({ codeMamh: "70052", fetchImpl: fail }).catch(
      (e: unknown) => e,
    );
    expect((err as { kind?: string }).kind).toBe("network");
  });
});

describe("fetchAndParseQcCivicAddresses (adapter → clean public addresses)", () => {
  it("fetches + parses the REAL Valleyfield addresses (anti-invention)", async () => {
    const { adresses } = await fetchAndParseQcCivicAddresses({
      codeMamh: "70052",
      fetchImpl: okFetch(TERRAPI_ADRESSES_VALLEYFIELD_JSON),
    });
    expect(adresses).toHaveLength(3);
    expect(adresses[0]?.nom).toBe("24 rue Paquette, Salaberry-de-Valleyfield J6S6A5");
    expect(adresses[0]?.code).toBe("000464c34bfd4f25862f208af2e3dbf5J6S6A5");
    expect(adresses[0]).not.toHaveProperty("geom");
  });
});
