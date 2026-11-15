# SPEC — Vector tiles (lots, zones)

Status: **T0 prototype** (build only, nothing served or deployed). Code:
`packages/geo/src/tiles/{profiles,geometry,clip,mvt,pmtiles,build,build-cli}.ts`,
tests `packages/geo/src/tiles/tiles.test.ts`, package export `@sentropic/geo/tiles`.

## Why

The immo map loads whole collections. The display mirror (SPEC_DISPLAY_MIRROR.md)
made one city click a single precompressed read, but its payload grows with the
city: `qc-lots-montreal` is 111 MB Brotli and more than 512 MB decoded, which a
browser cannot parse. Vector tiles bound the payload by the viewport, not the
city. Goal (owner decision 2026-11-13): cadastre visible from z12.

## Requirements (T0)

- Layers `lots` (`qc-lots-<slug>`) and `zones` (`qc-zonage-<slug>`), z12 to z16.
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

MVT feature id = the feature's ordinal in the source collection: the served lots
and zones carry no feature id (measured). It is stable for one source version only.

## Properties

A profile is a whitelist. Everything else is dropped from the tiles (the exact
feature stays available through `/items`). A whitelisted property absent from the
source, or null (MVT has no null), is absent from the tile: nothing is invented.

### `lots`

| Tile property | Source property (first non-null) | rawdon (9 298) | saint-eustache (16 036) |
|---|---|---|---|
| `fid` | `fid` | `missing source` | `missing source` |
| `noLot` | `noLot`, `NO_LOT`, `lot_id` | 9 298 | 16 036 |
| `zoneCode` | `zone_code`, `code_zone`, `zoneCode` | 8 945 | 16 024 |
| `citySlug` | derived from the collection id (not a source property) | all | all |
| `priorite` | `priorite` | `missing source` | `missing source` |
| `multifamilial4plus` | `multifamilial4plus` | `missing source` | `missing source` |
| `tod` | `in_tod`, `tod` | key present, null on 100% (`source-gap`) | key present, null on 100% (`source-gap`) |
| `potentialScore` | `potentialScore`, `potential_score` | `missing source` | `missing source` |

### `zones`

| Tile property | Source property (first non-null) | rawdon (119) | saint-eustache (321) |
|---|---|---|---|
| `fid` | `fid` | `missing source` | `missing source` |
| `code` | `zone_code`, `code`, `zone` (alias zone → code) | 119 | 321 |
| `kind` | `kind` | 119 | key present, null on 100% |
| `affectation` | `affectation` | `missing source` (no key) | key present, null on 100% |
| `reglementMillesime` | `reglement_millesime`, `reglementMillesime` | key present, null on 100% | 321 |
| `citySlug` | derived from the collection id | all | all |

`qc-zonage-saint-eustache` holds one feature with a null geometry
(`zone_code: "null"`): it is counted in `skippedNonPolygon` and is not tiled
(320 tiled zones).

## Measurements (T0)

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

## Proposed T1 (serving) and T2 (publication)

Storage, next to the display mirror and under the same rules (`_`-prefixed keys
are never collections):

```
_tiles/<collectionId>/current.json                 pointer, written LAST
_tiles/<collectionId>/<version>/manifest.json      profile, source_key, source_etag, source_sha256, built_at, per-zoom stats
_tiles/<collectionId>/<version>/tiles.pmtiles
```

`version = sha256("tiles-v1\n" + profile + options + "\n" + source_sha256)[0:16]`.

Serving route (recommended): `GET /tiles/{collectionId}/{z}/{x}/{y}.mvt`, geo-api
reading the archive by HTTP range from the store (header + root directory cached
per version, leaf directories cached LRU, one range GET per tile):

- `Content-Type: application/vnd.mapbox-vector-tile`, `Content-Encoding: gzip`
  (stored gzip; inflated on the fly for a client that does not accept gzip);
- `ETag: "<version>-<z>-<x>-<y>"`; tile URLs carry `?v=<version>` from a TileJSON
  `GET /tiles/{collectionId}.json`, so tile responses are
  `Cache-Control: public, max-age=31536000, immutable`; the TileJSON itself is
  `Cache-Control: no-cache` (revalidated, 304);
- tile inside the archive bounds but absent: `204 No Content`; outside the zoom
  range or unknown collection: `404`;
- `X-Geo-Tiles-Stale: 1` when the source changed after the version was built,
  same freshness rule as the display mirror.

Alternative: expose the archive itself (`/tiles/{collectionId}.pmtiles` with
`Range`), the client using the `pmtiles` protocol. Less server CPU, but it adds a
client library, CORS on `Range`, and CDN caching of byte ranges.

Publication (T2): build at publication through the same writer hook as the
display mirror (`publishDisplayAfterWrite` path), plus a prewarm sweep Job on the
cluster for existing cities, with the display mirror's budgets, deadline and
`too-large` handling.

Scaling work required before Montréal:

- stream the source (the display builder already streams one feature at a
  time): a > 512 MB GeoJSON cannot be `JSON.parse`d in one string;
- compact storage of projected rings (typed arrays) and a junction table that
  does not keep one `Map` entry per vertex across the province (sort-based
  junction detection);
- stream tile data to a temporary object and write header and directories at
  the end (the T0 writer holds the archive in memory).

## Open decisions

1. **Dense cities at z12**: keep "every lot at z12" (Montréal's largest z12 tile
   ≈ 1.8 MB gzip, estimate) or set a per-city minimum zoom by density (for
   example z13 when a z12 tile exceeds N lots), or ship a lighter z12 (feature
   id only, no properties; gain not measured).
2. **Feature id**: source ordinal (stable per version only) vs a stable numeric
   id (for lots, the lot number without spaces, e.g. `5530108`; zones have no
   numeric key). Matters if immo keeps feature state across rebuilds.
3. **Alias zone → code**: implemented as an input alias (a source `zone` feeds
   `code`). If immo expects both `code` and `zone` in the tile, add an output
   alias (≈ 2 B per feature).
4. **Max zoom**: z16 (0.10 m) vs z15 (0.21 m, −30% archive).
5. **Serving**: zxy route (recommended) vs PMTiles range serving.
6. **Requested properties without source**: `priorite`, `multifamilial4plus`,
   `potentialScore`, `fid` (lots), `fid` (zones) — owner of these values to be
   named (immo computation, or a geo enrichment).
