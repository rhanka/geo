/**
 * Neutral encodings & tokens — SPEC_GEO_MAP_ENGINE §1.3.1 / §1.3.3 (FROZEN v1).
 *
 * The heart of renderer-neutrality: the public contract carries ZERO raw maplibre
 * paint expression (§1.1 principle 1). The engine compiles these neutral encodings
 * to concrete paint PER RENDERER (maplibre 2D / deck·Cesium 3D).
 */

/** A semantic role name (e.g. "category1", "border-subtle") — NEVER a hex/color literal (§1.1 principle 2). */
export type TokenRole = string;

/**
 * Resolved token map (§1.3.3): role → concrete primitive value.
 * The engine is DOM-free — the ADAPTER resolves the theme's `--st-*` custom properties
 * (via `getComputedStyle`) into this map, at mount AND on every theme change; the engine
 * receives resolved primitives, never a DOM-coupled resolver (arbitrage E.1).
 */
export type TokenMap = Record<TokenRole, string>;

/** Color driven by a neutral encoding → token role, compiled to paint per renderer (§1.3.1). */
export type ColorEncoding =
  | { by: "constant"; token: TokenRole }
  | { by: "category"; field: string; map: Record<string, TokenRole> }
  | { by: "valueStep"; field: string; stops: ReadonlyArray<{ upTo: number; token: TokenRole }> }
  | { by: "valueRamp"; field: string; domain: readonly [number, number]; ramp: ReadonlyArray<TokenRole> };

/** Numeric channel (radius / width / opacity …) driven by a constant or a value ∝ field (§1.3.1). */
export type NumberEncoding =
  | { by: "constant"; value: number }
  | { by: "value"; field: string; domain: readonly [number, number]; range: readonly [number, number] };

/** Discriminants of {@link ColorEncoding} (arbitrage E.2: minimal set; extend only if a real layer requires it). */
export const COLOR_ENCODING_KINDS = ["constant", "category", "valueStep", "valueRamp"] as const;
export type ColorEncodingKind = (typeof COLOR_ENCODING_KINDS)[number];

/** Discriminants of {@link NumberEncoding}. */
export const NUMBER_ENCODING_KINDS = ["constant", "value"] as const;
export type NumberEncodingKind = (typeof NUMBER_ENCODING_KINDS)[number];
