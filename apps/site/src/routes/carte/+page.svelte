<script lang="ts">
  import {
    Container,
    Stack,
    Typography,
    Select,
    Alert,
    EmptyState,
    Badge,
  } from "@sentropic/design-system-svelte";
  import {
    GeoMap,
    GeoSearch,
    GeoDetailPanel,
    type GeoCategory,
    type GeoFeatureHit,
    type GeoDetailSchema,
  } from "@sentropic/geo-ui-svelte";
  import type { Feature, FeatureCollection } from "@sentropic/geo-core";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // The feature the user last clicked (map) or picked (search) → detail panel.
  let selected = $state<GeoFeatureHit | null>(null);

  // Collection currently fed to the map. Narrowed to a single feature on a
  // search pick so the map re-fits/zooms to it; reset to the full set on a new
  // query, dataset switch, or when the search is cleared.
  let mapCollection = $state<FeatureCollection | null>(null);

  $effect(() => {
    // Reset the map view whenever the loaded dataset changes.
    mapCollection = data.collection ?? null;
    selected = null;
  });

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

  /**
   * Demo detail schema for the admin data — the ONTOLOGY-AGNOSTIC contract a
   * consumer (immo) will later fill with sourceRef → PDF/citation/meta fields.
   * `name`/`level`/`code` always show; the "Métadonnées" level is collapsible.
   */
  const detailSchema: GeoDetailSchema = {
    titleKey: "name",
    fields: [
      { key: "level", labelFr: "Niveau", kind: "text" },
      { key: "code", labelFr: "Code", kind: "text" },
      { key: "geoId", labelFr: "Identifiant", kind: "text", level: "meta" },
      { key: "source", labelFr: "Source", kind: "url", level: "meta" },
    ],
    levels: [{ id: "meta", labelFr: "Métadonnées" }],
  };

  const featureCount = $derived(data.collection?.features.length ?? 0);
  const countLabel = $derived(new Intl.NumberFormat("fr-CA").format(featureCount));

  /** Search a feature's `name` then `code` (matches the demo admin schema). */
  const searchKeys = ["name", "code"];

  /** Narrow the map to the picked feature (re-fits) and open its detail. */
  function onSearchPick(feature: Feature): void {
    selected = {
      id:
        (feature.properties?.["geoId"] as string | number | undefined) ??
        feature.id,
      properties: (feature.properties ?? {}) as Record<string, unknown>,
      geometry: feature.geometry,
    };
    mapCollection = { type: "FeatureCollection", features: [feature] };
  }

  /** A new (non-empty) query restores the full collection under the map. */
  function onSearchQuery(matches: Feature[]): void {
    if (matches.length === 0 && data.collection) {
      mapCollection = data.collection;
    }
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
        Visualisez un jeu de données sur une carte WebGL. Recherchez, survolez ou
        cliquez une entité pour en afficher le détail. Le fond de carte est neutre
        — les données portent l'information.
      </Typography>
    </Stack>

    {#if data.collection && featureCount > 0}
      <!-- Search on top (graphify-style), above the toolbar and the map. -->
      <GeoSearch
        features={data.collection}
        keys={searchKeys}
        placeholderFr="Rechercher une entité (nom ou code)…"
        onPick={onSearchPick}
        onQuery={onSearchQuery}
      />
    {/if}

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
      <!-- Re-mount on collection identity so a search pick re-fits the camera. -->
      {#key mapCollection}
        <GeoMap
          data={mapCollection ?? data.collection}
          categories={levelCategories}
          categoryKey="level"
          height="560px"
          labelFr="Carte des données géographiques"
          legendPosition="bottom-left"
          onSelect={(hit) => (selected = hit)}
        />
      {/key}

      {#if selected}
        <GeoDetailPanel feature={selected} schema={detailSchema} />
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
</style>
