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
  buildReglementEvent,
  migrateTypeToDocumentType,
  canonInstrumentType,
  DOCUMENT_TYPE_KNOWN,
  INSTRUMENT_TYPE_KNOWN,
  type ZoningEvent,
  type ZoningEventsDocument,
  type ZoningEventsStore,
  type ReglementLifecycleInput,
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
    document_type: null,
    type_instrument: null,
    reglement_number: [],
    cible_reglement_numero: null,
    libelles_relation: [],
    declencheur_type: null,
    declencheur_date_verbatim: null,
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
      sha256: "0".repeat(64),
      retrieved_at: "2026-07-18T00:00:00Z",
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

// ─────────────────────────────────────────────────────────────────────────────
// Règlement-lifecycle emission (FROZEN contract LOT 1) — verbatim material only
// ─────────────────────────────────────────────────────────────────────────────

function reglementInput(overrides: Partial<ReglementLifecycleInput> = {}): ReglementLifecycleInput {
  return {
    muni: "sainte-martine",
    source_ref: "https://example.org/pv-mai.pdf",
    detection_anchor: "2026-05-110", // résolution number — intrinsic, per-item, A1-safe (NOT the reglement n°)
    date_iso: "2026-05-11",
    url_pdf: "https://example.org/pv-mai.pdf",
    extrait_brut: "« 2026-05-110 : Adoption du Règlement numéro 2026-509 modifiant… »",
    document_type: "adoption",
    type_instrument_declared: "règlement de zonage",
    reglement_number: ["2026-509"],
    cible_reglement_numero: null,
    libelles_relation: ["modifiant le Règlement numéro 2019-341"],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "4235f266".padEnd(64, "0"),
      retrieved_at: "2026-05-13T09:00:00Z",
      source_span: "PV Saint-Michel, p.17, item 9.1",
    },
    ...overrides,
  };
}

describe("buildReglementEvent (FROZEN contract LOT 1)", () => {
  it("builds a valid adoption event that passes validation and emits NO typed relation/stage", () => {
    const event = buildReglementEvent(reglementInput());
    expect(() => validateZoningEvent(event)).not.toThrow();
    expect(event.document_type).toBe("adoption");
    expect(event.reglement_number).toEqual(["2026-509"]);
    expect(event.libelles_relation).toEqual(["modifiant le Règlement numéro 2019-341"]);
    expect(event).not.toHaveProperty("replaces");
    expect(event).not.toHaveProperty("amends");
    expect(event).not.toHaveProperty("lifecycle_stage");
  });

  it("event_id is the libellé-anchor hash and NEVER depends on reglement_number (A1)", () => {
    const a = buildReglementEvent(reglementInput({ reglement_number: ["2026-509"] }));
    const b = buildReglementEvent(reglementInput({ reglement_number: ["9999-000", null] }));
    expect(a.event_id).toBe(b.event_id);
    expect(a.event_id).toBe(
      computeEventId("sainte-martine", "https://example.org/pv-mai.pdf", "2026-05-110"),
    );
  });

  it("avis_motion carries reglement_number=[] and a verbatim cible", () => {
    const avis = buildReglementEvent(
      reglementInput({
        detection_anchor: "2026-04-avis",
        document_type: "avis_motion",
        reglement_number: [],
        cible_reglement_numero: "2026-509",
        libelles_relation: [],
      }),
    );
    expect(() => validateZoningEvent(avis)).not.toThrow();
    expect(avis.reglement_number).toEqual([]);
    expect(avis.cible_reglement_numero).toBe("2026-509");
    expect(avis.bylaw_numero).toBeNull();
  });

  it("a suspensive fact is a content event (type set, document_type null)", () => {
    const registre = buildReglementEvent(
      reglementInput({
        detection_anchor: "2026-06-registre",
        type: "registre-referendaire",
        document_type: null,
        reglement_number: [],
      }),
    );
    expect(() => validateZoningEvent(registre)).not.toThrow();
    expect(registre.type).toBe("registre-referendaire");
    expect(registre.document_type).toBeNull();
  });

  it("tolerates an UNKNOWN document_type value (extension policy §9)", () => {
    const event = buildReglementEvent(reglementInput({ document_type: "consultation_publique_future" }));
    expect(() => validateZoningEvent(event)).not.toThrow();
    expect(event.document_type).toBe("consultation_publique_future");
  });
});

