<script lang="ts">
  import { Container, Stack, Typography } from "@sentropic/design-system-svelte";
  import { DatasetCatalog } from "@sentropic/geo-ui-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Catalogue géographique — Sent Tech géo</title>
</svelte:head>

<Container size="lg" padding>
  <Stack gap={8} as="section">
    <Stack gap={3} as="header">
      <Typography variant="display" as="h1">Données géographiques ouvertes</Typography>
      <Typography variant="body" tone="secondary">
        Parcourez le catalogue des découpages administratifs et autres jeux de
        données géographiques. Chaque jeu indique sa licence et son attribution,
        et peut être visualisé sur une carte.
      </Typography>
    </Stack>

    <DatasetCatalog datasets={data.datasets} />
  </Stack>
</Container>
