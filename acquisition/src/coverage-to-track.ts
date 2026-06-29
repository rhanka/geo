/**
 * coverage-to-track.ts — projette la matrice de couverture ATOMIQUE
 * (`work/coverage/coverage-matrix.json`) dans le système `track` (@sentropic/track)
 * sous forme d'items hiérarchiques, pour que **`track report --wp`** présente le
 * progrès « par COUCHE × par VOIE, Départ/Cible » À L'ATOME (ville).
 *
 * HIÉRARCHIE construite (contrainte de nesting `track` : un `role:workpackage` ne
 * peut s'imbriquer QUE sous un autre `role:workpackage`, cf. assertRoleNesting) :
 *
 *   COUCHE   = item feature, role:workpackage         → racine du rollup (WP1..WP6)
 *     VOIE   = item feature, role:workpackage, parent=COUCHE   → sous-nœud (WPn.m)
 *       VILLE = item chore (feuille)   parent=VOIE
 *
 * Le rollup `computeWpTree` somme les feuilles VILLE par VOIE et par COUCHE :
 *   - une ville `done`         → 1 feuille rattachée à sa `doneTrack`, realize=done
 *                                (transition légale : to-do→in-progress→done, 2 events)
 *   - une ville `planned`      → 1 feuille rattachée à sa 1re voie candidate,
 *                                realize=in-progress (reste bucket TO-DO ⇒ « à-faire »)
 *   - une ville `to-research`  → 1 feuille rattachée à sa 1re voie candidate,
 *                                laissée to-do (aucun realize)
 *
 * Dans `track report --wp` (md = vue CONDUCTOR, json = arbre + wpTotals), chaque
 * nœud VOIE/COUCHE porte `done/active` = **Départ/Cible** demandé.
 *
 * ── POURQUOI DEUX INGESTS (et non un seul flat jsonl) ──────────────────────────
 * Dans `track`, l'id d'un item est un ULID FRAIS frappé à l'instant de l'`apply`
 * (createItem → this.newId()), PAS dérivé d'un sourceKey. Un `item.create` doit
 * référencer son `parentId` par cet id réel ; il n'existe AUCUN mécanisme de
 * référence symbolique (client-token = idempotence de livraison, pas un alias de
 * parent ; le mapper passe `parentId` VERBATIM à createItem). On ne peut donc PAS
 * référencer dans un même flat stream un parent créé plus haut dans ce stream.
 * → On ingère d'abord la STRUCTURE (6 couches + N voies ≈ 42 items), on relit les
 *   ids imprimés DANS L'ORDRE D'ENTRÉE par `track ingest`, puis on génère le flux
 *   VILLES avec les `parentId` résolus et on l'ingère. Deux `track ingest`, mais
 *   un seul fichier par phase, sans 6636 appels CLI.
 *
 * Aucun réseau, aucun LLM. TS pur. N'ÉCRIT QUE des fichiers jsonl sous outDir.
 *
 * Usage :
 *   tsx src/coverage-to-track.ts emit   [--out <dir>]        # écrit structure.jsonl
 *   tsx src/coverage-to-track.ts tasks  --structure-ids <f> [--out <dir>]
 *   tsx src/coverage-to-track.ts run    --workspace <ws> [--track-bin track] [--out <dir>] [--report]
 *       # orchestration complète : emit → ingest structure → tasks → ingest tasks → report
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  COVERAGE_LAYERS,
  COVERAGE_TRACKS,
  findTrack,
  type CoverageLayer,
} from "./coverage-tracks.js";
import {
  loadMatrix,
  MATRIX_PATH,
  type CellState,
  type CoverageMatrix,
} from "./coverage-matrix.js";

// ─────────────────────────────────────────────────────────────────────────────
// WorkEvent — le contrat d'ingest neutre de `track` (cf. track/src/ingest/contract.ts).
// On ne modélise QUE les deux kinds dont on a besoin : item.create + item.realize.
// ─────────────────────────────────────────────────────────────────────────────

interface ItemCreateEvent {
  readonly v: 1;
  readonly kind: "item.create";
  readonly payload: {
    readonly kind: "feature" | "chore";
    readonly title: string;
    readonly workspace: string;
    readonly parentId?: string;
    readonly role?: "workpackage";
  };
}

interface ItemRealizeEvent {
  readonly v: 1;
  readonly kind: "item.realize";
  readonly payload: {
    readonly itemId: string;
    readonly to: "in-progress" | "done";
  };
}

type WorkEvent = ItemCreateEvent | ItemRealizeEvent;

const jsonl = (events: readonly WorkEvent[]): string =>
  events.map((e) => JSON.stringify(e)).join("\n") + "\n";

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURE — l'ordre est DÉTERMINISTE (couches dans COVERAGE_LAYERS, voies dans
// COVERAGE_TRACKS[layer]) : c'est cet ordre que `track ingest` imprime, ce qui
// permet de zipper les ids relus sur les nœuds.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pass 1 de structure — les 6 COUCHES (role:workpackage, racines du rollup). Ordre =
 * COVERAGE_LAYERS, ce qui permet de zipper les ids relus sur `COVERAGE_LAYERS[i]`.
 */
