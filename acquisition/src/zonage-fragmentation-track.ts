/**
 * zonage-fragmentation-track.ts — capitalise le chantier RECTIFICATION FRAGMENTATION
 * (contour-auto éclaté) dans le workpackage WP8 `zones-reacquire`.
 *
 * La rectification d'une géométrie contour-auto fragmentée = remplacer le contour
 * auto-dérivé d'un raster par le VRAI zonage municipal (plan à géoréf embarqué →
 * reconstruction T1). C'est exactement le thème de WP8 « ré-acquérir vrai zonage
 * municipal » — d'où le rattachement au MÊME workpackage (décision owner : « restons
 * dans wp8 »), sous des titres distincts « contour-auto fragmenté » pour ne pas les
 * confondre avec les items SIG-affectation/millésime-disjoint de zonage-reacquire-audit.
 *
 * Les titres suivent le préfixe `zones-reacquire · <slug> —` : ils NE matchent PAS le
 * parseur `couche/voie · slug [status] —` de `sync-track-from-coverage`, donc la synchro
 * couverture (relancée à chaque tick de flotte) ne les touche jamais — capitalisation durable.
 *
 * Source de vérité : work/coverage/zone-contiguity.json (statut géométrique servi) +
 * la liste curée ci-dessous des défauts francs contour-auto et de leur état de
 * rectification (les faux positifs de tokenisation et les `dispersed` triés légitimes
 * en sont EXCLUS — ce ne sont pas des ré-acquisitions). ZÉRO LLM, ZÉRO réseau.
 *
 * Idempotent (skip par TITRE complet). Réversible : les items track ne le sont pas
 * nativement, mais re-run = no-op.
 *
 * Usage :
 *   npx tsx acquisition/src/zonage-fragmentation-track.ts            # DRY (montre le plan)
 *   npx tsx acquisition/src/zonage-fragmentation-track.ts --apply    # capitalise dans le track
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const TRACK_EVENTS_DIR = join(ROOT, "work", "coverage", "track-events");
// Même workspace + WP que zonage-reacquire-audit.ts (le foyer WP8).
const WORKSPACE = "ws:5ce6fe34225640473edb8b90faa6935c9a961036c94d4915a4ff9368e947e068";
const REACQUIRE_WP_TITLE = "zones-reacquire — SIG affectation/millésime disjoint (ré-acquérir vrai zonage municipal)";
const ZONES_WP_TITLE = "couche: zones";

/** L'indicateur qualité géométrique — un livrable transverse, marqué done. */
const INDICATOR_TITLE =
  "zones-reacquire · _indicateur — qualité géométrique zone_geometry_status détecté (dispersed/fragmented/suspect) + servi à immo sur qc-zonage-<slug>";

/** Consistance lot↔zone — 2e classe de bug (mis-assignment spatial), complément WP8.
 *  Le détecteur est livré (done) ; le re-fold des villes rectifiées est en cours (agent délégué). */
const LOT_ZONE_DETECTOR_TITLE =
  "zones-reacquire · _indicateur — consistance lot↔zone (lot-zone-consistency-audit: code_zone du lot vs polygone qc-zonage servi) détecté";
const LOT_ZONE_REFOLD_TITLE =
  "zones-reacquire · _chantier — re-fold lot↔zone sur villes rectifiées (code_zone re-dérivé du qc-zonage servi ; saint-stanislas 74,3% mismatch mesuré)";

/** Défauts francs contour-auto détectés (zone-contiguity `fragmented`) + état de rectification.
 *  Curé main : exclut les faux positifs de tokenisation (preissac, stratford) et les
 *  `dispersed` triés légitimes (clarenceville/denholm/low) — non ré-acquérables. */
const FRAG_CITIES: ReadonlyArray<{ slug: string; done: boolean; note: string }> = [
  { slug: "notre-dame-de-lourdes--joliette", done: true, note: "567→96 parts (−83%) — plan dédié T1, résidu 4,0 m" },
  { slug: "cowansville", done: true, note: "882→354 parts (−60%) — plan Annexe I, résidu 0,17 m" },
  { slug: "saint-stanislas-de-kostka", done: true, note: "501→171 parts (−66%, partiel 24/48) — plan géoréf embarqué T1" },
  { slug: "saint-amable", done: false, note: "plan trouvé (résidu 0 m) mais nearest-label perd 18 codes → besoin agrégation pondérée par aire" },
  { slug: "hemmingford--les-jardins-de-napierville--2", done: false, note: "même blocage agrégation (N=1)" },
  { slug: "mont-saint-hilaire", done: false, note: "plan sans /VP embarqué → T2/T3 (GCP manuel)" },
  { slug: "boucherville", done: false, note: "déjà T2, pas de plan géoréf $0 supplémentaire" },
  { slug: "chelsea", done: false, note: "REF/MIX/RES-CV indéterminés, plan non investigué" },
];

const childTitle = (slug: string): string =>
  `zones-reacquire · ${slug} — contour-auto fragmenté (rectification T1) → ré-acquérir vrai zonage municipal`;

interface TrackItem { id: string; title: string; kind?: string }

