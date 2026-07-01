<script lang="ts" module>
  import type { Feature, FeatureCollection, Geometry } from "@sentropic/geo-core";

  export interface CitySearchCity {
    /** Stable application id. Defaults to `slug` when omitted. */
    id?: string | number;
    /** Stable city slug, e.g. `salaberry-de-valleyfield`. */
    slug: string;
    /** User-facing French city label. */
    labelFr: string;
    /** Optional administrative code searched after the label. */
    code?: string | number;
    /** Optional region/MRC label searched after the city fields. */
    mrc?: string;
    /** Optional WGS84 longitude used when the city feature is picked on a map. */
    lon?: number;
    /** Optional WGS84 latitude used when the city feature is picked on a map. */
    lat?: number;
    /** Extra searchable or application-owned public properties. */
    properties?: Record<string, unknown>;
  }

  export interface CitySearchProps {
    cities: readonly CitySearchCity[];
    /** Property keys searched by the underlying `GeoSearch`. */
    keys?: string[];
    placeholderFr?: string;
    labelFr?: string;
    limit?: number;
    onQuery?: (matches: CitySearchCity[]) => void;
    onPick?: (city: CitySearchCity) => void;
  }

  function hasLonLat(city: CitySearchCity): boolean {
    return Number.isFinite(city.lon) && Number.isFinite(city.lat);
  }

  export function citySearchToFeature(city: CitySearchCity): Feature {
    const geometry: Geometry = hasLonLat(city)
      ? {
          type: "Point",
          coordinates: [city.lon!, city.lat!],
        }
      : {
          type: "Point",
          coordinates: [0, 0],
        };
    return {
      type: "Feature",
      id: city.id ?? city.slug,
      geometry,
      properties: {
        ...city.properties,
        slug: city.slug,
        name: city.labelFr,
        labelFr: city.labelFr,
        code: city.code,
        mrc: city.mrc,
        hasCoordinates: hasLonLat(city),
      },
    };
  }

  export function citiesToFeatureCollection(
    cities: readonly CitySearchCity[],
  ): FeatureCollection {
    return {
      type: "FeatureCollection",
      features: cities.map(citySearchToFeature),
    };
  }

  export function citySlugFromFeature(feature: Feature): string | undefined {
    const slug = feature.properties?.["slug"];
    return typeof slug === "string" && slug.length > 0 ? slug : undefined;
  }
</script>

<script lang="ts">
  import GeoSearch from "./GeoSearch.svelte";

  let {
    cities = [],
    keys = ["labelFr", "name", "slug", "code", "mrc"],
    placeholderFr = "Rechercher une municipalité…",
    labelFr = "Rechercher une municipalité",
    limit = 8,
    onQuery,
    onPick,
  }: CitySearchProps = $props();

  const features = $derived(citiesToFeatureCollection(cities));
  const cityBySlug = $derived(
    new Map(cities.map((city) => [city.slug, city] as const)),
  );

  function cityForFeature(feature: Feature): CitySearchCity | undefined {
    const slug = citySlugFromFeature(feature);
    return slug ? cityBySlug.get(slug) : undefined;
  }

  function handleQuery(matches: Feature[]): void {
    onQuery?.(matches.map(cityForFeature).filter((city) => city !== undefined));
  }

  function handlePick(feature: Feature): void {
    const city = cityForFeature(feature);
    if (city) onPick?.(city);
  }
</script>

<GeoSearch
  {features}
  {keys}
  {placeholderFr}
  {labelFr}
  {limit}
  onQuery={handleQuery}
  onPick={handlePick}
/>
