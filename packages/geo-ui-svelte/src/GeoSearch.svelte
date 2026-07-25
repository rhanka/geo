<script lang="ts" module>
  import type { Feature, FeatureCollection } from "@sentropic/geo-core";

  /**
   * A search box meant to sit ON TOP of the map experience (graphify-style):
   * above the map and any toolbar, NOT tucked inside a menu. It performs a
   * case/accent-insensitive substring match over a configurable set of property
   * keys and reports both the running set of matches (so a parent can filter or
   * highlight the map) and the single feature the user finally picks.
   *
   * Like the rest of `geo-ui-svelte`, it is ONTOLOGY-AGNOSTIC: it only knows
   * the property keys it is told to search; it never assumes a domain schema.
   */
  export interface GeoSearchProps {
    /** Collection whose features are searched. */
    features: FeatureCollection;
    /**
     * Property keys searched, in priority order (the first non-empty one also
     * supplies a result row's label). Default `["name", "code"]`.
     */
    keys?: string[];
    /** Placeholder text (French UI). Default `"Rechercher une entité…"`. */
    placeholderFr?: string;
    /** Accessible label for the search box. Default `"Rechercher sur la carte"`. */
    labelFr?: string;
    /** Maximum number of result rows shown at once. Default `8`. */
    limit?: number;
    /** Called whenever the match set changes (every keystroke). */
    onQuery?: (matches: Feature[]) => void;
    /** Called when the user picks a result (click / Enter). */
    onPick?: (feature: Feature) => void;
  }

  /**
   * NFD-normalize + strip diacritics + lowercase, so "Québec" matches "quebec".
   * Exported because the page may want the exact same folding when it filters
   * or highlights the map off the emitted matches.
   */
  export function foldText(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  }
</script>

