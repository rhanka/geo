# SPEC — Display mirror (`?profile=display|index`)

Status: implemented (lot M1; publication-time build and prewarm: lot M2). Code:
`packages/geo/src/display/{mirror.ts,service.ts,ring.ts,publish.ts,prewarm.ts,prewarm-cli.ts}`,
route `serveDisplay` in `packages/geo/src/api/app.ts`.

## Why

A city click in immo downloads `qc-lots-<slug>` and `qc-zonage-<slug>` in full.
Serving them from the exact GeoJSON means reading, parsing and re-serializing the
whole exact object on every request (up to 30 s cold in prod, tens of MB on the
wire). The display mirror is a materialized, versioned, lighter representation
of a served collection, built once per source version and served as a
precompressed object in a single store read.

The mirror lives NEXT TO the exact GeoJSON. It never replaces it.

## Layout

Keys are written to the same store geo-api reads, at the store root:

```
_display/<collectionId>/current.json                    pointer (copy of the manifest), written LAST
_display/<collectionId>/<version>/manifest.json
_display/<collectionId>/<version>/items.geojson.br      display geometry, Brotli (q9, text mode)
_display/<collectionId>/<version>/items.geojson.gz      display geometry, gzip -9
_display/<collectionId>/<version>/index.json.br         index (no geometry), Brotli
_display/<collectionId>/<version>/index.json.gz         index (no geometry), gzip
```

- `_`-prefixed keys are never indexed as collections (ADR-0027 rule in
  `storage/canonical-key.ts`).
- `version = sha256("display-p6-v1\n" + source_sha256)[0:16]`: it changes iff the
  source bytes or the profile change. Old versions are left in place (no GC in M1).
- Publication order: the four artifacts, then `manifest.json`, then
  `current.json`. A reader following `current.json` always finds a complete version.

### Manifest

| Field | Meaning |
|---|---|
| `profile` | `display-p6-v1` |
| `version` | see above |
| `collection`, `source_key` | served collection id and exact source key |
| `source_etag` | store identity (S3 ETag) of the source when the build started |
| `source_sha256` | sha256 of the exact source bytes actually read |
| `built_at` | ISO timestamp |
| `features` | feature count |
| `precision_counts` | features per display precision: `"6"`, `"7"`, `"8"`, `"exact"` |
| `fallback_exact` | `precision_counts.exact` (features served with their exact geometry) |
| `artifacts.{items,index}` | `{ bytes, br, gzip }` uncompressed and compressed sizes |

## Profile `display-p6-v1`

### `profile=display` (artifact `items`)

- One `FeatureCollection` with every source feature, in source order.
- Ids and properties copied verbatim.
- Geometry: x/y rounded to 6 decimals (about 5 cm at Québec latitudes);
  consecutive duplicate vertices created by the rounding are dropped, rings keep
  at least 4 positions. No simplification, no vertex removal beyond duplicates.
- Collection members: `numberMatched`, `numberReturned`, `timeStamp` (build
  time), and `display: { profile, version, source_sha256 }`.

### `profile=index` (artifact `index`)

- One Feature per source feature, `geometry: null`, `bbox` computed on the EXACT
  coordinates, properties verbatim. Enough for search, lists, counters and
  camera framing without any geometry.

### Validity ladder (validity by construction)

For each feature, precisions are tried in order `6 → 7 → 8`:

1. Round the geometry at the current precision.
2. For every Polygon / MultiPolygon ring (including inside GeometryCollections),
   test simplicity (`ring.ts`: no two non-adjacent edges touch or cross, collinear
   contact counts as a touch; grid-bucketed, no vertex cap).
