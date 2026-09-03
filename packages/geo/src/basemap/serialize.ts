/**
 * §5 basemap adapter — mint RESOLUTION serialization (public source descriptor + adapter-internal session).
 *
 * geo-archi's FROZEN seam (ADR-0026/0029, SPEC_GEO_MAP_ENGINE_V2 §2.2/§3.3): the PUBLIC, engine-facing
 * descriptor carries ONLY the tile URL TEMPLATE BASE (`{z}/{x}/{y}` — NO session/key), the tile size, the
 * image format, and the attribution. The minted session + its expiry are ADAPTER-INTERNAL (a SEPARATE
 * {@link SessionResolution}), injected per-tile by the engine's transform-request closure (PR-B), NEVER
 * folded into the public descriptor. The types here are STRUCTURALLY compatible with the engine's
 * `AttributionSpec` but defined locally, so `packages/geo` keeps ZERO dependency on the engine — the
 * engine consumes this JSON, not the reverse (the direction geo-archi ratified for inc-1).
 */

import type { GoogleSession } from "./session-mint.js";

/**
 * Google Map Tiles 2D tile endpoint — the `{z}/{x}/{y}` template WITHOUT `?session=&key=`. The adapter
 * appends the session + restricted key PER-TILE via the engine's transform-request closure (PR-B), under
 * the referrer restriction (live-embed-only, §3.2) — they are NEVER serialised into the public descriptor.
 */
export const GOOGLE_2D_TILE_TEMPLATE = "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}";

/**
 * Attribution — MANDATORY (§2.2/§3.1). Structurally identical to the engine's `AttributionSpec` but
 * declared here to avoid a `packages/geo` → engine dependency. `dynamic` = the per-viewport copyright the
 * engine wires (PR-B); `static` = a fixed baseline.
 */
export type AttributionSpec =
  | { readonly mode: "static"; readonly text: string }
  | { readonly mode: "dynamic" };

/** PUBLIC, engine-facing source descriptor — drops session/key (§3.3). Feeds `compileBasemap` (PR-B). */
export interface BasemapSourceDescriptor {
  /** `{z}/{x}/{y}` template, NO session/key (the adapter injects those per-tile). */
  readonly tileUrlTemplateBase: string;
  readonly tileSize: { readonly width: number; readonly height: number };
  readonly imageFormat: string;
  readonly attribution: AttributionSpec;
}

/**
 * ADAPTER-INTERNAL minted session (separate-input, §3.3). Injected per-tile via the transform-request
 * closure — NEVER part of the public descriptor. `expirySeconds` drives the engine's expiry→onError seam.
 */
export interface SessionResolution {
  readonly session: string;
  readonly expirySeconds: number;
}

/** The mint endpoint envelope: the PUBLIC descriptor + the adapter-internal session, kept SEPARATE. */
export interface MintResolution {
  readonly source: BasemapSourceDescriptor;
  readonly session: SessionResolution;
}

export interface SerializeConfig {
  /** MANDATORY attribution (fail-closed by the type — no silent absence). */
  readonly attribution: AttributionSpec;
  /** Override the tile template base (defaults to {@link GOOGLE_2D_TILE_TEMPLATE}). */
  readonly tileUrlTemplateBase?: string;
}

/**
 * Serialise a minted Google session into the mint envelope: the PUBLIC descriptor (template base + tile
 * size + image format + attribution) and, SEPARATELY, the adapter-internal session. The session token +
 * key are NEVER folded into the descriptor's URL — the engine injects them per-tile (transform-request).
 */
export function serializeMint(session: GoogleSession, config: SerializeConfig): MintResolution {
  return {
    source: {
      tileUrlTemplateBase: config.tileUrlTemplateBase ?? GOOGLE_2D_TILE_TEMPLATE,
      tileSize: { width: session.tileWidth, height: session.tileHeight },
      imageFormat: session.imageFormat,
      attribution: config.attribution,
    },
    session: { session: session.session, expirySeconds: session.expirySeconds },
  };
}
