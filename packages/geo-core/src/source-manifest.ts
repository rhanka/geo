/**
 * Source Manifest — the declarative contract describing where a dataset comes
 * from, under which license, and how to acquire it. It is the single source of
 * truth consumed by `@sentropic/geo-acquire` and the `geo` CLI.
 */

import type { AdminLevel, CountryCode, SubdivisionCode } from "./admin.js";
import type { CrsCode } from "./crs.js";
import type { License, LicenseId } from "./license.js";
import { resolveLicense } from "./license.js";
import type { FieldMap } from "./normalize.js";

export type DatasetFormat =
  | "geojson"
  | "topojson"
  | "shp"
  | "gpkg"
  | "fgdb"
  | "csv"
  | "arcgis-rest"
  | "wms"
  | "wfs";

export type AccessLevel = "open" | "restricted";

/**
 * Publication/use-rights profile exposed by the API. It is deliberately
 * separate from the license id: a source may be technically public but still
 * have rights pending qualification for demo-only consumption.
 */
export type RightsProfile = "open" | "demo-unverified" | "blocked";

/**
 * What kind of referential a source publishes. Administrative boundaries,
 * statistical geographies (e.g. INSEE, Statistics Canada census units), and
 * postal referentials (postal code ↔ geography) have distinct providers,
 * licenses and update cadences, so they are tagged explicitly.
 */
export type SourceKind = "administrative" | "statistical" | "postal";

export interface Checksum {
  algo: "sha256";
  value: string;
}

export interface DatasetManifest {
  /** Local id within the source, e.g. "regions". Unique per source. */
  id: string;
  title: string;
  description?: string;
  format: DatasetFormat;
  /** Download URL or service endpoint. */
  url: string;
  /** Source CRS; defaults to WGS84 for `geojson`/`topojson`. */
  crs?: CrsCode;
  /** Administrative level the features represent. */
  adminLevel?: AdminLevel;
  /** Layer id/name for `arcgis-rest` / `wms` / `wfs`. */
  layer?: string | number;
  /** Extra service/query parameters. */
  query?: Record<string, string | number | boolean>;
  /** Update frequency (ISO 8601 duration or free text). */
  updateCadence?: string;
  /** Expected checksum of the raw download, when pinned. */
  checksum?: Checksum;
  /** Access level; defaults to "open". */
  access?: AccessLevel;
  /**
   * Declarative field-mapping for the generic, code-free normalizer (ADR-0017).
   * When present, the engine can normalize this dataset without a bespoke
   * recipe by mapping raw properties onto standard fields. Mutually informative
   * with {@link recipe}: a dataset uses one or the other.
   */
  fieldMap?: FieldMap;
  /**
   * Recipe id referencing a bespoke normalizer in the source library's
   * {@link import("./normalize.js").SourceRegistry} `recipes`, for sources the
   * generic field-map cannot express (e.g. StatCan CSD name-join, `.7z` bulk,
   * XML fetchers). The engine resolves `recipes[recipe]` and dispatches it to
   * the acquisition slot matching the dataset's `format`.
   */
  recipe?: string;
}

export interface SourceManifest {
  /** Globally unique source id, e.g. "ca-qc/decoupages-administratifs". */
  id: string;
  title: string;
  description?: string;
  /** Referential kind; defaults to "administrative" when omitted. */
  kind?: SourceKind;
  jurisdiction: {
    country: CountryCode;
    subdivision?: SubdivisionCode;
    level?: AdminLevel;
  };
  provider: {
    name: string;
    url?: string;
    email?: string;
  };
  /** Either a known {@link LicenseId} or an inline {@link License}. */
  license: LicenseId | License;
  /**
   * API publication/use profile. Defaults to `open` for redistributable
   * licenses and `blocked` otherwise. Set `demo-unverified` only for official
   * public sources whose rights are still being qualified.
   */
  rightsProfile?: RightsProfile;
  /** Dataset landing/catalog page. */
  homepage?: string;
  datasets: DatasetManifest[];
}

