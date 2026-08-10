/**
 * Emit the per-city column-20 artifact that makes WP5 v3.4 VISIBLE on the 167.
 *
 * One row per cohort municipality:
 *   { slug, geo_events_count, immo_gt_available, recall_pct_si_mesurable, statut }
 *
 * `recall_pct_si_mesurable` is the DIRECTIONAL recall immo→geo (the Steve metric):
 * of this city's immo DesignationEvents, the fraction geo covers with a
 * compatible-identity, crosswalked-type event. It is `null` when immo ground
 * truth is absent for the city — never an invented unknown. The closed status
 * partition is `immo-gt-pending | measured | measured-geo-empty`.
 *
 * This is a thin, honest reshape over `runRecallGate`, the single source of
 * truth for the immo→geo match. The full recall-gate report is written beside
 * the col-20 artifact as the audit trail; the list of cities still awaiting immo
 * ground truth is written as a companion `.needs-immo-gt.txt` (WP5 livrable #5).
 *
 *   npx tsx acquisition/src/zoning-events-cohort-col20.ts \
 *     --cohort docs/spec/reports/set-167-bprime.tsv \
 *     --geo-events work/coverage/qc-zoning-events-dryrun/documents.json \
 *     [--immo-events <DesignationEvent export>] \
 *     --out work/coverage/zoning-events-col20-YYYYMMDDTHHMMSSZ.json
 *
 * Without --geo-events the geo counts come from the served S3 collections
 * (prefix the run with NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10).
 * Without --immo-events every city is `immo-gt-pending` (geo emission stays
 * visible; the recall column waits on the immo handoff).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCohortFile, runRecallGate, type RecallGateReport } from "./zoning-events-recall-gate.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Closed status partition — no fourth, invented, or unknown outcome. */
export const COL20_STATUSES = ["immo-gt-pending", "measured", "measured-geo-empty"] as const;
export type Col20Status = (typeof COL20_STATUSES)[number];

export interface Col20Row {
  readonly slug: string;
  readonly geo_events_count: number;
  readonly immo_gt_available: boolean;
  /** immo DesignationEvents for the city; 0 when ground truth is absent. */
  readonly immo_gt_events: number;
  /** immo events geo covers (min-based multiset match); never exceeds immo_gt_events. */
  readonly matched: number;
  /** Directional recall immo→geo, or null when immo ground truth is absent. */
  readonly recall_pct_si_mesurable: number | null;
  readonly statut: Col20Status;
}

export interface Col20Artifact {
  readonly contract: "qc-zoning-events-col20/v1";
  readonly generated_at: string;
  readonly cohort_size: number;
  readonly cohort_source: string;
  readonly geo_events_source: "local_file" | "s3";
  readonly immo_events_source: string | null;
  readonly summary: {
    readonly measured: number;
    readonly measured_geo_empty: number;
    readonly immo_gt_pending: number;
    readonly geo_events_total: number;
    readonly cities_with_geo_events: number;
    readonly immo_gt_events_total: number;
    readonly matched_total: number;
  };
  readonly rows: readonly Col20Row[];
}

export interface RunCol20Options {
  readonly cohort: readonly string[];
  readonly cohortSource: string;
  readonly geoEventsPath?: string;
  readonly immoEventsPath?: string;
  readonly generatedAt?: string;
}

function statusFor(immoGtEvents: number, geoEventsCount: number): Col20Status {
  if (immoGtEvents === 0) return "immo-gt-pending";
  return geoEventsCount > 0 ? "measured" : "measured-geo-empty";
}

function rowsFromReport(report: RecallGateReport): Col20Row[] {
  return report.cities.map((city) => {
    const immoGtEvents = city.immo_events;
    const matched = city.set_recall.matched;
    const immoGtAvailable = immoGtEvents > 0;
    return {
      slug: city.slug,
      geo_events_count: city.geo_events,
      immo_gt_available: immoGtAvailable,
      immo_gt_events: immoGtEvents,
      matched,
      recall_pct_si_mesurable: immoGtAvailable ? matched / immoGtEvents : null,
      statut: statusFor(immoGtEvents, city.geo_events),
    };
  });
}

/**
 * Build the col-20 artifact by running the recall gate over the cohort. The
 * full recall-gate JSON/MD are written to `auditDirectory` as the audit trail.
 */
export async function buildCol20Artifact(
  options: RunCol20Options,
  auditDirectory: string,
): Promise<{ readonly artifact: Col20Artifact; readonly recallReport: RecallGateReport }> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  // The recall gate requires an immo input; an absent handoff is an empty set,
  // which correctly renders every city `immo-gt-pending` rather than guessed.
  const syntheticImmoDirectory = options.immoEventsPath === undefined
    ? mkdtempSync(join(tmpdir(), "col20-empty-immo-"))
    : null;
  const immoEventsPath = options.immoEventsPath ?? join(syntheticImmoDirectory!, "immo-empty.json");
  if (syntheticImmoDirectory !== null) writeFileSync(immoEventsPath, "[]\n", { encoding: "utf8" });
  try {
    const result = await runRecallGate({
      cohort: options.cohort,
      immoEventsPath,
      ...(options.geoEventsPath === undefined ? {} : { geoEventsPath: options.geoEventsPath }),
      outPath: join(auditDirectory, "recall-gate.json"),
      markdownPath: join(auditDirectory, "recall-gate.md"),
      generatedAt,
    });
    const rows = rowsFromReport(result.report);
    const artifact: Col20Artifact = {
      contract: "qc-zoning-events-col20/v1",
      generated_at: generatedAt,
      cohort_size: options.cohort.length,
      cohort_source: options.cohortSource,
      geo_events_source: result.report.input.geo,
      immo_events_source: options.immoEventsPath ?? null,
      summary: {
        measured: rows.filter((row) => row.statut === "measured").length,
        measured_geo_empty: rows.filter((row) => row.statut === "measured-geo-empty").length,
        immo_gt_pending: rows.filter((row) => row.statut === "immo-gt-pending").length,
        geo_events_total: rows.reduce((total, row) => total + row.geo_events_count, 0),
        cities_with_geo_events: rows.filter((row) => row.geo_events_count > 0).length,
        immo_gt_events_total: rows.reduce((total, row) => total + row.immo_gt_events, 0),
        matched_total: rows.reduce((total, row) => total + row.matched, 0),
      },
      rows,
    };
    return { artifact, recallReport: result.report };
  } finally {
    if (syntheticImmoDirectory !== null) rmSync(syntheticImmoDirectory, { recursive: true, force: true });
  }
}

