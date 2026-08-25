# Model-A `qc-zoning-events` population — preview (geo-side) for dossier fantômes §4

**Date** 2026-08-24 · **Author lane** geo-pv · **Scope** DRY-RUN / preview only —
zero served write. Read-only S3 probes + #258 tooling (merged, `origin/main`).

> Grounding: `normalized/ca-qc-zoning-events/` is **empty for the cohort** — only 3
> seed munis served (coaticook, saint-eustache, saint-mathieu-de-beloeil); **zero**
> of the ~120 Sélection-B. So the geo-side is not a LINK on existing instances; it
> is **Model A = populate-then-serve**. This preview shows what that population
> looks like and which receipts it needs.

## 1. Construction — one verified-link row → one served `ZoningEvent`

Input row: extraction's enriched map, aligned to `zoning-event-pv-link-receipt/v1`
(126 verified Phase-1 links: 105 bylaw-keyed + 21 PIIA-address-keyed; 11 no-source
held for pass-3). Output: one served `ZoningEvent` (schema v2.1, `zoning-events-emit.ts`).

| Served field (`ZoningEvent`) | Populated from | Notes / anti-invention |
|---|---|---|
| `muni` | `row.muni` (city_slug) | |
| `type` | `map(row.kind,row.etape)` → `ZoningEventType` | mapping below; owned geo-side; unmatched → flagged, never guessed |
| `date_iso` | `row.date_iso` | `YYYY-MM-DD` |
| `bylaw_numero` | `row.bylaw_numero` (verbatim from PV body) | PIIA → `null` |
| `url_pdf` | `row.source_url` | public http(s) PV URL; the field the source-audit tests |
| `provenance.source_url` | `row.source_url` | `== url_pdf` |
| `extrait_brut` | `row.source_span` | verbatim span literally containing bylaw#+date |
| `provenance.source_span` | `row.source_span` | `== extrait_brut` |
| `provenance.as_of_date` | `row.as_of_date` | |
| `provenance.producer` | `row.producer` | |
| `event_id` | `computeEventId(muni, source_ref, detection_anchor)` | **computable at population** (source_ref = the PV ref, now known — unlike the phantom case). `detection_anchor` per `zoning-events-emit.ts` governs identity; confirm when building the Model-A runner |
| `version` | `1` | initial population |
| `state` | `active` | |
| `detection_state`, `zone_codes_resolus/_non_resolus`, `nb_unites_max`, `effet_densifiant_ref`, `confidence`, `supersedes` | detector output / `null` | **null unless verbatim-extractable** (`nb_unites_max` integer only when in text) |

**`kind`+`etape` → `type` mapping (geo owns; validated empirically at population):**
`modification_zonage`/`rezonage` → `changement-de-zonage` ·
`derogation*` → `derogation-mineure` · `ppcmoi` → `ppcmoi` · `cptaq` → `cptaq` ·
`acquisition`/`expropriation` → `alienation` · etape `adoption` → `entree-en-vigueur` ·
`avis_motion`/`projet_reglement`/`second_projet` → `projet-reglement` · `piia` → `autre`.
(`etape` disambiguates `type` where a `kind` spans stages; no served `etape`/`label` field.)

**Reuse (not re-implement):** the planted fields come from #258's
`linkZoningEventSource(event, {url, source_span, as_of_date, producer})`
(sets `url_pdf` + `extrait_brut` + whole `provenance`, `version++`, `validateZoningEvent`).
Model A applies it to a freshly-constructed base event instead of an existing one.

## 2. Serving

`serveZoningEvents(slug, events[], {asOf, complete:true})` writes the COMPLETE
per-muni set atomically to BOTH layouts (`…/qc-zoning-events-<slug>.geojson` flat
AND `…/qc-zoning-events-<slug>/qc-zoning-events-<slug>.geojson` nested; geo-api
serves nested). Tombstone guard: no `event_id` already served may vanish.

## 3. Receipt chain required per event (write-gate, #258 `executeZoningEventRemediation`)

