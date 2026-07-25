import type {
  GeoCategory,
  GeoFeatureHit,
  GeoLayerKind,
  GeoMapProps,
} from "./GeoMap.svelte";

export type {
  GeoCategory,
  GeoFeatureHit,
  GeoLayerKind,
  GeoMapProps,
};

export type GeoMapLegendPosition = NonNullable<GeoMapProps["legendPosition"]>;
export type GeoPointLayerOptions = NonNullable<GeoMapProps["pointLayer"]>;
