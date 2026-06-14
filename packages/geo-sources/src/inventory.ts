/**
 * Aggregated geo-source inventory — a typed catalog of every provincial /
 * national geographic source published by `@sentropic/geo`.
 *
 * Capitalized from radar-immobilier's `GeoSourceInventory` (ADR-0013): immo
 * keeps its per-pilot-city zonage/lots availability list; **geo owns the
 * inventory structure and the provincial source entries**. This module is a
 * pure aggregation — it imports each source package's declarative
 * {@link SourceManifest} (no network, no data download) and projects it onto a
 * stable, denormalized {@link InventoryEntry} with the license resolved and the
 * redistribution flag precomputed.
 *
 * Downstream consumers (the `geo` CLI `sources list`, the API `/sources`
 * endpoint, the site catalogue) read this inventory rather than re-importing
 * every source package.
 */

import type {
  AdminLevel,
  CountryCode,
  DatasetFormat,
  License,
  SourceKind,
  SourceManifest,
  SubdivisionCode,
} from "@sentropic/geo-core";
import { attributionLine, resolveManifestLicense } from "@sentropic/geo-core";

// ── Source manifests, imported from each source package ──────────────────────
// Canada — federal
import { registerSource as registerCa } from "@sentropic/geo-source-ca";
import { registerSource as registerCaPostal } from "@sentropic/geo-source-ca-postal";
// Canada — Québec
import {
  registerSource as registerCaQc,
  registerStatCanCsdSource as registerCaQcCsd,
} from "@sentropic/geo-source-ca-qc";
import { registerSources as registerCaQcConstraints } from "@sentropic/geo-source-ca-qc-constraints";
import { registerSource as registerCaQcCadastre } from "@sentropic/geo-source-ca-qc-cadastre";
// Québec civic sources expose their manifests directly (no register* fn).
import {
  adressesManifest,
  roleManifest,
} from "@sentropic/geo-source-ca-qc-civic";
// France
import { registerSource as registerFr } from "@sentropic/geo-source-fr";
import { registerSource as registerFrPostal } from "@sentropic/geo-source-fr-postal";
import { registerSource as registerFrStat } from "@sentropic/geo-source-fr-stat";

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
 * Collect every source manifest from the workspace's source packages, using
 * each package's `registerSource()` / `registerSources()` export, or its
 * directly-exported `manifest` when no register fn exists.
 */
function collectManifests(): SourceManifest[] {
  return [
    // Canada — federal
    registerCa().manifest,
    registerCaPostal().manifest,
    // Canada — Québec
    registerCaQc().manifest,
    registerCaQcCsd().manifest,
    registerCaQcCadastre().manifest,
    ...registerCaQcConstraints().map((source) => source.manifest),
    // Québec civic — manifests exported directly
    adressesManifest,
    roleManifest,
    // France
    registerFr().manifest,
    registerFrPostal().manifest,
    registerFrStat().manifest,
  ];
}

/**
 * The aggregated, typed inventory of every geo source. Sorted by `sourceId` for
 * stable ordering. Built once at module load from declarative manifests only.
 */
export const INVENTORY: InventoryEntry[] = collectManifests()
  .map(toEntry)
  .sort((a, b) => a.sourceId.localeCompare(b.sourceId));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Every inventory entry. */
export function allSources(): InventoryEntry[] {
  return INVENTORY;
}

/**
 * Entries whose jurisdiction country matches `cc` (ISO 3166-1 alpha-2,
 * case-insensitive).
 */
export function byCountry(cc: CountryCode): InventoryEntry[] {
  const needle = cc.toUpperCase();
  return INVENTORY.filter(
    (entry) => entry.jurisdiction.country.toUpperCase() === needle,
  );
}

/** Entries of a given {@link SourceKind}. */
export function byKind(kind: SourceKind): InventoryEntry[] {
  return INVENTORY.filter((entry) => entry.kind === kind);
}

/** The entry for a given source id, if present. */
export function bySourceId(id: string): InventoryEntry | undefined {
  return INVENTORY.find((entry) => entry.sourceId === id);
}

/** The datasets declared by a given source id (empty if the source is unknown). */
export function datasetsFor(sourceId: string): InventoryDataset[] {
  return bySourceId(sourceId)?.datasets ?? [];
}

/** Entries whose license permits re-hosting / republication. */
export function redistributableSources(): InventoryEntry[] {
  return INVENTORY.filter((entry) => entry.redistributable);
}
