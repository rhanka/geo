/**
 * Materialise the trace of every currently uncovered municipality that still
 * has a PV-index candidate.  This is deliberately a local, read-only join of
 * committed worklists and capture-classification reports: it never fetches a
 * URL and never reads an S3 object.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-diagnostic-244-echecs.ts \
 *     --out=work/coverage/pv-diagnostic-244-echecs-YYYYMMDDTHHMMSSZ.json
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const CANDIDATES_PATH = "work/coverage/pv-v4-candidate-recalculation-20260730t014646z-selection.json";
const REPORTS = [
  "work/coverage/pv-capture-octets-classification-20260729t222149z-lot-0001.json",
  "work/coverage/pv-capture-octets-classification-20260729t222149z-lot-0002.json",
  "work/coverage/pv-capture-octets-classification-20260729t222149z-lot-0003.json",
  "work/coverage/pv-capture-octets-classification-20260729t222149z-lot-0004.json",
  "work/coverage/pv-capture-octets-classification-20260729t222149z-lot-0005.json",
  "work/coverage/pv-capture-octets-classification-20260729t222149z-lot-0006.json",
  "work/coverage/pv-capture-octets-classification-20260729t231834z-lot-0001.json",
  "work/coverage/pv-capture-octets-classification-20260729t231834z-lot-0002.json",
  "work/coverage/pv-capture-octets-classification-20260729t231834z-lot-0003.json",
  "work/coverage/pv-capture-octets-classification-20260729t231834z-lot-0004.json",
  "work/coverage/pv-capture-octets-classification-20260729t231834z-lot-0005.json",
  "work/coverage/pv-capture-octets-classification-20260729t231834z-lot-0006.json",
  "work/coverage/pv-capture-octets-classification-20260730t001459z-lot-0001.json",
  "work/coverage/pv-capture-octets-classification-20260730t001459z-lot-0002.json",
  "work/coverage/pv-capture-octets-classification-20260730t001459z-lot-0003.json",
  "work/coverage/pv-capture-octets-classification-20260730t001459z-lot-0004.json",
  "work/coverage/pv-capture-octets-classification-20260730t001459z-lot-0005.json",
] as const;

interface Candidate {
  readonly slug: string;
  readonly source: "pv-index";
  readonly urls: readonly [string];
}

interface ClassificationLine {
  readonly manifest_key: string;
  readonly line_index: number;
  readonly run_id: string;
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
  readonly http_status: number | null;
  readonly storage_key: string | null;
  readonly owner_verbatim: string | null;
  readonly pv_verbatim: string | null;
  readonly classification: string;
  readonly detail: string;
}

interface ClassificationReport {
  readonly contract: "pv-capture-octets-classification/v1";
  readonly scope: { readonly run_prefix: string };
  readonly lines: readonly ClassificationLine[];
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: objet requis`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}: chaîne non vide requise`);
  return value.trim();
}

function nullableString(value: unknown, where: string): string | null {
  if (value === null) return null;
  return requiredString(value, where);
}

function requiredInteger(value: unknown, where: string): number {
  if (!Number.isInteger(value)) throw new Error(`${where}: entier requis`);
  return value;
}

function nullableStatus(value: unknown, where: string): number | null {
  if (value === null) return null;
  const status = requiredInteger(value, where);
  if (status < 100 || status > 599) throw new Error(`${where}: statut HTTP invalide`);
  return status;
}

function insideRepo(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function readSmallJson(path: string): unknown {
  const absolute = insideRepo(path);
  const size = statSync(absolute).size;
  if (size > MAX_INPUT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture`);
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

function canonicalUrl(value: string, where: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${where}: URL invalide`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${where}: URL non HTTP(S)`);
  url.hash = "";
  return url.toString();
}

function parseCandidate(value: unknown, index: number): Candidate {
  const raw = record(value, `${CANDIDATES_PATH}[${index}]`);
  const slug = requiredString(raw.slug, `${CANDIDATES_PATH}[${index}].slug`);
  if (raw.source !== "pv-index") throw new Error(`${CANDIDATES_PATH}[${index}].source: pv-index requis`);
  if (!Array.isArray(raw.urls) || raw.urls.length !== 1) throw new Error(`${CANDIDATES_PATH}[${index}].urls: une URL requise`);
  const url = canonicalUrl(requiredString(raw.urls[0], `${CANDIDATES_PATH}[${index}].urls[0]`), `${CANDIDATES_PATH}[${index}].urls[0]`);
  return { slug, source: "pv-index", urls: [url] };
}

function parseLine(value: unknown, path: string, index: number): ClassificationLine {
  const raw = record(value, `${path}.lines[${index}]`);
  return {
    manifest_key: requiredString(raw.manifest_key, `${path}.lines[${index}].manifest_key`),
    line_index: requiredInteger(raw.line_index, `${path}.lines[${index}].line_index`),
    run_id: requiredString(raw.run_id, `${path}.lines[${index}].run_id`),
    slug: requiredString(raw.slug, `${path}.lines[${index}].slug`),
    municipality_name: requiredString(raw.municipality_name, `${path}.lines[${index}].municipality_name`),
    url: canonicalUrl(requiredString(raw.url, `${path}.lines[${index}].url`), `${path}.lines[${index}].url`),
    http_status: nullableStatus(raw.http_status, `${path}.lines[${index}].http_status`),
    storage_key: nullableString(raw.storage_key, `${path}.lines[${index}].storage_key`),
    owner_verbatim: nullableString(raw.owner_verbatim, `${path}.lines[${index}].owner_verbatim`),
    pv_verbatim: nullableString(raw.pv_verbatim, `${path}.lines[${index}].pv_verbatim`),
    classification: requiredString(raw.classification, `${path}.lines[${index}].classification`),
    detail: requiredString(raw.detail, `${path}.lines[${index}].detail`),
  };
}

function campaignFromRunPrefix(prefix: string, path: string): string {
  const matched = /^capture\/_runs\/pv-geo-capture-pv-(pv-territorial-\d{8}t\d{6}z)-\d{4}-$/u.exec(prefix);
  if (!matched) throw new Error(`${path}.scope.run_prefix: campagne territoriale requise`);
  return matched[1]!;
}

function requiredOut(): string {
  const value = process.argv.slice(2).find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
  if (!value) throw new Error("--out=... est requis");
  return insideRepo(value);
}

function main(): void {
  const out = requiredOut();
  const candidatesRaw = readSmallJson(CANDIDATES_PATH);
  if (!Array.isArray(candidatesRaw)) throw new Error(`${CANDIDATES_PATH}: tableau requis`);
  const candidates = candidatesRaw.map(parseCandidate);
  const duplicateCandidates = candidates.map((candidate) => candidate.urls[0]).filter((url, index, urls) => urls.indexOf(url) !== index);
  if (duplicateCandidates.length > 0) throw new Error(`${CANDIDATES_PATH}: URLs candidates dupliquées`);

  const attemptsByUrl = new Map<string, Array<ClassificationLine & { readonly campaign: string; readonly source_report: string }>>();
  for (const path of REPORTS) {
    const raw = record(readSmallJson(path), path) as unknown as ClassificationReport;
    if (raw.contract !== "pv-capture-octets-classification/v1" || !Array.isArray(raw.lines)) throw new Error(`${path}: contrat invalide`);
    const campaign = campaignFromRunPrefix(requiredString(raw.scope?.run_prefix, `${path}.scope.run_prefix`), path);
    raw.lines.forEach((value, index) => {
      const line = parseLine(value, path, index);
      const attempts = attemptsByUrl.get(line.url) ?? [];
      attempts.push({ ...line, campaign, source_report: path });
      attemptsByUrl.set(line.url, attempts);
    });
  }

  const municipalities = candidates.map((candidate) => {
    const candidateUrl = candidate.urls[0];
    const tracedAttempts = attemptsByUrl.get(candidateUrl) ?? [];
    const attempts = tracedAttempts.map((attempt) => ({
      campaign: attempt.campaign,
      url: attempt.url,
      verdict: attempt.classification,
      http_status: attempt.http_status,
      host: new URL(attempt.url).hostname,
      source_report: attempt.source_report,
      manifest_key: attempt.manifest_key,
      line_index: attempt.line_index,
      run_id: attempt.run_id,
      storage_key: attempt.storage_key,
      detail: attempt.detail,
      owner_verbatim: attempt.owner_verbatim,
      pv_verbatim: attempt.pv_verbatim,
    }));
    const municipalityName = tracedAttempts[0]?.municipality_name ?? null;
    return {
      slug: candidate.slug,
      municipality_name: municipalityName,
      candidate: { source: candidate.source, url: candidateUrl, host: new URL(candidateUrl).hostname },
      attempts,
    };
  });
  const traceCounts = {
    candidates: municipalities.length,
    candidates_with_trace: municipalities.filter((municipality) => municipality.attempts.length > 0).length,
    candidates_without_trace: municipalities.filter((municipality) => municipality.attempts.length === 0).length,
    candidates_with_one_trace: municipalities.filter((municipality) => municipality.attempts.length === 1).length,
    candidates_with_multiple_traces: municipalities.filter((municipality) => municipality.attempts.length > 1).length,
    matched_attempts: municipalities.reduce((count, municipality) => count + municipality.attempts.length, 0),
  };
  const verdictCounts = new Map<string, number>();
  for (const municipality of municipalities) {
    for (const attempt of municipality.attempts) verdictCounts.set(attempt.verdict, (verdictCounts.get(attempt.verdict) ?? 0) + 1);
  }
  const body = `${JSON.stringify({
    contract: "pv-diagnostic-244-echecs-trace-list/v1",
    generated_at: new Date().toISOString(),
    method: "Jointure locale et lecture seule des 244 candidats PV-index avec les rapports de classification des trois vagues; aucun fetch, aucune lecture S3.",
    sources: { candidates: CANDIDATES_PATH, classification_reports: REPORTS },
    trace_counts: traceCounts,
    verdict_counts: Object.fromEntries([...verdictCounts].sort(([left], [right]) => left.localeCompare(right))),
    municipalities,
  }, null, 2)}\n`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ out: out.slice(ROOT.length + 1), ...traceCounts }, null, 2)}\n`);
}

main();
