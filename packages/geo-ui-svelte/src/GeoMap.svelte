<script lang="ts" module>
  import type { FeatureCollection, Geometry, Position } from "@sentropic/geo-core";

  /**
   * A user-facing category used to colour features on the map. This is the ONLY
   * taxonomy `GeoMap` knows about: it is ontology-agnostic. The consumer maps
   * its own domain classes onto categories (id + FR label + resolved colour);
   * geo joins features on `categoryKey` and never invents a colour or a label.
   */
  export interface GeoCategory {
    /** Join key, matched against `feature.properties[categoryKey]`. */
    id: string;
    /** User-facing French label, e.g. "Changement de zonage". */
    labelFr: string;
    /** Resolved colour: a hex string OR a `--st-*` CSS variable reference. */
    color: string;
    /** Optional grouping / hierarchy id (reserved for later increments). */
    level?: string;
  }

  /** A feature handed back to the consumer on hover/click. */
  export interface GeoFeatureHit {
    /** Feature id when present (`feature.id` or `properties.geoId`). */
    id: string | number | undefined;
    /** The feature's properties (ontology lives here; geo never reads it). */
    properties: Record<string, unknown>;
    /** The feature's geometry. */
    geometry: Geometry | null;
  }

  export interface GeoMapProps {
    /**
     * GeoJSON FeatureCollection to render (WGS84, RFC 7946). When omitted or
     * empty, the map shows a French empty-state overlay instead of layers.
     */
    data?: FeatureCollection;
    /**
     * Categories driving the data-driven fill colour. Joined to features via
     * `categoryKey`. When provided, the fill uses a MapLibre `match` expression.
     */
    categories?: GeoCategory[];
    /** Properties field carrying the category id. Default `"category"`. */
    categoryKey?: string;
    /**
     * Numeric properties field for a value-driven choropleth (used when
     * `categories` is absent). Renders an `interpolate` ramp over the data range.
     */
    valueKey?: string;
    /** CSS height of the map container. Default `"480px"`. */
    height?: string;
    /** Fit the camera to the data bounds once loaded. Default `true`. */
    fitBounds?: boolean;
    /** Called on hover (the hit) and when the hover leaves a feature (`null`). */
    onHover?: (feature: GeoFeatureHit | null) => void;
    /** Called when a feature is clicked. */
    onSelect?: (feature: GeoFeatureHit) => void;
    /** Accessible label for the map region. */
    labelFr?: string;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";

  let {
    data,
    categories,
    categoryKey = "category",
    valueKey,
    height = "480px",
    fitBounds = true,
    onHover,
    onSelect,
    labelFr = "Carte des données géographiques",
  }: GeoMapProps = $props();

  let container: HTMLDivElement;

  /** True when there is nothing to draw → show the French empty-state. */
  const isEmpty = $derived(!data || data.features.length === 0);

  /** Compute [west, south, east, north] over every coordinate in the data. */
  function computeBounds(
    fc: FeatureCollection,
  ): [number, number, number, number] | undefined {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;

    const visit = (coords: unknown): void => {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        const [lng, lat] = coords as Position;
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
        return;
      }
      for (const child of coords) visit(child);
    };

    for (const feature of fc.features) {
      const geom = feature.geometry;
      if (!geom) continue;
      if (geom.type === "GeometryCollection") {
        for (const g of geom.geometries) {
          if ("coordinates" in g) visit(g.coordinates);
        }
      } else {
        visit(geom.coordinates);
      }
    }

    if (
      west === Infinity ||
      south === Infinity ||
      east === -Infinity ||
      north === -Infinity
    ) {
      return undefined;
    }
    return [west, south, east, north];
  }

  /** Min/max of `valueKey` across the data, for the choropleth ramp. */
  function valueRange(
    fc: FeatureCollection,
    key: string,
  ): [number, number] | undefined {
    let min = Infinity;
    let max = -Infinity;
    for (const f of fc.features) {
      const raw = f.properties?.[key];
      const v = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Infinity || max === -Infinity) return undefined;
    return [min, max];
  }

  onMount(() => {
    // MapLibre needs `window`; guard so SSR/prerender never touches it.
    if (typeof window === "undefined" || !container) return;

    let map: import("maplibre-gl").Map | undefined;
    let disposed = false;
    let hoveredId: string | number | undefined;

    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      // MapLibre's CSS is loaded dynamically too, so SSR never imports it.
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (disposed || !container) return;

      // Read tokenized colours from the resolved DS theme (graceful fallbacks).
      const styles = getComputedStyle(document.documentElement);
      const token = (name: string, fallback: string): string =>
        styles.getPropertyValue(name).trim() || fallback;

      const surface = token("--st-component-card-background", "#f8fafc");
      const lineColor = token("--st-color-blue-60", "#1d4288");
      const fillColor = token("--st-color-blue-60", "#2563eb");
      const fillColorLo = token("--st-color-blue-20", "#bfdbfe");
      const pointColor = token("--st-color-cyan-50", "#0891b2");

      /**
       * Data-driven fill-color expression. Order of precedence:
       *  1. categories + categoryKey → a `match` on the category id;
       *  2. valueKey → an `interpolate` ramp over the data's value range;
       *  3. a flat tokenized fill.
       * Typed loosely because maplibre-gl does not export ExpressionSpecification.
       */
      const fillColorExpr = ((): unknown => {
        if (categories && categories.length > 0) {
          const match: unknown[] = ["match", ["get", categoryKey]];
          for (const c of categories) {
            match.push(c.id, c.color);
          }
          match.push(fillColor); // default for unmatched categories
          return match;
        }
        if (valueKey && data) {
          const range = valueRange(data, valueKey);
          if (range && range[0] !== range[1]) {
            return [
              "interpolate",
              ["linear"],
              ["to-number", ["get", valueKey], 0],
              range[0],
              fillColorLo,
              range[1],
              fillColor,
            ];
          }
        }
        return fillColor;
      })();

      map = new maplibregl.Map({
        container,
        // Tokenized blank background — NO external tiles (ODbL-safe; PMTiles
        // basemap is a later increment). The data layers carry all meaning.
        style: {
          version: 8,
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": surface },
            },
          ],
        },
        attributionControl: false,
        center: [-71.5, 47],
        zoom: 4,
      });

      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right",
      );

      const emitHit = (
        feature: import("maplibre-gl").MapGeoJSONFeature,
      ): GeoFeatureHit => ({
        // Prefer the consumer-stable `properties.geoId`; fall back to MapLibre's
        // (auto-generated) feature id when no domain id is present.
        id:
          (feature.properties?.["geoId"] as string | number | undefined) ??
          feature.id,
        properties: (feature.properties ?? {}) as Record<string, unknown>,
        geometry: feature.geometry as unknown as Geometry | null,
      });

      map.on("load", () => {
        if (!map) return;

        if (!isEmpty && data) {
          // Our RFC-7946 FeatureCollection is structurally a maplibre GeoJSON
          // source `data`; cast the whole source spec through `unknown` so this
          // package's tsconfig need not pull in the global `GeoJSON` namespace.
          // `generateId` makes MapLibre assign a stable numeric id per feature
          // so `feature-state` hover works even when the GeoJSON carries no
          // top-level `id` (our admin features key on `properties.geoId`).
          map.addSource("data", {
            type: "geojson",
            data,
            generateId: true,
          } as unknown as import("maplibre-gl").SourceSpecification);

          map.addLayer({
            id: "fill",
            type: "fill",
            source: "data",
            filter: [
              "in",
              ["geometry-type"],
              ["literal", ["Polygon", "MultiPolygon"]],
            ],
            paint: {
              "fill-color": fillColorExpr as never,
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                0.55,
                0.28,
              ],
            },
          });
          map.addLayer({
            id: "outline",
            type: "line",
            source: "data",
            filter: [
              "in",
              ["geometry-type"],
              ["literal", ["Polygon", "MultiPolygon", "LineString", "MultiLineString"]],
            ],
            paint: {
              "line-color": lineColor,
              "line-width": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                2.5,
                1.5,
              ],
            },
          });
          map.addLayer({
            id: "points",
            type: "circle",
            source: "data",
            filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
            paint: {
              "circle-radius": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                8,
                5,
              ],
              "circle-color": (categories && categories.length > 0
                ? fillColorExpr
                : pointColor) as never,
              "circle-stroke-color": surface,
              "circle-stroke-width": 1.5,
            },
          });

          const interactiveLayers = ["fill", "points"];

          const setHover = (id: string | number | undefined): void => {
            if (!map) return;
            if (hoveredId !== undefined && hoveredId !== id) {
              map.setFeatureState(
                { source: "data", id: hoveredId },
                { hover: false },
              );
            }
            hoveredId = id;
            if (id !== undefined) {
              map.setFeatureState({ source: "data", id }, { hover: true });
            }
          };

          for (const layerId of interactiveLayers) {
            map.on("mousemove", layerId, (e) => {
              if (!map) return;
              const feature = e.features?.[0];
              if (!feature) return;
              map.getCanvas().style.cursor = "pointer";
              if (feature.id !== undefined) setHover(feature.id);
              onHover?.(emitHit(feature));
            });
            map.on("mouseleave", layerId, () => {
              if (!map) return;
              map.getCanvas().style.cursor = "";
              setHover(undefined);
              onHover?.(null);
            });
            map.on("click", layerId, (e) => {
              const feature = e.features?.[0];
              if (feature) onSelect?.(emitHit(feature));
            });
          }
        }

        if (fitBounds && data) {
          const bounds = computeBounds(data);
          if (bounds) {
            map.fitBounds(bounds, { padding: 32, duration: 0, maxZoom: 10 });
          }
        }
      });
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  });
</script>

