/**
 * Hermetic catalog test fixtures (packages-v2 / ADR-0017).
 *
 * The engine (`@sentropic/geo`) must NOT statically depend on any source
 * package — the real {@link SourceManifest}s and recipes live in the continent
 * libraries (`@sentropic/geo-sources-<continent>`), loaded dynamically. So the
 * engine's own unit tests (catalog projection, registry building, `fetch`
 * dispatch, `/sources` HTTP shape, `sources` CLI) run against this small,
 * hand-built {@link SourceRegistry} fixture rather than real data.
 *
 * The fixture is deliberately representative — it spans CA / CA-QC / FR, the
 * three {@link SourceKind}s (administrative / postal / statistical), and a
 * `ca-qc/sda`-shaped admin source with datasets `qc-regions` / `qc-mrc` /
 * `qc-municipalites` carrying a `recipe` tag — so the filters, projection, and
 * recipe dispatch are all exercised without touching the source packages. The
 * end-to-end coverage of the *real* manifests/recipes lives in the continent
 * libraries' own tests (phase D).
 */

import type {
  AdminFeatureCollection,
  NormalizeContext,
  Normalizer,
  SourceManifest,
  SourceRegistry,
} from "@sentropic/geo-core";
import { featuresToCollection, makeGeoId } from "@sentropic/geo-core";

/**
 * A minimal SDA-shaped recipe: reads the pinned SDA region fields and emits one
 * canonical admin feature. Stands in for the real ca-qc normalizer so the
 * engine's `fetch` dispatch can be exercised hermetically.
 */
export const sdaRegionsRecipe: Normalizer = (
  raw: unknown,
  _ctx: NormalizeContext,
): AdminFeatureCollection => {
  const fc = raw as { features?: Array<{ geometry: unknown; properties?: Record<string, unknown> }> };
  const features = (fc.features ?? []).map((f) => {
    const props = f.properties ?? {};
    const code = String(props["RES_CO_REG"] ?? "");
    const name = String(props["RES_NM_REG"] ?? "");
    return {
      type: "Feature" as const,
      geometry: f.geometry as AdminFeatureCollection["features"][number]["geometry"],
      properties: {
        geoId: makeGeoId("ca", "qc", "region", code),
        name,
        level: "region" as const,
        code,
        iso: "CA-QC",
        country: "CA" as const,
      },
    };
  });
  return featuresToCollection(features);
};

/** Québec SDA admin source (3 datasets), mirroring the real `ca-qc/sda` shape. */
const sdaManifest: SourceManifest = {
  id: "ca-qc/sda",
  title: "Découpages administratifs du Québec (SDA)",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: { name: "Gouvernement du Québec — MRNF", url: "https://www.donneesquebec.ca" },
  license: "cc-by-4.0",
  datasets: [
    {
      id: "qc-regions",
      title: "Régions administratives du Québec",
      format: "gpkg",
      url: "https://example.test/SDA.gpkg.zip",
      adminLevel: "region",
      recipe: "ca-qc/sda#regions",
    },
    {
      id: "qc-mrc",
      title: "Municipalités régionales de comté (MRC) du Québec",
      format: "gpkg",
      url: "https://example.test/SDA.gpkg.zip",
      adminLevel: "mrc",
      recipe: "ca-qc/sda#mrc",
    },
    {
      id: "qc-municipalites",
      title: "Municipalités du Québec",
      format: "gpkg",
      url: "https://example.test/SDA.gpkg.zip",
      adminLevel: "municipality",
      recipe: "ca-qc/sda#municipalites",
    },
  ],
};

/** Canada federal administrative source. */
const caManifest: SourceManifest = {
  id: "ca/provinces",
  title: "Provinces et territoires du Canada",
  kind: "administrative",
  jurisdiction: { country: "CA" },
  provider: { name: "Statistics Canada", url: "https://statcan.gc.ca" },
  license: "ogl-ca",
  datasets: [
    {
      id: "provinces",
      title: "Provinces et territoires",
      format: "shp",
      url: "https://example.test/provinces.zip",
      adminLevel: "province",
    },
  ],
};

/** Canada postal referential source. */
const caPostalManifest: SourceManifest = {
  id: "ca/statcan-fsa",
  title: "Forward Sortation Areas (FSA)",
  kind: "postal",
  jurisdiction: { country: "CA" },
  provider: { name: "Statistics Canada", url: "https://statcan.gc.ca" },
  license: "ogl-ca",
  datasets: [
    {
      id: "fsa",
      title: "Forward Sortation Areas",
      format: "shp",
      url: "https://example.test/fsa.zip",
    },
  ],
};

/** France administrative source. */
const frManifest: SourceManifest = {
  id: "fr/admin-express",
  title: "ADMIN EXPRESS (IGN)",
  kind: "administrative",
  jurisdiction: { country: "FR" },
  provider: { name: "IGN", url: "https://www.data.gouv.fr" },
  license: "licence-ouverte-2.0",
  datasets: [
    {
      id: "fr-regions",
      title: "Régions françaises",
      format: "gpkg",
      url: "https://example.test/admin-express.7z",
      adminLevel: "region",
    },
  ],
};

/** France postal source (CSV). */
const frPostalManifest: SourceManifest = {
  id: "fr/laposte-codes-postaux",
  title: "Base officielle des codes postaux (La Poste)",
  kind: "postal",
  jurisdiction: { country: "FR" },
  provider: { name: "La Poste", url: "https://www.data.gouv.fr" },
  license: "licence-ouverte-2.0",
  datasets: [
    {
      id: "fr-codes-postaux",
      title: "Codes postaux",
      format: "csv",
      url: "https://example.test/codes-postaux.csv",
    },
  ],
};

/** France statistical source (CSV, INSEE COG). */
const frStatManifest: SourceManifest = {
  id: "fr/insee-cog",
  title: "Code Officiel Géographique (INSEE)",
  kind: "statistical",
  jurisdiction: { country: "FR" },
  provider: { name: "INSEE", url: "https://www.insee.fr" },
  license: "licence-ouverte-2.0",
  datasets: [
    {
      id: "fr-communes",
      title: "Communes",
      format: "csv",
      url: "https://example.test/cog.csv",
    },
  ],
};

/**
 * The fixture registry: a representative, hand-built {@link SourceRegistry}
 * spanning CA / CA-QC / FR and administrative / postal / statistical kinds.
 * Recipes resolve the SDA datasets' `recipe` tags. Pure data — no network.
 */
export const FIXTURE_REGISTRY: SourceRegistry = {
  manifests: [
    sdaManifest,
    caManifest,
    caPostalManifest,
    frManifest,
    frPostalManifest,
    frStatManifest,
  ],
  recipes: {
    "ca-qc/sda#regions": sdaRegionsRecipe,
    "ca-qc/sda#mrc": sdaRegionsRecipe,
    "ca-qc/sda#municipalites": sdaRegionsRecipe,
  },
};

/** Every source id the fixture registry declares, for assertions. */
export const FIXTURE_SOURCE_IDS = [
  "ca-qc/sda",
  "ca/provinces",
  "ca/statcan-fsa",
  "fr/admin-express",
  "fr/insee-cog",
  "fr/laposte-codes-postaux",
] as const;
