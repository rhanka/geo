/**
 * Matérialise la worklist de recapture ArcGIS à partir du recensement qui a
 * réellement ouvert les octets. Aucune requête HTTP n'est faite ici : la
 * capture reste exclusivement confiée au Job du cluster.
 *
 * Les pages de description ArcGIS sont prioritaires. Les seuls autres corps
 * retenus sont les réponses non géométriques provenant déjà de la voie
 * `zones-arcgis`; les PDF et robots.txt ne sont pas des candidats à une query
 * ArcGIS et restent donc hors de cette passe.
 *
 * Usage:
 *   npx tsx acquisition/src/capture-octets-recapture-worklist.ts \
 *     --in=work/coverage/capture-octets-classification-<UTC>.json \
 *     --out=work/coverage/zones-arcgis-recapture-<UTC>.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCaptureWorklist, type CaptureWorklistTarget } from "../../packages/qc-sources/src/capture/index.js";
import {
  arcgisGeometryQueryUrl,
  arcgisLayerEndpointFromCaptureUrl,
} from "./lib/served-zonage-immo-proof-url-capture-worklist.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Classification = "GEOMETRIE" | "PAGE HTML" | "AUTRE";

interface ClassifiedLine {
  classification: Classification;
  source: string;
  slugs: string[];
  url: string;
}

interface ClassificationReport {
  contract?: unknown;
  complete?: unknown;
  lines?: unknown;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function isClassifiedLine(value: unknown): value is ClassifiedLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<ClassifiedLine>;
  return (
    (line.classification === "GEOMETRIE" || line.classification === "PAGE HTML" || line.classification === "AUTRE") &&
    typeof line.source === "string" &&
    Array.isArray(line.slugs) &&
    line.slugs.every((slug) => typeof slug === "string") &&
    typeof line.url === "string"
  );
}

function priority(line: ClassifiedLine): number | null {
  if (line.classification === "PAGE HTML") return 0;
  if (line.classification === "AUTRE" && line.source === "zones-arcgis") return 1;
  return null;
}

interface Candidate {
  slug: string;
  source: string;
  urls: Set<string>;
  priority: number;
}

/**
 * Conserve un unique target par collection. Si l'historique en contient deux
 * lignes (même ville / même couche), la voie v1 est privilégiée pour garder
 * le rattachement de preuve tout en évitant une seconde collecte identique.
 */
export function buildArcgisRecaptureWorklist(lines: readonly ClassifiedLine[]): CaptureWorklistTarget[] {
  const candidates = new Map<string, Candidate>();
  let unusable = 0;
  for (const line of lines) {
    const linePriority = priority(line);
    if (linePriority === null) continue;
    const endpoint = arcgisLayerEndpointFromCaptureUrl(line.url);
    const queryUrl = endpoint === null ? null : arcgisGeometryQueryUrl(endpoint, "geojson");
    if (queryUrl === null) {
      unusable++;
      continue;
    }
    for (const slug of line.slugs) {
      const previous = candidates.get(slug);
      const source = previous?.source === "zones-v1-proof-url" || line.source === "zones-v1-proof-url"
        ? "zones-v1-proof-url"
        : line.source;
      const urls = previous?.urls ?? new Set<string>();
      urls.add(queryUrl);
      candidates.set(slug, {
        slug,
        source,
        urls,
        priority: Math.min(previous?.priority ?? linePriority, linePriority),
      });
    }
  }
  if (unusable > 0) throw new Error(`selected classification contains ${unusable} non-ArcGIS URL(s)`);
  return parseCaptureWorklist([...candidates.values()]
    .sort((left, right) => left.priority - right.priority || left.slug.localeCompare(right.slug))
    .map((candidate) => ({ slug: candidate.slug, source: candidate.source, urls: [...candidate.urls].sort() })));
}

async function main(): Promise<void> {
  const input = option("in");
  const output = option("out");
  if (!input || !output) throw new Error("--in=<classification.json> and --out=<worklist.json> are required");
  const inputPath = insideRepo(input, "in");
  const outputPath = insideRepo(output, "out");
  if (existsSync(outputPath)) throw new Error(`refusing to overwrite existing worklist: ${output}`);
  const report = JSON.parse(readFileSync(inputPath, "utf8")) as ClassificationReport;
  if (report.contract !== "capture-octets-classification/v1" || report.complete !== true || !Array.isArray(report.lines) || !report.lines.every(isClassifiedLine)) {
    throw new Error("classification report must be complete capture-octets-classification/v1 with valid lines");
  }
  const worklist = buildArcgisRecaptureWorklist(report.lines);
  if (worklist.length === 0) throw new Error("classification report has no ArcGIS recapture candidates");
  writeFileSync(outputPath, `${JSON.stringify(worklist, null, 2)}\n`, { flag: "wx" });
  const pageHtmlLines = report.lines.filter((line) => line.classification === "PAGE HTML").length;
  const otherArcgisLines = report.lines.filter((line) => line.classification === "AUTRE" && line.source === "zones-arcgis").length;
  console.log(JSON.stringify({
    input: inputPath,
    out: outputPath,
    targets: worklist.length,
    page_html_lines: pageHtmlLines,
    other_arcgis_lines: otherArcgisLines,
    format: "geojson",
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
