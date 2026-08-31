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

/**
 * Neutral SOURCE taxonomy only (amendment 3) — geo never emits a Steve-oriented category.
 *
 * The four SUSPENSIVE content-events (registre-referendaire / retrait /
 * echec-referendaire / refus-mrc) are the facts the FROZEN règlement contract
 * (§2.1 gate) requires geo to EMIT so immo can gate `en_vigueur` derivation: a
 * suspensive fact present-in-the-source but NOT emitted becomes a fabricated
 * en_vigueur downstream. geo emits them VERBATIM; it never types or gates.
 */
export type ZoningEventType =
  | "ppcmoi"
  | "changement-de-zonage"
  | "projet-reglement"
  | "entree-en-vigueur"
  | "derogation-mineure"
  | "cptaq"
  | "consultation"
  | "registre-referendaire"
  | "retrait"
  | "echec-referendaire"
  | "refus-mrc"
  | "alienation"
  | "autre";

/** The four suspensive content-event types the §2.1 gate consumes (immo gates, geo emits). */
export const SUSPENSIVE_EVENT_TYPES: ReadonlySet<ZoningEventType> = new Set([
  "registre-referendaire",
  "retrait",
  "echec-referendaire",
  "refus-mrc",
]);

/**
 * `document_type` — the FIRST-CLASS lifecycle document axis (FROZEN contract
 * `SPEC_GEO_REGLEMENT_LIFECYCLE_CONTRACT.md` §1), source-doc-tied, DISTINCT from the
 * content `type`. geo emits it VERBATIM from the source-document kind; immo DERIVES
 * `lifecycle_stage` from it (geo NEVER emits a stage). A pure content event carries
 * `document_type: null`.
 */
export type DocumentTypeKnown =
  | "avis_motion"
  | "projet_reglement"
  | "adoption"
  | "entree_en_vigueur"
  | "abrogation";

/** The known first-class set (used by the extension-policy guard). */
export const DOCUMENT_TYPE_KNOWN: ReadonlySet<string> = new Set<DocumentTypeKnown>([
  "avis_motion",
  "projet_reglement",
  "adoption",
  "entree_en_vigueur",
  "abrogation",
]);

/**
 * Extension policy (contract §9): a consumer MUST tolerate an UNKNOWN `document_type`
 * value (a future addition = minor-version, non-breaking) and never crash. The type is
 * therefore a widened string; the known values are enumerated in {@link DOCUMENT_TYPE_KNOWN}.
 */
export type DocumentType = DocumentTypeKnown | (string & {});

/** en_vigueur DATE trigger-fact kind (contract §2.1) — never the adoption date by default. */
export type DeclencheurType = "publication_avis" | "certificat_mrc";

/**
 * §10.2 the known instrument tokens. `"unknown"` is the OUT-OF-ENUM sentinel
 * (§9 tolerance, examined-but-source-mute) — it is NEVER a member of this set,
 * and neither is `null` (not-populated / legacy). A declared-but-untabled
 * instrument is a §9 by-value extension (tolerated, added here later = minor-version),
 * NOT a member yet either. Consumers route an unknown value to a generic bucket,
 * never crash.
 */
export const INSTRUMENT_TYPE_KNOWN: ReadonlySet<string> = new Set<string>([
  "zonage",
  "lotissement",
  "construction",
  "plan-urbanisme",
  "piia",
  "derogation",
]);

/** Normalise a DECLARED term: strip diacritics, lower-case, apostrophes/hyphens→space, collapse ws. */
function normalizeDeclaredInstrument(declared: string): string {
  return declared
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['‘’`]/g, " ")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * §10.3 declared-source → canonical instrument token. geo NORMALISES a term the
 * SOURCE DECLARED (it NEVER infers the instrument from content): "règlement de
 * zonage"→`zonage`, "plan d'urbanisme"→`plan-urbanisme`, "règlement sur les
 * dérogations mineures"→`derogation`. Single capitalised canon point (parallel to
 * {@link canonZone}) so the mapping is not re-invented per corpus record.
 *
 * Three-state (§10.2/§10.3/§10.7), NEVER guessed:
 *   - a declared term naming a known instrument → its canonical token ({@link INSTRUMENT_TYPE_KNOWN});
 *   - an already-canonical token → itself (idempotent);
 *   - the literal `unknown` / empty → `"unknown"` — the OUT-OF-ENUM sentinel (examined, source-mute), NOT a set member;
 *   - a declared-but-untabled instrument → its normalised slug (§9 by-value tolerance: emitted + generically bucketed, promoted to the known set later = minor-version). It is NEVER silently collapsed to `"unknown"` — that would erase a real declaration.
 *
 * Ambiguity/absence is the CALLER's call (the corpus side feeds the literal `unknown`
 * for a mute/ambiguous title); `null` (not-populated) never reaches here — the caller keeps it null.
 */
