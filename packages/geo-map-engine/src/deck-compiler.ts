/**
 * Compilation interne des encodages renderer-neutres vers des ACCESSORS deck.gl 3D
 * (W7, Phase 0). Le pendant 3D de `paint-compiler.ts` : la MÊME sélection de token par
 * encodage, mais l'output est un accessor pur `(feature) => [r,g,b,a]` (ou une valeur
 * constante), jamais une expression MapLibre ni un objet deck.gl.
 *
 * ⚠ PUR-TS, ZÉRO dépendance renderer : ce module n'importe NI `@deck.gl/*` NI un
 * lib de couleur — deck.gl est le CONSOMMATEUR (le mount 3D, W10, côté adapter), pas
 * une dépendance de compilation. Le contrat public reste renderer-neutre ; ce module
 * n'est PAS ré-exporté par `index.ts` (comme `paint-compiler.ts`).
 *
 * PARITÉ (contrat) : pour un même (encoding, TokenMap, feature), l'accessor deck résout
 * le MÊME token que l'expression MapLibre de `paint-compiler.ts`, puis parse la valeur
 * primitive de la TokenMap en RGBA. `valueRamp`/`value` interpolent linéairement (la même
 * intention que l'`interpolate` linéaire MapLibre) ; la garde token-absent est identique.
 */
import type { ColorEncoding, NumberEncoding, TokenMap, TokenRole } from "./encodings.js";
import type { GeoLayerSpec, LayerData } from "./layers.js";

/** Une couleur deck.gl : RGBA en 0-255 (alpha inclus), l'exact format des accessors deck. */
export type DeckColor = readonly [red: number, green: number, blue: number, alpha: number];

/** Feature structurel minimal (les accessors deck reçoivent la feature GeoJSON) — pas de couplage renderer. */
export interface AccessorFeature {
  properties: Readonly<Record<string, unknown>> | null;
}

/** Canal couleur compilé : une couleur constante OU un accessor `(feature) => DeckColor`. */
export type DeckColorAccessor = DeckColor | ((feature: AccessorFeature) => DeckColor);

/** Canal numérique compilé : une valeur constante OU un accessor `(feature) => number`. */
export type DeckNumberAccessor = number | ((feature: AccessorFeature) => number);

// ── Parse couleur PUR-TS (remplace colorjs.io) — hex + rgb()/rgba(), jamais deviné. ──────

function clampByte(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}

function hexPair(hex: string, at: number): number {
  const byte = Number.parseInt(hex.slice(at, at + 2), 16);
  if (Number.isNaN(byte)) throw new Error(`Unsupported hex color: #${hex}`);
  return byte;
}

/**
 * Parse une valeur primitive de la TokenMap (hex `#rgb`/`#rrggbb`/`#rrggbbaa` OU
 * `rgb()`/`rgba()`, le format que l'adapter résout depuis les `--st-*`) en {@link DeckColor}.
 * Jamais deviné : une valeur non reconnue THROW (anti-invention, pas de couleur inventée).
 */
export function parseTokenColor(value: string): DeckColor {
  const v = value.trim();
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    if (hex.length === 3) {
      const full = hex.replace(/(.)/g, "$1$1");
      return [hexPair(full, 0), hexPair(full, 2), hexPair(full, 4), 255];
    }
    if (hex.length === 6) return [hexPair(hex, 0), hexPair(hex, 2), hexPair(hex, 4), 255];
    if (hex.length === 8) return [hexPair(hex, 0), hexPair(hex, 2), hexPair(hex, 4), hexPair(hex, 6)];
    throw new Error(`Unsupported hex color: ${value}`);
  }
  const group = /^rgba?\(([^)]+)\)$/i.exec(v)?.[1];
  if (group !== undefined) {
    const parts = group.split(/[,/]/).map((s) => Number(s.trim().replace("%", "")));
    const [r, g, b, a] = parts;
    if (
      r !== undefined && g !== undefined && b !== undefined &&
      [r, g, b].every((n) => Number.isFinite(n)) &&
      (parts.length === 3 || (a !== undefined && Number.isFinite(a)))
    ) {
      const alpha = a ?? 1;
      return [clampByte(r), clampByte(g), clampByte(b), clampByte(alpha <= 1 ? alpha * 255 : alpha)];
    }
  }
  throw new Error(`Unsupported token color (expected hex or rgb/rgba): ${value}`);
}

