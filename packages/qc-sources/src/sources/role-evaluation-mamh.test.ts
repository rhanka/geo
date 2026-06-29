import { describe, expect, it } from "vitest";

import { sha256Hex } from "../RawDocument.js";
import type { ListOptions, RawDocumentRef } from "../SourceAdapter.js";
import {
  createRoleEvaluationMamhAdapter,
  RoleEvaluationMamhAdapter,
  roleResourceUrl,
  roleSourceId,
  ROLE_EVALUATION_MAMH_ADAPTER_VERSION,
} from "./role-evaluation-mamh.js";
import {
  roleEvaluationMamhBeauharnoisXml,
  roleEvaluationMamhValleyfieldXml,
} from "./role-evaluation-mamh.fixture.js";
import { SourceFetchError, type FetchLike } from "./avis-publics-valleyfield.js";

const FIXED_NOW = new Date("2026-06-08T09:30:00.000Z");

function okFetch(
  body: string,
  contentType = "application/xml; charset=utf-8",
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

async function collectRefs(
  adapter: RoleEvaluationMamhAdapter,
  opts: ListOptions,
) {
  const refs: RawDocumentRef[] = [];
  for await (const ref of adapter.list(opts)) refs.push(ref);
  return refs;
}

function vfAdapter(extra: Partial<Parameters<typeof createRoleEvaluationMamhAdapter>[0]> = {}) {
  return new RoleEvaluationMamhAdapter({
    codeMamh: "70052",
    city: "salaberry-de-valleyfield",
    now: () => FIXED_NOW,
    ...extra,
  });
}

describe("roleResourceUrl / roleSourceId (public MAMH resource shape)", () => {
  it("builds the public per-municipality rôle XML url (Données Québec / MAMH host)", () => {
    expect(roleResourceUrl("70052", "2026")).toBe(
      "https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml",
    );
    expect(roleResourceUrl("70022", "2026")).toBe(
      "https://donneesouvertes.affmunqc.net/role/RL70022_2026.xml",
    );
  });

  it("derives the stable source id matching the seed-ontology ids", () => {
    expect(roleSourceId("70052")).toBe("role-evaluation-mamh-70052");
    expect(roleSourceId("70022")).toBe("role-evaluation-mamh-70022");
  });
});

describe("RoleEvaluationMamhAdapter (J0 contract)", () => {
  it("exposes the role-evaluation kind, city, version and resource identity", () => {
    const a = vfAdapter();
    expect(a.kind).toBe("role-evaluation");
    expect(a.city).toBe("salaberry-de-valleyfield");
    expect(a.version).toBe(ROLE_EVALUATION_MAMH_ADAPTER_VERSION);
    expect(a.sourceId).toBe("role-evaluation-mamh-70052");
    expect(a.resourceUrl).toBe(
      "https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml",
    );
  });

  it("list() yields the single per-municipality resource ref", async () => {
    const a = vfAdapter();
    const refs = await collectRefs(a, { city: "salaberry-de-valleyfield" });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe(
      "https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml",
    );
    expect(refs[0]?.sourceKind).toBe("role-evaluation");
    expect(refs[0]?.contentType).toBe("application/xml");
    expect(refs[0]?.discoveredAt).toBe(FIXED_NOW.toISOString());
    expect(refs[0]?.metadata).toMatchObject({ codeMamh: "70052", year: "2026" });
  });

  it("list() yields nothing when the signal is already aborted", async () => {
    const a = vfAdapter();
    const controller = new AbortController();
    controller.abort();
    const refs = await collectRefs(a, { signal: controller.signal });
    expect(refs).toHaveLength(0);
  });
});

describe("fetch() over REAL committed rôle bytes (no network)", () => {
  it("returns raw bytes + download provenance + sha256, and hash() matches", async () => {
    const a = vfAdapter({
      fetchImpl: okFetch(roleEvaluationMamhValleyfieldXml()),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);

    expect(raw.url).toBe(
      "https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml",
    );
    expect(raw.httpStatus).toBe(200);
    expect(raw.sourceKind).toBe("role-evaluation");
    expect(raw.city).toBe("salaberry-de-valleyfield");
    expect(raw.contentType).toBe("application/xml; charset=utf-8");
    expect(raw.provenance.adapterVersion).toBe(ROLE_EVALUATION_MAMH_ADAPTER_VERSION);
    expect(raw.provenance.obtentionMode).toBe("download");
    expect(raw.provenance.fetchedViaObscura).toBe(false);
    expect(raw.sha256).toBe(sha256Hex(raw.body));
    expect(a.hash(raw)).toBe(raw.sha256);
  });

  it("parseRole() turns fetched bytes into the REAL Valleyfield units (anti-invention)", async () => {
    const a = vfAdapter({
      fetchImpl: okFetch(roleEvaluationMamhValleyfieldXml()),
    });
    const [ref] = await collectRefs(a, {});
    const raw = await a.fetch(ref as RawDocumentRef);
    const role = a.parseRole(raw);

    expect(role.codeMamh).toBe("70052");
    expect(role.year).toBe("2026");
    expect(role.units).toHaveLength(1);
    const unit = role.units[0]!;
    expect(unit.noLots).toContain("4193751");
    expect(unit.matricule).toBe("5114-86-8189");
    expect(unit.valeur).toBe(2748500);
    // PII excluded (Loi 25 / LFM 72): owner is NEVER surfaced.
    expect(unit.owner).toBe("non-disponible");
  });

  it("parseRole() reads the REAL Beauharnois (70022) sample (different code + lot)", async () => {
    const a = new RoleEvaluationMamhAdapter({
      codeMamh: "70022",
      city: "beauharnois",
      now: () => FIXED_NOW,
      fetchImpl: okFetch(roleEvaluationMamhBeauharnoisXml()),
    });
    const [ref] = await collectRefs(a, {});
    expect(ref?.url).toBe(
      "https://donneesouvertes.affmunqc.net/role/RL70022_2026.xml",
    );
    const raw = await a.fetch(ref as RawDocumentRef);
    const role = a.parseRole(raw);
    expect(role.codeMamh).toBe("70022");
    expect(role.units[0]!.noLots).toContain("4716029");
    expect(role.units[0]!.matricule).toBe("6719-81-9976");
    expect(role.units[0]!.valeur).toBe(444000);
    expect(role.units[0]!.owner).toBe("non-disponible");
  });

  it("is idempotent: re-fetching identical bytes yields the same sha256/hash", async () => {
    const a = vfAdapter({
      fetchImpl: okFetch(roleEvaluationMamhValleyfieldXml()),
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
        throw new Error("getaddrinfo ENOTFOUND donneesouvertes.affmunqc.net");
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
  it("createRoleEvaluationMamhAdapter builds an equivalent adapter", () => {
    const a = createRoleEvaluationMamhAdapter({
      codeMamh: "70052",
      city: "salaberry-de-valleyfield",
    });
    expect(a).toBeInstanceOf(RoleEvaluationMamhAdapter);
    expect(a.sourceId).toBe("role-evaluation-mamh-70052");
  });
});
