<script lang="ts" module>
  /**
   * A PDF-page point expressed as fractions of the displayed page box.
   * `fx=0, fy=0` is the top-left corner; `fx=1, fy=1` is bottom-right.
   */
  export interface GcpCalagePdfPoint {
    fx: number;
    fy: number;
  }

  /** A WGS84 point picked on the map, longitude first. */
  export interface GcpCalageMapPoint {
    lon: number;
    lat: number;
  }

  /** One ground control point joining a PDF point to a real-world WGS84 point. */
  export interface GcpCalagePoint
    extends GcpCalagePdfPoint,
      Partial<GcpCalageMapPoint> {
    id?: string;
    labelFr?: string;
    residualM?: number;
  }

  export type GcpCalageStatus =
    | "idle"
    | "editing"
    | "ready"
    | "running"
    | "success"
    | "error";

  export interface GcpCalageReport {
    maxResidualM?: number;
    rmsResidualM?: number;
    residualsM?: readonly number[];
    messageFr?: string;
  }

  export interface GcpCalageUIProps {
    /** Rasterized PDF page shown on the left. The caller owns rasterization. */
    imageUrl?: string;
    /** Accessible label for the PDF page image. */
    imageAltFr?: string;
    /** Header label for the PDF side. Default `"Plan source"`. */
    pageLabelFr?: string;
    /** Header label for the map side. Default `"Repère WGS84"`. */
    mapLabelFr?: string;
    /** Completed GCPs. Use `pendingPdfPoint` for the half-picked point. */
    gcps?: readonly GcpCalagePoint[];
    /** PDF point waiting for its map click. */
    pendingPdfPoint?: GcpCalagePdfPoint | null;
    /** Minimum complete GCPs required before compute/save actions enable. */
    minGcps?: number;
    /** Optional WGS84 bounds `[west, south, east, north]` drawn on the map. */
    referenceBounds?: readonly [number, number, number, number];
    /** Initial map center, longitude first. Default `[-73.5, 45.5]`. */
    mapCenter?: readonly [number, number];
    /** Initial map zoom. Default `11`. */
    mapZoom?: number;
    /**
     * MapLibre style. When omitted, the component uses a tokenized blank
     * background; applications may pass OSM, PMTiles, or any tenant-approved
     * style.
     */
    mapStyle?: unknown;
    /** Disable MapLibre mounting, useful for tests or server-side previews. */
    mapEnabled?: boolean;
    /** Current workflow state. */
    status?: GcpCalageStatus;
    /** Optional explicit status label. */
    statusLabelFr?: string;
    /** Residual/report values from the caller's georeferencing solver. */
    report?: GcpCalageReport;
    /** Fired when the user clicks the PDF page. */
    onPdfPoint?: (point: GcpCalagePdfPoint) => void;
    /** Fired when the user clicks the map. */
    onMapPoint?: (point: GcpCalageMapPoint) => void;
    onUndo?: () => void;
    onClear?: () => void;
    onSave?: () => void;
    onCompute?: () => void;
  }

  export function clampUnit(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  export function isCompleteGcp(point: GcpCalagePoint): boolean {
    return (
      Number.isFinite(point.fx) &&
      Number.isFinite(point.fy) &&
      Number.isFinite(point.lon) &&
      Number.isFinite(point.lat)
    );
  }

  export function isGcpSetReady(
    points: readonly GcpCalagePoint[],
    minGcps = 3,
  ): boolean {
    return points.length >= minGcps && points.every(isCompleteGcp);
  }
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  let {
    imageUrl,
    imageAltFr = "Page PDF à caler",
    pageLabelFr = "Plan source",
    mapLabelFr = "Repère WGS84",
    gcps = [],
    pendingPdfPoint = null,
    minGcps = 3,
    referenceBounds,
    mapCenter = [-73.5, 45.5],
    mapZoom = 11,
    mapStyle,
    mapEnabled = true,
    status = "idle",
    statusLabelFr,
    report,
    onPdfPoint,
    onMapPoint,
    onUndo,
    onClear,
    onSave,
    onCompute,
  }: GcpCalageUIProps = $props();

  let mapContainer = $state<HTMLDivElement>();
  let map:
    | (import("maplibre-gl").Map & {
        getSource: (id: string) => { setData?: (data: unknown) => void } | undefined;
        getLayer: (id: string) => unknown;
        addSource: (id: string, source: unknown) => void;
        addLayer: (layer: unknown) => void;
      })
    | undefined;
  let MarkerCtor: typeof import("maplibre-gl").Marker | undefined;
  let mapMarkers: import("maplibre-gl").Marker[] = [];
  let mapReady = $state(false);
  let mapError = $state<string | null>(null);

  const ready = $derived(isGcpSetReady(gcps, minGcps));
  const canUndo = $derived(gcps.length > 0 || pendingPdfPoint !== null);
  const canRun = $derived(ready && status !== "running");
  const statusTone = $derived(
    status === "success"
      ? "success"
      : status === "error"
        ? "error"
        : status === "running"
          ? "info"
          : ready || status === "ready"
            ? "warning"
            : "neutral",
  );
  const resolvedStatusLabel = $derived(
    statusLabelFr ?? defaultStatusLabel(status, ready),
  );

  function defaultStatusLabel(
    current: GcpCalageStatus,
    isReady: boolean,
  ): string {
    if (current === "running") return "Calcul en cours";
    if (current === "success") return "Calage valide";
    if (current === "error") return "Calage à reprendre";
    if (isReady || current === "ready") return "Prêt à calculer";
    if (current === "editing") return "Calage en saisie";
    return "En attente";
  }

  function formatFraction(value: number): string {
    return `${Math.round(clampUnit(value) * 1000) / 10}%`;
  }

  function formatCoord(value: number | undefined): string {
    return Number.isFinite(value) ? value!.toFixed(6) : "—";
  }

  function formatMeters(value: number | undefined): string {
    return Number.isFinite(value) ? `${value!.toFixed(1)} m` : "—";
  }

  function pointKey(point: GcpCalagePoint, index: number): string {
    return point.id ?? `${index}:${point.fx}:${point.fy}:${point.lon}:${point.lat}`;
  }

  function handlePdfClick(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    onPdfPoint?.({
      fx: clampUnit((event.clientX - rect.left) / rect.width),
      fy: clampUnit((event.clientY - rect.top) / rect.height),
    });
  }

  function blankMapStyle(): unknown {
    const surface = tokenColor("--st-component-card-background", "#f8fafc");
    return {
      version: 8,
      sources: {},
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": surface || "#f8fafc" },
        },
      ],
    };
  }

  function tokenColor(name: string, fallback: string): string {
    if (typeof window === "undefined") return fallback;
    return (
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
      fallback
    );
  }

  function boundsData(
    bounds: readonly [number, number, number, number] | undefined,
  ): unknown {
    if (!bounds) return { type: "FeatureCollection", features: [] };
    const [west, south, east, north] = bounds;
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
              ],
            ],
          },
        },
      ],
    };
  }

  function syncReferenceBounds(): void {
    if (!map || !mapReady) return;
    const data = boundsData(referenceBounds);
    const boundsColor = tokenColor("--st-color-cyan-50", "#0891b2");
    const source = map.getSource("gcp-reference-bounds") as
      | { setData?: (data: unknown) => void }
      | undefined;
    if (source?.setData) {
      source.setData(data);
    } else if (!source) {
      map.addSource("gcp-reference-bounds", { type: "geojson", data });
    }
    if (!map.getLayer("gcp-reference-fill")) {
      map.addLayer({
        id: "gcp-reference-fill",
        type: "fill",
        source: "gcp-reference-bounds",
        paint: {
          "fill-color": boundsColor,
          "fill-opacity": 0.08,
        },
      });
    }
    if (!map.getLayer("gcp-reference-line")) {
      map.addLayer({
        id: "gcp-reference-line",
        type: "line",
        source: "gcp-reference-bounds",
        paint: {
          "line-color": boundsColor,
          "line-width": 1.5,
          "line-dasharray": [2, 2],
        },
      });
    }
  }

  function syncMapMarkers(): void {
    const currentMap = map;
    const Marker = MarkerCtor;
    if (!currentMap || !Marker || !mapReady) return;
    for (const marker of mapMarkers) marker.remove();
    mapMarkers = [];
    gcps.forEach((point, index) => {
      const { lon, lat } = point;
      if (
        typeof lon !== "number" ||
        typeof lat !== "number" ||
        !Number.isFinite(lon) ||
        !Number.isFinite(lat)
      ) {
        return;
      }
      const el = document.createElement("div");
      el.className = "gcp-calage-map-marker";
      el.textContent = String(index + 1);
      const marker = new Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(currentMap);
      mapMarkers.push(marker);
    });
  }

  function syncMapArtifacts(): void {
    syncReferenceBounds();
    syncMapMarkers();
  }

  $effect(() => {
    if (mapReady) syncMapArtifacts();
  });

  onMount(() => {
    if (!mapEnabled || !mapContainer || typeof window === "undefined") return;
    let disposed = false;

    void (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (disposed || !mapContainer) return;

        MarkerCtor = maplibregl.Marker;
        const nextMap = new maplibregl.Map({
          container: mapContainer,
          style: (mapStyle ?? blankMapStyle()) as never,
          center: mapCenter as [number, number],
          zoom: mapZoom,
          attributionControl: { compact: true },
        }) as NonNullable<typeof map>;
        map = nextMap;

        nextMap.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "top-right",
        );
        nextMap.on("click", (event) => {
          onMapPoint?.({ lon: event.lngLat.lng, lat: event.lngLat.lat });
        });
        nextMap.on("load", () => {
          if (!map || disposed) return;
          mapReady = true;
          if (referenceBounds) {
            map.fitBounds(referenceBounds as [number, number, number, number], {
              padding: 32,
              duration: 0,
              maxZoom: 15,
            });
          }
          syncMapArtifacts();
        });
      } catch (error) {
        mapError = error instanceof Error ? error.message : String(error);
      }
    })();

    return () => {
      disposed = true;
      for (const marker of mapMarkers) marker.remove();
      mapMarkers = [];
      map?.remove();
      map = undefined;
      mapReady = false;
    };
  });

  onDestroy(() => {
    for (const marker of mapMarkers) marker.remove();
    mapMarkers = [];
  });