function resolveToken(tokens: TokenMap, role: TokenRole): string {
  if (!Object.hasOwn(tokens, role) || tokens[role] === undefined) {
    throw new Error(`Missing resolved token for role: ${role}`);
  }
  return tokens[role];
}

function resolveColor(tokens: TokenMap, role: TokenRole): DeckColor {
  return parseTokenColor(resolveToken(tokens, role));
}

function assertIncreasingDomain(domain: readonly [number, number], subject: string): void {
  if (!(domain[0] < domain[1])) throw new Error(`The ${subject} domain must be strictly increasing`);
}

function numericProperty(feature: AccessorFeature, field: string): number {
  const value = feature.properties?.[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected a finite numeric property: ${field}`);
  }
  return value;
}

function lerpColor(from: DeckColor, to: DeckColor, t: number): DeckColor {
  const at = (a: number, b: number): number => clampByte(a + (b - a) * t);
  return [at(from[0], to[0]), at(from[1], to[1]), at(from[2], to[2]), at(from[3], to[3])];
}

// ── Compile couleur → accessor deck (parité de sélection avec paint-compiler). ───────────

/**
 * Compile un canal couleur neutre en accessor deck.gl. La sélection de token est
 * IDENTIQUE à `compileColorEncoding` (paint-compiler) : `category` retombe sur le PREMIER
 * mapping (fallback déterministe), `valueStep` change de bin à chaque borne `upTo`
 * précédente (borne terminale = +∞), `valueRamp` interpole linéairement sur `domain`.
 */
export function compileColorEncodingDeck(encoding: ColorEncoding, tokens: TokenMap): DeckColorAccessor {
  switch (encoding.by) {
    case "constant":
      return resolveColor(tokens, encoding.token);

    case "category": {
      const entries = Object.entries(encoding.map);
      const first = entries[0];
      if (!first) throw new Error("A category color encoding requires at least one token mapping");
      const fallback = resolveColor(tokens, first[1]);
      const byValue = new Map<string, DeckColor>(entries.map(([value, token]) => [value, resolveColor(tokens, token)]));
      return (feature) => byValue.get(String(feature.properties?.[encoding.field])) ?? fallback;
    }

    case "valueStep": {
      if (encoding.stops.length === 0) throw new Error("A valueStep color encoding requires at least one stop");
      let previous = Number.NEGATIVE_INFINITY;
      const resolved = encoding.stops.map((stop) => {
        if (stop.upTo <= previous) throw new Error("A valueStep color encoding must have strictly increasing stops");
        previous = stop.upTo;
        return resolveColor(tokens, stop.token);
      });
      const first = resolved[0];
      if (first === undefined) throw new Error("A valueStep color encoding requires at least one stop");
      if (resolved.length === 1) return first;
      const bounds = encoding.stops;
      return (feature) => {
        const value = numericProperty(feature, encoding.field);
        for (let index = 0; index < resolved.length - 1; index += 1) {
          if (value < bounds[index]!.upTo) return resolved[index]!;
        }
        return resolved[resolved.length - 1]!;
      };
    }

    case "valueRamp": {
      assertIncreasingDomain(encoding.domain, "valueRamp color encoding");
      if (encoding.ramp.length === 0) throw new Error("A valueRamp color encoding requires at least one token");
      const resolved = encoding.ramp.map((token) => resolveColor(tokens, token));
      const first = resolved[0]!;
      if (resolved.length === 1) return first;
      const [min, max] = encoding.domain;
      const intervalCount = resolved.length - 1;
      const stopValues = resolved.map((_, index) => min + ((max - min) * index) / intervalCount);
      return (feature) => {
        const value = numericProperty(feature, encoding.field);
        if (value <= min) return first;
        if (value >= max) return resolved[resolved.length - 1]!;
        for (let index = 0; index < resolved.length - 1; index += 1) {
          const lo = stopValues[index]!;
          const hi = stopValues[index + 1]!;
          if (value >= lo && value <= hi) return lerpColor(resolved[index]!, resolved[index + 1]!, (value - lo) / (hi - lo));
        }
        return resolved[resolved.length - 1]!;
      };
    }
  }
}

/**
 * Compile un canal numérique neutre en accessor deck. Parité avec `compileNumberEncoding` :
 * `value` interpole linéairement `domain`→`range`, CLAMPÉ aux bornes (comme l'`interpolate`
 * MapLibre par défaut).
 */
export function compileNumberEncodingDeck(encoding: NumberEncoding): DeckNumberAccessor {
  if (encoding.by === "constant") return encoding.value;
  assertIncreasingDomain(encoding.domain, "value number encoding");
  const [domainMin, domainMax] = encoding.domain;
  const [rangeMin, rangeMax] = encoding.range;
  return (feature) => {
    const value = numericProperty(feature, encoding.field);
    const ratio = Math.min(1, Math.max(0, (value - domainMin) / (domainMax - domainMin)));
    return rangeMin + ratio * (rangeMax - rangeMin);
  };
}

// ── Projection couche → sous-couches deck (miroir de projectMaplibreLayer). ──────────────

/** Une sous-couche deck compilée : un accessor par canal + la structure/data (le mount W10 la consomme). */
export interface DeckSubLayer {
  id: string;
  type: "fill" | "line" | "circle" | "symbol";
  getColor?: DeckColorAccessor;
  getWidth?: DeckNumberAccessor;
  getRadius?: DeckNumberAccessor;
  opacity?: DeckNumberAccessor;
  textField?: string;
  data: LayerData;
  visible: boolean;
}

/** Projection deck d'une couche : les sous-couches ordonnées, comme MaplibreLayerProjection. */
export interface DeckLayerProjection {
  readonly layers: readonly DeckSubLayer[];
}

function subLayer(layer: GeoLayerSpec, id: string, type: DeckSubLayer["type"], rest: Omit<DeckSubLayer, "id" | "type" | "data" | "visible">): DeckSubLayer {
  return { id, type, data: layer.data, visible: layer.visible !== false, ...rest };
}

/** Compile une couche neutre en projection deck (parité de décomposition avec projectMaplibreLayer). */
export function projectDeckLayer(layer: GeoLayerSpec, tokens: TokenMap): DeckLayerProjection {
  switch (layer.kind) {
    case "choropleth": {
      const layers: DeckSubLayer[] = [
        subLayer(layer, layer.id, "fill", {
          getColor: compileColorEncodingDeck(layer.fill.color, tokens),
          ...(layer.fill.opacity ?? layer.opacity ? { opacity: compileNumberEncodingDeck((layer.fill.opacity ?? layer.opacity)!) } : {}),
        }),
      ];
      if (layer.outline) {
        layers.push(
          subLayer(layer, `${layer.id}::outline`, "line", {
            getColor: compileColorEncodingDeck(layer.outline.color, tokens),
            ...(layer.outline.width ? { getWidth: compileNumberEncodingDeck(layer.outline.width) } : {}),
          }),
        );
      }
      return { layers };
    }
    case "points":
      return {
        layers: [
          subLayer(layer, layer.id, "circle", {
            getColor: compileColorEncodingDeck(layer.color, tokens),
            getRadius: compileNumberEncodingDeck(layer.radius),
          }),
        ],
      };
    case "geojson": {
      if (!layer.fill && !layer.outline && !layer.points && !layer.label) {
        throw new Error("A geojson layer requires at least one renderable sub-spec");
      }
      const layers: DeckSubLayer[] = [];
      if (layer.fill) layers.push(subLayer(layer, layer.id, "fill", { getColor: compileColorEncodingDeck(layer.fill.color, tokens) }));
      if (layer.outline) {
        layers.push(
          subLayer(layer, `${layer.id}::outline`, "line", {
            getColor: compileColorEncodingDeck(layer.outline.color, tokens),
            ...(layer.outline.width ? { getWidth: compileNumberEncodingDeck(layer.outline.width) } : {}),
          }),
        );
      }
      if (layer.points) {
        layers.push(
          subLayer(layer, layer.fill ? `${layer.id}::points` : layer.id, "circle", {
            getColor: compileColorEncodingDeck(layer.points.color, tokens),
            getRadius: compileNumberEncodingDeck(layer.points.radius),
          }),
        );
      }
      if (layer.label) {
        const primaryLabel = !layer.fill && !layer.points;
        layers.push(
          subLayer(layer, primaryLabel ? layer.id : `${layer.id}::label`, "symbol", {
            ...(layer.label.color ? { getColor: compileColorEncodingDeck(layer.label.color, tokens) } : {}),
            textField: layer.label.field,
          }),
        );
      }
      return { layers };
    }
  }
}

/**
 * Construit le projecteur deck pour un thème résolu. Le reconstruire avec une nouvelle
 * TokenMap produit de nouveaux accessors (F7b : `setTokens` ré-applique), sans état retenu.
 */
export function createDeckLayerProjector(tokens: TokenMap): (layer: GeoLayerSpec) => DeckLayerProjection {
  return (layer) => projectDeckLayer(layer, tokens);
}
