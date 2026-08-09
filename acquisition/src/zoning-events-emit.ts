/**
 * Emitter for the served collection `qc-zoning-events-<slug>` (schema v2.1,
 * docs/spec/SPEC_QC_ZONING_EVENTS_V2.md — READ IT FIRST, it is the contract).
 *
 * geo is the SOLE producer of this collection; immo READS it (never writes,
 * geo never touches immo's graph). Mirrors the whole-object S3 write style of
 * `fold-effet-densifiant.ts` (readEntries cross-field lock, findKeys
 * multi-key stamping) and its `lib/s3.ts` primitives.
 *
 * Anti-invention gates enforced here (verbatim-ou-inconnu):
 *   - `computeEventId` NEVER takes `bylaw_numero` — identity is
 *     STABLE-AT-DETECTION (spec A1), `bylaw_numero` is a resolved payload
 *     attribute that moves after first detection.
 *   - `resolveZonesExact` is EXACT-normalised only — no fuzzy scoring, ever;
 *     a non-exact candidate goes to `zone_codes_non_resolus`, never a low
 *     `score_confiance` (spec: "kills the HC-14 → Compton fuzzy bug").
 *   - `validateZoningEvent` hard-rejects a resolved entry with
 *     `score_confiance !== 1` / `provenance !== "exact_geom"`, and rejects an
 *     `effet_densifiant_ref` carrying any field beyond the pointer
 *     (`collection`, `zone_code`) — the event NEVER serves the normative
 *     density value itself, only a pointer to the fold that already does.
 *   - `serveZoningEvents` refuses to silently drop a previously-served
 *     `event_id` (tombstone invariant, spec A2): it must resurface as
 *     `state=retracted` in the new set, never vanish.
 */
import { createHash } from "node:crypto";

import { exists, getBytes, putBytes, s3Client } from "./lib/s3.js";
import { canonZone } from "./lib/zonage-norms.js";

// ─────────────────────────────────────────────────────────────────────────────
// Schema types (v2.1)
// ─────────────────────────────────────────────────────────────────────────────

export type ZoningEventState = "active" | "corrected" | "retracted";

/** Neutral SOURCE taxonomy only (amendment 3) — geo never emits a Steve-oriented category. */
export type ZoningEventType =
  | "ppcmoi"
  | "changement-de-zonage"
  | "projet-reglement"
  | "entree-en-vigueur"
  | "derogation-mineure"
  | "cptaq"
  | "consultation"
  | "registre-referendaire"
  | "alienation"
  | "autre";

/** Discovery, distinct from revision (`state`). */
export type ZoningDetectionState = "detected" | "detection_incomplete" | "no-event";

export type ZoneRelationType = "concerns_zone" | "concerns_lot";
export type ZoneTargetType = "Zone" | "Lot";

/** Why a mention did NOT resolve — never a low score, always a named reason. */
export type ZoneNonResolutionReason = "no-exact-match" | "detection-incomplete" | "ambiguous";

export interface Provenance {
  producer: string;
  source_span: string;
  source_url: string;
  as_of_date: string;
}

/** `score_confiance = 1.0` ONLY on EXACT match (provenance `exact_geom`). */
export interface ZoneCodeResolution {
  zone_code: string;
  relation_type: ZoneRelationType;
  target_id: string;
  target_type: ZoneTargetType;
  score_confiance: number;
  provenance: string;
  as_of_date: string;
}

export interface ZoneCodeNonResolution {
  mention_brute: string;
  page: number | null;
  raison: ZoneNonResolutionReason;
}

/**
 * Pointer ONLY into the fold-effet-densifiant-served diff on `qc-zonage-<slug>`.
 * NORMES/VALUES (densite_avant/apres) stay on that collection — the event
 * NEVER carries the normative value itself, so it can never drift from the
 * fold that is the single source of truth for it.
 */
export interface EffetDensifiantRef {
  collection: string;
  zone_code: string;
}

