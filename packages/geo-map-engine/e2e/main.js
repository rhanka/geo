import maplibregl from "maplibre-gl";

import { mount } from "../src/index.ts";

const tokens = {
  "surface-default": "#f8fafc",
  category1: "#4e79a7",
  category2: "#f28e2b",
  category3: "#59a14f",
  "border-subtle": "#e2e8f0",
};

const layers = [
  {
    id: "layers/density",
    kind: "choropleth",
    data: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { density: 12, zoneId: "density-1" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-71.57, 46.76],
            [-71.43, 46.76],
            [-71.43, 46.84],
            [-71.57, 46.84],
            [-71.57, 46.76],
          ]],
        },
      }],
    },
    fill: {
      color: {
        by: "valueStep",
        field: "density",
        stops: [
          { upTo: 10, token: "category1" },
          { upTo: Number.POSITIVE_INFINITY, token: "category2" },
        ],
      },
      opacity: { by: "constant", value: 0.72 },
    },
    outline: {
      color: { by: "constant", token: "border-subtle" },
      width: { by: "constant", value: 1 },
    },
    interactivity: { hover: true, select: true, idField: "zoneId" },
  },
  {
    id: "layers/signals",
    kind: "points",
    data: { sourceRef: "signals" },
    color: { by: "constant", token: "category2" },
    radius: { by: "value", field: "size", domain: [0, 10], range: [4, 18] },
    interactivity: { hover: true, select: true, idField: "signalId" },
  },
];

const observedRenderedLayerIds = [];
const observedHoverHits = [];
const observedSelectHits = [];
const nativeQueryRenderedFeatures = maplibregl.Map.prototype.queryRenderedFeatures;

// This is observation, not a mock: the original MapLibre method executes and
// returns the GPU-rendered features that the mount's real hover binding reads.
maplibregl.Map.prototype.queryRenderedFeatures = function (...args) {
  const features = nativeQueryRenderedFeatures.apply(this, args);
  observedRenderedLayerIds.push(features.map((feature) => feature.layer.id));
  return features;
};

const handle = mount(document.querySelector("#map-host"), {
  basemap: { kind: "blank", background: "surface-default" },
  layers,
  viewport: { center: [-71.5, 46.8], zoom: 11, bearing: 0, pitch: 0 },
  renderer: "2d",
  tokens,
  options: {
    attributionControl: false,
    fadeDuration: 0,
    preserveDrawingBuffer: true,
    sources: {
      signals: {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { size: 8, signalId: "signal-1" },
          geometry: { type: "Point", coordinates: [-71.5, 46.8] },
        }],
      },
    },
  },
  onReady: () => {
    window.__mountReady = true;
  },
  onHover: (hit) => observedHoverHits.push(hit),
  onSelect: (hit) => observedSelectHits.push(hit),
});

window.__mountE2e = {
  handle,
  observedHoverHits,
  observedSelectHits,
  observedRenderedLayerIds,
};
