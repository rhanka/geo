/**
 * Rapport consolidé et fermé de survie des URL candidates de preuve zonage.
 *
 * Les réponses HTTP 200 sont classifiées exclusivement depuis le rapport qui
 * a ouvert les octets S3. Les statuts non-200 viennent de la ligne de manifeste
 * elle-même; un 404 reste un résultat, jamais une relance.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCaptureWorklist,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import {
  buildProofUrlSurvivalReport,
  observationFromProbe,
  type ProbeForSurvival,
  type SurvivalObservation,
  type SurvivalReport,
} from "./lib/served-zonage-proof-url-survival.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface ClassificationLine {
  manifest_key: string;
  line_index: number;
  classification: "GEOMETRIE" | "PAGE HTML" | "AUTRE";
  detail: string;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function options(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv.slice(2)
    .filter((arg) => arg.startsWith(prefix))
    .map((arg) => arg.slice(prefix.length));
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function classificationIdentity(manifestKey: string, lineIndex: number): string {
  return `${manifestKey}\u0000${lineIndex}`;
}

function readClassifications(path: string): Map<string, ClassificationLine> {
  const report = JSON.parse(readFileSync(path, "utf8")) as {
    contract?: unknown;
    complete?: unknown;
    lines?: unknown;
  };
  if (report.contract !== "capture-octets-classification/v1" || report.complete !== true || !Array.isArray(report.lines)) {
    throw new Error(`classification report incomplete or incompatible: ${relative(ROOT, path)}`);
  }
  const lines = new Map<string, ClassificationLine>();
  for (const value of report.lines) {
    if (value === null || typeof value !== "object") throw new Error(`invalid classification line: ${relative(ROOT, path)}`);
    const line = value as Partial<ClassificationLine>;
    if (
      typeof line.manifest_key !== "string" ||
      typeof line.line_index !== "number" ||
      !Number.isInteger(line.line_index) ||
      (line.classification !== "GEOMETRIE" && line.classification !== "PAGE HTML" && line.classification !== "AUTRE") ||
      typeof line.detail !== "string"
    ) throw new Error(`invalid classification line: ${relative(ROOT, path)}`);
    lines.set(classificationIdentity(line.manifest_key, line.line_index), line as ClassificationLine);
  }
  return lines;
}

function readProbeObservations(paths: readonly string[]): SurvivalObservation[] {
  return paths.flatMap((path) => {
    const report = JSON.parse(readFileSync(path, "utf8")) as { contract?: unknown; probes?: unknown };
    if (report.contract !== "arcgis-geometry-worklist-probes/v1" || !Array.isArray(report.probes)) {
      throw new Error(`probe report incompatible: ${relative(ROOT, path)}`);
    }
    return report.probes.map((value, index) => {
      if (value === null || typeof value !== "object") throw new Error(`invalid probe: ${relative(ROOT, path)}:${index}`);
      const probe = value as Partial<ProbeForSurvival>;
      if (
        typeof probe.endpoint !== "string" ||
        (typeof probe.selected_url !== "string" && probe.selected_url !== null) ||
        !Array.isArray(probe.attempts)
      ) throw new Error(`invalid probe: ${relative(ROOT, path)}:${index}`);
      return observationFromProbe(probe as ProbeForSurvival, basename(path), `${relative(ROOT, path)}:${index}`);
    });
  });
}

function observationFromManifestLine(
  line: CaptureManifestLine,
  manifestKey: string,
  lineIndex: number,
  lot: string,
  classifications: ReadonlyMap<string, ClassificationLine>,
): SurvivalObservation {
  const evidence = `${manifestKey}:${lineIndex}`;
  if (line.http_status === 404) {
    return {
      candidate_url: line.url,
      served_url: line.final_url ?? line.url,
      classification: "404",
      detail: "http-404",
      lot,
      evidence,
    };
  }
  if (line.http_status !== 200) {
    return {
      candidate_url: line.url,
      served_url: line.final_url ?? line.url,
      classification: "AUTRE",
      detail: line.http_status === null ? `transport:${line.error ?? "unknown"}` : `http-${line.http_status}`,
      lot,
      evidence,
    };
  }
  const classified = classifications.get(classificationIdentity(manifestKey, lineIndex));
  if (classified === undefined) throw new Error(`HTTP 200 manifest line lacks opened-octet classification: ${evidence}`);
  return {
    candidate_url: line.url,
    served_url: line.final_url ?? line.url,
    classification: classified.classification,
    detail: classified.detail,
    lot,
    evidence,
  };
}

async function readRunObservations(
  runStamps: readonly string[],
  classifications: ReadonlyMap<string, ClassificationLine>,
): Promise<SurvivalObservation[]> {
  const observations: SurvivalObservation[] = [];
  const s3 = s3Client();
  for (const runStamp of runStamps) {
    if (!/^\d{8}T\d{6}Z$/.test(runStamp)) throw new Error(`invalid --run-stamp: ${runStamp}`);
    const prefix = `capture/_runs/zones-${runStamp}-`;
    const manifests = (await listObjectEntries(s3, prefix))
      .map((entry) => entry.key)
      .filter((key) => key.endsWith("/manifest.jsonl"))
      .sort();
    if (manifests.length === 0) throw new Error(`no capture manifest for run stamp ${runStamp}`);
    for (const manifestKey of manifests) {
      const lines = parseManifestJsonl((await getBytes(s3, manifestKey)).toString("utf8"));
      for (const [lineIndex, line] of lines.entries()) {
        if (line.source !== "zones-v1-proof-url") continue;
        observations.push(observationFromManifestLine(line, manifestKey, lineIndex, runStamp, classifications));
      }
    }
  }
  return observations;
}

function markdown(report: SurvivalReport, jsonPath: string): string {
  const rate = (report.survival_rate * 100).toFixed(2);
  return [
    "# Survie consolidée des URL candidates de preuve zonage",
    "",
    `Rapport: \`${relative(ROOT, jsonPath)}\``,
    "",
    `Candidates: ${report.candidates.targets} collections, ${report.candidates.unique_urls} URL uniques.`,
    `Partition fermée: ${report.partition.GEOMETRIE} géométrie / ${report.partition["PAGE HTML"]} HTML / ${report.partition["404"]} 404 / ${report.partition.AUTRE} autre = ${report.partition.total}.`,
    `Taux de survie consolidé: ${report.partition.GEOMETRIE}/${report.partition.total} = ${rate} %.`,
    `Doublons de mesure ignorés: ${report.measurements.duplicate_observations}; manquants: ${report.measurements.missing}.`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const candidateInput = option("candidates");
  const classificationInput = option("classification");
  const output = option("out");
  if (!candidateInput || !classificationInput || !output) {
    throw new Error("--candidates, --classification and --out are required");
  }
  const candidatePath = insideRepo(candidateInput, "candidates");
  const classificationPath = insideRepo(classificationInput, "classification");
  const outPath = insideRepo(output, "out");
  const markdownPath = outPath.endsWith(".json") ? `${outPath.slice(0, -5)}.md` : `${outPath}.md`;
  if (existsSync(outPath) || existsSync(markdownPath)) throw new Error(`refusing to overwrite survival report: ${output}`);
  const candidates = parseCaptureWorklist(JSON.parse(readFileSync(candidatePath, "utf8")));
  const classifications = readClassifications(classificationPath);
  const probePaths = options("probe").map((path) => insideRepo(path, "probe"));
  const observations = [
    ...readProbeObservations(probePaths),
    ...await readRunObservations(options("run-stamp"), classifications),
  ];
  const report = buildProofUrlSurvivalReport(candidates, observations);
  if (!report.complete) throw new Error(`survival partition is not closed: ${report.measurements.missing} candidate(s) missing`);
  writeFileSync(outPath, `${JSON.stringify({ ...report, generated_at: new Date().toISOString() }, null, 2)}\n`, { flag: "wx" });
  writeFileSync(markdownPath, markdown(report, outPath), { flag: "wx" });
  console.log(JSON.stringify({
    report: relative(ROOT, outPath),
    candidates: report.candidates,
    partition: report.partition,
    survival_rate: report.survival_rate,
    duplicate_observations: report.measurements.duplicate_observations,
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
