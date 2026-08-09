/**
 * Consolidate the closed 6,382-key PV CAS universe into one final partition.
 *
 * This is intentionally a local, read-only report: it only reads committed
 * coverage reports and the municipal reference.  It does not contact S3,
 * capture, index, or alter any prior report.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-univers-partition-finale.ts \
 *     --out=work/coverage/pv-univers-partition-finale-YYYYMMDDTHHMMSSZ.json \
 *     --markdown=work/coverage/pv-univers-partition-finale-YYYYMMDDTHHMMSSZ.md
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const SNAPSHOT_RELATIVE = "work/coverage/pv-graphify-semantic-real-universe-20260729-snapshot-01.json";
const UNVERDICT_LIST_RELATIVE = "work/coverage/pv-graphify-semantic-real-universe-20260729-unverdict-list-01.json";
const HISTORICAL_SUMMARY_RELATIVE = "work/coverage/pv-graphify-semantic-all-20260728-summary.json";
const MUNICIPALITIES_RELATIVE = "packages/qc-sources/src/geo/municipalities.qc.json";
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const CAS_KEY = /^raw\/pv-index\/cas\/[a-f0-9]{64}\.pdf$/u;
const COMMITTED_GRAPH_REPORT = /^work\/coverage\/pv-graphify-semantic-real-universe-.*-batch.*\.json$/u;
const CONTROL_REPORT = /^work\/coverage\/pv-graphify-semantic-real-universe-\d{8}-batch-\d{2}(?:-part-\d+)?\.json$/u;
const VISUAL_REPORT = /^work\/coverage\/pv-lecture-visuelle-lot-\d{2}-\d{8}T\d{6}Z\.json$/u;

type FinalOutcome =
  | "INDEXED"
  | "CONTAMINATION_OWNER_MISMATCH"
  | "OWNER_NOT_CONFIRMED"
  | "GRAPHIFY_FAILED"
  | "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED"
  | "VISUALLY_UNREADABLE"
  | "CAS_SHA_MISMATCH"
  | "UNKNOWN_NO_TERMINAL_PV_MANIFEST"
  | "UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE"
  | "UNCLASSIFIED_NO_TERMINAL_VERDICT";

type ObservationKind = "SNAPSHOT" | "UNIVERSE_BATCH" | "VISUAL_READING" | "UNVERDICT_BATCH";

interface Observation {
  readonly storage_key: string;
  readonly outcome: Exclude<FinalOutcome, "UNCLASSIFIED_NO_TERMINAL_VERDICT">;
  readonly source: string;
  readonly generated_at: string;
  readonly kind: ObservationKind;
  readonly slug: string | null;
}

interface ParsedControlReport {
  readonly path: string;
  readonly generated_at: string;
  readonly mode: string;
  readonly universe_report: string | null;
  readonly unverdict_list: string | null;
  readonly documents: readonly Record<string, unknown>[];
}

interface OutOfUniverseObservation {
  readonly storage_key: string;
  readonly outcome: string;
  readonly source: string;
  readonly kind: ObservationKind;
}

const FINAL_OUTCOMES: readonly FinalOutcome[] = [
  "INDEXED",
  "CONTAMINATION_OWNER_MISMATCH",
  "OWNER_NOT_CONFIRMED",
  "GRAPHIFY_FAILED",
  "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED",
  "VISUALLY_UNREADABLE",
  "CAS_SHA_MISMATCH",
  "UNKNOWN_NO_TERMINAL_PV_MANIFEST",
  "UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE",
  "UNCLASSIFIED_NO_TERMINAL_VERDICT",
];

const PRECEDENCE = new Map(FINAL_OUTCOMES.map((outcome, index) => [outcome, index]));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: objet requis`);
  return value;
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}.${key}: chaîne non vide requise`);
  return value.trim();
}

function nullableString(record: Record<string, unknown>, key: string, where: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}.${key}: chaîne non vide ou null requis`);
  return value.trim();
}

function requiredArray(record: Record<string, unknown>, key: string, where: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${where}.${key}: tableau requis`);
  return value;
}

function requiredNonNegativeInteger(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`${where}.${key}: entier positif ou nul requis`);
  }
  return value;
}

function readSmallJson(path: string): unknown {
  const { size } = statSync(path);
  if (size > MAX_REPORT_BYTES) throw new Error(`${relative(ROOT, path)}: ${size} octets > plafond de ${MAX_REPORT_BYTES}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function absolute(relativePath: string): string {
  const path = resolve(ROOT, relativePath);
  if (!path.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt: ${relativePath}`);
  return path;
}

function option(name: string): string {
  const values = process.argv.slice(2)
    .filter((argument) => argument.startsWith(`--${name}=`))
    .map((argument) => argument.slice(name.length + 3));
  if (values.length !== 1 || !values[0]) throw new Error(`--${name}=... est requis une seule fois`);
  return values[0]!;
}

function outputPath(name: string, extension: ".json" | ".md"): string {
  const path = absolute(option(name));
  if (!path.startsWith(`${COVERAGE}/`)) throw new Error(`--${name} doit rester sous work/coverage`);
  if (!path.endsWith(extension)) throw new Error(`--${name} doit finir par ${extension}`);
  if (existsSync(path)) throw new Error(`refus d'écraser l'artefact: ${relative(ROOT, path)}`);
  return path;
}

function committedCoverageFiles(): string[] {
  const output = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", "work/coverage"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output.split("\n").filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function supportedGraphOutcome(value: string, where: string): Exclude<FinalOutcome, "UNCLASSIFIED_NO_TERMINAL_VERDICT"> {
  if (value === "INDEXED"
    || value === "CONTAMINATION_OWNER_MISMATCH"
    || value === "OWNER_NOT_CONFIRMED"
    || value === "GRAPHIFY_FAILED"
    || value === "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED"
    || value === "UNKNOWN_NO_TERMINAL_PV_MANIFEST"
    || value === "UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE") return value;
  throw new Error(`${where}: verdict Graphify inconnu ${value}`);
}

function supportedVisualOutcome(value: string, where: string): Exclude<FinalOutcome, "UNCLASSIFIED_NO_TERMINAL_VERDICT"> {
  if (value === "INDEXED"
    || value === "OWNER_NOT_CONFIRMED"
    || value === "VISUALLY_UNREADABLE"
    || value === "CAS_SHA_MISMATCH") return value;
  throw new Error(`${where}: verdict de lecture visuelle inconnu ${value}`);
}

function parseControlReport(path: string): ParsedControlReport | null {
  const value = readSmallJson(absolute(path));
  if (!isRecord(value) || value.contract !== "pv-graphify-semantic-control/v1") return null;
  const where = path;
  return {
    path,
    generated_at: requiredString(value, "generated_at", where),
    mode: requiredString(value, "mode", where),
    universe_report: nullableString(value, "universe_report", where),
    unverdict_list: nullableString(value, "unverdict_list", where),
    documents: requiredArray(value, "documents", where).map((document, index) => requiredRecord(document, `${where}.documents[${index}]`)),
  };
}

function writeImmutable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, path);
}

function addObservation(
  observations: Map<string, Observation[]>,
  population: ReadonlySet<string>,
  outside: OutOfUniverseObservation[],
  observation: Observation,
): void {
  if (!CAS_KEY.test(observation.storage_key)) throw new Error(`${observation.source}: clé CAS invalide ${observation.storage_key}`);
  if (!population.has(observation.storage_key)) {
    outside.push({
      storage_key: observation.storage_key,
      outcome: observation.outcome,
      source: observation.source,
      kind: observation.kind,
    });
    return;
  }
  const current = observations.get(observation.storage_key) ?? [];
  if (current.some((previous) => previous.source === observation.source)) {
    throw new Error(`${observation.source}: clé CAS répétée dans un même rapport: ${observation.storage_key}`);
  }
  current.push(observation);
  observations.set(observation.storage_key, current);
}

function addControlReportObservations(
  report: ParsedControlReport,
  kind: ObservationKind,
  observations: Map<string, Observation[]>,
  population: ReadonlySet<string>,
  outside: OutOfUniverseObservation[],
): void {
  for (const [index, document] of report.documents.entries()) {
    const where = `${report.path}.documents[${index}]`;
    addObservation(observations, population, outside, {
      storage_key: requiredString(document, "storage_key", where),
      outcome: supportedGraphOutcome(requiredString(document, "outcome", where), where),
      source: report.path,
      generated_at: report.generated_at,
      kind,
      slug: nullableString(document, "slug", where),
    });
  }
}

function addVisualReportObservations(
  path: string,
  observations: Map<string, Observation[]>,
  population: ReadonlySet<string>,
  outside: OutOfUniverseObservation[],
): void {
  const report = requiredRecord(readSmallJson(absolute(path)), path);
  if (report.contract !== "pv-lecture-visuelle-lot/v1") throw new Error(`${path}: contrat de lecture visuelle invalide`);
  const generatedAt = requiredString(report, "generated_at", path);
  for (const [index, raw] of requiredArray(report, "documents", path).entries()) {
    const document = requiredRecord(raw, `${path}.documents[${index}]`);
    const where = `${path}.documents[${index}]`;
    addObservation(observations, population, outside, {
      storage_key: requiredString(document, "storage_key", where),
      outcome: supportedVisualOutcome(requiredString(document, "outcome", where), where),
      source: path,
      generated_at: generatedAt,
      kind: "VISUAL_READING",
      slug: requiredString(document, "slug", where),
    });
  }
}

function observationOrder(left: Observation, right: Observation): number {
  const byTime = left.generated_at.localeCompare(right.generated_at);
  if (byTime !== 0) return byTime;
  const kinds: Record<ObservationKind, number> = { SNAPSHOT: 0, UNIVERSE_BATCH: 1, VISUAL_READING: 2, UNVERDICT_BATCH: 3 };
  return kinds[left.kind] - kinds[right.kind] || left.source.localeCompare(right.source);
}

function compactPath(observations: readonly Observation[]): readonly FinalOutcome[] {
  const values: FinalOutcome[] = [];
  for (const observation of [...observations].sort(observationOrder)) {
    if (values.at(-1) !== observation.outcome) values.push(observation.outcome);
  }
  return values;
}

function finalOutcome(observations: readonly Observation[]): FinalOutcome {
  if (observations.length === 0) return "UNCLASSIFIED_NO_TERMINAL_VERDICT";
  return observations
    .map((observation) => observation.outcome)
    .sort((left, right) => PRECEDENCE.get(left)! - PRECEDENCE.get(right)!)[0]!;
}

function historicalSlugs(initialIndexed: ReadonlySet<string>): Map<string, Set<string>> {
  const summary = requiredRecord(readSmallJson(absolute(HISTORICAL_SUMMARY_RELATIVE)), HISTORICAL_SUMMARY_RELATIVE);
  if (summary.contract !== "pv-graphify-semantic-all-summary/v1") throw new Error(`${HISTORICAL_SUMMARY_RELATIVE}: contrat invalide`);
  const slugs = new Map<string, Set<string>>();
  for (const [index, rawPath] of requiredArray(summary, "source_reports", HISTORICAL_SUMMARY_RELATIVE).entries()) {
    if (typeof rawPath !== "string") throw new Error(`${HISTORICAL_SUMMARY_RELATIVE}.source_reports[${index}]: chaîne requise`);
    const path = rawPath;
    const report = requiredRecord(readSmallJson(absolute(path)), path);
    for (const [documentIndex, raw] of requiredArray(report, "documents", path).entries()) {
      const document = requiredRecord(raw, `${path}.documents[${documentIndex}]`);
      const key = requiredString(document, "storage_key", `${path}.documents[${documentIndex}]`);
      if (!initialIndexed.has(key)) continue;
      const slug = nullableString(document, "slug", `${path}.documents[${documentIndex}]`);
      if (slug === null) continue;
      const values = slugs.get(key) ?? new Set<string>();
      values.add(slug);
      slugs.set(key, values);
    }
  }
  return slugs;
}

function readMunicipalitySlugs(): ReadonlyMap<string, string> {
  const value = readSmallJson(absolute(MUNICIPALITIES_RELATIVE));
  if (!Array.isArray(value)) throw new Error(`${MUNICIPALITIES_RELATIVE}: tableau requis`);
  const municipalities = new Map<string, string>();
  for (const [index, raw] of value.entries()) {
    const municipality = requiredRecord(raw, `${MUNICIPALITIES_RELATIVE}[${index}]`);
    const slug = requiredString(municipality, "slug", `${MUNICIPALITIES_RELATIVE}[${index}]`);
    const name = requiredString(municipality, "name", `${MUNICIPALITIES_RELATIVE}[${index}]`);
    if (municipalities.has(slug)) throw new Error(`${MUNICIPALITIES_RELATIVE}: slug municipal dupliqué ${slug}`);
    municipalities.set(slug, name);
  }
  if (municipalities.size !== 1106) throw new Error(`${MUNICIPALITIES_RELATIVE}: attendu 1106 municipalités, reçu ${municipalities.size}`);
  return municipalities;
}

function markdown(
  generatedAt: string,
  partition: readonly { readonly outcome: FinalOutcome; readonly cas_keys: number }[],
  total: number,
  multiDistinct: readonly { readonly path: string; readonly cas_keys: number }[],
  multiObservationCount: number,
  naiveGraphObservations: number,
  naiveGraphExcess: number,
  naiveGraphDuplicateKeys: number,
  visualIndexed: number,
  visualOwnerNotConfirmed: number,
  visualRetriedAfterReading: number,
  allObservationExcess: number,
  visualInside: number,
  visualOutside: number,
  municipalCount: number,
  unresolvedMunicipalities: number,
  unclassified: number,
): string {
  const dominant = multiDistinct[0] ?? null;
  return `# Partition finale de l'univers PV CAS\n\n` +
    `Généré (UTC) : ${generatedAt}\n\n` +
    `Population ancrée sur \`${SNAPSHOT_RELATIVE}\` : **${total}** clés CAS. La priorité finale est : INDEXED > CONTAMINATION_OWNER_MISMATCH > OWNER_NOT_CONFIRMED > GRAPHIFY_FAILED > DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED > VISUALLY_UNREADABLE > CAS_SHA_MISMATCH > UNKNOWN_NO_TERMINAL_PV_MANIFEST > UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE. L'état final prime donc sur le parcours.\n\n` +
    `| Verdict final | Clés CAS |\n|---|---:|\n${partition.map((entry) => `| ${entry.outcome} | ${entry.cas_keys} |`).join("\n")}\n| **TOTAL** | **${total}** |\n\n` +
    `Verdicts multiples : **${multiDistinct.reduce((sum, entry) => sum + entry.cas_keys, 0)}** clés ont au moins deux verdicts distincts; **${multiObservationCount}** ont au moins deux observations terminales. ` +
    (dominant === null ? "Aucun parcours contradictoire." : `Parcours dominant : \`${dominant.path}\` (${dominant.cas_keys}).`) + "\n\n" +
    `Contrôle du total naïf des rapports Graphify : **${naiveGraphObservations} - ${total} = ${naiveGraphExcess}**; ces ${naiveGraphExcess} observations en trop portent sur ${naiveGraphDuplicateKeys} clés déjà présentes. La lecture visuelle est un mécanisme distinct : ${visualInside} observations dans cet univers (${visualIndexed} INDEXED, ${visualOwnerNotConfirmed} OWNER_NOT_CONFIRMED), dont ${visualRetriedAfterReading} ont ensuite été rejouées par Graphify. Toutes sources confondues, l'historique contient ${allObservationExcess} observations de plus que la partition. ${visualOutside} lecture(s) visuelle(s) hors univers ont été exclues.\n\n` +
    `Couverture municipale : **${municipalCount}/1106** municipalités ont au moins un PV indexé.` +
    (unresolvedMunicipalities === 0 ? "" : ` ${unresolvedMunicipalities} PV indexés n'ont pas de municipalité univoque.`) + "\n\n" +
    (unclassified === 0 ? "Écart de partition : **aucun**." : `Écart de partition : **${unclassified}** clé(s) dans UNCLASSIFIED_NO_TERMINAL_VERDICT.`) + "\n";
}

function main(): void {
  const output = outputPath("out", ".json");
  const markdownOutput = outputPath("markdown", ".md");
  const generatedAt = new Date().toISOString();

  const snapshot = requiredRecord(readSmallJson(absolute(SNAPSHOT_RELATIVE)), SNAPSHOT_RELATIVE);
  if (snapshot.contract !== "pv-graphify-semantic-real-universe/v1") throw new Error(`${SNAPSHOT_RELATIVE}: contrat invalide`);
  const populationSection = requiredRecord(snapshot.population, `${SNAPSHOT_RELATIVE}.population`);
  const indexedGraph = requiredRecord(snapshot.indexed_graph, `${SNAPSHOT_RELATIVE}.indexed_graph`);
  const realUniverse = requiredRecord(snapshot.real_universe, `${SNAPSHOT_RELATIVE}.real_universe`);
  const expectedPopulation = requiredNonNegativeInteger(populationSection, "unique_cas_keys", `${SNAPSHOT_RELATIVE}.population`);
  const initialIndexed = new Set<string>();
  for (const [index, raw] of requiredArray(indexedGraph, "storage_keys", `${SNAPSHOT_RELATIVE}.indexed_graph`).entries()) {
    if (typeof raw !== "string" || !CAS_KEY.test(raw)) throw new Error(`${SNAPSHOT_RELATIVE}.indexed_graph.storage_keys[${index}]: clé CAS requise`);
    initialIndexed.add(raw);
  }
  const population = new Set(initialIndexed);
  for (const [index, raw] of requiredArray(realUniverse, "documents", `${SNAPSHOT_RELATIVE}.real_universe`).entries()) {
    const document = requiredRecord(raw, `${SNAPSHOT_RELATIVE}.real_universe.documents[${index}]`);
    const key = requiredString(document, "storage_key", `${SNAPSHOT_RELATIVE}.real_universe.documents[${index}]`);
    if (!CAS_KEY.test(key)) throw new Error(`${SNAPSHOT_RELATIVE}.real_universe.documents[${index}]: clé CAS invalide`);
    if (population.has(key)) throw new Error(`${SNAPSHOT_RELATIVE}: clé CAS présente dans indexed_graph et real_universe: ${key}`);
    population.add(key);
  }
  if (population.size !== expectedPopulation) throw new Error(`population CAS non réconciliée: ${population.size}/${expectedPopulation}`);

  const queue = requiredRecord(readSmallJson(absolute(UNVERDICT_LIST_RELATIVE)), UNVERDICT_LIST_RELATIVE);
  if (queue.contract !== "pv-graphify-semantic-unverdict-list/v1") throw new Error(`${UNVERDICT_LIST_RELATIVE}: contrat invalide`);
  if (requiredString(queue, "universe_report", UNVERDICT_LIST_RELATIVE) !== SNAPSHOT_RELATIVE) {
    throw new Error(`${UNVERDICT_LIST_RELATIVE}: univers de référence inattendu`);
  }
  const verdictSources = requiredRecord(queue.verdict_sources, `${UNVERDICT_LIST_RELATIVE}.verdict_sources`);
  const frozenUniverseReports = requiredArray(verdictSources, "batch_reports", `${UNVERDICT_LIST_RELATIVE}.verdict_sources`)
    .map((raw, index) => {
      if (typeof raw !== "string" || !CONTROL_REPORT.test(`work/coverage/${raw}`)) {
        throw new Error(`${UNVERDICT_LIST_RELATIVE}.verdict_sources.batch_reports[${index}]: nom de rapport de contrôle requis`);
      }
      return `work/coverage/${raw}`;
    });
  if (new Set(frozenUniverseReports).size !== frozenUniverseReports.length) throw new Error(`${UNVERDICT_LIST_RELATIVE}: rapport de batch dupliqué`);

  const committedFiles = committedCoverageFiles();
  const allGraphReports = committedFiles.filter((path) => COMMITTED_GRAPH_REPORT.test(path));
  const controlReports = new Map<string, ParsedControlReport>();
  const auxiliaryGraphReports: string[] = [];
  for (const path of allGraphReports) {
    const report = parseControlReport(path);
    if (report === null) {
      auxiliaryGraphReports.push(path);
      continue;
    }
    controlReports.set(path, report);
  }
  for (const path of frozenUniverseReports) {
    const report = controlReports.get(path);
    if (!report) throw new Error(`${UNVERDICT_LIST_RELATIVE}: rapport gelé absent de HEAD: ${path}`);
    if (report.universe_report !== SNAPSHOT_RELATIVE || report.mode !== "real-cas-universe-batch") {
      throw new Error(`${path}: ne correspond pas au batch d'univers gelé`);
    }
  }
  const queueReports = [...controlReports.values()]
    .filter((report) => report.unverdict_list === UNVERDICT_LIST_RELATIVE)
    .sort((left, right) => left.path.localeCompare(right.path));
  if (queueReports.some((report) => report.mode !== "unverdict-cas-batch")) {
    throw new Error("rapport de queue avec un mode inattendu");
  }

  const observations = new Map<string, Observation[]>();
  const outside: OutOfUniverseObservation[] = [];
  const snapshotGeneratedAt = requiredString(snapshot, "generated_at", SNAPSHOT_RELATIVE);
  for (const key of initialIndexed) {
    addObservation(observations, population, outside, {
      storage_key: key,
      outcome: "INDEXED",
      source: `${SNAPSHOT_RELATIVE}.indexed_graph.storage_keys`,
      generated_at: snapshotGeneratedAt,
      kind: "SNAPSHOT",
      slug: null,
    });
  }
  for (const path of frozenUniverseReports) addControlReportObservations(controlReports.get(path)!, "UNIVERSE_BATCH", observations, population, outside);
  for (const report of queueReports) addControlReportObservations(report, "UNVERDICT_BATCH", observations, population, outside);

  const visualReports = committedFiles.filter((path) => VISUAL_REPORT.test(path));
  for (const path of visualReports) addVisualReportObservations(path, observations, population, outside);

  const graphObservationsByKey = new Map<string, Observation[]>();
  const visualObservationsByKey = new Map<string, Observation[]>();
  for (const [key, values] of observations) {
    const graph = values.filter((observation) => observation.kind !== "VISUAL_READING");
    const visual = values.filter((observation) => observation.kind === "VISUAL_READING");
    if (graph.length > 0) graphObservationsByKey.set(key, graph);
    if (visual.length > 0) visualObservationsByKey.set(key, visual);
  }
  const graphObservationCount = [...graphObservationsByKey.values()].reduce((total, values) => total + values.length, 0);
  const graphDuplicateDocuments = [...graphObservationsByKey.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([storageKey, values]) => ({
      storage_key: storageKey,
      path: compactPath(values).join(" -> "),
      observations: [...values].sort(observationOrder),
    }))
    .sort((left, right) => left.storage_key.localeCompare(right.storage_key));
  const graphObservationExcess = graphObservationCount - graphObservationsByKey.size;
  const visualOutcomeCounts = new Map<Exclude<FinalOutcome, "UNCLASSIFIED_NO_TERMINAL_VERDICT">, number>();
  for (const observation of [...visualObservationsByKey.values()].flat()) {
    visualOutcomeCounts.set(observation.outcome, (visualOutcomeCounts.get(observation.outcome) ?? 0) + 1);
  }
  const visualKeysWithPriorGraphObservation = [...visualObservationsByKey.keys()]
    .filter((key) => (graphObservationsByKey.get(key) ?? []).length > 0);
  const visualKeysAlsoInGraphDuplicate = visualKeysWithPriorGraphObservation
    .filter((key) => (graphObservationsByKey.get(key) ?? []).length > 1);
  const visualKeysRetriedAfterReading = visualKeysWithPriorGraphObservation
    .filter((key) => {
      const latestVisual = Math.max(...(visualObservationsByKey.get(key) ?? []).map((observation) => Date.parse(observation.generated_at)));
      return (graphObservationsByKey.get(key) ?? []).some((observation) => Date.parse(observation.generated_at) > latestVisual);
    });

  const historical = historicalSlugs(initialIndexed);
  const municipalities = readMunicipalitySlugs();
  const counts = new Map(FINAL_OUTCOME_VALUES());
  const multiVerdictDocuments: {
    storage_key: string;
    path: string;
    final_outcome: FinalOutcome;
    observations: readonly Observation[];
  }[] = [];
  const repeatedSameVerdictDocuments: string[] = [];
  const finalByKey = new Map<string, FinalOutcome>();
  for (const key of [...population].sort((left, right) => left.localeCompare(right))) {
    const keyObservations = [...(observations.get(key) ?? [])].sort(observationOrder);
    const outcome = finalOutcome(keyObservations);
    finalByKey.set(key, outcome);
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    const outcomes = new Set(keyObservations.map((observation) => observation.outcome));
    if (outcomes.size > 1) {
      multiVerdictDocuments.push({
        storage_key: key,
        path: compactPath(keyObservations).join(" -> "),
        final_outcome: outcome,
        observations: keyObservations,
      });
    } else if (keyObservations.length > 1) {
      repeatedSameVerdictDocuments.push(key);
    }
  }
  const partition = FINAL_OUTCOMES.map((outcome) => ({ outcome, cas_keys: counts.get(outcome) ?? 0 }));
  const partitionTotal = partition.reduce((total, entry) => total + entry.cas_keys, 0);
  if (partitionTotal !== population.size) throw new Error(`partition interne non fermée: ${partitionTotal}/${population.size}`);

  const pathDistribution = new Map<string, number>();
  for (const document of multiVerdictDocuments) pathDistribution.set(document.path, (pathDistribution.get(document.path) ?? 0) + 1);
  const multipleVerdictPaths = [...pathDistribution.entries()]
    .map(([path, casKeys]) => ({ path, cas_keys: casKeys }))
    .sort((left, right) => right.cas_keys - left.cas_keys || left.path.localeCompare(right.path));

  const indexedMunicipalities = new Map<string, string>();
  const indexedWithoutMunicipality: string[] = [];
  const indexedWithConflictingMunicipalities: { storage_key: string; slugs: readonly string[] }[] = [];
  const indexedWithUnknownMunicipality: { storage_key: string; slug: string }[] = [];
  for (const [key, outcome] of finalByKey) {
    if (outcome !== "INDEXED") continue;
    const slugs = new Set<string>();
    for (const observation of observations.get(key) ?? []) {
      if (observation.outcome === "INDEXED" && observation.slug !== null) slugs.add(observation.slug);
    }
    for (const slug of historical.get(key) ?? []) slugs.add(slug);
    if (slugs.size === 0) {
      indexedWithoutMunicipality.push(key);
      continue;
    }
    if (slugs.size > 1) {
      indexedWithConflictingMunicipalities.push({ storage_key: key, slugs: [...slugs].sort((left, right) => left.localeCompare(right)) });
      continue;
    }
    const slug = [...slugs][0]!;
    const name = municipalities.get(slug);
    if (name === undefined) {
      indexedWithUnknownMunicipality.push({ storage_key: key, slug });
      continue;
    }
    indexedMunicipalities.set(slug, name);
  }

  const visualInside = [...observations.values()]
    .flat()
    .filter((observation) => observation.kind === "VISUAL_READING").length;
  const visualOutside = outside.filter((observation) => observation.kind === "VISUAL_READING").length;
  const report = {
    contract: "pv-univers-partition-finale/v1",
    generated_at: generatedAt,
    read_only_aggregation: true,
    scope: {
      universe_report: SNAPSHOT_RELATIVE,
      expected_unique_cas_keys: expectedPopulation,
      queue_report: UNVERDICT_LIST_RELATIVE,
      committed_graph_report_glob: "work/coverage/pv-graphify-semantic-real-universe-*-batch*.json",
      committed_graph_reports: allGraphReports.length,
      committed_control_reports: controlReports.size,
      committed_auxiliary_reports: auxiliaryGraphReports.length,
      frozen_universe_batch_reports: frozenUniverseReports.length,
      queue_batch_reports: queueReports.length,
      visual_reading_reports: visualReports.length,
      source_inventory_sha256: createHash("sha256")
        .update(JSON.stringify({ frozenUniverseReports, queueReports: queueReports.map((report) => report.path), visualReports }))
        .digest("hex"),
    },
    precedence: {
      ordered_final_states: FINAL_OUTCOMES,
      rationale: "L'état INDEXED est final; les refus de propriétaire priment sur les échecs techniques; les UNKNOWN restent les derniers recours. GRAPHIFY_FAILED est distinct de l'échec de lecture/extraction.",
    },
    partition: {
      categories: partition,
      total_cas_keys: partitionTotal,
      expected_cas_keys: expectedPopulation,
      closed: partitionTotal === expectedPopulation,
      unclassified_no_terminal_verdict: counts.get("UNCLASSIFIED_NO_TERMINAL_VERDICT") ?? 0,
    },
    naive_report_reconciliation: {
      graph_terminal_observations: graphObservationCount,
      graph_unique_cas_keys: graphObservationsByKey.size,
      graph_observation_excess_over_unique_keys: graphObservationExcess,
      graph_duplicate_keys: graphDuplicateDocuments.length,
      graph_duplicate_extra_observations: graphDuplicateDocuments.reduce((total, document) => total + document.observations.length - 1, 0),
      graph_duplicate_documents: graphDuplicateDocuments,
      visual_terminal_observations_within_closed_universe: visualObservationsByKey.size,
      visual_keys_with_a_graph_observation: visualKeysWithPriorGraphObservation.length,
      visual_keys_also_in_graph_duplicate_set: visualKeysAlsoInGraphDuplicate.length,
      visual_keys_retried_by_graphify_after_visual_reading: visualKeysRetriedAfterReading.length,
      visual_outcomes: Object.fromEntries([...visualOutcomeCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
      all_terminal_observations_within_closed_universe: [...observations.values()].reduce((total, values) => total + values.length, 0),
      all_observation_excess_over_final_partition: [...observations.values()].reduce((total, values) => total + values.length, 0) - partitionTotal,
    },
    verdict_history: {
      documents_with_multiple_distinct_verdicts: multiVerdictDocuments.length,
      documents_with_multiple_terminal_observations: multiVerdictDocuments.length + repeatedSameVerdictDocuments.length,
      documents_with_repeated_identical_verdict_only: repeatedSameVerdictDocuments.length,
      paths: multipleVerdictPaths,
      documents: multiVerdictDocuments,
    },
    visual_reading: {
      observations_within_closed_universe: visualInside,
      observations_outside_closed_universe: visualOutside,
      outside_closed_universe: outside.filter((observation) => observation.kind === "VISUAL_READING"),
    },
    municipal_coverage: {
      reference: MUNICIPALITIES_RELATIVE,
      reference_municipalities: municipalities.size,
      indexed_pvs: counts.get("INDEXED") ?? 0,
      indexed_pvs_with_unambiguous_reference_municipality: indexedMunicipalities.size === 0 ? 0 : [...finalByKey.values()].filter((outcome) => outcome === "INDEXED").length - indexedWithoutMunicipality.length - indexedWithConflictingMunicipalities.length - indexedWithUnknownMunicipality.length,
      municipalities_with_at_least_one_indexed_pv: indexedMunicipalities.size,
      municipality_slugs: [...indexedMunicipalities.entries()]
        .map(([slug, name]) => ({ slug, name }))
        .sort((left, right) => left.slug.localeCompare(right.slug)),
      indexed_pvs_without_municipality: indexedWithoutMunicipality,
      indexed_pvs_with_conflicting_municipalities: indexedWithConflictingMunicipalities,
      indexed_pvs_with_unknown_reference_municipality: indexedWithUnknownMunicipality,
    },
    out_of_universe_observations: outside,
  };
  writeImmutable(output, `${JSON.stringify(report, null, 2)}\n`);
  writeImmutable(markdownOutput, markdown(
    generatedAt,
    partition,
    partitionTotal,
    multipleVerdictPaths,
    multiVerdictDocuments.length + repeatedSameVerdictDocuments.length,
    graphObservationCount,
    graphObservationExcess,
    graphDuplicateDocuments.length,
    visualOutcomeCounts.get("INDEXED") ?? 0,
    visualOutcomeCounts.get("OWNER_NOT_CONFIRMED") ?? 0,
    visualKeysRetriedAfterReading.length,
    [...observations.values()].reduce((total, values) => total + values.length, 0) - partitionTotal,
    visualInside,
    visualOutside,
    indexedMunicipalities.size,
    indexedWithoutMunicipality.length + indexedWithConflictingMunicipalities.length + indexedWithUnknownMunicipality.length,
    counts.get("UNCLASSIFIED_NO_TERMINAL_VERDICT") ?? 0,
  ));
  process.stdout.write(`${JSON.stringify({
    json: relative(ROOT, output),
    markdown: relative(ROOT, markdownOutput),
    partition: report.partition,
    multiple_verdicts: report.verdict_history.documents_with_multiple_distinct_verdicts,
    municipal_coverage: report.municipal_coverage.municipalities_with_at_least_one_indexed_pv,
  })}\n`);
}

function FINAL_OUTCOME_VALUES(): [FinalOutcome, number][] {
  return FINAL_OUTCOMES.map((outcome) => [outcome, 0]);
}

main();
