/**
 * immo-lots-track.ts - project real immo-lots per-muni coverage into track WPs.
 *
 * Input is the S3-derived `work/coverage/immo-lots.json` cache written by
 * `immo-lots-audit.ts`. This script refuses caches without per-muni rows: aggregate
 * field totals are not enough to create honest municipality leaves. Fields are
 * nested under `immo-lots-enrichment` so the report shows them as track sub-WPs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..");
export const IMMO_LOTS_CACHE = join(ROOT, "work", "coverage", "immo-lots.json");
export const TRACK_EVENTS_DIR = join(ROOT, "work", "coverage", "track-events");
export const WORKSPACE = "ws:5ce6fe34225640473edb8b90faa6935c9a961036c94d4915a4ff9368e947e068";
const ROOT_WP_TITLE = "immo-lots-enrichment";

type Realization = "to-do" | "in-progress" | "done" | "cancelled" | "rejected";
type FieldScope = "all" | "tod";

interface TrackItem {
  readonly id: string;
  readonly title: string;
  readonly kind?: string;
  readonly role?: string;
  readonly parentId?: string;
}

interface WorkpackageCreateEvent {
  readonly v: 1;
  readonly kind: "item.create";
  readonly payload: {
    readonly kind: "feature";
    readonly title: string;
    readonly workspace: string;
    readonly role: "workpackage";
    readonly parentId?: string;
  };
}

interface LeafCreateEvent {
  readonly v: 1;
  readonly kind: "item.create";
  readonly payload: {
    readonly kind: "chore";
    readonly title: string;
    readonly workspace: string;
    readonly parentId: string;
  };
}

interface RealizeEvent {
  readonly v: 1;
  readonly kind: "item.realize";
  readonly payload: {
    readonly itemId: string;
    readonly to: "in-progress" | "done" | "cancelled";
  };
}

type WorkEvent = WorkpackageCreateEvent | LeafCreateEvent | RealizeEvent;

export interface ImmoFieldAgg {
  readonly key: string;
  readonly label: string;
  readonly scope: FieldScope;
  readonly numWith: number;
  readonly denom: number;
  readonly pct: number;
  readonly munisFull: number;
  readonly munisAny: number;
  readonly realization: "to-do" | "in-progress" | "done";
}

export interface ImmoMuniRow {
  readonly slug: string;
  readonly numLots: number;
  readonly todPresent: boolean;
  readonly numInTod: number;
  readonly normesStatus?: string;
  readonly fieldPct: Record<string, number>;
  readonly fieldNum: Record<string, number>;
}

export interface ImmoLotsSummary {
  readonly generatedAt: string;
  readonly totalMunis: number;
  readonly servedMunis: number;
  readonly statsMunis: number;
  readonly missingStats: number;
  readonly totalLots: number;
  readonly todMunis: number;
  readonly todLots: number;
  readonly numInTod: number;
  readonly fields: readonly ImmoFieldAgg[];
  readonly perMuni?: readonly ImmoMuniRow[];
}

interface FieldTrack {
  readonly key: string;
  readonly wpTitle: string;
  readonly scope: FieldScope;
  readonly thresholdPct: number;
  readonly leafSuffix: string;
}

const FIELD_TRACKS: readonly FieldTrack[] = [
  {
    key: "surface_m2",
    wpTitle: "immo-lots surface_m2",
    scope: "all",
    thresholdPct: 100,
    leafSuffix: "surface_m2 present on 100% of served lots",
  },
  {
    key: "adresse",
    wpTitle: "immo-lots adresse",
    scope: "all",
    thresholdPct: 100,
    leafSuffix: "adresse present on 100% of served lots",
  },
  {
    key: "code_postal",
    wpTitle: "immo-lots code_postal",
    scope: "all",
    thresholdPct: 100,
    leafSuffix: "code_postal present on 100% of served lots",
  },
  {
    key: "in_tod",
    wpTitle: "immo-lots in_tod",
    scope: "tod",
    thresholdPct: 100,
    leafSuffix: "TOD join present on 100% of scoped lots",
  },
  {
    key: "folded-normes",
    wpTitle: "immo-lots folded-normes",
    scope: "all",
    thresholdPct: 100,
    leafSuffix: "folded normes present on 100% of served lots",
  },
];

interface LeafPlan {
  readonly field: FieldTrack;
  readonly row: ImmoMuniRow;
  readonly title: string;
  readonly done: boolean;
}

export interface ImmoFieldTrackTotal {
  readonly key: string;
  readonly wpTitle: string;
  readonly done: number;
  readonly total: number;
  readonly remaining: readonly ImmoMuniRow[];
}

export interface ImmoTrackApplyResult {
  readonly rootWpCreated: number;
  readonly fieldWpsCreated: number;
  readonly leavesCreated: number;
  readonly realizeEvents: number;
  readonly coarseLeavesCancelled: number;
  readonly totals: readonly ImmoFieldTrackTotal[];
}

function jsonl(events: readonly WorkEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export function loadImmoLotsSummaryFromCache(cachePath = IMMO_LOTS_CACHE): ImmoLotsSummary {
  return JSON.parse(readFileSync(cachePath, "utf8")) as ImmoLotsSummary;
}

function requirePerMuni(summary: ImmoLotsSummary): readonly ImmoMuniRow[] {
  if (!Array.isArray(summary.perMuni) || summary.perMuni.length === 0) {
    throw new Error(
      "immo-lots cache has no perMuni rows; refresh it with `npx tsx acquisition/src/immo-lots-audit.ts --apply-track` when S3 is reachable.",
    );
  }
  return summary.perMuni;
}

function fieldRows(summary: ImmoLotsSummary, field: FieldTrack): ImmoMuniRow[] {
  const rows = requirePerMuni(summary).filter((r) => field.scope === "all" || r.todPresent);
  return rows.slice().sort((a, b) => a.slug.localeCompare(b.slug));
}

function fieldNum(row: ImmoMuniRow, key: string): number {
  return row.fieldNum[key] ?? 0;
}

function rawPct(row: ImmoMuniRow, key: string): number {
  return row.numLots > 0 ? (100 * fieldNum(row, key)) / row.numLots : 0;
}

function isDone(row: ImmoMuniRow, field: FieldTrack): boolean {
  if (row.numLots <= 0) return false;
  const n = fieldNum(row, field.key);
  if (field.thresholdPct >= 100) return n >= row.numLots;
  return rawPct(row, field.key) >= field.thresholdPct;
}

function leafTitle(field: FieldTrack, row: ImmoMuniRow): string {
  return `${field.wpTitle} · ${row.slug} — ${field.leafSuffix}`;
}

function buildLeafPlans(summary: ImmoLotsSummary): LeafPlan[] {
  const leaves: LeafPlan[] = [];
  for (const field of FIELD_TRACKS) {
    for (const row of fieldRows(summary, field)) {
      leaves.push({ field, row, title: leafTitle(field, row), done: isDone(row, field) });
    }
  }
  return leaves;
}

export function immoFieldTrackTotals(summary: ImmoLotsSummary): ImmoFieldTrackTotal[] {
  return FIELD_TRACKS.map((field) => {
    const rows = fieldRows(summary, field);
    const remaining = rows.filter((row) => !isDone(row, field));
    return {
      key: field.key,
      wpTitle: field.wpTitle,
      done: rows.length - remaining.length,
      total: rows.length,
      remaining,
    };
  });
}

function readCreatedItems(cwd: string): TrackItem[] {
  const path = join(cwd, ".track", "events.jsonl");
  if (!existsSync(path)) return [];
  const out: TrackItem[] = [];
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
      };
    };
    if (e.type !== "item.created" || !e.aggregateId || !e.payload?.title) continue;
    if (seen.has(e.aggregateId)) continue;
    seen.add(e.aggregateId);
    out.push({
      id: e.aggregateId,
      title: e.payload.title,
      kind: e.payload.kind,
      role: e.payload.role,
      parentId: e.payload.parentId,
    });
  }
  return out;
}

function loadTrackRealizations(cwd: string): Map<string, Realization> {
  const path = join(cwd, ".track", "events.jsonl");
  const map = new Map<string, Realization>();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const e = JSON.parse(line) as {
      type?: string;
      aggregateId?: string;
      payload?: { to?: Realization };
    };
    if (!e.aggregateId) continue;
    if (e.type === "item.created" && !map.has(e.aggregateId)) {
      map.set(e.aggregateId, "to-do");
    } else if (e.type === "realization.transition" && e.payload?.to) {
      map.set(e.aggregateId, e.payload.to);
    }
  }
  return map;
}

function trackIngest(trackBin: string, file: string, cwd: string): string[] {
  const out = execFileSync(trackBin, ["ingest", file, "--workspace", WORKSPACE], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("no-op"));
}

function realizeToDone(itemId: string, from: Realization): RealizeEvent[] {
  if (from === "done" || from === "cancelled" || from === "rejected") return [];
  if (from === "in-progress") return [{ v: 1, kind: "item.realize", payload: { itemId, to: "done" } }];
  return [
    { v: 1, kind: "item.realize", payload: { itemId, to: "in-progress" } },
    { v: 1, kind: "item.realize", payload: { itemId, to: "done" } },
  ];
}

function cancelActive(itemId: string, from: Realization): RealizeEvent[] {
  if (from === "done" || from === "cancelled" || from === "rejected") return [];
  return [{ v: 1, kind: "item.realize", payload: { itemId, to: "cancelled" } }];
}

function oldCoarseImmoLeaf(item: TrackItem): boolean {
  return /^immo-lots · (surface_m2|adresse|code_postal|folded-normes|in_tod) — /u.test(item.title);
}

export function applyImmoLotsTrack(opts: {
  readonly summary: ImmoLotsSummary;
  readonly trackBin?: string;
  readonly cwd?: string;
  readonly outDir?: string;
}): ImmoTrackApplyResult {
  const trackBin = opts.trackBin ?? "track";
  const cwd = opts.cwd ?? ROOT;
  const outDir = opts.outDir ?? TRACK_EVENTS_DIR;
  mkdirSync(outDir, { recursive: true });

  const leaves = buildLeafPlans(opts.summary);
  const totals = immoFieldTrackTotals(opts.summary);

  let items = readCreatedItems(cwd);
  let rootWpCreated = 0;
  if (!items.some((it) => it.role === "workpackage" && it.title === ROOT_WP_TITLE)) {
    const file = join(outDir, "immo-lots-root-wp.jsonl");
    writeFileSync(
      file,
      jsonl([
        {
          v: 1,
          kind: "item.create",
          payload: { kind: "feature", title: ROOT_WP_TITLE, workspace: WORKSPACE, role: "workpackage" },
        },
      ]),
      "utf8",
    );
    trackIngest(trackBin, file, cwd);
    rootWpCreated = 1;
    items = readCreatedItems(cwd);
  }
  const rootWp = items.find((it) => it.role === "workpackage" && it.title === ROOT_WP_TITLE);
  if (!rootWp) throw new Error(`immo-lots root WP missing after ingest: ${ROOT_WP_TITLE}`);

  const existingWpTitles = new Set(items.filter((it) => it.role === "workpackage").map((it) => it.title));
  const wpCreates: WorkpackageCreateEvent[] = FIELD_TRACKS.filter((field) => !existingWpTitles.has(field.wpTitle)).map(
    (field) => ({
      v: 1,
      kind: "item.create",
      payload: { kind: "feature", title: field.wpTitle, workspace: WORKSPACE, role: "workpackage", parentId: rootWp.id },
    }),
  );
  if (wpCreates.length > 0) {
    const file = join(outDir, "immo-lots-field-wps.jsonl");
    writeFileSync(file, jsonl(wpCreates), "utf8");
    trackIngest(trackBin, file, cwd);
    items = readCreatedItems(cwd);
  }

  const wpIdByTitle = new Map(items.filter((it) => it.role === "workpackage").map((it) => [it.title, it.id]));
  const leafCreates: LeafCreateEvent[] = [];
  const existingLeafTitles = new Set(items.filter((it) => it.kind === "chore").map((it) => it.title));
  for (const leaf of leaves) {
    if (existingLeafTitles.has(leaf.title)) continue;
    const parentId = wpIdByTitle.get(leaf.field.wpTitle);
    if (!parentId) throw new Error(`immo-lots WP missing after ingest: ${leaf.field.wpTitle}`);
    leafCreates.push({
      v: 1,
      kind: "item.create",
      payload: { kind: "chore", title: leaf.title, workspace: WORKSPACE, parentId },
    });
  }
  if (leafCreates.length > 0) {
    const file = join(outDir, "immo-lots-muni-creates.jsonl");
    writeFileSync(file, jsonl(leafCreates), "utf8");
    trackIngest(trackBin, file, cwd);
    items = readCreatedItems(cwd);
  }

  const idByTitle = new Map(items.map((it) => [it.title, it.id]));
  const realizationById = loadTrackRealizations(cwd);
  const realizeEvents: RealizeEvent[] = [];
  for (const leaf of leaves) {
    if (!leaf.done) continue;
    const id = idByTitle.get(leaf.title);
    if (!id) throw new Error(`immo-lots leaf missing after ingest: ${leaf.title}`);
    realizeEvents.push(...realizeToDone(id, realizationById.get(id) ?? "to-do"));
  }
  const coarseLeaves = items.filter(oldCoarseImmoLeaf);
  for (const item of coarseLeaves) {
    realizeEvents.push(...cancelActive(item.id, realizationById.get(item.id) ?? "to-do"));
  }
  if (realizeEvents.length > 0) {
    const file = join(outDir, "immo-lots-muni-realizes.jsonl");
    writeFileSync(file, jsonl(realizeEvents), "utf8");
    trackIngest(trackBin, file, cwd);
  }

  return {
    rootWpCreated,
    fieldWpsCreated: wpCreates.length,
    leavesCreated: leafCreates.length,
    realizeEvents: realizeEvents.length,
    coarseLeavesCancelled: coarseLeaves.filter((it) => {
      const r = realizationById.get(it.id) ?? "to-do";
      return r !== "done" && r !== "cancelled" && r !== "rejected";
    }).length,
    totals,
  };
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv: readonly string[]): number {
  const apply = argv.includes("--apply");
  const cache = arg(argv, "--cache") ?? IMMO_LOTS_CACHE;
  const cwd = arg(argv, "--cwd") ?? ROOT;
  const outDir = arg(argv, "--out") ?? TRACK_EVENTS_DIR;
  const trackBin = arg(argv, "--track-bin") ?? "track";
  const summary = loadImmoLotsSummaryFromCache(cache);
  const totals = immoFieldTrackTotals(summary);
  for (const total of totals) {
    // eslint-disable-next-line no-console
    console.log(`${total.wpTitle}: ${total.done}/${total.total} done (${total.remaining.length} remaining)`);
  }
  if (!apply) {
    // eslint-disable-next-line no-console
    console.log("[dry-run] no track writes. Re-run with --apply to ingest immo-lots WPs/leaves.");
    return 0;
  }
  const result = applyImmoLotsTrack({ summary, trackBin, cwd, outDir });
  // eslint-disable-next-line no-console
  console.log(
    `[track] immo-lots applied: rootWpCreated=${result.rootWpCreated} ` +
      `fieldWpsCreated=${result.fieldWpsCreated} leavesCreated=${result.leavesCreated} ` +
      `realizeEvents=${result.realizeEvents} coarseLeavesCancelled=${result.coarseLeavesCancelled}`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