export function buildLayers(workspace: string): {
  layers: readonly CoverageLayer[];
  events: WorkEvent[];
} {
  const events: WorkEvent[] = COVERAGE_LAYERS.map((layer) => ({
    v: 1,
    kind: "item.create",
    payload: {
      kind: "feature",
      title: `couche: ${layer}`,
      workspace,
      role: "workpackage",
    },
  }));
  return { layers: COVERAGE_LAYERS, events };
}

/** Une voie émise (sa clé `${layer}::${trackId}` sert à zipper l'id relu). */
export interface VoieNode {
  readonly layer: CoverageLayer;
  readonly trackId: string;
}

/**
 * Pass 2 de structure — toutes les VOIES (role:workpackage) nichées sous leur COUCHE.
 * `layerIdOf` = id minté de chaque couche (relu après le pass 1). On émet la taxonomie
 * COMPLÈTE (y compris des voies à 0 ville) pour un tableau couche×voie exhaustif.
 * L'ordre des `nodes` == l'ordre des `events` == l'ordre d'impression de `track ingest`.
 */
export function buildVoies(
  workspace: string,
  layerIdOf: ReadonlyMap<CoverageLayer, string>,
): { nodes: VoieNode[]; events: WorkEvent[] } {
  const nodes: VoieNode[] = [];
  const events: WorkEvent[] = [];
  for (const layer of COVERAGE_LAYERS) {
    const parentId = layerIdOf.get(layer);
    if (parentId === undefined) {
      throw new Error(`voies: couche "${layer}" sans id (pass 1 incomplet ?)`);
    }
    for (const track of COVERAGE_TRACKS[layer]) {
      nodes.push({ layer, trackId: track.id });
      events.push({
        v: 1,
        kind: "item.create",
        payload: {
          kind: "feature",
          title: `${layer} · voie:${track.id} — ${track.label}`,
          workspace,
          parentId,
          role: "workpackage",
        },
      });
    }
  }
  return { nodes, events };
}

/** Zippe les ids relus du pass 2 sur les nœuds voie → mapping `${layer}::${trackId}` → id. */
export function mapVoieIds(
  nodes: readonly VoieNode[],
  ingestedIds: readonly string[],
): Map<string, string> {
  if (ingestedIds.length !== nodes.length) {
    throw new Error(`voies: ${ingestedIds.length} ids relus ≠ ${nodes.length} voies émises`);
  }
  const voieIdOf = new Map<string, string>();
  nodes.forEach((node, i) => voieIdOf.set(`${node.layer}::${node.trackId}`, ingestedIds[i]!));
  return voieIdOf;
}

// ─────────────────────────────────────────────────────────────────────────────
// VILLES — une feuille par (ville × couche), rattachée à sa voie résolue.
// ─────────────────────────────────────────────────────────────────────────────

/** La voie d'attache d'une cellule : doneTrack si done, sinon 1re voie candidate. */
function voieFor(cell: CellState): string | undefined {
  if (cell.status === "done") return cell.doneTrack ?? cell.candidateTracks[0];
  return cell.candidateTracks[0];
}

/** Métadonnée d'une feuille créée — le titre (UNIQUE) sert de clé de re-lecture de
 *  l'id depuis le store ; le status pilote le(s) realize. */
export interface LeafMeta {
  readonly status: CellState["status"];
  readonly title: string;
}

