<script lang="ts" module>
  import type { GeoFeatureHit } from "./GeoMap.svelte";

  /**
   * One row of a {@link GeoDetailSchema}: a property key to read off the
   * feature, the French label to show, an optional render `kind`, and an
   * optional `level` grouping it belongs to.
   *
   * This is the CONTRACT the consumer (e.g. immo) fills in: immo's
   * `sourceRef → PDF / citation / meta` becomes a set of fields whose `kind`
   * is `"pdf"`, `"citation"`, etc. `GeoDetailPanel` stays ONTOLOGY-AGNOSTIC —
   * it reads `properties[key]` and renders per `kind`, nothing more.
   */
  export interface GeoDetailField {
    /** Property key read off `feature.properties`. */
    key: string;
    /** French label for the row. */
    labelFr: string;
    /**
     * How to render the value. Default `"text"`.
     *  - `text` / `number` / `date` → plain value (date via fr-CA formatting);
     *  - `url` / `pdf` → an anchor (PDF labelled as such);
     *  - `citation` → a blockquote.
     */
    kind?: "text" | "number" | "url" | "pdf" | "date" | "citation";
    /** Id of the {@link GeoDetailSchema.levels} group this field belongs to. */
    level?: string;
  }

  /**
   * A schema describing how to render a feature's `properties` in the detail
   * panel. ONTOLOGY-AGNOSTIC: the panel knows keys, labels and render kinds —
   * never a domain meaning. When `levels` are declared, fields tagged with a
   * `level` are grouped under collapsible sections (collapsed by default);
   * untagged fields always show.
   */
  export interface GeoDetailSchema {
    /** Property key whose value titles the panel. Default `"name"`. */
    titleKey?: string;
    /** Ordered field definitions. */
    fields: GeoDetailField[];
    /** Optional collapsible groups, e.g. admin levels or source layers. */
    levels?: { id: string; labelFr: string }[];
  }

  export interface GeoDetailPanelProps {
    /** The selected feature to detail. When `null`, the panel renders nothing. */
    feature: GeoFeatureHit | null;
    /**
     * Render schema. When omitted, the panel falls back to a plain key/value
     * list over every property.
     */
    schema?: GeoDetailSchema;
    /** Panel heading shown above the feature title. Default `"Détail"`. */
    titleFr?: string;
    /** Whether the panel starts expanded. Default `true`. */
    expanded?: boolean;
  }

  /** Best title for the feature: schema `titleKey`, else `name`, else id. */
  function resolveTitle(
    feature: GeoFeatureHit,
    schema?: GeoDetailSchema,
  ): string {
    const props = feature.properties ?? {};
    const key = schema?.titleKey ?? "name";
    const raw = props[key];
    if (raw !== null && raw !== undefined && String(raw).length > 0) {
      return String(raw);
    }
    return feature.id !== undefined
      ? String(feature.id)
      : "Entité sélectionnée";
  }
</script>

<script lang="ts">
  let {
    feature,
    schema,
    titleFr = "Détail",
    expanded = $bindable(true),
  }: GeoDetailPanelProps = $props();

  const frDate = new Intl.DateTimeFormat("fr-CA", { dateStyle: "long" });
  const frNumber = new Intl.NumberFormat("fr-CA");

  /** Stringify a raw property value for `text` / `number` / `date` rendering. */
  function formatValue(raw: unknown, kind: GeoDetailField["kind"]): string {
    if (raw === null || raw === undefined) return "—";
    if (kind === "number" && typeof raw !== "object") {
      const n = Number(raw);
      return Number.isFinite(n) ? frNumber.format(n) : String(raw);
    }
    if (kind === "date") {
      const d = new Date(String(raw));
      return Number.isNaN(d.getTime()) ? String(raw) : frDate.format(d);
    }
    return String(raw);
  }

  /** True when the property is present and non-empty (so we skip blank rows). */
  function hasValue(raw: unknown): boolean {
    return raw !== null && raw !== undefined && String(raw).length > 0;
  }

  const title = $derived(feature ? resolveTitle(feature, schema) : "");

  /** Fields with no `level` (always visible), in schema order. */
  const baseFields = $derived(
    (schema?.fields ?? []).filter((f) => !f.level),
  );

  /** Declared collapsible levels, each with the fields tagged to it. */
  const levelGroups = $derived(
    (schema?.levels ?? []).map((lvl) => ({
      ...lvl,
      fields: (schema?.fields ?? []).filter((f) => f.level === lvl.id),
    })),
  );

  /**
   * Fallback key/value pairs when no schema is supplied: every own property,
   * skipping nullish/empty values.
   */
  const fallbackEntries = $derived.by<[string, unknown][]>(() => {
    if (schema || !feature) return [];
    return Object.entries(feature.properties ?? {}).filter(([, v]) =>
      hasValue(v),
    );
  });

  /** Per-level expanded state (all collapsed by default). */
  let openLevels = $state<Record<string, boolean>>({});
  function toggleLevel(id: string): void {
    openLevels = { ...openLevels, [id]: !openLevels[id] };
  }
</script>

