/**
 * zoning-events-batch-emit.ts — the capitalized batch layer over the frozen emission
 * lib (`../zoning-events-emit.ts`) for the reglement-lifecycle SCALING run. It is the
 * WP6 QA-enforcement point for emitting many item-resolution inputs at once:
 *
 *   - {@link emitZoningEventsBatch} = the REJECT-GUARD: it runs `buildReglementEvent`
 *     + `validateZoningEvent` PER input, and a single bad input (e.g. a proof-less one
 *     the §6 chokepoint rejects) is SKIPPED + REPORTED — it NEVER crashes the batch of
 *     40. "vert par omission = rouge" the other way round: a batch must not silently
 *     drop the good events because one input threw, nor silently ship a bad one.
 *   - {@link serveZoningEventsBatch} = the per-MUNI serve with the ANTI-LOSS invariant
 *     made explicit: `serveZoningEvents` writes a muni whole-object with a tombstone
 *     guard (an already-served event_id MUST resurface or it throws — never a silent
 *     retraction). So this reads the existing served set per muni and MERGES (resurface
 *     existing + add new), or is greenfield when nothing is served yet — and emits a
 *     per-muni REPORT (greenfield vs merged, counts, slug) that is the exact input for
 *     the conductor's pre-run scope-check (additive vs overwrite, 0 silent retraction).
 *
 * PURE lib + injected store (no network by itself). The actual serving RUN (writing to
 * S3) is a SEPARATE, conductor-go'd, S3-prefixed invocation of the thin runner — this
 * lib only builds/validates/merges/reports; `dryRun` reads + reports without writing.
 */
import {
  buildReglementEvent,
  serveZoningEvents,
  validateZoningEvent,
  zoningEventsKeys,
  type ReglementLifecycleInput,
  type ZoningEvent,
  type ZoningEventsDocument,
  type ZoningEventsStore,
} from "../zoning-events-emit.js";

/** One input that did NOT emit — SKIPPED + reported, never a batch-crash. */
export interface BatchRejected {
  /** A stable, readable ref of the offending input (muni / source_ref / detection_anchor). */
  ref: string;
  /** The exact error the emitter/validator threw (e.g. the §6 proof-less rejection). */
  reason: string;
}

export interface BatchEmitResult {
  /** The events that built + validated cleanly, in input order. */
  built: ZoningEvent[];
  /** The inputs that were skipped (build or validate threw) — reported, never dropped silently. */
  rejected: BatchRejected[];
}

function inputRef(input: ReglementLifecycleInput): string {
  return `${input.muni} / ${input.source_ref} / ${input.detection_anchor}`;
}

/**
 * REJECT-GUARD. Build + validate every input; a throwing input (proof-less §6, invalid
 * field, …) is captured into `rejected` and the batch continues. Returns the cleanly
 * emitted events + the reject report. NEVER throws for a per-input failure (the caller
 * decides whether a non-empty `rejected` should block the serve).
 */
export function emitZoningEventsBatch(inputs: readonly ReglementLifecycleInput[]): BatchEmitResult {
  const built: ZoningEvent[] = [];
  const rejected: BatchRejected[] = [];
  for (const input of inputs) {
    try {
      const event = buildReglementEvent(input);
      validateZoningEvent(event);
      built.push(event);
    } catch (err) {
      rejected.push({ ref: inputRef(input), reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { built, rejected };
}

/** Per-muni serve outcome — the conductor's scope-check input (additive vs overwrite, 0 silent retraction). */
export interface MuniServeReport {
  slug: string;
  /** `greenfield` = no events were served for this muni yet; `merged` = existing were resurfaced. */
  mode: "greenfield" | "merged";
  /** Events already served for this muni before the run (all resurface — never dropped). */
  existing: number;
  /** New events this batch brings for this muni. */
  incoming: number;
  /** Of `incoming`, how many are NET-NEW event_ids (added). */
  added: number;
  /** Of `incoming`, how many collide with an existing event_id (payload UPDATED — flagged, never silent). */
  updated: number;
  /** Total events in the served set after the merge (existing ∪ incoming). */
  total: number;
}

export interface BatchServeResult {
  reports: MuniServeReport[];
  /** true when nothing was written (read + merge + report only). */
  dryRun: boolean;
}

export interface BatchServeOptions {
  store: ZoningEventsStore;
  asOf: string;
  /** When true, READ existing + compute the merge + report, but write NOTHING. Default false. */
  dryRun?: boolean;
}

function groupByMuni(events: readonly ZoningEvent[]): Map<string, ZoningEvent[]> {
  const byMuni = new Map<string, ZoningEvent[]>();
  for (const event of events) {
    const bucket = byMuni.get(event.muni);
    if (bucket) bucket.push(event);
    else byMuni.set(event.muni, [event]);
  }
  return byMuni;
}

/** Read the events already served for a slug (union across the flat + sub-folder keys, deduped by event_id). */
async function readExistingEvents(store: ZoningEventsStore, slug: string): Promise<ZoningEvent[]> {
  const byId = new Map<string, ZoningEvent>();
  for (const key of zoningEventsKeys(slug)) {
    const bytes = await store.getExisting(key);
    if (!bytes) continue;
    const parsed = JSON.parse(bytes.toString("utf8")) as Partial<ZoningEventsDocument>;
    for (const event of parsed.events ?? []) {
      if (!byId.has(event.event_id)) byId.set(event.event_id, event);
    }
  }
  return Array.from(byId.values());
}

/**
 * Serve a batch of freshly-built events per muni with the tombstone-safe merge made
 * EXPLICIT. For each muni: read the existing served set, merge (existing resurface, new
 * added, an event_id collision UPDATES the payload and is flagged), validate, and — unless
 * `dryRun` — write via {@link serveZoningEvents} (which re-checks the tombstone + dual-key
 * writes). Returns the per-muni report for the conductor's pre-run scope-check.
 */
export async function serveZoningEventsBatch(
  built: readonly ZoningEvent[],
  options: BatchServeOptions,
): Promise<BatchServeResult> {
  const dryRun = options.dryRun ?? false;
  const reports: MuniServeReport[] = [];
  for (const [slug, incoming] of groupByMuni(built)) {
    const existing = await readExistingEvents(options.store, slug);
    const existingIds = new Set(existing.map((e) => e.event_id));

    // Merge: existing first (resurface — anti-silent-retraction), then incoming (new wins on collision).
    const mergedById = new Map<string, ZoningEvent>();
    for (const e of existing) mergedById.set(e.event_id, e);
    let added = 0;
    let updated = 0;
    for (const e of incoming) {
      if (existingIds.has(e.event_id)) updated += 1;
      else added += 1;
      mergedById.set(e.event_id, e);
    }
    const merged = Array.from(mergedById.values());
    for (const event of merged) validateZoningEvent(event);

    reports.push({
      slug,
      mode: existing.length === 0 ? "greenfield" : "merged",
      existing: existing.length,
      incoming: incoming.length,
      added,
      updated,
      total: merged.length,
    });

    if (!dryRun) {
      // serveZoningEvents re-validates, enforces the tombstone (existing ⊆ merged, satisfied by
      // construction), and writes BOTH the flat + sub-folder key atomically.
      await serveZoningEvents(slug, merged, { asOf: options.asOf, complete: true, store: options.store });
    }
  }
  return { reports, dryRun };
}