export function col20Markdown(artifact: Col20Artifact): string {
  const rows = artifact.rows.map((row) => {
    const recall = row.recall_pct_si_mesurable === null
      ? "immo-gt-pending"
      : `${(row.recall_pct_si_mesurable * 100).toFixed(1)} %`;
    return `| ${row.slug} | ${row.geo_events_count} | ${row.immo_gt_available ? "oui" : "non"} | ${row.matched}/${row.immo_gt_events} | ${recall} | ${row.statut} |`;
  });
  return [
    "# Col-20 qc-zoning-events par ville (WP5 v3.4 — recall directionnel immo→geo)",
    "",
    `Cohorte : ${artifact.cohort_size} villes (source : ${artifact.cohort_source}). Source geo : ${artifact.geo_events_source}. Source immo : ${artifact.immo_events_source ?? "aucune (toutes immo-gt-pending)"}.`,
    "",
    `Résumé : measured ${artifact.summary.measured} · measured-geo-empty ${artifact.summary.measured_geo_empty} · immo-gt-pending ${artifact.summary.immo_gt_pending}. Événements geo émis : ${artifact.summary.geo_events_total} sur ${artifact.summary.cities_with_geo_events} villes. Match immo→geo : ${artifact.summary.matched_total}/${artifact.summary.immo_gt_events_total}.`,
    "",
    "`recall_pct_si_mesurable` = recall directionnel immo→geo (metric Steve) ; `null`/immo-gt-pending quand la vérité-terrain immo manque — jamais un unknown fabriqué.",
    "",
    "| Ville | geo_events | immo_gt | matched/immo | recall | statut |",
    "| --- | ---: | :---: | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}

function join(...segments: string[]): string {
  return resolve(...segments);
}

function displayPath(path: string): string {
  const fromRoot = relative(ROOT, path);
  return !fromRoot.startsWith("..") && !isAbsolute(fromRoot) ? fromRoot : path;
}

function rootRelativePath(path: string): string {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`) && absolute !== ROOT) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function outputPath(path: string, extension: ".json"): string {
  if (!path.endsWith(extension)) throw new Error(`sortie doit finir par ${extension}: ${path}`);
  const absolute = rootRelativePath(path);
  if (existsSync(absolute)) throw new Error(`refus d'écraser l'artefact: ${displayPath(absolute)}`);
  return absolute;
}

function writeArtifact(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
}

function argumentValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const equals = args.find((argument) => argument.startsWith(`${name}=`));
  if (equals !== undefined) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function timestampForFilename(now: Date): string {
  return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

async function main(): Promise<void> {
  const cohortPath = argumentValue("--cohort");
  if (!cohortPath) throw new Error("--cohort <fichier slugs|TSV graph_city_slug> est requis");
  const { readFileSync } = await import("node:fs");
  const cohortAbsolute = rootRelativePath(cohortPath);
  const cohort = parseCohortFile(readFileSync(cohortAbsolute, "utf8"), displayPath(cohortAbsolute));
  const geoEventsPath = argumentValue("--geo-events");
  const immoEventsPath = argumentValue("--immo-events");
  const stamp = timestampForFilename(new Date());
  const outJson = outputPath(argumentValue("--out") ?? `work/coverage/zoning-events-col20-${stamp}.json`, ".json");
  const auditDirectory = outJson.replace(/\.json$/u, ".audit");

  const { artifact } = await buildCol20Artifact(
    {
      cohort,
      cohortSource: displayPath(cohortAbsolute),
      ...(geoEventsPath === undefined ? {} : { geoEventsPath }),
      ...(immoEventsPath === undefined ? {} : { immoEventsPath }),
    },
    auditDirectory,
  );

  writeArtifact(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  const outMarkdown = outJson.replace(/\.json$/u, ".md");
  writeArtifact(outMarkdown, col20Markdown(artifact));
  const needsImmoGt = artifact.rows.filter((row) => row.statut === "immo-gt-pending").map((row) => row.slug);
  const needsPath = outJson.replace(/\.json$/u, ".needs-immo-gt.txt");
  writeArtifact(needsPath, needsImmoGt.length === 0 ? "" : `${needsImmoGt.join("\n")}\n`);

  process.stdout.write(`${JSON.stringify({
    json: displayPath(outJson),
    markdown: displayPath(outMarkdown),
    needs_immo_gt: displayPath(needsPath),
    audit_dir: displayPath(auditDirectory),
    cohort_size: artifact.cohort_size,
    summary: artifact.summary,
    needs_immo_gt_count: needsImmoGt.length,
  })}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
