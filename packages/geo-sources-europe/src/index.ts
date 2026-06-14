/**
 * @sentropic/geo-sources-europe — manifests + recipes for Europe (France), as a
 * single {@link SourceRegistry} (ADR-0017).
 *
 * Each underlying source (capitalized from the former `@sentropic/geo-source-fr*`
 * packages) contributes its declarative {@link SourceManifest} plus the bespoke
 * {@link NormalizerFn} recipes it references. The engine (`@sentropic/geo`)
 * consumes `registry = { manifests, recipes }` to build its acquisition registry
 * and inventory — with **no static dependency** from the engine onto this
 * library (it is loaded by dynamic, optional `import()`), which keeps the
 * workspace dependency graph acyclic.
 *
 * De-risked (ADR-0017): the existing bespoke normalizers are kept verbatim as
 * recipes; conversion of the simple ones to declarative `fieldMap` is deferred.
 */

import type { NormalizerFn, SourceRegistry } from "@sentropic/geo-core";

import { registerSource as registerFr } from "./fr/index.js";
import { registerSource as registerFrPostal } from "./fr-postal/index.js";
import { registerSource as registerFrStat } from "./fr-stat/index.js";

import { buildRegistry, type SourceRecipes } from "./build-registry.js";

/**
 * The Europe source registry. Manifests (with `recipe` tags injected) plus the
 * keyed recipes. Assembled from each French source's `registerSource` output.
 */
export const registry: SourceRegistry = (() => {
  const fr = registerFr();
  const frPostal = registerFrPostal();
  const frStat = registerFrStat();
  const recipeSources: SourceRecipes[] = [
    { manifest: fr.manifest, recipes: fr.normalizers },
    { manifest: frPostal.manifest, recipes: frPostal.normalizers },
    { manifest: frStat.manifest, recipes: frStat.csvNormalizers },
  ];
  return buildRegistry(recipeSources);
})();

/** The recipe map, exported for tests/introspection. */
export const recipes: Record<string, NormalizerFn> = registry.recipes;
