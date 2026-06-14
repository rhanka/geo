<script lang="ts">
  import {
    Container,
    Stack,
    Typography,
    Card,
    Tag,
    Badge,
    Link,
  } from "@sentropic/design-system-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  /** French labels for the referential source kinds. */
  const KIND_LABELS: Record<string, string> = {
    administrative: "Administrative",
    postal: "Postale",
    statistical: "Statistique",
  };

  /** French labels for the dataset admin levels. */
  const LEVEL_LABELS: Record<string, string> = {
    country: "Pays",
    region: "Région",
    department: "Département",
    mrc: "MRC",
    municipality: "Municipalité",
    csd: "Subdivision de recensement",
  };

  function kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
  }

  function levelLabel(level: string | undefined): string | undefined {
    if (level === undefined) return undefined;
    return LEVEL_LABELS[level] ?? level;
  }

  function jurisdictionLabel(s: PageData["sources"][number]): string {
    return s.subdivision ?? s.country;
  }
</script>

<svelte:head>
  <title>Catalogue des sources — Sent Tech géo</title>
</svelte:head>

<Container size="lg" padding>
  <Stack gap={8} as="section">
    <Stack gap={3} as="header">
      <Typography variant="display" as="h1">Catalogue des sources</Typography>
      <Typography variant="body" tone="secondary">
        Inventaire des sources géographiques provinciales et nationales publiées
        par @sentropic/geo. Chaque source indique sa juridiction, sa licence et
        son attribution, ainsi que les jeux de données qu'elle fournit.
      </Typography>
    </Stack>

    <ul class="source-list">
      {#each data.sources as source (source.sourceId)}
        <li>
          <Card>
            <Stack gap={4}>
              <Stack gap={2} as="header">
                <Typography variant="h3" as="h2">{source.title}</Typography>
                <div class="source-tags">
                  <Badge tone="neutral">{source.sourceId}</Badge>
                  <Tag tone="info" size="sm">{kindLabel(source.kind)}</Tag>
                  <Tag tone="neutral" size="sm">{jurisdictionLabel(source)}</Tag>
                  <Tag tone={source.license.redistributable ? "success" : "warning"} size="sm">
                    {source.license.id}
                  </Tag>
                </div>
              </Stack>

              <dl class="meta-list">
                <div class="meta-row">
                  <dt><Typography variant="overline" tone="muted">Licence</Typography></dt>
                  <dd>
                    {#if source.license.url}
                      <Link href={source.license.url} variant="standalone" external>
                        {source.license.title}
                      </Link>
                    {:else}
                      <Typography variant="body-sm">{source.license.title}</Typography>
                    {/if}
                  </dd>
                </div>
                <div class="meta-row">
                  <dt><Typography variant="overline" tone="muted">Attribution</Typography></dt>
                  <dd><Typography variant="body-sm">{source.attribution}</Typography></dd>
                </div>
              </dl>

              <Stack gap={2} as="section" aria-label={`Jeux de données de ${source.title}`}>
                <Typography variant="overline" tone="muted">
                  Jeux de données ({source.datasets.length})
                </Typography>
                <ul class="dataset-list">
                  {#each source.datasets as dataset (dataset.id)}
                    <li>
                      <Typography variant="body-sm" as="span">{dataset.title}</Typography>
                      <span class="dataset-meta">
                        <Tag tone="neutral" size="sm">{dataset.format}</Tag>
                        {#if levelLabel(dataset.adminLevel)}
                          <Tag tone="info" size="sm">{levelLabel(dataset.adminLevel)}</Tag>
                        {/if}
                      </span>
                    </li>
                  {/each}
                </ul>
              </Stack>
            </Stack>
          </Card>
        </li>
      {/each}
    </ul>
  </Stack>
</Container>

<style>
  .source-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--st-spacing-4, 1rem);
  }
  .source-list > li {
    list-style: none;
  }
  .source-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--st-spacing-2, 0.5rem);
    align-items: center;
  }
  .meta-list {
    margin: 0;
    display: grid;
    gap: var(--st-spacing-3, 0.75rem);
  }
  .meta-row {
    display: grid;
    gap: var(--st-spacing-1, 0.25rem);
  }
  .meta-row dt,
  .meta-row dd {
    margin: 0;
  }
  .dataset-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--st-spacing-2, 0.5rem);
  }
  .dataset-list li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--st-spacing-2, 0.5rem);
    align-items: center;
    justify-content: space-between;
  }
  .dataset-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--st-spacing-2, 0.5rem);
    align-items: center;
  }
</style>