export function canonInstrumentType(declared: string): string {
  const n = normalizeDeclaredInstrument(declared);
  if (n === "" || n === "unknown") return "unknown";
  // Idempotence: an already-canonical token (its hyphen is normalised to a space above) passes through.
  const asToken = n.replace(/\s+/g, "-");
  if (INSTRUMENT_TYPE_KNOWN.has(asToken)) return asToken;
  // Ordered most-specific-first so a declared term resolves deterministically to its head instrument.
  if (n.includes("plan d urbanisme") || n.includes("plan durbanisme")) return "plan-urbanisme";
  if (n.includes("implantation et d integration architecturale") || /\bpiia\b/.test(n)) return "piia";
  if (n.includes("derogation")) return "derogation";
  if (n.includes("lotissement")) return "lotissement";
  if (n.includes("construction")) return "construction";
  if (n.includes("zonage")) return "zonage";
  // Declared, but not a known instrument → §9-tolerant slug passthrough (never guessed, never erased to unknown).
  return asToken;
}

/**
 * §11 `decision_state` — the DECISION-STATE axis (OWNER-RATIFIED 2026-08-31, present-decision
 * A/A). Is this event a PLANNED item (an ordre-du-jour / agenda point, séance à venir) or a
 * DECIDED one (attested in a minuted PV / adopted)? It is ORTHOGONAL to BOTH `document_type`
 * (bylaw-lifecycle STAGE) and `type_instrument` (declared instrument): an event carries a
 * document_type AND/OR a type_instrument AND/OR a decision_state INDEPENDENTLY — none derives
 * from another. In particular a content-event (`document_type: null`) still carries its own
 * decision_state and its own declared `type_instrument`; the axes never collapse into each other.
 *
 * ANTI-INVENTION (the load-bearing reason the axis exists — NOT to clear a backlog): an ODJ item
 * is `planned` VERBATIM; `decided` is emitted ONLY when the source attests the decision (a minuted
 * PV). geo NEVER promotes a planned/agenda item to `decided` — an assumed adoption is a fabricated
 * fact. `null`/absent = not-populated (legacy / axis unset), and is NEVER read as `decided`.
 */
export type DecisionState = "planned" | "decided";

