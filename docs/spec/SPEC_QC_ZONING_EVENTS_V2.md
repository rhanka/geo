# SPEC — qc-zoning-events (served collection) v2

Status: FROZEN v2 for immo validation. This is the JOINTLY-VERSIONED interface between geo
(producer) and immo (consumer). immo gave GO on v1 + 3 amendments (adversarial review codex
5.6-sol); this folds them in. geo serves OGC, immo reads. geo NEVER writes immo's graph
(graph_nodes / geo_resolutions) — immo's `upsertGraphAtomic` is destructive per-muni, single
writer = immo.

## What it replaces
immo's `run-geo-mapper` → tables `geo_resolutions` + `geo_unresolved`. immo joins on the
NATURAL KEY, not on any graphify node_id.

## Source scope (owner decision, mutualist principle — geo owns ALL acquisition)
Events are detected from the FULL source, not just avis-publics:
- avis-publics (municipal notices)
- PV corps (council-minutes body — secondary/annex points; the immo finding #368 anti-silence)
- CPTAQ (agricultural de-zoning) → `type=cptaq` (geo already has 48 category=cptaq)
- YouTube council sessions via graphify transcription → detect zoning events in transcript
immo keeps ONLY the Steve relevance filtering on these events.

## Natural key (stable, immo joins on this)
`{ muni, bylaw_numero, type, date_iso }`
- `bylaw_numero`: verbatim from the bylaw BODY art.1.1 — NEVER the title/URL/filename number
  (wrong ~1/4, memory reglement-numero-url-trap). May be null (some events carry no number).
- `date_iso`: YYYY-MM-DD.

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

## Full served shape (per event)
```json
{
  "event_id": "sha256(...)",
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
