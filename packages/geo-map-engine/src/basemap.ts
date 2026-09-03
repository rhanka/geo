/**
 * Basemap contract — SPEC_GEO_MAP_ENGINE §1.3.2 (FROZEN v1).
 *
 * Attribution is MANDATORY for tiled basemaps; URLs are never hardcoded in the engine —
 * they are carried by the spec the consumer provides.
 */

import type { TokenRole } from "./encodings.js";

export type BasemapSpec =
  | { kind: "blank"; background: TokenRole }
  | { kind: "raster"; tiles: readonly string[]; attribution: string; saturation?: number }
  | { kind: "vector"; style?: string; pmtiles?: string; attribution: string }
  | { kind: "raster-source"; source: RasterSource; saturation?: number };

/**
 * v2.0 (SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D §2.2) — an ABSTRACT raster source resolved by the
 * adapter (deployment config), NEVER a provider URL/key in the contract. Carries a
 * possibly-dynamic attribution and a REQUIRED licensing policy. The three v1 members above are
 * frozen and untouched; `raster-source` is purely additive (a new union member = MAJOR + ADR).
 */
export interface RasterSource {
  /**
   * LOGICAL id — the adapter (deployment config) resolves it to URL/key/session at mount, the way
   * the TokenMap resolves `--st-*` (v1 §1.3.3). NEVER a provider URL or secret in the contract.
   */
  id: string;
  /**
   * `provider-2d` = key+session flow (e.g. Google Map Tiles 2D); `pmtiles` = self-hosted PMTiles
   * tileset (S3); `xyz-templated` = URL template the adapter fills (open, param-driven).
   */
  imageryType: "provider-2d" | "pmtiles" | "xyz-templated";
  attribution: AttributionSpec;
  /**
   * REQUIRED (fail-closed by the type, §2.2/fable B5): the ABSENCE of a policy is not representable
   * — no silent fail-open default. A mis-configured source does not compile.
   */
  policy: SourcePolicy;
}

/**
 * Attribution that may be STATIC or DYNAMIC (§2.2). The engine MUST render it on screen (§3.1);
 * `{ mode: "static", text: "" }` (empty) OR `{ mode: "dynamic" }` with no wired mechanism is
 * refused fail-closed (fable B4 — the refusal is on "no mechanism", not merely "empty string").
 */
export type AttributionSpec =
  | { mode: "static"; text: string }
  | { mode: "dynamic" };

/**
 * Licensing policy (§3.2, fable B5). `live-embed-only` = tiles go browser→provider LIVE, NEVER
 * cached/proxied by geo infra (a proxy/CDN = redistribution); `cacheable` = open imagery that is
 * self-hostable as PMTiles on S3. Consumed by the wp7 put-S3 provenance guard (increment-2).
 */
export type SourcePolicy = "live-embed-only" | "cacheable";

/** Discriminants of {@link BasemapSpec}. Forward 3D fields (`terrain`, `sky`) are added additively (non-breaking, §1.1 principle 4). `raster-source` is the v2.0 additive member (MAJOR + ADR, §2.1). */
export const BASEMAP_KINDS = ["blank", "raster", "vector", "raster-source"] as const;
export type BasemapKind = (typeof BASEMAP_KINDS)[number];
