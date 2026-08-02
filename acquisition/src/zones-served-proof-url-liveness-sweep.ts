/**
 * Read-only liveness sweep for every HTTP(S) proof URL carried by the served
 * zonage/immo proof audit. Response bytes are examined only in memory to tell
 * GeoJSON from a portal or error document; they are never written to disk.
 *
 * Usage:
 *   npx tsx acquisition/src/zones-served-proof-url-liveness-sweep.ts
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_PATH = "work/coverage/served-zonage-immo-proof-url-audit-final-20260728T120900Z.json";
const SOURCE_CONTRACT = "served-zonage-immo-proof-url-audit/v1";
const REPORT_CONTRACT = "zones-served-proof-url-liveness/v1";
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 12_000;
const BROWSER_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const LIVENESS_CLASSES = ["LIVE", "DEAD", "AMBIGU", "UNKNOWN"] as const;
export type LivenessClass = (typeof LIVENESS_CLASSES)[number];

interface Candidate {
  readonly slug: string;
  readonly url: string;
}

interface Attempt {
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  readonly isGeojson: boolean;
  readonly detail: string;
  readonly dnsNotFound: boolean;
}

interface Observation {
  readonly slug: string;
  readonly url: string;
  readonly http_status: number | null;
  readonly content_type: string | null;
  readonly is_geojson: boolean;
  readonly classification: LivenessClass;
  readonly detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: objet requis`);
  return value;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where}: chaîne non vide requise`);
  return value;
}

function absolutePath(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function relativePath(path: string): string {
  return relative(ROOT, path);
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function readSource(): Record<string, unknown> {
  const path = absolutePath(SOURCE_PATH);
  if (!existsSync(path)) throw new Error(`source absente: ${SOURCE_PATH}`);
  const size = statSync(path).size;
  if (size > MAX_SOURCE_BYTES) throw new Error(`${SOURCE_PATH}: ${size} octets > plafond de ${MAX_SOURCE_BYTES}`);
  const source = record(JSON.parse(readFileSync(path, "utf8")) as unknown, SOURCE_PATH);
  if (source.contract !== SOURCE_CONTRACT) {
    throw new Error(`${SOURCE_PATH}.contract: ${SOURCE_CONTRACT} requis`);
  }
  if (!Array.isArray(source.rows)) throw new Error(`${SOURCE_PATH}.rows: tableau requis`);
  return source;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https?:\/\//iu.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function candidatesFrom(source: Record<string, unknown>): Candidate[] {
  const candidates = new Map<string, Candidate>();
  const rows = source.rows as readonly unknown[];

  for (const [rowIndex, rawRow] of rows.entries()) {
    const row = record(rawRow, `${SOURCE_PATH}.rows[${rowIndex}]`);
    const slug = requiredString(row.slug, `${SOURCE_PATH}.rows[${rowIndex}].slug`);
    for (const field of ["verifiable_https_sha256_cases", "query_cases"] as const) {
      const rawCases = row[field];
      if (rawCases === undefined) continue;
      if (!Array.isArray(rawCases)) throw new Error(`${SOURCE_PATH}.rows[${rowIndex}].${field}: tableau requis ou absent`);
      for (const [caseIndex, rawCase] of rawCases.entries()) {
        const caseRecord = record(rawCase, `${SOURCE_PATH}.rows[${rowIndex}].${field}[${caseIndex}]`);
        const url = httpUrl(caseRecord.url);
        if (url === null) continue;
        candidates.set(JSON.stringify([slug, url]), { slug, url });
      }
    }
  }

  return [...candidates.values()].sort((left, right) => left.slug.localeCompare(right.slug) || left.url.localeCompare(right.url));
}

function isGeojsonFeatureCollection(value: unknown): boolean {
  return isRecord(value) && value.type === "FeatureCollection" && Array.isArray(value.features);
}

function errorCodes(value: unknown, seen = new Set<object>()): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => errorCodes(entry, seen));
  if (!isRecord(value) || seen.has(value)) return [];
  seen.add(value);
  const code = typeof value.code === "string" ? [value.code] : [];
  return [...code, ...errorCodes(value.cause, seen), ...errorCodes(value.errors, seen)];
}

function errorDetail(error: unknown): { detail: string; dnsNotFound: boolean } {
  const codes = errorCodes(error);
  const code = codes[0] ?? null;
  return {
    detail: code === null ? "fetch failed" : `fetch failed (${code})`,
    dnsNotFound: codes.includes("ENOTFOUND"),
  };
}

async function attempt(url: string): Promise<Attempt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/geo+json, application/json;q=0.9, */*;q=0.1",
        "user-agent": BROWSER_USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const httpStatus = response.status;
    const contentType = response.headers.get("content-type");
    if (httpStatus !== 200) {
      return {
        httpStatus,
        contentType,
        isGeojson: false,
        detail: `HTTP ${httpStatus}`,
        dnsNotFound: false,
      };
    }

    try {
      // Deliberately in-memory only: no response body is logged or persisted.
      const body = await response.text();
      if (body.trim().length === 0) {
        return { httpStatus, contentType, isGeojson: false, detail: "200 response body is empty", dnsNotFound: false };
      }
      try {
        const parsed = JSON.parse(body) as unknown;
        if (isGeojsonFeatureCollection(parsed)) {
          return { httpStatus, contentType, isGeojson: true, detail: "200 GeoJSON FeatureCollection", dnsNotFound: false };
        }
        return { httpStatus, contentType, isGeojson: false, detail: "200 JSON is not a GeoJSON FeatureCollection", dnsNotFound: false };
      } catch {
        const detail = body.trimStart().startsWith("<")
          ? "200 response body is HTML, not GeoJSON"
          : "200 response body is not JSON";
        return { httpStatus, contentType, isGeojson: false, detail, dnsNotFound: false };
      }
    } catch (error) {
      const failure = errorDetail(error);
      return { httpStatus, contentType, isGeojson: false, detail: `200 body read: ${failure.detail}`, dnsNotFound: failure.dnsNotFound };
    }
  } catch (error) {
    const failure = errorDetail(error);
    return { httpStatus: null, contentType: null, isGeojson: false, detail: failure.detail, dnsNotFound: failure.dnsNotFound };
  } finally {
    clearTimeout(timeout);
  }
}

