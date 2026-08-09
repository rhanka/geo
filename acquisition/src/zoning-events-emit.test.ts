/**
 * Unit tests for the qc-zoning-events-<slug> emitter (schema v2.1).
 * Network-free / pure-function (vitest.config.ts contract): `serveZoningEvents`
 * is exercised against an injected in-memory `ZoningEventsStore`, never real S3.
 */
import { describe, it, expect, vi } from "vitest";

import {
  computeEventId,
  resolveZonesExact,
  validateZoningEvent,
  serveZoningEvents,
  zoningEventsKeys,
  type ZoningEvent,
  type ZoningEventsDocument,
  type ZoningEventsStore,
} from "./zoning-events-emit.js";

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function baseEvent(overrides: Partial<ZoningEvent> = {}): ZoningEvent {
  return {
    event_id: computeEventId("coaticook", "https://example.org/pv.pdf", "26-02-38263"),
    version: 1,
    supersedes: null,
    state: "active",
    muni: "coaticook",
    bylaw_numero: "26-02-38263",
    type: "ppcmoi",
    date_iso: "2026-02-09",
    detection_state: "detected",
    zone_codes_resolus: [
      {
        zone_code: "RD-104",
        relation_type: "concerns_zone",
        target_id: "RD-104",
        target_type: "Zone",
        score_confiance: 1.0,
        provenance: "exact_geom",
        as_of_date: "2026-07-18",
      },
    ],
    zone_codes_non_resolus: [],
    nb_unites_max: null,
    effet_densifiant_ref: { collection: "qc-zonage-coaticook", zone_code: "RD-104" },
    url_pdf: "https://example.org/pv.pdf",
    extrait_brut: "« ... zone RD-104 »",
    confidence: 0.95,
    provenance: {
      producer: "geo",
      source_span: "PV Coaticook 2026-02-09, résolution 26-02-38263, pp.25-26",
      source_url: "https://example.org/pv.pdf",
      as_of_date: "2026-07-18",
    },
    ...overrides,
  };
}

