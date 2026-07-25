<script lang="ts" module>
  import type { FeatureCollection } from "@sentropic/geo-core";
  import type {
    GeoCategory,
    GeoFeatureHit,
    GeoMapLegendPosition,
  } from "./map-types.js";

  export interface LotsLayerHit extends GeoFeatureHit {
    lotId: string | number | undefined;
  }

  export interface LotsLayerProps {
    /** Public lot polygons or centroids, already projected to WGS84 GeoJSON. */
    data?: FeatureCollection;
    /** Property carrying the stable lot id. Default `noLot`. */
    idKey?: string;
    /** Property carrying a categorical styling id. Default `category`. */
    categoryKey?: string;
    /** Optional numeric property for value choropleths. */
    valueKey?: string;
    /** Consumer-owned categories; labels and colors stay app-defined. */
    categories?: GeoCategory[];
    height?: string;
    legend?: boolean;
    legendPosition?: GeoMapLegendPosition;
    labelFr?: string;
    onHover?: (feature: LotsLayerHit | null) => void;
    onSelect?: (feature: LotsLayerHit) => void;
  }

  const EMPTY_LOTS: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  export function lotIdFromProperties(
    properties: Record<string, unknown>,
    idKey = "noLot",
  ): string | number | undefined {
    const explicit = properties[idKey];
    if (typeof explicit === "string" || typeof explicit === "number") {
      return explicit;
    }
    const fallbacks = ["noLot", "lotNumber", "lot", "id"];
    for (const key of fallbacks) {
      const value = properties[key];
      if (typeof value === "string" || typeof value === "number") {
        return value;
      }
    }
    return undefined;
  }

  export function toLotsLayerHit(
    hit: GeoFeatureHit,
    idKey = "noLot",
  ): LotsLayerHit {
    return {
      ...hit,
      lotId: lotIdFromProperties(hit.properties, idKey),
    };
  }
</script>

<script lang="ts">
  import GeoMap from "./GeoMap.svelte";

  let {
    data,
    idKey = "noLot",
    categoryKey = "category",
    valueKey,
    categories,
    height = "480px",
    legend = true,
    legendPosition = "bottom-left",
    labelFr = "Carte des lots",
    onHover,
    onSelect,
  }: LotsLayerProps = $props();

  const mapData = $derived(data ?? EMPTY_LOTS);
  const mapCategories = $derived(categories ?? []);
  const mapValueKey = $derived(valueKey ?? "");

  function handleHover(hit: GeoFeatureHit | null): void {
    onHover?.(hit ? toLotsLayerHit(hit, idKey) : null);
  }

  function handleSelect(hit: GeoFeatureHit): void {
    onSelect?.(toLotsLayerHit(hit, idKey));
  }
</script>

<GeoMap
  data={mapData}
  layerKind="choropleth"
  categories={mapCategories}
  {categoryKey}
  valueKey={mapValueKey}
  {height}
  {legend}
  {legendPosition}
  {labelFr}
  onHover={handleHover}
  onSelect={handleSelect}
/>