/**
 * Construit le flux VILLES. Chaque cellule → 1 item.create (feuille chore) sous sa
 * voie. Une ville `done` ajoute 2 realize (in-progress→done) ; `planned` ajoute 1
 * realize (in-progress) ; `to-research` n'ajoute rien (reste to-do).
 *
 * Les realize référencent l'id de la feuille — minté à l'ingest. Comme on ne le
 * connaît pas d'avance, on émet les realize APRÈS un re-relevé des ids du flux
 * villes (orchestration). Pour limiter à UN seul fichier/ingest villes, on émet le
 * flux create+realize en INTERCALANT : create(ville) immédiatement suivi de ses
 * realize — MAIS un realize a besoin de l'itemId de la ville, qui n'est connu
 * qu'après l'ingest du create. On résout donc en DEUX sous-passes villes (create
 * puis realize), documentées comme le compromis nécessaire.
 */
export function buildCityCreates(
  matrix: CoverageMatrix,
  workspace: string,
  voieIdOf: ReadonlyMap<string, string>,
  atomicLayers: ReadonlySet<CoverageLayer>,
): { creates: WorkEvent[]; leafMeta: LeafMeta[] } {
  const creates: WorkEvent[] = [];
  const leafMeta: LeafMeta[] = [];

  // ── Couches ATOMIQUES : 1 feuille par (ville × couche), bucket dérivé du status.
  //    Ordre stable : villes triées par slug, couches dans COVERAGE_LAYERS.
  const slugs = Object.keys(matrix.cities).sort();
  for (const slug of slugs) {
    const city = matrix.cities[slug]!;
    for (const layer of COVERAGE_LAYERS) {
      if (!atomicLayers.has(layer)) continue;
      const cell = city[layer];
      if (cell === undefined) continue;
      const voie = voieFor(cell);
      if (voie === undefined) continue;
      const parentId = voieIdOf.get(`${layer}::${voie}`);
      if (parentId === undefined) {
        throw new Error(`ville ${slug}/${layer}: voie "${voie}" sans id de voie résolu`);
      }
      const label = findTrack(layer, voie)?.label ?? voie;
      const title = `${layer}/${voie} · ${slug} [${cell.status}] — ${label}`;
      creates.push({
        v: 1,
        kind: "item.create",
        payload: { kind: "chore", title, workspace, parentId },
      });
      leafMeta.push({ status: cell.status, title });
    }
  }

  // ── Couches AGRÉGÉES (compromis perf, brief §CONTRAINTE PERF) : pour chaque
  //    (voie × status), UNE feuille « N villes » portant le compte N dans le titre.
  //    Le rollup compte alors des TÂCHES-VOIE (granularité grossière), pas des villes :
  //    le compte atomique vit dans le titre, pas dans le tally done/active. Documenté.
  for (const layer of COVERAGE_LAYERS) {
    if (atomicLayers.has(layer)) continue;
    // (voie, status) → nombre de villes
    const counts = new Map<string, Map<CellState["status"], number>>();
    for (const slug of slugs) {
      const cell = matrix.cities[slug]?.[layer];
      if (cell === undefined) continue;
      const voie = voieFor(cell);
      if (voie === undefined) continue;
      const per = counts.get(voie) ?? new Map<CellState["status"], number>();
      per.set(cell.status, (per.get(cell.status) ?? 0) + 1);
      counts.set(voie, per);
    }
    for (const [voie, per] of counts) {
      const parentId = voieIdOf.get(`${layer}::${voie}`);
      if (parentId === undefined) {
        throw new Error(`agrégat ${layer}/${voie}: voie sans id de voie résolu`);
      }
      const label = findTrack(layer, voie)?.label ?? voie;
      for (const [status, n] of [...per.entries()].sort()) {
        const title = `${layer}/${voie} · AGRÉGAT ${n} ville(s) [${status}] — ${label}`;
        creates.push({
          v: 1,
          kind: "item.create",
          payload: { kind: "chore", title, workspace, parentId },
        });
        leafMeta.push({ status, title });
      }
    }
  }
  return { creates, leafMeta };
}

/**
 * Produit les realize. L'id de chaque feuille est relu depuis le STORE par son TITRE
 * (clé unique) — source autoritative et NON tronquée, contrairement au stdout de
 * `track ingest` (qui peut perdre des lignes sur de gros volumes).
 */
