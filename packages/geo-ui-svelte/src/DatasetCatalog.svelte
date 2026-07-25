<script lang="ts">
  import { Grid, EmptyState } from "@sentropic/design-system-svelte";
  import DatasetCard from "./DatasetCard.svelte";
  import type { DatasetCardProps } from "./DatasetCard.svelte";

  interface Props {
    datasets: DatasetCardProps[];
  }

  let { datasets }: Props = $props();
</script>

{#if datasets.length === 0}
  <EmptyState
    title="Aucun jeu de données"
    message="Le catalogue est en cours de constitution. Revenez bientôt."
  />
{:else}
  <Grid minItemWidth="20rem" gap={4}>
    {#each datasets as dataset (dataset.id)}
      <DatasetCard {...dataset} />
    {/each}
  </Grid>
{/if}