describe("validateZoningEvent — règlement-lifecycle guards (geo emits verbatim, immo types/derives)", () => {
  it("REJECTS an emitted typed relation (replaces)", () => {
    const event = { ...buildReglementEvent(reglementInput()), replaces: ["2019-341"] } as unknown as ZoningEvent;
    expect(() => validateZoningEvent(event)).toThrow(/replaces/);
  });

  it("REJECTS an emitted typed relation (amends)", () => {
    const event = { ...buildReglementEvent(reglementInput()), amends: ["2019-341"] } as unknown as ZoningEvent;
    expect(() => validateZoningEvent(event)).toThrow(/amends/);
  });

  it("REJECTS an emitted lifecycle_stage (immo derives it)", () => {
    const event = { ...buildReglementEvent(reglementInput()), lifecycle_stage: "adopte" } as unknown as ZoningEvent;
    expect(() => validateZoningEvent(event)).toThrow(/lifecycle_stage/);
  });

  it("REJECTS a non-string reglement_number item (verbatim-or-null only)", () => {
    const event = buildReglementEvent(reglementInput({ reglement_number: [123 as unknown as string] }));
    expect(() => validateZoningEvent(event)).toThrow(/reglement_number/);
  });

  it("REJECTS an invalid declencheur_type", () => {
    const event = buildReglementEvent(
      reglementInput({ declencheur_type: "date_adoption" as unknown as "publication_avis" }),
    );
    expect(() => validateZoningEvent(event)).toThrow(/declencheur_type/);
  });

  it("REJECTS a missing proof sha256 (§6 — jamais une preuve incomplète)", () => {
    const event = buildReglementEvent(
      reglementInput({
        provenance: { doc_sha256: "", retrieved_at: "2026-05-13T09:00:00Z", source_span: "p17" },
      }),
    );
    expect(() => validateZoningEvent(event)).toThrow(/sha256 manquant/);
  });

  it("REJECTS a missing retrieved_at (§6 — valeur réelle, jamais fabriquée)", () => {
    const event = buildReglementEvent(
      reglementInput({
        provenance: { doc_sha256: "a".repeat(64), retrieved_at: "", source_span: "p17" },
      }),
    );
    expect(() => validateZoningEvent(event)).toThrow(/retrieved_at manquant/);
  });

  it("REJECTS a placeholder source_url (§6 — stage fantôme interdit)", () => {
    const event = buildReglementEvent(reglementInput({ url_pdf: "https://non-disponible/x.pdf" }));
    expect(() => validateZoningEvent(event)).toThrow(/FANTÔME/);
  });

  // ── The scaling seam (F1): buildReglementEvent fail-loud on an ABSENT (undefined) proof key ──
  // A JSON-fed corpus record MISSING doc_sha256/retrieved_at arrives as `undefined` (the `string`
  // type can't see a dropped key); the build-time gate rejects it BEFORE the event exists, so it can
  // never be grandfathered by the validate-time presence-gate. Covers ALL types (content included).
  it("REJECTS a content-event (document_type=null) whose doc_sha256 is ABSENT/undefined (seam, all types)", () => {
    expect(() =>
      buildReglementEvent(
        reglementInput({
          document_type: null,
          provenance: {
            doc_sha256: undefined as unknown as string,
            retrieved_at: "2026-05-13T09:00:00Z",
            source_span: "p17",
          },
        }),
      ),
    ).toThrow(/doc_sha256 ET retrieved_at REQUIS/);
  });

  it("REJECTS an ABSENT/undefined retrieved_at at the input (seam, all types)", () => {
    expect(() =>
      buildReglementEvent(
        reglementInput({
          provenance: {
            doc_sha256: "a".repeat(64),
            retrieved_at: undefined as unknown as string,
            source_span: "p17",
          },
        }),
      ),
    ).toThrow(/doc_sha256 ET retrieved_at REQUIS/);
  });

  it("REJECTS a JSON round-tripped record whose proof key was dropped by undefined (round-trip-safe)", () => {
    // JSON.stringify OMITS an `undefined` key → the parsed record has NO doc_sha256 — exactly the
    // corpus→JSON→scaling-runner path. buildReglementEvent still fails-loud on the input.
    const input = reglementInput({
      provenance: {
        doc_sha256: undefined as unknown as string,
        retrieved_at: "2026-05-13T09:00:00Z",
        source_span: "p17",
      },
    });
    const roundTripped = JSON.parse(JSON.stringify(input)) as ReglementLifecycleInput;
    expect(roundTripped.provenance.doc_sha256).toBeUndefined(); // the key was dropped by the round-trip
    expect(() => buildReglementEvent(roundTripped)).toThrow(/doc_sha256 ET retrieved_at REQUIS/);
  });

  it("validate defense-in-depth (§8): a TYPED event (document_type set) with an ABSENT proof key is REJECTED", () => {
    // Closes the §8 migrateTypeToDocumentType path (setting document_type on a legacy proof-less event
    // + re-serving): the presence-gate grandfathers `undefined`, so option-c catches a typed event.
    // Constructed directly to bypass buildReglementEvent's own input gate — pins the validate-side belt.
    const legacy = baseEvent({ document_type: "projet_reglement" });
    const noProof = {
      ...legacy,
      provenance: {
        producer: "geo",
        source_span: legacy.provenance.source_span,
        source_url: legacy.url_pdf,
        as_of_date: legacy.date_iso,
      },
    } as unknown as ZoningEvent;
    expect(noProof.provenance.sha256).toBeUndefined();
    expect(() => validateZoningEvent(noProof)).toThrow(/SANS preuve/);
  });
});