export function buildCityRealizes(
  leafMeta: readonly LeafMeta[],
  titleToId: ReadonlyMap<string, string>,
): WorkEvent[] {
  const events: WorkEvent[] = [];
  for (const m of leafMeta) {
    const itemId = titleToId.get(m.title);
    if (itemId === undefined) {
      throw new Error(`realize: feuille "${m.title}" introuvable dans le store`);
    }
    if (m.status === "done") {
      events.push({ v: 1, kind: "item.realize", payload: { itemId, to: "in-progress" } });
      events.push({ v: 1, kind: "item.realize", payload: { itemId, to: "done" } });
    } else if (m.status === "planned") {
      events.push({ v: 1, kind: "item.realize", payload: { itemId, to: "in-progress" } });
    }
    // to-research : aucun realize (reste to-do).
  }
  return events;
}

/**
 * Relit `.track/events.jsonl` et renvoie `title → aggregateId` pour TOUS les
 * `item.created` de kind `chore` (les feuilles villes). Source autoritative des ids
 * (le store n'est jamais tronqué). On prend le PREMIER created par titre (titres uniques).
 */
export function readLeafIdsByTitle(eventsPath: string): Map<string, string> {
  const raw = readFileSync(eventsPath, "utf8");
  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    const e = JSON.parse(line) as {
      type?: string;
      aggregateId?: string;
      payload?: { kind?: string; title?: string };
    };
    if (e.type !== "item.created") continue;
    if (e.payload?.kind !== "chore") continue;
    const title = e.payload.title;
    if (title === undefined || e.aggregateId === undefined) continue;
    if (!map.has(title)) map.set(title, e.aggregateId);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration — appelle `track ingest` et relit les ids imprimés (ordre d'entrée).
// ─────────────────────────────────────────────────────────────────────────────

/** Lance `track ingest <file> --workspace <ws>` et renvoie les ids imprimés (1/ligne). */
function trackIngest(
  trackBin: string,
  file: string,
  workspace: string,
  cwd: string,
): string[] {
  const out = execFileSync(
    trackBin,
    ["ingest", file, "--workspace", workspace],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const lines = out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 1 && lines[0]!.startsWith("no-op")) return [];
  return lines;
}

interface RunOpts {
  workspace: string;
  trackBin: string;
  outDir: string;
  cwd: string;
  report: boolean;
  /** Couches émises À L'ATOME (1 feuille/ville). Les autres sont AGRÉGÉES (1 feuille « N villes »/voie×status). */
  atomicLayers: ReadonlySet<CoverageLayer>;
}

/** Couches atomiques par DÉFAUT = zones + normes (priorité du brief). Les couches
 *  cadastre/role-foncier/pv/pmtiles sont agrégées (compromis perf O(n²) du CLI ingest). */
export const DEFAULT_ATOMIC_LAYERS: ReadonlySet<CoverageLayer> = new Set<CoverageLayer>([
  "zones",
  "normes",
]);

/** Orchestration complète : emit structure → ingest → tasks → ingest → (report). */
export function run(opts: RunOpts): void {
  const matrix = loadMatrix(MATRIX_PATH);
  if (matrix === null) throw new Error(`matrice introuvable : ${MATRIX_PATH}`);
  mkdirSync(opts.outDir, { recursive: true });

  // Phase 1a — COUCHES (6 racines WP)
  const { layers, events: layerEvents } = buildLayers(opts.workspace);
  const layersFile = join(opts.outDir, "layers.jsonl");
  writeFileSync(layersFile, jsonl(layerEvents));
  const t0 = Date.now();
  const layerIds = trackIngest(opts.trackBin, layersFile, opts.workspace, opts.cwd);
  const layerIdOf = new Map<CoverageLayer, string>();
  layers.forEach((l, i) => layerIdOf.set(l, layerIds[i]!));
  // eslint-disable-next-line no-console
  console.log(`[couches] ingéré ${layerIds.length} couches`);

  // Phase 1b — VOIES (nichées sous leur couche)
  const { nodes: voieNodes, events: voieEvents } = buildVoies(opts.workspace, layerIdOf);
  const voiesFile = join(opts.outDir, "voies.jsonl");
  writeFileSync(voiesFile, jsonl(voieEvents));
  const voieIds = trackIngest(opts.trackBin, voiesFile, opts.workspace, opts.cwd);
  const t1 = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[voies] ingéré ${voieIds.length} voies en ${t1 - t0} ms (avec les couches)`);
  const voieIdOf = mapVoieIds(voieNodes, voieIds);
  const structIds = [...layerIds, ...voieIds];

  // Phase 2 — VILLES (creates)
  const { creates, leafMeta } = buildCityCreates(
    matrix,
    opts.workspace,
    voieIdOf,
    opts.atomicLayers,
  );
  const createsFile = join(opts.outDir, "city-creates.jsonl");
  writeFileSync(createsFile, jsonl(creates));
  const t2 = Date.now();
  trackIngest(opts.trackBin, createsFile, opts.workspace, opts.cwd);
  const t3 = Date.now();
  // ids relus depuis le STORE (autoritatif, non tronqué) — pas depuis le stdout.
  const eventsPath = join(opts.cwd, ".track", "events.jsonl");
  const titleToId = readLeafIdsByTitle(eventsPath);
  // eslint-disable-next-line no-console
  console.log(`[villes] ingéré ${creates.length} feuilles (${titleToId.size} relues du store) en ${t3 - t2} ms`);

  // Phase 3 — VILLES (realize)
  const realizes = buildCityRealizes(leafMeta, titleToId);
  const realizeFile = join(opts.outDir, "city-realizes.jsonl");
  writeFileSync(realizeFile, jsonl(realizes));
  const t4 = Date.now();
  trackIngest(opts.trackBin, realizeFile, opts.workspace, opts.cwd);
  const t5 = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[realize] ingéré ${realizes.length} transitions en ${t5 - t4} ms`);

  const total = structIds.length + creates.length + realizes.length;
  // eslint-disable-next-line no-console
  console.log(
    `[total] ${total} events ingérés (${structIds.length} struct + ${creates.length} villes + ${realizes.length} realize) en ${t5 - t0} ms`,
  );

  if (opts.report) {
    const md = execFileSync(opts.trackBin, ["report", "--wp", "--format", "md"], {
      cwd: opts.cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    // eslint-disable-next-line no-console
    console.log("\n===== track report --wp --format md =====\n" + md);
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
  const cmd = argv[0] ?? "help";
  const outDir = arg(argv, "--out") ?? "/home/antoinefa/src/geo/work/coverage/track-events";
  const cwd = arg(argv, "--cwd") ?? "/home/antoinefa/src/geo";

  if (cmd === "emit") {
    // Aperçu hors-ligne du pass 1 (couches) — les voies/villes ont besoin des ids
    // mintés à l'ingest (cf. `run`), donc seul le flux couches est émissible à sec.
    const ws = arg(argv, "--workspace") ?? "WORKSPACE";
    const { events } = buildLayers(ws);
    mkdirSync(outDir, { recursive: true });
    const f = join(outDir, "layers.jsonl");
    writeFileSync(f, jsonl(events));
    // eslint-disable-next-line no-console
    console.log(`[emit] ${events.length} events de couches → ${f} (voies+villes : voir \`run\`, parentId minté à l'ingest)`);
    return 0;
  }

  if (cmd === "run") {
    const ws = arg(argv, "--workspace");
    if (ws === undefined) {
      // eslint-disable-next-line no-console
      console.error(
        "usage: coverage-to-track run --workspace <ws> [--track-bin track] [--out <dir>] [--report] [--atomic-layers <l,l>|all]",
      );
      return 2;
    }
    // --atomic-layers : liste (csv) des couches à émettre À L'ATOME, ou "all".
    //   défaut = zones,normes (priorité brief) ; les autres sont agrégées.
    const al = arg(argv, "--atomic-layers");
    let atomicLayers: ReadonlySet<CoverageLayer>;
    if (al === undefined) atomicLayers = DEFAULT_ATOMIC_LAYERS;
    else if (al === "all") atomicLayers = new Set(COVERAGE_LAYERS);
    else atomicLayers = new Set(al.split(",").map((s) => s.trim()) as CoverageLayer[]);
    // eslint-disable-next-line no-console
    console.log(`[run] couches atomiques = {${[...atomicLayers].join(", ")}} ; autres = AGRÉGÉES`);
    run({
      workspace: ws,
      trackBin: arg(argv, "--track-bin") ?? "track",
      outDir,
      cwd,
      report: argv.includes("--report"),
      atomicLayers,
    });
    return 0;
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      "coverage-to-track — matrice de couverture → items `track` (couche×voie×ville)",
      "  emit  --workspace <ws> [--out <dir>]      écrit structure.jsonl (couches+voies)",
      "  run   --workspace <ws> [--track-bin track] [--out <dir>] [--report]",
      "        orchestration : ingest structure → ingest villes → ingest realize → report",
    ].join("\n"),
  );
  return cmd === "help" ? 0 : 1;
}

// Exécution directe (tsx).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
