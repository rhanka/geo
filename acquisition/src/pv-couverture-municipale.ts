/**
 * Recompute the municipal PV coverage from verdict sources.
 *
 * A municipality is covered only when at least one CAS document has the final
 * verdict INDEXED and the source verdict has confirmed the owner printed in
 * that document. Captures, non-indexed documents, and owner/extraction
 * refusals never open coverage.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-couverture-municipale.ts \
 *     --out=work/coverage/pv-couverture-municipale-YYYYMMDDTHHMMSSZ.json \
 *     --markdown=work/coverage/pv-couverture-municipale-YYYYMMDDTHHMMSSZ.md
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MUNICIPALITIES_PATH = "packages/qc-sources/src/geo/municipalities.qc.json";
const SNAPSHOT_PATH = "work/coverage/pv-graphify-semantic-real-universe-20260729-snapshot-01.json";
const QUEUE_PATH = "work/coverage/pv-graphify-semantic-real-universe-20260729-unverdict-list-01.json";
const PARTITION_PATH = "work/coverage/pv-univers-partition-finale-20260729T215104Z.json";
const HISTORICAL_SUMMARY_PATH = "work/coverage/pv-graphify-semantic-all-20260728-summary.json";
const WAVE1_PATH = "work/coverage/pv-territorial-20260729t222149z-verdicts.json";
const WAVE2_PATH = "work/coverage/pv-territorial-20260729t231834z/pv-territorial-campaign-conversion-summary.json";
const VISUAL_V1_PATH = "work/coverage/pv-lecture-visuelle-territorial-v1-20260730T004831Z.json";
const VISUAL_V2_PATH = "work/coverage/pv-lecture-visuelle-territorial-v2-20260730T012018Z.json";
const CAS_KEY = /^raw\/pv-index\/cas\/[a-f0-9]{64}\.[a-z0-9]+$/u;
const ANNOUNCED_COVERAGE = 640;

export const FINAL_OUTCOMES = [
  "INDEXED",
  "CONTAMINATION_OWNER_MISMATCH",
  "OWNER_NOT_CONFIRMED",
  "GRAPHIFY_FAILED",
  "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED",
  "NON_INDEXED_OTHER",
  "VISUALLY_UNREADABLE",
  "CAS_SHA_MISMATCH",
  "UNKNOWN_NO_TERMINAL_PV_MANIFEST",
  "UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE",
  "UNCLASSIFIED_NO_TERMINAL_VERDICT",
] as const;

export type FinalOutcome = (typeof FINAL_OUTCOMES)[number];

export interface CoverageObservation {
  readonly storageKey: string;
  readonly outcome: FinalOutcome;
  readonly slug: string | null;
  readonly source: string;
  readonly sourceKind: string;
  readonly generatedAt: string | null;
}

export interface MunicipalityReference {
  readonly slug: string;
  readonly name: string;
}

export interface CoverageAggregation {
  readonly finalByCas: ReadonlyMap<string, FinalOutcome>;
  readonly coveredSlugs: ReadonlySet<string>;
  readonly indexedWithoutMunicipality: readonly string[];
  readonly indexedWithConflictingMunicipalities: readonly { storageKey: string; slugs: readonly string[] }[];
  readonly indexedWithUnknownMunicipality: readonly { storageKey: string; slug: string }[];
  readonly partitionSlugsNotReprojected: readonly string[];
  readonly outcomeCounts: ReadonlyMap<FinalOutcome, number>;
  readonly conflictingCasKeys: number;
}

const OUTCOME_RANK = new Map<FinalOutcome, number>(FINAL_OUTCOMES.map((outcome, index) => [outcome, index]));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: objet requis`);
  return value;
}

function array(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where}: tableau requis`);
  return value;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}: chaîne non vide requise`);
  return value.trim();
}

function optionalString(value: unknown, where: string): string | null {
  if (value === undefined || value === null) return null;
  return requiredString(value, where);
}

function relativePath(path: string): string {
  return relative(ROOT, path);
}

function absolutePath(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function readSmallJson(path: string): unknown {
  const absolute = absolutePath(path);
  const size = statSync(absolute).size;
  if (size > MAX_INPUT_BYTES) throw new Error(`${path}: ${size} octets > plafond de ${MAX_INPUT_BYTES}`);
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

function allCoverageFiles(): string[] {
  const root = absolutePath("work/coverage");
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [relativePath(path)];
    });
  return walk(root).sort((left, right) => left.localeCompare(right));
}

function asOutcome(value: unknown, where: string): FinalOutcome {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}: verdict requis`);
  const normalized = value.trim();
  if ((FINAL_OUTCOMES as readonly string[]).includes(normalized)) return normalized as FinalOutcome;
  return "NON_INDEXED_OTHER";
}

function validCas(value: unknown, where: string): string {
  const key = requiredString(value, where);
  if (!CAS_KEY.test(key)) throw new Error(`${where}: clé CAS invalide`);
  return key;
}

function slugFrom(value: unknown, where: string): string | null {
  const slug = optionalString(value, where);
  if (slug !== null && !/^[a-z0-9][a-z0-9-]*$/u.test(slug)) throw new Error(`${where}: slug invalide`);
  return slug;
}

function ownerConfirmedGraph(document: Record<string, unknown>, slug: string | null, where: string): boolean {
  const ownerScope = record(document.owner_scope, `${where}.owner_scope`);
  const status = requiredString(ownerScope.status, `${where}.owner_scope.status`);
  const printedOwners = array(ownerScope.printed_owner_slugs, `${where}.owner_scope.printed_owner_slugs`)
    .map((value, index) => requiredString(value, `${where}.owner_scope.printed_owner_slugs[${index}]`));
  return status === "CONFIRMED" && slug !== null && printedOwners.includes(slug);
}

function ownerConfirmedVisual(document: Record<string, unknown>, where: string): boolean {
  const status = document.owner_status === undefined ? null : requiredString(document.owner_status, `${where}.owner_status`);
  const printedOwner = optionalString(document.printed_owner, `${where}.printed_owner`);
  return (status === null || status === "CONFIRMED") && printedOwner !== null;
}

function addObservation(
  observations: CoverageObservation[],
  sourceKind: string,
  source: string,
  generatedAt: string | null,
  raw: Record<string, unknown>,
  outcomeValue: unknown,
  where: string,
  ownerGuard: (() => boolean) | null,
): void {
  const storageKey = validCas(raw.storage_key, `${where}.storage_key`);
  const slug = slugFrom(raw.slug, `${where}.slug`);
  let outcome = asOutcome(outcomeValue, `${where}.outcome`);
  if (outcome === "INDEXED" && ownerGuard !== null && !ownerGuard()) outcome = "OWNER_NOT_CONFIRMED";
  observations.push({ storageKey, outcome, slug, source, sourceKind, generatedAt });
}

function sourceRows(
  observations: CoverageObservation[],
  sourceKind: string,
  source: string,
  generatedAt: string | null,
  rows: readonly unknown[],
  outcomeField: "outcome" | "verdict",
  ownerGuardFactory: ((document: Record<string, unknown>, where: string) => (() => boolean) | null) | null,
  metrics: SourceMetrics,
): void {
  const seen = new Set<string>();
  for (const [index, value] of rows.entries()) {
    metrics.rows += 1;
    const where = `${source}.documents[${index}]`;
    try {
      const document = record(value, where);
      const key = validCas(document.storage_key, `${where}.storage_key`);
      seen.add(key);
      const rawOutcome = asOutcome(document[outcomeField], `${where}.${outcomeField}`);
      const ownerGuard = rawOutcome === "INDEXED" ? ownerGuardFactory?.(document, where) ?? null : null;
      addObservation(
        observations,
        sourceKind,
        source,
        generatedAt,
        document,
        rawOutcome,
        where,
        ownerGuard,
      );
      metrics.joinedRows += 1;
    } catch (error) {
      metrics.unjoinableRows += 1;
      metrics.unjoinableReasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const key of seen) metrics.keys.add(key);
}

export interface SourceMetrics {
  filesDiscovered: number;
  filesRead: number;
  excludedFiles: number;
  rows: number;
  joinedRows: number;
  unjoinableRows: number;
  unjoinableReasons: string[];
  keys: Set<string>;
  rawVerdicts: Map<string, number>;
  indexedRows: number;
  missingFiles: string[];
  unreadableFiles: string[];
}

export interface LoadedCoverageObservations {
  readonly observations: readonly CoverageObservation[];
  readonly municipalities: ReadonlyMap<string, string>;
  readonly partitionSlugs: readonly string[];
  readonly universeKeys: readonly string[];
  readonly sources: ReadonlyMap<string, SourceMetrics>;
  readonly partition: Record<string, unknown> | null;
}

function metrics(): SourceMetrics {
  return {
    filesDiscovered: 0,
    filesRead: 0,
    excludedFiles: 0,
    rows: 0,
    joinedRows: 0,
    unjoinableRows: 0,
    unjoinableReasons: [],
    keys: new Set<string>(),
    rawVerdicts: new Map<string, number>(),
    indexedRows: 0,
    missingFiles: [],
    unreadableFiles: [],
  };
}

function fileGeneratedAt(value: Record<string, unknown>, path: string): string | null {
  return optionalString(value.generated_at, `${path}.generated_at`);
}

function readSource(path: string, source: SourceMetrics): Record<string, unknown> | null {
  if (!existsSync(absolutePath(path))) {
    source.missingFiles.push(path);
    return null;
  }
  try {
    const value = record(readSmallJson(path), path);
    source.filesRead += 1;
    return value;
  } catch (error) {
    source.unreadableFiles.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function noteRawVerdicts(source: SourceMetrics, rows: readonly unknown[], field: "outcome" | "verdict"): void {
  for (const value of rows) {
    if (!isRecord(value)) continue;
    const raw = value[field];
    if (typeof raw !== "string") continue;
    source.rawVerdicts.set(raw, (source.rawVerdicts.get(raw) ?? 0) + 1);
    if (raw === "INDEXED") source.indexedRows += 1;
  }
}

function loadFixedRows(
  observations: CoverageObservation[],
  sourceKind: string,
  path: string,
  field: string,
  outcomeField: "outcome" | "verdict",
  ownerGuardFactory: ((document: Record<string, unknown>, where: string) => (() => boolean) | null) | null,
  source: SourceMetrics,
): void {
  const root = readSource(path, source);
  if (root === null) return;
  const rows = array(root[field], `${path}.${field}`);
  noteRawVerdicts(source, rows, outcomeField);
  sourceRows(observations, sourceKind, path, fileGeneratedAt(root, path), rows, outcomeField, ownerGuardFactory, source);
}

function graphOwnerGuard(document: Record<string, unknown>, where: string): (() => boolean) {
  const slug = slugFrom(document.slug, `${where}.slug`);
  return () => ownerConfirmedGraph(document, slug, where);
}

function visualOwnerGuard(document: Record<string, unknown>, where: string): (() => boolean) {
  return () => ownerConfirmedVisual(document, where);
}

function wave1OwnerGuard(document: Record<string, unknown>, where: string): (() => boolean) {
  return () => requiredString(document.classification, `${where}.classification`) === "PV_LISIBLE_PROPRIETAIRE_CONFIRME";
}

function wave2OwnerGuard(document: Record<string, unknown>, where: string): (() => boolean) {
  const slug = slugFrom(document.slug, `${where}.slug`);
  const printedOwners = array(document.printed_owner_slugs, `${where}.printed_owner_slugs`)
    .map((value, index) => requiredString(value, `${where}.printed_owner_slugs[${index}]`));
  return () => document.indexed === true && slug !== null && printedOwners.includes(slug);
}

function readMunicipalities(): Map<string, string> {
  const rows = array(readSmallJson(MUNICIPALITIES_PATH), MUNICIPALITIES_PATH);
  const municipalities = new Map<string, string>();
  for (const [index, value] of rows.entries()) {
    const where = `${MUNICIPALITIES_PATH}[${index}]`;
    const municipality = record(value, where);
    const slug = requiredString(municipality.slug, `${where}.slug`);
    const name = requiredString(municipality.name, `${where}.name`);
    if (municipalities.has(slug)) throw new Error(`${MUNICIPALITIES_PATH}: slug dupliqué ${slug}`);
    municipalities.set(slug, name);
  }
  if (municipalities.size !== 1106) throw new Error(`${MUNICIPALITIES_PATH}: attendu 1106, reçu ${municipalities.size}`);
  return municipalities;
}

function finalOutcome(values: readonly CoverageObservation[]): FinalOutcome {
  if (values.length === 0) return "UNCLASSIFIED_NO_TERMINAL_VERDICT";
  return [...values]
    .map((value) => value.outcome)
    .sort((left, right) => OUTCOME_RANK.get(left)! - OUTCOME_RANK.get(right)!)[0]!;
}

export function aggregateObservations(
  observations: readonly CoverageObservation[],
  municipalities: ReadonlyMap<string, string>,
  partitionSlugs: readonly string[] = [],
  universeKeys: readonly string[] = [],
): CoverageAggregation {
  const byCas = new Map<string, CoverageObservation[]>();
  for (const observation of observations) {
    const values = byCas.get(observation.storageKey) ?? [];
    values.push(observation);
    byCas.set(observation.storageKey, values);
  }
  const allKeys = new Set([...universeKeys, ...byCas.keys()]);
  const finalByCas = new Map<string, FinalOutcome>();
  const outcomeCounts = new Map<FinalOutcome, number>(FINAL_OUTCOMES.map((outcome) => [outcome, 0]));
  const coveredSlugs = new Set<string>();
  const indexedWithoutMunicipality: string[] = [];
  const indexedWithConflictingMunicipalities: { storageKey: string; slugs: readonly string[] }[] = [];
  const indexedWithUnknownMunicipality: { storageKey: string; slug: string }[] = [];
  let conflictingCasKeys = 0;

  for (const storageKey of [...allKeys].sort((left, right) => left.localeCompare(right))) {
    const values = byCas.get(storageKey) ?? [];
    const outcome = finalOutcome(values);
    finalByCas.set(storageKey, outcome);
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1);
    const indexedSlugs = new Set(values
      .filter((value) => value.outcome === "INDEXED" && value.slug !== null)
      .map((value) => value.slug!));
    if (outcome !== "INDEXED") continue;
    if (indexedSlugs.size === 0) {
      indexedWithoutMunicipality.push(storageKey);
    } else if (indexedSlugs.size > 1) {
      conflictingCasKeys += 1;
      indexedWithConflictingMunicipalities.push({ storageKey, slugs: [...indexedSlugs].sort((left, right) => left.localeCompare(right)) });
    } else {
      const slug = [...indexedSlugs][0]!;
      if (!municipalities.has(slug)) indexedWithUnknownMunicipality.push({ storageKey, slug });
      else coveredSlugs.add(slug);
    }
  }

  const partitionSlugsNotReprojected = [...new Set(partitionSlugs)]
    .filter((slug) => !coveredSlugs.has(slug))
    .sort((left, right) => left.localeCompare(right));
  return {
    finalByCas,
    coveredSlugs,
    indexedWithoutMunicipality,
    indexedWithConflictingMunicipalities,
    indexedWithUnknownMunicipality,
    partitionSlugsNotReprojected,
    outcomeCounts,
    conflictingCasKeys,
  };
}

function checkpointSlugs(observations: readonly CoverageObservation[], source: string): Set<string> {
  return new Set(observations
    .filter((observation) => observation.source === source && observation.outcome === "INDEXED" && observation.slug !== null)
    .map((observation) => observation.slug!));
}

function sourceJson(source: SourceMetrics): Record<string, unknown> {
  return {
    files_discovered: source.filesDiscovered,
    files_read: source.filesRead,
    excluded_files: source.excludedFiles,
    rows: source.rows,
    joined_rows: source.joinedRows,
    unjoinable_rows: source.unjoinableRows,
    unique_cas_keys: source.keys.size,
    indexed_rows: source.indexedRows,
    raw_verdicts: Object.fromEntries([...source.rawVerdicts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    missing_files: source.missingFiles,
    unreadable_files: source.unreadableFiles,
    unjoinable_reasons: source.unjoinableReasons.slice(0, 20),
  };
}

function outputPath(argument: string, extension: ".json" | ".md"): string {
  const value = process.argv.slice(2).find((entry) => entry.startsWith(`${argument}=`))?.slice(argument.length + 1);
  if (!value) throw new Error(`--${argument}=... est requis`);
  const path = absolutePath(value);
  if (!path.startsWith(`${absolutePath("work/coverage")}/`)) throw new Error(`--${argument} doit rester sous work/coverage`);
  if (!path.endsWith(extension)) throw new Error(`--${argument} doit finir par ${extension}`);
  if (existsSync(path)) throw new Error(`refus d'écraser l'artefact: ${relativePath(path)}`);
  return path;
}

function writeArtifact(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { flag: "wx" });
}

function markdown(report: Record<string, unknown>): string {
  const reference = record(report.reference, "report.reference");
  const coverage = record(report.municipal_coverage, "report.municipal_coverage");
  const dedupe = record(report.deduplication, "report.deduplication");
  const discrepancy = record(report.discrepancy_vs_640, "report.discrepancy_vs_640");
  const unknown = record(report.unknown, "report.unknown");
  return [
    "# Couverture municipale PV",
    "",
    "Définition : une municipalité est couverte si au moins un document CAS lui est projeté après déduplication et porte le verdict `INDEXED`, avec propriétaire imprimé confirmé. Une capture non indexée et tout refus restent exclus.",
    "",
    `Mesure : **${coverage.covered}/${reference.municipalities}** municipalités. Clés CAS dédupliquées : ${dedupe.unique_cas_keys}; clés finales \`INDEXED\` : ${dedupe.indexed_cas_keys}.`,
    `Écart au 640 annoncé : **${discrepancy.difference}** (${discrepancy.explanation}).`,
    `Unknown : **${unknown.cas_keys}** clés (${unknown.breakdown}); sources manquantes/injoignables : ${unknown.sources_unavailable}.`,
    "",
    "La liste complète des slugs est dans l’artefact JSON voisin. Recalcul : `npx tsx acquisition/src/pv-couverture-municipale.ts --out=work/coverage/<UTC>.json --markdown=work/coverage/<UTC>.md`.",
    "",
  ].join("\n");
}

export function loadObservations(): LoadedCoverageObservations {
  const municipalities = readMunicipalities();
  const observations: CoverageObservation[] = [];
  const sources = new Map<string, SourceMetrics>();
  const getSource = (name: string): SourceMetrics => {
    const current = sources.get(name) ?? metrics();
    sources.set(name, current);
    return current;
  };

  const snapshotSource = getSource("snapshot");
  const snapshot = readSource(SNAPSHOT_PATH, snapshotSource);
  const universeKeys: string[] = [];
  const initialIndexedKeys: string[] = [];
  if (snapshot !== null) {
    const indexedGraph = record(snapshot.indexed_graph, `${SNAPSHOT_PATH}.indexed_graph`);
    for (const [index, value] of array(indexedGraph.storage_keys, `${SNAPSHOT_PATH}.indexed_graph.storage_keys`).entries()) {
      const key = validCas(value, `${SNAPSHOT_PATH}.indexed_graph.storage_keys[${index}]`);
      initialIndexedKeys.push(key);
      universeKeys.push(key);
      observations.push({ storageKey: key, outcome: "INDEXED", slug: null, source: `${SNAPSHOT_PATH}.indexed_graph.storage_keys`, sourceKind: "snapshot", generatedAt: fileGeneratedAt(snapshot, SNAPSHOT_PATH) });
      snapshotSource.rows += 1;
      snapshotSource.joinedRows += 1;
      snapshotSource.keys.add(key);
      snapshotSource.indexedRows += 1;
    }
    const realUniverse = record(snapshot.real_universe, `${SNAPSHOT_PATH}.real_universe`);
    for (const [index, value] of array(realUniverse.documents, `${SNAPSHOT_PATH}.real_universe.documents`).entries()) {
      const document = record(value, `${SNAPSHOT_PATH}.real_universe.documents[${index}]`);
      const key = validCas(document.storage_key, `${SNAPSHOT_PATH}.real_universe.documents[${index}].storage_key`);
      universeKeys.push(key);
      snapshotSource.rows += 1;
      snapshotSource.joinedRows += 1;
      snapshotSource.keys.add(key);
    }
  }

  const historicalSource = getSource("historical_graphify");
  const historicalSummary = readSource(HISTORICAL_SUMMARY_PATH, historicalSource);
  if (historicalSummary !== null) {
    for (const [index, value] of array(historicalSummary.source_reports, `${HISTORICAL_SUMMARY_PATH}.source_reports`).entries()) {
      const path = requiredString(value, `${HISTORICAL_SUMMARY_PATH}.source_reports[${index}]`);
      historicalSource.filesDiscovered += 1;
      const report = readSource(path, historicalSource);
      if (report === null) continue;
      const rows = array(report.documents, `${path}.documents`);
      noteRawVerdicts(historicalSource, rows, "outcome");
      for (const [rowIndex, raw] of rows.entries()) {
        historicalSource.rows += 1;
        try {
          const document = record(raw, `${path}.documents[${rowIndex}]`);
          const key = validCas(document.storage_key, `${path}.documents[${rowIndex}].storage_key`);
          const slug = slugFrom(document.slug, `${path}.documents[${rowIndex}].slug`);
          observations.push({ storageKey: key, outcome: "INDEXED", slug, source: path, sourceKind: "historical_graphify", generatedAt: fileGeneratedAt(report, path) });
          historicalSource.joinedRows += 1;
          historicalSource.keys.add(key);
          historicalSource.indexedRows += 1;
        } catch (error) {
          historicalSource.unjoinableRows += 1;
          historicalSource.unjoinableReasons.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
  }

  const graphSource = getSource("graphify_real_universe");
  const graphFiles = allCoverageFiles().filter((path) => {
    const name = basename(path);
    return /^pv-graphify-semantic-real-universe-.*-batch.*\.json$/u.test(name);
  });
  graphSource.filesDiscovered = graphFiles.length;
  for (const path of graphFiles) {
    const root = readSource(path, graphSource);
    if (root === null) continue;
    if (root.contract !== "pv-graphify-semantic-control/v1" || !Array.isArray(root.documents)) {
      graphSource.excludedFiles += 1;
      continue;
    }
    const rows = array(root.documents, `${path}.documents`);
    noteRawVerdicts(graphSource, rows, "outcome");
    sourceRows(observations, "graphify_real_universe", path, fileGeneratedAt(root, path), rows, "outcome", graphOwnerGuard, graphSource);
  }

  const visualSource = getSource("visual_reading");
  const visualFiles = allCoverageFiles().filter((path) => {
    const name = basename(path);
    return /^pv-lecture-visuelle-.*\.json$/u.test(name);
  });
  visualSource.filesDiscovered = visualFiles.length;
  for (const path of visualFiles) {
    const root = readSource(path, visualSource);
    if (root === null) continue;
    if (nameIsPreflight(path) || !Array.isArray(root.documents)) {
      visualSource.excludedFiles += 1;
      continue;
    }
    const rows = array(root.documents, `${path}.documents`);
    noteRawVerdicts(visualSource, rows, "outcome");
    sourceRows(observations, "visual_reading", path, fileGeneratedAt(root, path), rows, "outcome", visualOwnerGuard, visualSource);
  }

  const partitionSource = getSource("partition");
  const partition = readSource(PARTITION_PATH, partitionSource);
  let partitionSlugs: string[] = [];
  if (partition !== null) {
    const municipalCoverage = record(partition.municipal_coverage, `${PARTITION_PATH}.municipal_coverage`);
    partitionSlugs = array(municipalCoverage.municipality_slugs, `${PARTITION_PATH}.municipal_coverage.municipality_slugs`)
      .map((value, index) => requiredString(record(value, `${PARTITION_PATH}.municipal_coverage.municipality_slugs[${index}]`).slug, `${PARTITION_PATH}.municipal_coverage.municipality_slugs[${index}].slug`));
    const historySection = record(partition.verdict_history, `${PARTITION_PATH}.verdict_history`);
    const history = array(historySection.documents, `${PARTITION_PATH}.verdict_history.documents`);
    for (const [index, value] of history.entries()) {
      const document = record(value, `${PARTITION_PATH}.verdict_history.documents[${index}]`);
      const rows = array(document.observations, `${PARTITION_PATH}.verdict_history.documents[${index}].observations`);
      noteRawVerdicts(partitionSource, rows, "outcome");
      sourceRows(observations, "partition_history", `${PARTITION_PATH}.verdict_history.documents[${index}]`, null, rows, "outcome", null, partitionSource);
    }
  }

  const wave1Source = getSource("territorial_wave1");
  loadFixedRows(observations, "territorial_wave1", WAVE1_PATH, "verdicts", "verdict", wave1OwnerGuard, wave1Source);
  const wave2Source = getSource("territorial_wave2");
  loadFixedRows(observations, "territorial_wave2", WAVE2_PATH, "document_verdicts", "verdict", wave2OwnerGuard, wave2Source);

  const queueSource = getSource("unverdict_queue");
  const queue = readSource(QUEUE_PATH, queueSource);
  if (queue !== null) {
    const rows = array(queue.documents, `${QUEUE_PATH}.documents`);
    for (const [index, value] of rows.entries()) {
      const document = record(value, `${QUEUE_PATH}.documents[${index}]`);
      const status = requiredString(document.source_status, `${QUEUE_PATH}.documents[${index}].source_status`);
      if (status !== "NO_TERMINAL_PV_MANIFEST" && status !== "AMBIGUOUS_MANIFEST_SCOPE") continue;
      queueSource.rows += 1;
      try {
        const storageKey = validCas(document.storage_key, `${QUEUE_PATH}.documents[${index}].storage_key`);
        const outcome: FinalOutcome = status === "NO_TERMINAL_PV_MANIFEST" ? "UNKNOWN_NO_TERMINAL_PV_MANIFEST" : "UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE";
        observations.push({ storageKey, outcome, slug: slugFrom(document.slug, `${QUEUE_PATH}.documents[${index}].slug`), source: QUEUE_PATH, sourceKind: "unverdict_queue", generatedAt: fileGeneratedAt(queue, QUEUE_PATH) });
        queueSource.joinedRows += 1;
        queueSource.keys.add(storageKey);
      } catch (error) {
        queueSource.unjoinableRows += 1;
        queueSource.unjoinableReasons.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  return { observations, municipalities, partitionSlugs, universeKeys, sources, partition };
}

function main(): void {
  const output = outputPath("--out", ".json");
  const markdownOutput = outputPath("--markdown", ".md");
  const generatedAt = new Date().toISOString();
  const { observations, municipalities, partitionSlugs, universeKeys, sources, partition } = loadObservations();
  const aggregation = aggregateObservations(observations, municipalities, partitionSlugs, universeKeys);
  const observedKeys = new Set(observations.map((observation) => observation.storageKey));
  const sourceUnavailable = [...sources.entries()]
    .flatMap(([name, source]) => [...source.missingFiles, ...source.unreadableFiles].map((path) => `${name}: ${path}`));
  const componentSets = [
    { name: "partition_finale", source: PARTITION_PATH, slugs: new Set(partitionSlugs) },
    { name: "vague_territoriale_1", source: WAVE1_PATH, slugs: checkpointSlugs(observations, WAVE1_PATH) },
    { name: "lecture_visuelle_v1", source: VISUAL_V1_PATH, slugs: checkpointSlugs(observations, VISUAL_V1_PATH) },
    { name: "vague_territoriale_2", source: WAVE2_PATH, slugs: checkpointSlugs(observations, WAVE2_PATH) },
    { name: "lecture_visuelle_v2", source: VISUAL_V2_PATH, slugs: checkpointSlugs(observations, VISUAL_V2_PATH) },
  ];
  const componentUnion = new Set<string>();
  let componentOverlap = 0;
  const components = componentSets.map((component) => {
    let overlaps = 0;
    for (const slug of component.slugs) {
      if (componentUnion.has(slug)) overlaps += 1;
      componentUnion.add(slug);
    }
    componentOverlap += overlaps;
    return { name: component.name, source: component.source, indexed_municipalities: component.slugs.size, overlaps_with_prior_components: overlaps };
  });

  const coveredSlugs = [...aggregation.coveredSlugs]
    .sort((left, right) => left.localeCompare(right))
    .map((slug) => ({ slug, name: municipalities.get(slug)! }));
  const outcomeCounts = Object.fromEntries(FINAL_OUTCOMES.map((outcome) => [outcome, aggregation.outcomeCounts.get(outcome) ?? 0]));
  const report: Record<string, unknown> = {
    contract: "pv-couverture-municipale/v1",
    generated_at: generatedAt,
    read_only_aggregation: true,
    definition: {
      covered_if: "Au moins un document est attribué à la municipalité comme INDEXED après déduplication par clé CAS, avec le propriétaire imprimé dans le document confirmé.",
      excluded: ["capture sans INDEXED", "OWNER_NOT_CONFIRMED", "CONTAMINATION_OWNER_MISMATCH", "échec d'extraction/lecture", "tout verdict non INDEXED"],
      cas_key: "storage_key raw/pv-index/cas/<sha256>.<extension>",
      projection: "slug du document portant le verdict INDEXED; un conflit de slugs n'ouvre aucune municipalité",
    },
    reference: { path: MUNICIPALITIES_PATH, municipalities: municipalities.size },
    sources: Object.fromEntries([...sources.entries()].map(([name, source]) => [name, sourceJson(source)])),
    universe: {
      partition_base_cas_keys: new Set(universeKeys).size,
      partition_report_cas_keys: partition?.partition && record(partition.partition, `${PARTITION_PATH}.partition`).total_cas_keys,
      all_source_cas_keys: aggregation.finalByCas.size,
      new_cas_keys_beyond_partition_base: aggregation.finalByCas.size - new Set(universeKeys).size,
      cas_keys_without_any_observation: [...aggregation.finalByCas.keys()].filter((key) => !observedKeys.has(key)),
    },
    deduplication: {
      observations: observations.length,
      unique_cas_keys: aggregation.finalByCas.size,
      indexed_cas_keys: aggregation.outcomeCounts.get("INDEXED") ?? 0,
      final_outcomes: outcomeCounts,
      conflicting_cas_keys: aggregation.conflictingCasKeys,
    },
    municipal_coverage: {
      covered: coveredSlugs.length,
      denominator: municipalities.size,
      slugs: coveredSlugs,
      indexed_pvs_without_municipality: aggregation.indexedWithoutMunicipality,
      indexed_pvs_with_conflicting_municipalities: aggregation.indexedWithConflictingMunicipalities,
      indexed_pvs_with_unknown_reference_municipality: aggregation.indexedWithUnknownMunicipality,
      partition_slugs_not_reprojected: aggregation.partitionSlugsNotReprojected,
    },
    checkpoints: {
      announced_sequence: components,
      union_municipalities: componentUnion.size,
      component_overlaps: componentOverlap,
    },
    discrepancy_vs_640: {
      announced: ANNOUNCED_COVERAGE,
      measured: coveredSlugs.length,
      difference: coveredSlugs.length - ANNOUNCED_COVERAGE,
      explanation: coveredSlugs.length === ANNOUNCED_COVERAGE
        ? "La réunion CAS-dédoublonnée projette exactement les cinq composantes annoncées; leurs ensembles de slugs sont disjoints."
        : "La mesure est la projection CAS-dédoublonnée des sources disponibles; les composantes annoncées ne sont pas une addition réputée fiable.",
    },
    unknown: {
      cas_keys: (aggregation.outcomeCounts.get("UNKNOWN_NO_TERMINAL_PV_MANIFEST") ?? 0)
        + (aggregation.outcomeCounts.get("UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE") ?? 0)
        + (aggregation.outcomeCounts.get("UNCLASSIFIED_NO_TERMINAL_VERDICT") ?? 0),
      breakdown: `UNKNOWN_NO_TERMINAL_PV_MANIFEST=${aggregation.outcomeCounts.get("UNKNOWN_NO_TERMINAL_PV_MANIFEST") ?? 0}, UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE=${aggregation.outcomeCounts.get("UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE") ?? 0}, UNCLASSIFIED_NO_TERMINAL_VERDICT=${aggregation.outcomeCounts.get("UNCLASSIFIED_NO_TERMINAL_VERDICT") ?? 0}`,
      sources_unavailable: sourceUnavailable.length,
      unavailable_source_paths: sourceUnavailable,
    },
  };
  writeArtifact(output, `${JSON.stringify(report, null, 2)}\n`);
  writeArtifact(markdownOutput, markdown(report));
  process.stdout.write(`${JSON.stringify({ json: relativePath(output), markdown: relativePath(markdownOutput), covered: coveredSlugs.length, denominator: municipalities.size, unique_cas_keys: aggregation.finalByCas.size })}\n`);
}

function nameIsPreflight(path: string): boolean {
  return basename(path).includes("-preflight");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
