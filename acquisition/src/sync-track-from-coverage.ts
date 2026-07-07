/**
 * sync-track-from-coverage.ts — SYNCHRONISE le store `track` (@sentropic/track)
 * sur la vérité réconciliée de `work/coverage/coverage-matrix.json`.
 *
 * CONTEXTE : les items `track` ont été frappés une fois (cf. coverage-to-track.ts)
 * à partir d'un ÉTAT ANCIEN de la matrice. L'acquisition a depuis avancé (matrice
 * réconciliée : zones/normes très en avance), mais AUCUN `item.realize` n'a suivi.
 * `track report` est donc EN RETARD. Ce script rejoue les `item.realize` manquants
 * pour que le report redevienne fidèle — SANS jamais recréer d'items (pas de
 * doublon) ni gonfler (on ne marque `done` QUE ce que la matrice dit `done`).
 *
 * MÉCANIQUE (rappel coverage-to-track.ts) :
 *   - titre feuille ATOMIQUE   : `${layer}/${voie} · ${slug} [${status}] — ${label}`
 *   - titre feuille AGRÉGAT    : `${layer}/${voie} · AGRÉGAT ${n} ville(s) [${status}] — ${label}`
 *   - realization d'une feuille : to-research→`to-do` ; planned→`in-progress` ; done→`done`
 *   - transition légale to-do→done = 2 events (in-progress puis done) ; in-progress→done = 1.
 *
 * COUCHES ATOMIQUES (zones, normes, pv) : 1 feuille / (ville × couche). On peut donc
 * synchroniser À L'ATOME : chaque ville `done` dans la matrice dont la feuille n'est
 * pas `done` reçoit ses realize. → report fidèle au nombre de villes.
 *
 * COUCHES AGRÉGÉES (cadastre, role-foncier, pmtiles) : les feuilles sont des
 * AGRÉGATS (1 feuille par voie×status portant « N ville(s) » dans le titre). On ne
 * peut PAS mapper un agrégat à des villes précises. Règle prudente : si la couche
 * est ENTIÈREMENT `done` dans la matrice (done == total), on bascule ses feuilles
 * agrégat non-`done` à `done` (couche « faite, aux agrégats près »). Sinon on NE
 * touche PAS (blocage structurel : un agrégat partiel ne se mappe pas aux villes) —
 * on le RAPPORTE (pas de gonflage).
 *
 * ÉCRITURE : UNIQUEMENT via le CLI `track` (jamais d'édition de events.jsonl).
 * On émet un flux `item.realize` jsonl et on l'applique avec `track ingest` — le
 * MÊME mécanisme append-only single-writer qui a bâti le store (coverage-to-track).
 *
 * Usage :
 *   tsx src/sync-track-from-coverage.ts            # DRY-RUN : analyse + plan (n'écrit rien dans .track)
 *   tsx src/sync-track-from-coverage.ts --apply    # applique via `track ingest`
 *   [--track-bin track] [--out <dir>] [--cwd <repo>]
 */

import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MATRIX_PATH } from "./coverage-matrix.js";
import { COVERAGE_LAYERS, findTrack, type CoverageLayer } from "./coverage-tracks.js";
import { DEFAULT_ATOMIC_LAYERS } from "./coverage-to-track.js";
import {
  applyImmoLotsTrack,
  immoFieldTrackTotals,
  loadImmoLotsSummaryFromCache,
  type ImmoLotsSummary,
} from "./immo-lots-track.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Realization = "to-do" | "in-progress" | "done" | "cancelled" | "rejected";

interface TrackItem {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly workspace: string;
  readonly bucket: string;
  readonly realization: Realization;
  readonly acceptance: string;
}

interface CreatedItem {
  readonly id: string;
  readonly title: string;
  readonly kind?: string;
  readonly role?: string;
  readonly parentId?: string;
  readonly workspace?: string;
}

/** Une feuille `track` décodée depuis son titre. */
interface ParsedLeaf {
  readonly id: string;
  readonly realization: Realization;
  readonly layer: string;
  readonly voie: string;
  /** Feuille atomique : slug ville ; feuille agrégat : undefined. */
  readonly slug?: string;
  /** Feuille agrégat : nombre de villes ; atomique : undefined. */
  readonly aggN?: number;
  readonly titleStatus: string;
  readonly title: string;
}

interface RealizeEvent {
  readonly v: 1;
  readonly kind: "item.realize";
  readonly payload: { readonly itemId: string; readonly to: "in-progress" | "done" | "cancelled" };
}

