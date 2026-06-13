<script lang="ts">
  import {
    Container,
    Stack,
    Typography,
    Tag,
    Badge,
    Link,
    Breadcrumb,
    Alert,
    EmptyState,
  } from "@sentropic/design-system-svelte";
  import { GeoMap } from "@sentropic/geo-ui-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const entry = $derived(data.entry);
  const countLabel = $derived(new Intl.NumberFormat("fr-CA").format(entry.count));
</script>

<svelte:head>
  <title>{entry.title} — Sent Tech géo</title>
</svelte:head>

<Container size="lg" padding>
  <Stack gap={6} as="article">
    <Breadcrumb
      items={[
        { label: "Catalogue", href: "/" },
        { label: entry.title, href: `/datasets/${entry.id}`, current: true },
      ]}
    />

    <Stack gap={3} as="header">
      <Typography variant="h1" as="h1">{entry.title}</Typography>
      <div class="meta-tags">
        <Tag tone={entry.license.redistributable ? "success" : "warning"} size="sm">
          {entry.license.id}
        </Tag>
        {#if entry.count > 0}
          <Badge tone="neutral">{countLabel} entités</Badge>
        {/if}
      </div>
      {#if entry.description}
        <Typography variant="body" tone="secondary">{entry.description}</Typography>
      {/if}
    </Stack>

    {#if data.collection}
      <GeoMap data={data.collection} height="540px" />
    {:else if data.dataError}
      <Alert tone="error" title="Données indisponibles">{data.dataError}</Alert>
    {:else}
      <EmptyState
        title="Données en cours d'acquisition"
        message="La géométrie de ce jeu de données n'est pas encore publiée. La fiche, sa licence et son attribution restent consultables ci-dessous."
      />
    {/if}

    <Stack gap={4} as="section" aria-label="Provenance et licence">
      <Typography variant="h2" as="h2">Provenance &amp; licence</Typography>

      <dl class="meta-list">
        <div class="meta-row">
          <dt><Typography variant="overline" tone="muted">Licence</Typography></dt>
          <dd>
            {#if entry.license.url}
              <Link href={entry.license.url} variant="standalone" external>{entry.license.title}</Link>
            {:else}
              <Typography variant="body">{entry.license.title}</Typography>
            {/if}
          </dd>
        </div>

        <div class="meta-row">
          <dt><Typography variant="overline" tone="muted">Attribution</Typography></dt>
          <dd><Typography variant="body">{entry.attribution}</Typography></dd>
        </div>

        <div class="meta-row">
          <dt><Typography variant="overline" tone="muted">Redistribution</Typography></dt>
          <dd>
            <Tag tone={entry.license.redistributable ? "success" : "warning"} size="sm">
              {entry.license.redistributable ? "Redistribuable" : "Non redistribuable"}
            </Tag>
          </dd>
        </div>
      </dl>
    </Stack>
  </Stack>
</Container>

<style>
  .meta-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--st-spacing-2, 0.5rem);
    align-items: center;
  }
  .meta-list {
    margin: 0;
    display: grid;
    gap: var(--st-spacing-4, 1rem);
  }
  .meta-row {
    display: grid;
    gap: var(--st-spacing-1, 0.25rem);
  }
  .meta-row dt,
  .meta-row dd {
    margin: 0;
  }
</style>