export interface ZoningEvent {
  event_id: string;
  version: number;
  supersedes: string | null;
  state: ZoningEventState;
  muni: string;
  /** Verbatim from the bylaw BODY art.1.1 — NEVER the title/URL/filename number. May be null. */
  bylaw_numero: string | null;
  type: ZoningEventType;
  /** YYYY-MM-DD */
  date_iso: string;
  detection_state: ZoningDetectionState;
  zone_codes_resolus: ZoneCodeResolution[];
  zone_codes_non_resolus: ZoneCodeNonResolution[];
  /** Integer when verbatim-extractable from the text, else null (never deduced/guessed). */
  nb_unites_max: number | null;
  effet_densifiant_ref: EffetDensifiantRef | null;
  url_pdf: string;
  /** Verbatim proof span. */
  extrait_brut: string;
  confidence: number;
  provenance: Provenance;
}

/**
 * Collection-level envelope written whole-object, atomically, per slug (spec A2).
 *
 * It is ALSO a valid GeoJSON FeatureCollection so geo-api's OGC /items endpoint can
 * serve it (geo-api lists any file it scans but returns "Unknown collection" on /items
 * unless the object is a FeatureCollection with `features[]`). Each event is a Feature
 * with null geometry (the event's spatial anchor is `zone_codes_resolus`, resolved
 * against qc-zonage-<slug>, not carried here). immo reads the event from `.properties`;
 * the flat `events[]` is kept as a convenience mirror for direct-S3 consumers.
 */