/** The known decision-state values (validation guard). `null`/absent = not-populated, never `decided`. */
export const DECISION_STATE_KNOWN: ReadonlySet<string> = new Set<DecisionState>(["planned", "decided"]);

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
  /**
   * Capture-proof sha256 of the source document (FROZEN contract §6 — the proof-v2
   * anchor). A served geo LIFECYCLE event MUST carry it; a placeholder/absent proof is a
   * PHANTOM stage, forbidden. `null` for a non-emitted derived value.
   *
   * OPTIONAL KEY (transitional §6 rollout): pre-§6 sibling producers (`zoning-events-detect-emit`,
   * `zoning-event-remediation`, source-audit) build a Provenance WITHOUT the key (`undefined`); keeping
   * it optional keeps them compiling. Enforcement (corrected — an ABSENT key is NOT hard-rejected):
   * {@link validateZoningEvent} rejects a PRESENT-but-empty/`null` proof; an ABSENT key (`undefined`) is
   * GRANDFATHERED for those legacy producers (§6 adoption = a separate task). The proof requirement for a
   * geo-EMITTED event is enforced UPSTREAM at {@link buildReglementEvent}'s input (doc_sha256/retrieved_at
   * ABSENT/`undefined` — incl. a JSON-dropped key — → REFUS, ALL types, round-trip-safe); a PRESENT-but-empty
   * proof → REFUS at the validate gate above; plus a validate defense-in-depth for a TYPED event
   * (`document_type` set ⇒ proof present).
   */
  sha256?: string | null;
  /** ISO `retrieved_at` of the capture (FROZEN contract §6) — a REAL manifest value, never fabricated. OPTIONAL KEY (see `sha256`): the serve-time guard requires it. */
  retrieved_at?: string | null;
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

  // ── FROZEN règlement-lifecycle contract (LOT 1) — geo emits VERBATIM material ONLY.
  //    geo NEVER emits a typed relation (replaces/amends) nor a lifecycle_stage; immo derives those.
  //
  //    ADDITIVE fields (§10.7 / LOT 1) — OPTIONAL KEYS: a pre-LOT-1 producer
  //    (`zoning-events-detect-emit`, remediation, source-audit) emits a v2.1 content/detection
  //    event WITHOUT lifecycle material; the safe-default is "absent = not-populated" (§10.7:
  //    "null pour les events existants = rétro-compat"). `buildReglementEvent` ALWAYS sets them
  //    explicitly; `validateZoningEvent` treats `undefined` as the content-default (`!= null`),
  //    so a served LIFECYCLE event is still fully checked and a legacy event still validates.
  /** Source-doc-tied lifecycle document kind (contract §1); `null`/absent for a pure content event. */
  document_type?: DocumentType | null;
  /**
   * §10: the DECLARED-SOURCE instrument type as a CANONICAL TOKEN — one of
   * {@link INSTRUMENT_TYPE_KNOWN} `{ zonage | lotissement | construction | plan-urbanisme |
   * piia | derogation }` + §9-tolerant (a 3rd by-value discriminant enum). Built from the
   * source-declared term via {@link canonInstrumentType} (geo emits, geo does NOT classify).
   *
   * Three DISTINCT states (do not conflate — the crown-jewel N-A≠UNKNOWN motif):
   *   - a canonical token → the source DECLARED that instrument;
   *   - the literal `"unknown"` → EXAMINED but the source title is absent/ambiguous (the OUT-OF-ENUM sentinel, §9-tolerated — NOT a 7th member, NEVER guessed from content);
   *   - `null` → NOT populated (legacy / pre-§10, §10.7) — never conflate with `"unknown"`.
   *
   * The REGIME (bylaw vs case) is `document_type`-driven, NOT this field (§10.5); immo routes on it.
   * ADDITIVE §10.7 — OPTIONAL KEY (see `document_type`): absent = not-populated on a pre-§10 event.
   */
  type_instrument?: string | null;
  /** Verbatim list of règlement numbers (art.1.1 body per §1 table); `[]` for `avis_motion`. Verbatim-or-null per item, never guessed. ADDITIVE §10.7 — optional (absent = `[]`). */
  reglement_number?: (string | null)[];
  /** The `avis`'s ANNOUNCED target number, verbatim-or-null (contract §1/§4). Never inferred. ADDITIVE §10.7 — optional (absent = `null`). */
  cible_reglement_numero?: string | null;
  /** Raw verbatim relation libellés ("modifiant/remplace/abroge `<n°>`") — MATERIAL for immo relation typing; geo does NOT type them. ADDITIVE §10.7 — optional (absent = `[]`). */
  libelles_relation?: string[];
  /** en_vigueur DATE trigger kind (contract §2.1): publication de l'avis / certificat MRC. `null`/absent = unknown. ADDITIVE §10.7 — optional. */
  declencheur_type?: DeclencheurType | null;
  /** Verbatim trigger date (contract §2.1). `null`/absent = UNKNOWN — NEVER the adoption date by default. ADDITIVE §10.7 — optional. */
  declencheur_date_verbatim?: string | null;
  /**
   * §11 the DECISION-STATE axis — `planned` (ODJ/agenda) | `decided` (attested in a minuted
   * PV / adopted) | `null`/absent (not-populated). ORTHOGONAL to `document_type` and
   * `type_instrument` (owner-ratified 2026-08-31). ANTI-INVENTION: `decided` requires source
   * attestation; an ODJ item is `planned`, NEVER assumed decided. ADDITIVE §10.7/§11 — OPTIONAL KEY.
   */
  decision_state?: DecisionState | null;

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
// Règlement-lifecycle emission (FROZEN contract LOT 1) — verbatim material only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The verbatim per-ITEM-RESOLUTION input the corpus side feeds to build ONE
 * event (FROZEN contract §5: the fan-out unit is the item-resolution, NOT the
 * bylaw number). ONE input = ONE item-resolution = ONE event = ONE
 * `detection_anchor`. `reglement_number` is the LIST of numbers THIS item
 * attests (1 for a mono résolution, N for a refonte like la-minerve 765–770).
 *
 * The producer emits VERBATIM: it NEVER types a relation (libellés go raw into
 * `libelles_relation` for immo to type) and NEVER derives a stage. A suspensive
 * fact (contract §2.1) is a content event: set `type` to one of
 * {@link SUSPENSIVE_EVENT_TYPES} and leave `document_type: null`.
 */
