/**
 * Read-only liveness sweep for the committed v1 zonage proof-URL deposits.
 * Response bytes are examined only in memory to distinguish GeoJSON from a
 * portal or error document; no response body is persisted.
 *
 * Usage:
 *   npx tsx acquisition/src/zones-v1-proof-url-liveness-sweep.ts
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROWSER_USER_AGENT,
  CONCURRENCY,
  LIVENESS_CLASSES,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  livenessCounts,
  mapConcurrent,
  probeProofUrl,
  type Candidate,
  type LivenessClass,
  type Observation,
} from "./zones-served-proof-url-liveness-sweep.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_PATTERN = "work/coverage/zonage-proof-url-candidates-*.json";
const SOURCE_TYPE = "zones-v1-proof-url";
const REPORT_CONTRACT = "zones-v1-proof-url-liveness/v1";
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

interface SourceFile {
  readonly path: string;
  readonly exists: boolean;
  readonly records: number | null;
  readonly http_urls: number | null;
  readonly ignored_non_http_urls: number | null;
}

interface SourceRead {
  readonly files: readonly SourceFile[];
  readonly candidates: readonly Candidate[];
}

interface SlugObservation {
  readonly slug: string;
  readonly urls: number;
  readonly classification: LivenessClass;
  readonly proof_status: "preuve-vivante" | "preuve-morte";
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

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https?:\/\//iu.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function committedSourcePaths(): string[] {
  const output = execFileSync("git", ["-C", ROOT, "ls-files", "--", SOURCE_PATTERN], { encoding: "utf8" });
  return output.split("\n").filter((path) => path.length > 0).sort((left, right) => left.localeCompare(right));
}

function readSources(): SourceRead {
  const candidates = new Map<string, Candidate>();
  const files: SourceFile[] = [];

  for (const sourcePath of committedSourcePaths()) {
    const path = absolutePath(sourcePath);
    if (!existsSync(path)) {
      files.push({ path: sourcePath, exists: false, records: null, http_urls: null, ignored_non_http_urls: null });
      continue;
    }

    const size = statSync(path).size;
    if (size > MAX_SOURCE_BYTES) throw new Error(`${sourcePath}: ${size} octets > plafond de ${MAX_SOURCE_BYTES}`);
    const rawRows = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(rawRows)) throw new Error(`${sourcePath}: tableau requis`);

    let httpUrls = 0;
    let ignoredNonHttpUrls = 0;
    for (const [rowIndex, rawRow] of rawRows.entries()) {
      const row = record(rawRow, `${sourcePath}[${rowIndex}]`);
      const slug = requiredString(row.slug, `${sourcePath}[${rowIndex}].slug`);
      if (row.source !== SOURCE_TYPE) throw new Error(`${sourcePath}[${rowIndex}].source: ${SOURCE_TYPE} requis`);
      if (!Array.isArray(row.urls)) throw new Error(`${sourcePath}[${rowIndex}].urls: tableau requis`);
      for (const [urlIndex, rawUrl] of row.urls.entries()) {
        const url = httpUrl(rawUrl);
        if (url === null) {
          ignoredNonHttpUrls += 1;
          continue;
        }
        httpUrls += 1;
        candidates.set(JSON.stringify([slug, url]), { slug, url });
      }
    }
    files.push({
      path: sourcePath,
      exists: true,
      records: rawRows.length,
      http_urls: httpUrls,
      ignored_non_http_urls: ignoredNonHttpUrls,
    });
  }

  return {
    files,
    candidates: [...candidates.values()].sort((left, right) => left.slug.localeCompare(right.slug) || left.url.localeCompare(right.url)),
  };
}

function slugObservations(observations: readonly Observation[]): SlugObservation[] {
  const vitality: Record<LivenessClass, number> = { LIVE: 4, AMBIGU: 3, UNKNOWN: 2, DEAD: 1 };
  const bySlug = new Map<string, { urls: number; classification: LivenessClass }>();

  for (const observation of observations) {
    const existing = bySlug.get(observation.slug);
    if (existing === undefined) {
      bySlug.set(observation.slug, { urls: 1, classification: observation.classification });
      continue;
    }
    existing.urls += 1;
    if (vitality[observation.classification] > vitality[existing.classification]) {
      existing.classification = observation.classification;
    }
  }

  return [...bySlug.entries()]
    .map(([slug, aggregate]) => ({
      slug,
      urls: aggregate.urls,
      classification: aggregate.classification,
      proof_status: aggregate.classification === "LIVE" ? "preuve-vivante" as const : "preuve-morte" as const,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

function validatePartition(axis: string, partition: Record<LivenessClass, number>, expectedTotal: number): Record<string, unknown> {
  const total = LIVENESS_CLASSES.reduce((sum, classification) => sum + partition[classification], 0);
  if (total !== expectedTotal) {
    throw new Error(`${axis}: partition invalide: ${total} classifications pour ${expectedTotal} entrées`);
  }
  return {
    total,
    expected_total: expectedTotal,
    closed_partition: true,
  };
}

function markdown(report: Record<string, unknown>): string {
  const source = record(report.source, "report.source");
  const universe = record(report.universe, "report.universe");
  const partition = record(report.partition, "report.partition");
  const perCouple = record(partition.per_couple, "report.partition.per_couple");
  const perSlug = record(partition.per_slug, "report.partition.per_slug");
  const proof = record(report.proof_status, "report.proof_status");
  const files = source.files as readonly SourceFile[];
  const missing = files.filter((file) => !file.exists).map((file) => file.path);

  return [
    "# Liveness des URL de preuve zonage v1",
    "",
    "Sonde HTTP(S) en lecture seule avec UA navigateur; les corps ne sont examinés qu’en mémoire et ne sont pas persistés.",
    "",
    `Sources Git : ${files.length} fichier(s) correspondant à \`${SOURCE_PATTERN}\`; manquants : ${missing.length === 0 ? "aucun" : missing.join(", ")}.`,
    `Couples \`(slug, url)\` : **${universe.couples}**; slugs distincts : **${universe.slugs}**.`,
    `Par couple : LIVE=${perCouple.LIVE}, DEAD=${perCouple.DEAD}, AMBIGU=${perCouple.AMBIGU}, UNKNOWN=${perCouple.UNKNOWN}.`,
    `Par slug : LIVE=${perSlug.LIVE}, DEAD=${perSlug.DEAD}, AMBIGU=${perSlug.AMBIGU}, UNKNOWN=${perSlug.UNKNOWN}.`,
    `Preuve : vivante=${proof.preuve_vivante}, morte=${proof.preuve_morte}.`,
    "",
    `Recalcul : \`npx tsx acquisition/src/zones-v1-proof-url-liveness-sweep.ts\`.`,
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
  const output = absolutePath(`work/coverage/zones-v1-proof-url-liveness-${stamp}.json`);
  const markdownOutput = absolutePath(`work/coverage/zones-v1-proof-url-liveness-${stamp}.md`);
  if (existsSync(output) || existsSync(markdownOutput)) throw new Error(`refus d'écraser l'artefact pour ${stamp}`);

  const source = readSources();
  const observations = await mapConcurrent(source.candidates, probeProofUrl);
  const perCouple = livenessCounts(observations);
  const slugs = slugObservations(observations);
  const perSlug = livenessCounts(slugs);
  const proofVivante = slugs.filter((slug) => slug.proof_status === "preuve-vivante").length;
  const proofMorte = slugs.length - proofVivante;

  const validation = {
    classes: LIVENESS_CLASSES,
    per_couple: validatePartition("par-couple", perCouple, observations.length),
    per_slug: validatePartition("par-slug", perSlug, slugs.length),
  };

  const report: Record<string, unknown> = {
    contract: REPORT_CONTRACT,
    generated_at: startedAt.toISOString(),
    read_only_liveness_sweep: true,
    source: {
      committed_pattern: SOURCE_PATTERN,
      expected_source_type: SOURCE_TYPE,
      files: source.files,
      missing_files: source.files.filter((file) => !file.exists).map((file) => file.path),
      selection: "Union de tous les fichiers Git correspondants; chaque URL http(s) verbatim est dédupliquée par (slug, url); les URL non-HTTP(S), dont s3://, sont exclues.",
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
      slugs: slugs.length,
    },
    rows: observations,
    slug_rows: slugs,
    partition: {
      per_couple: perCouple,
      per_slug: perSlug,
    },
    proof_status: {
      preuve_vivante: proofVivante,
      preuve_morte: proofMorte,
    },
    validation,
  };

  writeArtifact(output, `${JSON.stringify(report, null, 2)}\n`);
  writeArtifact(markdownOutput, markdown(report));
  process.stdout.write(`${JSON.stringify({
    json: relativePath(output),
    markdown: relativePath(markdownOutput),
    couples: observations.length,
    slugs: slugs.length,
    per_couple: perCouple,
    per_slug: perSlug,
    proof_status: report.proof_status,
  })}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