function withAttemptDetail(base: string, attempts: readonly Attempt[]): string {
  if (attempts.length === 1) return base;
  const outcomes = attempts.map((entry) => entry.httpStatus === null ? entry.detail : `HTTP ${entry.httpStatus}`).join(", ");
  return `${base}; attempts: ${outcomes}`;
}

function observationFrom(attempt: Attempt, classification: LivenessClass, detail: string): Omit<Observation, "slug" | "url"> {
  return {
    http_status: attempt.httpStatus,
    content_type: attempt.contentType,
    is_geojson: attempt.isGeojson,
    classification,
    detail,
  };
}

async function probe(candidate: Candidate): Promise<Observation> {
  const attempts: Attempt[] = [];
  for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
    const current = await attempt(candidate.url);
    attempts.push(current);

    if (current.httpStatus === 200) {
      return { slug: candidate.slug, url: candidate.url, ...observationFrom(current, current.isGeojson ? "LIVE" : "AMBIGU", current.detail) };
    }
    if (current.httpStatus === 404 || current.httpStatus === 410) {
      return { slug: candidate.slug, url: candidate.url, ...observationFrom(current, "DEAD", current.detail) };
    }
    if (current.httpStatus !== null && current.httpStatus !== 401 && current.httpStatus !== 403 && (current.httpStatus < 500 || current.httpStatus > 599)) {
      return { slug: candidate.slug, url: candidate.url, ...observationFrom(current, "AMBIGU", current.detail) };
    }
  }

  const last = attempts.at(-1);
  if (last === undefined) throw new Error("sonde sans tentative");
  const allDnsNotFound = attempts.every((entry) => entry.httpStatus === null && entry.dnsNotFound);
  if (allDnsNotFound) {
    return { slug: candidate.slug, url: candidate.url, ...observationFrom(last, "DEAD", withAttemptDetail("DNS ENOTFOUND confirmed", attempts)) };
  }
  const allServerErrors = attempts.every((entry) => entry.httpStatus !== null && entry.httpStatus >= 500 && entry.httpStatus <= 599);
  if (allServerErrors) {
    return { slug: candidate.slug, url: candidate.url, ...observationFrom(last, "DEAD", withAttemptDetail("persistent 5xx response", attempts)) };
  }
  const allAuthDenied = attempts.every((entry) => entry.httpStatus === 401 || entry.httpStatus === 403);
  if (allAuthDenied) {
    return { slug: candidate.slug, url: candidate.url, ...observationFrom(last, "AMBIGU", withAttemptDetail("persistent authentication denial", attempts)) };
  }
  const hasOpaqueNetworkFailure = attempts.some((entry) => entry.httpStatus === null || entry.detail.startsWith("200 body read: fetch failed"));
  if (hasOpaqueNetworkFailure) {
    return { slug: candidate.slug, url: candidate.url, ...observationFrom(last, "UNKNOWN", withAttemptDetail("inconclusive network failure", attempts)) };
  }
  return { slug: candidate.slug, url: candidate.url, ...observationFrom(last, "AMBIGU", withAttemptDetail("non-terminal HTTP responses", attempts)) };
}

