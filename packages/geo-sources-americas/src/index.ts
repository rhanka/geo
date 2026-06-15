/**
 * @sentropic/geo-sources-americas — manifests + recipes for the Americas
 * (Canada federal + Québec), as a single {@link SourceRegistry} (ADR-0017).
 *
 * Each underlying source (capitalized from the former `@sentropic/geo-source-*`
 * packages) contributes its declarative {@link SourceManifest}(s) plus the
 * bespoke {@link NormalizerFn} recipes those manifests reference. The engine
 * (`@sentropic/geo`) consumes `registry = { manifests, recipes }` to build its
 * acquisition registry and inventory — with **no static dependency** from the
 * engine onto this library (it is loaded by dynamic, optional `import()`), which
 * keeps the workspace dependency graph acyclic.
 *
 * De-risked (ADR-0017): the existing bespoke normalizers are kept verbatim as
 * recipes; conversion of the simple ones to declarative `fieldMap` is deferred.
 *
 * The selected named exports below are preserved for direct downstream use
 * (radar-immobilier and others depend on them): `QC_MUNICIPALITIES`,
 * `fetchQcCivicAddresses`, `parseQcCivicAddresses`, `fetchRoleXml`.
 */

import type { NormalizerFn, SourceManifest, SourceRegistry } from "@sentropic/geo-core";

import { registerSource as registerCa } from "./ca/index.js";
import { registerSource as registerCaPostal } from "./ca-postal/index.js";
import {
  registerSource as registerCaQc,
  registerStatCanCsdSource as registerCaQcStatcan,
} from "./ca-qc/index.js";
import { registerSource as registerCaQcCadastre } from "./ca-qc-cadastre/index.js";
import { registerSources as registerCaQcConstraints } from "./ca-qc-constraints/index.js";
import { adressesManifest, roleManifest } from "./ca-qc-civic/index.js";
import { QC_ZONAGE_CKAN_MANIFESTS } from "./ca-qc-zonage-ckan/index.js";

import { buildRegistry, type SourceRecipes } from "./build-registry.js";

// ── Selected named re-exports (preserved for direct downstream consumers) ────
export { QC_MUNICIPALITIES } from "./ca-qc/index.js";
export {
  fetchQcCivicAddresses,
  fetchAndParseQcCivicAddresses,
  parseQcCivicAddresses,
  fetchRoleXml,
} from "./ca-qc-civic/index.js";
// Province-wide cadastre acquisition entry point (bbox-tiling crawl).
export {
  crawlQcCadastreLots,
  QC_EXTENT,
  type CrawlQcCadastreLotsOptions,
  type CrawlQcCadastreLotsResult,
} from "./ca-qc-cadastre/index.js";
// QC municipal zonage CKAN sources (11 municipalities, cc-by-4.0).
export {
  DONNEESQUEBEC_CKAN_BASE,
  QC_ZONAGE_CKAN_MANIFESTS,
  LONGUEUIL_CKAN_PACKAGE_ID,
  GATINEAU_CKAN_PACKAGE_ID,
  SAGUENAY_CKAN_PACKAGE_ID,
  LEVIS_CKAN_PACKAGE_ID,
  TROIS_RIVIERES_CKAN_PACKAGE_ID,
  SHERBROOKE_CKAN_PACKAGE_ID,
  QUEBEC_CKAN_PACKAGE_ID,
  REPENTIGNY_CKAN_PACKAGE_ID,
  RIMOUSKI_CKAN_PACKAGE_ID,
  ROUYN_NORANDA_CKAN_PACKAGE_ID,
  SHAWINIGAN_CKAN_PACKAGE_ID,
} from "./ca-qc-zonage-ckan/index.js";

/**
 * The Americas source registry. Manifests (with `recipe` tags injected) plus the
 * keyed recipes. Assembled from each underlying source's `register*` output.
 *
 * The civic sources (`ca-qc/adresses-quebec`, `ca-qc/role-evaluation-mamh`)
 * contribute *manifests only* — they are FETCHER/adapter sources with no
 * normalizer recipe (parsing/PII stay with the consumer, ADR-0013), so they
 * carry no `recipe` and acquire through the engine's default path.
 */
export const registry: SourceRegistry = (() => {
  const ca = registerCa();
  const caPostal = registerCaPostal();
  const caQc = registerCaQc();
  const caQcStatcan = registerCaQcStatcan();
  const caQcCadastre = registerCaQcCadastre();
  const caQcConstraints = registerCaQcConstraints();

  // Each source names its per-dataset normalizer record differently
  // (`normalizers` / `referentialNormalizers`); all are NormalizerFn maps.
  const recipeSources: SourceRecipes[] = [
    { manifest: ca.manifest, recipes: ca.normalizers },
    { manifest: caPostal.manifest, recipes: caPostal.referentialNormalizers },
    { manifest: caQc.manifest, recipes: caQc.normalizers },
    { manifest: caQcStatcan.manifest, recipes: caQcStatcan.normalizers },
    { manifest: caQcCadastre.manifest, recipes: caQcCadastre.normalizers },
    ...caQcConstraints.map((s) => ({ manifest: s.manifest, recipes: s.normalizers })),
  ];

  const { manifests, recipes } = buildRegistry(recipeSources);
  // Civic manifests (no recipe — fetcher/adapter only, parsing/PII stay with the
  // consumer per ADR-0013).
  const civicManifests: SourceManifest[] = [adressesManifest, roleManifest];
  // Zonage CKAN manifests (no recipe — direct GeoJSON acquisition via
  // acquireCkanGeoJson, no bespoke normalizer needed at this stage).
  return {
    manifests: [...manifests, ...civicManifests, ...QC_ZONAGE_CKAN_MANIFESTS],
    recipes,
  };
})();

/** The recipe map, exported for tests/introspection. */
export const recipes: Record<string, NormalizerFn> = registry.recipes;