describe("migrateTypeToDocumentType (§8) — lossless de-conflation, FAIL-LOUD", () => {
  it("maps lifecycle types to their document_type", () => {
    expect(migrateTypeToDocumentType("projet-reglement")).toBe("projet_reglement");
    expect(migrateTypeToDocumentType("entree-en-vigueur")).toBe("entree_en_vigueur");
  });

  it("maps pure content/suspensive types to null (no lifecycle document_type)", () => {
    expect(migrateTypeToDocumentType("changement-de-zonage")).toBeNull();
    expect(migrateTypeToDocumentType("registre-referendaire")).toBeNull();
    expect(migrateTypeToDocumentType("refus-mrc")).toBeNull();
  });

  it("FAIL-LOUDs on a type absent from the table (never a silent relabel)", () => {
    expect(() => migrateTypeToDocumentType("inexistant" as never)).toThrow(/FAIL-LOUD/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 type_instrument — declared-source enum (3rd by-value discriminant), §9-tolerant
// ─────────────────────────────────────────────────────────────────────────────

describe("canonInstrumentType (§10.3 declared-source → canonical token, single canon point)", () => {
  it("maps each declared instrument to its canonical token (the §10.3 arrows)", () => {
    expect(canonInstrumentType("règlement de zonage")).toBe("zonage");
    expect(canonInstrumentType("plan d'urbanisme")).toBe("plan-urbanisme");
    expect(canonInstrumentType("règlement de lotissement")).toBe("lotissement");
    expect(canonInstrumentType("règlement de construction")).toBe("construction");
    expect(canonInstrumentType("règlement sur les PIIA")).toBe("piia");
    expect(canonInstrumentType("plan d'implantation et d'intégration architecturale")).toBe("piia");
    expect(canonInstrumentType("règlement sur les dérogations mineures")).toBe("derogation");
  });

  it("is accent- and case-insensitive, and every token maps to itself (idempotent)", () => {
    expect(canonInstrumentType("ZONAGE")).toBe("zonage");
    expect(canonInstrumentType("Dérogation")).toBe("derogation");
    for (const token of INSTRUMENT_TYPE_KNOWN) {
      expect(canonInstrumentType(token)).toBe(token);
    }
  });

  it("maps the literal 'unknown' / empty to the OUT-OF-ENUM sentinel 'unknown' (§10.2)", () => {
    expect(canonInstrumentType("unknown")).toBe("unknown");
    expect(canonInstrumentType("")).toBe("unknown");
    expect(canonInstrumentType("   ")).toBe("unknown");
    // the sentinel is NOT a member of the known enum
    expect(INSTRUMENT_TYPE_KNOWN.has("unknown")).toBe(false);
  });

  it("passes a DECLARED-but-untabled instrument through as a slug (§9 by-value tolerance), NEVER erased to 'unknown'", () => {
    // a real declaration we don't yet tabulate is emitted + generically bucketed (promotion = minor-version),
    // never silently collapsed to 'unknown' (that would erase a real declaration — anti-invention).
    expect(canonInstrumentType("règlement sur l'affichage")).toBe("reglement-sur-l-affichage");
    expect(canonInstrumentType("règlement sur l'affichage")).not.toBe("unknown");
  });
});

describe("§10 type_instrument (declared-source → token, 3-state null/unknown/token, §9-tolerant)", () => {
  it("emits the canonical TOKEN from a declared term (zonage), tolerating a novel declared value (never crashes)", () => {
    const zonage = buildReglementEvent(reglementInput({ type_instrument_declared: "règlement de zonage" }));
    expect(() => validateZoningEvent(zonage)).not.toThrow();
    expect(zonage.type_instrument).toBe("zonage"); // declared "règlement de zonage" → token "zonage"
    const novel = buildReglementEvent(reglementInput({ type_instrument_declared: "règlement spécial futur" }));
    expect(() => validateZoningEvent(novel)).not.toThrow(); // §9-tolerant: unknown value never crashes
    expect(novel.type_instrument).not.toBe("unknown"); // a real declaration is not erased
  });

  it("distinguishes the 3 states: null (not-populated) ≠ 'unknown' (examined, source-mute) ≠ token", () => {
    const nullInstr = buildReglementEvent(reglementInput({ type_instrument_declared: null }));
    expect(() => validateZoningEvent(nullInstr)).not.toThrow();
    expect(nullInstr.type_instrument).toBeNull(); // not-populated stays null, NOT canonicalised
    const unknown = buildReglementEvent(reglementInput({ type_instrument_declared: "unknown" }));
    expect(() => validateZoningEvent(unknown)).not.toThrow();
    expect(unknown.type_instrument).toBe("unknown"); // examined-but-mute → sentinel, distinct from null
    const token = buildReglementEvent(reglementInput({ type_instrument_declared: "plan d'urbanisme" }));
    expect(token.type_instrument).toBe("plan-urbanisme");
  });

  it("defaults to null when the input omits it (safe-default §10.7)", () => {
    const omitted = buildReglementEvent({ ...reglementInput(), type_instrument_declared: undefined });
    expect(omitted.type_instrument).toBeNull();
  });

  it("REJECTS a non-string type_instrument on the built event (never a number/bool, never guessed)", () => {
    const event = { ...buildReglementEvent(reglementInput()), type_instrument: 42 } as unknown as ZoningEvent;
    expect(() => validateZoningEvent(event)).toThrow(/type_instrument/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pilot LOT 1 — REAL zonage inputs (saint-michel adoption + la-minerve premier_projet)
// end-to-end: build → validate → serve (IN-MEMORY, NEVER prod S3). Values are the
// authentic extraction STAGE1 fixture (docSha + fetchedAt from the -pocs sidecar);
// the PROD deposit must re-source retrieved_at from the authoritative CLUSTER manifest.
// ─────────────────────────────────────────────────────────────────────────────

describe("pilot LOT 1 — real zonage inputs, in-memory (never prod)", () => {
  const saintMichel: ReglementLifecycleInput = {
    muni: "saint-michel",
    source_ref:
      "raw/proces-verbaux-saint-michel/cas/4235f2663cb919a1ccbd8e52ef46e31ab627e74584f4433988dd113903d5d53d.pdf",
    detection_anchor:
      "QUE le conseil municipal de Saint-Michel adopte le règlement numéro 2026-301-5 modifiant le règlement de zonage numéro 2022-301, tel qu'amendé, afin d'harmoniser et d'ajuster diverses dispositions réglementaires.",
    date_iso: "2026-04-14",
    url_pdf:
      "https://municipalite-saint-michel.ca/wp-content/uploads/2026/05/proces-verbal-de-la-seance-ordinaire-du-14-avril-2026.pdf",
    extrait_brut:
      "QUE le conseil municipal de Saint-Michel adopte le règlement numéro 2026-301-5 modifiant le règlement de zonage numéro 2022-301, tel qu'amendé…",
    document_type: "adoption",
    reglement_number: ["2026-301-5"],
    cible_reglement_numero: null,
    libelles_relation: ["modifiant le règlement de zonage numéro 2022-301, tel qu'amendé"],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "4235f2663cb919a1ccbd8e52ef46e31ab627e74584f4433988dd113903d5d53d",
      retrieved_at: "2026-06-11T23:25:00.202Z",
      source_span: "p17 item 9.1",
    },
  };

  const laMinerve: ReglementLifecycleInput = {
    muni: "la-minerve",
    source_ref:
      "raw/proces-verbaux-la-minerve/cas/f5688b527012436a48aefef6a2e521a9f89ec1a2b2b5942e0f777c7ed0aa3860.pdf",
    detection_anchor:
      "D'adopter le premier projet de règlement no 2026-765 modifiant le règlement de zonage no 2024-732 afin de modifier diverses dispositions, tel que déposé.",
    date_iso: "2026-04-13",
    url_pdf: "https://municipalite.laminerve.qc.ca/wp-content/uploads/2026/05/2026.04.13_speciale.pdf",
    extrait_brut:
      "D'adopter le premier projet de règlement no 2026-765 modifiant le règlement de zonage no 2024-732…",
    document_type: "premier_projet",
    reglement_number: ["2026-765"],
    cible_reglement_numero: null,
    libelles_relation: ["modifiant le règlement de zonage no 2024-732 afin de modifier diverses dispositions"],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "f5688b527012436a48aefef6a2e521a9f89ec1a2b2b5942e0f777c7ed0aa3860",
      retrieved_at: "2026-06-11T23:27:57.629Z",
      source_span: "p3 item 5",
    },
  };

  it("builds + validates both real zonage events (verbatim, no typed relation/stage, proof v2 carried)", () => {
    for (const input of [saintMichel, laMinerve]) {
      const event = buildReglementEvent(input);
      expect(() => validateZoningEvent(event)).not.toThrow();
      expect(event).not.toHaveProperty("replaces");
      expect(event).not.toHaveProperty("amends");
      expect(event).not.toHaveProperty("lifecycle_stage");
      expect(event.provenance.sha256).toHaveLength(64);
      expect(event.provenance.retrieved_at).toBeTruthy();
      // the anchor is the verbatim libellé (§5) — event_id must NOT contain the reglement number.
      expect(event.event_id).toBe(
        computeEventId(input.muni, input.source_ref, input.detection_anchor),
      );
    }
  });

  it("premier_projet passes via §9 tolerate-unknown (not in the frozen known enum)", () => {
    expect(DOCUMENT_TYPE_KNOWN.has("premier_projet")).toBe(false);
    const event = buildReglementEvent(laMinerve);
    expect(() => validateZoningEvent(event)).not.toThrow();
    expect(event.document_type).toBe("premier_projet");
    expect(event.reglement_number).toEqual(["2026-765"]);
    expect(event.libelles_relation).toEqual([
      "modifiant le règlement de zonage no 2024-732 afin de modifier diverses dispositions",
    ]);
  });

  it("serves the pilot to an IN-MEMORY store (never prod S3), valid FeatureCollection", async () => {
    const { store, written } = memoryStore();
    const event = buildReglementEvent(saintMichel);
    const { keys, document } = await serveZoningEvents("saint-michel", [event], {
      asOf: "2026-08-30T00:00:00Z",
      complete: true,
      store,
    });
    expect(keys.length).toBeGreaterThan(0);
    expect(document.type).toBe("FeatureCollection");
    expect(document.features).toHaveLength(1);
    expect(document.features[0]!.properties.document_type).toBe("adoption");
    expect(document.features[0]!.properties.reglement_number).toEqual(["2026-301-5"]);
    expect(Object.keys(written).length).toBe(keys.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pilot — extraction diverse zonage cases (§6 complete, REAL capture provenance)
// Broadens coverage 2→5; also proves the cible-on-adoption guard + NON_APPROUVE source.
// ─────────────────────────────────────────────────────────────────────────────

describe("pilot LOT 1 — extraction diverse zonage cases (real §6 provenance)", () => {
  // candiac second_projet (§9 tolerate-unknown), cible ABSENT (création de zone), PV NON_APPROUVE.
  const candiac: ReglementLifecycleInput = {
    muni: "candiac",
    source_ref:
      "raw/proces-verbaux-candiac/cas/7eb37e07312fc273a0087a9d646b1b79621063a1bf711b19fef98e7b9c644e24.pdf",
    detection_anchor:
      "26-05-35 ADOPTION DU SECOND PROJET - RÈGLEMENT 5000-076 (CRÉATION ZONE P-447) QUE soit adopté le second projet modifiant le Règlement de zonage afin de créer la zone P-447",
    date_iso: "2026-05-25",
    url_pdf: "https://candiac.ca/uploads/Documents/Juridiques/2026/2026-05-25/2026-05-25_pv_NON_APPROUVE.pdf",
    extrait_brut: "QUE soit adopté le second projet modifiant le Règlement de zonage afin de créer la zone P-447",
    document_type: "second_projet",
    reglement_number: ["5000-076"],
    cible_reglement_numero: null,
    libelles_relation: ["Règlement 5000-076 modifiant le Règlement de zonage afin de créer la zone P-447"],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "7eb37e07312fc273a0087a9d646b1b79621063a1bf711b19fef98e7b9c644e24",
      retrieved_at: "2026-06-12T00:22:41.804Z",
      source_span: "p20",
    },
  };
  // adoption : cible=null (cible=avis-only) ; le n° de base modifié va dans libelles_relation (immo type amends).
  const sainteMartine2025492: ReglementLifecycleInput = {
    muni: "sainte-martine",
    source_ref:
      "raw/proces-verbaux-sainte-martine/cas/1a7754f5318ca92e649f73dfec983bb7ec6edb22ebde41801f1a53227795d210.pdf",
    detection_anchor:
      "2026-01-012 : Adoption du Règlement numéro 2025-492 modifiant le Règlement de zonage numéro 2019-342 zone AD-18. Que le Règlement numéro 2025-492 soit adopté.",
    date_iso: "2026-01-12",
    url_pdf: "https://sainte-martine.ca/wp-content/uploads/2026/02/conseil-janvier-2026.pdf",
    extrait_brut: "Adoption du Règlement numéro 2025-492 modifiant le Règlement de zonage numéro 2019-342 zone AD-18.",
    document_type: "adoption",
    reglement_number: ["2025-492"],
    cible_reglement_numero: null,
    libelles_relation: [
      "Adoption du Règlement numéro 2025-492 modifiant le Règlement de zonage numéro 2019-342 afin de permettre certains usages commerciaux para-agricoles en zone AD-18",
    ],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "1a7754f5318ca92e649f73dfec983bb7ec6edb22ebde41801f1a53227795d210",
      retrieved_at: "2026-06-11T21:54:21.807Z",
      source_span: "p10",
    },
  };
  const cowansville: ReglementLifecycleInput = {
    muni: "cowansville",
    source_ref:
      "raw/proces-verbaux-cowansville/cas/5e59b2409ba32f6631e58508dde455a81fba6ac3a28bfdaa5bfd7128b820414b.pdf",
    detection_anchor:
      "Adoption du règlement numéro 1841-52-2026 modifiant le règlement de zonage numéro 1841 afin de relocaliser l'usage de classe C53 zone industrielle I-5",
    date_iso: "2026-04-07",
    url_pdf:
      "https://www.cowansville.ca/storage/app/media/vie-municipale/democratie/proces-verbaux/2026/pv_seance_2026-04-07.pdf",
    extrait_brut: "Adoption du règlement numéro 1841-52-2026 modifiant le règlement de zonage numéro 1841",
    document_type: "adoption",
    reglement_number: ["1841-52-2026"],
    cible_reglement_numero: null,
    libelles_relation: [
      "Adoption du règlement numéro 1841-52-2026 modifiant le règlement de zonage numéro 1841 afin de relocaliser l'usage C53",
    ],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "5e59b2409ba32f6631e58508dde455a81fba6ac3a28bfdaa5bfd7128b820414b",
      retrieved_at: "2026-06-11T23:53:20.445Z",
      source_span: "p13",
    },
  };

  it("validates all 3 diverse zonage cases (second_projet + 2 adoptions, real §6 provenance)", () => {
    for (const input of [candiac, sainteMartine2025492, cowansville]) {
      const event = buildReglementEvent(input);
      expect(() => validateZoningEvent(event)).not.toThrow();
      expect(event.provenance.sha256).toHaveLength(64);
      expect(event.provenance.retrieved_at).toBeTruthy();
    }
  });

  it("second_projet passes §9 tolerate-unknown; a NON_APPROUVE (draft) source url still passes §6", () => {
    const event = buildReglementEvent(candiac);
    expect(DOCUMENT_TYPE_KNOWN.has("second_projet")).toBe(false);
    expect(() => validateZoningEvent(event)).not.toThrow();
    // draft/provisional nature is carried by document_type=second_projet + the url; the source is
    // live+captured (real url, not a placeholder) → §6 source-vivante satisfied.
    expect(event.provenance.source_url).toContain("NON_APPROUVE");
  });

  it("REJECTS cible_reglement_numero on an adoption (§1 table: cible is avis-only)", () => {
    const misused = buildReglementEvent({ ...sainteMartine2025492, cible_reglement_numero: "2019-342" });
    expect(() => validateZoningEvent(misused)).toThrow(/cible.*avis_motion/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pilot LOT 2 — §10 type_instrument: the SIX discriminants, real §6 provenance.
// Inputs transcribed byte-faithfully from the AUTHORITATIVE reglements extraction
// fixture (git 88cb15e5, work/coverage/reglement-lifecycle-pilot-lot2-inputs-20260830.json).
// `type_instrument_declared` = the source-DECLARED instrument term VERBATIM (or the
// literal "unknown"); the emitter canonicalises it → event.type_instrument (token).
// prove-before-scale (geo-cond gate): each discriminant MEASURED green before scaling
// to the ~45 vivier. retrieved_at is the -pocs manifest value; the PROD deposit must
// re-source it from the authoritative CLUSTER manifest.
// ─────────────────────────────────────────────────────────────────────────────

describe("pilot LOT 2 — §10 type_instrument, 6 discriminants (real §6 provenance)", () => {
  // 1. zonage (adoption) — declared "règlement de zonage" → token "zonage".
  const zonageAdoption: ReglementLifecycleInput = {
    muni: "saint-michel",
    source_ref:
      "raw/proces-verbaux-saint-michel/cas/4235f2663cb919a1ccbd8e52ef46e31ab627e74584f4433988dd113903d5d53d.pdf",
    detection_anchor:
      "QUE le conseil municipal de Saint-Michel adopte le règlement numéro 2026-301-5 modifiant le règlement de zonage numéro 2022-301, tel qu'amendé, afin d'harmoniser et d'ajuster diverses dispositions réglementaires.",
    date_iso: "2026-04-14",
    url_pdf:
      "https://municipalite-saint-michel.ca/wp-content/uploads/2026/05/proces-verbal-de-la-seance-ordinaire-du-14-avril-2026.pdf",
    extrait_brut:
      "QUE le conseil municipal de Saint-Michel adopte le règlement numéro 2026-301-5 modifiant le règlement de zonage numéro 2022-301, tel qu'amendé, afin d'harmoniser et d'ajuster diverses dispositions réglementaires.",
    document_type: "adoption",
    type_instrument_declared: "règlement de zonage",
    reglement_number: ["2026-301-5"],
    cible_reglement_numero: null,
    libelles_relation: ["modifiant le règlement de zonage numéro 2022-301, tel qu'amendé"],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "4235f2663cb919a1ccbd8e52ef46e31ab627e74584f4433988dd113903d5d53d",
      retrieved_at: "2026-06-11T23:25:00.202Z",
      source_span: "p17 item 9.1",
    },
  };

  // 2. zonage (premier_projet, §9 tolerate-unknown document_type) — declared "règlement de zonage" → "zonage".
  const zonagePremierProjet: ReglementLifecycleInput = {
    muni: "la-minerve",
    source_ref:
      "raw/proces-verbaux-la-minerve/cas/f5688b527012436a48aefef6a2e521a9f89ec1a2b2b5942e0f777c7ed0aa3860.pdf",
    detection_anchor:
      "D'adopter le premier projet de règlement no 2026-765 modifiant le règlement de zonage no 2024-732 afin de modifier diverses dispositions, tel que déposé.",
    date_iso: "2026-04-13",
    url_pdf: "https://municipalite.laminerve.qc.ca/wp-content/uploads/2026/05/2026.04.13_speciale.pdf",
    extrait_brut:
      "D'adopter le premier projet de règlement no 2026-765 modifiant le règlement de zonage no 2024-732 afin de modifier diverses dispositions, tel que déposé.",
    document_type: "premier_projet",
    type_instrument_declared: "règlement de zonage",
    reglement_number: ["2026-765"],
    cible_reglement_numero: null,
    libelles_relation: ["modifiant le règlement de zonage no 2024-732 afin de modifier diverses dispositions"],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "f5688b527012436a48aefef6a2e521a9f89ec1a2b2b5942e0f777c7ed0aa3860",
      retrieved_at: "2026-06-11T23:27:57.629Z",
      source_span: "p3 item 5",
    },
  };

  // 3. plan-urbanisme (adoption) — declared "plan d'urbanisme" → token "plan-urbanisme" (surface DISTINCTE §10.4).
  const planUrbanisme: ReglementLifecycleInput = {
    muni: "sainte-martine",
    source_ref:
      "raw/proces-verbaux-sainte-martine/cas/a6dcfd6e580258416c493eaee53207f0b0500f633de405e05b8f1be7803c65f9.pdf",
    detection_anchor:
      "2026-05-110 : Adoption du Règlement numéro 2026-509 modifiant le Règlement numéro 2019-341 concernant le plan d'urbanisme afin d'agrandir l'aire d'affectation Mixte villageoise",
    date_iso: "2026-05-12",
    url_pdf: "https://sainte-martine.ca/wp-content/uploads/2026/06/conseil-mai-2026.pdf",
    extrait_brut:
      "2026-05-110 : Adoption du Règlement numéro 2026-509 modifiant le Règlement numéro 2019-341 concernant le plan d'urbanisme afin d'agrandir l'aire d'affectation Mixte villageoise",
    document_type: "adoption",
    type_instrument_declared: "plan d'urbanisme",
    reglement_number: ["2026-509"],
    cible_reglement_numero: null,
    libelles_relation: [
      "modifiant le Règlement numéro 2019-341 concernant le plan d'urbanisme afin d'agrandir l'aire d'affectation Mixte villageoise",
    ],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "a6dcfd6e580258416c493eaee53207f0b0500f633de405e05b8f1be7803c65f9",
      retrieved_at: "2026-06-11T20:58:48.764Z",
      source_span: "p14",
    },
  };

  // 4. suspensif = registre-referendaire (content-event) — NO reglement number in the span
  //    (art. 535 LERM) → reglement_number=[], type_instrument=unknown; immo attaches by session context.
  const suspensifRegistre: ReglementLifecycleInput = {
    muni: "lawrenceville",
    source_ref:
      "raw/proces-verbaux-lawrenceville/cas/824b321b49b5bf6c86dad4610816bead34aa8fb22bd7972e6cd5a20ff0d22822.pdf",
    detection_anchor:
      "QUE soit fixée au mardi 04 mars 2025 la Tenue du registre conformément à l'article 535 de la Loi sur les élections et les référendums dans les municipalités;",
    date_iso: "2025-02-03",
    url_pdf: "https://lawrenceville.ca/wp-content/uploads/pv-03-fevrier-2025.pdf",
    extrait_brut:
      "QUE soit fixée au mardi 04 mars 2025 la Tenue du registre conformément à l'article 535 de la Loi sur les élections et les référendums dans les municipalités;",
    type: "registre-referendaire",
    document_type: null,
    type_instrument_declared: "unknown",
    reglement_number: [],
    cible_reglement_numero: null,
    libelles_relation: [],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "824b321b49b5bf6c86dad4610816bead34aa8fb22bd7972e6cd5a20ff0d22822",
      retrieved_at: "2026-06-11T23:51:43.614Z",
      // §2.1 raccord immo: the séance context (date + PV) is the attachment anchor when the span names no n° (i-arch: attach by shared rawRef/séance, uncertain+flagged).
      source_span: "p3 (séance 2025-02-03 — contexte de raccord immo, pas de n° dans le span)",
    },
  };

  // 5. unknown-instrument (mute title — the span-vs-label MISLABEL): the node was labelled
  //    "zonage" but the title "relatif à la bibliothèque" declares NO urbanism instrument →
  //    declared "unknown" → token "unknown". geo emits the declared-source, NOT the erroneous label.
  const unknownInstrument: ReglementLifecycleInput = {
    muni: "sainte-martine",
    source_ref:
      "raw/proces-verbaux-sainte-martine/cas/02072d39eab7d39eeec5b5985e01cc12ee6a33b85499efce604773156c6308b4.pdf",
    detection_anchor:
      "2025-12-218 : Adoption du Règlement numéro 2025-493 modifiant le Règlement numéro 2019-355 relatif à la bibliothèque.",
    date_iso: "2025-12-16",
    url_pdf: "https://sainte-martine.ca/wp-content/uploads/2026/01/conseil-decembre-2025.pdf",
    extrait_brut:
      "2025-12-218 : Adoption du Règlement numéro 2025-493 modifiant le Règlement numéro 2019-355 relatif à la bibliothèque. Que le Règlement numéro 2025-493 soit adopté.",
    document_type: "adoption",
    type_instrument_declared: "unknown",
    reglement_number: ["2025-493"],
    cible_reglement_numero: null,
    libelles_relation: ["modifiant le Règlement numéro 2019-355 relatif à la bibliothèque"],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "02072d39eab7d39eeec5b5985e01cc12ee6a33b85499efce604773156c6308b4",
      retrieved_at: "2026-06-11T21:54:36.577Z",
      source_span: "p8",
    },
  };

  // 6. case-instrument = derogation (document_type=null, §10.5.1 material for immo N-A-proven).
  //    ⚠ SOURCE = PV NON_APPROUVE (draft): provisional decision — the source_span carries the
  //    draft caveat (anti-invention: not masked). The real captured url (NON_APPROUVE visible)
  //    still passes §6 source-vivante; geo emits NO draft flag (immo derives provisional-ness).
  const caseDerogation: ReglementLifecycleInput = {
    muni: "candiac",
    source_ref:
      "raw/proces-verbaux-candiac/cas/7eb37e07312fc273a0087a9d646b1b79621063a1bf711b19fef98e7b9c644e24.pdf",
    detection_anchor:
      "QUE soit accordée la dérogation mineure suivante au Règlement 5006 de lotissement à l'égard de l'immeuble LOTS 6 359 227, 6 451 305 ET 6 451 306",
    date_iso: "2026-05-25",
    url_pdf: "https://candiac.ca/uploads/Documents/Juridiques/2026/2026-05-25/2026-05-25_pv_NON_APPROUVE.pdf",
    extrait_brut:
      "QUE soit accordée la dérogation mineure suivante au Règlement 5006 de lotissement à l'égard de l'immeuble LOTS 6 359 227, 6 451 305 ET 6 451 306",
    document_type: null,
    type_instrument_declared: "dérogation mineure",
    reglement_number: [],
    cible_reglement_numero: null,
    libelles_relation: [],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: {
      doc_sha256: "7eb37e07312fc273a0087a9d646b1b79621063a1bf711b19fef98e7b9c644e24",
      retrieved_at: "2026-06-12T00:22:41.804Z",
      source_span: "p18",
    },
  };

  const all = [
    zonageAdoption,
    zonagePremierProjet,
    planUrbanisme,
    suspensifRegistre,
    unknownInstrument,
    caseDerogation,
  ];

  it("all 6 build + validate green (verbatim, no typed relation/stage, proof v2 carried, A1 event_id)", () => {
    for (const input of all) {
      const event = buildReglementEvent(input);
      expect(() => validateZoningEvent(event)).not.toThrow();
      expect(event).not.toHaveProperty("replaces");
      expect(event).not.toHaveProperty("amends");
      expect(event).not.toHaveProperty("lifecycle_stage");
      expect(event.provenance.sha256).toHaveLength(64);
      expect(event.provenance.retrieved_at).toBeTruthy();
      // A1: event_id is the verbatim-libellé anchor hash, independent of reglement_number.
      expect(event.event_id).toBe(computeEventId(input.muni, input.source_ref, input.detection_anchor));
    }
  });

  it("DISCRIMINANT 1+2 — zonage: declared 'règlement de zonage' → token 'zonage'", () => {
    expect(buildReglementEvent(zonageAdoption).type_instrument).toBe("zonage");
    expect(buildReglementEvent(zonageAdoption).document_type).toBe("adoption");
    expect(buildReglementEvent(zonagePremierProjet).type_instrument).toBe("zonage");
    // premier_projet is §9-tolerated (not a frozen known document_type), still valid.
    expect(DOCUMENT_TYPE_KNOWN.has("premier_projet")).toBe(false);
    expect(buildReglementEvent(zonagePremierProjet).document_type).toBe("premier_projet");
  });

  it("DISCRIMINANT 3 — plan-urbanisme: declared 'plan d'urbanisme' → token 'plan-urbanisme' (SURFACE DISTINCTE §10.4)", () => {
    const event = buildReglementEvent(planUrbanisme);
    expect(event.type_instrument).toBe("plan-urbanisme");
    expect(INSTRUMENT_TYPE_KNOWN.has("plan-urbanisme")).toBe(true);
    expect(event.document_type).toBe("adoption");
    // the distinct-surface marker rides on the SINGLE field (§10.4: no 2nd flag).
  });

  it("DISCRIMINANT 4 — suspensif: content-event (type set, document_type null, no reglement number, unknown instrument)", () => {
    const event = buildReglementEvent(suspensifRegistre);
    expect(event.type).toBe("registre-referendaire");
    expect(event.document_type).toBeNull();
    expect(event.reglement_number).toEqual([]);
    expect(event.type_instrument).toBe("unknown");
  });

  it("DISCRIMINANT 5 — unknown-instrument (span-vs-label MISLABEL): emits 'unknown', NEVER the erroneous 'zonage' label", () => {
    const event = buildReglementEvent(unknownInstrument);
    expect(event.type_instrument).toBe("unknown"); // examined-but-mute, NOT guessed to 'zonage'
    expect(event.type_instrument).not.toBe("zonage"); // the mislabel is refused
    expect(event.document_type).toBe("adoption");
    expect(event.reglement_number).toEqual(["2025-493"]);
  });

  it("DISCRIMINANT 6 — case derogation: emits the §10.5.1 material (document_type=null + type_instrument=derogation), draft url passes §6", () => {
    const event = buildReglementEvent(caseDerogation);
    // §10.5.1: immo derives statut=N-A-PROUVÉ from exactly this pair (geo emits the material, immo derives).
    expect(event.document_type).toBeNull();
    expect(event.type_instrument).toBe("derogation");
    // draft (NON_APPROUVE) source is a REAL live capture → §6 source-vivante satisfied (not a placeholder).
    expect(event.provenance.source_url).toContain("NON_APPROUVE");
    expect(() => validateZoningEvent(event)).not.toThrow();
  });

  it("serves all 6 to an IN-MEMORY store (never prod S3): valid FeatureCollection, distinct event_ids", async () => {
    const { store, written } = memoryStore();
    const events = all.map(buildReglementEvent);
    const { keys, document } = await serveZoningEvents("pilot-lot2", events, {
      asOf: "2026-08-30T00:00:00Z",
      complete: true,
      store,
    });
    expect(document.type).toBe("FeatureCollection");
    expect(document.features).toHaveLength(6);
    expect(new Set(events.map((e) => e.event_id)).size).toBe(6); // A1: 6 distinct anchors → 6 distinct ids
    expect(Object.keys(written).length).toBe(keys.length);
    // the emitted instrument tokens, measured on the served surface immo reads.
    const tokens = document.features.map((f) => f.properties.type_instrument);
    expect(tokens).toEqual(["zonage", "zonage", "plan-urbanisme", "unknown", "unknown", "derogation"]);
  });
});
