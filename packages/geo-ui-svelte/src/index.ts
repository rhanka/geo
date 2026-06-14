/**
 * @sentropic/geo-ui-svelte — Svelte 5 components to browse and map geographic
 * datasets, styled by the Sent Tech design-system tokens.
 */

export const VERSION = "0.1.0";

export { default as GeoMap } from "./GeoMap.svelte";
export { default as GeoMapLegend } from "./GeoMapLegend.svelte";
export { default as DatasetCard } from "./DatasetCard.svelte";
export { default as DatasetCatalog } from "./DatasetCatalog.svelte";
export { default as AttributionBar } from "./AttributionBar.svelte";

export type {
  GeoCategory,
  GeoFeatureHit,
  GeoMapProps,
} from "./GeoMap.svelte";
export type { GeoMapLegendProps } from "./GeoMapLegend.svelte";
export type { DatasetCardProps } from "./DatasetCard.svelte";
export type { AttributionBarProps } from "./AttributionBar.svelte";

export {
  computeChoroplethBins,
  binsToStepExpression,
  formatBinRangeFr,
  numericValues,
  DEFAULT_CHOROPLETH_RAMP,
} from "./choropleth.js";
export type {
  ChoroplethBin,
  ChoroplethMethod,
  ChoroplethOptions,
} from "./choropleth.js";
