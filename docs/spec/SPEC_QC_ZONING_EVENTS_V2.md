# SPEC — qc-zoning-events (served collection) v2.1

Status: v2.1 — immo VALIDATED v2 under 3 adjustments (A1/A2/A3, immo conductor Opus,
2026-07-18); this folds them in. JOINTLY-VERSIONED interface geo (producer) / immo (consumer).
geo serves OGC, immo reads. geo NEVER writes immo's graph (graph_nodes / geo_resolutions) —
immo's `upsertGraphAtomic` is destructive per-muni, single writer = immo.

## What it replaces
immo's `run-geo-mapper` → tables `geo_resolutions` + `geo_unresolved`.

## Identity: event_id is STABLE-AT-DETECTION (A1 — the crux)
immo's destructive projector (delete-not-in-set per ville) means a CHANGING id orphans the old
event, breaks the supersedes chain, and drops the Steve marks attached to it. So the identity
must NOT contain any field that moves after first detection. `bylaw_numero` MOVES (absent in
`detection_incomplete`, resolved later) → it is FORBIDDEN in the identity.
- `event_id = sha256(muni | source_ref | detection_anchor)` where `source_ref` = the stable
  source document identity (notice URL / PV doc id / CPTAQ dossier url / YouTube video id) and
  `detection_anchor` = a stable within-document locator (notice id, PV item ordinal, transcript
  timecode). This is knowable AT first detection and never changes.
- **immo joins on `event_id`** (deterministic, stable), NOT on the moving `bylaw_numero`.
- Resolving `bylaw_numero` later = `version++` on the SAME `event_id`, never a new id.
- An event whose identity cannot be stably anchored is EXCLUDED from the ingestable set (served
  with `detection_state=detection_incomplete` and no stable-set membership), never given a
  volatile id.

