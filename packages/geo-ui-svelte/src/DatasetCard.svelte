<script lang="ts" module>
  import type { License } from "@sentropic/geo-core";

  export interface DatasetCardProps {
    /** Dataset id; links to `/datasets/{id}`. */
    id: string;
    title: string;
    license: License;
    /** Ready-to-display attribution line. */
    attribution: string;
    /** Number of features. */
    count: number;
    /** Administrative level label (e.g. "region"). */
    level?: string;
  }
</script>

<script lang="ts">
  import { Card, Typography, Stack, Badge, Tag } from "@sentropic/design-system-svelte";

  let { id, title, license, attribution, count, level }: DatasetCardProps = $props();

  const countLabel = $derived(
    new Intl.NumberFormat("fr-CA").format(count),
  );
</script>

<a class="dataset-card-link" href={`/datasets/${id}`} aria-label={`Voir le jeu de données ${title}`}>
  <Card interactive>
    <Stack gap={3}>
      <Stack gap={2} as="header">
        <Typography variant="h3" as="h2">{title}</Typography>
        <div class="dataset-card-tags">
          {#if level}
            <Tag tone="info" size="sm">{level}</Tag>
          {/if}
          <Tag tone={license.redistributable ? "success" : "warning"} size="sm">
            {license.id}
          </Tag>
          {#if count > 0}
            <Badge tone="neutral">{countLabel} entités</Badge>
          {/if}
        </div>
      </Stack>

      <Typography variant="body-sm" tone="secondary">{attribution}</Typography>

      <Typography variant="caption" tone="muted">{license.title}</Typography>
    </Stack>
  </Card>
</a>

<style>
  .dataset-card-link {
    display: block;
    text-decoration: none;
    color: inherit;
    border-radius: var(--st-radius-md, 0.5rem);
  }
  .dataset-card-link:focus-visible {
    outline: 2px solid var(--st-color-blue-60, #2563eb);
    outline-offset: 2px;
  }
  .dataset-card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--st-spacing-2, 0.5rem);
    align-items: center;
  }
</style>
