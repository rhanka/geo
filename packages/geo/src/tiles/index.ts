/** Vector tiles (SPEC_VECTOR_TILES.md): T0 prototype — build MVT tiles and PMTiles archives. */

export {
  buildLayerTiles,
  layerTilesToPmtiles,
  type BuildTilesOptions,
  type BuiltTile,
  type LayerTiles,
  type SourceFeature,
  type ZoomStats,
} from "./build.js";
export { clipRing, type Rect } from "./clip.js";
export {
  lonLatToWorld,
  quantizeRing,
  ringArea2,
  simplifyLayer,
  unmatchedEdgeLength,
  worldToLonLat,
  type QPolygon,
  type QRing,
} from "./geometry.js";
export { encodeMvt, type MvtLayer, type MvtPolygonFeature } from "./mvt.js";
export { PmCompression, PmTileType, writePmtiles, zxyToTileId, type PmtilesTileInput, type PmtilesWriteOptions } from "./pmtiles.js";
export {
  citySlugFromCollection,
  LAYER_PROFILES,
  LOTS_PROFILE,
  pickProperties,
  profileForCollection,
  ZONES_PROFILE,
  type LayerProfile,
  type PropertyRule,
  type TileValue,
} from "./profiles.js";
