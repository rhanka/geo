# SPEC_EVOL — Model A : geo comme producteur de zoning-events (track daté, gaté) — v2

Statut : EVOL (design engagé). v2 = incorpore la revue adversariale ≥2 pairs (conformance + risque/repro).
Base : origin/main HEAD `8753af9d` (post-#261 ; #258 LINK-before-RETRACT 100% mergé).
Rien ne capte / ne sert avant owner-go direct (voir §5).

⚠ **SoT = les schémas Zod DU RUNNER**, PAS l'énumération de ce doc. Toute divergence entre ce
doc et `acquisition/src/lib/zoning-event-remediation-runner.ts` / `...remediation.ts` → le CODE gagne.
L2 doit **promouvoir ces schémas en `export const`** (aujourd'hui module-local `const`) et binder les
tests dessus (sinon test vert-par-omission).

## 1. Driver

Complétude-producteur : geo émet les artefacts que le runner #258 consomme pour LINKer / RETRACTer
CHAQUE event → `living_phantoms → 0`. Slices Q1 : 137 phantoms vivants Phase-1 · 71 linkable-now ·
101 edge-missing · (cohorte set-167, voir L1) · 18/22 captures PV. 170 droppé (pas de source).

## 2. Artefacts producteurs (5, pas 4) — SoT = runner

Le runner consomme un artefact TOP-LEVEL + 4 reçus. Set exact :

- **A0 — `zoning-event-remediation-inventory/v1`** (InventorySchema, runner:68) : artefact top-level.
  `cohort_sha256`, `audit_sha256`, `authenticated{origin:literal("immo-extraction"), extraction_ref,
  via:literal("geo-cond"), h2a_envelope_id}`, `cities[].{slug, collection_sha256,
  events[].{event_id, resolution: discriminatedUnion(link{evidence_ref}, retract{exhaustion{...}})}}`.
  Sans lui, PAS de LINK/RETRACT. `authenticated.origin`/`via` = littéraux stricts.
- **A1 — `zoning-event-pv-link-receipt/v1`** (runner:87, `.strict()`) : contract, status:`source-found`,
  **`receipt_key`:ObjectKeySchema** (cross-checké runner:273 contre `evidence_ref.key`), event_id,
  target_bylaw_numero, detector_reglement_numero, source_url, source_span, as_of_date, producer,
  capture_run_ref, capture_manifest_ref, captured_pdf_ref, pv_text_ref, text_extraction_receipt_ref
  (DurableRef {key:ObjectKey, sha256:/^sha256:[0-9a-f]{64}$/}).
- **A2 — `zoning-event-pv-text-extraction-receipt/v1`** (runner:104) : contract, status:`extracted`,
  **receipt_key**, run_id, source_url, captured_pdf_ref, pv_text_ref, extraction_tool, extracted_at:datetime.
- **A3 — `zoning-event-source-no-match-receipt/v1`** (runner:133) : contract, status:`complete-no-match`,
  **receipt_key**, event_id, run_id, source_ref:HttpUrl, captured_object_ref, detector,
  detector_git_sha:/^[0-9a-f]{40}$/, complete:true, matches:[] length 0, extracted_at:datetime.
- **A4 — `zoning-event-extraction-exhaustion-receipt/v1`** (runner:115) : contract, status:`exhausted`,
  **receipt_key**, event_id, capture_run_ref, capture_manifest_ref, `checked_sources[]`(≥1, `.strict()`)
  { source_ref:HttpUrl, outcome:literal("no-source"), `evidence[]`(≥1){ kind:literal("extracted-no-match"),
  manifest_line_index:int≥0, extraction_receipt_ref } }, as_of.

### Binds cross-artefacts IMPOSÉS par le runner (un producteur qui les ignore → city `unknown`)
A1 : `receipt_key`==inventory evidence_ref.key ; source_span occurre byte-for-byte dans pv_text +
contient detector_reglement_numero + `detectGenericPvZonageChange` confirme + target_bylaw_numero ==
bylaw_numero COURANT de l'event (remediation:208-239,367) ; manifest line content_type ⊇ "pdf" (runner:320).
A2↔A1 : run_id / source_url / captured_pdf_ref / pv_text_ref égaux (runner:335-339).
A3 : detector_git_sha == capture-run header git_sha (runner:497, 40-hex) ; captured_object_ref{key,sha256}
== manifest storage_key/sha256 CAS (runner:479-499) ; source_ref == checked source ∧ ∈ manifest url/final_url.
A4 : capture_run_ref/capture_manifest_ref = clés canoniques `capture/_runs/<run_id>/run.json` +
`.../manifest.jsonl` (runner:402) ; run execution="cluster", lane="pv", finished_at≠null, exit_code=0 ;
`manifest.length===run.counts.attempts` ; manifest_line_index PARTITIONNE exactement les lignes PV OK
par source (runner:466) et sur la ville (507) ; as_of == inventory exhaustion.as_of ; checked_sources set
== inventory checked_sources set (516). ObjectKeySchema : pas de `/` initial, pas de `://`, pas de `.`/`..`.

`evidenceForCity` THROW sur un seul reçu malformé → la ville entière passe `unknown` ; `executable`
exige `cities_unknown===0`. **Barre = tout-ou-rien par ville.**

## 3. computeEventId (confirmé)

`sha256(muni|source_ref|detection_anchor)` (zoning-events-emit.ts:155), bylaw_numero EXCLU. SEULE
dérivation event_id du code.

## 4. serveZoningEvents & le GATE (correction d'intégrité)

- `serveZoningEvents(slug, events, {asOf, complete, store})` (emit.ts:375) écrit 2 clés (plat +
  sous-dossier, `normalized/ca-qc-zoning-events/`) via store S3 par DÉFAUT → **NON-GATÉ**. tombstone
  guard = throw si un event_id précédemment servi disparaît ; throw doublon ; valide chaque event.
- **`executeZoningEventRemediation` (remediation:626) = SEULE frontière servie GATÉE**, mais :
  opérationnellement étanche (aucun CLI ne l'appelle, store injecté) + **field-bound sur reader h2a
  INJECTÉ (`assertOwnerGoInH2a`) — PAS de vérif de signature**. Vérifie envelope actor.role=OWNER,
  via=geo-cond, owner_go_direct=true, SHA inventaire+dry-run exacts, session ∈ {live,closed,draining} ;
  re-lit 2 clés==collection_sha256 ; commitWholeSetIfUnchanged.
- ⟹ **Anti-laundering tient par DESIGN+DISCIPLINE, PAS "by construction".** L4 ROUTE toute écriture
  servie (émission-complétude incluse) via la frontière gatée unique ; jamais `serveZoningEvents` nu
  pour link/retract.

## 5. Gating

- L0/Lspec/L1/L2 = PRs build RÉVERSIBLES (revue ≥2 pairs, ≤2 PR).
- L3 capture = go-run cluster **PROCÉDURAL** (pas de gate code ; capturedFetch store:true écrit
  `raw/`+`capture/_runs/`, jamais `normalized/`). Option durcissement : gater store:true sur
  CaptureRunHeader.execution==="cluster".
- L4 serve = via owner-go (routage, §4). PAS "by construction".
- **Exigence ratifiée (geo-archi doc-model §2.3 pt5)** : write-path servi gaté PAR CONSTRUCTION (authz).
  Model A = ROUTAGE (CA3) ; durcissement crypto (signature, module #258 PARTAGÉ) = **LOT/décision-owner
  DISTINCT**, revue dédiée, jamais en douce dans Model A.

## 6. Lots

- **L0** — branche track datée off origin/main.
- **Lspec** — doc-only : fixer UNIQUEMENT la clause-formule `SPEC_QC_ZONING_EVENTS_V2.md:60` (préserver
  amendment-2 version/supersedes/state) ; GARDER ligne 16 + ligne 109 (déjà correctes) ; réconcilier
  `docs/reports/STUDY_YOUTUBE_COUNCIL_SOURCES_2026-07-18.md:51`. Land PRÉ-serve.
- **L1** — cohorte **set-167** (PIN recette autoritaire) : **GO**. `docs/spec/reports/set-167-bprime.tsv`
  (IN main, figé 2026-08-02), colonne `slug` ; `graph_city_slug` = slug S3 `graph/` (double-tiret MRC) ;
  `--expected-count=167`. Re-key des défauts CLI audit-source/dry-run/L3 sur set-167. Cause ENOENT résolue :
  « 127 » = rail vivier-B sur feature-branch NON-mergée (phantom ; 127∩167=39 ; 18-batch 10/10 ∈ 167,
  0/10 ∈ 127) ; « 170 » = `wc -l` (167+3) ; « 124 » = vérité-terrain owner (pas de liste-slugs, non requis).
  Verdict : `docs/reports/recette/COHORT_PIN_VERDICT.md`.
- **L2** — les 5 artefacts producteurs (A0-A4). Conditions : (1) exporter les schémas runner (`export const`) ;
  (2) test de conformance qui pilote l'INGESTION RÉELLE du runner (schémas exportés + toutes les égalités
  cross-artefact §2) sur un SET produit cohérent, pas juste le parse ; (3) fixtures inline committées
  (zéro lecture `work/coverage/`). INDÉPENDANT de L1.
- **L3** — capturedFetchOrThrow, source="pv-index", CAS `raw/pv-index/cas/<sha>.<ext>`, preuve-v2 par
  construction. 18 PV dérivés de l'audit set-167. On-cluster, go-run owner (capture réelle owner-gated).
- **L4** — émetteur complétude routé via owner-go (§4) ; drive living_phantoms→0. Owner-gated.

## 7. Critères d'acceptation (mesurés)

- CA1 — chaque artefact PARSE + satisfait TOUTES les égalités cross-artefact via l'ingestion réelle du
  runner sur un set produit.
- CA2 — preuve-v2 par construction : captureProofFields passe ; refus si redacted/no-CAS.
- CA3 — serve idempotent (2 layouts byte-identiques, tombstone-safe) ; **toute écriture servie via la
  frontière gatée unique** (jamais serveZoningEvents nu pour link/retract).
- CA4 — living_phantoms→0 mesuré (observeZoningEventSources) sur **set-167** (`--expected-count=167`).
- CA5 — aucune capture/serve avant owner-go direct (L3 go-run ; L4 owner-go).

## 8. Décisions

- **Q-COHORT** — RÉSOLU : PIN = **set-167** (recette, committé `docs/spec/reports/set-167-bprime.tsv`). L1 GO.
- **Q-CRYPTO-HARDEN** (ouverte) — durcir le gate #258 (signature vs field-bound reader injecté) = lot
  distinct owner-décision, hors Model A (module partagé).
