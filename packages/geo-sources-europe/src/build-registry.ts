/**
 * Registry assembly (ADR-0017). Each underlying source exposes a manifest plus a
 * per-dataset normalizer record (named `normalizers` / `csvNormalizers`
 * depending on the source — all are {@link NormalizerFn}s).
 *
 * The engine's `buildRegistry` resolves a dataset's recipe via its
 * `recipe: "<id>"` tag against the registry's `recipes` map. So this helper
 * **tags** each dataset whose id has a normalizer with a stable recipe id
 * (`"<sourceId>#<datasetId>"`) and registers the normalizer under that id —
 * without mutating the original manifest objects (they are cloned). A dataset
 * with no matching normalizer is left untouched (acquired via the engine default).
 */

import type {
  DatasetManifest,
  NormalizerFn,
  SourceManifest,
} from "@sentropic/geo-core";

/** One source's manifest + its per-dataset normalizer recipes (keyed by dataset id). */
export interface SourceRecipes {
  manifest: SourceManifest;
  recipes: Record<string, NormalizerFn>;
}

/** A stable recipe id for a dataset's bespoke normalizer. */
function recipeId(sourceId: string, datasetId: string): string {
  return `${sourceId}#${datasetId}`;
}

/**
 * Assemble continent manifests (with `recipe` tags) + the keyed recipe map from
 * a list of per-source `{ manifest, recipes }`.
 */
export function buildRegistry(sources: SourceRecipes[]): {
  manifests: SourceManifest[];
  recipes: Record<string, NormalizerFn>;
} {
  const manifests: SourceManifest[] = [];
  const recipes: Record<string, NormalizerFn> = {};

  for (const { manifest, recipes: perDataset } of sources) {
    const datasets: DatasetManifest[] = manifest.datasets.map((dataset) => {
      const normalizer = perDataset[dataset.id];
      if (!normalizer) return dataset;
      const id = recipeId(manifest.id, dataset.id);
      recipes[id] = normalizer;
      return { ...dataset, recipe: id };
    });
    manifests.push({ ...manifest, datasets });
  }

  return { manifests, recipes };
}
