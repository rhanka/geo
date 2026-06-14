/**
 * @sentropic/geo-ui-svelte — Svelte 5 components to browse and map geographic
 * datasets, styled by the Sent Tech design-system tokens.
 */

export const VERSION = "0.1.0";

export { default as GeoMap } from "./GeoMap.svelte";
export { default as GeoMapLegend } from "./GeoMapLegend.svelte";
export { default as GeoSearch, foldText } from "./GeoSearch.svelte";
export { default as GeoDetailPanel } from "./GeoDetailPanel.svelte";
export { default as DatasetCard } from "./DatasetCard.svelte";
export { default as DatasetCatalog } from "./DatasetCatalog.svelte";
export { default as AttributionBar } from "./AttributionBar.svelte";

export type {
  GeoCategory,
  GeoFeatureHit,
  GeoLayerKind,
  GeoMapProps,
} from "./GeoMap.svelte";
export type { GeoMapLegendProps } from "./GeoMapLegend.svelte";
export type { GeoSearchProps } from "./GeoSearch.svelte";
export type {
  GeoDetailField,
  GeoDetailSchema,
  GeoDetailPanelProps,
} from "./GeoDetailPanel.svelte";
export type { DatasetCardProps } from "./DatasetCard.svelte";
export type { AttributionBarProps } from "./AttributionBar.svelte";

export {
  computeChoroplethBins,
  computeChoroplethBinsFromModel,
  classifyValues,
  binsToStepExpression,
  formatBinRangeFr,
  numericValues,
  DEFAULT_CHOROPLETH_RAMP,
} from "./choropleth.js";
export type {
  ChoroplethBin,
  ChoroplethMethod,
  ChoroplethOptions,
  ChoroplethModelOptions,
} from "./choropleth.js";

export {
  buildHexbinLayer,
  buildClusterLayer,
  buildDensityLayer,
  buildPointLayer,
} from "./point-layers.js";
export type {
  PointLayerKind,
  PointLayerSpec,
  PointLayerOptions,
} from "./point-layers.js";

export {
  featuresToRows,
  choroplethInput,
  pointInput,
  BUILDER_NOTES,
  GEOMETRY_KEY,
  REGION_KEY,
} from "./dataviz-adapter.js";
