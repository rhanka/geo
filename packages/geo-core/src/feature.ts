/**
 * Normalized acquisition output. Every source, whatever its raw format, is
 * normalized into a {@link NormalizedDataset}: a standard WGS84 GeoJSON
 * FeatureCollection of administrative features, plus provenance metadata
 * (source, license, attribution, fetch time). This is what the CLI persists and
 * what `@sentropic/geo-api` serves.
 */

import type { AdminLevel, CountryCode } from "./admin.js";
import type { CrsCode } from "./crs.js";
import type { Feature, FeatureCollection, Geometry } from "./geojson.js";
import type { License } from "./license.js";

/** Standard properties carried by every normalized administrative feature. */
export interface AdminProperties {
  geoId: string;
  name: string;
  level: AdminLevel;
  code?: string;
  iso?: string;
  country: CountryCode;
  parentGeoId?: string;
  /** Source-specific extra attributes are preserved here. */
  [key: string]: unknown;
}

export type AdminFeature = Feature<Geometry, AdminProperties>;
export type AdminFeatureCollection = FeatureCollection<Geometry, AdminProperties>;

/**
 * Properties carried by a normalized **referential** feature — a non-geometry
 * (or null-geometry) crosswalk such as postal code ↔ commune or INSEE/StatCan
 * code mappings. Unlike {@link AdminProperties}, no fields are required: a
 * referential row need not name an administrative unit or carry a level.
 * Source-specific columns are preserved as extra keys.
 */
export interface ReferentialProperties {
  /** Stable id for the referential row, when one can be derived. */
  geoId?: string;
  /** Country the referential pertains to, when known. */
  country?: CountryCode;
  /** Source-specific extra attributes are preserved here. */
  [key: string]: unknown;
}

/**
 * A referential feature. Geometry may be `null` (RFC 7946 §3.2 permits a null
 * geometry), since referential crosswalks are typically attribute-only.
 */
export type ReferentialFeature = Feature<Geometry | null, ReferentialProperties>;
export type ReferentialFeatureCollection = FeatureCollection<
  Geometry | null,
  ReferentialProperties
>;

export interface CollectionMeta {
  /** Originating SourceManifest id. */
  sourceId: string;
  /** Originating dataset id within the source. */
  datasetId: string;
  title: string;
  license: License;
  /** Ready-to-display attribution string. */
  attribution: string;
  /** CRS of the emitted geometry — always WGS84 for compliant output. */
  crs: CrsCode;
  /** ISO 8601 timestamp of acquisition. */
  fetchedAt: string;
  /** Number of features. */
  count: number;
  /** Optional checksum of the normalized payload. */
  checksum?: { algo: "sha256"; value: string };
}

/**
 * Normalized acquisition output: provenance {@link CollectionMeta} plus the
 * emitted collection. The collection type is generic so the same envelope can
 * carry an administrative collection (the default, preserving existing call
 * sites) or a {@link ReferentialFeatureCollection}.
 */
export interface NormalizedDataset<
  C extends AdminFeatureCollection | ReferentialFeatureCollection = AdminFeatureCollection,
> {
  meta: CollectionMeta;
  collection: C;
}