| Receipt ref | Resolves to (geo bucket `sentropic-geo`) | Status |
|---|---|---|
| `capture_run_ref` | `capture/_runs/pv-<…>/run.json` (`lane:pv`, `execution:cluster`, `exit0`) | **EXISTS** — 648 pv-lane cluster runs |
| `capture_manifest_ref` | `capture/_runs/pv-<…>/manifest.jsonl` (line: `url→storage_key→sha256`, http200, `application/pdf`) | **EXISTS** |
| `captured_pdf_ref` | `raw/pv-index/cas/<docSha>.pdf` — **not** `raw/proces-verbaux-<city>/cas/` | **EXISTS** — ~8,919 PV pdfs; prefix reconciliation only (`CAS_KEY_RE` accepts `source=pv-index`) |
| `pv_text_ref` | extracted-text object | **TO MINT** — text pass over existing geo bytes (no recapture) |
| `text_extraction_receipt_ref` | text-extraction receipt | **TO MINT** |

## 4. §4 cost of Model A — reframed

1. **Web / cluster capture of PV bytes: ALREADY DONE.** 648 pv-lane cluster runs
   (execution:cluster, lane:pv, exit0) + ~8,919 PV pdfs on the geo bucket. **No
   recapture** — the costly, capability-bound part is behind us.
2. **CAS keying reconciliation** (`raw/proces-verbaux-<city>/cas/` assumed → actual
   `raw/pv-index/cas/<docSha>.pdf`): free. docSha (sha256 of bytes) is correct and
   layout-independent; extraction's rawRef PREFIX is the only thing to correct.
3. **`pv_text` + text-extraction receipts: TO MINT** — a re-extraction pass over
   EXISTING geo bytes, plus building the `zoning-event-pv-link-receipt/v1` +
   `zoning-event-remediation-inventory/v1` objects.
4. **Population build + serve:** the Model-A runner (reuse `linkZoningEventSource`
   + `serveZoningEvents`; `computeEventId` with the now-known source_ref).

⟹ Model A ≈ **targeted capture of the missing docShas + text-extract + build/serve
the population.** NOT "recapture 120 cities" — but not zero-capture either.

**Exact per-docSha capture coverage (the 126 links resolve to 22 unique docShas —
one council PV sources many events):**

- **PRESENT on geo `raw/pv-index/cas/`: 4/22 docShas → 7/126 links** — sainte-martine
  `8a5d2129` (3), saint-michel `f84e05a8` (2), bouchette `7af1d5d5` (1), east-angus
  `49897adb` (1). Each carries a `.meta.json` (`sourceUrl`, `sha256==docSha`,
  `fetchedAt`, `storageKey`, `provenance`) → receipt-ready modulo text-extract.
- **MISSING on geo: 18/22 docShas → 119/126 links, all direct-PDF minutes** — all
  sainte-clotilde (3), 5/6 sainte-martine, all 4 saint-jean-sur-richelieu, 3/4
  saint-michel (incl. `f810db14`, which now backs 3 links after the weak-calendar
  fix), labelle, saint-raymond, nantes. These need a **targeted pv-lane cluster
  capture** of the 18 known PV URLs onto the geo bucket (one small bounded run;
  static PDFs), then text-extract + receipts.
- **nantes `74f549b9`**: was missing + `source_url` null; extraction recovered the URL
  (real minutes PDF at `municipalites-du-quebec.com/nantes/…`) → now a clean
  direct-PDF capture target.
- **Correction to an earlier optimistic read:** the ~8,919 PVs already on geo are a
  DIFFERENT set (the geo pv-lane captured other PVs); overlap with extraction's
  verified 22 is only 4. The cluster pipeline + substrate exist (cheap to run), but
  18 specific docShas are not yet on geo.

**Source kind (by CONTENT, not filename), per LINK: 125 links = minutes · 1 link =
agenda** (the single east-angus event, docSha `49897adb`, already on-geo). No weak or
calendar sources remain — the earlier `0759c63e` calendar was dropped when its 2 PIIA
links (853 chemin Rhéaume, saint-michel) re-probed to a real minutes PV (`f810db14`).
Filenames mislead — sjsr's `ordre-du-jour` PDFs contain the adoption resolutions, so
they are minutes by content. Per-LINK `source_kind` rides each event's receipt so the
owner sees the one agenda-sourced row distinctly; every other row rests on the
adoption minutes.

## 4a. Proof-v2 verdict (evidence-settled) — bytes are proof-by-construction, not C-4 backfill

An adversarial synthesis pass read the proof-v2 chain as **0%** (`capture/`=0,
`raw/`=0, `capturedFetch` inexistant → keying existing bytes = a rule-**C-4**
backfill that does not count as proof). Confronted with the code, that is wrong on
the byte layer and right (for the wrong reason) on the receipt layer:

