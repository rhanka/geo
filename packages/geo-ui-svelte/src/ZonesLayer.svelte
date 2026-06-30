<script lang="ts" module>
  import type { FeatureCollection } from "@sentropic/geo-core";
  import type {
    GeoCategory,
    GeoFeatureHit,
    GeoMapProps,
  } from "./GeoMap.svelte";

  /** Map corner the built-in legend docks into. */
  export type ZonesLayerLegendPosition = NonNullable<
    GeoMapProps["legendPosition"]
  >;

  /**
   * A zoning feature handed back to the consumer, enriched with the two fields
   * every zonage map needs at the fingertips: the zone code and (when present)
   * the dominant usage. The full `properties` bag still carries everything else;
   * geo never invents a colour or a label for it.
   */
  export interface ZonesLayerHit extends GeoFeatureHit {
    zoneCode: string | number | undefined;
    zoneUsage: string | undefined;
  }

  export interface ZonesLayerProps {
    /** Zoning polygons (or centroids), already projected to WGS84 GeoJSON. */
    data?: FeatureCollection;
    /**
     * Property carrying the stable zone code. Default `zoneCode` (the UI shape);
     * falls back to the acquisition GeoJSON `zone_code` / `code_zone`.
     */
    idKey?: string;
    /** Property carrying the dominant usage label. Default `zoneUsage`. */
    usageKey?: string;
    /**
     * Property carrying a categorical styling id (e.g. a regulatory class or a
     * usage family). Default `category`. When `categories` is supplied the fill
     * is a `match` on this key.
     */
    categoryKey?: string;
    /**
     * Numeric property for a value-driven choropleth (e.g. attached-signal
     * count). Used when no `categories` are given.
     */
    valueKey?: string;
    /** Consumer-owned categories; labels and colours stay app-defined. */
    categories?: GeoCategory[];
    height?: string;
    legend?: boolean;
    legendPosition?: ZonesLayerLegendPosition;
    labelFr?: string;
    onHover?: (feature: ZonesLayerHit | null) => void;
    onSelect?: (feature: ZonesLayerHit) => void;
  }

  const EMPTY_ZONES: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  /**
   * Resolve a stable zone code from a feature's properties. Prefers `idKey`,
   * then a fixed fallback chain spanning both the consumer UI shape (`zoneCode`)
   * and the acquisition normalized GeoJSON (`zone_code` / `code_zone`).
   */
  export function zoneCodeFromProperties(
    properties: Record<string, unknown>,
    idKey = "zoneCode",
  ): string | number | undefined {
    const explicit = properties[idKey];
    if (typeof explicit === "string" || typeof explicit === "number") {
      return explicit;
    }
    const fallbacks = ["zoneCode", "zone_code", "Zonage", "code_zone", "zone", "id"];
    for (const key of fallbacks) {
      const value = properties[key];
      if (typeof value === "string" || typeof value === "number") {
        return value;
      }
    }
    return undefined;
  }

  /** Resolve the dominant usage label, if the feature carries one. */
  export function zoneUsageFromProperties(
    properties: Record<string, unknown>,
    usageKey = "zoneUsage",
  ): string | undefined {
    const explicit = properties[usageKey];
    if (typeof explicit === "string") return explicit;
    const fallbacks = ["zoneUsage", "usage", "usage_dominant", "use"];
    for (const key of fallbacks) {
      const value = properties[key];
      if (typeof value === "string") return value;
    }
    return undefined;
  }

  export function toZonesLayerHit(
    hit: GeoFeatureHit,
    idKey = "zoneCode",
    usageKey = "zoneUsage",
  ): ZonesLayerHit {
    return {
      ...hit,
      zoneCode: zoneCodeFromProperties(hit.properties, idKey),
      zoneUsage: zoneUsageFromProperties(hit.properties, usageKey),
    };
  }
</script>

<script lang="ts">
  import GeoMap from "./GeoMap.svelte";

  let {
    data,
    idKey = "zoneCode",
    usageKey = "zoneUsage",
    categoryKey = "category",
    valueKey,
    categories,
    height = "480px",
    legend = true,
    legendPosition = "bottom-left",
    labelFr = "Carte du zonage",
    onHover,
    onSelect,
  }: ZonesLayerProps = $props();

  const mapData = $derived(data ?? EMPTY_ZONES);
  const mapCategories = $derived(categories ?? []);
  const mapValueKey = $derived(valueKey ?? "");

  function handleHover(hit: GeoFeatureHit | null): void {
    onHover?.(hit ? toZonesLayerHit(hit, idKey, usageKey) : null);
  }

  function handleSelect(hit: GeoFeatureHit): void {
    onSelect?.(toZonesLayerHit(hit, idKey, usageKey));
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
