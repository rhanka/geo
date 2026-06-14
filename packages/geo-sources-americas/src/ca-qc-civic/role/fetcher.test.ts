import { validateSourceManifest } from "@sentropic/geo-core";
import { sha256Hex } from "@sentropic/geo";
import { describe, expect, it } from "vitest";

import {
  ROLE_EVALUATION_MAMH_FETCHER_VERSION,
  ROLE_SOURCE_ID,
  fetchRoleXml,
  roleManifest,
  roleResourceUrl,
  roleSourceId,
} from "./fetcher.js";

const FIXED_NOW = new Date("2026-06-14T09:30:00.000Z");

/**
 * Minimal RAW rôle XML — header only, NO owner/PII fields. The fetcher returns it
 * verbatim and never parses it, so the fixture deliberately carries no RL0101
 * (owner) / RL0103 (lots) / RL0104 (matricule) data: this module must not look
 * inside the bytes.
 */
const ROLE_XML_HEADER_ONLY =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<RL xsi:noNamespaceSchemaLocation="RL.xsd">\n' +
  "  <VERSION>2.9</VERSION>\n" +
  "  <RLM01A>70052</RLM01A>\n" +
  "  <RLM02A>2026</RLM02A>\n" +
  "</RL>\n";

function okFetch(
  body: string,
  contentType = "application/xml; charset=utf-8",
): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": contentType },
    })) as unknown as typeof fetch;
}

describe("roleResourceUrl / roleSourceId (REAL MAMH shape, from immo)", () => {
  it("builds the public per-municipality rôle XML url (affmunqc host)", () => {
    expect(roleResourceUrl("70052", "2026")).toBe(
      "https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml",
    );
    expect(roleResourceUrl("70022", "2026")).toBe(
      "https://donneesouvertes.affmunqc.net/role/RL70022_2026.xml",
    );
  });

  it("defaults the year to 2026 (committed corpus)", () => {
    expect(roleResourceUrl("70052")).toBe(
      "https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml",
    );
  });

  it("derives the stable per-municipality source id (matches immo seed ids)", () => {
    expect(roleSourceId("70052")).toBe("role-evaluation-mamh-70052");
    expect(roleSourceId("70022")).toBe("role-evaluation-mamh-70022");
  });
});

describe("roleManifest", () => {
  it("is a valid SourceManifest under CC-BY 4.0 for Québec (MAMH)", () => {
    const result = validateSourceManifest(roleManifest);
    expect(result.ok).toBe(true);
    expect(roleManifest.id).toBe(ROLE_SOURCE_ID);
    expect(roleManifest.jurisdiction).toEqual({ country: "CA", subdivision: "CA-QC" });
    expect(roleManifest.license).toBe("cc-by-4.0");
  });

  it("publishes no normalizer/parser (fetcher-only boundary)", () => {
    // The manifest is a provenance record only; there is exactly one dataset and
    // no parser is exported from this package for the rôle source.
    expect(roleManifest.datasets).toHaveLength(1);
  });
});

describe("fetchRoleXml (FETCHER ONLY — raw bytes, no parsing)", () => {
  it("fetches the real MAMH url and returns the RAW xml verbatim + provenance", async () => {
    const raw = await fetchRoleXml("70052", {
      fetchImpl: okFetch(ROLE_XML_HEADER_ONLY),
      now: () => FIXED_NOW,
    });
    expect(raw.url).toBe("https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml");
    expect(raw.sourceId).toBe("role-evaluation-mamh-70052");
    expect(raw.contentType).toBe("application/xml; charset=utf-8");
    expect(raw.fetchedAt).toBe(FIXED_NOW.toISOString());
    expect(raw.fetcherVersion).toBe(ROLE_EVALUATION_MAMH_FETCHER_VERSION);
    expect(raw.sha256).toBe(sha256Hex(raw.body));
    // The bytes are returned verbatim — unparsed XML.
    expect(raw.text()).toBe(ROLE_XML_HEADER_ONLY);
  });

  it("builds the right url for a different municipality + year", async () => {
    let seen = "";
    const spy = (async (url: string | URL | Request) => {
      seen = String(url);
      return new Response(ROLE_XML_HEADER_ONLY, { status: 200 });
    }) as unknown as typeof fetch;
    const raw = await fetchRoleXml("70022", { year: "2025", fetchImpl: spy });
    expect(seen).toBe("https://donneesouvertes.affmunqc.net/role/RL70022_2025.xml");
    expect(raw.url).toBe("https://donneesouvertes.affmunqc.net/role/RL70022_2025.xml");
  });

  it("does NOT expose any parsed RL field (no parser surface in the result)", async () => {
    const raw = await fetchRoleXml("70052", { fetchImpl: okFetch(ROLE_XML_HEADER_ONLY) });
    // Anti-PII contract: the result carries raw bytes only — no units/owner/lots.
    expect(raw).not.toHaveProperty("units");
    expect(raw).not.toHaveProperty("owner");
    expect(raw).not.toHaveProperty("matricule");
    expect(raw).not.toHaveProperty("noLots");
  });

  it("throws a kind-tagged http error on a non-2xx response", async () => {
    const fail = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchRoleXml("70052", { fetchImpl: fail })).rejects.toMatchObject({
      kind: "http",
    });
  });

  it("throws a kind-tagged network error when the fetch rejects", async () => {
    const fail = (async () => {
      throw new Error("getaddrinfo ENOTFOUND donneesouvertes.affmunqc.net");
    }) as unknown as typeof fetch;
    const err = await fetchRoleXml("70052", { fetchImpl: fail }).catch((e: unknown) => e);
    expect((err as { kind?: string }).kind).toBe("network");
  });
});
