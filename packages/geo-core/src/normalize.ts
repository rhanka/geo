/**
 * Normalizer contract & the source registry shape.
 *
 * A normalizer turns a source's raw payload into a standard normalized
 * collection. geo-core owns only the *types* and the pure helper
 * {@link featuresToCollection}; the concrete engine normalizers (the GeoJSON
 * passthrough, the GDAL/CSV pipelines) live in `@sentropic/geo`. Keeping these
 * types and the pure wrapper here lets the continent source libraries
 * (`@sentropic/geo-sources-*`) depend on `@sentropic/geo-core` alone for their
 * recipes, with no edge back to the Node engine — which is what keeps the
 * workspace dependency graph acyclic.
 */

import type {
  AdminFeature,
  AdminFeatureCollection,
  ReferentialFeatureCollection,
} from "./feature.js";
import type { DatasetManifest, SourceManifest } from "./source-manifest.js";

/** Context handed to every normalizer: the source and the dataset being acquired. */
export interface NormalizeContext {
  manifest: SourceManifest;
  dataset: DatasetManifest;
}

/** Transforms a raw payload into a normalized administrative collection. */
export type Normalizer = (raw: unknown, ctx: NormalizeContext) => AdminFeatureCollection;

/**
 * A CSV normalizer turns parsed rows (`{ column: value }` maps from the RFC 4180
 * parser) into a {@link ReferentialFeatureCollection}.
 */
export type CsvNormalizer = (
  rows: Record<string, string>[],
  ctx: NormalizeContext,
) => ReferentialFeatureCollection;

/**
 * A geometry-bearing referential normalizer: maps a raw payload (e.g. `ogr2ogr`
 * GeoJSON) to a {@link ReferentialFeatureCollection} rather than admin units.
 */
export type ReferentialNormalizer = (
  raw: unknown,
  ctx: NormalizeContext,
) => ReferentialFeatureCollection;

/**
 * Any of the three normalizer shapes a source recipe can take. The engine
 * (`@sentropic/geo`) dispatches to the right acquisition slot based on the
 * dataset's `format` (and any `recipe` tag).
 */
export type NormalizerFn = Normalizer | CsvNormalizer | ReferentialNormalizer;

/**
 * Declarative field-mapping for the generic, code-free normalizer (ADR-0017).
 * Most sources can be normalized by naming which raw property feeds each
 * standard {@link import("./feature.js").AdminProperties} field, instead of
 * shipping a bespoke recipe.
 *
 * NOTE (packages-v2, de-risked mode): the generic field-map normalizer is
 * declared as a contract here but its full engine implementation is deferred —
 * existing bespoke recipes are preserved verbatim. See ADR-0017 / migration
 * plan phase D4 (deferred).
 */
export interface FieldMap {
  /** Raw property name(s) to read the feature name from (first non-empty wins). */
  name?: string | readonly string[];
  /** Raw property name(s) to read the administrative code from. */
  code?: string | readonly string[];
  /** Raw property name(s) to read an ISO 3166 code from. */
  iso?: string | readonly string[];
  /** Raw property name(s) to read a stable geo id from (else one is derived). */
  geoId?: string | readonly string[];
  /** Raw property name(s) to read the parent geo id from. */
  parentGeoId?: string | readonly string[];
}

/**
 * The unified source-registry contract (ADR-0017). A continent source library
 * exposes its declarative {@link SourceManifest}s plus the bespoke recipes those
 * manifests reference by `recipe: "<id>"`. The engine consumes
 * `{ manifests, recipes }` to build its acquisition registry, with no static
 * dependency from the engine onto the continent libraries.
 */
export interface SourceRegistry {
  manifests: SourceManifest[];
  recipes: Record<string, NormalizerFn>;
}

/** Wrap a list of normalized features into an {@link AdminFeatureCollection}. */
export function featuresToCollection(
  features: AdminFeature[],
): AdminFeatureCollection {
  return { type: "FeatureCollection", features };
}
