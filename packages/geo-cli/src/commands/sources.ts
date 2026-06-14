/**
 * `geo sources list` / `geo sources show <sourceId>` — list and inspect the
 * full geo source catalog. These read from the aggregated, typed
 * `@sentropic/geo-sources` INVENTORY (all 13 sources), not the CLI's
 * normalizer registry (which only covers sources the CLI can `fetch`).
 *
 * Pure functions returning plain data so they are trivial to unit-test; the
 * commander layer handles printing.
 */

import {
  allSources,
  byCountry,
  byKind,
  bySourceId,
  datasetsFor,
  type InventoryEntry,
} from "@sentropic/geo-sources";

export interface SourceSummary {
  id: string;
  title: string;
  kind: string;
  jurisdiction: string;
  license: string;
  redistributable: boolean;
  attribution: string;
  datasetIds: string[];
}

export interface DatasetSummary {
  id: string;
  title: string;
  format: string;
  adminLevel?: string;
}

export interface SourceDetail extends SourceSummary {
  country: string;
  subdivision?: string;
  level?: string;
  datasets: DatasetSummary[];
}

/** Optional filters for `listSources` (mirrors `geo sources list` flags). */
export interface SourceListFilters {
  country?: string;
  kind?: string;
}

/** Render an entry's jurisdiction as the most specific available code. */
function jurisdictionOf(entry: InventoryEntry): string {
  return entry.jurisdiction.subdivision ?? entry.jurisdiction.country;
}

function toSummary(entry: InventoryEntry): SourceSummary {
  return {
    id: entry.sourceId,
    title: entry.title,
    kind: entry.kind,
    jurisdiction: jurisdictionOf(entry),
    license: entry.license.id,
    redistributable: entry.redistributable,
    attribution: entry.attribution,
    datasetIds: entry.datasets.map((d) => d.id),
  };
}

/**
 * List the source catalog as summaries, optionally filtered by `--country`
 * (ISO 3166-1 alpha-2, case-insensitive) and/or `--kind` (source kind).
 */
export function listSources(filters: SourceListFilters = {}): SourceSummary[] {
  let entries: InventoryEntry[] = filters.country
    ? byCountry(filters.country)
    : allSources();
  if (filters.kind) {
    const kinds = new Set(byKind(filters.kind as InventoryEntry["kind"]));
    entries = entries.filter((entry) => kinds.has(entry));
  }
  return entries.map(toSummary);
}

/** Inspect a single source by id. Throws if the source is unknown. */
export function showSource(sourceId: string): SourceDetail {
  const entry = bySourceId(sourceId);
  if (!entry) {
    const known = allSources()
      .map((e) => e.sourceId)
      .join(", ");
    throw new Error(`unknown source "${sourceId}" (registered: ${known || "none"})`);
  }
  const detail: SourceDetail = {
    ...toSummary(entry),
    country: entry.jurisdiction.country,
    datasets: datasetsFor(sourceId).map((d): DatasetSummary => {
      const ds: DatasetSummary = { id: d.id, title: d.title, format: d.format };
      if (d.adminLevel !== undefined) ds.adminLevel = d.adminLevel;
      return ds;
    }),
  };
  if (entry.jurisdiction.subdivision !== undefined) {
    detail.subdivision = entry.jurisdiction.subdivision;
  }
  if (entry.jurisdiction.level !== undefined) detail.level = entry.jurisdiction.level;
  return detail;
}

/** Render a source summary list as human-readable lines. */
export function formatSourceList(sources: SourceSummary[]): string {
  if (sources.length === 0) return "No sources match.";
  return sources
    .map(
      (s) =>
        `${s.id}\n  ${s.title}\n  kind=${s.kind} jurisdiction=${s.jurisdiction} ` +
        `license=${s.license}${s.redistributable ? "" : " (NOT redistributable)"}\n  ` +
        `attribution: ${s.attribution}\n  ` +
        `datasets: ${s.datasetIds.join(", ")}`,
    )
    .join("\n\n");
}

/** Render a source detail as human-readable lines. */
export function formatSourceDetail(detail: SourceDetail): string {
  const jurisdiction =
    `${detail.country}` +
    `${detail.subdivision ? `/${detail.subdivision}` : ""}` +
    `${detail.level ? ` (${detail.level})` : ""}`;
  const lines: string[] = [
    `${detail.id} — ${detail.title}`,
    `  kind: ${detail.kind}`,
    `  jurisdiction: ${jurisdiction}`,
    `  license: ${detail.license}` +
      ` (redistributable=${detail.redistributable})`,
    `  attribution: ${detail.attribution}`,
    `  datasets:`,
    ...detail.datasets.map(
      (d) =>
        `    - ${d.id} [${d.format}` +
        `${d.adminLevel ? `, level=${d.adminLevel}` : ""}] ${d.title}`,
    ),
  ];
  return lines.join("\n");
}