- **`capturedFetch` EXISTS** — `packages/qc-sources/src/capture/capturedFetch.ts:207`,
  the C-0 chokepoint. It fetches bytes AND emits SHA-pinned proof in one pass: the
  CAS object, its `.meta.json`, a `manifest.jsonl` line carrying
  `url`+`http_status`+`retrieved_at`+`sha256` measured on the wire, and `run.json`.
  There is no separate "receipt" object — that output IS the proof.
- **The pv-lane cluster job runs it at fetch time** — `capture/worklist.ts:119`,
  `source:"pv-index"`. So `raw/pv-index/cas/` + `capture/_runs/pv-*` were written by
  the chokepoint, on the wire.
- **The v2 triplet is mechanical from the manifest** — `captureProofFields`
  (`manifest.ts:338`) / `proofFromCaptureEntry` (`zonage-proof.ts:120`) take
  `url`+`retrieved_at`+`sha256` verbatim from a manifest line (refuse redacted /
  byte-less). CLAUDE.md's "le manifeste de capture EST la preuve v2" holds here.
- **`CAS_KEY_RE` accepts `pv-index`** — `manifest.ts:52` (open source class); the
  runner asserts only the sha match, not `proces-verbaux-<city>`. `captured_pdf_ref`
  points at `raw/pv-index/cas/<sha>` verbatim — keying is free.
- **Rule C-4 disqualifies ONLY `backfilled:true` entries** —
  `SPEC_CAPTURE_ON_CLUSTER.md:540-543,653`. That flag is set exclusively by the
  retro-remount path for pre-existing LOCAL files whose fetch instant is unknowable
  (§6.3). A live `capturedFetch` capture carries no `backfilled` field
  (`RawDocument.ts:54-60`). ⟹ live pv-lane captures are proof-by-construction, **not**
  C-4 backfills.

**⟹ Verdict.** The byte layer is proof-v2 **by construction** — the 4/22 on geo are
proof-grade now, and the 18/22 missing get proof-grade via the SAME chokepoint (a
targeted pv-lane `capturedFetch` run onto geo). The genuine gap is the **#258
receipt-emitter layer**: the three receipt contracts
(`zoning-event-pv-link-receipt/v1`, `zoning-event-pv-text-extraction-receipt/v1`,
`zoning-event-source-no-match-receipt/v1`) are DEFINED + CONSUMED
(`runner.ts:87-114,259-342`) but have **no producer** anywhere — TO BUILD:
(a) a proof-emitting PDF→text primitive (durable `pv_text` object + text-extraction
receipt; `extractNativeDocumentText` exists but only classifies in-memory,
`pv-capture-octets-run.ts:117`), and (b) the LINK / no-match receipt builders that
bind the existing `run.json` + `manifest.jsonl` + `raw/pv-index/cas/…` PDF + `pv_text`
to the detected regulation span. NOT a recapture; NOT a C-4 backfill.

## 5. Discipline (held both surfaces)

- bylaw# + date must appear **literally** in the PV bytes (verified for the 126;
  `source_span` verbatim). Base-zoning = **labeled FLOOR** fallback, never an
  amendment's source. RETRACT only after exhaustion — the 11 no-source
  (sainte-martine 7 / saint-michel 3 / sainte-clotilde 1) are retract-candidates
  deferred to pass-3, **not populated**.
- règlements = HOLD (owner dossier). Signals only. **Zero served write** without a
  direct owner write-go via geo-cond (phased, 120 first).
- This week's owner-visible fix is **Model B** (immo projection materializes the
  refs, does not touch `qc-zoning-events`). Model A is the durable target, gated on
  the owner B→A decision + the receipt chain above.

## Reproducibility

Read-only diagnostic probes (geo bucket, `lib/s3` only, no workspace build):
`_pv-zoning-events-populated-probe.ts` (populated/empty),
`_pv-capture-receipt-substrate-probe.ts` + `_pv-substrate-pvlane-probe.ts` (capture
substrate), `_pv-manifest-layout-probe.ts` (manifest storage_key layout),
`_pv-docsha-coverage-probe.ts` (the 4/22-on-geo · 18-to-capture coverage). All under
`acquisition/src/`, run with `NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.

**Companion artifact:** `pv-zoning-events-model-a-capture-worklist-preview-20260824.json`
— the 18-target pv-lane capture worklist (`PvCaptureTarget` shape) + per-docSha
expectations (sha256 + CAS key + source_kind + links_backed) for Model-A step 2.
Labeled NOT-executed (owner-gated).
