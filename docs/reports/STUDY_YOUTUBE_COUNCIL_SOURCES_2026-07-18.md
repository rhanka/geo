# Study — YouTube council-session sources for `qc-zoning-events` v2

Date: 2026-07-18
Status: **No production YouTube ingest is approved.**
Scope: YOUTUBE-STUDY, geo / `qc-zoning-events` v2.1

## Decision summary

`qc-zoning-events` can represent a YouTube-origin event only after it carries a
stable video identity, time-coded evidence, transcript revision provenance, and
an approved content-access/retention basis. The current `youtube-seances`
adapter must **not** be used in production.

This study is an evidence-based architecture recommendation, not legal advice.
No council channel, YouTube API credential, caption, video, audio download, or
Graphify service was invoked for it.

The local code is a useful, mocked prototype but has no production consumer. It
uses an undocumented caption URL, falls back to downloading audio with `yt-dlp`,
and discards VTT timecodes. Graphify is a proposed typed-linking capability, not
verified transcript infrastructure. The safe next action is a governance and
schema decision, followed at most by a metadata-only discovery pilot using the
documented Data API. It must not fetch captions, audio, or video.

## Evidence boundary

**Existing** means verified in this checkout. **Proposed** means a reversible
design, not an implementation. Official web evidence was read on 2026-07-18
from the URLs in [External evidence](#external-evidence); it establishes
platform constraints, not permission for a specific municipal publisher.

## Boundaries and current state

| Concern | Existing evidence | Correct boundary |
| --- | --- | --- |
| Acquisition and neutral semantics | v2 assigns all acquisition, including YouTube, to geo; 4A assigns detection/classification, exact resolution, and serving to geo | **geo** owns qualification, source/candidate ledger, neutral event identity, exact zone resolution, and atomic collection emission. |
| Product and graph writes | v2 says immo reads OGC and is the sole graph writer; 4A keeps Steve UI/filter/scoring in immo | **immo** consumes complete collections and derives Steve relevance; it does not acquire/transcribe sources. |
| Entity extraction/linking | `SPEC_GRAPHIFY_TYPED_LINKING_CAPABILITY.md` is a proposal awaiting Graphify maintainer feasibility and says Graphify stops at typed occurrences, links, and measures | **Graphify**, if accepted, may return versioned/evidenced occurrences only. It does not own source access, event semantics, geography, identity, retention, or serving. |
| Local YouTube code | `packages/qc-sources/src/sources/youtube-seances.ts` exports v0.1.0; repository search finds no runtime consumer and tests inject mocks | `@sentropic/qc-sources` has an **unintegrated prototype**, not an approved source. |
| Raw persistence | `RawDocument.ts` content-addresses bytes by SHA-256 and has minimal adapter provenance | It does not establish permitted access, timed evidence, provider/model version, or expiry/deletion. |

There is no local evidence of a Graphify transcript API, transcript artifact,
quota, model/provider, ownership commitment, or retention policy. `.graphify/`
contains agent cursor/fact files only.

### V2 identity contradiction

The A1 v2 section says `event_id = sha256(muni | source_ref |
detection_anchor)` and forbids moving `bylaw_numero` from identity. A later
“Identity + revision (amendment 2)” section formerly gave
~~`sha256(muni | bylaw_numero | type | date_iso)`~~ (struck 2026-08-24 —
reconciled to the A1 source-anchor formula above; see SPEC_QC_ZONING_EVENTS_V2
amendment-2). The executable
emitter and tests follow A1/source-anchor identity. This study treats A1 as
controlling but does not silently amend the joint geo/immo contract.

That contradiction blocks YouTube production: the bylaw is often unavailable at
first mention, while transcript text and cue placement can later change.

## Existing adapter audit

`youtube-seances.ts` currently:

- accepts only a configured `UC…` ID (not a handle), calls `search.list` over
  183 days, and title-filters before yielding a `videoId`;
- stores `videoId` only in `RawDocumentRef.metadata`; it does not retain the
  returned `snippet.channelId`, ETag, selection reason, or uploader verification;
- calls documented `captions.list` with an API key, then directly requests
  `https://www.youtube.com/api/timedtext?...`;
- deletes all VTT timestamps and globally de-duplicates text, making a v2
  transcript-timecode anchor impossible to construct or audit;
- falls back to `yt-dlp` audio download and injected Mistral Voxtral, but labels
  either result merely `obtentionMode: "transcription"`, without track ID,
  origin, model, segmentation, language, or transcript revision;
- has a timeout only: no quota/page budget, rate limit, `Retry-After` policy,
  permanent-error classification, retention clock, or enforced authorization; and
- has only mocked tests. The referenced `e2e/youtube-seances.live.test.ts` does
  not exist in this checkout.

`voxtral-transcriber.ts` proves only that an audio file can be sent to Mistral
when `MISTRAL_API_KEY` is present. It neither proves audio-download rights nor
creates transcript version provenance, and it is not Graphify evidence.

These are not “fixed” here. Turning them into a crawler before the decisions
below would create an unapproved content-ingest path.

## Discovery and canonical identity

| Object | Canonical value | Purpose | Never use as |
| --- | --- | --- | --- |
| Channel | verified YouTube `UC…` ID | source allowlist/uploader verification | mutable `@handle`, title, or event ID |
| Video | `videoId` | source-document identity | title, short URL, upload time, or playlist position |
| Source reference | `youtube:video:<videoId>` | v2 `source_ref` | raw URL with query/tracking parameters |
| Anchor | `yt:t:<startMs>-<endMs>` from accepted time-coded source | v2 `detection_anchor` | line number, ordinal, or title |
| Transcript revision | SHA-256 of accepted time-coded bytes plus origin/version | reproducibility/revalidation | event identity |

The video ID is the source identity. The channel ID is a strict source
constraint: a fresh `videos.list` response must have
`snippet.channelId === configuredChannelId`, otherwise the candidate is
quarantined. ETags are audit/cache metadata only.

The first accepted anchor is immutable. A later caption/ASR revision cannot mint
a new event ID. It needs a reviewed evidence-continuity link to the existing
event or becomes a review candidate; fuzzy text continuity is forbidden.

Discovery procedure:

1. A human records the municipal page that links to the channel, canonical
   `UC…` ID, review date, named owner, and allowed purpose. A handle is only a
   lookup aid: `channels.list(forHandle=...)` may resolve it, then the ID is
   pinned and independently reviewed.
2. A documented Data API metadata query finds candidates in that allowlisted
   channel. Title terms may prioritize review but cannot exclude videos, or
   recall is unknowable.
3. `videos.list` validates video ID, `snippet.channelId`, availability, and
   metadata before the discovery manifest admits the candidate.
4. Transcript collection is separate and cannot begin until its access route
   passes the authority gate. Metadata discovery does not imply content rights.

## Provenance and concrete contract changes

Plain text is insufficient: the event must answer which content revision was
read, through which authorized route, with which extractor, and where the claim
appears. **Proposed** geo-owned TypeScript contract, subject to joint v2 review:

```ts
export interface YoutubeVideoSource {
  readonly kind: "youtube";
  readonly channelId: string;              // canonical UC… ID
  readonly videoId: string;
  readonly canonicalUrl: string;
  readonly channelVerifiedAt: string;
  readonly metadataEtag?: string;
  readonly discoveredAt: string;
}

export interface TranscriptRevision {
  readonly origin:
    | "municipality-supplied-transcript"
    | "youtube-caption-authorized"
    | "graphify";
  readonly revisionId: string;             // sha256:<time-coded source bytes>
  readonly capturedAt: string;
  readonly language: string;
  readonly format: "webvtt" | "srt" | "json-segments";
  readonly timedTextSha256: string;
  readonly provider?: string;              // required for ASR/Graphify
  readonly model?: string;
  readonly modelVersion?: string;
  readonly accessAuthorizationRef: string; // approval reference, never secret
  readonly retentionReviewAt: string;
}

export interface TimedEvidence {
  readonly startMs: number;
  readonly endMs: number;
  readonly verbatim: string;
  readonly transcriptRevisionId: string;
}

export interface ZoningEventSourceEvidence {
  readonly sourceRef: string;              // youtube:video:<videoId>
  readonly detectionAnchor: string;        // yt:t:<start>-<end>
  readonly source: YoutubeVideoSource;
  readonly transcript: TranscriptRevision;
  readonly evidence: TimedEvidence;
}
```

`ZoningEvent` should persist mandatory immutable `source_ref` and
`detection_anchor`, with source-evidence union data. Validation must require:

```ts
event.event_id === computeEventId(event.muni, event.source_ref,
  event.detection_anchor)
```

The existing function accepts these inputs but the event payload does not retain
them, so its identity cannot be audited. Replace required PDF-specific
`url_pdf` with required generic `source_url`; retain optional `url_pdf` only for
PDF compatibility. Keep `provenance.source_span` as a display summary, but
store the full time range/revision separately under the approved retention
policy.

Graphify may populate `origin: "graphify"` only after it offers an immutable
run/profile version, model/provider provenance where applicable, time-coded
source units, verbatim relocation, and retention/access assertions. The current
proposal does not establish those properties.

## Detection and validation gates

A transcript mention is not a served event. It belongs in a non-served candidate
ledger until every gate passes.

| Gate | Required check | Failure behaviour |
| --- | --- | --- |
| 0 — authority | Reviewed publisher/channel evidence; documented transcript route; copyright, API, retention, privacy owner | Do not collect content. |
| 1 — source integrity | Configured `UC…` equals API video channel; canonical ID/URL and availability recorded | Quarantine candidate. |
| 2 — transcript acceptance | Municipality-supplied or authorized documented route; time-coded bytes, SHA-256, language, access ref, revision captured | Mark unavailable; never fall back to `/api/timedtext` or audio download. |
| 3 — neutral candidate | Deterministic contextual signal for a zoning step preserves exact time range/text | No served event; retain review/negative result for measurement. |
| 4 — evidence/classification | Human verifies pilot recording/excerpt; only v2 neutral taxonomy emitted | Reject or evidence-backed `autre`; never emit Steve relevance. |
| 5 — zone resolution | Resolve against that municipality's served zones only, using documented canonicalization | Non-exact/ambiguous stays unresolved; no fuzzy score. |
| 6 — corroboration | Independently compare PV/avis/bylaw where available; second review for unexplained source-only candidate | Keep in review ledger. A later official source revises payload, not ID. |
| 7 — serving | Validate identity/evidence, versions/tombstones, whole-city completeness, immo compatibility | Do not write `complete:true`. |

Graphify can assist recall only at Gates 3/5 after it has its own versioned,
measured contract. The 4A recall/precision split remains mandatory.

## Recall/precision protocol against PV/avis

1. Select 5–8 municipalities with approved channel access and independent
   PV/avis history. The v2 sample suggests Saint-Raymond, Saint-Stanislas,
   Sutton, Coaticook, Saint-Mathieu-de-Beloeil, and Saint-Eustache; retain only
   cities passing Gate 0.
2. Freeze a dated PV/avis baseline before tuning. Annotators independently make
   gold records: municipality, neutral type, meeting date, genuinely available
   bylaw reference, zone set, and official evidence.
3. Independently annotate accepted time-coded transcript spans and link only
   after both labels are frozen. Include non-zoning agenda items and poor ASR
   samples as negatives. Two reviewers adjudicate source-only candidates.
4. Use a natural-key matcher for *evaluation*, not identity: municipality +
   neutral type + session/official date, then corroborating bylaw and exact zone
   set where present.

Report TP/FP/FN examples and all of:

| Metric | Definition |
| --- | --- |
| Event recall | matched eligible PV/avis baseline events / all eligible baseline events |
| Candidate precision | human-confirmed candidates / all candidates reviewed |
| Auto-accept precision | confirmed automatic accepts / automatic accepts, separate from reviewed precision |
| Mention recall | accepted gold zone mentions found / gold mentions |
| Exact-resolution precision | correct exact resolutions / all exact resolutions, always paired with unresolved rate |
| Per-event zone-set recall | matched resolved zone set / gold zone set |
| Lead-time | meeting/video evidence date minus first PV/avis publication; signal value only, not correctness |
| Drift | transcript revisions changing evidence/classification/review outcome / accepted revisions |

Stratify by municipality, caption/ASR origin, language, duration, source
availability, and transcript quality. Lock a holdout gold set. The v2 95%
event-set recall gate and named misses remain necessary before immo replaces its
existing extraction; production additionally needs a jointly approved precision
floor and a zero-tolerance non-exact-zone test. Those values are intentionally
open decisions.

## ToS, robots, copyright, privacy, and retention

| Risk | Evidence / impact | Required control |
| --- | --- | --- |
| Undocumented endpoint | Current code uses `/api/timedtext`; Developer Policies prohibit undocumented API use without express permission. `robots.txt` disallows `/api/`. | Remove from all production designs. Public availability/robots are not permission. |
| Automated collection/content use | Terms restrict automated service access and content download/reproduction without Service authorization or prior written permission. | No crawler, `yt-dlp`, audio/video download without documented written approval and legal review. |
| Caption access | Official `captions.list` and `captions.download` require authorization; download documents `youtube.force-ssl` and 403 for insufficient permission. | API key alone is insufficient. Obtain channel-owner authorization or municipality-supplied source text. |
| Retention | Developer Policies require deletion/refresh within 30 days for limited non-authorized data and most authorized data, with faster revocation deletion; API terms require deletion on termination. | Inventory and delete/refresh job before content. Cover bytes, metadata, CAS/backups, excerpts, and indexes; obtain legal confirmation for off-API transcripts. |
| Copyright/rightsholders | Public meeting access does not prove a reusable licence; recordings may contain third-party presentations. | Written permission or reviewed lawful basis, attribution, takedown/removal process. |
| Personal information | Meetings may include names, addresses, complainants, sensitive facts, and voices; searchable transcripts increase disclosure. | Privacy impact review, minimization/redaction, access controls, retention/deletion, no broad full-text serving. |
| Source mutation | Captions/metadata/video can change or disappear; current parser loses timing/repeats. | Preserve permitted time-coded revision/hash. Disappearance/revision is review, never a new automatic ID. |
| ASR misattribution | A bylaw, zone, vote, or negation may be misheard. | Human pilot verification, verbatim relocated evidence, exact zone gate, no automatic new-class acceptance. |
| Immo destructive projection | Partial data/changed IDs can orphan records. | Atomic complete outputs, immutable identity persistence, and tombstones. |

## Rate, quota, and cost posture

Official documentation read 2026-07-18 reports:

| Operation | Verified constraint | Consequence |
| --- | --- | --- |
| `search.list` | 100 calls/day and 1 unit in a separate Search Queries quota bucket | The 183-day pagination needs page/run budgets and observability. Extra pages are extra requests. |
| `channels.list` | 1 unit; `forHandle`, `contentDetails`, ETag | Use for controlled handle-to-ID and channel metadata validation. |
| `videos.list` | 1 unit; `snippet.channelId`, ETag | Verify each candidate belongs to pinned channel. |
| `captions.list` | 50 units; authorization required | Current key-only call is not operable as caption strategy. |
| `captions.download` | authorization (`youtube.force-ssl`); may 403 | Content retrieval needs a separate approval/authorization path. |
| `/api/timedtext`, `yt-dlp`, Voxtral, Graphify | no permitted/owned production path or price evidenced for this work | Treat cost as unknown; do not estimate or spend. |

A future authorized metadata client needs per-run page/request budgets, channel
rate limits, classified 400/401/403/404/429/5xx outcomes, bounded retries that
honour server instructions where available, a checkpointed manifest, and a
quota/authorization stop reason. Quota failure must never trigger a
transcription fallback. This study did not create a fleet lane or alter fleet
configuration.

## Reversible staged plan

### 0. Governance, no content

Record channel/source authorization, transcript route, legal/privacy owner,
retention schedule, Graphify contract/version, and joint geo/immo schema
approval. Disable current content paths for production.

Exit: decision evidence, not an API key. Rollback: no content exists.

### 1. Metadata-only registry

Add an allowlisted `YoutubeCouncilSourceConfig` (channel ID, official municipal
evidence URL, reviewer/date, owner) and a documented metadata client. It may
verify channel/video identity but must not request captions, timed text, audio,
or video.

Exit: mocked contract tests plus one authorized bounded metadata validation.
Rollback: remove config and delete retained metadata under approved policy.

### 2. Event/source contract hardening

Implement the proposed types; persist and validate `source_ref` and
`detection_anchor`; make `source_url` generic; retain optional `url_pdf` only
for compatibility. Add a time-coded parser that preserves repeated cues. Do not
add content transport yet.

Exit: identity/provenance tests and geo/immo review. Rollback: additive fields
behind a source feature flag; no YouTube events served.

### 3. Authorized transcript + review ledger

Implement exactly one approved origin (municipality-supplied export or
authorized documented API). Capture time-coded bytes, access reference, hash,
expiry, and bounded evidence. Write neutral candidates to a review ledger only.
Graphify is optional only after meeting the proposed provenance contract.

Exit: human pilot verification and retention/delete drill. Rollback: disable
source config and purge content according to policy.

### 4. Shadow evaluation

Run the frozen PV/avis protocol, publish TP/FP/FN, unresolved zones, drift,
availability, and costs. Keep immo on its current extraction.

Exit: at least 95% eligible-baseline event recall with named misses, approved
precision floor, and no fuzzy resolution. Rollback: delete shadow content per
policy; no consumer rollback is needed.

### 5. Narrow production rollout

Enable one accepted municipality at a time. Require reviewed new events,
atomic complete collection output, source-anchor validation, tombstones, and a
kill switch. Immo does not change until contract acceptance.

Rollback: disable city source; use valid tombstone/revision rather than silently
dropping a previously served identity.

## Tests required before Stage 3

1. Reject handle-only/duplicate/malformed channel config and require municipal
   publisher evidence.
2. With mocked documented API responses, reject missing/mismatched uploader
   channel, duplicate video ID, and deleted/private candidate.
3. Preserve cue start/end, repeated text at different times, original bytes,
   language, and SHA-256 in a time-coded parser.
4. Persist source ref/anchor and reject any event whose recomputed ID differs;
   a new transcript revision cannot mint an automatic new identity.
5. Reject unsupported origins (`/api/timedtext`, audio/video download,
   unapproved Graphify) before any content/network action.
6. Classify authorization, 403/404/429, timeout, quota exhaustion, and source
   deletion with bounded, non-fallback outcomes.
7. Require every evidence time range and quote to relocate in its transcript
   revision; no detector-synthesized quote.
8. Keep exact zone tests; add municipal partition collision and ASR spelling
   fixtures that become unresolved, never fuzzy-resolved.
9. Prove retention expiry/delete/refresh covers raw bytes, metadata, CAS copies,
   and derived full-text indexes.
10. Prove video events obey `complete`, duplicate-ID, tombstone, and atomic
    two-key collection rules.
11. Include PV/avis positives, source-only true/false candidates, revision
    drift, and incomplete extraction in metric fixtures; fail declared floors.

Tests remain network-free through injected documented metadata/transcript
artifacts. Any authorized integration test belongs behind a separate credential
and policy gate, never ordinary CI.

## Open decisions and blockers

| ID | Decision / blocker | Owner(s) | Status |
| --- | --- | --- | --- |
| YT-1 | Which municipality authorizes this purpose, and what exact transcript rights/route apply? | geo principal, municipality/rightsholder, legal/privacy | **blocking** |
| YT-2 | Is channel-owner OAuth acceptable, or must transcripts be supplied by the municipality? | geo, municipality, legal | **blocking** |
| YT-3 | What inventory and retention/deletion schedule covers raw text, metadata, CAS, excerpts, and indexes? | legal/privacy, geo storage owner | **blocking** |
| YT-4 | Resolve v2 identity conflict and approve persistent source/anchor/generic URL/transcript schema. | geo + immo | **blocking for schema** |
| YT-5 | Does Graphify provide a versioned time-coded permission-aware contract, and who owns cost/reliability? | Graphify maintainer + geo | **unknown / blocking for Graphify path** |
| YT-6 | What precision floor, review policy, and source-only-event policy supplement 95% recall? | geo + immo product | **open** |
| YT-7 | Which pilot cities have independent PV/avis baseline and approved channel evidence? | geo acquisition | **open** |
| YT-8 | Is the existing committed verbatim caption fixture acceptable under the selected retention/licensing policy? | legal/privacy + repository owner | **open** |

## External evidence

- [YouTube Data API: search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API: channels.list](https://developers.google.com/youtube/v3/docs/channels/list)
- [YouTube Data API: videos.list](https://developers.google.com/youtube/v3/docs/videos/list)
- [YouTube Data API: captions.list](https://developers.google.com/youtube/v3/docs/captions/list)
- [YouTube Data API: captions.download](https://developers.google.com/youtube/v3/docs/captions/download)
- [YouTube quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Terms of Service](https://www.youtube.com/t/terms)
- [YouTube robots.txt](https://www.youtube.com/robots.txt)
