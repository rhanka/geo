/**
 * Recompte une campagne PV depuis les manifests S3 et des rapports de
 * classification explicitement nommés. Lecture seule: aucun GET externe, aucun
 * PUT S3 et aucune réexécution de capture.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/pv-capture-campaign-audit.ts \
 *     --campaign=pv-probable-... \
 *     --classification=work/coverage/pv-capture-octets-classification-...json
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { CaptureRunHeaderSchema, parseCaptureWorklist, parseManifestJsonl } from "../../packages/qc-sources/src/capture/index.js";
import {
  assertBacklogManifest,
  assertBacklogState,
  canonicalCaptureUrl,
  campaignManifestKey,
  campaignStateKey,
  type PvCaptureBacklogManifest,
  type PvCaptureBacklogState,
} from "./lib/pv-capture-backlog.js";
import { getBytes, listObjectEntries, objectHead, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MAX_LOCAL_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_S3_MANIFEST_BYTES = 5 * 1024 * 1024;

interface ClassificationLine {
  url: unknown;
  storage_key: unknown;
}

interface ClassificationReport {
  contract: unknown;
  complete: unknown;
  scope: { bucket?: unknown; lane?: unknown; source?: unknown; run_prefix?: unknown } | null;
  lines: unknown;
}

interface Observation {
  url: string;
  storage_key: string | null;
  origin: string;
}

interface ClassificationEvidence {
  path: string;
  manifest_key: string;
  observations: Observation[];
  confirmed_storage_keys: string[];
}

interface RunEvidence {
  manifest_key: string;
  observations: Observation[];
  finished_at: string | null;
  exit_code: number | null;
}

const CONFIRMED_CLASSIFICATION = "PV_LISIBLE_PROPRIETAIRE_CONFIRME";

function required(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`--${name}=... est requis`);
  return value;
}

function values(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv.slice(2).flatMap((argument) => argument.startsWith(prefix) ? [argument.slice(prefix.length)] : []);
}

function optional(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  return value && value.trim() ? value : null;
}

function insideRepo(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`rapport hors dépôt refusé: ${path}`);
  return absolute;
}

function parseClassificationReport(path: string): ClassificationEvidence {
  const absolute = insideRepo(path);
  const size = statSync(absolute).size;
  if (size > MAX_LOCAL_REPORT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture ${MAX_LOCAL_REPORT_BYTES}`);
  const parsed = JSON.parse(readFileSync(absolute, "utf8")) as ClassificationReport;
  if (parsed.contract !== "pv-capture-octets-classification/v1") throw new Error(`${path}: contrat de classification PV invalide`);
  if (parsed.complete !== true) throw new Error(`${path}: classification incomplète refusée`);
  if (parsed.scope?.bucket !== "sentropic-geo" || parsed.scope.lane !== "pv" || parsed.scope.source !== "pv-index") {
    throw new Error(`${path}: scope PV invalide`);
  }
  if (typeof parsed.scope.run_prefix !== "string" || !/^capture\/_runs\/[^/]+$/.test(parsed.scope.run_prefix)) {
    throw new Error(`${path}: préfixe de run invalide`);
  }
  if (!Array.isArray(parsed.lines)) throw new Error(`${path}: lines invalide`);
  const confirmedStorageKeys = new Set<string>();
  const observations = parsed.lines.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`${path}: lines[${index}] invalide`);
    const line = raw as ClassificationLine;
    if (typeof line.url !== "string") throw new Error(`${path}: lines[${index}].url invalide`);
    if (line.storage_key !== null && typeof line.storage_key !== "string") throw new Error(`${path}: lines[${index}].storage_key invalide`);
    if ((raw as { classification?: unknown }).classification === CONFIRMED_CLASSIFICATION && typeof line.storage_key === "string") {
      confirmedStorageKeys.add(line.storage_key);
    }
    return { url: canonicalCaptureUrl(line.url), storage_key: line.storage_key, origin: path };
  });
  return {
    path,
    manifest_key: `${parsed.scope.run_prefix}/manifest.jsonl`,
    observations,
    confirmed_storage_keys: [...confirmedStorageKeys],
  };
}

function parseCandidateWorklist(path: string): { path: string; urls: Set<string> } {
  const absolute = insideRepo(path);
  const size = statSync(absolute).size;
  if (size > MAX_LOCAL_REPORT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture ${MAX_LOCAL_REPORT_BYTES}`);
  const targets = parseCaptureWorklist(JSON.parse(readFileSync(absolute, "utf8")));
  return {
    path,
    urls: new Set(targets.flatMap((target) => target.urls.map(canonicalCaptureUrl))),
  };
}

async function submittedWorklistUrls(
  s3: ReturnType<typeof s3Client>,
  manifest: PvCaptureBacklogManifest,
  state: PvCaptureBacklogState,
): Promise<{ lotCount: number; urls: Set<string> }> {
  const stateByLot = new Map(state.lots.map((lot) => [lot.lot, lot]));
  const keys = manifest.lots.flatMap((lot) => {
    const stateLot = stateByLot.get(lot.lot);
    // planned is included deliberately: a crash after the state CAS and before
    // its submitted marker must not reopen a worklist already handed to a Job.
    if (!stateLot || stateLot.status === "pending") return [];
    return [stateLot.effective_worklist_key ?? lot.worklist_key];
  });
  const urls = new Set<string>();
  for (const key of new Set(keys)) {
    const head = await objectHead(s3, key);
    if (!head.exists || head.contentLength === undefined) throw new Error(`worklist soumise absente ou sans taille: ${key}`);
    if (head.contentLength > MAX_S3_MANIFEST_BYTES) throw new Error(`${key}: ${head.contentLength} octets > plafond de lecture ${MAX_S3_MANIFEST_BYTES}`);
    const targets = parseCaptureWorklist(JSON.parse((await getBytes(s3, key)).toString("utf8")));
    for (const target of targets) for (const url of target.urls) urls.add(canonicalCaptureUrl(url));
  }
  return { lotCount: keys.length, urls };
}

async function readS3Manifest(s3: ReturnType<typeof s3Client>, key: string): Promise<RunEvidence> {
  const head = await objectHead(s3, key);
  if (!head.exists) throw new Error(`manifeste S3 absent: ${key}`);
  if (head.contentLength === undefined) throw new Error(`manifeste S3 sans taille: ${key}`);
  if (head.contentLength > MAX_S3_MANIFEST_BYTES) throw new Error(`${key}: ${head.contentLength} octets > plafond de lecture ${MAX_S3_MANIFEST_BYTES}`);
  const headerKey = `${key.slice(0, -"manifest.jsonl".length)}run.json`;
  const headerHead = await objectHead(s3, headerKey);
  if (!headerHead.exists || headerHead.contentLength === undefined) throw new Error(`en-tête de run absent ou sans taille: ${headerKey}`);
  if (headerHead.contentLength > MAX_S3_MANIFEST_BYTES) throw new Error(`${headerKey}: ${headerHead.contentLength} octets > plafond de lecture ${MAX_S3_MANIFEST_BYTES}`);
  const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, headerKey)).toString("utf8")));
  const runId = key.match(/^capture\/_runs\/([^/]+)\/manifest\.jsonl$/)?.[1];
  if (!runId || header.run_id !== runId || header.lane !== "pv") {
    throw new Error(`provenance run PV invalide: ${key}`);
  }
  const observations = parseManifestJsonl((await getBytes(s3, key)).toString("utf8"))
    .flatMap((line) => line.source === "pv-index" ? [{
      url: canonicalCaptureUrl(line.url),
      storage_key: line.storage_key,
      origin: key,
    }] : []);
  return { manifest_key: key, observations, finished_at: header.finished_at, exit_code: header.exit_code };
}

/** La migration peut avoir déplacé un manifeste de run cité par un rapport local. */
async function readOptionalS3Manifest(s3: ReturnType<typeof s3Client>, key: string): Promise<RunEvidence | null> {
  const head = await objectHead(s3, key);
  return head.exists ? readS3Manifest(s3, key) : null;
}