</script>

<section class="gcp-calage" aria-label="Calage géographique par GCP">
  <header class="gcp-header">
    <div>
      <p class="gcp-kicker">GCP</p>
      <h2 class="gcp-title">Calage géographique</h2>
    </div>
    <div class={`gcp-status gcp-status-${statusTone}`} role="status">
      {resolvedStatusLabel}
    </div>
  </header>

  <div class="gcp-workspace">
    <section class="gcp-pane" aria-labelledby="gcp-page-heading">
      <div class="gcp-pane-header">
        <h3 id="gcp-page-heading">{pageLabelFr}</h3>
        <span>{gcps.length} / {minGcps}</span>
      </div>
      <div class="gcp-page-frame">
        {#if imageUrl}
          <img src={imageUrl} alt={imageAltFr} class="gcp-page-image" />
          <button
            type="button"
            class="gcp-page-hit"
            aria-label="Placer un point PDF"
            onclick={handlePdfClick}
          ></button>
          {#each gcps as point, index (pointKey(point, index))}
            <span
              class="gcp-dot"
              style={`left:${clampUnit(point.fx) * 100}%;top:${clampUnit(point.fy) * 100}%;`}
              aria-label={`GCP ${index + 1} PDF`}
            >
              {index + 1}
            </span>
          {/each}
          {#if pendingPdfPoint}
            <span
              class="gcp-dot gcp-dot-pending"
              style={`left:${clampUnit(pendingPdfPoint.fx) * 100}%;top:${clampUnit(pendingPdfPoint.fy) * 100}%;`}
              aria-label={`GCP ${gcps.length + 1} PDF en attente`}
            >
              {gcps.length + 1}
            </span>
          {/if}
        {:else}
          <div class="gcp-empty">PDF non chargé</div>
        {/if}
      </div>
    </section>

    <section class="gcp-pane" aria-labelledby="gcp-map-heading">
      <div class="gcp-pane-header">
        <h3 id="gcp-map-heading">{mapLabelFr}</h3>
        <span>WGS84</span>
      </div>
      <div class="gcp-map-frame">
        {#if mapEnabled}
          <div bind:this={mapContainer} class="gcp-map"></div>
          {#if mapError}
            <div class="gcp-map-state gcp-map-state-error">{mapError}</div>
          {:else if !mapReady}
            <div class="gcp-map-state">Carte en chargement</div>
          {/if}
        {:else}
          <div class="gcp-map-state">Carte désactivée</div>
        {/if}
      </div>
    </section>
  </div>

  <div class="gcp-lower">
    <section class="gcp-table-card" aria-labelledby="gcp-table-heading">
      <div class="gcp-table-header">
        <h3 id="gcp-table-heading">Points de contrôle</h3>
        {#if report?.maxResidualM !== undefined}
          <span>Résidu max {formatMeters(report.maxResidualM)}</span>
        {/if}
      </div>
      <div class="gcp-table-scroll">
        <table class="gcp-table">
          <thead>
            <tr>
              <th>GCP</th>
              <th>PDF</th>
              <th>WGS84</th>
              <th>Résidu</th>
            </tr>
          </thead>
          <tbody>
            {#if gcps.length === 0}
              <tr>
                <td colspan="4" class="gcp-table-empty">Aucun point</td>
              </tr>
            {:else}
              {#each gcps as point, index (pointKey(point, index))}
                <tr>
                  <td>{point.labelFr ?? `#${index + 1}`}</td>
                  <td>{formatFraction(point.fx)} · {formatFraction(point.fy)}</td>
                  <td>{formatCoord(point.lon)} · {formatCoord(point.lat)}</td>
                  <td>{formatMeters(point.residualM ?? report?.residualsM?.[index])}</td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </section>

    <aside class="gcp-report" aria-label="Rapport de calage">
      <dl>
        <div>
          <dt>Points complets</dt>
          <dd>{gcps.filter(isCompleteGcp).length}</dd>
        </div>
        <div>
          <dt>RMS</dt>
          <dd>{formatMeters(report?.rmsResidualM)}</dd>
        </div>
        <div>
          <dt>Max</dt>
          <dd>{formatMeters(report?.maxResidualM)}</dd>
        </div>
      </dl>
      {#if report?.messageFr}
        <p>{report.messageFr}</p>
      {/if}
    </aside>
  </div>

  <footer class="gcp-actions">
    {#if onUndo}
      <button type="button" class="gcp-button" disabled={!canUndo} onclick={onUndo}>
        Annuler
      </button>
    {/if}
    {#if onClear}
      <button type="button" class="gcp-button" disabled={!canUndo} onclick={onClear}>
        Effacer
      </button>
    {/if}
    {#if onSave}
      <button type="button" class="gcp-button" disabled={!ready} onclick={onSave}>
        Enregistrer
      </button>
    {/if}
    {#if onCompute}
      <button
        type="button"
        class="gcp-button gcp-button-primary"
        disabled={!canRun}
        onclick={onCompute}
      >
        Calculer
      </button>
    {/if}
  </footer>
</section>

<style>
  .gcp-calage {
    display: flex;
    flex-direction: column;
    gap: var(--st-spacing-3, 0.75rem);
    color: var(--st-color-text-primary, #1e293b);
  }

  .gcp-header,
  .gcp-pane-header,
  .gcp-table-header,
  .gcp-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--st-spacing-3, 0.75rem);
  }

  .gcp-kicker {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
    color: var(--st-color-text-secondary, #64748b);
  }

  .gcp-title,
  .gcp-pane-header h3,
  .gcp-table-header h3 {
    margin: 0;
    font-weight: 700;
    color: var(--st-color-text-primary, #1e293b);
  }

  .gcp-title {
    font-size: 1.125rem;
  }

  .gcp-pane-header h3,
  .gcp-table-header h3 {
    font-size: 0.875rem;
  }

  .gcp-pane-header span,
  .gcp-table-header span {
    font-size: 0.75rem;
    color: var(--st-color-text-secondary, #64748b);
    white-space: nowrap;
  }

  .gcp-status {
    border: 1px solid var(--st-component-card-border, #e2e8f0);
    border-radius: var(--st-radius-sm, 0.25rem);
    padding: var(--st-spacing-1, 0.25rem) var(--st-spacing-2, 0.5rem);
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .gcp-status-neutral {
    background: var(--st-color-slate-10, #f8fafc);
    color: var(--st-color-text-secondary, #64748b);
  }

  .gcp-status-info {
    background: var(--st-color-blue-10, #eff6ff);
    color: var(--st-color-blue-80, #1e3a8a);
  }

  .gcp-status-warning {
    background: var(--st-color-amber-10, #fffbeb);
    color: var(--st-color-amber-80, #92400e);
  }

  .gcp-status-success {
    background: var(--st-color-green-10, #f0fdf4);
    color: var(--st-color-green-80, #166534);
  }

  .gcp-status-error {
    background: var(--st-color-red-10, #fef2f2);
    color: var(--st-color-red-80, #991b1b);
  }

  .gcp-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--st-spacing-3, 0.75rem);
    min-height: 24rem;
  }

  .gcp-pane,
  .gcp-table-card,
  .gcp-report {
    border: 1px solid var(--st-component-card-border, #e2e8f0);
    border-radius: var(--st-radius-md, 0.5rem);
    background: var(--st-component-card-background, #ffffff);
  }

  .gcp-pane {
    display: flex;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
  }

  .gcp-pane-header,
  .gcp-table-header {
    padding: var(--st-spacing-2, 0.5rem) var(--st-spacing-3, 0.75rem);
    border-bottom: 1px solid var(--st-component-card-border, #e2e8f0);
  }

  .gcp-page-frame,
  .gcp-map-frame {
    position: relative;
    flex: 1;
    min-height: 20rem;
    background: var(--st-color-slate-10, #f8fafc);
  }

  .gcp-page-image,
  .gcp-map {
    width: 100%;
    height: 100%;
  }

  .gcp-page-image {
    display: block;
    object-fit: contain;
  }

  .gcp-page-hit {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    cursor: crosshair;
  }

  .gcp-page-hit:focus-visible,
  .gcp-button:focus-visible {
    outline: 2px solid var(--st-color-blue-60, #2563eb);
    outline-offset: 2px;
  }

  .gcp-dot {
    position: absolute;
    z-index: 2;
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    transform: translate(-50%, -50%);
    align-items: center;
    justify-content: center;
    border: 2px solid var(--st-component-card-background, #ffffff);
    border-radius: 999px;
    background: var(--st-color-blue-60, #2563eb);
    box-shadow: var(--st-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.08));
    color: #ffffff;
    font-size: 0.75rem;
    font-weight: 800;
    pointer-events: none;
  }

  .gcp-dot-pending {
    background: var(--st-color-amber-60, #d97706);
  }

  .gcp-map-state,
  .gcp-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--st-spacing-4, 1rem);
    text-align: center;
    color: var(--st-color-text-secondary, #64748b);
    font-size: 0.875rem;
    pointer-events: none;
  }

  .gcp-map-state-error {
    color: var(--st-color-red-70, #b91c1c);
    background: color-mix(in srgb, var(--st-color-red-10, #fef2f2) 82%, transparent);
  }

  .gcp-lower {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(12rem, 16rem);
    gap: var(--st-spacing-3, 0.75rem);
  }

  .gcp-table-card {
    min-width: 0;
    overflow: hidden;
  }

  .gcp-table-scroll {
    overflow-x: auto;
  }

  .gcp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .gcp-table th,
  .gcp-table td {
    padding: var(--st-spacing-2, 0.5rem) var(--st-spacing-3, 0.75rem);
    border-bottom: 1px solid var(--st-component-card-border, #e2e8f0);
    text-align: left;
    vertical-align: top;
    white-space: nowrap;
  }

  .gcp-table th {
    color: var(--st-color-text-secondary, #64748b);
    font-weight: 700;
  }

  .gcp-table-empty {
    color: var(--st-color-text-secondary, #64748b);
    text-align: center;
  }

  .gcp-report {
    padding: var(--st-spacing-3, 0.75rem);
  }

  .gcp-report dl {
    display: grid;
    gap: var(--st-spacing-2, 0.5rem);
    margin: 0;
  }

  .gcp-report div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--st-spacing-3, 0.75rem);
  }

  .gcp-report dt {
    color: var(--st-color-text-secondary, #64748b);
    font-size: 0.75rem;
  }

  .gcp-report dd {
    margin: 0;
    font-weight: 700;
  }

  .gcp-report p {
    margin: var(--st-spacing-3, 0.75rem) 0 0;
    color: var(--st-color-text-secondary, #64748b);
    font-size: 0.8125rem;
  }

  .gcp-actions {
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .gcp-button {
    border: 1px solid var(--st-component-card-border, #e2e8f0);
    border-radius: var(--st-radius-sm, 0.25rem);
    background: var(--st-component-card-background, #ffffff);
    color: var(--st-color-text-primary, #1e293b);
    cursor: pointer;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 700;
    min-height: 2.25rem;
    padding: 0 var(--st-spacing-3, 0.75rem);
  }

  .gcp-button:hover:not(:disabled) {
    background: var(--st-color-slate-10, #f8fafc);
  }

  .gcp-button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .gcp-button-primary {
    border-color: var(--st-color-blue-60, #2563eb);
    background: var(--st-color-blue-60, #2563eb);
    color: #ffffff;
  }

  .gcp-button-primary:hover:not(:disabled) {
    background: var(--st-color-blue-70, #1d4ed8);
  }

  :global(.gcp-calage-map-marker) {
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--st-component-card-background, #ffffff);
    border-radius: 999px;
    background: var(--st-color-blue-60, #2563eb);
    box-shadow: var(--st-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.08));
    color: #ffffff;
    font-size: 0.75rem;
    font-weight: 800;
  }

  @media (max-width: 48rem) {
    .gcp-workspace,
    .gcp-lower {
      grid-template-columns: 1fr;
    }

    .gcp-page-frame,
    .gcp-map-frame {
      min-height: 18rem;
    }
  }
</style>
