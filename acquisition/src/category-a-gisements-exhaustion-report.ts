/**
 * Produit la preuve nominative d'épuisement des gisements de la catégorie A.
 *
 * Le rapport ne conclut ni l'absence juridique d'un document ni une densité :
 * il prouve uniquement quels gisements ont réellement reçu une tentative
 * capturedFetch, avec le statut HTTP ou l'erreur exacte du manifeste S3.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CaptureRunHeaderSchema,
  parseManifestJsonl,
  type CaptureManifestLine,
  type CaptureRunHeader,
} from "../../packages/qc-sources/src/capture/index.js";
import {
  CATEGORY_A_GISEMENT_TARGETS,
  type CategoryAGisementTarget,
} from "./category-a-gisements-worklist.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

export const REQUIRED_GISEMENTS = [
  "cms_natif",
  "sitemap",
  "portail_mrc",
  "centre_documentaire_mrc",
  "wayback_cdx_domaine",
  "sig",
] as const;

export type CategoryAGisement = (typeof REQUIRED_GISEMENTS)[number]
  | "wayback_snapshot";

interface CompletedRun {
  header: CaptureRunHeader;
  lines: CaptureManifestLine[];
}

interface AttemptEvidence {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  error: string | null;
  runId: string;
  browserUserAgent: boolean;
}

interface GisementEvidence {
  attempted: boolean;
  attempts: AttemptEvidence[];
}

interface ExhaustionRow {
  slug: string;
  name: string;
  completedRuns: number;
  failedRuns: string[];
  attempts: number;
  gisements: Record<CategoryAGisement, GisementEvidence>;
  noResponse: {
    enotfound: string[];
    opaqueOrOther: string[];
  };
  http403: {
    count: number;
    allBrowserUserAgent: boolean;
  };
  requiredGisementsAttempted: boolean;
}

interface ExhaustionReport {
  contract: "category-a-gisements-exhaustion/v1";
  generatedAt: string;
  runPrefixes: string[];
  scopeCount: 17;
  rows: ExhaustionRow[];
}

function values(argv: readonly string[], name: string): string[] {
  return argv.flatMap((value, index) =>
    value === `--${name}` && argv[index + 1] ? [argv[index + 1]!] : []);
}

function option(argv: readonly string[], name: string): string | undefined {
  return values(argv, name)[0];
}

function host(value: string): string {
  return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
}

function mrcHosts(target: CategoryAGisementTarget): Set<string> {
  return new Set(target.mrcPortals.map(host));
}

export function classifyCategoryAAttempt(
  rawUrl: string,
  target: CategoryAGisementTarget,
): CategoryAGisement[] {
  const url = new URL(rawUrl);
  const path = url.pathname.toLowerCase();
  const out = new Set<CategoryAGisement>();
  const onMrc = mrcHosts(target).has(host(rawUrl));
  if (
    /\/wp-json\/wp\/v2\/media(?:\/|$)/i.test(path)
    || /\/storage\/app\/media(?:\/|$)/i.test(path)
    || /\/api\/[^/]+\/structure\/tree(?:\/|$)/i.test(path)
  ) out.add("cms_natif");
  if (/sitemap.*\.xml$/i.test(path)) out.add("sitemap");
  if (onMrc) out.add("portail_mrc");
  if (onMrc && /\/(?:centre-documentaire|documentation)(?:\/|$)/i.test(path)) {
    out.add("centre_documentaire_mrc");
  }
  if (url.hostname === "web.archive.org" && /\/cdx\/search\/cdx$/i.test(path)) {
    out.add("wayback_cdx_domaine");
  }
  if (url.hostname === "web.archive.org" && /\/web\/\d{14}(?:id_)?\//i.test(path)) {
    out.add("wayback_snapshot");
  }
  if (
    /arcgis|featureserver|mapserver|jmap|geocentri|vplus\.modellium/i.test(rawUrl)
  ) out.add("sig");
  return [...out];
}

async function completedRuns(prefixes: readonly string[]): Promise<CompletedRun[]> {
  const s3 = s3Client();
  const manifestKeys = new Set<string>();
  for (const prefix of prefixes) {
    for (const entry of await listObjectEntries(s3, `capture/_runs/${prefix}`)) {
      if (entry.key.endsWith("/manifest.jsonl")) manifestKeys.add(entry.key);
    }
  }
  const runs: CompletedRun[] = [];
  for (const manifestKey of [...manifestKeys].sort()) {
    const runId = manifestKey.slice("capture/_runs/".length, -"/manifest.jsonl".length);
    const headerKey = `capture/_runs/${runId}/run.json`;
    const entries = await listObjectEntries(s3, headerKey);
    if (!entries.some((entry) => entry.key === headerKey)) continue;
    const header = CaptureRunHeaderSchema.parse(
      JSON.parse((await getBytes(s3, headerKey)).toString("utf8")),
    );
    if (header.finished_at === null || header.exit_code === null) continue;
    runs.push({
      header,
      lines: parseManifestJsonl((await getBytes(s3, manifestKey)).toString("utf8")),
    });
  }
  return runs;
}

function emptyGisements(): Record<CategoryAGisement, GisementEvidence> {
  return {
    cms_natif: { attempted: false, attempts: [] },
    sitemap: { attempted: false, attempts: [] },
    portail_mrc: { attempted: false, attempts: [] },
    centre_documentaire_mrc: { attempted: false, attempts: [] },
    wayback_cdx_domaine: { attempted: false, attempts: [] },
    sig: { attempted: false, attempts: [] },
    wayback_snapshot: { attempted: false, attempts: [] },
  };
}

function attemptEvidence(line: CaptureManifestLine): AttemptEvidence {
  return {
    url: line.url,
    finalUrl: line.final_url,
    httpStatus: line.http_status,
    error: line.error,
    runId: line.run_id,
    browserUserAgent: /^Mozilla\/5\.0\b/.test(line.user_agent),
  };
}

function rowFor(target: CategoryAGisementTarget, runs: readonly CompletedRun[]): ExhaustionRow {
  const targetRuns = runs.filter((run) =>
    run.lines.some((line) => line.slugs.includes(target.slug)));
  const lines = targetRuns.flatMap((run) =>
    run.lines.filter((line) => line.slugs.includes(target.slug)));
  const gisements = emptyGisements();
  for (const line of lines) {
    for (const category of classifyCategoryAAttempt(line.url, target)) {
      gisements[category].attempts.push(attemptEvidence(line));
      gisements[category].attempted = true;
    }
  }
  const noResponse = lines.filter((line) => line.http_status === null && line.error !== null);
  const forbidden = lines.filter((line) => line.http_status === 403);
  return {
    slug: target.slug,
    name: target.name,
    completedRuns: targetRuns.length,
    failedRuns: targetRuns
      .filter((run) => run.header.exit_code !== 0)
      .map((run) => `${run.header.run_id}:exit-${String(run.header.exit_code)}`),
    attempts: lines.length,
    gisements,
    noResponse: {
      enotfound: noResponse
        .filter((line) => /\bENOTFOUND\b/i.test(line.error ?? ""))
        .map((line) => `${line.url} — ${line.error}`),
      opaqueOrOther: noResponse
        .filter((line) => !/\bENOTFOUND\b/i.test(line.error ?? ""))
        .map((line) => `${line.url} — ${line.error}`),
    },
    http403: {
      count: forbidden.length,
      allBrowserUserAgent: forbidden.every((line) => /^Mozilla\/5\.0\b/.test(line.user_agent)),
    },
    requiredGisementsAttempted: REQUIRED_GISEMENTS.every(
      (category) => gisements[category].attempted,
    ),
  };
}

function markdown(report: ExhaustionReport): string {
  const lines = [
    "# Catégorie A — gisements réellement tentés",
    "",
    `Périmètre exact: ${report.scopeCount}; génération: ${report.generatedAt}.`,
    "",
    "| Collection | CMS natif | Sitemap | Portail MRC | Centre documentaire MRC | Wayback CDX domaine | SIG | Tentatives |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of report.rows) {
    const count = (category: CategoryAGisement): number =>
      row.gisements[category].attempts.length;
    lines.push(
      `| ${row.slug} | ${count("cms_natif")} | ${count("sitemap")} | `
      + `${count("portail_mrc")} | ${count("centre_documentaire_mrc")} | `
      + `${count("wayback_cdx_domaine")} | ${count("sig")} | ${row.attempts} |`,
    );
  }
  lines.push(
    "",
    "> Une tentative prouve l'épuisement méthodique d'un gisement, pas l'absence juridique d'un document.",
    "",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const runPrefixes = values(argv, "run-prefix");
  if (runPrefixes.length === 0) throw new Error("au moins un --run-prefix est requis");
  const output = resolve(option(argv, "output")
    ?? "work/coverage/category-a-gisements-exhaustion-20260728.json");
  if (!output.startsWith(`${ROOT}/`)) throw new Error("--output doit rester dans le dépôt");
  const runs = await completedRuns(runPrefixes);
  const report: ExhaustionReport = {
    contract: "category-a-gisements-exhaustion/v1",
    generatedAt: new Date().toISOString(),
    runPrefixes,
    scopeCount: 17,
    rows: CATEGORY_A_GISEMENT_TARGETS.map((target) => rowFor(target, runs)),
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(output.replace(/\.json$/i, ".md"), markdown(report));
  process.stdout.write(
    `${output.replace(`${ROOT}/`, "")}\t`
    + `${report.rows.filter((row) => row.requiredGisementsAttempted).length}/17 complets\n`,
  );
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