async function campaignObservations(
  s3: ReturnType<typeof s3Client>,
  manifest: PvCaptureBacklogManifest,
): Promise<RunEvidence[]> {
  const entries = await listObjectEntries(s3, `capture/_runs/pv-geo-capture-pv-${manifest.id}-`);
  const manifests = entries
    .map((entry) => entry.key)
    .filter((key) => key.endsWith("/manifest.jsonl"))
    .sort();
  return Promise.all(manifests.map(async (key): Promise<RunEvidence> => {
    const headerKey = `${key.slice(0, -"manifest.jsonl".length)}run.json`;
    const headerHead = await objectHead(s3, headerKey);
    // A pod can flush manifest lines before it dies or before its final
    // run.json upload. Those bytes are useful diagnostics, but they are not a
    // terminal capture receipt and must not enter the CAS aggregate.
    if (!headerHead.exists) return { manifest_key: key, observations: [], finished_at: null, exit_code: null };
    return readS3Manifest(s3, key);
  }));
}

function signature(observation: Observation): string {
  return `${observation.url}\u0000${observation.storage_key ?? "<null>"}`;
}

function assertSameObservations(report: ClassificationEvidence, source: RunEvidence): void {
  const counts = new Map<string, number>();
  for (const observation of report.observations) {
    const value = signature(observation);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  for (const observation of source.observations) {
    const value = signature(observation);
    const remaining = counts.get(value) ?? 0;
    if (remaining === 0) throw new Error(`${report.path}: ligne absente ou divergente de ${source.manifest_key}`);
    counts.set(value, remaining - 1);
  }
  if ([...counts.values()].some((count) => count !== 0)) {
    throw new Error(`${report.path}: lignes supplémentaires par rapport à ${source.manifest_key}`);
  }
}

async function main(): Promise<void> {
  const campaign = required("campaign");
  const classificationPaths = values("classification");
  const candidateWorklistPath = optional("candidate-worklist");
  const worklistIntersectionOnly = process.argv.slice(2).includes("--worklist-intersection-only");
  const s3 = s3Client();
  const manifest = JSON.parse((await getBytes(s3, campaignManifestKey(campaign))).toString("utf8")) as PvCaptureBacklogManifest;
  const state = JSON.parse((await getBytes(s3, campaignStateKey(campaign))).toString("utf8")) as PvCaptureBacklogState;
  if (manifest.id !== campaign || state.campaign_id !== campaign) throw new Error("manifeste ou état rattaché à une autre campagne");
  assertBacklogManifest(manifest);
  assertBacklogState(state, manifest);
  if (worklistIntersectionOnly) {
    if (classificationPaths.length > 0) throw new Error("--worklist-intersection-only ne prend pas de rapport de classification");
    if (candidateWorklistPath === null) throw new Error("--worklist-intersection-only requiert --candidate-worklist=...");
    const candidate = parseCandidateWorklist(candidateWorklistPath);
    const submitted = await submittedWorklistUrls(s3, manifest, state);
    const intersections = [...candidate.urls].filter((url) => submitted.urls.has(url)).sort();
    if (intersections.length > 0) {
      throw new Error(`${candidate.path}: ${intersections.length} URL(s) intersectent les worklists soumises de ${campaign}`);
    }
    process.stdout.write(`${JSON.stringify({
      contract: "pv-capture-worklist-intersection/v1",
      campaign,
      candidate: {
        worklist: candidate.path,
        unique_urls: candidate.urls.size,
        submitted_or_planned_lots: submitted.lotCount,
        unique_submitted_or_planned_urls: submitted.urls.size,
        url_intersection_with_submitted: intersections.length,
      },
    }, null, 2)}\n`);
    return;
  }
  const reports = classificationPaths.map(parseClassificationReport);
  const confirmedClassificationCasKeys = new Set(
    reports.flatMap((report) => report.confirmed_storage_keys),
  );
  const campaignRuns = await campaignObservations(s3, manifest);
  const sourceRuns = new Map<string, RunEvidence>();
  const missingClassificationSourceManifests: string[] = [];
  for (const report of reports) {
    const source = await readOptionalS3Manifest(s3, report.manifest_key);
    if (source === null) {
      missingClassificationSourceManifests.push(report.manifest_key);
      continue;
    }
    assertSameObservations(report, source);
    sourceRuns.set(source.manifest_key, source);
  }
  const allRuns = new Map<string, RunEvidence>();
  for (const run of [...campaignRuns, ...sourceRuns.values()]) allRuns.set(run.manifest_key, run);
  const verifiedCasKeys = new Set(
    [...allRuns.values()]
      .flatMap((run) => run.observations)
      .flatMap((observation) => observation.storage_key === null ? [] : [observation.storage_key]),
  );
  const missingClassificationCasKeys = new Set(
    reports
      .filter((report) => !sourceRuns.has(report.manifest_key))
      .flatMap((report) => report.observations)
      .flatMap((observation) => observation.storage_key === null ? [] : [observation.storage_key])
      .filter((storageKey) => !verifiedCasKeys.has(storageKey)),
  );
  if (missingClassificationCasKeys.size > 0) {
    throw new Error(`rapports dont le manifeste a migré: ${missingClassificationCasKeys.size} clés CAS non prouvées`);
  }
  // Les rapports complets sont la preuve historique lorsque la migration a
  // déplacé leur manifeste de run; ils sont comparés au manifeste S3 dès qu'il
  // existe. Ils ne sont jamais ajoutés avec leur source S3 (même observation).
  const observations = [
    ...campaignRuns.flatMap((run) => run.observations),
    ...reports.flatMap((report) => report.observations),
  ];
  const observedUrls = new Set(observations.map((observation) => observation.url));
  const candidate = candidateWorklistPath === null ? null : parseCandidateWorklist(candidateWorklistPath);
  const submitted = candidate === null ? null : await submittedWorklistUrls(s3, manifest, state);
  const previousUrls = new Set([
    ...observedUrls,
    ...(submitted === null ? [] : submitted.urls),
  ]);
  const candidateIntersections = candidate === null
    ? []
    : [...candidate.urls].filter((url) => previousUrls.has(url)).sort();
  if (candidate !== null && candidateIntersections.length > 0) {
    throw new Error(`${candidate.path}: ${candidateIntersections.length} URL(s) intersectent des lots déjà soumis de ${campaign}`);
  }
  const durableObservations = observations.filter((observation) => observation.storage_key !== null);
  const durableUrls = new Set(durableObservations.map((observation) => observation.url));
  const casKeys = new Set(durableObservations.map((observation) => observation.storage_key!));
  const stateCounts = state.lots.reduce<Record<string, number>>((counts, lot) => {
    counts[lot.status] = (counts[lot.status] ?? 0) + 1;
    return counts;
  }, {});
  process.stdout.write(`${JSON.stringify({
    contract: "pv-capture-campaign-audit/v1",
    campaign,
    state: {
      key: campaignStateKey(campaign),
      updated_at: state.updated_at,
      phase: state.phase,
      counts: stateCounts,
    },
    evidence: {
      campaign_manifest_count: campaignRuns.length,
      campaign_observations: campaignRuns.flatMap((run) => run.observations).length,
      classification_reports: classificationPaths,
      classification_report_count: reports.length,
      classification_observations: reports.flatMap((report) => report.observations).length,
      classification_source_manifest_count: sourceRuns.size,
      classification_source_manifest_absent: missingClassificationSourceManifests,
      classification_source_manifest_absent_new_cas_keys: missingClassificationCasKeys.size,
      unique_confirmed_classification_cas_keys: confirmedClassificationCasKeys.size,
      all_source_manifest_count: allRuns.size,
      observations: observations.length,
      unique_observed_document_urls: observedUrls.size,
      duplicate_observations: observations.length - observedUrls.size,
      durable_observations: durableObservations.length,
      unique_durably_captured_document_urls: durableUrls.size,
      duplicate_durable_observations: durableObservations.length - durableUrls.size,
      unique_cas_keys: casKeys.size,
      nonterminal_source_runs: [...allRuns.values()].filter((run) => run.finished_at === null || run.exit_code === null).length,
      nonzero_exit_source_runs: [...allRuns.values()].filter((run) => run.exit_code !== null && run.exit_code !== 0).length,
    },
    candidate: candidate === null ? null : {
      worklist: candidate.path,
      unique_urls: candidate.urls.size,
      submitted_or_observed_urls: previousUrls.size,
      submitted_or_planned_lots: submitted!.lotCount,
      url_intersection_with_submitted: candidateIntersections.length,
    },
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
