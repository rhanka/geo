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
  feature in memory at a time) and holds the outputs compressed.

## HTTP contract

`GET /collections/{collectionId}/items?profile=display|index`

| Case | Answer |
|---|---|
| `profile` not `display` / `index` | 400 `InvalidParameter` |
| `profile` with `bbox`, `offset` or `coordPrecision` | 400 `InvalidParameter` (whole collection, fixed representation) |
| provider without a display mirror (non-store provider) | 404 `NotFound` |
| unknown collection | 404 `NotFound` |
| build or read failure | 503 `DisplayUnavailable` — never the exact geometry instead |
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
failed. Options: `--collections a,b`, `--limit N`, `--no-adopt`, `--no-build`.

Why not through geo-api: the pod builds one mirror at a time under a 500m CPU
limit; about 2150 builds through it would keep its CPU busy for hours and
starve the requests it serves. API mode (`--api <base> --collections a,b`,
read-only `?profile=index` requests, strictly sequential) exists for a bounded
list only and refuses a full sweep.

Estimate (rawdon, 9298 lots: about 40 s on the 500m pod; per-collection overhead
about 2 to 4 s): a full pass at 1 CPU is in the 3 to 6 h range, dominated by the
lots collections. The province-wide lot total is not measured here, so the range
is an estimate.

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
