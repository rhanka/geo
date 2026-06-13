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

export interface NormalizedDataset {
  meta: CollectionMeta;
  collection: AdminFeatureCollection;
}