const DATASET_FORMATS: readonly DatasetFormat[] = [
  "geojson",
  "topojson",
  "shp",
  "gpkg",
  "fgdb",
  "csv",
  "arcgis-rest",
  "wms",
  "wfs",
];

export type ValidationResult =
  | { ok: true; value: SourceManifest }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate an untrusted value as a {@link SourceManifest}. Returns the typed
 * value on success or a list of human-readable errors. Dependency-free; does
 * not throw.
 */
export function validateSourceManifest(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  if (typeof input["id"] !== "string" || input["id"].length === 0) {
    errors.push("id: required non-empty string");
  }
  if (typeof input["title"] !== "string" || input["title"].length === 0) {
    errors.push("title: required non-empty string");
  }

  const jurisdiction = input["jurisdiction"];
  if (!isRecord(jurisdiction)) {
    errors.push("jurisdiction: required object");
  } else if (typeof jurisdiction["country"] !== "string") {
    errors.push("jurisdiction.country: required ISO 3166-1 alpha-2 string");
  }

  const provider = input["provider"];
  if (!isRecord(provider)) {
    errors.push("provider: required object");
  } else if (typeof provider["name"] !== "string" || provider["name"].length === 0) {
    errors.push("provider.name: required non-empty string");
  }

  const kind = input["kind"];
  if (
    kind !== undefined &&
    kind !== "administrative" &&
    kind !== "statistical" &&
    kind !== "postal"
  ) {
    errors.push('kind: must be one of "administrative", "statistical", "postal"');
  }

  if (input["license"] === undefined) {
    errors.push("license: required (LicenseId or License)");
  }

  const rightsProfile = input["rightsProfile"];
  if (
    rightsProfile !== undefined &&
    rightsProfile !== "open" &&
    rightsProfile !== "demo-unverified" &&
    rightsProfile !== "blocked"
  ) {
    errors.push('rightsProfile: must be one of "open", "demo-unverified", "blocked"');
  }

  const datasets = input["datasets"];
  if (!Array.isArray(datasets) || datasets.length === 0) {
    errors.push("datasets: required non-empty array");
  } else {
    datasets.forEach((dataset, index) => {
      if (!isRecord(dataset)) {
        errors.push(`datasets[${index}]: must be an object`);
        return;
      }
      if (typeof dataset["id"] !== "string" || dataset["id"].length === 0) {
        errors.push(`datasets[${index}].id: required non-empty string`);
      }
      if (typeof dataset["url"] !== "string" || dataset["url"].length === 0) {
        errors.push(`datasets[${index}].url: required non-empty string`);
      }
      if (
        typeof dataset["format"] !== "string" ||
        !DATASET_FORMATS.includes(dataset["format"] as DatasetFormat)
      ) {
        errors.push(
          `datasets[${index}].format: required one of ${DATASET_FORMATS.join(", ")}`,
        );
      }
    });
    const ids = datasets
      .filter(isRecord)
      .map((dataset) => dataset["id"])
      .filter((id): id is string => typeof id === "string");
    if (new Set(ids).size !== ids.length) {
      errors.push("datasets: ids must be unique within a source");
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as SourceManifest };
}

/** Resolve a manifest's license (id or inline) to a concrete {@link License}. */
export function resolveManifestLicense(manifest: SourceManifest): License {
  return resolveLicense(manifest.license);
}

/** Whether the manifest's license permits re-hosting / republication. */
export function isRedistributable(manifest: SourceManifest): boolean {
  return resolveManifestLicense(manifest).redistributable;
}

/** Find a dataset within a source by its local id. */
export function getDataset(
  manifest: SourceManifest,
  datasetId: string,
): DatasetManifest | undefined {
  return manifest.datasets.find((dataset) => dataset.id === datasetId);
}

/** Fully-qualified dataset reference, e.g. "ca-qc/.../regions". */
export function datasetRef(manifest: SourceManifest, dataset: DatasetManifest): string {
  return `${manifest.id}#${dataset.id}`;
}