## Source scope (owner decision, mutualist principle — geo owns ALL acquisition)
Events are detected from the FULL source, not just avis-publics:
- avis-publics (municipal notices)
- PV corps (council-minutes body — secondary/annex points; the immo finding #368 anti-silence)
- CPTAQ (agricultural de-zoning) → `type=cptaq` (geo already has 48 category=cptaq)
- YouTube council sessions via graphify transcription → detect zoning events in transcript
immo keeps ONLY the Steve relevance filtering on these events.

## Dossier grouping vs revision (A3 — confirmed)
- `bylaw_numero` is a RESOLVED PAYLOAD attribute (with provenance), NOT identity. It is the
  DOSSIER grouping key: it groups the steps of one file (avis-motion → projet → adoption), each
  step being its OWN event (own `type`,`date_iso` → own `event_id`). immo timelines a dossier
  by `bylaw_numero`.
- `event_id` + `supersedes` = REVISION/correction of ONE step (same `event_id`, version++).
- So: different steps of a dossier = different `event_id`s sharing the same resolved
  `bylaw_numero`; a correction of one step = same `event_id`, higher `version`, `supersedes`
  the prior version. `supersedes` NEVER crosses steps.
- `bylaw_numero`: verbatim from the bylaw BODY art.1.1 — NEVER the title/URL/filename number
  (wrong ~1/4, memory reglement-numero-url-trap). May be null until resolved.
- `date_iso`: YYYY-MM-DD.

## Collection completeness + tombstones (A2 — serving contract, not just schema)
Because immo's projector deletes-per-ville what is not in the served set, a partial snapshot
would mass-delete still-valid events. So the SERVED collection carries a completeness contract:
- Collection-level metadata: `as_of` (ISO) + `complete: true|false`. immo projects a ville ONLY
  when `complete: true`; a `false` (mid-refresh partial) is skipped, not applied.
- Per-ville emit is ATOMIC: the whole `qc-zoning-events-<slug>` object is written in one put
  (mirrors the fold-effet-densifiant whole-object write), never feature-by-feature.
- Retracted events stay SERVED as TOMBSTONES (`state=retracted`), never silently absent — so
  immo can distinguish "retracted" (remove cleanly, keep Steve marks) from "temporarily not
  emitted" (a partial/failed refresh). An event that vanishes from the feed while
  `complete:true` is a bug, not a signal.

## Identity + revision (amendment 2 — makes idempotent ingestion possible)
- `event_id`: canonical deterministic = `sha256(muni | bylaw_numero | type | date_iso)`.
  Survives a correction (the tuple is the identity; content changes bump version, not id).
- `version`: monotonically increasing integer.
- `supersedes`: `event_id` of the previous version if this is a correction, else null.
- `state`: `active | corrected | retracted`.
Rationale: immo is the SOLE graph writer and its projector is destructive per-muni. Without
consumable correction/retraction semantics it cannot ingest geo updates idempotently without
clobber. `detection_state` covers DISCOVERY only, not REVISION — both are needed.

## Two-level taxonomy (amendment 3 — the point that makes the transfer real vs fictitious)
geo emits the NEUTRAL SOURCE taxonomy ONLY:
`type ∈ { ppcmoi, changement-de-zonage, projet-reglement, entree-en-vigueur,
derogation-mineure, cptaq, consultation, registre-referendaire, alienation, autre }`
geo does NOT emit any Steve-oriented category (vivier bucket, priority, residential-yes/no).
immo DERIVES the Steve qualification (zonage∩résidentiel, PIIA/dérogation exclusions,
anticipation, score) from this neutral taxonomy. If geo emits neutral and immo derives Steve,
the transfer is REAL; if either side encroaches, it is fictitious.

## Every factual field carries PROVENANCE
`{ producer, source_span, source_url, as_of_date }` — who produced it, from which verbatim span.

## Zone resolution (kills the HC-14 → Compton fuzzy bug)
- `zone_codes_resolus[]`: per resolution `{ zone_code, relation_type: concerns_zone|concerns_lot,
  target_id: <zone_code>, target_type: Zone|Lot, score_confiance, provenance, as_of_date }`.
  `score_confiance = 1.0` ONLY on EXACT match to the served zone_code set (provenance
  `exact_geom`). No fuzzy: a non-exact candidate goes to `zone_codes_non_resolus`, NEVER a low
  score. Replaces `geo_resolutions`.
- `zone_codes_non_resolus[]`: `{ mention_brute, page, raison: no-exact-match|detection-incomplete|ambiguous }`.
  Replaces `geo_unresolved` (immo keeps the recall metric).

## Detection state (discovery, distinct from revision)
`detection_state ∈ { detected | detection_incomplete | no-event }` — lets immo tell a
DISCOVERY gap from a counts-not-extractable case.

## Payload fields
- `nb_unites_max`: integer when verbatim-extractable from the text, else null. geo EMITS it;
  immo WRITES it to the graph (geo never writes the graph).
- `effet_densifiant_ref`: pointer to the served diff on `qc-zonage-<slug>` (zone_code +
  densite_avant/apres). NORMES/VALUES stay on qc-zonage / qc-zonage-norms, NOT in the event.
- `url_pdf`, `extrait_brut` (proof span), `confidence` (global).

## Full served shape
Collection metadata (A2):
```json
{ "as_of": "2026-07-18T02:30:00Z", "complete": true, "muni": "coaticook", "events": [ … ] }
```
Per event:
```json
{
  "event_id": "sha256(coaticook | <ppcmoi-notice-url> | <notice-anchor>)",
  "version": 1,
  "supersedes": null,
  "state": "active",
  "muni": "coaticook",
  "bylaw_numero": "RD-104",
  "type": "ppcmoi",
  "date_iso": "2026-02-11",
  "detection_state": "detected",
  "zone_codes_resolus": [
    { "zone_code": "RD-104", "relation_type": "concerns_zone", "target_id": "RD-104",
      "target_type": "Zone", "score_confiance": 1.0, "provenance": "exact_geom",
      "as_of_date": "2026-07-17" }
  ],
  "zone_codes_non_resolus": [],
  "nb_unites_max": 12,
  "effet_densifiant_ref": { "collection": "qc-zonage-coaticook", "zone_code": "RD-104" },
  "url_pdf": "https://coaticook.ca/.../rd-104.pdf",
  "extrait_brut": "…verbatim span proving the resolution…",
  "confidence": 0.95,
  "provenance": { "producer": "geo", "source_span": "PPCMOI RD-104 p.2",
    "source_url": "https://…", "as_of_date": "2026-07-17" }
}
```

## Reversement (corrected Steve analysis re-projection)
- nb_unites_max: extraction/emission → geo; graph write → immo.
- reglement_number/dossier_ref: shared — geo extracts the reference, immo resolves dossier identity.
- classify events: geo classifies the neutral taxonomy; immo keeps the Steve product qualif.
- dedup: shared — geo dedups at source + stable key; immo does upsert/non-repetition in presentation.
- PV source stubs: geo (acquisition).

## Recall gate before immo unplugs its graphify event extraction
Sample of 5-8 cities where immo has rich DesignationEvents; geo serves qc-zoning-events;
compare event-set recall by natural key; target ≥95%, geo NAMES the misses. immo does NOT
unplug until ≥95%. Proposed sample: saint-raymond (verifies HC→Compton fix) + saint-stanislas
+ sutton + coaticook + saint-mathieu-de-beloeil + saint-eustache (large PV-corps volume).

### v3.4 scoring criterion — SET-RECALL and precision together
The ratified headline is **SET-RECALL**, while the former strict unique-pair score remains
visible in the same gate output for comparison. Its denominator is fixed at **85** immo
`DesignationEvent`s: no event is removed from the denominator when its identity or taxonomy
is not matchable.

For each matchable multiset group
`g = (muni, source_url_norm, date_iso, crosswalked_type)`, where the first three components
are exact and `source_url_norm` uses the gate's existing normalization, compute:

- `matched[g] = min(immo_count[g], geo_count[g])`, therefore `matched[g] ≤ immo_count[g]`;
- `SET-RECALL = Σ_g matched[g] / 85`;
- `precision = Σ_g matched[g] / total_geo_events`;
- `over_split[g] = geo_count[g] − matched[g]`.

`over_split` is evidence for precision only and never improves recall. The only relaxed
component is type: immo `kind` → canonical category → neutral geo type uses the frozen
vendorized `acquisition/src/data/crosswalk-taxonomie.json`. An immo category with no mapped
neutral type (including `piia`, `modification_reglementation` canonicalized to `autre`) and
geo type `autre` create no group; immo events then remain `missed`. This establishes the
frozen current ceiling of 81/85, not an inferred match.

Reference implementation: `setRecallFor` is
`acquisition/src/zoning-events-recall-gate.ts:709`; the unchanged URL normalization is
`normalizeSourceUrl` in `acquisition/src/zoning-events-recall-gate.ts:491`. The output records
SET-RECALL, strict recall, precision, group-level `over_split`, and missed-immo witnesses
together; a recall-only promotion is not permitted.
