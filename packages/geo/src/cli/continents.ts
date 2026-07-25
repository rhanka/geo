/**
 * Optional, dynamic loading of the continent source libraries (ADR-0017).
 *
 * The engine (`@sentropic/geo`) MUST NOT statically depend on the continent
 * libraries — that would cycle the workspace graph (continents depend on geo).
 * So the bundled continents are pulled in at runtime via dynamic `import()` in a
 * try/catch: each is optional. When a continent is installed, its
 * {@link SourceRegistry} (`{ manifests, recipes }`) joins the registry/inventory;
 * when it is absent (a slimmer image, a downstream consumer that installed only
 * `@sentropic/geo`), it is skipped — never fatal.
 *
 * The export convention: each `@sentropic/geo-sources-<continent>` package
 * exposes a named `registry: SourceRegistry`.
 */

import type { SourceRegistry } from "@sentropic/geo-core";

/** The continent source libraries we attempt to load, in a stable order. */
const CONTINENT_PACKAGES = [
  "@sentropic/geo-sources-americas",
  "@sentropic/geo-sources-europe",
] as const;

/** Whether an imported module looks like it exposes a {@link SourceRegistry}. */
function asRegistry(mod: unknown): SourceRegistry | undefined {
  if (typeof mod !== "object" || mod === null) return undefined;
  const candidate = (mod as { registry?: unknown }).registry;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const reg = candidate as Partial<SourceRegistry>;
  if (!Array.isArray(reg.manifests) || typeof reg.recipes !== "object") return undefined;
  return reg as SourceRegistry;
}

/**
 * Load every installed continent {@link SourceRegistry}. Each continent is
 * imported optionally (a missing package is skipped, not fatal), so the engine
 * runs with zero, one, or all continents present.
 */
export async function loadContinentRegistries(): Promise<SourceRegistry[]> {
  const registries: SourceRegistry[] = [];
  for (const pkg of CONTINENT_PACKAGES) {
    try {
      // Dynamic, optional: no static dependency edge onto the continents.
      const mod: unknown = await import(/* @vite-ignore */ pkg);
      const registry = asRegistry(mod);
      if (registry) registries.push(registry);
    } catch {
      // Continent not installed in this deployment — skip it.
    }
  }
  return registries;
}