3. A rounded ring that is not simple fails the precision ONLY if the exact ring
   was simple (a ring already non-simple in the source is not the rounding's doing).
4. First precision with no failure wins. If all three fail, the feature keeps
   its EXACT geometry and counts in `fallback_exact`.

The simplicity test runs on the very doubles that get serialized, so the verdict
matches the output bytes.

## Freshness

- For lots and zonage, the mirror is built at publication (see
  [Publication](#publication-prewarm)). Otherwise, and as a fallback, it is
  built on the first `profile=display|index` request for a collection (or when `current.json` is absent, malformed, of another profile,
  or for another `source_key`). That request waits for the build.
- Every request compares `manifest.source_etag` with a HEAD of the source
  (`Store.stat`, S3 HeadObject). Both `current.json` and the HEAD result are
  cached in process for 10 s.
- Source changed (ETag differs): the current (old) version is served with
  `X-Geo-Display-Stale: 1` and a rebuild starts in the background. A failed
  background rebuild is logged and retried on a later request.
- Builds are single-flight per collection and serialized globally (one build at
  a time per pod) to bound CPU and memory. The build streams the source (one
  feature in memory at a time) and holds the four outputs compressed, each in
  one growable buffer (no concatenated copy). They are uploaded one at a time,
  smallest first, and each is returned to the OS as soon as its upload settled
  (`Store.put` callers may free the body once the promise settles; an in-memory
  store copies). Peak on `qc-lots-montreal` (680k lots, outputs 111 + 112 + 26
  + 27 MB): see § Prewarm sweep.

## HTTP contract

`GET /collections/{collectionId}/items?profile=display|index`

| Case | Answer |
|---|---|
| `profile` not `display` / `index` | 400 `InvalidParameter` |
| `profile` with `bbox`, `offset` or `coordPrecision` | 400 `InvalidParameter` (whole collection, fixed representation) |
| provider without a display mirror (non-store provider) | 404 `NotFound` |
| unknown collection | 404 `NotFound` |
| build or read failure (incl. a source over the builder's budgets, see § Prewarm sweep) | 503 `DisplayUnavailable` — never the exact geometry instead |
| `If-None-Match` matches the ETag | 304, no body |
| otherwise | 200, `Content-Type: application/geo+json` |

Response headers (200 and 304):

- `ETag: "<version>-<items|index>-<br|gzip>"`
- `Cache-Control: no-cache` (clients revalidate; 304 is cheap)
- `X-Geo-Display-Profile: display-p6-v1`
- `X-Geo-Display-Version: <version>`
- `X-Geo-Display-Stale: 1` when the source changed after this version was built

Encoding: `Accept-Encoding` is negotiated (`br` preferred, then `gzip`); the
precompressed object is streamed as is with `Content-Encoding`. A client that
accepts neither gets the gzip artifact inflated on the fly, without
`Content-Encoding`. `limit` is ignored with a profile (the whole collection is
returned).

## What stays exact

- The exact GeoJSON under `normalized/…` remains the only source of truth. It is
  never rewritten by the mirror.
- Requests without `profile` (pagination, `bbox`, `coordPrecision`,
  `/items/{featureId}`) are unchanged and served from the exact source.
- The lot fiche, per-feature detail, and any computation (areas, intersections,
  effet densifiant, coverage reports) use the exact geometry, never the mirror.
- The index `bbox` is computed on exact coordinates.

## Publication (prewarm)

Goal: the first city click never pays the build. Code:
`packages/geo/src/display/{publish.ts,prewarm.ts,prewarm-cli.ts}`,
`acquisition/src/lib/display-publish.ts`.

Scope: collections `qc-lots-<slug>` and `qc-zonage-<slug>` (not
`qc-zonage-norms-<slug>`; `isDisplayPublishedCollection`). Other collections
keep the lazy build.

### Freshness rule (shared by the hook, the prewarm and the API)

A mirror is fresh when `current.json` exists, has profile `display-p6-v1`,
`source_key` equal to the served source key, and `source_etag` equal to the
source's current ETag. Otherwise `ensureDisplayMirror`:

1. **adopts** an existing complete version built from the same source bytes
   (reads the source once, `version = f(source_sha256)`, all four artifacts
   present): only `current.json` is rewritten with the current ETag. This covers
   a byte-identical rewrite and a mirror copied from another bucket, where the
   ETag differs;
2. otherwise **builds** (`buildDisplayMirror`), or reports `needs-build` when
   building is disabled.

### Served source resolution

Same rule as the serving index, through shared helpers in
`storage/canonical-key.ts`: id = `servedCollectionId(stem, meta.datasetId)`,
canonical keys only, nested beats flat for one stem, otherwise the later sorted
key wins (`preferServedKey`, `servedSourceKeys`). `StoreProvider` uses the same
`preferServedKey`.

### Writer hook (at publication)

Every write of a served GeoJSON under `normalized/` goes through one of:
`putBytes`, `putStream`, `putBytesIfMatch` (`acquisition/src/lib/s3.ts`),
`putServedZoneGeojson`, `putServedZoneGeojsonIfMatch`, `putServedZoneAdditive`
(`acquisition/src/lib/zonage-proof.ts`). Each calls
`publishDisplayAfterWrite` right after the exact object landed. That covers
`lots-enriched-run.ts`, every `zones-*-run.ts` / `zones-*-replace.ts`, the
`t1-*` / `t2-*` builders and every `fold-*` stamp, without a call site of their
own. A `.meta.json` write re-resolves its sibling GeoJSON (the `datasetId`
decides the served id).

The hook resolves the collection without listing the store: it skips a flat key
whose nested twin exists, and a key that loses the tie-break against the source
the current mirror was built from (when that source still exists). A collision
outside this local view is left to the prewarm sweep and, at worst, to the
API's lazy build. The hook builds without adoption (a write almost always
changes the bytes).

Failure policy: the hook never throws. The exact write is done and is neither
rolled back nor blocked. A failure is logged on stderr with the marker
`DISPLAY_MIRROR_PUBLISH_FAILED` and a JSON outcome, and kept in
`displayPublishFailures()` for a runner summary. Repair: the prewarm sweep;
until then geo-api still builds on the first request.

Between the source write and the `current.json` flip (the build time), geo-api
serves the previous version flagged `X-Geo-Display-Stale: 1` and may start its
own background rebuild of the same version. Both writes are identical (same
version keys), so the race costs CPU, never correctness.

Opt-out: `GEO_DISPLAY_PUBLISH=0` (set by `acquisition/vitest.config.ts` for the
unrelated writer tests with fake S3 clients; the hook's own tests turn it on).

### Prewarm sweep (one pass over existing cities)

`node packages/geo/dist/display/prewarm-cli.js --store s3://<bucket>/normalized`
runs ON THE CLUSTER as a Job with the geo-api image and the bucket's credentials
(`deploy/k8s/display-prewarm/{preprod,prod}.yaml`). It lists the store, resolves
every served lots/zonage source with the exact index rule, then calls
`ensureDisplayMirror` per collection, one at a time by default
(`--concurrency`). Idempotent and resumable: a fresh collection costs one GET and
one HEAD, so a re-run after an interruption skips the work already done. One
JSON line per collection, a JSON summary last, exit 1 when any collection
failed for a reason other than `too-large`. Options: `--collections a,b`,
`--limit N`, `--no-adopt`, `--no-build`, `--collection-timeout-ms N`.

Exit status and `too-large`: a source over the builder's budgets (below) is
refused on purpose and is refused identically on every re-run (same bytes, same
budgets), so it does not make the sweep exit 1. It stays visible: counted in
`counts.failed`, listed in `failed`, and listed again in `tooLarge` in the
summary. Any other failure (timeout, read/write error, unknown collection)
still exits 1. Reason: in preprod (2026-11) the Job exited 1 for its single
`too-large` collection, and `backoffLimit: 3` replayed the whole 2152-collection
pass three more times.

Bounded by construction (no collection or S3 call can stall the sweep):

- Per-collection deadline, default 20 min (`--collection-timeout-ms`, `0`
  disables). On expiry the collection is reported
  `{"action":"failed","reason":"timeout"}`, its work is aborted (signal passed
  to the store's streams and writes, checked per feature; `current.json` is
  written last, so no partial mirror becomes current) and the sweep moves on. A
  re-run retries it.
- Every S3 call of a store built without explicit timeouts (writers: this Job,
  acquisition, publish hooks) is bounded by `DEFAULT_S3_HTTP_TIMEOUTS`
  (`storage/s3-store.ts`): connect 10 s, socket inactivity 5 min, request until
  response headers 15 min. A failed call is retried by the SDK
  (`AWS_MAX_ATTEMPTS`). Overrides: `S3_CONNECTION_TIMEOUT_MS`,
  `S3_SOCKET_TIMEOUT_MS`, `S3_REQUEST_TIMEOUT_MS` (`0` = unbounded). geo-api
  keeps its explicit `READ_SERVER_S3_HTTP_TIMEOUTS`.

Without these, the first preprod run (2026-11) sat ~5 h at 0 CPU after
collection 420: the writer client had no HTTP timeout at all, so a request
whose peer went silent never settled (the SDK retries only on an error).

Memory (the same run was first OOMKilled at 1Gi on `qc-lots-montreal`). Peak
RSS of one `qc-lots-montreal` build, Node 22, `--max-old-space-size=768`,
source streamed from a read-only GET, uploads through the real S3 SDK over TLS
to a local sink (no write to any bucket): **1004 MB before, 548 MB after**
(the four outputs, 276 MB compressed, are now held once and uploaded one at a
time; before, they were concatenated next to their chunks and uploaded in
parallel, TLS holding an encrypted copy of each in-flight body). V8 heap stays
under ~65 MB, so `--max-old-space-size` does not drive the peak.

Ring check (the next run was OOMKilled three times in a row at 1Gi on
collection #1535 `qc-zonage-montreal-pum-2050-intensification-affectation`, a
4.8 MB source of 716 features). One 5 729-edge ring has 5 037 edges in a
single cell of the `isSimpleRing` grid (a detailed curve plus four long edges
that set the bbox); the check deduplicated compared pairs with a `Set` of pair
keys, i.e. 12.7 M entries, ~630 MB of heap for a 200 KB feature. The pairs are
now compared once each in the first cell their two rectangles share (no
bookkeeping; typed-array grid), so the compared pairs and the verdict are
unchanged — and so are the artifact bytes and the version. Measured on that
collection (fresh process, same flags): **peak RSS 538 MB before, 213 MB
after**, build 6.0 s → 0.8 s.

Budgets (fail cleanly instead of OOM; `DisplayTooLargeError`, reason
`too-large`):

- one source Feature over `DISPLAY_MAX_FEATURE_BYTES` (64 MiB of JSON), checked
  on the raw bytes before parsing (a build costs ~5x a Feature's JSON);
- one ring with more than `RING_PAIR_BUDGET` (2^27) candidate edge pairs,
  counted before comparing (every ring the previous check could handle stays
  under it: its `Set` was capped at 2^24 entries). A ring whose edge rectangles
  would materialize more than 2^22 grid entries is checked by a sweep over the
  same rectangles (O(n) memory, same pairs).

The prewarm reports such a collection `{"action":"failed","reason":"too-large"}`
and moves on. The API answers 503 `DisplayUnavailable` and replays the refusal
without rebuilding while the source key and ETag are unchanged.

The exact-geometry serving path (`/items`, `/items/:id`, `StoreProvider`) has
its own, lower cap: `GEO_MAX_FEATURE_BYTES` (default `SERVING_MAX_FEATURE_BYTES`,
16 MiB of JSON per Feature), checked on the raw bytes of the validation and
served passes before `JSON.parse`. Measured `JSON.parse` cost of a MultiPolygon
Feature: ~2.9x its JSON text retained, ~3.9x with the source string, plus the
response serialization (~5x in all), and every concurrent request parses its
own copy, against a ~384 MB V8 heap in the geo-api pod. A source over the cap is
answered 503 `FeatureTooLarge` (the request is valid, the server cannot produce
that representation within its memory budget; 413 would blame the request), and
the refusal is cached per key + ETag like the validation verdict, so a repeated
request does not re-read the object. Case: 2026-11-15, two geo-api OOM kills
(`JsonParser::BuildJsonArray`) on
`qc-zonage-montreal-cuvettes-retention-ruissellement-2021`, whose upstream file
(205 MB) holds 4 MultiPolygon Features of 96.6, 61.5, 23.0 and 14.6 MiB.

Which collections the cap refuses is measured, not guessed, by the read-only
feature-size scan (`packages/geo/dist/display/feature-size-scan-cli.js --store
s3://<bucket>/normalized`, Job `deploy/k8s/display-prewarm/feature-scan-preprod.yaml`):
same listing as the prewarm (all served collections by default, `--display-only`
for lots/zonage), same byte count as the cap (`scanFeatureByteSizes`: raw bytes
from `{` to `}`, nothing decoded or retained), one JSON line per collection with
`maxFeatureBytes` and the count of Features over 8 / 16 / 32 / 64 MiB, and a
summary listing the collections over each bound. The store is wrapped read-only
(writes throw).

Why not through geo-api: the pod builds one mirror at a time under a 500m CPU
limit; about 2150 builds through it would keep its CPU busy for hours and
starve the requests it serves. API mode (`--api <base> --collections a,b`,
read-only `?profile=index` requests, strictly sequential) exists for a bounded
list only and refuses a full sweep.

Estimate (rawdon, 9298 lots: about 40 s on the 500m pod; per-collection overhead
about 2 to 4 s): a full pass at 1 CPU is in the 3 to 6 h range, dominated by the
lots collections. The province-wide lot total is not measured here, so the range
is an estimate.

Job resources: prod runs at limits.cpu `1`. Preprod is capped at limits.cpu
`500m` (request 250m, memory limit 1Gi on both): the `geo-preprod` ResourceQuota
`tenant-quota` allows limits.cpu=2, and geo-api 500m + another workload 250m +
the Job 500m + the geo-api rollout surge 500m (maxSurge 1, maxUnavailable 0) =
1750m. At 1 CPU the Job left no room for the surge pod and a geo-api rollout was
refused by the quota. A preprod pass that has to build everything is therefore
slower than the 1 CPU estimate; after a sync most mirrors are adopted, not built.

### Preprod sync

`scripts/geo-preprod-sync.mjs` copies prod's `_display/` with the data. After
the copy it runs the sweep on the destination with `build: false` and
`concurrency: 4`: every copied mirror whose source bytes match is adopted
(re-pointed to the preprod ETag), with no build in the sync pod. Collections left
`needs-build` are listed in the summary (`display.needs_build_sample`) for the
preprod prewarm Job. A display failure is logged and does not change the sync's
exit code. `--no-display` skips the step.

## Out of scope

- Garbage collection of old versions.
- Simplification / tiling.