interface ItemCreateEvent {
  readonly v: 1;
  readonly kind: "item.create";
  readonly payload: {
    readonly kind: "chore";
    readonly title: string;
    readonly workspace: string;
    readonly parentId: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing des titres (miroir EXACT de coverage-to-track.buildCityCreates)
// ─────────────────────────────────────────────────────────────────────────────

const AGG_RE = /^(.+?)\/(.+?) · AGRÉGAT (\d+) ville\(s\) \[([^\]]+)\] — /u;
const ATOMIC_RE = /^(.+?)\/(.+?) · (.+?) \[([^\]]+)\] — /u;

function parseLeaf(item: TrackItem): ParsedLeaf | null {
  const agg = AGG_RE.exec(item.title);
  if (agg) {
    return {
      id: item.id,
      realization: item.realization,
      layer: agg[1]!,
      voie: agg[2]!,
      aggN: Number(agg[3]!),
      titleStatus: agg[4]!,
      title: item.title,
    };
  }
  const at = ATOMIC_RE.exec(item.title);
  if (at) {
    return {
      id: item.id,
      realization: item.realization,
      layer: at[1]!,
      voie: at[2]!,
      slug: at[3]!,
      titleStatus: at[4]!,
      title: item.title,
    };
  }
  return null; // pas une feuille couverture (ex. items geo-lib WP7)
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrice : statut par (slug, layer) + totaux par couche (détecte tod & co)
// ─────────────────────────────────────────────────────────────────────────────

interface Cell {
  readonly status?: string;
  readonly doneTrack?: string;
  readonly candidateTracks?: readonly string[];
}
interface RawMatrix {
  readonly cities: Record<string, Record<string, Cell>>;
}

interface MatrixCell {
  readonly slug: string;
  readonly layer: string;
  readonly status: string;
  readonly voie?: string;
}

interface MatrixView {
  /** `${slug}::${layer}` → status. */
  readonly cellStatus: Map<string, string>;
  /** Cellules atomiques candidates, avec voie d'attache si elle est déterminable. */
  readonly cells: MatrixCell[];
  /** layer → { done, total, planned, toResearch }. */
  readonly layerCounts: Map<string, { done: number; total: number; planned: number; toResearch: number }>;
  /** toutes les couches présentes dans la matrice (dans l'ordre de découverte). */
  readonly layers: string[];
}

function voieForMatrixCell(layer: string, cell: Cell): string | undefined {
  if (cell.status === "done" && cell.doneTrack !== undefined) {
    const l = COVERAGE_LAYERS.includes(layer as CoverageLayer) ? (layer as CoverageLayer) : undefined;
    if (l !== undefined && findTrack(l, cell.doneTrack) !== undefined) return cell.doneTrack;
  }
  return cell.candidateTracks?.[0];
}

function loadMatrixView(path: string): MatrixView {
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawMatrix;
  const cellStatus = new Map<string, string>();
  const cells: MatrixCell[] = [];
  const layerCounts = new Map<string, { done: number; total: number; planned: number; toResearch: number }>();
  const layerOrder: string[] = [];
  for (const slug of Object.keys(raw.cities)) {
    const city = raw.cities[slug]!;
    for (const layer of Object.keys(city)) {
      const cell = city[layer];
      const status = cell?.status;
      if (status === undefined) continue;
      cellStatus.set(`${slug}::${layer}`, status);
      cells.push({ slug, layer, status, voie: voieForMatrixCell(layer, cell!) });
      let lc = layerCounts.get(layer);
      if (lc === undefined) {
        lc = { done: 0, total: 0, planned: 0, toResearch: 0 };
        layerCounts.set(layer, lc);
        layerOrder.push(layer);
      }
      lc.total += 1;
      if (status === "done") lc.done += 1;
      else if (status === "planned") lc.planned += 1;
      else if (status === "to-research") lc.toResearch += 1;
    }
  }
  cells.sort((a, b) => a.slug.localeCompare(b.slug) || a.layer.localeCompare(b.layer));
  return { cellStatus, cells, layerCounts, layers: layerOrder };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chargement des items track
// ─────────────────────────────────────────────────────────────────────────────

function loadTrackItems(trackBin: string, cwd: string): TrackItem[] {
  // `track item ls` produit une grande sortie JSON ; on la redirige vers un fichier
  // (fd stdio) plutôt qu'un buffer string execFileSync — ce dernier tronque au-delà
  // d'un certain volume malgré maxBuffer. Le fichier est autoritatif et complet.
  const tmp = join(tmpdir(), `track-items-${process.pid}.json`);
  const fd = openSync(tmp, "w");
  try {
    execFileSync(trackBin, ["item", "ls", "--format", "json"], {
      cwd,
      stdio: ["ignore", fd, "inherit"],
    });
  } finally {
    closeSync(fd);
  }
  return JSON.parse(readFileSync(tmp, "utf8")) as TrackItem[];
}

function readCreatedItems(cwd: string): CreatedItem[] {
  const path = join(cwd, ".track", "events.jsonl");
  const out: CreatedItem[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const e = JSON.parse(line) as {
      type?: string;
      aggregateId?: string;
      payload?: {
        kind?: string;
        role?: string;
        title?: string;
        parentId?: string;
        workspace?: string;
      };
    };
    if (e.type !== "item.created" || e.aggregateId === undefined || e.payload?.title === undefined) continue;
    if (seen.has(e.aggregateId)) continue;
    seen.add(e.aggregateId);
    out.push({
      id: e.aggregateId,
      title: e.payload.title,
      kind: e.payload.kind,
      role: e.payload.role,
      parentId: e.payload.parentId,
      workspace: e.payload.workspace,
    });
  }
  return out;
}

function voieIdsFromCreatedItems(items: readonly CreatedItem[]): Map<string, string> {
  const map = new Map<string, string>();
  const re = /^(.+?) · voie:(.+?) — /u;
  for (const item of items) {
    const m = re.exec(item.title);
    if (!m) continue;
    map.set(`${m[1]!}::${m[2]!}`, item.id);
  }
  return map;
}

function coverageLayer(layer: string): CoverageLayer | undefined {
  return COVERAGE_LAYERS.includes(layer as CoverageLayer) ? (layer as CoverageLayer) : undefined;
}

function atomicLeafTitle(layer: string, voie: string, slug: string, status: string): string {
  const l = coverageLayer(layer);
  const label = l ? (findTrack(l, voie)?.label ?? voie) : voie;
  return `${layer}/${voie} · ${slug} [${status}] — ${label}`;
}

/** Transitionne vers la cible demandée sans jamais revenir en arrière. */
function realizeTransitionsTo(
  itemId: string,
  from: Realization,
  to: "in-progress" | "done" | "cancelled",
): RealizeEvent[] {
  if (from === "cancelled" || from === "rejected") return [];
  if (to === "cancelled") {
    return [{ v: 1, kind: "item.realize", payload: { itemId, to: "cancelled" } }];
  }
  if (to === "in-progress") {
    if (from === "to-do") return [{ v: 1, kind: "item.realize", payload: { itemId, to: "in-progress" } }];
    return [];
  }
  if (from === "to-do") {
    return [
      { v: 1, kind: "item.realize", payload: { itemId, to: "in-progress" } },
      { v: 1, kind: "item.realize", payload: { itemId, to: "done" } },
    ];
  }
  if (from === "in-progress") {
    return [{ v: 1, kind: "item.realize", payload: { itemId, to: "done" } }];
  }
  return []; // déjà done, ou cancelled/rejected → on ne touche pas
}

function targetForMatrixStatus(status: string): "in-progress" | "done" | undefined {
  if (status === "done") return "done";
  if (status === "planned") return "in-progress";
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan de synchro
// ─────────────────────────────────────────────────────────────────────────────

interface SyncPlan {
  readonly createEvents: ItemCreateEvent[];
  readonly events: RealizeEvent[];
  /** layer → nombre de feuilles atomiques à créer. */
  readonly createsByLayer: Map<string, number>;
  /** layer → nombre de feuilles basculées à done. */
  readonly flippedByLayer: Map<string, number>;
  /** layer → nombre de feuilles basculées à in-progress. */
  readonly startedByLayer: Map<string, number>;
  /** Anciens agrégats PV annulés pour sortir du dénominateur actif. */
  readonly cancelledAggregates: ParsedLeaf[];
  /** anomalies « track dit done mais matrice ne dit pas done » (anti-invention, sens inverse). */
  readonly trackDoneMatrixNot: ParsedLeaf[];
  /** feuilles atomiques dont le slug/layer est absent de la matrice. */
  readonly unmatchedAtomic: ParsedLeaf[];
  /** couches agrégées NON entièrement done → blocage structurel (non touchées). */
  readonly aggBlocked: { layer: string; done: number; total: number; leaves: ParsedLeaf[] }[];
  readonly workspace: string;
}

function buildPlan(items: TrackItem[], createdItems: CreatedItem[], mv: MatrixView): SyncPlan {
  const createEvents: ItemCreateEvent[] = [];
  const events: RealizeEvent[] = [];
  const createsByLayer = new Map<string, number>();
  const flippedByLayer = new Map<string, number>();
  const startedByLayer = new Map<string, number>();
  const cancelledAggregates: ParsedLeaf[] = [];
  const trackDoneMatrixNot: ParsedLeaf[] = [];
  const unmatchedAtomic: ParsedLeaf[] = [];
  const aggBlocked: { layer: string; done: number; total: number; leaves: ParsedLeaf[] }[] = [];

  const atomicLayers = DEFAULT_ATOMIC_LAYERS; // {zones, normes, pv}
  const existingAtomic = new Set<string>();
  const voieIdOf = voieIdsFromCreatedItems(createdItems);
  const bumpCreate = (layer: string) => createsByLayer.set(layer, (createsByLayer.get(layer) ?? 0) + 1);
  const bumpDone = (layer: string) => flippedByLayer.set(layer, (flippedByLayer.get(layer) ?? 0) + 1);
  const bumpStarted = (layer: string) => startedByLayer.set(layer, (startedByLayer.get(layer) ?? 0) + 1);

  // Regroupe les feuilles agrégat par couche pour décider globalement.
  const aggLeavesByLayer = new Map<string, ParsedLeaf[]>();
  let workspace = createdItems.find((it) => it.workspace)?.workspace ?? "";

  for (const item of items) {
    const leaf = parseLeaf(item);
    if (leaf === null) continue;
    // Le workspace des realize DOIT être celui des feuilles COUVERTURE ciblées
    // (pas celui d'items d'autres WP, ex. geo-lib, qui vivent dans un autre ws).
    if (workspace === "" && item.workspace) workspace = item.workspace;

    // ── Feuille ATOMIQUE (slug défini) : zones/normes/pv → sync à l'atome.
    if (leaf.slug !== undefined) {
      existingAtomic.add(`${leaf.slug}::${leaf.layer}`);
      const status = mv.cellStatus.get(`${leaf.slug}::${leaf.layer}`);
      if (status === undefined) {
        unmatchedAtomic.push(leaf);
        continue;
      }
      const target = targetForMatrixStatus(status);
      if (target === "done") {
        const before = events.length;
        events.push(...realizeTransitionsTo(leaf.id, leaf.realization, "done"));
        if (events.length > before) bumpDone(leaf.layer);
      } else if (target === "in-progress") {
        const before = events.length;
        events.push(...realizeTransitionsTo(leaf.id, leaf.realization, "in-progress"));
        if (events.length > before) bumpStarted(leaf.layer);
      } else {
        // matrice PAS done : anti-invention. Si track dit done → anomalie (on ne dé-fait pas).
        if (leaf.realization === "done") trackDoneMatrixNot.push(leaf);
      }
      continue;
    }

    // ── Migration PV : les anciens agrégats doivent sortir du rollup actif,
    //    sinon le WP deviendrait 1032/1109 au lieu de 1032/1106.
    if (leaf.layer === "pv" && leaf.aggN !== undefined) {
      const before = events.length;
      events.push(...realizeTransitionsTo(leaf.id, leaf.realization, "cancelled"));
      if (events.length > before) cancelledAggregates.push(leaf);
      continue;
    }

    // ── Feuille AGRÉGAT : accumulée, décision par couche plus bas.
    if (!atomicLayers.has(leaf.layer as never)) {
      const arr = aggLeavesByLayer.get(leaf.layer) ?? [];
      arr.push(leaf);
      aggLeavesByLayer.set(leaf.layer, arr);
    }
  }

  // ── Décision par couche AGRÉGÉE : couche entièrement done → basculer tout ; sinon bloqué.
  for (const [layer, leaves] of aggLeavesByLayer) {
    const lc = mv.layerCounts.get(layer);
    if (lc === undefined) {
      aggBlocked.push({ layer, done: 0, total: 0, leaves });
      continue;
    }
    const fullyDone = lc.total > 0 && lc.done === lc.total;
    if (fullyDone) {
      for (const leaf of leaves) {
        if (leaf.realization !== "done") {
          const before = events.length;
          events.push(...realizeTransitionsTo(leaf.id, leaf.realization, "done"));
          if (events.length > before) bumpDone(layer);
        }
      }
    } else {
      aggBlocked.push({ layer, done: lc.done, total: lc.total, leaves });
    }
  }

  // ── Migration PV : crée les feuilles manquantes à l'atome, sous la voie exacte de la matrice.
  if (atomicLayers.has("pv")) {
    if (workspace === "") {
      throw new Error("workspace introuvable dans les items track");
    }
    for (const cell of mv.cells) {
      if (cell.layer !== "pv") continue;
      if (existingAtomic.has(`${cell.slug}::${cell.layer}`)) continue;
      if (cell.voie === undefined) continue;
      const parentId = voieIdOf.get(`${cell.layer}::${cell.voie}`);
      if (parentId === undefined) {
        throw new Error(`pv/${cell.slug}: voie "${cell.voie}" sans id de workpackage`);
      }
      createEvents.push({
        v: 1,
        kind: "item.create",
        payload: {
          kind: "chore",
          title: atomicLeafTitle(cell.layer, cell.voie, cell.slug, cell.status),
          workspace,
          parentId,
        },
      });
      bumpCreate(cell.layer);
    }
  }

  return {
    createEvents,
    events,
    createsByLayer,
    flippedByLayer,
    startedByLayer,
    cancelledAggregates,
    trackDoneMatrixNot,
    unmatchedAtomic,
    aggBlocked,
    workspace,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rapport de plan (dry-run et récap)
// ─────────────────────────────────────────────────────────────────────────────

function printMatrixCounts(mv: MatrixView): void {
  // eslint-disable-next-line no-console
  console.log("── Matrice (coverage-matrix.json) : done/total par couche ──");
  for (const layer of mv.layers) {
    const lc = mv.layerCounts.get(layer)!;
    // eslint-disable-next-line no-console
    console.log(
      `  ${layer.padEnd(14)} done=${lc.done}\ttotal=${lc.total}\tplanned=${lc.planned}\tto-research=${lc.toResearch}`,
    );
  }
}

function printPlan(plan: SyncPlan): void {
  // eslint-disable-next-line no-console
  console.log("\n── Plan de synchro (créations + transitions) ──");
  const layers = [
    ...COVERAGE_LAYERS,
    ...[...new Set([
      ...plan.createsByLayer.keys(),
      ...plan.flippedByLayer.keys(),
      ...plan.startedByLayer.keys(),
    ])].filter((l) => !COVERAGE_LAYERS.includes(l as never)),
  ];
  for (const layer of layers) {
    const create = plan.createsByLayer.get(layer) ?? 0;
    const started = plan.startedByLayer.get(layer) ?? 0;
    const done = plan.flippedByLayer.get(layer) ?? 0;
    if (create || started || done) {
      console.log(
        `  ${layer.padEnd(14)} create=${create}\tin-progress=${started}\tdone=${done}`,
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log(`  TOTAL item.create = ${plan.createEvents.length}`);
  // eslint-disable-next-line no-console
  console.log(`  TOTAL item.realize = ${plan.events.length}`);

  if (plan.cancelledAggregates.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`\n── AGRÉGATS PV à annuler (sortie du dénominateur actif) : ${plan.cancelledAggregates.length} ──`);
    for (const l of plan.cancelledAggregates) console.log(`      · [${l.realization}] ${l.title}`);
  }

  if (plan.aggBlocked.length > 0) {
    // eslint-disable-next-line no-console
    console.log("\n── BLOCAGES STRUCTURELS (couches agrégées non entièrement done, NON touchées) ──");
    for (const b of plan.aggBlocked) {
      // eslint-disable-next-line no-console
      console.log(`  ${b.layer} : matrice done=${b.done}/${b.total} — ${b.leaves.length} feuille(s) agrégat laissées telles quelles`);
      for (const l of b.leaves) console.log(`      · [${l.realization}] ${l.title}`);
    }
  }
  if (plan.trackDoneMatrixNot.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`\n── ANOMALIES (track=done mais matrice≠done, laissées telles quelles) : ${plan.trackDoneMatrixNot.length} ──`);
    for (const l of plan.trackDoneMatrixNot.slice(0, 20)) console.log(`      · ${l.title}`);
    if (plan.trackDoneMatrixNot.length > 20) console.log(`      … (+${plan.trackDoneMatrixNot.length - 20})`);
  }
  if (plan.unmatchedAtomic.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`\n── FEUILLES ATOMIQUES sans cellule matrice (laissées) : ${plan.unmatchedAtomic.length} ──`);
    for (const l of plan.unmatchedAtomic.slice(0, 20)) console.log(`      · ${l.title}`);
    if (plan.unmatchedAtomic.length > 20) console.log(`      … (+${plan.unmatchedAtomic.length - 20})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function ingestEvents(
  trackBin: string,
  cwd: string,
  workspace: string,
  file: string,
  events: readonly (ItemCreateEvent | RealizeEvent)[],
): number {
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  const out = execFileSync(trackBin, ["ingest", file, "--workspace", workspace], {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).length;
}

function applyImmoLotsFromCache(trackBin: string, cwd: string, outDir: string, summary: ImmoLotsSummary): void {
  const result = applyImmoLotsTrack({ summary, trackBin, cwd, outDir });
  // eslint-disable-next-line no-console
  console.log(
    `\n[apply] immo-lots track OK: rootWpCreated=${result.rootWpCreated} ` +
      `fieldWpsCreated=${result.fieldWpsCreated} ` +
      `leavesCreated=${result.leavesCreated} realizeEvents=${result.realizeEvents} ` +
      `coarseLeavesCancelled=${result.coarseLeavesCancelled}`,
  );
  for (const total of result.totals) {
    // eslint-disable-next-line no-console
    console.log(`  ${total.wpTitle.padEnd(25)} done=${total.done}/${total.total}\tremaining=${total.remaining.length}`);
  }
}

function main(argv: readonly string[]): number {
  const apply = argv.includes("--apply");
  const trackBin = arg(argv, "--track-bin") ?? "track";
  const cwd = arg(argv, "--cwd") ?? "/home/antoinefa/src/geo";
  const outDir = arg(argv, "--out") ?? "/home/antoinefa/src/geo/work/coverage/track-events";
  const immoSummary = apply ? loadImmoLotsSummaryFromCache() : undefined;
  if (immoSummary !== undefined) immoFieldTrackTotals(immoSummary);

  const mv = loadMatrixView(MATRIX_PATH);
  printMatrixCounts(mv);

  let items = loadTrackItems(trackBin, cwd);
  let createdItems = readCreatedItems(cwd);
  // eslint-disable-next-line no-console
  console.log(`\n── Items track chargés : ${items.length} ──`);

  let plan = buildPlan(items, createdItems, mv);
  printPlan(plan);

  if (!apply) {
    // eslint-disable-next-line no-console
    console.log("\n[dry-run] aucun écrit dans .track. Relancer avec --apply pour appliquer via `track ingest`.");
    return 0;
  }
  if (immoSummary === undefined) throw new Error("immo-lots summary was not loaded for apply mode");

  if (plan.workspace === "") throw new Error("workspace introuvable dans les items track");

  mkdirSync(outDir, { recursive: true });
  if (plan.createEvents.length > 0) {
    const createFile = join(outDir, "sync-creates.jsonl");
    // eslint-disable-next-line no-console
    console.log(`\n[apply] ${plan.createEvents.length} créations → ${createFile} ; ingest via \`track ingest\`…`);
    const n = ingestEvents(trackBin, cwd, plan.workspace, createFile, plan.createEvents);
    // eslint-disable-next-line no-console
    console.log(`[apply] créations track ingest OK (${n} lignes en retour). Rechargement du store…`);
    items = loadTrackItems(trackBin, cwd);
    createdItems = readCreatedItems(cwd);
    plan = buildPlan(items, createdItems, mv);
    printPlan(plan);
  }

  if (plan.events.length === 0) {
    // eslint-disable-next-line no-console
    console.log("\n[apply] aucune transition à appliquer.");
    applyImmoLotsFromCache(trackBin, cwd, outDir, immoSummary);
    return 0;
  }

  const file = join(outDir, "sync-realizes.jsonl");
  // eslint-disable-next-line no-console
  console.log(`\n[apply] ${plan.events.length} transitions → ${file} ; ingest via \`track ingest\`…`);
  const n = ingestEvents(trackBin, cwd, plan.workspace, file, plan.events);
  // eslint-disable-next-line no-console
  console.log(`[apply] transitions track ingest OK (${n} lignes en retour).`);
  applyImmoLotsFromCache(trackBin, cwd, outDir, immoSummary);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