export interface ReglementLifecycleInput {
  muni: string;
  /** Stable source-document identity (notice/PV/certificate url). */
  source_ref: string;
  /** Per-item verbatim libellé hash (A1 anchor) — NEVER an ordinal, NEVER a reglement_number. */
  detection_anchor: string;
  /** YYYY-MM-DD of the source document. */
  date_iso: string;
  url_pdf: string;
  /** Verbatim proof span. */
  extrait_brut: string;
  /** Source-doc-tied lifecycle kind; `null` for a pure content/suspensive event. */
  document_type: DocumentType | null;
  /**
   * §10.3: the instrument type the SOURCE DECLARED, VERBATIM (e.g. `"règlement de zonage"`,
   * `"plan d'urbanisme"`) OR the literal `"unknown"` (title absent/ambiguous — the corpus side
   * decides that, NEVER geo, NEVER guessed from content). {@link buildReglementEvent} canonicalises
   * it to the emitted `type_instrument` TOKEN via {@link canonInstrumentType} (single capitalised
   * canon point). `null`/omitted = not-populated (legacy/pre-§10, §10.7) — kept `null`, NOT canonicalised.
   */
  type_instrument_declared?: string | null;
  /** Verbatim number list THIS item attests (`[]` for `avis_motion`). */
  reglement_number: (string | null)[];
  /** The avis's announced number, verbatim-or-null. */
  cible_reglement_numero: string | null;
  /** Raw verbatim relation libellés ("modifiant/remplace/abroge `<n°>`"). */
  libelles_relation: string[];
  /** en_vigueur DATE trigger kind (§2.1). */
  declencheur_type: DeclencheurType | null;
  /** Verbatim trigger date (§2.1); `null` = UNKNOWN. */
  declencheur_date_verbatim: string | null;
  /**
   * §11 the decision-state the SOURCE attests: `'planned'` for an ordre-du-jour / agenda item,
   * `'decided'` ONLY when a minuted PV attests the decision. Omitted/`null` = not-populated.
   * geo emits VERBATIM — it NEVER promotes `planned`→`decided` without source attestation.
   */
  decision_state?: DecisionState | null;
  /** Content taxonomy: a suspensive/content type, else defaults to `"autre"` for a pure lifecycle doc. */
  type?: ZoningEventType;
  /** Optional EXACT-resolved zone links (already resolved by the caller via {@link resolveZonesExact}). */
  zone_codes_resolus?: ZoneCodeResolution[];
  zone_codes_non_resolus?: ZoneCodeNonResolution[];
  /**
   * §6 auditable provenance the corpus side actually holds: the capture-proof sha256
   * (from the -pocs manifest / the CAS key), the capture `retrieved_at` (a REAL manifest
   * value, NEVER fabricated), and a source span (e.g. "p17 item 9.1"). {@link buildReglementEvent}
   * assembles the full {@link Provenance} from these + `url_pdf`/`date_iso`.
   */
  provenance: { doc_sha256: string; retrieved_at: string; source_span: string };
}

/** The six lifecycle fields at their content-event defaults (a pure content event carries no lifecycle material). */
export const CONTENT_EVENT_LIFECYCLE_DEFAULTS = {
  document_type: null,
  reglement_number: [] as (string | null)[],
  cible_reglement_numero: null,
  libelles_relation: [] as string[],
  declencheur_type: null,
  declencheur_date_verbatim: null,
} as const;

/**
 * Build ONE {@link ZoningEvent} from a verbatim item-resolution input. Does NOT
 * fan out (the caller produces one input per item-resolution); does NOT type a
 * relation or derive a stage. `bylaw_numero` (v2.1 back-compat payload) is the
 * first non-null of `reglement_number` — NEVER part of identity (A1). Always run
 * {@link validateZoningEvent} on the result before serving.
 */