{#if feature}
  <section
    class="geo-detail"
    aria-label="Détail de l'entité sélectionnée"
  >
    <header class="geo-detail-header">
      <button
        type="button"
        class="geo-detail-toggle"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >
        <span class="geo-detail-chevron" class:geo-detail-chevron-open={expanded}
          aria-hidden="true">▸</span>
        <span class="geo-detail-kicker">{titleFr}</span>
      </button>
      <h2 class="geo-detail-title">{title}</h2>
    </header>

    {#if expanded}
      <div class="geo-detail-body">
        {#if schema}
          {#if baseFields.length > 0}
            <dl class="geo-detail-list">
              {#each baseFields as field (field.key)}
                {#if hasValue(feature.properties?.[field.key])}
                  <div class="geo-detail-row">
                    <dt class="geo-detail-label">{field.labelFr}</dt>
                    <dd class="geo-detail-value">
                      {@render fieldValue(field, feature.properties?.[field.key])}
                    </dd>
                  </div>
                {/if}
              {/each}
            </dl>
          {/if}

          {#each levelGroups as group (group.id)}
            {#if group.fields.length > 0}
              <div class="geo-detail-level">
                <button
                  type="button"
                  class="geo-detail-level-toggle"
                  aria-expanded={!!openLevels[group.id]}
                  onclick={() => toggleLevel(group.id)}
                >
                  <span
                    class="geo-detail-chevron"
                    class:geo-detail-chevron-open={openLevels[group.id]}
                    aria-hidden="true">▸</span>
                  {group.labelFr}
                </button>
                {#if openLevels[group.id]}
                  <dl class="geo-detail-list">
                    {#each group.fields as field (field.key)}
                      {#if hasValue(feature.properties?.[field.key])}
                        <div class="geo-detail-row">
                          <dt class="geo-detail-label">{field.labelFr}</dt>
                          <dd class="geo-detail-value">
                            {@render fieldValue(
                              field,
                              feature.properties?.[field.key],
                            )}
                          </dd>
                        </div>
                      {/if}
                    {/each}
                  </dl>
                {/if}
              </div>
            {/if}
          {/each}
        {:else}
          <!-- No schema → plain key/value fallback over all properties. -->
          <dl class="geo-detail-list">
            {#each fallbackEntries as [key, value] (key)}
              <div class="geo-detail-row">
                <dt class="geo-detail-label">{key}</dt>
                <dd class="geo-detail-value">{String(value)}</dd>
              </div>
            {/each}
          </dl>
        {/if}
      </div>
    {/if}
  </section>
{/if}

{#snippet fieldValue(field: GeoDetailField, raw: unknown)}
  {#if field.kind === "url" || field.kind === "pdf"}
    <a
      class="geo-detail-link"
      href={String(raw)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {field.kind === "pdf" ? "Ouvrir le PDF" : "Ouvrir le lien"}
    </a>
  {:else if field.kind === "citation"}
    <blockquote class="geo-detail-citation">{String(raw)}</blockquote>
  {:else}
    {formatValue(raw, field.kind)}
  {/if}
{/snippet}

<style>
  .geo-detail {
    border: 1px solid var(--st-component-card-border, #e2e8f0);
    border-radius: var(--st-radius-md, 0.5rem);
    background: var(--st-component-card-background, #ffffff);
    padding: var(--st-spacing-3, 0.75rem) var(--st-spacing-4, 1rem);
  }
  .geo-detail-header {
    display: flex;
    flex-direction: column;
    gap: var(--st-spacing-1, 0.25rem);
  }
  .geo-detail-toggle,
  .geo-detail-level-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--st-spacing-2, 0.5rem);
    border: 0;
    background: none;
    padding: 0;
    margin: 0;
    font: inherit;
    cursor: pointer;
    color: var(--st-color-text-secondary, #64748b);
    border-radius: var(--st-radius-xs, 0.125rem);
  }
  .geo-detail-toggle:focus-visible,
  .geo-detail-level-toggle:focus-visible {
    outline: 2px solid var(--st-color-blue-60, #2563eb);
    outline-offset: 2px;
  }
  .geo-detail-kicker {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .geo-detail-chevron {
    display: inline-block;
    transition: transform 0.12s ease;
    font-size: 0.75rem;
  }
  .geo-detail-chevron-open {
    transform: rotate(90deg);
  }
  .geo-detail-title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--st-color-text-primary, #1e293b);
  }
  .geo-detail-body {
    margin-top: var(--st-spacing-3, 0.75rem);
    display: flex;
    flex-direction: column;
    gap: var(--st-spacing-3, 0.75rem);
  }
  .geo-detail-list {
    margin: 0;
    display: grid;
    grid-template-columns: minmax(6rem, auto) 1fr;
    gap: var(--st-spacing-1, 0.25rem) var(--st-spacing-3, 0.75rem);
  }
  .geo-detail-row {
    display: contents;
  }
  .geo-detail-label {
    margin: 0;
    font-weight: 600;
    color: var(--st-color-text-secondary, #64748b);
  }
  .geo-detail-value {
    margin: 0;
    color: var(--st-color-text-primary, #1e293b);
    overflow-wrap: anywhere;
  }
  .geo-detail-level {
    border-top: 1px solid var(--st-component-card-border, #e2e8f0);
    padding-top: var(--st-spacing-2, 0.5rem);
  }
  .geo-detail-level-toggle {
    color: var(--st-color-text-primary, #1e293b);
    font-weight: 600;
  }
  .geo-detail-level .geo-detail-list {
    margin-top: var(--st-spacing-2, 0.5rem);
  }
  .geo-detail-link {
    color: var(--st-color-blue-60, #2563eb);
    text-decoration: underline;
  }
  .geo-detail-citation {
    margin: 0;
    padding-left: var(--st-spacing-3, 0.75rem);
    border-left: 3px solid var(--st-color-blue-40, #60a5fa);
    color: var(--st-color-text-secondary, #475569);
    font-style: italic;
  }
</style>
