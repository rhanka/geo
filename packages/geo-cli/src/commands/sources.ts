/**
 * `geo sources list` / `geo sources show <sourceId>` — list and inspect the
 * registered sources. Pure functions returning plain data so they are trivial
 * to unit-test; the commander layer handles printing.
 */

import { resolveManifestLicense } from "@sentropic/geo-core";

import { defaultRegistry, getSource, type RegisteredSource } from "../registry.js";

export interface SourceSummary {
  id: string;
  title: string;
  kind: string;
  jurisdiction: string;
  license: string;
  redistributable: boolean;
  datasetIds: string[];
}

export interface DatasetSummary {
  id: string;
  title: string;
  format: string;
  adminLevel?: string;
  layer?: string | number;
}

export interface SourceDetail extends SourceSummary {
  description?: string;
  provider: string;
  providerUrl?: string;
  homepage?: string;
  attributionRequired: boolean;
  datasets: DatasetSummary[];
}

function jurisdictionOf(source: RegisteredSource): string {
  const { country, subdivision } = source.manifest.jurisdiction;
  return subdivision ?? country;
}

function toSummary(source: RegisteredSource): SourceSummary {
  const license = resolveManifestLicense(source.manifest);
  return {
    id: source.manifest.id,
    title: source.manifest.title,
    kind: source.manifest.kind ?? "administrative",
    jurisdiction: jurisdictionOf(source),
    license: license.id,
    redistributable: license.redistributable,
    datasetIds: source.manifest.datasets.map((d) => d.id),
  };
}

/** List all registered sources as summaries. */
export function listSources(
  registry: Map<string, RegisteredSource> = defaultRegistry(),
): SourceSummary[] {
  return [...registry.values()].map(toSummary);
}

/** Inspect a single source by id. Throws if the source is unknown. */
export function showSource(
  sourceId: string,
  registry: Map<string, RegisteredSource> = defaultRegistry(),
): SourceDetail {
  const source = getSource(registry, sourceId);
  const license = resolveManifestLicense(source.manifest);
  const detail: SourceDetail = {
    ...toSummary(source),
    provider: source.manifest.provider.name,
    attributionRequired: license.attributionRequired,
    datasets: source.manifest.datasets.map((d): DatasetSummary => {
      const ds: DatasetSummary = { id: d.id, title: d.title, format: d.format };
      if (d.adminLevel !== undefined) ds.adminLevel = d.adminLevel;
      if (d.layer !== undefined) ds.layer = d.layer;
      return ds;
    }),
  };
  if (source.manifest.description !== undefined) detail.description = source.manifest.description;
  if (source.manifest.provider.url !== undefined) detail.providerUrl = source.manifest.provider.url;
  if (source.manifest.homepage !== undefined) detail.homepage = source.manifest.homepage;
  return detail;
}

/** Render a source summary list as human-readable lines. */
export function formatSourceList(sources: SourceSummary[]): string {
  if (sources.length === 0) return "No sources registered.";
  return sources
    .map(
      (s) =>
        `${s.id}\n  ${s.title}\n  kind=${s.kind} jurisdiction=${s.jurisdiction} ` +
        `license=${s.license}${s.redistributable ? "" : " (NOT redistributable)"}\n  ` +
        `datasets: ${s.datasetIds.join(", ")}`,
    )
    .join("\n\n");
}

/** Render a source detail as human-readable lines. */
export function formatSourceDetail(detail: SourceDetail): string {
  const lines: string[] = [
    `${detail.id} — ${detail.title}`,
    detail.description ? `  ${detail.description}` : undefined,
    `  kind: ${detail.kind}`,
    `  jurisdiction: ${detail.jurisdiction}`,
    `  provider: ${detail.provider}${detail.providerUrl ? ` <${detail.providerUrl}>` : ""}`,
    detail.homepage ? `  homepage: ${detail.homepage}` : undefined,
    `  license: ${detail.license}` +
      ` (redistributable=${detail.redistributable}, attribution=${detail.attributionRequired})`,
    `  datasets:`,
    ...detail.datasets.map(
      (d) =>
        `    - ${d.id} [${d.format}` +
        `${d.adminLevel ? `, level=${d.adminLevel}` : ""}` +
        `${d.layer !== undefined ? `, layer=${d.layer}` : ""}] ${d.title}`,
    ),
  ].filter((line): line is string => line !== undefined);
  return lines.join("\n");
}
