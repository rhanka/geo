<script lang="ts">
  import {
    Container,
    Stack,
    Typography,
    Select,
    Alert,
    EmptyState,
    Badge,
    Tag,
  } from "@sentropic/design-system-svelte";
  import {
    GeoMap,
    type GeoCategory,
    type GeoFeatureHit,
  } from "@sentropic/geo-ui-svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // The feature the user last clicked on the map → drives the detail card.
  let selected = $state<GeoFeatureHit | null>(null);

  /** FR labels for admin levels, so the always-on legend reads in French. */
  const LEVEL_LABELS_FR: Record<string, string> = {
    world: "Monde",
    country: "Pays",
    region: "Région",
    province: "Province",
    state: "État",
    territory: "Territoire",
    department: "Département",
    county: "Comté",
    district: "District",
    mrc: "MRC",
    municipality: "Municipalité",
    borough: "Arrondissement",
    locality: "Localité",
  };

  /** Sequential palette for the level legend (tokens with hex fallbacks). */
  const LEVEL_COLORS = [
    "var(--st-color-blue-60, #2563eb)",
    "var(--st-color-cyan-50, #0891b2)",
    "var(--st-color-blue-80, #1e3a8a)",
    "var(--st-color-cyan-70, #155e75)",
    "var(--st-color-blue-40, #60a5fa)",
  ];

  /**
   * Build the legend categories from the UNION of admin levels present in the
   * collection — the "filtre toujours visible, union des types, labels FR".
   * Every admin feature carries `level`, so this drives both the map fill
   * (`categoryKey="level"`) and the always-on legend.
   */
  const levelCategories = $derived.by<GeoCategory[]>(() => {
    const collection = data.collection;
    if (!collection) return [];
    const seen = new Set<string>();
    for (const f of collection.features) {
      const lvl = f.properties?.["level"];
      if (typeof lvl === "string") seen.add(lvl);
    }
    return [...seen].map((id, i) => ({
      id,
      labelFr: LEVEL_LABELS_FR[id] ?? id,
      color: LEVEL_COLORS[i % LEVEL_COLORS.length] ?? LEVEL_COLORS[0]!,
    }));
  });

  const featureCount = $derived(data.collection?.features.length ?? 0);
  const countLabel = $derived(new Intl.NumberFormat("fr-CA").format(featureCount));

  /** Human-readable label for a clicked feature (admin `name`, else its id). */
  function featureTitle(hit: GeoFeatureHit): string {
    const name = hit.properties?.["name"];
    if (typeof name === "string" && name.length > 0) return name;
    return hit.id !== undefined ? String(hit.id) : "Entité sélectionnée";
  }

  /** Switch collection by updating the `?collection=` query (re-runs `load`). */
  function onPick(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    selected = null;
    const target = new URL(page.url);
    target.searchParams.set("collection", value);
    void goto(`${target.pathname}${target.search}`, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Carte — Sent Tech géo</title>
</svelte:head>

<Container size="lg" padding>
  <Stack gap={6} as="section">
    <Stack gap={3} as="header">
      <Typography variant="h1" as="h1">Carte des données géographiques</Typography>
      <Typography variant="body" tone="secondary">
        Visualisez un jeu de données sur une carte WebGL. Survolez ou cliquez une
        entité pour en afficher le détail. Le fond de carte est neutre — les
        données portent l'information.
      </Typography>
    </Stack>

    <div class="carte-toolbar">
      <Select
        label="Jeu de données"
        size="sm"
        value={data.selected?.id ?? ""}
        onchange={onPick}
      >
        {#each data.choices as choice (choice.id)}
          <option value={choice.id}>{choice.title}</option>
        {/each}
      </Select>
      {#if featureCount > 0}
        <Badge tone="neutral">{countLabel} entités</Badge>
      {/if}
    </div>

    {#if data.collection && featureCount > 0}
      <GeoMap
        data={data.collection}
        categories={levelCategories}
        categoryKey="level"
        height="560px"
        labelFr="Carte des données géographiques"
        legendPosition="bottom-left"
        onSelect={(hit) => (selected = hit)}
      />

      {#if selected}
        <Stack gap={2} as="aside" aria-label="Détail de l'entité sélectionnée">
          <Typography variant="h2" as="h2">{featureTitle(selected)}</Typography>
          <div class="carte-detail-tags">
            {#if typeof selected.properties?.["level"] === "string"}
              <Tag tone="info" size="sm">{selected.properties["level"]}</Tag>
            {/if}
            {#if typeof selected.properties?.["code"] === "string"}
              <Badge tone="neutral">Code {selected.properties["code"]}</Badge>
            {/if}
          </div>
        </Stack>
      {/if}
    {:else if data.dataError}
      <Alert tone="error" title="Données indisponibles">{data.dataError}</Alert>
    {:else}
      <EmptyState
        title="Aucune donnée à cartographier"
        message="Le service de données n'est pas joignable ou ce jeu n'a pas encore de géométrie publiée. Réessayez une fois l'API en ligne."
      />
    {/if}
  </Stack>
</Container>

<style>
  .carte-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--st-spacing-3, 0.75rem);
  }
  .carte-detail-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--st-spacing-2, 0.5rem);
    align-items: center;
  }
</style>
