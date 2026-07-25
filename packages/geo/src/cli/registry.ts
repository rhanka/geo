/**
 * Source registry (ADR-0017). The engine resolves a source's manifest and its
 * per-dataset normalizers from injected continent {@link SourceRegistry}s — it
 * never statically imports a source package (that would cycle the workspace
 * graph). `buildRegistry(registries)` adapts the unified `{ manifests, recipes }`
 * contract into a lookup keyed by source id; the bin loads the continents
 * dynamically (see {@link import("./continents.js").loadContinentRegistries}).
 *
 * Recipe resolution: a dataset names its bespoke normalizer via `recipe: "<id>"`,
 * resolved against the registry's `recipes`. A dataset with no `recipe` falls
 * back to the engine's default GeoJSON passthrough at acquire time.
 */

import type { NormalizerFn, SourceManifest, SourceRegistry } from "@sentropic/geo-core";

import { loadContinentRegistries } from "./continents.js";

/**
 * A registered source: its manifest plus the per-dataset recipes (bespoke
 * normalizers), keyed by dataset id. Built from a continent
 * {@link SourceRegistry} by resolving each dataset's `recipe` tag.
 */
export interface RegisteredSource {
  manifest: SourceManifest;
  /** Per-dataset normalizer, keyed by dataset id (absent → default passthrough). */
  recipes: Record<string, NormalizerFn>;
}

/**
 * Build a source-id → {@link RegisteredSource} lookup from continent
 * {@link SourceRegistry}s. Each manifest's datasets are matched to their recipe
 * via the dataset's `recipe` id (resolved against the registry's `recipes`).
 * Throws when a dataset references a recipe id the registry does not define.
 */
export function buildRegistry(
  registries: SourceRegistry[],
): Map<string, RegisteredSource> {
  const lookup = new Map<string, RegisteredSource>();
  for (const registry of registries) {
    for (const manifest of registry.manifests) {
      const recipes: Record<string, NormalizerFn> = {};
      for (const dataset of manifest.datasets) {
        if (dataset.recipe === undefined) continue;
        const recipe = registry.recipes[dataset.recipe];
        if (!recipe) {
          throw new Error(
            `source "${manifest.id}" dataset "${dataset.id}" references unknown ` +
              `recipe "${dataset.recipe}" (registered recipes: ` +
              `${Object.keys(registry.recipes).join(", ") || "none"})`,
          );
        }
        recipes[dataset.id] = recipe;
      }
      lookup.set(manifest.id, { manifest, recipes });
    }
  }
  return lookup;
}

/**
 * Build the default registry from every installed continent library, loaded
 * dynamically and optionally (ADR-0017). Async because the continents are pulled
 * in via dynamic `import()`; commands `await` it when no registry is injected.
 */
export async function loadDefaultRegistry(): Promise<Map<string, RegisteredSource>> {
  return buildRegistry(await loadContinentRegistries());
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