<script lang="ts">
  let {
    features,
    keys = ["name", "code"],
    placeholderFr = "Rechercher une entité…",
    labelFr = "Rechercher sur la carte",
    limit = 8,
    onQuery,
    onPick,
  }: GeoSearchProps = $props();

  /** The raw query string bound to the input. */
  let query = $state("");
  /** Whether the result listbox is open (focus + non-empty query + hits). */
  let open = $state(false);
  /** Active descendant index for keyboard navigation (-1 = none). */
  let activeIndex = $state(-1);
  /**
   * Set right after a pick so the listbox doesn't immediately re-open just
   * because the chosen label still matches itself. Cleared on the next input.
   */
  let suppressOpen = $state(false);

  const inputId = "geo-search-input";
  const listId = "geo-search-list";

  /** Best display label for a result row: first non-empty searched key. */
  function labelFor(feature: Feature): string {
    const props = feature.properties ?? {};
    for (const key of keys) {
      const raw = props[key];
      if (raw !== null && raw !== undefined && String(raw).length > 0) {
        return String(raw);
      }
    }
    return feature.id !== undefined ? String(feature.id) : "—";
  }

  /**
   * The matches for the current query: NFD substring over every searched key.
   * Empty query → no matches (the listbox stays closed). Capped at `limit`.
   */
  const matches = $derived.by<Feature[]>(() => {
    const needle = foldText(query);
    if (needle === "") return [];
    const out: Feature[] = [];
    for (const feature of features.features) {
      const props = feature.properties ?? {};
      let hit = false;
      for (const key of keys) {
        if (foldText(props[key]).includes(needle)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        out.push(feature);
        if (out.length >= limit) break;
      }
    }
    return out;
  });

  /**
   * Notify the parent of the current match set on every change. Runs untracked
   * over the callback so a consumer mutating state in `onQuery` can't loop.
   */
  $effect(() => {
    const current = matches;
    onQuery?.(current);
  });

  /** Open the listbox whenever there is a non-empty query with results. */
  $effect(() => {
    // Right after a pick, keep the list closed even though the chosen label
    // still matches itself; cleared the moment the user types again (oninput).
    if (suppressOpen) {
      open = false;
      return;
    }
    if (matches.length === 0) {
      open = false;
      activeIndex = -1;
    } else if (query.trim() !== "") {
      open = true;
      if (activeIndex >= matches.length) activeIndex = matches.length - 1;
    }
  });

  function pick(feature: Feature): void {
    query = labelFor(feature);
    open = false;
    activeIndex = -1;
    suppressOpen = true;
    onPick?.(feature);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      if (matches.length > 0) open = true;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (matches.length > 0) {
          activeIndex = (activeIndex + 1) % matches.length;
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (matches.length > 0) {
          activeIndex =
            activeIndex <= 0 ? matches.length - 1 : activeIndex - 1;
        }
        break;
      case "Enter": {
        const chosen = matches[activeIndex] ?? matches[0];
        if (chosen) {
          event.preventDefault();
          pick(chosen);
        }
        break;
      }
      case "Escape":
        event.preventDefault();
        open = false;
        activeIndex = -1;
        break;
      default:
        break;
    }
  }

  function onBlur(): void {
    // Defer so a click on a result row registers before the list closes.
    setTimeout(() => {
      open = false;
      activeIndex = -1;
    }, 120);
  }
</script>

<div class="geo-search">
  <!-- svelte-ignore a11y_label_has_associated_control -->
  <label class="geo-search-srlabel" for={inputId}>{labelFr}</label>
  <div class="geo-search-field">
    <svg
      class="geo-search-icon"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        d="M8.5 3a5.5 5.5 0 1 0 3.4 9.82l3.64 3.64M8.5 3a5.5 5.5 0 0 1 3.9 9.39"
      />
    </svg>
    <input
      id={inputId}
      class="geo-search-input"
      type="text"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && activeIndex >= 0
        ? `geo-search-opt-${activeIndex}`
        : undefined}
      placeholder={placeholderFr}
      bind:value={query}
      oninput={() => (suppressOpen = false)}
      onkeydown={onKeydown}
      onfocus={() => {
        if (matches.length > 0) open = true;
      }}
      onblur={onBlur}
    />
    {#if query.length > 0}
      <button
        type="button"
        class="geo-search-clear"
        aria-label="Effacer la recherche"
        onclick={() => {
          query = "";
          open = false;
          activeIndex = -1;
        }}
      >
        ×
      </button>
    {/if}
  </div>

  {#if open && matches.length > 0}
    <ul id={listId} class="geo-search-list" role="listbox" aria-label={labelFr}>
      {#each matches as feature, i (feature.id ?? labelFor(feature) + i)}
        <li
          id={`geo-search-opt-${i}`}
          class="geo-search-option"
          class:geo-search-option-active={i === activeIndex}
          role="option"
          aria-selected={i === activeIndex}
        >
          <button
            type="button"
            class="geo-search-option-btn"
            tabindex="-1"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => pick(feature)}
            onmouseenter={() => (activeIndex = i)}
          >
            {labelFor(feature)}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .geo-search {
    position: relative;
    width: 100%;
    max-width: 28rem;
  }
  .geo-search-srlabel {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .geo-search-field {
    display: flex;
    align-items: center;
    gap: var(--st-spacing-2, 0.5rem);
    padding: 0 var(--st-spacing-3, 0.75rem);
    background: var(--st-component-card-background, #ffffff);
    border: 1px solid var(--st-component-card-border, #e2e8f0);
    border-radius: var(--st-radius-md, 0.5rem);
    box-shadow: var(--st-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.08));
  }
  .geo-search-field:focus-within {
    border-color: var(--st-color-blue-60, #2563eb);
    box-shadow: 0 0 0 3px var(--st-color-blue-10, rgba(37, 99, 235, 0.15));
  }
  .geo-search-icon {
    flex: none;
    width: 1.1rem;
    height: 1.1rem;
    color: var(--st-color-text-secondary, #64748b);
  }
  .geo-search-input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    padding: var(--st-spacing-2, 0.5rem) 0;
    font: inherit;
    color: var(--st-color-text-primary, #1e293b);
  }
  .geo-search-clear {
    flex: none;
    border: 0;
    background: none;
    cursor: pointer;
    font-size: 1.25rem;
    line-height: 1;
    color: var(--st-color-text-secondary, #64748b);
    padding: 0 var(--st-spacing-1, 0.25rem);
    border-radius: var(--st-radius-xs, 0.125rem);
  }
  .geo-search-clear:focus-visible {
    outline: 2px solid var(--st-color-blue-60, #2563eb);
    outline-offset: 2px;
  }

  .geo-search-list {
    position: absolute;
    z-index: 5;
    top: calc(100% + var(--st-spacing-1, 0.25rem));
    left: 0;
    right: 0;
    margin: 0;
    padding: var(--st-spacing-1, 0.25rem);
    list-style: none;
    max-height: 18rem;
    overflow-y: auto;
    background: var(--st-component-card-background, #ffffff);
    border: 1px solid var(--st-component-card-border, #e2e8f0);
    border-radius: var(--st-radius-md, 0.5rem);
    box-shadow: var(--st-shadow-md, 0 4px 12px rgba(15, 23, 42, 0.12));
  }
  .geo-search-option {
    margin: 0;
  }
  .geo-search-option-btn {
    display: block;
    width: 100%;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: var(--st-color-text-primary, #1e293b);
    padding: var(--st-spacing-2, 0.5rem) var(--st-spacing-3, 0.75rem);
    border-radius: var(--st-radius-sm, 0.25rem);
  }
  .geo-search-option-active .geo-search-option-btn,
  .geo-search-option-btn:hover {
    background: var(--st-color-blue-10, #eff6ff);
  }
</style>
