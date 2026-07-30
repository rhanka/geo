/**
 * Freeze the confirmed-PV reindex queue from the 244-candidate diagnostic.
 *
 * This is a local, read-only reconciliation.  It deliberately consumes the
 * diagnostic's complete trace list rather than its summary count, and records
 * every prior Graphify/territorial terminal verdict by immutable CAS key before
 * preparing a queue.  The emitted contract is accepted by the semantic runner
 * as an explicit READY-only queue; S3 is not contacted here.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-diagnostic-244-reindex-plan.ts \
 *     --out=work/coverage/pv-diagnostic-244-echecs-<stamp>-unverdict-list.json
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const DIAGNOSTIC = resolve(COVERAGE, "pv-diagnostic-244-echecs-20260730T035324Z.json");
const SNAPSHOT = resolve(COVERAGE, "pv-graphify-semantic-real-universe-20260729-snapshot-01.json");
const TERRITORIAL_VERDICTS = resolve(COVERAGE, "pv-territorial-20260729t222149z-verdicts.json");
const TERRITORIAL_CONVERSION = resolve(COVERAGE, "pv-territorial-20260729t231834z", "pv-territorial-campaign-conversion-summary.json");
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const CAS_KEY = /^raw\/pv-index\/cas\/[a-f0-9]{64}\.pdf$/u;
const REAL_BATCH_REPORT = /^pv-graphify-semantic-real-universe-.*-batch.*\.json$/u;

interface Candidate {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
  readonly source_status: "READY";
  readonly source_observations: 1;
}

interface TreatedSource {
  readonly source: string;
  readonly verdict: string;
}

interface Scan {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
}

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

function readSmallJson(path: string): unknown {
  const size = statSync(path).size;
  if (size > MAX_INPUT_BYTES) throw new Error(`${relative(ROOT, path)}: ${size} octets > plafond de lecture ${MAX_INPUT_BYTES}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function relativePath(path: string): string {
  return relative(ROOT, path);
}

function readTracePath(): string {
  const diagnostic = record(readSmallJson(DIAGNOSTIC), relativePath(DIAGNOSTIC));
  if (diagnostic.contract !== "pv-diagnostic-244-echecs/v1") throw new Error(`${relativePath(DIAGNOSTIC)}: contrat invalide`);
  const traceList = record(diagnostic.trace_list, `${relativePath(DIAGNOSTIC)}.trace_list`);
  const trace = resolve(ROOT, requiredString(traceList.path, `${relativePath(DIAGNOSTIC)}.trace_list.path`));
  if (!trace.startsWith(`${ROOT}/`)) throw new Error("trace de diagnostic hors dépôt");
  return trace;
}

function parseCandidate(attempt: Record<string, unknown>, municipality: Record<string, unknown>, where: string): Candidate {
  const storageKey = requiredString(attempt.storage_key, `${where}.storage_key`);
  if (!CAS_KEY.test(storageKey)) throw new Error(`${where}.storage_key: clé CAS PDF complète requise`);
  return {
    storage_key: storageKey,
    slug: requiredString(municipality.slug, `${where}.slug`),
    municipality_name: requiredString(municipality.municipality_name, `${where}.municipality_name`),
    url: requiredString(record(municipality.candidate, `${where}.candidate`).url, `${where}.candidate.url`),
    source_status: "READY",
    source_observations: 1,
  };
}

function sameScope(left: Candidate | Scan, right: Candidate | Scan): boolean {
  return left.slug === right.slug
    && left.municipality_name === right.municipality_name
    && left.url === right.url;
}

function candidatesAndScans(tracePath: string): { readonly candidates: readonly Candidate[]; readonly scans: readonly Scan[] } {
  const trace = record(readSmallJson(tracePath), relativePath(tracePath));
  if (trace.contract !== "pv-diagnostic-244-echecs-trace-list/v1") throw new Error(`${relativePath(tracePath)}: contrat invalide`);
  const candidates = new Map<string, Candidate>();
  const scans = new Map<string, Scan>();
  for (const [municipalityIndex, rawMunicipality] of array(trace.municipalities, `${relativePath(tracePath)}.municipalities`).entries()) {
    const municipality = record(rawMunicipality, `${relativePath(tracePath)}.municipalities[${municipalityIndex}]`);
    for (const [attemptIndex, rawAttempt] of array(municipality.attempts, `${relativePath(tracePath)}.municipalities[${municipalityIndex}].attempts`).entries()) {
      const attempt = record(rawAttempt, `${relativePath(tracePath)}.municipalities[${municipalityIndex}].attempts[${attemptIndex}]`);
      const where = `${relativePath(tracePath)}.municipalities[${municipalityIndex}].attempts[${attemptIndex}]`;
      const verdict = requiredString(attempt.verdict, `${where}.verdict`);
      if (verdict !== "PV_LISIBLE_PROPRIETAIRE_CONFIRME" && verdict !== "PDF_SANS_COUCHE_TEXTE") continue;
      const candidate = parseCandidate(attempt, municipality, where);
      if (verdict === "PV_LISIBLE_PROPRIETAIRE_CONFIRME") {
        const previous = candidates.get(candidate.storage_key);
        if (previous && !sameScope(previous, candidate)) throw new Error(`${where}: CAS confirmé avec scopes municipaux incompatibles`);
        candidates.set(candidate.storage_key, candidate);
      } else {
        const previous = scans.get(candidate.storage_key);
        if (previous && !sameScope(previous, candidate)) throw new Error(`${where}: scan CAS avec scopes municipaux incompatibles`);
        scans.set(candidate.storage_key, candidate);
      }
    }
  }
  return {
    candidates: [...candidates.values()].sort((left, right) => left.slug.localeCompare(right.slug) || left.storage_key.localeCompare(right.storage_key)),
    scans: [...scans.values()].sort((left, right) => left.storage_key.localeCompare(right.storage_key)),
  };
}

function addTreated(treated: Map<string, TreatedSource[]>, storageKey: string, source: string, verdict: string): void {
  if (!CAS_KEY.test(storageKey)) return;
  const sources = treated.get(storageKey) ?? [];
  if (!sources.some((entry) => entry.source === source && entry.verdict === verdict)) sources.push({ source, verdict });
  treated.set(storageKey, sources);
}

function allCoverageFiles(directory = COVERAGE): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? allCoverageFiles(path) : [path];
    })
    .sort((left, right) => left.localeCompare(right));
}

function addSnapshot(treated: Map<string, TreatedSource[]>): void {
  const snapshot = record(readSmallJson(SNAPSHOT), relativePath(SNAPSHOT));
  if (snapshot.contract !== "pv-graphify-semantic-real-universe/v1") throw new Error(`${relativePath(SNAPSHOT)}: contrat invalide`);
  const graph = record(snapshot.indexed_graph, `${relativePath(SNAPSHOT)}.indexed_graph`);
  for (const [index, key] of array(graph.storage_keys, `${relativePath(SNAPSHOT)}.indexed_graph.storage_keys`).entries()) {
    addTreated(treated, requiredString(key, `${relativePath(SNAPSHOT)}.indexed_graph.storage_keys[${index}]`), relativePath(SNAPSHOT), "INDEXED");
  }
}

function addBatchReports(treated: Map<string, TreatedSource[]>): string[] {
  const reports: string[] = [];
  for (const path of allCoverageFiles().filter((path) => REAL_BATCH_REPORT.test(path.split("/").at(-1) ?? ""))) {
    const report = record(readSmallJson(path), relativePath(path));
    if (report.contract !== "pv-graphify-semantic-control/v1") continue;
    reports.push(relativePath(path));
    for (const [index, rawDocument] of array(report.documents, `${relativePath(path)}.documents`).entries()) {
      const document = record(rawDocument, `${relativePath(path)}.documents[${index}]`);
      addTreated(
        treated,
        requiredString(document.storage_key, `${relativePath(path)}.documents[${index}].storage_key`),
        relativePath(path),
        requiredString(document.outcome, `${relativePath(path)}.documents[${index}].outcome`),
      );
    }
  }
  return reports;
}

function addTerritorialRows(treated: Map<string, TreatedSource[]>, path: string, field: "verdicts" | "document_verdicts"): void {
  const report = record(readSmallJson(path), relativePath(path));
  const expected = field === "verdicts" ? "pv-territorial-campaign-verdicts/v1" : "pv-territorial-campaign-conversion/v1";
  if (report.contract !== expected) throw new Error(`${relativePath(path)}: contrat invalide`);
  for (const [index, rawDocument] of array(report[field], `${relativePath(path)}.${field}`).entries()) {
    const document = record(rawDocument, `${relativePath(path)}.${field}[${index}]`);
    addTreated(
      treated,
      requiredString(document.storage_key, `${relativePath(path)}.${field}[${index}].storage_key`),
      relativePath(path),
      requiredString(document.verdict, `${relativePath(path)}.${field}[${index}].verdict`),
    );
  }
}

function option(name: string): string {
  const values = process.argv.slice(2)
    .filter((argument) => argument.startsWith(`--${name}=`))
    .map((argument) => argument.slice(name.length + 3));
  if (values.length !== 1 || !values[0]) throw new Error(`--${name}=... est requis une seule fois`);
  return values[0];
}

function outputPath(): string {
  const path = resolve(ROOT, option("out"));
  if (!path.startsWith(`${COVERAGE}/`)) throw new Error("--out doit rester sous work/coverage");
  if (existsSync(path)) throw new Error(`refus d'écraser l'artefact: ${relativePath(path)}`);
  return path;
}

function writeImmutableJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function main(): void {
  const output = outputPath();
  const tracePath = readTracePath();
  const { candidates, scans } = candidatesAndScans(tracePath);
  const treated = new Map<string, TreatedSource[]>();
  addSnapshot(treated);
  const batchReports = addBatchReports(treated);
  addTerritorialRows(treated, TERRITORIAL_VERDICTS, "verdicts");
  addTerritorialRows(treated, TERRITORIAL_CONVERSION, "document_verdicts");
  const collisions = candidates
    .filter((candidate) => treated.has(candidate.storage_key))
    .map((candidate) => ({ storage_key: candidate.storage_key, slug: candidate.slug, sources: treated.get(candidate.storage_key)! }));
  const documents = candidates.filter((candidate) => !treated.has(candidate.storage_key));
  const report = {
    contract: "pv-graphify-semantic-unverdict-list/v1",
    generated_at: new Date().toISOString(),
    purpose: "Réindexation des PV lisibles confirmés du diagnostic 244; une clé déjà munie d'un verdict Graphify ou territorial est exclue avant toute lecture S3.",
    diagnostic: {
      summary: relativePath(DIAGNOSTIC),
      complete_trace: relativePath(tracePath),
      confirmed_pv_unique_cas: candidates.length,
      scans_without_text_layer_unique_cas: scans.length,
    },
    deduplication: {
      snapshot: relativePath(SNAPSHOT),
      batch_report_pattern: "work/coverage/**/pv-graphify-semantic-real-universe-*-batch-*.json",
      batch_reports_consulted: batchReports,
      territorial_reports_consulted: [relativePath(TERRITORIAL_VERDICTS), relativePath(TERRITORIAL_CONVERSION)],
      treated_cas_keys: treated.size,
      collisions_avoided: collisions.length,
      collisions,
      selected_for_recheck: documents.length,
    },
    scans_without_text_layer: scans,
    documents,
  };
  writeImmutableJson(output, report);
  process.stdout.write(`${JSON.stringify({ report: relativePath(output), confirmed_pv_unique_cas: candidates.length, scans_without_text_layer_unique_cas: scans.length, collisions_avoided: collisions.length, selected_for_recheck: documents.length })}\n`);
}

main();