<div class="geo-map-wrap" style:height>
  <div bind:this={container} class="geo-map" aria-label={labelFr}></div>
  {#if isEmpty}
    <div class="geo-map-empty" role="status">
      <p class="geo-map-empty-title">Aucune donnée à afficher</p>
      <p class="geo-map-empty-message">
        La géométrie de ce jeu de données n'est pas encore disponible.
      </p>
    </div>
  {/if}
</div>

<style>
  .geo-map-wrap {
    position: relative;
    width: 100%;
    border-radius: var(--st-radius-md, 0.5rem);
    border: 1px solid var(--st-component-card-border, #e2e8f0);
    overflow: hidden;
    background: var(--st-component-card-background, #f8fafc);
  }
  .geo-map {
    width: 100%;
    height: 100%;
  }

  .geo-map-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--st-spacing-1, 0.25rem);
    padding: var(--st-spacing-4, 1rem);
    text-align: center;
    pointer-events: none;
  }
  .geo-map-empty-title {
    margin: 0;
    font-weight: 600;
    color: var(--st-color-text-primary, #1e293b);
  }
  .geo-map-empty-message {
    margin: 0;
    color: var(--st-color-text-secondary, #64748b);
    font-size: 0.875rem;
  }

  /* Pull MapLibre's control radius into the DS token scale. */
  .geo-map :global(.maplibregl-ctrl-group) {
    border-radius: var(--st-radius-sm, 0.25rem);
  }
</style>
