<script lang="ts" module>
  import type { License } from "@sentropic/geo-core";

  export interface AttributionBarProps {
    /** Ready-to-display attribution line (e.g. "© Provider — License"). */
    attribution: string;
    /** Resolved license; renders a badge + optional link to the deed. */
    license?: License;
  }
</script>

<script lang="ts">
  import { Tag, Link, Typography } from "@sentropic/design-system-svelte";

  let { attribution, license }: AttributionBarProps = $props();
</script>

<div class="attribution-bar" role="contentinfo" aria-label="Attribution des données">
  <Typography variant="caption" tone="muted">{attribution}</Typography>
  {#if license}
    {#if license.url}
      <Link href={license.url} variant="muted" external>
        <Tag tone={license.redistributable ? "success" : "warning"} size="sm">{license.id}</Tag>
      </Link>
    {:else}
      <Tag tone={license.redistributable ? "success" : "warning"} size="sm">{license.id}</Tag>
    {/if}
  {/if}
</div>

<style>
  .attribution-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--st-spacing-2, 0.5rem);
    padding: var(--st-spacing-2, 0.5rem) var(--st-spacing-3, 0.75rem);
    border-top: 1px solid var(--st-component-card-border, var(--st-color-slate-20, #e2e8f0));
    background: var(--st-component-card-background, var(--st-color-slate-10, #f8fafc));
    border-radius: var(--st-radius-sm, 0.25rem);
  }
</style>
