/**
 * Aggregated geo-source inventory — a typed catalog of geographic sources.
 *
 * Capitalized from radar-immobilier's `GeoSourceInventory` (ADR-0013): geo owns
 * the inventory structure; the source *manifests* now live in the continent
 * libraries (`@sentropic/geo-sources-<continent>`). Per ADR-0017 the engine no
 * longer statically imports source packages (that would cycle the workspace
 * graph). Instead, {@link buildInventory} takes the continent
 * {@link SourceRegistry}s as input and projects their declarative
 * {@link SourceManifest}s onto a stable, denormalized {@link InventoryEntry}
 * (license resolved, redistribution flag precomputed) — a pure aggregation, no
 * network and no data download.
 *
 * Downstream consumers (the `geo` CLI `sources list`, the API `/sources`
 * endpoint, the site catalogue) inject the inventory built from the continent
 * registries they bundle.
 */

import type {
  AdminLevel,
  CountryCode,
  DatasetFormat,
  License,
  SourceKind,
  SourceManifest,
  SourceRegistry,
  SubdivisionCode,
} from "@sentropic/geo-core";
import { attributionLine, resolveManifestLicense } from "@sentropic/geo-core";

/** A dataset row inside an {@link InventoryEntry}, projected from a manifest. */
export interface InventoryDataset {
  id: string;
  title: string;
  format: DatasetFormat;
  adminLevel?: AdminLevel;
}

/**
 * One denormalized inventory row: a geo source with its jurisdiction, resolved
 * license, redistribution permission, attribution line and dataset list.
 */
export interface InventoryEntry {
  /** Globally unique source id, e.g. "ca-qc/sda". */
  sourceId: string;
  title: string;
  /** Referential kind; defaults to "administrative" when the manifest omits it. */
  kind: SourceKind;
  jurisdiction: {
    country: CountryCode;
    subdivision?: SubdivisionCode;
    level?: AdminLevel;
  };
  /** Concrete license, resolved from the manifest's id-or-inline license. */
  license: License;
  /** Whether the license permits re-hosting / republication. */
  redistributable: boolean;
  /** Human-readable attribution line for the provider under the license. */
  attribution: string;
  datasets: InventoryDataset[];
}

/** Default kind when a manifest omits it (mirrors geo-core's contract). */
const DEFAULT_KIND: SourceKind = "administrative";

/** Project a {@link SourceManifest} onto a denormalized {@link InventoryEntry}. */
function toEntry(manifest: SourceManifest): InventoryEntry {
  const license = resolveManifestLicense(manifest);
  const jurisdiction: InventoryEntry["jurisdiction"] = {
    country: manifest.jurisdiction.country,
  };
  if (manifest.jurisdiction.subdivision !== undefined) {
    jurisdiction.subdivision = manifest.jurisdiction.subdivision;
  }
  if (manifest.jurisdiction.level !== undefined) {
    jurisdiction.level = manifest.jurisdiction.level;
  }
  return {
    sourceId: manifest.id,
    title: manifest.title,
    kind: manifest.kind ?? DEFAULT_KIND,
    jurisdiction,
    license,
    redistributable: license.redistributable,
    attribution: attributionLine(manifest.provider.name, license),
    datasets: manifest.datasets.map((dataset) => {
      const row: InventoryDataset = {
        id: dataset.id,
        title: dataset.title,
        format: dataset.format,
      };
      if (dataset.adminLevel !== undefined) row.adminLevel = dataset.adminLevel;
      return row;
    }),
  };
}

/**
 * Build the aggregated inventory from one or more continent {@link SourceRegistry}s
 * (ADR-0017). Projects every registry's declarative {@link SourceManifest}s onto
 * {@link InventoryEntry}s, sorted by `sourceId` for stable ordering. Pure: built
 * from manifests only, no network and no data download. Inject the result into
 * `createApp(provider, inventory)` and the CLI source commands.
 */
export function buildInventory(registries: SourceRegistry[]): InventoryEntry[] {
  const entries = registries.flatMap((registry) => registry.manifests.map(toEntry));
  return entries.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

// ── Helpers (pure, operate on a supplied inventory) ──────────────────────────

/** Every inventory entry. */
export function allSources(inventory: InventoryEntry[]): InventoryEntry[] {
  return inventory;
}

/**
 * Entries whose jurisdiction country matches `cc` (ISO 3166-1 alpha-2,
 * case-insensitive).
 */
export function byCountry(
  inventory: InventoryEntry[],
  cc: CountryCode,
): InventoryEntry[] {
  const needle = cc.toUpperCase();
  return inventory.filter(
    (entry) => entry.jurisdiction.country.toUpperCase() === needle,
  );
}

/** Entries of a given {@link SourceKind}. */
export function byKind(
  inventory: InventoryEntry[],
  kind: SourceKind,
): InventoryEntry[] {
  return inventory.filter((entry) => entry.kind === kind);
}

/** The entry for a given source id, if present. */
export function bySourceId(
  inventory: InventoryEntry[],
  id: string,
): InventoryEntry | undefined {
  return inventory.find((entry) => entry.sourceId === id);
}

/** The datasets declared by a given source id (empty if the source is unknown). */
export function datasetsFor(
  inventory: InventoryEntry[],
  sourceId: string,
): InventoryDataset[] {
  return bySourceId(inventory, sourceId)?.datasets ?? [];
}

/** Entries whose license permits re-hosting / republication. */
export function redistributableSources(
  inventory: InventoryEntry[],
): InventoryEntry[] {
  return inventory.filter((entry) => entry.redistributable);
}
