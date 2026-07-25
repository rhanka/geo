<script lang="ts" module>
  import type { FeatureCollection } from "@sentropic/geo-core";
  import type {
    GeoCategory,
    GeoFeatureHit,
    GeoMapLegendPosition,
  } from "./map-types.js";

  export interface SourceViewState {
    id: string;
    labelFr: string;
    color: string;
  }

  export interface SourceViewSummaryItem {
    labelFr: string;
    value: string | number;
  }

  export interface SourceViewHit extends GeoFeatureHit {
    sourceId: string | number | undefined;
    state: string | undefined;
  }

  export interface SourceViewProps {
    /** Coverage/status features, usually city or source polygons. */
    data?: FeatureCollection;
    /** Source/status states exposed as map categories. */
    states: readonly SourceViewState[];
    /** Property carrying the state id. Default `state`. */
    stateKey?: string;
    /** Property carrying the stable source/city id. Default `id`. */
    idKey?: string;
    titleFr?: string;
    subtitleFr?: string;
    summary?: readonly SourceViewSummaryItem[];
    height?: string;
    legend?: boolean;
    legendPosition?: GeoMapLegendPosition;
    labelFr?: string;
    onHover?: (feature: SourceViewHit | null) => void;
    onSelect?: (feature: SourceViewHit) => void;
  }

  const EMPTY_SOURCES: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  export function sourceStatesToCategories(
    states: readonly SourceViewState[],
  ): GeoCategory[] {
    return states.map((state) => ({
      id: state.id,
      labelFr: state.labelFr,
      color: state.color,
    }));
  }

  export function sourceIdFromProperties(
    properties: Record<string, unknown>,
    idKey = "id",
  ): string | number | undefined {
    const explicit = properties[idKey];
    if (typeof explicit === "string" || typeof explicit === "number") {
      return explicit;
    }
    const fallbacks = ["id", "citySlug", "slug", "sourceId", "geoId"];
    for (const key of fallbacks) {
      const value = properties[key];
      if (typeof value === "string" || typeof value === "number") {
        return value;
      }
    }
    return undefined;
  }

  export function sourceStateFromProperties(
    properties: Record<string, unknown>,
    stateKey = "state",
  ): string | undefined {
    const value = properties[stateKey];
    return typeof value === "string" ? value : undefined;
  }

  export function toSourceViewHit(
    hit: GeoFeatureHit,
    idKey = "id",
    stateKey = "state",
  ): SourceViewHit {
    return {
      ...hit,
      sourceId: sourceIdFromProperties(hit.properties, idKey),
      state: sourceStateFromProperties(hit.properties, stateKey),
    };
  }
</script>

<script lang="ts">
  import GeoMap from "./GeoMap.svelte";

  let {
    data,
    states = [],
    stateKey = "state",
    idKey = "id",
    titleFr,
    subtitleFr,
    summary = [],
    height = "480px",
    legend = true,
    legendPosition = "bottom-left",
    labelFr = "Carte des sources géographiques",
    onHover,
    onSelect,
  }: SourceViewProps = $props();

  const mapData = $derived(data ?? EMPTY_SOURCES);
  const categories = $derived(sourceStatesToCategories(states));

  function handleHover(hit: GeoFeatureHit | null): void {
    onHover?.(hit ? toSourceViewHit(hit, idKey, stateKey) : null);
  }

  function handleSelect(hit: GeoFeatureHit): void {
    onSelect?.(toSourceViewHit(hit, idKey, stateKey));
  }
</script>

<section class="source-view" aria-label={labelFr}>
  {#if titleFr || subtitleFr || summary.length > 0}
    <header class="source-view-header">
      <div class="source-view-title-group">
        {#if titleFr}
          <h2>{titleFr}</h2>
        {/if}
        {#if subtitleFr}
          <p>{subtitleFr}</p>
        {/if}
      </div>
      {#if summary.length > 0}
        <dl class="source-view-summary">
          {#each summary as item (`${item.labelFr}:${item.value}`)}
            <div>
              <dt>{item.labelFr}</dt>
              <dd>{item.value}</dd>
            </div>
          {/each}
        </dl>
      {/if}
    </header>
  {/if}

  <GeoMap
    data={mapData}
    layerKind="choropleth"
    {categories}
    categoryKey={stateKey}
    {height}
    {legend}
    {legendPosition}
    {labelFr}
    onHover={handleHover}
    onSelect={handleSelect}
  />
</section>

<style>
  .source-view {
    display: grid;
    gap: var(--st-spacing-3, 0.75rem);
    color: var(--st-color-text-primary, #1e293b);
  }

  .source-view-header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--st-spacing-4, 1rem);
  }

  .source-view-title-group {
    min-width: 0;
  }

  .source-view-title-group h2,
  .source-view-title-group p,
  .source-view-summary {
    margin: 0;
  }

  .source-view-title-group h2 {
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 0;
  }

  .source-view-title-group p {
    margin-top: var(--st-spacing-1, 0.25rem);
    color: var(--st-color-text-secondary, #64748b);
    font-size: 0.875rem;
  }

  .source-view-summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--st-spacing-2, 0.5rem);
  }

  .source-view-summary div {
    min-width: 5rem;
    border: 1px solid var(--st-component-card-border, #e2e8f0);
    border-radius: var(--st-radius-sm, 0.25rem);
    background: var(--st-component-card-background, #ffffff);
    padding: var(--st-spacing-2, 0.5rem) var(--st-spacing-3, 0.75rem);
  }

  .source-view-summary dt {
    color: var(--st-color-text-secondary, #64748b);
    font-size: 0.75rem;
  }

  .source-view-summary dd {
    margin: var(--st-spacing-1, 0.25rem) 0 0;
    font-weight: 700;
  }

  @media (max-width: 42rem) {
    .source-view-header {
      align-items: stretch;
      flex-direction: column;
    }

    .source-view-summary {
      justify-content: stretch;
    }

    .source-view-summary div {
      flex: 1 1 7rem;
    }
  }
</style>
