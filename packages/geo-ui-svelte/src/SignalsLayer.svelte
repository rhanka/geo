<script lang="ts" module>
  import type { FeatureCollection } from "@sentropic/geo-core";
  import type {
    GeoCategory,
    GeoFeatureHit,
    GeoLayerKind,
    GeoMapLegendPosition,
    GeoPointLayerOptions,
  } from "./map-types.js";

  export type SignalsLayerAggregation = "none" | Extract<
    GeoLayerKind,
    "hexbin" | "cluster" | "density"
  >;

  export interface SignalsLayerHit extends GeoFeatureHit {
    signalId: string | number | undefined;
  }

  export interface SignalsLayerProps {
    /** Signal points or polygons, already projected to WGS84 GeoJSON. */
    data?: FeatureCollection;
    /** Property carrying the stable signal id. Default `signalId`. */
    idKey?: string;
    /** Property carrying the signal category id. Default `category`. */
    categoryKey?: string;
    categories?: GeoCategory[];
    /** `none` renders individual features; other modes render point aggregates. */
    aggregation?: SignalsLayerAggregation;
    pointLayer?: GeoPointLayerOptions;
    height?: string;
    legend?: boolean;
    legendPosition?: GeoMapLegendPosition;
    labelFr?: string;
    onHover?: (feature: SignalsLayerHit | null) => void;
    onSelect?: (feature: SignalsLayerHit) => void;
  }

  const EMPTY_SIGNALS: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  export function signalIdFromProperties(
    properties: Record<string, unknown>,
    idKey = "signalId",
  ): string | number | undefined {
    const explicit = properties[idKey];
    if (typeof explicit === "string" || typeof explicit === "number") {
      return explicit;
    }
    const fallbacks = ["signalId", "nodeId", "geoId", "id"];
    for (const key of fallbacks) {
      const value = properties[key];
      if (typeof value === "string" || typeof value === "number") {
        return value;
      }
    }
    return undefined;
  }

  export function toSignalsLayerHit(
    hit: GeoFeatureHit,
    idKey = "signalId",
  ): SignalsLayerHit {
    return {
      ...hit,
      signalId: signalIdFromProperties(hit.properties, idKey),
    };
  }
</script>

<script lang="ts">
  import GeoMap from "./GeoMap.svelte";

  let {
    data,
    idKey = "signalId",
    categoryKey = "category",
    categories,
    aggregation = "none",
    pointLayer,
    height = "480px",
    legend = true,
    legendPosition = "bottom-left",
    labelFr = "Carte des signaux",
    onHover,
    onSelect,
  }: SignalsLayerProps = $props();

  const mapData = $derived(data ?? EMPTY_SIGNALS);
  const mapCategories = $derived(categories ?? []);
  const mapPointLayer = $derived(pointLayer ?? {});
  const layerKind = $derived<GeoLayerKind>(
    aggregation === "none" ? "choropleth" : aggregation,
  );

  function handleHover(hit: GeoFeatureHit | null): void {
    onHover?.(hit ? toSignalsLayerHit(hit, idKey) : null);
  }

  function handleSelect(hit: GeoFeatureHit): void {
    onSelect?.(toSignalsLayerHit(hit, idKey));
  }
</script>

<GeoMap
  data={mapData}
  {layerKind}
  pointLayer={mapPointLayer}
  categories={mapCategories}
  {categoryKey}
  {height}
  {legend}
  {legendPosition}
  {labelFr}
  onHover={handleHover}
  onSelect={handleSelect}
/>
