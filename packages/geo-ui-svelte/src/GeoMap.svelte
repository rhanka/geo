<script lang="ts">
  import { onMount } from "svelte";
  import type { FeatureCollection, Position } from "@sentropic/geo-core";

  interface Props {
    /** GeoJSON FeatureCollection to render (WGS84, RFC 7946). */
    data: FeatureCollection;
    /** CSS height of the map container. */
    height?: string;
  }

  let { data, height = "480px" }: Props = $props();

  let container: HTMLDivElement;

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
      // A position is a [number, number, ...] tuple.
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

  onMount(() => {
    // MapLibre needs `window`; guard so SSR/prerender never touches it.
    if (typeof window === "undefined" || !container) return;

    let map: import("maplibre-gl").Map | undefined;
    let disposed = false;

    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (disposed) return;

      // Read tokenized colors from the resolved theme (falls back gracefully).
      const styles = getComputedStyle(document.documentElement);
      const token = (name: string, fallback: string): string =>
        styles.getPropertyValue(name).trim() || fallback;

      const surface = token("--st-component-card-background", "#f8fafc");
      const line = token("--st-color-blue-60", "#1d4288");
      const fill = token("--st-color-blue-60", "#2563eb");
      const point = token("--st-color-cyan-50", "#0891b2");

      map = new maplibregl.Map({
        container,
        // Neutral, offline-tolerant style: a single background layer, no tiles
        // to 404 against. The data layers carry all the meaning.
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
        // Sensible default view; fitBounds overrides once data is loaded.
        center: [-71.5, 47],
        zoom: 4,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right",
      );

      map.on("load", () => {
        if (!map) return;
        map.addSource("data", { type: "geojson", data });

        map.addLayer({
          id: "fill",
          type: "fill",
          source: "data",
          filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
          paint: { "fill-color": fill, "fill-opacity": 0.18 },
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
          paint: { "line-color": line, "line-width": 1.5 },
        });
        map.addLayer({
          id: "points",
          type: "circle",
          source: "data",
          filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
          paint: {
            "circle-radius": 5,
            "circle-color": point,
            "circle-stroke-color": surface,
            "circle-stroke-width": 1.5,
          },
        });

        const bounds = computeBounds(data);
        if (bounds) {
          map.fitBounds(bounds, { padding: 32, duration: 0, maxZoom: 10 });
        }
      });
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  });
</script>

<div bind:this={container} class="geo-map" style:height aria-label="Carte des données géographiques"></div>

<style>
  .geo-map {
    width: 100%;
    border-radius: var(--st-radius-md, 0.5rem);
    border: 1px solid var(--st-component-card-border, #e2e8f0);
    overflow: hidden;
    background: var(--st-component-card-background, #f8fafc);
  }

  /* Pull in MapLibre's control CSS scoped to this component's container. */
  .geo-map :global(.maplibregl-ctrl-group) {
    border-radius: var(--st-radius-sm, 0.25rem);
  }
</style>