/** Trivial in-memory store: enough to exercise the tombstone guard + serialisation. */
function memoryStore(seed: Record<string, ZoningEventsDocument> = {}): {
  store: ZoningEventsStore;
  written: Record<string, ZoningEventsDocument>;
} {
  const data: Record<string, Buffer> = {};
  for (const [key, doc] of Object.entries(seed)) {
    data[key] = Buffer.from(JSON.stringify(doc));
  }
  const written: Record<string, ZoningEventsDocument> = {};
  const store: ZoningEventsStore = {
    async getExisting(key) {
      return data[key] ?? null;
    },
    async put(key, body) {
      data[key] = body;
      written[key] = JSON.parse(body.toString("utf8")) as ZoningEventsDocument;
    },
  };
  return { store, written };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeEventId — STABLE-AT-DETECTION (spec A1)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeEventId", () => {
  it("is deterministic: same muni|source_ref|anchor -> same id", () => {
    const a = computeEventId("coaticook", "https://example.org/pv.pdf", "26-02-38263");
    const b = computeEventId("coaticook", "https://example.org/pv.pdf", "26-02-38263");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not vary with anything but muni/source_ref/anchor: a different bylaw_numero on the built event yields the SAME event_id", () => {
    const idFn = () => computeEventId("coaticook", "https://example.org/pv.pdf", "26-02-38263");
    const eventV1 = baseEvent({ event_id: idFn(), bylaw_numero: null });
    const eventV2 = baseEvent({ event_id: idFn(), bylaw_numero: "26-02-38263" });
    expect(eventV1.event_id).toBe(eventV2.event_id);
  });

  it("changes when muni, source_ref, or anchor changes", () => {
    const ref = computeEventId("coaticook", "https://example.org/pv.pdf", "26-02-38263");
    expect(computeEventId("sutton", "https://example.org/pv.pdf", "26-02-38263")).not.toBe(ref);
    expect(computeEventId("coaticook", "https://example.org/other.pdf", "26-02-38263")).not.toBe(ref);
    expect(computeEventId("coaticook", "https://example.org/pv.pdf", "26-02-99999")).not.toBe(ref);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveZonesExact — exact-normalised only, no fuzzy
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveZonesExact", () => {
  const served = ["RD-104", "RD-305-1", "RD-314"];

  it("resolves an exact (normalised) match with score_confiance=1.0 / exact_geom", () => {
    const { resolved, unresolved } = resolveZonesExact(
      [{ mention_brute: "RD-104", page: null }],
      served,
      { as_of_date: "2026-07-18" },
    );
    expect(unresolved).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      zone_code: "RD-104",
      target_id: "RD-104",
      target_type: "Zone",
      relation_type: "concerns_zone",
      score_confiance: 1.0,
      provenance: "exact_geom",
    });
  });

  it("resolves a surface-form variant via the canon fold (never a fuzzy score)", () => {
    // "rd 104" / "RD104" collapse to the same canon key as the served "RD-104".
    const { resolved, unresolved } = resolveZonesExact(
      [{ mention_brute: "rd 104", page: 2 }],
      served,
      { as_of_date: "2026-07-18" },
    );
    expect(unresolved).toHaveLength(0);
    expect(resolved[0]?.zone_code).toBe("RD-104");
    expect(resolved[0]?.score_confiance).toBe(1.0);
  });

  it("sends a non-exact mention to zone_codes_non_resolus, NEVER a low score", () => {
    const { resolved, unresolved } = resolveZonesExact(
      [{ mention_brute: "HC-14", page: 3 }],
      served,
      { as_of_date: "2026-07-18" },
    );
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual([{ mention_brute: "HC-14", page: 3, raison: "no-exact-match" }]);
  });

  it("marks a mention ambiguous when the served set itself has a canon collision (never silently picks one)", () => {
    const collidingServed = ["H-1", "h1"]; // both canonicalize to the same key
    const { resolved, unresolved } = resolveZonesExact(
      [{ mention_brute: "H-1", page: 1 }],
      collidingServed,
      { as_of_date: "2026-07-18" },
    );
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual([{ mention_brute: "H-1", page: 1, raison: "ambiguous" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateZoningEvent — hard gate
// ─────────────────────────────────────────────────────────────────────────────

describe("validateZoningEvent", () => {
  it("accepts a well-formed event", () => {
    expect(() => validateZoningEvent(baseEvent())).not.toThrow();
  });

  it("rejects a resolved zone with score_confiance != 1 (no fuzzy, ever)", () => {
    const bad = baseEvent({
      zone_codes_resolus: [
        {
          zone_code: "RD-104",
          relation_type: "concerns_zone",
          target_id: "RD-104",
          target_type: "Zone",
          score_confiance: 0.45,
          provenance: "exact_geom",
          as_of_date: "2026-07-18",
        },
      ],
    });
    expect(() => validateZoningEvent(bad)).toThrow(/score_confiance/);
  });

  it("rejects an effet_densifiant_ref carrying a normative field (pointer-only)", () => {
    const bad = baseEvent({
      effet_densifiant_ref: {
        collection: "qc-zonage-coaticook",
        zone_code: "RD-104",
        // @ts-expect-error deliberately invalid at the type level too
        densite_apres: 12,
      },
    });
    expect(() => validateZoningEvent(bad)).toThrow(/champ interdit/);
  });

  it("rejects a non-integer nb_unites_max", () => {
    const bad = baseEvent({ nb_unites_max: 12.5 });
    expect(() => validateZoningEvent(bad)).toThrow(/nb_unites_max/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// serveZoningEvents — serialisation + tombstone
// ─────────────────────────────────────────────────────────────────────────────

describe("serveZoningEvents", () => {
  it("serialises {as_of, complete, muni, events} to both the flat and sub-folder key", async () => {
    const { store, written } = memoryStore();
    const event = baseEvent();
    const { keys, document } = await serveZoningEvents("coaticook", [event], {
      asOf: "2026-07-18T00:00:00Z",
      complete: true,
      store,
    });

    expect(keys).toEqual(zoningEventsKeys("coaticook"));
    expect(keys).toHaveLength(2);
    expect(document).toEqual({
      type: "FeatureCollection",
      as_of: "2026-07-18T00:00:00Z",
      complete: true,
      muni: "coaticook",
      events: [event],
      features: [{ type: "Feature", geometry: null, properties: event }],
    });
    for (const key of keys) {
      expect(written[key]).toEqual(document);
    }
  });

  it("keeps a tombstone: an event_id previously served must resurface in the new set", async () => {
    const oldEvent = baseEvent({ event_id: "aaaa", state: "active" });
    const keys = zoningEventsKeys("coaticook");
    const seedDoc: ZoningEventsDocument = {
      type: "FeatureCollection",
      as_of: "2026-01-01T00:00:00Z",
      complete: true,
      muni: "coaticook",
      events: [oldEvent],
      features: [{ type: "Feature", geometry: null, properties: oldEvent }],
    };
    const { store, written } = memoryStore({ [keys[0]!]: seedDoc, [keys[1]!]: seedDoc });

    // Silently dropping "aaaa" must throw.
    await expect(
      serveZoningEvents("coaticook", [baseEvent({ event_id: "bbbb" })], {
        asOf: "2026-07-18T00:00:00Z",
        complete: true,
        store,
      }),
    ).rejects.toThrow(/tombstone/);

    // Re-surfacing it as retracted is accepted and preserved verbatim.
    const retracted = baseEvent({ event_id: "aaaa", state: "retracted", version: 2 });
    const { document } = await serveZoningEvents(
      "coaticook",
      [baseEvent({ event_id: "bbbb" }), retracted],
      { asOf: "2026-07-18T00:00:00Z", complete: true, store },
    );
    expect(document.events.find((e) => e.event_id === "aaaa")).toMatchObject({
      state: "retracted",
    });
    expect(written[keys[0]!]?.events).toHaveLength(2);
  });

  it("warns (does not throw) when complete=false", async () => {
    const { store } = memoryStore();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await serveZoningEvents("coaticook", [baseEvent()], {
      asOf: "2026-07-18T00:00:00Z",
      complete: false,
      store,
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rejects a duplicate event_id within the same set", async () => {
    const { store } = memoryStore();
    await expect(
      serveZoningEvents("coaticook", [baseEvent(), baseEvent()], {
        asOf: "2026-07-18T00:00:00Z",
        complete: true,
        store,
      }),
    ).rejects.toThrow(/dupliqué/);
  });
});
