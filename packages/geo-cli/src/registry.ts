/**
 * Source registry. Aggregates the registered `geo-source-*` packages into a
 * lookup keyed by source id, so commands can resolve a source's manifest and
 * its per-dataset normalizers. Currently the Québec SDA source (`ca-qc/sda`).
 */

import type { SourceManifest } from "@sentropic/geo-core";
import type { Normalizer } from "@sentropic/geo-core";
import { registerSource as registerCaQc } from "@sentropic/geo-source-ca-qc";

/** A registered source: its manifest plus the per-dataset normalizers. */
export interface RegisteredSource {
  manifest: SourceManifest;
  normalizers: Record<string, Normalizer>;
}

/** Build the default registry from all bundled `geo-source-*` packages. */
export function defaultRegistry(): Map<string, RegisteredSource> {
  const registry = new Map<string, RegisteredSource>();
  for (const source of [registerCaQc()]) {
    registry.set(source.manifest.id, source);
  }
  return registry;
}

/** Resolve a source by id from a registry, or throw a clear error. */
export function getSource(
  registry: Map<string, RegisteredSource>,
  sourceId: string,
): RegisteredSource {
  const source = registry.get(sourceId);
  if (!source) {
    const known = [...registry.keys()].join(", ") || "none";
    throw new Error(`unknown source "${sourceId}" (registered: ${known})`);
  }
  return source;
}
