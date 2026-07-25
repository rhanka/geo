# GeoMap WebGL — design & implementation spec

- **Status**: draft for double 4.8 review (phase 1 = SPEC of ADR-0014 / P-dataviz)
- **Date**: 2026-06-14
- **Scope**: WebGL `GeoMap` in `@sentropic/geo-ui-svelte` + the `geo.sent-tech.ca` dataviz showcase.
- **Authority**: ADR-0014 (`docs/decisions.md:188`). Reversible boundary with dataviz/DS, confirmed async via h2a.
- **Non-goals (this doc)**: no code, no package edits, no git. This spec feeds review → build → publish → deploy.

---

## 1. Context & what we replace

The current `geo-ui-svelte/src/GeoMap.svelte` is a MapLibre placeholder: a single background layer (no basemap), three generic layers (fill/outline/circle), `fitBounds`, no legend, no search, no detail, no interactivity beyond pan/zoom. Props are `{ data: AdminFeatureCollection; height?: string }`. It must be replaced.

immo's `SignauxMapView.svelte` is the production reference we replace (`radar-immobilier/ui/src/lib/components/maps/`): MapLibre GL v5 + **OSM raster** (`tile.openstreetmap.org/{z}/{x}/{y}.png`) + a bubble "choropleth" (circle radius/colour ∝ `signalCount`, pre-baked in feature `properties.color/.radius`) + a 4-tier French legend ("6+ signaux"…"Aucun signal"). `CadastreMapView.svelte` is the richer "carte de Steve" target: polygon fills via `interpolate` on `potentialScore`, zone/TOD overlays, a `LotFichePanel` detail panel. Ontology types `"Signal" | "DesignationEvent"` exist in the data (`node.type`) but are **never shown raw** — only `node.label`. This is exactly the agnostic contract ADR-0014 demands.

Two anchors set the architecture:

- **graphify** (the user's quality bar) renders via a **custom typed-array engine** (`@sentropic/graph`, Canvas2D primary with a WebGL2 attempt/fallback) and gets its "fluidity" from *interaction-state management*, not raw GPU: edges/labels are culled during pan/zoom/drag and restored on settle (`GraphCanvas.svelte`, `EDGE_SKIP_THRESHOLD`). Its UX (left-rail search/filter, always-visible community legend with colour swatches, click-to-expand `EntityPanel` with metadata + citations) is the layout template — but adapted to **on-top overlays**, not a 3-column rail, per the user's "search on top like graphify" note.
- **DS already ships a `GeoMap`** (`components-svelte/src/lib/GeoMap.svelte`, 754 lines) — but it is a **static SVG projection renderer** (`<svg viewBox>`, `<path>`/`<circle>`, equirectangular|mercator, no tiles, no pan/zoom). Its layer taxonomy — `geojson | choropleth | points | density | flow | hexbin | cluster` — is explicitly aligned with `dataviz-core` shapes (`GeoMapFeature`, `GeoMapPoint`, `values: Record<id,number>`). **This is the dataviz boundary.** geo's WebGL `GeoMap` is the *interactive, basemap-backed, road-aware* sibling that **reuses the same layer vocabulary**, so a consumer can swap the SVG sparkline for the live map with the same data.

---

## 2. Decision 1 — Rendering tech: **MapLibre GL JS (vector) + deck.gl overlay**

**Decision: MapLibre GL JS v5 for the vector basemap + camera, with deck.gl (`@deck.gl/core` + `@deck.gl/layers` + `@deck.gl/mapbox` `MapboxOverlay`) as the WebGL data-layer engine.** Not a graphify-style custom engine; not MapLibre-only; not bare deck.gl.

Rationale against the ADR criteria:

| Criterion | MapLibre+deck.gl (chosen) | MapLibre-only (vector) | Bare deck.gl | Custom (regl/three) |
|---|---|---|---|---|
| Fluid WebGL, replaces raster | ✅ both engines GPU | ✅ | ✅ | ✅ but we build everything |
| Vector basemap | ✅ MapLibre native | ✅ | ✗ needs MapLibre/Mapbox anyway | ✗ |
| Choropleth | ✅ deck `GeoJsonLayer`/`PolygonLayer` | ✅ data-driven `fill-color` | ✅ | build |
| **Data on linear features (roads)** | ✅ deck `PathLayer`/`TripsLayer`, per-vertex colour, width-in-meters, offset | ⚠️ `line-gradient` only along one feature, awkward joins | ✅ | build |
| Svelte 5 runes | ✅ thin `onMount` wrapper, `$effect` syncs props→layers | ✅ | ✅ | ✅ |
| Bundle size | ⚠️ ~250-330 KB gz (MapLibre ~210 + deck core/layers ~120) — acceptable, lazy-loaded | ✅ ~210 KB | ⚠️ ~150 KB but loses basemap | ✅ smallest, ✗ most code |
| SSR/prerender safety | ✅ both `window`-bound → dynamic import in `onMount`, guarded | ✅ | ✅ | ✅ |

The deciding factor is the user's "richer than today / carte de Steve" + **linear-feature projection** requirement. Pure MapLibre style expressions make per-vertex data-on-roads and polygon choropleth feasible but rigid; deck.gl's layer model gives clean, declarative, reactive layers (`accessors` over GeoJSON `properties`) that map 1:1 onto the DS/dataviz layer taxonomy and onto immo's pre-baked properties. MapLibre stays because we need a *real vector basemap with a camera* (graphify has no geographic basemap, so its custom engine is not a precedent here). `MapboxOverlay` interleaves deck layers into MapLibre's WebGL context (shared depth buffer, single canvas) — no second canvas, no z-fighting.

**Fluidity technique (from graphify):** adopt the cull-on-interaction pattern. On `movestart`/drag, drop label layers and any per-feature hover decoration; restore on `moveend` (debounced ~150 ms). deck handles 10⁴–10⁵ features at 60 fps; the cull is for label/DOM overlays, not the GPU layers.

**Where it consumes `@sentropic/dataviz` primitives (ADR-0014 boundary):**
- geo **owns** the WebGL map (MapLibre+deck, camera, basemap, tile serving, road projection, interaction).
- geo **reuses dataviz/DS vocabulary**: the same layer-type names and feature/point/choropleth-`values` shapes as DS `GeoMap` (§ above). Colour ramps, hexbin/cluster binning, points min/max-radius defaults (5/14) should **call into `@sentropic/dataviz` (dataviz-core) helpers** if/when exported (binning, colour-mix intensity, value→radius scales) rather than re-implementing — flagged as an open question to the dataviz conductor (does dataviz-core export these as framework-free functions?). Until confirmed, geo vendors thin local equivalents behind a `// dataviz-boundary` comment so they can be deleted when dataviz exports land.
- **Drumbeat to design-system** (not built in geo): search-on-top, the legend/bubble overlay chrome, app chrome. See §4.

---

## 3. Decision 2 — Basemap vectoriel

**Decision: self-host vector tiles as a single PMTiles archive served by geo (the API / static origin), with a geo-authored MapLibre style.**

- **Tiles**: build a **PMTiles** archive (`planetiler` from an OSM extract, or reuse OpenMapTiles schema). PMTiles is a single static file with HTTP range-request reads — **no tile server process**, serveable from object storage / GitHub Pages / the geo origin behind a CDN. This fits the existing static-site + S3 posture (geo data already lives in `s3://sentropic-geo/normalized`).
- **License**: OSM is **ODbL**. We ship **a build recipe + the source URL/attribution only**, never the derived `.pmtiles` in the repo or npm (consistent with `docs/licenses.md` and the geo "recipe not data" rule). Attribution "© OpenStreetMap contributors" is rendered by the existing DS `AttributionBar` / MapLibre attribution control. The PMTiles artefact is produced by a CI/CronJob step and uploaded to the tile origin, exactly like the `geo fetch` data job.
- **Style**: a minimal, token-aware MapLibre style JSON authored in geo (`geo-ui-svelte` ships a `defaultStyle(tokens)` factory) reading `--st-*` surface/line colours so the basemap matches the active DS theme (incl. theme-quebec) and dark mode. Glyphs/sprites self-hosted alongside the PMTiles (no `demotiles.maplibre.org` dependency — immo's current glyph URL is a demo and must not ship).
- **Phase-1 fallback**: if PMTiles build slips, ship a free hosted vector style (e.g. a keyed provider) behind a `styleUrl` prop, but the default and the target is self-hosted PMTiles for licence cleanliness and offline-tolerance. The current placeholder's "empty background, data carries meaning" mode stays available via `basemap="none"`.

geo **serves** tiles by exposing the PMTiles URL from the same origin as `geo.sent-tech.ca` (static) and/or the geo-api (k8s). A tiny range-capable static route is enough; no MapLibre/Martin tile server needed.

---

## 4. Decision 3 — Component API (`GeoMap`, `@sentropic/geo-ui-svelte`, Svelte 5 runes)

Ontology-agnostic: the **consumer** (immo) passes labelled+coloured categories and a **detail schema**; geo renders. Reuses the DS/dataviz layer-type vocabulary so the layer arrays are interchangeable with the SVG `GeoMap`.

```ts
// ---- Categories: the ONLY taxonomy geo knows. No ontology classes. ----
export interface GeoCategory {
  id: string;            // join key, matches feature.properties[categoryKey]
  labelFr: string;       // user-facing FR label, e.g. "Changement de zonage"
  color: string;         // resolved hex OR a --st-* var; geo never invents colour
  level?: string;        // optional grouping/hierarchy id (see detail levels)
  shape?: GeoMarkerShape; // dot|diamond|square|triangle (graphify-style glyphs)
}

export type GeoLayerSpec =
  | GeoGeojsonLayer        // polygons|lines|points, tone or per-feature category
  | GeoChoroplethLayer     // polygons + values:Record<id,number> → intensity ramp
  | GeoPointsLayer         // pins, radius ∝ value (min/max), category colour
  | GeoLinearLayer;        // NEW: data projected onto linear features (roads)

interface GeoLayerBase {
  id: string;
  labelFr: string;         // legend label for the layer
  source: GeoSourceRef;    // OGC collection ref OR inline FeatureCollection
  visible?: boolean;
  categoryKey?: string;    // properties field → GeoCategory.id (default "category")
}
interface GeoGeojsonLayer  extends GeoLayerBase { type: "geojson"; }
interface GeoChoroplethLayer extends GeoLayerBase {
  type: "choropleth";
  valueKey: string;        // numeric properties field to colour by
  ramp?: GeoRamp;          // {tone|baseColor, domain?, steps?}; default dataviz intensity
  legendBins?: GeoLegendBin[]; // explicit FR bins ("6+ signaux"...) override auto
}
interface GeoPointsLayer extends GeoLayerBase {
  type: "points"; valueKey?: string; minRadius?: number; maxRadius?: number; // 5/14
}
interface GeoLinearLayer extends GeoLayerBase {  // ROADS
  type: "linear";
  valueKey?: string;       // colour ∝ value along the path (per-vertex if array)
  width?: number | { key: string; min: number; max: number }; // metres
  offset?: number;         // lateral offset px, to lay data beside the road
}

// ---- Data sources: live OGC fetch or inline ----
export type GeoSourceRef =
  | { kind: "ogc"; collection: string; bbox?: GeoBounds; limit?: number } // /collections/{id}/items
  | { kind: "inline"; data: FeatureCollection };

// ---- Detail schema: consumer declares WHAT to show, geo renders the panel ----
export interface GeoDetailSchema {
  titleKey: string;                 // properties field for the panel title
  fields: GeoDetailField[];         // ordered rows
  levels?: GeoDetailLevel[];        // user-selectable level(s) to display (NOT just creation)
  citation?: { textKey: string; pdfUrlKey?: string }; // citation + PDF link
}
export interface GeoDetailField {
  key: string; labelFr: string;
  format?: "text" | "date" | "number" | "badge" | "link";
  level?: string;                   // gates field to a selected level
}
export interface GeoDetailLevel { id: string; labelFr: string; default?: boolean; }

// ---- Component props (runes) ----
export interface GeoMapProps {
  layers: GeoLayerSpec[];
  categories: GeoCategory[];        // union of types → drives the always-on legend
  detailSchema?: GeoDetailSchema;
  apiBaseUrl?: string;              // OGC API origin; default geo.sent-tech.ca
  basemap?: "vector" | "none";      // default "vector" (PMTiles); "none" = data-only bg
  styleUrl?: string;                // override basemap style
  bounds?: GeoBounds; center?: GeoMapCoordinate; zoom?: number;
  height?: string;                  // default "480px"
  search?: boolean | { placeholderFr?: string }; // search-on-top, default true
  legend?: boolean;                 // always-visible legend, default true
  labelFr?: string;                 // aria-label
  // events (callback props, Svelte-5 style):
  onfeatureclick?: (f: GeoFeatureHit) => void;
  onfeaturehover?: (f: GeoFeatureHit | null) => void;
  onviewchange?: (v: { bounds: GeoBounds; zoom: number }) => void;
}
export interface GeoFeatureHit { layerId: string; id: string; properties: Record<string, unknown>; }
```

Notes that pin the contract:
- **FR everywhere**: every user-facing string is `*Fr` and supplied by the consumer; geo ships no English/ontology fallback. Counts render via consumer-formatted labels ("3851 signaux").
- **Legend = union of `categories`, always visible** (`legend !== false`), readable FR labels + colours + glyphs. Choropleth layers add their `legendBins`. This is the immo 4-tier scale generalised.
- **Detail panel** opens on `onfeatureclick`, driven by `detailSchema`: title + fields + citation (text + PDF link) + a **level selector** so the user picks which level(s) to display (zoning event vs designation vs current state) — directly answering the "choice of which level(s), not just the creation event" feedback.
- **Ontology-agnostic**: geo joins on `categoryKey`/`valueKey` only; immo maps `node.type → GeoCategory` and `node.props/sourceRef/createdAt → GeoDetailSchema` on its side.

---

## 5. Decision 4 — `geo.sent-tech.ca` showcase

Follows the **DS docs-app format** (`sent-tech-design-system/apps/docs`): SvelteKit 2 + Svelte 5 + `@sveltejs/adapter-static`, root `+layout.svelte` owning chrome + theme/locale/colour-mode state synced to URL params + localStorage, `compileThemeModes(theme)` CSS injection, default theme = **theme-quebec**. geo's `apps/site` already uses this stack and `AppChrome`; we extend it.

**Chrome = DS-native (drumbeat, not geo-owned):** use `@sentropic/app-shell` `AppShell` (Svelte export) with a `SiteConfig` (brand "Sentropic / Géo", `nav`, `theming.themes` incl. quebec, `locale` fr/en, `search`). The **search-on-top**, the **legend/bubble overlay**, the **expandable detail panel** chrome, and any **`SearchBox`/`Combobox`/`Drawer`/`Popover`/`Badge`/`GraphLegend`** primitives are requested from / owned by the design-system. geo composes them; geo does **not** fork chrome.

Page structure:
- `/` — hero + "Carte dataviz géo" showcase: the live WebGL `GeoMap` with search-on-top, always-on legend, expandable detail, switchable demo datasets (QC signaux-style, choropleth on `qc-municipalites`, **linear projection on a road sample**).
- `/composants` — gallery of the geo dataviz primitives: choropleth demo, points/bubbles demo, **linear-feature projection demo**, basemap/theme demo — each a small `GeoMap` with a code snippet, mirroring DS component pages (one `+page.svelte` per demo).
- `/geographies` — browse available geographies via the OGC API: QC (`qc-regions`/`qc-mrc`/`qc-municipalites`), CA (`ca-provinces`), FR (`fr-regions`/`fr-departements`; referential `fr-cog-communes`/`fr-codes-postaux` shown as tables, null geometry). Reuses existing `DatasetCatalog`/`DatasetCard`/`AttributionBar`.

**DS-native vs geo-owned split:**
- DS-native (drumbeat): AppShell/Header/Footer/SideNav, `Search`/`Combobox`, `Drawer`/`Popover`/`Tooltip`, `Badge`/`Tag`/`SelectionChip`, `GraphLegend` (legend base), tokens/themes.
- geo-owned: the WebGL `GeoMap` itself, the basemap style/PMTiles, the linear-projection layer, the detail-panel *content* bound to `GeoDetailSchema`, the showcase pages and demo data wiring.

---

## 6. Decision 5 — Integration & deploy

**immo consumption (replaces `SignauxMapView`):** immo installs `@sentropic/geo-ui-svelte`, deletes the MapLibre-raster `SignauxMapView`/`CadastreMapView` bodies, and renders `<GeoMap>` passing: its own `categories` (mapping `Signal`/`DesignationEvent` → FR labels + token colours), `layers` (a `choropleth`/`points` layer fed from `/api/graph-signals` GeoJSON, or `kind:"ogc"` against `qc-municipalites`), and a `detailSchema` mapping `node.label/sourceRef/createdAt/props` + citation PDF + levels. The `LotFichePanel`'s anti-PII rule (no owner/address, Loi 25) is the consumer's responsibility via which `fields` it declares — geo renders only what the schema lists. immo keeps its colour-scale tokens; geo accepts resolved colours.

**Deploy (per ADR-0014: GitHub Pages static + k8s API):**
1. **Build**: CI `npm run verify` (build + check + test) across packages; `geo-ui-svelte` is published to npm (`@sentropic/geo-ui-svelte`, currently 0.1.0) via the existing `npm-publish.yml`; bump to a minor that ships the WebGL `GeoMap`.
2. **Tiles**: a CI/CronJob step builds PMTiles from the OSM recipe and uploads to the tile origin (S3/CDN) — artefact never committed (ODbL).
3. **Showcase publish (GitHub Pages)**: build `apps/site` with `adapter-static` (already configured, `fallback: 200.html`); a `pages-deploy.yml` GitHub Actions workflow publishes `build/` to GitHub Pages on the `geo.sent-tech.ca` custom domain (CNAME). *Open question:* current `apps/site` README/k8s docs imply the site is served from k8s+Traefik today; ADR mandates GitHub Pages — confirm the cutover (DNS → Pages) with the conductor; the static build is identical either way.
4. **API (k8s)**: unchanged — `geo-api` (Hono, OGC API – Features) deploys to Scaleway Kapsule (`deploy/k8s/*`, image `rg.fr-par.scw.cloud/geo/geo-api:latest`), reads `s3://sentropic-geo/normalized`, health via `/conformance`. The showcase fetches collections client-side from this API; CORS must allow the Pages origin.

---

## 7. Risks, phasing, open questions

**Phased build plan (each increment independently shippable):**
1. **MVP map** — MapLibre+deck wrapper replacing the placeholder `GeoMap`; vector basemap (PMTiles or fallback style), token-themed, `fitBounds`, pan/zoom, `geojson` layer, SSR-guarded dynamic import. Renders existing QC/CA/FR collections. *Ships: parity with placeholder + real basemap.*
2. **Choropleth + always-on legend** — `choropleth`/`points` layers, FR `legendBins`, union-of-categories legend overlay (DS `GraphLegend`). *Ships: replaces `SignauxMapView` bubble map.*
3. **Linear-feature projection** — `GeoLinearLayer` via deck `PathLayer`/`TripsLayer`, per-vertex colour + width/offset; needs a road LineString collection (none exist yet — see open Q). *Ships: the "richer than today" differentiator.*
4. **Search-on-top + expandable detail panel** — DS search overlay (not in menu), `detailSchema`-driven panel with citation/PDF/level selector, interaction-cull fluidity. *Ships: full graphify-grade UX.*
5. **Showcase** — `geo.sent-tech.ca` pages (`/`, `/composants`, `/geographies`) on AppShell + Pages deploy. *Ships: public dataviz-geo gallery.*

**Risks / mitigations:**
- *Bundle size* (MapLibre+deck ~300 KB gz) — lazy `onMount` import, code-split per route; acceptable for a map showcase.
- *deck.gl × MapLibre context interop* — use `MapboxOverlay` (interleaved, single canvas); pin compatible major versions; smoke-test on theme/dark switch.
- *PMTiles range-serving on GitHub Pages* — Pages supports HTTP range; if flaky, serve tiles from the geo-api/CDN origin (prop `styleUrl`/tile URL is configurable).
- *ODbL leakage* — recipe-only, CI builds tiles, attribution always on; gate in review.
- *No road data yet* — phase 3 is blocked on a LineString source (geo-source civic addresses are points). Either derive a road sample from OSM (ODbL) or ship phase 3 with a demo dataset until a `*-roads` collection lands.

**Open questions for the dataviz/design-system conductors (h2a):**
1. **dataviz boundary**: does `@sentropic/dataviz` (dataviz-core) export framework-free helpers (colour-intensity ramp, hexbin/cluster binning, value→radius) for geo to import? If yes, geo imports; if no, geo vendors them behind `// dataviz-boundary` for later removal. (DS `GeoMap` types already say "même forme que dataviz-core".)
2. **DS drumbeat**: confirm DS will own/ship the search-on-top overlay, legend/bubble chrome, and expandable-detail shell as reusable components (else geo builds minimal versions composing `Search`/`Drawer`/`Popover`/`GraphLegend`).
3. **Deploy cutover**: GitHub Pages vs the current k8s/Traefik static serve for `geo.sent-tech.ca` — confirm DNS ownership and CORS for the API.
4. **Road source**: which collection provides road LineStrings for the linear-projection demo (OSM extract recipe vs a future `geo-source-*-roads`)?
