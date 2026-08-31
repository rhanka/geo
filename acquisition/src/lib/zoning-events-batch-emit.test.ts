/**
 * Tests for the reglement-lifecycle SCALING batch layer: the REJECT-GUARD (one bad
 * input is skipped + reported, never a batch-crash) and the per-muni TOMBSTONE-SAFE
 * merge (existing events resurface, new added, collisions flagged; greenfield vs merged
 * report; dry-run reads-without-writing).
 */
import { describe, expect, it } from "vitest";

import { type ReglementLifecycleInput, type ZoningEventsStore } from "../zoning-events-emit.js";
import { emitZoningEventsBatch, serveZoningEventsBatch } from "./zoning-events-batch-emit.js";

const AS_OF = "2026-08-31T00:00:00Z";

function input(muni: string, anchor: string, overrides: Partial<ReglementLifecycleInput> = {}): ReglementLifecycleInput {
  return {
    muni,
    source_ref: `https://example.org/${muni}/pv.pdf`,
    detection_anchor: anchor,
    date_iso: "2026-05-12",
    url_pdf: `https://example.org/${muni}/pv.pdf`,
    extrait_brut: "« ... »",
    document_type: null,
    reglement_number: [],
    cible_reglement_numero: null,
    libelles_relation: [],
    declencheur_type: null,
    declencheur_date_verbatim: null,
    provenance: { doc_sha256: "0".repeat(64), retrieved_at: AS_OF, source_span: "p1" },
    ...overrides,
  };
}

/** In-memory store over a Map — exercises the tombstone read/merge without S3. */
function memoryStore(): ZoningEventsStore & { data: Map<string, Buffer>; puts: number } {
  const data = new Map<string, Buffer>();
  const store = {
    data,
    puts: 0,
    async getExisting(key: string) {
      return data.get(key) ?? null;
    },
    async put(key: string, body: Buffer) {
      data.set(key, body);
      store.puts += 1;
    },
  };
  return store;
}

describe("emitZoningEventsBatch — reject-guard", () => {
  it("skips + reports a proof-less input, NEVER crashing the batch (the good events still build)", () => {
    // The middle input is proof-less (no doc_sha256) → buildReglementEvent's §6 chokepoint throws.
    const proofless = input("labelle", "x", {
      provenance: { retrieved_at: AS_OF, source_span: "p1" } as unknown as ReglementLifecycleInput["provenance"],
    });
    const { built, rejected } = emitZoningEventsBatch([input("amos", "a"), proofless, input("amos", "b")]);
    expect(built).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].ref).toContain("labelle");
    expect(rejected[0].reason).toMatch(/preuve v2|provenance/i);
  });

  it("returns everything built when all inputs are clean", () => {
    const { built, rejected } = emitZoningEventsBatch([input("amos", "a"), input("sutton", "b")]);
    expect(built).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });
});

describe("serveZoningEventsBatch — per-muni tombstone-safe merge + report", () => {
  it("greenfield: no existing served set → mode=greenfield, all new, written", async () => {
    const store = memoryStore();
    const { built } = emitZoningEventsBatch([input("amos", "a"), input("amos", "b")]);
    const { reports } = await serveZoningEventsBatch(built, { store, asOf: AS_OF });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ slug: "amos", mode: "greenfield", existing: 0, incoming: 2, added: 2, updated: 0, total: 2 });
    expect(store.puts).toBeGreaterThan(0);
  });

  it("merged: an existing served set RESURFACES + the new event is added (no tombstone throw)", async () => {
    const store = memoryStore();
    // seed
    await serveZoningEventsBatch(emitZoningEventsBatch([input("amos", "a")]).built, { store, asOf: AS_OF });
    // add a new event for the same muni
    const { built } = emitZoningEventsBatch([input("amos", "b")]);
    const { reports } = await serveZoningEventsBatch(built, { store, asOf: AS_OF });
    expect(reports[0]).toMatchObject({ slug: "amos", mode: "merged", existing: 1, incoming: 1, added: 1, updated: 0, total: 2 });
  });

  it("collision: a same-event_id input UPDATES (flagged updated), never a silent add", async () => {
    const store = memoryStore();
    await serveZoningEventsBatch(emitZoningEventsBatch([input("amos", "a")]).built, { store, asOf: AS_OF });
    // same muni + same detection_anchor + same source_ref => same event_id, different payload
    const { built } = emitZoningEventsBatch([input("amos", "a", { extrait_brut: "« updated »" })]);
    const { reports } = await serveZoningEventsBatch(built, { store, asOf: AS_OF });
    expect(reports[0]).toMatchObject({ slug: "amos", mode: "merged", existing: 1, incoming: 1, added: 0, updated: 1, total: 1 });
  });

  it("dryRun: reads + reports the merge but writes NOTHING", async () => {
    const store = memoryStore();
    await serveZoningEventsBatch(emitZoningEventsBatch([input("amos", "a")]).built, { store, asOf: AS_OF });
    const putsAfterSeed = store.puts;
    const { built } = emitZoningEventsBatch([input("amos", "b")]);
    const { reports, dryRun } = await serveZoningEventsBatch(built, { store, asOf: AS_OF, dryRun: true });
    expect(dryRun).toBe(true);
    expect(reports[0]).toMatchObject({ mode: "merged", existing: 1, added: 1, total: 2 });
    expect(store.puts).toBe(putsAfterSeed); // no new write
  });

  it("groups a multi-muni batch into one report per muni", async () => {
    const store = memoryStore();
    const { built } = emitZoningEventsBatch([input("amos", "a"), input("sutton", "a"), input("amos", "b")]);
    const { reports } = await serveZoningEventsBatch(built, { store, asOf: AS_OF });
    const bySlug = Object.fromEntries(reports.map((r) => [r.slug, r]));
    expect(reports).toHaveLength(2);
    expect(bySlug.amos).toMatchObject({ incoming: 2, total: 2 });
    expect(bySlug.sutton).toMatchObject({ incoming: 1, total: 1 });
  });
});