/** item.created de TOUT kind, depuis le store autoritatif (mirror zonage-reacquire-audit). */
function readCreatedItems(cwd: string): TrackItem[] {
  const path = join(cwd, ".track", "events.jsonl");
  if (!existsSync(path)) return [];
  const out: TrackItem[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const e = JSON.parse(line) as { type?: string; aggregateId?: string; payload?: { kind?: string; title?: string } };
    if (e.type !== "item.created" || !e.aggregateId || !e.payload?.title) continue;
    if (seen.has(e.aggregateId)) continue;
    seen.add(e.aggregateId);
    out.push({ id: e.aggregateId, title: e.payload.title, kind: e.payload.kind });
  }
  return out;
}

function trackIngest(trackBin: string, file: string, cwd: string): string[] {
  const out = execFileSync(trackBin, ["ingest", file, "--workspace", WORKSPACE], {
    cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
  });
  return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("no-op"));
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const trackBin = "track";

  const items = readCreatedItems(ROOT);
  const byTitle = new Set(items.map((it) => it.title));

  // Cible = indicateur (done) + 1 item par ville défaut-franc (done/to-do).
  const targets: Array<{ title: string; done: boolean; note: string }> = [
    { title: INDICATOR_TITLE, done: true, note: "détection + serving 44 villes flaguées" },
    ...FRAG_CITIES.map((c) => ({ title: childTitle(c.slug), done: c.done, note: c.note })),
    { title: LOT_ZONE_DETECTOR_TITLE, done: true, note: "lot-zone-consistency-audit committé + confirmé (saint-stanislas 74,3%)" },
    { title: LOT_ZONE_REFOLD_TITLE, done: false, note: "re-fold délégué (scope systémique-vs-rectifiées + fix par recouvrement d'aire)" },
  ];
  const toCreate = targets.filter((t) => !byTitle.has(t.title));

  const wp = items.find((it) => it.title === REACQUIRE_WP_TITLE);
  console.log(`WP8 zones-reacquire : ${wp ? `existe (id=${wp.id})` : "ABSENT — à créer"}`);
  console.log(`cibles=${targets.length} (done=${targets.filter((t) => t.done).length}) — à créer=${toCreate.length}, déjà présents=${targets.length - toCreate.length}`);
  for (const t of targets) console.log(`  ${byTitle.has(t.title) ? "présent " : "NOUVEAU"} ${t.done ? "[done]  " : "[to-do] "} ${t.title}  — ${t.note}`);

  if (!apply) { console.log("\nDRY — passer --apply pour capitaliser dans le track."); return; }

  mkdirSync(TRACK_EVENTS_DIR, { recursive: true });

  // Phase 1 — s'assurer que le WP existe (nesté sous couche:zones).
  let wpId = wp?.id;
  if (!wpId) {
    const zonesWp = items.find((it) => it.title === ZONES_WP_TITLE);
    const wpFile = join(TRACK_EVENTS_DIR, "frag-wp.jsonl");
    writeFileSync(wpFile, JSON.stringify({
      v: 1, kind: "item.create",
      payload: { kind: "feature", title: REACQUIRE_WP_TITLE, workspace: WORKSPACE, role: "workpackage", ...(zonesWp ? { parentId: zonesWp.id } : {}) },
    }) + "\n", "utf8");
    wpId = trackIngest(trackBin, wpFile, ROOT)[0];
    console.log(`[track] créé WP zones-reacquire id=${wpId}`);
  }
  if (!wpId) throw new Error("WP zones-reacquire introuvable après ingest");

  // Phase 2 — créer les items manquants (chore).
  if (toCreate.length > 0) {
    const createFile = join(TRACK_EVENTS_DIR, "frag-children.jsonl");
    writeFileSync(createFile, toCreate.map((t) =>
      JSON.stringify({ v: 1, kind: "item.create", payload: { kind: "chore", title: t.title, workspace: WORKSPACE, parentId: wpId } })
    ).join("\n") + "\n", "utf8");
    trackIngest(trackBin, createFile, ROOT);
    console.log(`[track] créé ${toCreate.length} item(s).`);
  }

  // Phase 3 — realize les done NOUVELLEMENT créés (id relu du store par titre).
  const titleToId = new Map(readCreatedItems(ROOT).map((it) => [it.title, it.id]));
  const doneNew = toCreate.filter((t) => t.done);
  if (doneNew.length > 0) {
    const realizeFile = join(TRACK_EVENTS_DIR, "frag-realizes.jsonl");
    const events = doneNew.flatMap((t) => {
      const id = titleToId.get(t.title);
      if (!id) throw new Error(`realize: item "${t.title}" introuvable`);
      return [
        { v: 1, kind: "item.realize", payload: { itemId: id, to: "in-progress" } },
        { v: 1, kind: "item.realize", payload: { itemId: id, to: "done" } },
      ];
    });
    writeFileSync(realizeFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    trackIngest(trackBin, realizeFile, ROOT);
    console.log(`[track] realize done sur ${doneNew.length} item(s).`);
  }
  console.log("[track] capitalisation fragmentation terminée.");
}

main();