export function buildReglementEvent(input: ReglementLifecycleInput): ZoningEvent {
  // §6 chokepoint (round-trip-safe, ALL types incl. content/suspensifs `document_type=null`): a
  // geo-emitted event carries a REAL capture proof-v2. A JSON-fed input whose `doc_sha256`/
  // `retrieved_at` arrives absent-or-empty at RUNTIME — the declared `string` type cannot see a
  // parsed-JSON key dropped by `undefined` — is REJECTED HERE, before the event is built: never
  // grandfathered downstream, never a fabricated proof (§6). This is the true scaling gate (the
  // validate-time presence-gate only sees the built value; the input is where the seam opens).
  if (!input.provenance || input.provenance.doc_sha256 === undefined || input.provenance.retrieved_at === undefined) {
    throw new Error(
      `buildReglementEvent(${input.muni}/${input.source_ref}): provenance.doc_sha256 ET retrieved_at REQUIS (preuve v2 réelle, §6, jamais fabriquée) — un event émis, TOUS types, exige une preuve de capture ; provenance/clé ABSENTE (undefined — ex. record JSON-fed dont la clé est droppée) = REFUS, jamais grandfather (une preuve présente-mais-vide est rejetée en aval au validate)`,
    );
  }
  const firstNumber = input.reglement_number.find((n): n is string => typeof n === "string") ?? null;
  return {
    event_id: computeEventId(input.muni, input.source_ref, input.detection_anchor),
    version: 1,
    supersedes: null,
    state: "active",
    muni: input.muni,
    bylaw_numero: firstNumber,
    type: input.type ?? "autre",
    document_type: input.document_type,
    // §10.3 declared-source → canonical token (single canon point). `null` stays `null` (not-populated); a declared term / `"unknown"` is canonicalised.
    type_instrument: input.type_instrument_declared != null ? canonInstrumentType(input.type_instrument_declared) : null,
    reglement_number: input.reglement_number,
    cible_reglement_numero: input.cible_reglement_numero,
    libelles_relation: input.libelles_relation,
    declencheur_type: input.declencheur_type,
    declencheur_date_verbatim: input.declencheur_date_verbatim,
    // §11 PROPAGATE the decision-state input→event (like document_type/type_instrument). Dropping it
    // would emit a planned ODJ item as a bare event = falsely decided downstream (the exact regression).
    decision_state: input.decision_state ?? null,
    date_iso: input.date_iso,
    detection_state: "detected",
    zone_codes_resolus: input.zone_codes_resolus ?? [],
    zone_codes_non_resolus: input.zone_codes_non_resolus ?? [],
    nb_unites_max: null,
    effet_densifiant_ref: null,
    url_pdf: input.url_pdf,
    extrait_brut: input.extrait_brut,
    confidence: 1,
    provenance: {
      producer: "geo",
      source_span: input.provenance.source_span,
      source_url: input.url_pdf,
      as_of_date: input.date_iso,
      sha256: input.provenance.doc_sha256,
      retrieved_at: input.provenance.retrieved_at,
    },
  };
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
const DECLENCHEUR_TYPES: ReadonlySet<string> = new Set(["publication_avis", "certificat_mrc"]);
/** geo emits VERBATIM: a typed relation (replaces/amends) or a derived stage is IMMO's — NEVER emitted here (contract §0/§3). */
const FORBIDDEN_EMITTED_KEYS: readonly string[] = ["replaces", "amends", "lifecycle_stage"];

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

  // ── FROZEN règlement-lifecycle guards — geo emits VERBATIM; immo types/derives ──
  // The load-bearing anti-invention gate: geo NEVER emits a typed relation nor a stage.
  for (const key of FORBIDDEN_EMITTED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(event, key)) {
      throw new Error(
        `zoning-event ${id}: clé interdite '${key}' émise par geo — geo émet du VERBATIM ; il ne TYPE pas les relations (replaces/amends) ni ne DÉRIVE le stage (lifecycle_stage), c'est le rôle d'immo (contrat §0/§3)`,
      );
    }
  }
  // ADDITIVE lifecycle fields (§10.7) are OPTIONAL: `undefined` (a pre-LOT-1 producer omitted it) is
  // the content-default, treated exactly like `null`/`[]`. `!= null` (loose) tolerates undefined+null;
  // array fields are checked only when present. buildReglementEvent always sets EVERY field, so this
  // stays a hard gate for a served LIFECYCLE event; a legacy content event validates unchanged.
  // document_type: string (known OR tolerated-unknown, contract §9) or null/absent — never a non-string.
  if (event.document_type != null && typeof event.document_type !== "string") {
    throw new Error(
      `zoning-event ${id}: document_type invalide (${String(event.document_type)}) — string (connu ou toléré §9) ou null`,
    );
  }
  // §10 : type_instrument = déclaré-source (connu ou toléré §9) OU null/absent ; jamais deviné (§9-tolérant, pas d'enum-membership).
  if (event.type_instrument != null && typeof event.type_instrument !== "string") {
    throw new Error(
      `zoning-event ${id}: type_instrument invalide (${String(event.type_instrument)}) — string déclaré-source (connu ou toléré §9/§10) ou null, jamais deviné`,
    );
  }
  if (event.reglement_number !== undefined) {
    if (!Array.isArray(event.reglement_number)) {
      throw new Error(`zoning-event ${id}: reglement_number doit être une LISTE (verbatim-ou-null par item)`);
    }
    for (const n of event.reglement_number) {
      if (n !== null && typeof n !== "string") {
        throw new Error(
          `zoning-event ${id}: reglement_number porte un item non-verbatim (${String(n)}) — chaque n° est une string verbatim ou null, jamais deviné`,
        );
      }
    }
  }
  if (event.cible_reglement_numero != null && typeof event.cible_reglement_numero !== "string") {
    throw new Error(`zoning-event ${id}: cible_reglement_numero invalide — string verbatim ou null`);
  }
  // §1 table : cible_reglement_numero est RÉSERVÉ à avis_motion (le n° ANNONCÉ, corrélation avis→adoption §4).
  // Sur un document_type lifecycle NON-avis, le n° de règlement de base MODIFIÉ va dans libelles_relation
  // (immo en type amends/replaces) — PAS dans cible (sinon immo mis-corrèle la base comme l'avis-cible).
  if (
    event.cible_reglement_numero != null &&
    event.document_type !== "avis_motion" &&
    typeof event.document_type === "string" &&
    DOCUMENT_TYPE_KNOWN.has(event.document_type)
  ) {
    throw new Error(
      `zoning-event ${id}: cible_reglement_numero='${event.cible_reglement_numero}' sur document_type='${event.document_type}' — cible est RÉSERVÉ à avis_motion (§1 table, corrélation §4) ; le n° de base modifié va dans libelles_relation (immo type amends/replaces), pas dans cible`,
    );
  }
  if (
    event.libelles_relation !== undefined &&
    (!Array.isArray(event.libelles_relation) ||
      event.libelles_relation.some((l) => typeof l !== "string"))
  ) {
    throw new Error(`zoning-event ${id}: libelles_relation doit être une liste de libellés VERBATIM (string)`);
  }
  if (event.declencheur_type != null && !DECLENCHEUR_TYPES.has(event.declencheur_type)) {
    throw new Error(
      `zoning-event ${id}: declencheur_type invalide (${String(event.declencheur_type)}) — 'publication_avis' | 'certificat_mrc' | null`,
    );
  }
  if (event.declencheur_date_verbatim != null && typeof event.declencheur_date_verbatim !== "string") {
    throw new Error(
      `zoning-event ${id}: declencheur_date_verbatim invalide — string verbatim ou null (JAMAIS l'adoption par défaut)`,
    );
  }
  // §11 decision_state — orthogonal axis (owner-ratified): 'planned' | 'decided' | null/absent.
  // ADDITIVE optional (like the other §10.7 fields). ANTI-INVENTION: never a value outside the pair,
  // and a null/absent value is not-populated, NEVER an implicit 'decided'.
  if (event.decision_state != null && !DECISION_STATE_KNOWN.has(event.decision_state)) {
    throw new Error(
      `zoning-event ${id}: decision_state invalide (${String(event.decision_state)}) — 'planned' | 'decided' | null (jamais assumé décidé, §11)`,
    );
  }
  // §6 source-vivante : un event LIFECYCLE geo-émis PORTE sa preuve v2 (url réelle + retrieved_at + sha256).
  // Placeholder/404 = stage FANTÔME interdit ; retrieved_at est une valeur RÉELLE, jamais fabriquée.
  if (event.provenance.source_url.includes("non-disponible")) {
    throw new Error(
      `zoning-event ${id}: provenance.source_url placeholder ('non-disponible') — stage FANTÔME interdit (§6, source vivante exigée)`,
    );
  }
  // Proof-v2 is ADDITIVE (§6 / LOT 1): the LIFECYCLE emitter (buildReglementEvent) ALWAYS carries it, so a
  // PRESENT-but-empty/`null` proof is a hard §6 violation (rejected). A pre-§6 producer (detect-emit dry-run,
  // remediation) that OMITS the keys entirely (`undefined`) is grandfathered — its §6 adoption is a separate
  // task, NOT retroactively broken here. (Same presence-gate as the additive lifecycle fields above.)
  if (event.provenance.sha256 !== undefined && !event.provenance.sha256) {
    throw new Error(
      `zoning-event ${id}: provenance.sha256 manquant — un event lifecycle geo-émis porte la preuve v2 (url+retrieved_at+sha256, §6), jamais une preuve incomplète`,
    );
  }
  if (event.provenance.retrieved_at !== undefined && !event.provenance.retrieved_at) {
    throw new Error(
      `zoning-event ${id}: provenance.retrieved_at manquant — preuve v2 §6 (valeur réelle du manifeste, jamais fabriquée)`,
    );
  }
  // Defense-in-depth (§8 future migration): a TYPED lifecycle event (`document_type` set) MUST carry
  // proof — reject one whose sha256/retrieved_at is ABSENT (`undefined`), which the presence-gate above
  // would otherwise grandfather. Closes the §8 `migrateTypeToDocumentType` path (setting document_type on
  // a legacy proof-less event + re-serving). No main producer sets document_type, so no legacy producer
  // is broken; `document_type=string` survives JSON round-trip, so this stays enforced post-serialisation.
  if (
    event.document_type != null &&
    (event.provenance.sha256 === undefined || event.provenance.retrieved_at === undefined)
  ) {
    throw new Error(
      `zoning-event ${id}: document_type='${event.document_type}' (event lifecycle typé) SANS preuve v2 (sha256/retrieved_at absent) — un event typé porte TOUJOURS sa preuve §6 ; absent = interdit (defense-in-depth §8, pas de grandfather pour un event typé)`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration (§8) — de-conflate the v2.1 `type` into `document_type`, lossless
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Explicit, lossless de-conflation of the old v2.1 `type` (which conflated
 * document + status) into a `document_type` (contract §8). A value mapped to
 * `null` is a pure CONTENT/suspensive event (no lifecycle document_type). Any
 * `type` absent from this table is FAIL-LOUD — never a silent relabel.
 *
 * NB (contract §8): `entree-en-vigueur` maps to the `entree_en_vigueur`
 * document_type ONLY for a document-backed event; a DERIVED en_vigueur (no
 * source doc) is not a geo event and is not migrated here (§2.1 / §6). The
 * predecessor/replaces split and the 3rd branch (same n° + same stage = a v2.1
 * `supersedes`-revision → keep, do NOT reclassify) live on IMMO's projection.
 */
const TYPE_TO_DOCUMENT_TYPE = new Map<ZoningEventType, DocumentType | null>([
  ["projet-reglement", "projet_reglement"],
  ["entree-en-vigueur", "entree_en_vigueur"],
  ["ppcmoi", null],
  ["changement-de-zonage", null],
  ["derogation-mineure", null],
  ["cptaq", null],
  ["consultation", null],
  ["registre-referendaire", null],
  ["retrait", null],
  ["echec-referendaire", null],
  ["refus-mrc", null],
  ["alienation", null],
  ["autre", null],
]);

/**
 * Map a v2.1 `type` to its `document_type` (contract §8, lossless). FAIL-LOUD on
 * an unmapped type (never a silent relabel — the anti-invention lesson).
 */
export function migrateTypeToDocumentType(type: ZoningEventType): DocumentType | null {
  if (!TYPE_TO_DOCUMENT_TYPE.has(type)) {
    throw new Error(
      `migration §8: type v2.1 '${type}' absent de la table de dé-conflation — FAIL-LOUD (jamais de relabel silencieux)`,
    );
  }
  return TYPE_TO_DOCUMENT_TYPE.get(type) ?? null;
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