async function mapConcurrent<T, U>(values: readonly T[], worker: (value: T) => Promise<U>): Promise<U[]> {
  const output = new Array<U>(values.length);
  let next = 0;
  const runner = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      output[index] = await worker(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, values.length) }, () => runner()));
  return output;
}

function counts(observations: readonly Observation[]): Record<LivenessClass, number> {
  const totals: Record<LivenessClass, number> = { LIVE: 0, DEAD: 0, AMBIGU: 0, UNKNOWN: 0 };
  for (const observation of observations) totals[observation.classification] += 1;
  return totals;
}

function markdown(report: Record<string, unknown>): string {
  const universe = record(report.universe, "report.universe");
  const partition = record(report.partition, "report.partition");
  return [
    "# Liveness des URL de preuve zonage servies",
    "",
    "Sonde HTTP(S) en lecture seule, avec UA navigateur; les corps ne sont examinés qu’en mémoire et ne sont pas persistés.",
    "",
    `Couples \`(slug, url)\` : **${universe.couples}**; slugs distincts : **${universe.slugs}**.`,
    `Partition : LIVE=${partition.LIVE}, DEAD=${partition.DEAD}, AMBIGU=${partition.AMBIGU}, UNKNOWN=${partition.UNKNOWN}.`,
    "",
    `Source : \`${SOURCE_PATH}\` (${SOURCE_CONTRACT}). Recalcul : \`npx tsx acquisition/src/zones-served-proof-url-liveness-sweep.ts\`.`,
    "",
  ].join("\n");
}

function writeArtifact(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { flag: "wx" });
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const stamp = utcStamp(startedAt);
  const output = absolutePath(`work/coverage/zones-served-proof-url-liveness-${stamp}.json`);
  const markdownOutput = absolutePath(`work/coverage/zones-served-proof-url-liveness-${stamp}.md`);
  if (existsSync(output) || existsSync(markdownOutput)) throw new Error(`refus d'écraser l'artefact pour ${stamp}`);

  const source = readSource();
  const candidates = candidatesFrom(source);
  const observations = await mapConcurrent(candidates, probe);
  const partition = counts(observations);
  const total = partition.LIVE + partition.DEAD + partition.AMBIGU + partition.UNKNOWN;
  if (total !== observations.length) {
    throw new Error(`partition invalide: ${total} classifications pour ${observations.length} couples`);
  }

  const report: Record<string, unknown> = {
    contract: REPORT_CONTRACT,
    generated_at: new Date().toISOString(),
    read_only_liveness_sweep: true,
    source: {
      path: SOURCE_PATH,
      contract: SOURCE_CONTRACT,
      selection: "Chaque URL http(s) verbatim de verifiable_https_sha256_cases[] et query_cases[], dédupliquée par (slug, url); s3_cases et resolved_s3_cases exclus.",
    },
    probe: {
      user_agent: BROWSER_USER_AGENT,
      max_attempts: MAX_ATTEMPTS,
      timeout_ms: REQUEST_TIMEOUT_MS,
      concurrency: CONCURRENCY,
      body_handling: "Les corps ne sont lus qu'en mémoire pour confirmer FeatureCollection + features[]; aucun octet de réponse n'est persisté.",
    },
    universe: {
      couples: observations.length,
      slugs: new Set(observations.map((observation) => observation.slug)).size,
    },
    rows: observations,
    partition,
    validation: {
      classes: LIVENESS_CLASSES,
      total,
      expected_total: observations.length,
      closed_partition: total === observations.length,
    },
  };
  writeArtifact(output, `${JSON.stringify(report, null, 2)}\n`);
  writeArtifact(markdownOutput, markdown(report));
  process.stdout.write(`${JSON.stringify({ json: relativePath(output), markdown: relativePath(markdownOutput), couples: observations.length, partition, slugs: (report.universe as Record<string, unknown>).slugs })}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
