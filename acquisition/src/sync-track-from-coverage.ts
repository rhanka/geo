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
 * COUCHES ATOMIQUES (zones, normes) : 1 feuille / (ville × couche). On peut donc
 * synchroniser À L'ATOME : chaque ville `done` dans la matrice dont la feuille n'est
 * pas `done` reçoit ses realize. → report fidèle au nombre de villes.
 *
 * COUCHES AGRÉGÉES (cadastre, role-foncier, pv, pmtiles) : les feuilles sont des
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
import { COVERAGE_LAYERS } from "./coverage-tracks.js";
import { DEFAULT_ATOMIC_LAYERS } from "./coverage-to-track.js";

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
  readonly payload: { readonly itemId: string; readonly to: "in-progress" | "done" };
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
}
interface RawMatrix {
  readonly cities: Record<string, Record<string, Cell>>;
}

interface MatrixView {
  /** `${slug}::${layer}` → status. */
  readonly cellStatus: Map<string, string>;
  /** layer → { done, total, planned, toResearch }. */
  readonly layerCounts: Map<string, { done: number; total: number; planned: number; toResearch: number }>;
  /** toutes les couches présentes dans la matrice (dans l'ordre de découverte). */
  readonly layers: string[];
}

function loadMatrixView(path: string): MatrixView {
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawMatrix;
  const cellStatus = new Map<string, string>();
  const layerCounts = new Map<string, { done: number; total: number; planned: number; toResearch: number }>();
  const layerOrder: string[] = [];
  for (const slug of Object.keys(raw.cities)) {
    const city = raw.cities[slug]!;
    for (const layer of Object.keys(city)) {
      const status = city[layer]?.status;
      if (status === undefined) continue;
      cellStatus.set(`${slug}::${layer}`, status);
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
  return { cellStatus, layerCounts, layers: layerOrder };
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

/** to-do → [in-progress, done] ; in-progress → [done] ; done/cancelled/rejected → []. */
function realizeTransitions(itemId: string, from: Realization): RealizeEvent[] {
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

// ─────────────────────────────────────────────────────────────────────────────
// Plan de synchro
// ─────────────────────────────────────────────────────────────────────────────

interface SyncPlan {
  readonly events: RealizeEvent[];
  /** layer → nombre de feuilles basculées à done. */
  readonly flippedByLayer: Map<string, number>;
  /** anomalies « track dit done mais matrice ne dit pas done » (anti-invention, sens inverse). */
  readonly trackDoneMatrixNot: ParsedLeaf[];
  /** feuilles atomiques dont le slug/layer est absent de la matrice. */
  readonly unmatchedAtomic: ParsedLeaf[];
  /** couches agrégées NON entièrement done → blocage structurel (non touchées). */
  readonly aggBlocked: { layer: string; done: number; total: number; leaves: ParsedLeaf[] }[];
  readonly workspace: string;
}

function buildPlan(items: TrackItem[], mv: MatrixView): SyncPlan {
  const events: RealizeEvent[] = [];
  const flippedByLayer = new Map<string, number>();
  const trackDoneMatrixNot: ParsedLeaf[] = [];
  const unmatchedAtomic: ParsedLeaf[] = [];
  const aggBlocked: { layer: string; done: number; total: number; leaves: ParsedLeaf[] }[] = [];

  const atomicLayers = DEFAULT_ATOMIC_LAYERS; // {zones, normes}
  const bump = (layer: string) => flippedByLayer.set(layer, (flippedByLayer.get(layer) ?? 0) + 1);

  // Regroupe les feuilles agrégat par couche pour décider globalement.
  const aggLeavesByLayer = new Map<string, ParsedLeaf[]>();
  let workspace = "";

  for (const item of items) {
    const leaf = parseLeaf(item);
    if (leaf === null) continue;
    // Le workspace des realize DOIT être celui des feuilles COUVERTURE ciblées
    // (pas celui d'items d'autres WP, ex. geo-lib, qui vivent dans un autre ws).
    if (workspace === "" && item.workspace) workspace = item.workspace;

    // ── Feuille ATOMIQUE (slug défini) : zones/normes → sync à l'atome.
    if (leaf.slug !== undefined) {
      const status = mv.cellStatus.get(`${leaf.slug}::${leaf.layer}`);
      if (status === undefined) {
        unmatchedAtomic.push(leaf);
        continue;
      }
      if (status === "done") {
        if (leaf.realization !== "done") {
          events.push(...realizeTransitions(leaf.id, leaf.realization));
          bump(leaf.layer);
        }
      } else {
        // matrice PAS done : anti-invention. Si track dit done → anomalie (on ne dé-fait pas).
        if (leaf.realization === "done") trackDoneMatrixNot.push(leaf);
      }
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
          events.push(...realizeTransitions(leaf.id, leaf.realization));
          bump(layer);
        }
      }
    } else {
      aggBlocked.push({ layer, done: lc.done, total: lc.total, leaves });
    }
  }

  return { events, flippedByLayer, trackDoneMatrixNot, unmatchedAtomic, aggBlocked, workspace };
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
  console.log("\n── Plan de synchro (feuilles à basculer → done) ──");
  const layers = [...COVERAGE_LAYERS, ...[...plan.flippedByLayer.keys()].filter((l) => !COVERAGE_LAYERS.includes(l as never))];
  for (const layer of layers) {
    const n = plan.flippedByLayer.get(layer);
    if (n) console.log(`  ${layer.padEnd(14)} +${n} feuille(s) → done`);
  }
  // eslint-disable-next-line no-console
  console.log(`  TOTAL events item.realize = ${plan.events.length}`);

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

function main(argv: readonly string[]): number {
  const apply = argv.includes("--apply");
  const trackBin = arg(argv, "--track-bin") ?? "track";
  const cwd = arg(argv, "--cwd") ?? "/home/antoinefa/src/geo";
  const outDir = arg(argv, "--out") ?? "/home/antoinefa/src/geo/work/coverage/track-events";

  const mv = loadMatrixView(MATRIX_PATH);
  printMatrixCounts(mv);

  const items = loadTrackItems(trackBin, cwd);
  // eslint-disable-next-line no-console
  console.log(`\n── Items track chargés : ${items.length} ──`);

  const plan = buildPlan(items, mv);
  printPlan(plan);

  if (!apply) {
    // eslint-disable-next-line no-console
    console.log("\n[dry-run] aucun écrit dans .track. Relancer avec --apply pour appliquer via `track ingest`.");
    return 0;
  }

  if (plan.events.length === 0) {
    // eslint-disable-next-line no-console
    console.log("\n[apply] rien à faire (0 event).");
    return 0;
  }
  if (plan.workspace === "") throw new Error("workspace introuvable dans les items track");

  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, "sync-realizes.jsonl");
  writeFileSync(file, plan.events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(`\n[apply] ${plan.events.length} events → ${file} ; ingest via \`track ingest\`…`);
  const out = execFileSync(trackBin, ["ingest", file, "--workspace", plan.workspace], {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const lines = out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  // eslint-disable-next-line no-console
  console.log(`[apply] track ingest OK (${lines.length} lignes en retour).`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