export interface ZoningEventsDocument {
  type: "FeatureCollection";
  as_of: string;
  complete: boolean;
  muni: string;
  events: ZoningEvent[];
  features: { type: "Feature"; geometry: null; properties: ZoningEvent }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// event_id — STABLE-AT-DETECTION (spec A1, "the crux")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `event_id = sha256(muni | source_ref | detection_anchor)`.
 *
 * `source_ref` = the stable source document identity (notice URL / PV doc url
 * / CPTAQ dossier url / YouTube video id). `detection_anchor` = a stable
 * INTRINSIC within-document locator (notice id, résolution number, transcript
 * timecode, or a hash of the verbatim libellé) — NEVER a positional ordinal
 * (immo's projector reserves ordinals; a changing id orphans the event and
 * breaks the `supersedes` chain / drops Steve marks).
 *
 * `bylaw_numero` deliberately does NOT enter this function: it is a RESOLVED
 * PAYLOAD attribute (may be absent at detection, resolved later), never
 * identity (spec A1 + A3).
 */
export function computeEventId(
  muni: string,
  sourceRef: string,
  detectionAnchor: string,
): string {
  return createHash("sha256")
    .update(`${muni}|${sourceRef}|${detectionAnchor}`, "utf8")
    .digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone resolution — EXACT normalised only (kills the HC-14 → Compton fuzzy bug)
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoneMention {
  /** Raw span as it appears in the source text/table/heading. */
  mention_brute: string;
  page: number | null;
}

export interface ResolveZonesExactOptions {
  as_of_date: string;
  relation_type?: ZoneRelationType;
  target_type?: ZoneTargetType;
  provenance?: string;
}

export interface ResolveZonesExactResult {
  resolved: ZoneCodeResolution[];
  unresolved: ZoneCodeNonResolution[];
}

/**
 * Resolve raw zone mentions against the REAL served `zone_code` set by EXACT
 * normalised match (reuses `canonZone`, the single source of truth shared
 * with the lot⋈norms join — same order-invariant/dash/case folds, so a
 * served `RD-104` and a mention `rd104` collapse to the SAME key without
 * ever becoming a fuzzy/partial match).
 *
 * NEVER fuzzy: a mention with no exact-canon hit goes to `zone_codes_non_resolus`
 * with `raison: "no-exact-match"`, NEVER a low `score_confiance`. If the served
 * set itself has two DISTINCT codes collapsing to the same canon key, any
 * mention hitting that key is `raison: "ambiguous"` (the served set cannot
 * disambiguate an exact match for it) — this can never silently pick one.
 */
export function resolveZonesExact(
  mentions: readonly ZoneMention[],
  servedZoneCodes: readonly string[] | ReadonlySet<string>,
  options: ResolveZonesExactOptions,
): ResolveZonesExactResult {
  const relationType = options.relation_type ?? "concerns_zone";
  const targetType = options.target_type ?? "Zone";
  const provenance = options.provenance ?? "exact_geom";

  const served = Array.from(
    servedZoneCodes instanceof Set ? servedZoneCodes : new Set(servedZoneCodes),
  );
  const byCanon = new Map<string, string[]>();
  for (const code of served) {
    const key = canonZone(code);
    const bucket = byCanon.get(key);
    if (bucket) bucket.push(code);
    else byCanon.set(key, [code]);
  }

  const resolved: ZoneCodeResolution[] = [];
  const unresolved: ZoneCodeNonResolution[] = [];

  for (const mention of mentions) {
    const key = canonZone(mention.mention_brute);
    const bucket = byCanon.get(key);
    if (!bucket) {
      unresolved.push({
        mention_brute: mention.mention_brute,
        page: mention.page,
        raison: "no-exact-match",
      });
      continue;
    }
    if (bucket.length > 1) {
      unresolved.push({
        mention_brute: mention.mention_brute,
        page: mention.page,
        raison: "ambiguous",
      });
      continue;
    }
    const zoneCode = bucket[0]!;
    resolved.push({
      zone_code: zoneCode,
      relation_type: relationType,
      target_id: zoneCode,
      target_type: targetType,
      score_confiance: 1.0,
      provenance,
      as_of_date: options.as_of_date,
    });
  }

  return { resolved, unresolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation — hard gate, called before every write
// ─────────────────────────────────────────────────────────────────────────────

const ZONING_EVENT_STATES: readonly ZoningEventState[] = ["active", "corrected", "retracted"];
const ZONING_DETECTION_STATES: readonly ZoningDetectionState[] = [
  "detected",
  "detection_incomplete",
  "no-event",
];
const EFFET_DENSIFIANT_REF_KEYS = new Set(["collection", "zone_code"]);

/**
 * Hard gate on ONE event, run before it is ever written. Mirrors the spirit
 * of `fold-effet-densifiant.ts` `readEntries`'s cross-field lock: the
 * guarantee lives in code, not in the diligence of whoever calls this.
 */
export function validateZoningEvent(event: ZoningEvent): void {
  const id = event.event_id || "(event_id manquant)";
  if (!event.event_id) throw new Error("zoning-event: event_id manquant");
  if (!Number.isInteger(event.version) || event.version < 1) {
    throw new Error(`zoning-event ${id}: version invalide (${String(event.version)})`);
  }
  if (!ZONING_EVENT_STATES.includes(event.state)) {
    throw new Error(`zoning-event ${id}: state invalide (${String(event.state)})`);
  }
  if (!ZONING_DETECTION_STATES.includes(event.detection_state)) {
    throw new Error(`zoning-event ${id}: detection_state invalide (${String(event.detection_state)})`);
  }
  if (
    event.nb_unites_max !== null &&
    (!Number.isInteger(event.nb_unites_max) || event.nb_unites_max < 0)
  ) {
    throw new Error(
      `zoning-event ${id}: nb_unites_max invalide (${String(event.nb_unites_max)}) — doit être un entier positif ou null`,
    );
  }
  for (const r of event.zone_codes_resolus) {
    // No fuzzy, ever: a resolved entry MUST be the exact-match 1.0/exact_geom pair.
    if (r.score_confiance !== 1) {
      throw new Error(
        `zoning-event ${id}: zone ${r.zone_code} score_confiance=${r.score_confiance} — seul 1.0 (exact) est servi, jamais un score fuzzy`,
      );
    }
    if (r.provenance !== "exact_geom") {
      throw new Error(
        `zoning-event ${id}: zone ${r.zone_code} provenance='${r.provenance}' — attendu 'exact_geom' pour une résolution EXACTE`,
      );
    }
  }
  if (event.effet_densifiant_ref !== null) {
    for (const key of Object.keys(event.effet_densifiant_ref)) {
      if (!EFFET_DENSIFIANT_REF_KEYS.has(key)) {
        throw new Error(
          `zoning-event ${id}: effet_densifiant_ref porte un champ interdit '${key}' — pointeur seulement ({collection,zone_code}), JAMAIS la valeur normative`,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serving — whole-object S3 write, mirrors fold-effet-densifiant.ts
// ─────────────────────────────────────────────────────────────────────────────

const EVENTS_PREFIX = "normalized/ca-qc-zoning-events/";

/** Both the flat AND sub-folder key (memory fold-double-key-s3 — geo-api serves the sub-folder key). */
export function zoningEventsKeys(slug: string): string[] {
  const base = `qc-zoning-events-${slug}`;
  return [`${EVENTS_PREFIX}${base}.geojson`, `${EVENTS_PREFIX}${base}/${base}.geojson`];
}

/** Injectable storage boundary so `serveZoningEvents` is testable without real S3/network. */
export interface ZoningEventsStore {
  getExisting(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer): Promise<void>;
}

/** Default store: real Scaleway S3 via `lib/s3.ts` (production path). */
export function s3ZoningEventsStore(s3 = s3Client()): ZoningEventsStore {
  return {
    async getExisting(key) {
      if (!(await exists(s3, key))) return null;
      return getBytes(s3, key);
    },
    async put(key, body) {
      await putBytes(s3, key, body, "application/geo+json");
    },
  };
}

export interface ServeZoningEventsOptions {
  /** ISO timestamp for the collection-level `as_of`. */
  asOf: string;
  /** `false` = mid-refresh partial; immo skips it (spec A2). Always warns. */
  complete: boolean;
  /** Injectable store; defaults to real S3 (`s3ZoningEventsStore()`). */
  store?: ZoningEventsStore;
}

export interface ServeZoningEventsResult {
  keys: string[];
  document: ZoningEventsDocument;
}

/**
 * Serve the COMPLETE per-muni event set atomically (spec A2): the whole
 * `qc-zoning-events-<slug>` object is written in one put, to BOTH the flat
 * and sub-folder key, never feature-by-feature.
 *
 * Tombstone guard: an `event_id` already present in the currently-served set
 * MUST reappear in `events` (as `state=retracted` if it was retired) — it can
 * never simply vanish. A vanished event_id under `complete:true` is a bug in
 * the caller and this throws rather than silently dropping it (spec A2:
 * "An event that vanishes from the feed while complete:true is a bug, not a
 * signal.").
 */
export async function serveZoningEvents(
  slug: string,
  events: ZoningEvent[],
  options: ServeZoningEventsOptions,
): Promise<ServeZoningEventsResult> {
  for (const event of events) validateZoningEvent(event);

  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.event_id)) {
      throw new Error(`zoning-events ${slug}: event_id dupliqué ${event.event_id}`);
    }
    ids.add(event.event_id);
  }

  if (!options.complete) {
    console.warn(
      `zoning-events ${slug}: complete=false — snapshot partiel, immo NE projettera PAS cette ville tant que complete!=true`,
    );
  }

  const store = options.store ?? s3ZoningEventsStore();
  const keys = zoningEventsKeys(slug);

  // Tombstone invariant: read whichever key already exists and make sure every
  // previously-served event_id resurfaces (retracted or not) in the new set.
  for (const key of keys) {
    const existing = await store.getExisting(key);
    if (!existing) continue;
    const parsed = JSON.parse(existing.toString("utf8")) as Partial<ZoningEventsDocument>;
    const priorEvents = Array.isArray(parsed.events) ? parsed.events : [];
    const missing = priorEvents.filter((e) => !ids.has(e.event_id));
    if (missing.length > 0) {
      throw new Error(
        `zoning-events ${slug}: ${missing.length} event(s) déjà servi(s) absent(s) du nouveau set (tombstone requis, state=retracted, jamais un retrait silencieux): ${missing
          .map((e) => e.event_id)
          .join(", ")}`,
      );
    }
  }

  const document: ZoningEventsDocument = {
    type: "FeatureCollection",
    as_of: options.asOf,
    complete: options.complete,
    muni: slug,
    events,
    features: events.map((event) => ({ type: "Feature", geometry: null, properties: event })),
  };
  const body = Buffer.from(JSON.stringify(document));

  for (const key of keys) {
    await store.put(key, body);
  }

  return { keys, document };
}
