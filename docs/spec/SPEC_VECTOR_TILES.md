# SPEC — Vector tiles (lots, zones)

Status: **T1** — built at publication and by the prewarm sweep, published
under `_tiles/`, served by geo-api (`GET /tiles/…`). Code:
`packages/geo/src/tiles/{profiles,geometry,clip,mvt,pmtiles,pmtiles-reader,build,archive,service,build-cli}.ts`,
routes `serveTile` / `serveTileJson` in `packages/geo/src/api/app.ts`, tests
`packages/geo/src/tiles/{tiles,serving}.test.ts`, package export
`@sentropic/geo/tiles`. T0 (prototype, PR #450) is kept below as history where
it still applies.

## T1 decisions (conductor, 2026-11-15)

| # | Decision | Where |
|---|---|---|
| 1 | Zoom range **z12–z15** (maxzoom 15, the client overzooms). Every lot present at z12 (no drop). Property tiers: z12–z13 carry only the feature id + `zoneCode` (lots) / `code` (zones); the full whitelist from z14. | `TILE_DEFAULTS`, `LayerProfile.lowZoomProperties` / `fullFromZoom`, `tierProperties` |
| 2 | Lot feature id = the lot number without spaces (`"5 530 108"` → `5530108`). Missing, non-numeric or duplicated (already used by an earlier feature, source order) → `2^52 + ordinal`, counted in the manifest (`ids`). `noLot` stays a string property at z14+. Zones: ordinal id + `code`. | `FeatureIdAssigner`, `lotNumberId` |
| 3 | Zones output property is `code` only (input alias `zone` → `code` kept, no `zone` output). | `ZONES_PROFILE` |
| 4 | `priorite`, `multifamilial4plus`, `potentialScore`, `fid` are **not** in the tiles: they are computed by immo, which joins them client-side by `noLot` (the feature id carries the identity). | `LOTS_PROFILE`, `ZONES_PROFILE` |
| 5 | Serving `GET /tiles/{collectionId}/{z}/{x}/{y}.mvt` + `GET /tiles/{collectionId}.json` (TileJSON), from a per-collection PMTiles archive read by byte ranges; no build in the serving pod. | § Serving |
| 6 | Publication: the display-mirror writer hook and the prewarm sweep also ensure the tile archive (fresh / adopt / build), version = hash(profile + settings + source sha256), `too-large` = skip with exit 0. | § Publication |
| 7 | Montréal scale (streaming build, compact junction table, streamed PMTiles write, peak RSS < 900 MB). Until it lands, sources over the T1 budgets are refused `too-large` (§ Publication). | second T1 PR |

## Why

The immo map loads whole collections. The display mirror (SPEC_DISPLAY_MIRROR.md)
made one city click a single precompressed read, but its payload grows with the
city: `qc-lots-montreal` is 111 MB Brotli and more than 512 MB decoded, which a
browser cannot parse. Vector tiles bound the payload by the viewport, not the
city. Goal (owner decision 2026-11-13): cadastre visible from z12.

## Requirements

- Layers `lots` (`qc-lots-<slug>`) and `zones` (`qc-zonage-<slug>`), z12 to z15
  (T0: z16).
- **No feature dropping**: every lot is present at z12 (and at every other zoom).
- **Shared-border-aware simplification**: adjacent lots show no gap or overlap.
- Property whitelist per layer (below).
- Node/TS and npm libraries only. tippecanoe is not in the validated stack and
  is not used (no new native binary, no new image).

## Toolchain

| Need | Choice | Version | License | Notes |
|---|---|---|---|---|
| Protobuf encoding of MVT | `pbf` (runtime dep) | 5.1.2 (pinned) | BSD-3-Clause | Mapbox, maintained (2026-07). Deps `resolve-protobuf-schema` 2.1.0 (MIT), `protocol-buffers-schema` 3.6.1 (MIT); all three were already in the lockfile (MapLibre). |
| Tiling, simplification, clipping, MVT layer encoding | own code (`tiles/*.ts`) | — | MIT (repo) | See § Pipeline for why not geojson-vt. |
| PMTiles v3 writer | own code (`tiles/pmtiles.ts`) | — | MIT (repo) | The `pmtiles` npm package only reads. |
| Independent readers (tests only) | `pmtiles` (dev) | 4.5.0 (pinned) | BSD-3-Clause | Protomaps, maintained (2026-08). Dep `fflate` 0.8.3 (MIT). |
| | `@mapbox/vector-tile` (dev) | 3.0.0 (pinned) | BSD-3-Clause | Mapbox, maintained (2026-05). |

Rejected:

- `geojson-vt` 5.0.4 (ISC): simplifies each ring on its own (neighbours keep
  different vertices: gaps/overlaps) and, with a non-zero tolerance, drops rings
  whose area is under tolerance² (lots disappear at low zoom). Both violate the
  T0 requirements; with tolerance 0 nothing is simplified at all.
- `vt-pbf` 3.1.3 (MIT): last release 2021, pinned to `pbf` 3 and
  `@mapbox/vector-tile` 1; the encoder it would replace is ~100 lines.
- tippecanoe: out of the validated stack (see constraint above). Not run, so no
  measured comparison; its relevant flags (`--detect-shared-borders`,
  `--no-feature-limit`, `--no-tile-size-limit`) are what this pipeline
  reproduces. Prior art: `docs/index.html` points at a provincial
  `qc-zones.pmtiles` that was built with tippecanoe in a job; it is not part of
  the served stack.

## Pipeline

Per layer, per zoom z in `[minZoom, maxZoom]`:

1. **Project** every ring once to Web Mercator world coordinates in [0, 1]
   (y down).
2. **Quantize** to the tile pixel grid of z: `round(world × 4096 × 2^z)`;
   consecutive duplicate vertices are removed. A shared vertex lands on the same
   integer point on both sides, so quantization never opens a gap. Grid unit at
   Québec latitudes (46° N): z12 ≈ 1.66 m, z16 ≈ 0.10 m.
3. **Shared-border simplification** over the whole layer: a vertex is a
   junction when it is seen with two different unordered neighbour pairs (the
   set of rings around it changes); every ring is cut at its junctions into
   arcs; each arc is simplified with Douglas–Peucker in one canonical direction
   (smaller first-vertex key), so both rings that share it keep exactly the same
   vertices. A ring with fewer than two junctions (isolated, or a lot filling
   another lot's hole) is cut at its smallest and largest vertex keys, which the
   other ring computes identically. Tolerance: 1 grid unit below `maxZoom`,
   0 at `maxZoom` (quantization only). A ring whose simplified form degenerates
   (< 3 vertices or zero area) keeps its quantized form (`fallbackRings`).
4. **Clip** each polygon to every tile it touches, with a 64-unit buffer
   (Sutherland–Hodgman; intersections rounded from canonically ordered
   endpoints, so both sides of a cut edge agree).
5. **No-drop guarantee**: a feature whose exterior collapses on the grid of z
   (smaller than one unit), or whose every clipped part degenerates, is emitted
   as a one-unit square at its quantized position (`markers`). It stays present
   and queryable; the shift is within the grid's own rounding. The build counts
   `missing` per zoom (features absent from every tile); the CLI exits 1 when it
   is not 0.
6. **Encode** MVT 2.1 (exterior rings clockwise on screen, holes
   counter-clockwise), gzip -9, and write one PMTiles v3 archive (clustered,
   identical tile contents deduplicated, gzip directories, leaf directories when
   the root would exceed 16 KiB).

MVT feature id (T1, decision 2): lots → the lot number as an integer
(`FeatureIdAssigner`, rule `noLot`); fallback `2^52 + ordinal` for a missing,
non-numeric or duplicated lot number (Québec lot numbers have 7 digits, so a
fallback never collides with a lot-number id, and every id is a safe integer for
MapLibre). Zones → the source ordinal (stable for one source version only). The
counts are in the manifest (`ids.fromNoLot`, `missingNoLot`, `nonNumericNoLot`,
`duplicateNoLot`). Measured (T1): rawdon 9 273 lot-number ids, 25 non-numeric;
saint-eustache 15 751 lot-number ids, 285 non-numeric; no missing, no duplicate.

## Properties

A profile is a whitelist. Everything else is dropped from the tiles (the exact
feature stays available through `/items`). A whitelisted property absent from the
source, or null (MVT has no null), is absent from the tile: nothing is invented.

Tiers (decision 1): below z14 a tile carries only the property in the
"z12–z13" column; from z14 on, the full whitelist.

Not in the tiles (decision 4): `priorite`, `multifamilial4plus`,
`potentialScore` (lots) and `fid` (lots and zones). The first three were
`missing source` in every served lot (T0 measurement); they are computed by
immo, which joins them client-side by `noLot` / the feature id.

### `lots`

| Tile property | z12–z13 | Source property (first non-null) | rawdon (9 298) | saint-eustache (16 036) |
|---|---|---|---|---|
| feature id | yes | lot number (see above) | 9 273 + 25 fallback | 15 751 + 285 fallback |
| `noLot` (string) | no | `noLot`, `NO_LOT`, `lot_id` | 9 298 | 16 036 |
| `zoneCode` | yes | `zone_code`, `code_zone`, `zoneCode` | 8 945 | 16 024 |
| `citySlug` | no | derived from the collection id (not a source property) | all | all |
| `tod` | no | `in_tod`, `tod` | key present, null on 100% (`source-gap`) | key present, null on 100% (`source-gap`) |

### `zones`

| Tile property | z12–z13 | Source property (first non-null) | rawdon (119) | saint-eustache (321) |
|---|---|---|---|---|
| feature id | yes | source ordinal | all | all |
| `code` | yes | `zone_code`, `code`, `zone` (alias zone → code; no `zone` output) | 119 | 321 |
| `kind` | no | `kind` | 119 | key present, null on 100% |
| `affectation` | no | `affectation` | `missing source` (no key) | key present, null on 100% |
| `reglementMillesime` | no | `reglement_millesime`, `reglementMillesime` | key present, null on 100% | 321 |
| `citySlug` | no | derived from the collection id | all | all |

`qc-zonage-saint-eustache` holds one feature with a null geometry
(`zone_code: "null"`): it is counted in `skippedNonPolygon` and is not tiled
(320 tiled zones).

## Measurements (T0, z12–z16, every property at every zoom — history)

Source: the public API, `?profile=display` (one read-only request per collection;
geometry rounded to 6 decimals by the display mirror), held in a scratch
directory and deleted after the run. Defaults: z12–z16, tolerance 1, buffer 64,
gzip -9. Node 22, one process per build; peak RSS includes reading and parsing
the source JSON.

### Per collection

| Collection | Features | Build | Peak RSS | Archive | Tiles | Display mirror (br / gzip / decoded) |
|---|---|---|---|---|---|---|
| `qc-lots-rawdon` | 9 298 | 1.26 s | 299 MB | 2.51 MB | 1 217 | 1.84 MB / 2.26 MB / 13.6 MB |
| `qc-lots-saint-eustache` | 16 036 | 2.08 s | 458 MB (275 MB with `--max-old-space-size=160`; aborts at 96) | 3.10 MB | 638 | 3.18 MB / 3.71 MB / 22.2 MB |
| `qc-zonage-rawdon` | 119 | 0.32 s | 145 MB | 0.44 MB | 1 003 | 0.34 MB / 0.39 MB / 1.77 MB |
| `qc-zonage-saint-eustache` | 320 | 0.19 s | 136 MB | 0.31 MB | 666 | 0.14 MB / 0.17 MB / 1.30 MB |

What the client downloads: the whole of Saint-Eustache's lots at z12 is 5 tiles,
403 KB gzip in total (largest 224 KB gzip / 488 KB raw), against 3.18 MB Brotli
(22.2 MB of JSON to parse) for the display mirror. Part of the gain is the
property whitelist (the mirror carries every property).

### Per zoom (tiles · largest tile raw / gzip · total gzip)

| z | `qc-lots-rawdon` | `qc-lots-saint-eustache` | `qc-zonage-rawdon` | `qc-zonage-saint-eustache` |
|---|---|---|---|---|
| 12 | 9 · 246 / 126 KB · 289 KB | 5 · 488 / 224 KB · 403 KB | 8 · 15.6 / 12.5 KB · 28 KB | 5 · 16.9 / 12.3 KB · 22 KB |
| 13 | 23 · 142 / 76 KB · 346 KB | 14 · 417 / 206 KB · 450 KB | 20 · 8.2 / 6.7 KB · 39 KB | 14 · 14.6 / 11.1 KB · 28 KB |
| 14 | 69 · 79 / 43 KB · 420 KB | 41 · 175 / 84 KB · 539 KB | 60 · 4.3 / 3.8 KB · 59 KB | 45 · 5.5 / 4.3 KB · 40 KB |
| 15 | 240 · 30 / 17 KB · 545 KB | 127 · 79 / 39 KB · 680 KB | 199 · 2.8 / 2.5 KB · 99 KB | 133 · 3.1 / 2.6 KB · 65 KB |
| 16 | 876 · 17 / 7 KB · 910 KB | 451 · 37 / 15 KB · 1 028 KB | 716 · 6.8 / 2.4 KB · 222 KB | 469 · 3.6 / 2.4 KB · 168 KB |

No-drop: `missing = 0` at every zoom for the four collections, confirmed by an
independent read-back (reference `pmtiles` reader + `@mapbox/vector-tile`
decoder: unique feature ids per zoom = feature count, every decoded feature a
Polygon/MultiPolygon). Markers (sub-unit lots): saint-eustache 8 at z12, 2 at
z13, 0 above; rawdon 0. Fallback rings: ≤ 7 per zoom (saint-eustache z12).

Lots cost ~50 B raw / 23–27 B gzip per lot in the largest z12 tile.

### Border handling

Metric: length of directed edges without a reverse edge in the layer (grid units
of the zoom) — the outer boundary plus every gap/overlap, and source edges whose
vertices are not shared exactly (T-junctions). Before simplification → after:

| z12 | before | shared-border (default) | per-ring (`--no-shared-borders`) |
|---|---|---|---|
| `qc-lots-rawdon` | 81 742 | 79 662 (−2.5%) | 1 138 910 (×13.9) |
| `qc-lots-saint-eustache` | 52 008 | 48 763 (−6.2%) | 1 030 697 (×19.8) |
| `qc-zonage-rawdon` | 72 625 | 70 185 (−3.4%) | 149 072 (×2.1) |
| `qc-zonage-saint-eustache` | 45 511 | 37 339 (−18%) | 150 904 (×3.3) |

Same pattern at z13–z15 (z16 is not simplified). Shared-border simplification
never inflates the metric (it only shortens the boundary it simplifies);
per-ring simplification multiplies it by 2 to 20. It cannot repair borders that
do not share vertices in the source (T-junctions): those keep the gap the
source already has at that scale (tippecanoe has the same limit). Tests: a
synthetic brick-laid cadastre with jittered shared borders and T-junctions
(per-ring > 2× before, shared ≤ before, every edge of an interior lot matched),
and a lot filling another lot's hole.

### Variants (lots, archive size)

| Variant | rawdon | saint-eustache |
|---|---|---|
| default (z12–16, tolerance 1) | 2.51 MB | 3.10 MB |
| tolerance 2 | 2.45 MB | 3.06 MB |
| max zoom 15 | 1.70 MB | 2.17 MB |
| no simplification | 2.82 MB | 3.39 MB |

z16 is the default max zoom: 0.10 m grid, close to the display mirror's 6
decimals; MapLibre overzooms above it. z15 (0.21 m) saves about one third of the
archive.

### Dense city (Montréal), estimate

Measured read-only from `qc-lots-montreal?profile=index` (bbox centres, 680 087
lots, no geometry): largest tile holds 72 894 lots at z12, 24 098 at z13, 6 957 at
z14, 2 335 at z15, 725 at z16 (41 tiles at z12). At the per-lot cost measured
above, the largest z12 tile would be ≈ 3.7 MB raw / ≈ 1.8 MB gzip, z13 ≈ 1.2 MB /
0.6 MB, z14 ≈ 0.37 MB / 0.18 MB. These sizes are an `unverified` extrapolation
(Montréal was not tiled in T0).

## Archive granularity

One PMTiles archive per served collection (= per city and layer), not one
multi-layer archive:

- it follows the unit of publication and versioning of the display mirror
  (one source object, one ETag, one rebuild when it changes); lots and zones are
  rewritten by different runners at different times;
- a zone re-acquisition does not rebuild the city's lots (the expensive layer);
- immo works city by city; a style adds one source per layer.

Cost: two tile requests per viewport position instead of one. A provincial
multi-city archive is a separate decision (below).

## Storage (T1)

Next to the display mirror and under the same rules (`_`-prefixed keys are
never indexed as collections, ADR-0027), in the store geo-api serves
(`GEO_DATA_URI = s3://<bucket>/normalized`):

```
_tiles/<collectionId>/current.json                       pointer (copy of the manifest), written LAST
_tiles/<collectionId>/<version>/manifest.json
_tiles/<collectionId>/<version>/<collectionId>.pmtiles   PMTiles v3, gzip MVT tiles (Content-Type application/vnd.pmtiles)
```

- `fingerprint = sha256(JSON{profile "tiles-v1", layer profile, build settings})[0:16]`
  (whitelist, tiers, id rule, zooms, extent, buffer, tolerances, gzip level);
  `version = sha256("tiles\n" + fingerprint + "\n" + source_sha256)[0:16]`: it
  changes iff the source bytes, the profile or the settings change.
- Publication order: archive, `manifest.json`, then `current.json`. A reader
  following `current.json` always finds a complete version; an aborted build
  never flips it. Old versions are left in place (no GC, as the display mirror).
- Manifest: `profile`, `fingerprint`, `version`, `collection`, `layer`,
  `source_key`, `source_etag`, `source_sha256`, `built_at`, `features`,
  `skipped_non_polygon`, `minzoom`, `maxzoom`, `bounds`, `fields`,
  `archive {bytes, tiles}`, `ids` (feature id counts), `zooms[]` (tiles,
  missing, markers, max tile raw / gzip bytes, total gzip, max features per tile).

## Publication (T1)

Same freshness rule as the display mirror: fresh = `current.json` exists with
profile `tiles-v1`, the current fingerprint, the served source key and its
current ETag. Otherwise `ensureTilesArchive` (1) **adopts** an existing complete
version of the same source bytes (one read of the source to hash it; only
`current.json` is rewritten — a byte-identical rewrite, or a bucket copy where
the ETag differs), (2) else **builds** (`buildTilesArchive`), or reports
`needs-build` when building is disabled.

- **Writer hook**: `publishDisplayMirror` (every served lots/zonage write in
  acquisition, via `publishDisplayAfterWrite`) ensures the display mirror, then
  the tile archive of the same collection (no adoption: a write changes the
  bytes). Never throws; a failure is logged with `TILES_ARCHIVE_PUBLISH_FAILED`,
  reported in `outcome.tiles` and counted in `displayPublishFailures()`; the
  display mirror and the exact write are unaffected (and vice versa: a display
  failure still tries the tiles). The tile module is loaded on demand, so the
  display hook never depends on the tile builder loading. Opt-out of the tile
  step alone: `GEO_TILES_PUBLISH=0`; `GEO_DISPLAY_PUBLISH=0` turns both off.
  `pbf` is a dependency of the acquisition image (its own lockfile).
- **Prewarm sweep** (`packages/geo/dist/display/prewarm-cli.js`, Job
  `deploy/k8s/display-prewarm/`): per collection, the display step, then the
  tile step, each with its own deadline (`--collection-timeout-ms`). One JSON
  line per collection carries `tiles: {action, version, reason, error, ms}`; the
  summary carries `tiles: {counts, failed, tooLarge}`. `--no-tiles` skips the
  tile step, `--tiles-only` the display step. Exit 1 only for a failure other
  than `too-large` (display or tiles).
- **Preprod sync** (`scripts/geo-preprod-sync.mjs`) copies `_tiles/` with the
  data and adopts the tile archives in the same no-build sweep as the display
  mirrors (summary `display.tiles`).

Budgets (`TilesTooLargeError`, reason `too-large`, refused before any write and
identically on every re-run):

- one source Feature over `TILES_MAX_FEATURE_BYTES` (64 MiB of JSON);
- more than `TILES_MAX_FEATURES` polygon features (T1 builder: 75 000, see
  § Measurements T1 — Laval, 401 594 lots, peaks at 2.1 GB in that builder);
- more than `DEFAULT_MAX_TILE_PAIRS` (2^23) (feature, tile) pairs at maxZoom,
  bbox estimate counted while reading (a polygon spanning a region, or
  coordinates outside the world, would need millions of clips).

The source is streamed (`parseFeatureCollectionStream`, one parsed feature at
a time, `LayerTilesBuilder.add`); the parsed collection is never held.

## Serving (T1)

geo-api never builds tiles. `StoreProvider.openTiles` resolves the served
collection (same index as `/items`), its tile profile, and the published
`current.json` (cached 10 s, like the display mirror); `TileService` reads the
archive by byte ranges (`Store.getRange`: S3 `GetObject` with `Range`, never
the whole object):

- header + root directory: ONE range of the first 16 KiB, once per archive
  version (single-flight, byte-bounded LRU, 8 MiB);
- leaf directory: one range, cached in a byte-bounded LRU (16 MiB);
- tile: one range of its own bytes.

A tile request costs one ranged GET once the version's header is cached (two
when its leaf directory is not), whatever the archive size.

`GET /tiles/{collectionId}/{z}/{x}/{y}.mvt`

| Case | Answer |
|---|---|
| z, x or y not an integer | 400 `InvalidParameter` |
| unknown collection, or a collection without a tile profile (norms, …) | 404 `NotFound` |
| tiled collection without a published archive | 404 `TilesUnavailable` (no lazy build) |
| z outside `minzoom`…`maxzoom` (clients overzoom z15), x/y outside the grid, suffix not `.mvt` | 404 |
| `If-None-Match` matches | 304, nothing read |
| no feature in that tile | 204 |
| archive unreadable | 503 `TilesUnavailable` |
| otherwise | 200, `Content-Type: application/vnd.mapbox-vector-tile` |

Headers (200, 204, 304): `ETag: "<version>-<z>-<x>-<y>"`,
`Cache-Control: public, max-age=31536000, immutable` when `?v=` equals the
current version (content-addressed), else `public, max-age=60`;
`X-Geo-Tiles-Version`, `X-Geo-Tiles-Stale: 1` when the source changed (or is
served from another key) after the version was built, `Vary: Accept-Encoding`.
Encoding: tiles are stored gzip; a client that accepts gzip gets the stored
bytes with `Content-Encoding: gzip`, another one gets them inflated. The MVT
media type is not JSON-family, so the `compressJson` middleware never
re-encodes them.

`GET /tiles/{collectionId}.json` — TileJSON 3.0.0: `tiles` =
`<base>/tiles/<id>/{z}/{x}/{y}.mvt?v=<version>`, `minzoom`, `maxzoom`,
`bounds`, `center`, `vector_layers`, plus `tiles_version`, `tiles_profile`,
`built_at`, `source_sha256`, `features`. `Cache-Control: no-cache`,
`ETag: "<version>-tilejson"` (304), same 404/503 cases.

Alternative not taken: exposing the archive itself (`.pmtiles` with `Range`,
`pmtiles` protocol in the client): less server CPU, but a client library, CORS
on `Range` and CDN caching of byte ranges.

## Measurements (T1)

Same source and method as T0 (public API `?profile=display`, read-only,
streamed into the builder, nothing kept on disk), T1 defaults (z12–z15, tiers,
lot-number ids), T1 in-memory builder, Node 22.

| Collection | Features | Build (after load) | Peak RSS | Archive | Tiles | Max tile gzip z12 / z13 / z14 / z15 |
|---|---|---|---|---|---|---|
| `qc-lots-rawdon` | 9 298 | 0.54 s | 259 MB | 1.60 MB | 341 | 101 / 61 / 44 / 19 KB |
| `qc-lots-saint-eustache` | 16 036 | 1.03 s | 328 MB | 2.00 MB | 187 | 173 / 164 / 86 / 42 KB |
| `qc-lots-laval` | 401 594 | 35.9 s | 2 106 MB | 45.1 MB | 1 367 | 1 213 / 418 / 176 / 67 KB |

Against T0 (z12–z16, every property at every zoom): saint-eustache z12 largest
tile 488 → 321 KB raw (224 → 173 KB gzip), archive 3.10 → 2.00 MB. No-drop:
`missing = 0` at every zoom (markers: laval 369 at z12).

## Archive granularity, open points

- A provincial multi-city archive remains out of scope (one archive per
  served collection, § Archive granularity).
- Garbage collection of old versions: none (as the display mirror).
