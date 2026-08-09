/**
 * Project the S3-derived zonage enrichment census into track WPs and muni
 * leaves.  The CLI is dry-run by default; --apply is intentionally explicit.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MATRIX_PATH, loadMatrix } from "./coverage-matrix.js";
import {
  ZONAGE_ENRICHMENT_CACHE,
  type EffetDensifiantCoverage,
  type ZonageEnrichmentMuniRow,
  type ZonageEnrichmentSummary,
} from "./zonage-enrichment-audit.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..");
export const TRACK_EVENTS_DIR = join(ROOT, "work", "coverage", "track-events");
export const WORKSPACE = "ws:5ce6fe34225640473edb8b90faa6935c9a961036c94d4915a4ff9368e947e068";
const ROOT_WP_TITLE = "zonage-enrichment";

export const EFFET_DENSIFIANT_FOCUS = [
  "mont-tremblant",
  "saint-frederic",
  "saint-mathieu-de-beloeil",
  "sainte-catherine",
  "saint-amable",
  "rimouski",
  "rosemere",
  "saint-raymond",
  "champlain",
  "saint-come-liniere",
  "coaticook",
  "mont-saint-hilaire",
  "saint-stanislas-de-kostka",
  "cowansville",
  "levis",
  "petite-riviere-saint-francois",
  "plaisance",
  "saint-raphael",
  "alma",
  "chelsea",
  "hemmingford",
  "saint-boniface",
  "saint-charles-borromee",
  "sainte-cecile-de-milton",
  "la-sarre",
  "notre-dame-de-lourdes",
  "preissac",
  "saint-gilbert",
  "sutton",
  "neuville",
  "stratford",
] as const;

type Realization = "to-do" | "in-progress" | "done" | "cancelled" | "rejected";
type FieldKey = "reglement" | "usage_dominant" | "effet_densifiant";

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

interface FieldTrack {
  readonly key: FieldKey;
  readonly wpTitle: string;
  readonly leafSuffix: string;
}

const FIELD_TRACKS: readonly FieldTrack[] = [
  {
    key: "reglement",
    wpTitle: "zonage reglement",
    leafSuffix: "reglement_numero present on served collection",
  },
  {
    key: "usage_dominant",
    wpTitle: "zonage usage_dominant",
    leafSuffix: "usage_dominant key present on served collection",
  },
  {
    key: "effet_densifiant",
    wpTitle: "zonage effet_densifiant 4a",
    leafSuffix: "effet_densifiant real (densifie/reduit/stable)",
  },
];

interface LeafPlan {
  readonly field: FieldTrack;
  readonly row: ZonageEnrichmentMuniRow;
  readonly title: string;
  readonly done: boolean;
  readonly scaffold: boolean;
}

export interface ZonageFieldTrackTotal {
  readonly key: FieldKey;
  readonly wpTitle: string;
  readonly done: number;
  readonly total: number;
  readonly remaining: readonly ZonageEnrichmentMuniRow[];
}

export interface ZonageTrackApplyResult {
  readonly rootWpCreated: number;
  readonly fieldWpsCreated: number;
  readonly leavesCreated: number;
  readonly realizeEvents: number;
  readonly totals: readonly ZonageFieldTrackTotal[];
  readonly focusSetMissing: readonly string[];
}

function jsonl(events: readonly WorkEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
}

export function loadSummaryFromCache(cachePath = ZONAGE_ENRICHMENT_CACHE): ZonageEnrichmentSummary {
  return JSON.parse(readFileSync(cachePath, "utf8")) as ZonageEnrichmentSummary;
}

function requirePerMuni(summary: ZonageEnrichmentSummary): readonly ZonageEnrichmentMuniRow[] {
  if (!Array.isArray(summary.perMuni)) {
    throw new Error(
      "zonage-enrichment cache has no perMuni rows; refresh it with `npx tsx acquisition/src/zonage-enrichment-audit.ts` when S3 is reachable.",
    );
  }
  return summary.perMuni;
}

function missingFocusSlugs(): string[] {
  const matrix = loadMatrix(MATRIX_PATH);
  if (!matrix) throw new Error(`coverage matrix introuvable: ${MATRIX_PATH}`);
  return EFFET_DENSIFIANT_FOCUS.filter((slug) => !matrix.cities[slug]);
}

function matrixFocusSlugs(): string[] {
  const matrix = loadMatrix(MATRIX_PATH);
  if (!matrix) throw new Error(`coverage matrix introuvable: ${MATRIX_PATH}`);
  return EFFET_DENSIFIANT_FOCUS.filter((slug) => matrix.cities[slug]);
}

function syntheticMissingRow(slug: string): ZonageEnrichmentMuniRow {
  return {
    slug,
    served: false,
    reglement: false,
    usage_dominant: false,
    effet_densifiant: "absent",
  };
}

function fieldRows(
  summary: ZonageEnrichmentSummary,
  field: FieldTrack,
): ZonageEnrichmentMuniRow[] {
  const bySlug = new Map(requirePerMuni(summary).map((row) => [row.slug, row]));
  const slugs = field.key === "effet_densifiant"
    ? matrixFocusSlugs()
    : requirePerMuni(summary).map((row) => row.slug);
  return slugs
    .map((slug) => bySlug.get(slug) ?? syntheticMissingRow(slug))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function fieldDone(row: ZonageEnrichmentMuniRow, key: FieldKey): boolean {
  if (key === "reglement") return row.reglement;
  if (key === "usage_dominant") return row.usage_dominant;
  return row.effet_densifiant === "real";
}

function isScaffold(row: ZonageEnrichmentMuniRow, key: FieldKey): boolean {
  return key === "effet_densifiant" && row.effet_densifiant === "scaffold";
}

function leafTitle(field: FieldTrack, row: ZonageEnrichmentMuniRow): string {
  return `${field.wpTitle} · ${row.slug} — ${field.leafSuffix}`;
}

function buildLeafPlans(summary: ZonageEnrichmentSummary): LeafPlan[] {
  const leaves: LeafPlan[] = [];
  for (const field of FIELD_TRACKS) {
    for (const row of fieldRows(summary, field)) {
      leaves.push({
        field,
        row,
        title: leafTitle(field, row),
        done: fieldDone(row, field.key),
        scaffold: isScaffold(row, field.key),
      });
    }
  }
  return leaves;
}

export function zonageFieldTrackTotals(summary: ZonageEnrichmentSummary): ZonageFieldTrackTotal[] {
  return FIELD_TRACKS.map((field) => {
    const rows = fieldRows(summary, field);
    const remaining = rows.filter((row) => !fieldDone(row, field.key));
    const total = field.key === "effet_densifiant"
      ? matrixFocusSlugs().length
      : summary.zonesDoneUniverse;
    return {
      key: field.key,
      wpTitle: field.wpTitle,
      done: rows.filter((row) => fieldDone(row, field.key)).length,
      total,
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
    const event = JSON.parse(line) as {
      type?: string;
      aggregateId?: string;
      payload?: { kind?: string; role?: string; title?: string; parentId?: string };
    };
    if (event.type !== "item.created" || !event.aggregateId || !event.payload?.title) continue;
    if (seen.has(event.aggregateId)) continue;
    seen.add(event.aggregateId);
    out.push({
      id: event.aggregateId,
      title: event.payload.title,
      kind: event.payload.kind,
      role: event.payload.role,
      parentId: event.payload.parentId,
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
    const event = JSON.parse(line) as {
      type?: string;
      aggregateId?: string;
      payload?: { to?: Realization };
    };
    if (!event.aggregateId) continue;
    if (event.type === "item.created" && !map.has(event.aggregateId)) {
      map.set(event.aggregateId, "to-do");
    } else if (event.type === "realization.transition" && event.payload?.to) {
      map.set(event.aggregateId, event.payload.to);
    }
  }
  return map;
}

function trackIngest(trackBin: string, file: string, cwd: string): string[] {
  const output = execFileSync(trackBin, ["ingest", file, "--workspace", WORKSPACE], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("no-op"));
}

function realizeToDone(itemId: string, from: Realization): RealizeEvent[] {
  if (from === "done" || from === "cancelled" || from === "rejected") return [];
  if (from === "in-progress") return [{ v: 1, kind: "item.realize", payload: { itemId, to: "done" } }];
  return [
    { v: 1, kind: "item.realize", payload: { itemId, to: "in-progress" } },
    { v: 1, kind: "item.realize", payload: { itemId, to: "done" } },
  ];
}

function realizeToInProgress(itemId: string, from: Realization): RealizeEvent[] {
  if (from === "to-do") return [{ v: 1, kind: "item.realize", payload: { itemId, to: "in-progress" } }];
  return [];
}

export function applyZonageEnrichmentTrack(opts: {
  readonly summary: ZonageEnrichmentSummary;
  readonly trackBin?: string;
  readonly cwd?: string;
  readonly outDir?: string;
}): ZonageTrackApplyResult {
  const trackBin = opts.trackBin ?? "track";
  const cwd = opts.cwd ?? ROOT;
  const outDir = opts.outDir ?? TRACK_EVENTS_DIR;
  mkdirSync(outDir, { recursive: true });

  const leaves = buildLeafPlans(opts.summary);
  const totals = zonageFieldTrackTotals(opts.summary);
  const focusSetMissing = missingFocusSlugs();

  let items = readCreatedItems(cwd);
  let rootWpCreated = 0;
  if (!items.some((item) => item.role === "workpackage" && item.title === ROOT_WP_TITLE)) {
    const file = join(outDir, "zonage-enrichment-root-wp.jsonl");
    writeFileSync(
      file,
      jsonl([{
        v: 1,
        kind: "item.create",
        payload: { kind: "feature", title: ROOT_WP_TITLE, workspace: WORKSPACE, role: "workpackage" },
      }]),
      "utf8",
    );
    trackIngest(trackBin, file, cwd);
    rootWpCreated = 1;
    items = readCreatedItems(cwd);
  }
  const rootWp = items.find((item) => item.role === "workpackage" && item.title === ROOT_WP_TITLE);
  if (!rootWp) throw new Error(`zonage-enrichment root WP missing after ingest: ${ROOT_WP_TITLE}`);

  const existingWpTitles = new Set(items.filter((item) => item.role === "workpackage").map((item) => item.title));
  const wpCreates: WorkpackageCreateEvent[] = FIELD_TRACKS
    .filter((field) => !existingWpTitles.has(field.wpTitle))
    .map((field) => ({
      v: 1,
      kind: "item.create",
      payload: {
        kind: "feature",
        title: field.wpTitle,
        workspace: WORKSPACE,
        role: "workpackage",
        parentId: rootWp.id,
      },
    }));
  if (wpCreates.length > 0) {
    const file = join(outDir, "zonage-enrichment-field-wps.jsonl");
    writeFileSync(file, jsonl(wpCreates), "utf8");
    trackIngest(trackBin, file, cwd);
    items = readCreatedItems(cwd);
  }

  const wpIdByTitle = new Map(items.filter((item) => item.role === "workpackage").map((item) => [item.title, item.id]));
  const existingLeafTitles = new Set(items.filter((item) => item.kind === "chore").map((item) => item.title));
  const leafCreates: LeafCreateEvent[] = [];
  for (const leaf of leaves) {
    if (existingLeafTitles.has(leaf.title)) continue;
    const parentId = wpIdByTitle.get(leaf.field.wpTitle);
    if (!parentId) throw new Error(`zonage-enrichment WP missing after ingest: ${leaf.field.wpTitle}`);
    leafCreates.push({
      v: 1,
      kind: "item.create",
      payload: { kind: "chore", title: leaf.title, workspace: WORKSPACE, parentId },
    });
  }
  if (leafCreates.length > 0) {
    const file = join(outDir, "zonage-enrichment-muni-creates.jsonl");
    writeFileSync(file, jsonl(leafCreates), "utf8");
    trackIngest(trackBin, file, cwd);
    items = readCreatedItems(cwd);
  }

  const idByTitle = new Map(items.map((item) => [item.title, item.id]));
  const realizationById = loadTrackRealizations(cwd);
  const realizeEvents: RealizeEvent[] = [];
  for (const leaf of leaves) {
    if (!leaf.done && !leaf.scaffold) continue;
    const id = idByTitle.get(leaf.title);
    if (!id) throw new Error(`zonage-enrichment leaf missing after ingest: ${leaf.title}`);
    const from = realizationById.get(id) ?? "to-do";
    realizeEvents.push(...(
      leaf.done
        ? realizeToDone(id, from)
        : realizeToInProgress(id, from)
    ));
  }
  if (realizeEvents.length > 0) {
    const file = join(outDir, "zonage-enrichment-muni-realizes.jsonl");
    writeFileSync(file, jsonl(realizeEvents), "utf8");
    trackIngest(trackBin, file, cwd);
  }

  return {
    rootWpCreated,
    fieldWpsCreated: wpCreates.length,
    leavesCreated: leafCreates.length,
    realizeEvents: realizeEvents.length,
    totals,
    focusSetMissing,
  };
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const apply = argv.includes("--apply");
  const cache = arg(argv, "--cache") ?? ZONAGE_ENRICHMENT_CACHE;
  const cwd = arg(argv, "--cwd") ?? ROOT;
  const outDir = arg(argv, "--out") ?? TRACK_EVENTS_DIR;
  const trackBin = arg(argv, "--track-bin") ?? "track";
  const summary = loadSummaryFromCache(cache);
  const missing = missingFocusSlugs();
  if (missing.length > 0) console.log(`focus-set missing from matrix: ${missing.join(", ")}`);
  const totals = zonageFieldTrackTotals(summary);
  for (const total of totals) {
    console.log(`${total.wpTitle}: ${total.done}/${total.total} done (${total.remaining.length} remaining)`);
  }
  if (!apply) {
    console.log("[dry-run] no track writes. Re-run with --apply to ingest zonage-enrichment WPs/leaves.");
    return 0;
  }
  const result = applyZonageEnrichmentTrack({ summary, trackBin, cwd, outDir });
  console.log(
    `[track] zonage-enrichment applied: rootWpCreated=${result.rootWpCreated} ` +
      `fieldWpsCreated=${result.fieldWpsCreated} leavesCreated=${result.leavesCreated} ` +
      `realizeEvents=${result.realizeEvents}`,
  );
  return 0;
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exit(main());
