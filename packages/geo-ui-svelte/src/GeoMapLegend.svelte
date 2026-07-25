<script lang="ts" module>
  import type { GeoCategory } from "./GeoMap.svelte";
  import type { ChoroplethBin } from "./choropleth.js";
  import { formatBinRangeFr } from "./choropleth.js";

  export interface GeoMapLegendProps {
    /**
     * Categorical mode. Render one swatch + `labelFr` row per category — the
     * "filtre toujours visible, union des types, labels FR". When both
     * `categories` and `bins` are supplied, `categories` wins.
     */
    categories?: GeoCategory[] | undefined;
    /** Value/choropleth mode. Graduated swatches with FR-formatted bounds. */
    bins?: ChoroplethBin[] | undefined;
    /**
     * Optional categorical selection state (the ids currently shown). Bind it
     * to make rows act as toggles; selection is the consumer's to own. When
     * omitted, the legend is purely presentational (every row "on").
     */
    visibleIds?: string[];
    /** Legend heading. Default `"Légende"`. */
    titleFr?: string;
    /** Map corner to dock the overlay into. Default `"bottom-left"`. */
    position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  }
</script>

<script lang="ts">
  let {
    categories,
    bins,
    visibleIds = $bindable(),
    titleFr = "Légende",
    position = "bottom-left",
  }: GeoMapLegendProps = $props();

  // Categorical takes precedence; fall back to value/choropleth bins.
  const mode = $derived(
    categories && categories.length > 0
      ? "categorical"
      : bins && bins.length > 0
        ? "value"
        : "empty",
  );

  /** Toggleable only when the consumer bound `visibleIds`. */
  const toggleable = $derived(Array.isArray(visibleIds));

  function isVisible(id: string): boolean {
    return !visibleIds || visibleIds.includes(id);
  }

  function toggle(id: string): void {
    if (!visibleIds) return;
    visibleIds = visibleIds.includes(id)
      ? visibleIds.filter((v) => v !== id)
      : [...visibleIds, id];
  }
</script>

{#if mode !== "empty"}
  <div
    class="geo-legend geo-legend-{position}"
    role="group"
    aria-label={titleFr}
  >
    <p class="geo-legend-title">{titleFr}</p>

    {#if mode === "categorical" && categories}
      <ul class="geo-legend-list">
        {#each categories as category (category.id)}
          <li class="geo-legend-item">
            {#if toggleable}
              <button
                type="button"
                class="geo-legend-row geo-legend-toggle"
                aria-pressed={isVisible(category.id)}
                onclick={() => toggle(category.id)}
              >
                <span
                  class="geo-legend-swatch"
                  class:geo-legend-swatch-off={!isVisible(category.id)}
                  style:background-color={category.color}
                  aria-hidden="true"
                ></span>
                <span class="geo-legend-label">{category.labelFr}</span>
              </button>
            {:else}
              <span class="geo-legend-row">
                <span
                  class="geo-legend-swatch"
                  style:background-color={category.color}
                  aria-hidden="true"
                ></span>
                <span class="geo-legend-label">{category.labelFr}</span>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if mode === "value" && bins}
      <ul class="geo-legend-list">
        {#each bins as bin, i (i)}
          <li class="geo-legend-item">
            <span class="geo-legend-row">
              <span
                class="geo-legend-swatch"
                style:background-color={bin.color}
                aria-hidden="true"
              ></span>
              <span class="geo-legend-label">{formatBinRangeFr(bin)}</span>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .geo-legend {
    position: absolute;
    z-index: 1;
    max-width: 16rem;
    padding: var(--st-spacing-2, 0.5rem) var(--st-spacing-3, 0.75rem);
    background: var(--st-component-card-background, var(--st-color-slate-0, #ffffff));
    border: 1px solid var(--st-component-card-border, var(--st-color-slate-20, #e2e8f0));
    border-radius: var(--st-radius-sm, 0.25rem);
    box-shadow: var(--st-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.08));
    font-size: 0.8125rem;
    line-height: 1.3;
  }
  .geo-legend-top-left {
    top: var(--st-spacing-3, 0.75rem);
    left: var(--st-spacing-3, 0.75rem);
  }
  .geo-legend-top-right {
    top: var(--st-spacing-3, 0.75rem);
    right: var(--st-spacing-3, 0.75rem);
  }
  .geo-legend-bottom-left {
    bottom: var(--st-spacing-3, 0.75rem);
    left: var(--st-spacing-3, 0.75rem);
  }
  .geo-legend-bottom-right {
    bottom: var(--st-spacing-3, 0.75rem);
    right: var(--st-spacing-3, 0.75rem);
  }

  .geo-legend-title {
    margin: 0 0 var(--st-spacing-1, 0.25rem);
    font-weight: 600;
    color: var(--st-color-text-primary, #1e293b);
  }
  .geo-legend-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--st-spacing-1, 0.25rem);
  }
  .geo-legend-item {
    margin: 0;
  }
  .geo-legend-row {
    display: flex;
    align-items: center;
    gap: var(--st-spacing-2, 0.5rem);
    width: 100%;
    color: var(--st-color-text-secondary, #334155);
  }
  .geo-legend-toggle {
    border: 0;
    background: none;
    padding: 0;
    margin: 0;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--st-radius-xs, 0.125rem);
  }
  .geo-legend-toggle:focus-visible {
    outline: 2px solid var(--st-color-blue-60, #2563eb);
    outline-offset: 2px;
  }
  .geo-legend-toggle[aria-pressed="false"] .geo-legend-label {
    color: var(--st-color-text-muted, var(--st-color-slate-60, #64748b));
    text-decoration: line-through;
  }
  .geo-legend-swatch {
    flex: none;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: var(--st-radius-xs, 0.125rem);
    border: 1px solid rgba(15, 23, 42, 0.15);
  }
  .geo-legend-swatch-off {
    opacity: 0.25;
  }
  .geo-legend-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
