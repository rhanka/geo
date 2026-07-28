/**
 * Deterministic PV → Graphify runner.
 *
 * The PDF is used only as the captured source from which `pdftotext -layout`
 * materializes a local text input. All semantic assertions come from that text
 * through `lib/pv-graphify-semantic.ts`; no model/backend is selected here.
 *
 * Usage (S3 runs must retain these two environment values):
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx src/pv-graphify-semantic-run.ts --control=20
 *
 * The default control requires N distinct municipal slugs. It fails before any
 * S3 request when the supplied classification reports cannot provide them.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractPvSemantic,
  type GraphifySemanticExtraction,
  type MunicipalityGazetteerEntry,
  type MunicipalZoneGazetteer,
} from "./lib/pv-graphify-semantic.js";
import { getBytes, s3Client } from "./lib/s3.js";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DEFAULT_CLASSIFICATIONS = [1, 2, 3, 4, 5, 6, 7].map((lot) =>
  resolve(ROOT, "work", "coverage", `pv-capture-octets-classification-20260728-campaign-lot-${String(lot).padStart(4, "0")}.json`),
);
const MUNICIPALITIES_PATH = resolve(ROOT, "packages", "geo-sources-americas", "src", "ca-qc", "municipalities", "municipalities.qc.json");
const ZONE_REGISTRY_PATH = resolve(ROOT, "packages", "geo-sources-americas", "src", "ca-qc-zonage-arcgis", "registry.generated.json");
const GRAPHIFY_BIN = resolve(ROOT, "node_modules", ".bin", "graphify");

interface ClassificationLine {
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
  readonly storage_key: string;
  readonly classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME";
}

interface ZoneRegistryEntry {
  readonly citySlug: string;
  readonly zoneCodeField: string;
}

interface ParsedArgs {
  readonly classifications: readonly string[];
  readonly control: number | null;
  readonly all: boolean;
  readonly output: string;
}

interface GraphifyRunResult {
  readonly exit_code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly nodes: number | null;
  readonly edges: number | null;
}

interface ControlDocumentReport {
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
  readonly storage_key: string;
  readonly source_file: string;
  readonly entity_counts: Readonly<Record<string, number>>;
  readonly entities: Readonly<Record<string, readonly {
    readonly label: string;
    readonly legal_quality?: string;
    readonly citation: {
      readonly source_file: string;
      readonly source_location: string;
      readonly quote: string;
    };
  }[]>>;
  readonly graphify: GraphifyRunResult;
  readonly manual_verification: "UNVERIFIED";
}

function usage(): never {
  console.log("Usage: NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 npx tsx src/pv-graphify-semantic-run.ts [--control=N | --all] [--classification=PATH] [--out=PATH]");
  process.exit(0);
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) usage();
  const values = (name: string): string[] => argv
    .filter((argument) => argument.startsWith(`--${name}=`))
    .map((argument) => argument.slice(name.length + 3));
  const controlValue = values("control").at(-1);
  const control = controlValue === undefined ? 20 : Number(controlValue);
  if (!Number.isInteger(control) || control < 1) throw new Error("--control doit être un entier positif");
  const all = argv.includes("--all");
  if (all && values("control").length > 0) throw new Error("--all et --control sont exclusifs");
  const outputValue = values("out").at(-1);
  const timestamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..+/u, "Z");
  return {
    classifications: values("classification").map((path) => resolve(ROOT, path)),
    control: all ? null : control,
    all,
    output: resolve(ROOT, outputValue ?? `work/coverage/pv-graphify-semantic-${timestamp}.json`),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}.${key} doit être une chaîne non vide`);
  return value.trim();
}

function readClassificationLines(path: string): ClassificationLine[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw) || !Array.isArray(raw.lines)) throw new Error(`rapport de classification invalide: ${path}`);
  const eligible: ClassificationLine[] = [];
  for (const [index, value] of raw.lines.entries()) {
    if (!isRecord(value) || value.classification !== "PV_LISIBLE_PROPRIETAIRE_CONFIRME") continue;
    const where = `${path}.lines[${index}]`;
    eligible.push({
      slug: requiredString(value, "slug", where),
      municipality_name: requiredString(value, "municipality_name", where),
      url: requiredString(value, "url", where),
      storage_key: requiredString(value, "storage_key", where),
      classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME",
    });
  }
  return eligible;
}

function uniqueEligible(lines: readonly ClassificationLine[]): ClassificationLine[] {
  const byObject = new Map<string, ClassificationLine>();
  for (const line of lines) {
    if (!byObject.has(line.storage_key)) byObject.set(line.storage_key, line);
  }
  return [...byObject.values()].sort((left, right) =>
    left.slug.localeCompare(right.slug) || left.storage_key.localeCompare(right.storage_key));
}

function selectControl(lines: readonly ClassificationLine[], count: number): ClassificationLine[] {
  const oneByMunicipality = new Map<string, ClassificationLine>();
  for (const line of lines) {
    if (!oneByMunicipality.has(line.slug)) oneByMunicipality.set(line.slug, line);
  }
  if (oneByMunicipality.size < count) {
    throw new Error(
      `lot de contrôle impossible: ${count} municipalités distinctes exigées, ${oneByMunicipality.size} disponibles dans les rapports fournis`,
    );
  }
  return [...oneByMunicipality.values()]
    .sort((left, right) => left.slug.localeCompare(right.slug) || left.storage_key.localeCompare(right.storage_key))
    .slice(0, count);
}

function readMunicipalities(path: string): MunicipalityGazetteerEntry[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`gazetteer municipal invalide: ${path}`);
  return raw.map((value, index) => {
    if (!isRecord(value)) throw new Error(`gazetteer municipal invalide à l'index ${index}`);
    return {
      slug: requiredString(value, "slug", `gazetteer[${index}]`),
      name: requiredString(value, "name", `gazetteer[${index}]`),
    };
  });
}

function readZoneRegistry(path: string): ZoneRegistryEntry[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`registry de zones invalide: ${path}`);
  const entries: ZoneRegistryEntry[] = [];
  for (const [index, value] of raw.entries()) {
    if (!isRecord(value)) throw new Error(`registry de zones invalide à l'index ${index}`);
    entries.push({
      citySlug: requiredString(value, "citySlug", `registry[${index}]`),
      zoneCodeField: requiredString(value, "zoneCodeField", `registry[${index}]`),
    });
  }
  return entries;
}

function assertS3RunEnvironment(): void {
  if (!process.env.NODE_OPTIONS?.split(/\s+/u).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env.AWS_MAX_ATTEMPTS !== "10") {
    throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

async function textFromCapturedPdf(path: string): Promise<string> {
  const { stdout } = await execFileAsync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", path, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!stdout.trim()) throw new Error(`pas de couche texte: ${path}`);
  return stdout;
}

function servedZoneKeys(slug: string): string[] {
  const name = `qc-zonage-${slug}.geojson`;
  return [
    `normalized/ca-qc-zonage/qc-zonage-${slug}/${name}`,
    `normalized/ca-qc-zonage/${name}`,
  ];
}

function codesFromServedCollection(raw: unknown, fields: ReadonlySet<string>): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.features)) throw new Error("collection de zones servie invalide");
  const codes = new Set<string>();
  for (const feature of raw.features) {
    if (!isRecord(feature) || !isRecord(feature.properties)) continue;
    for (const field of fields) {
      const value = feature.properties[field];
      if (typeof value === "string" && value.trim()) codes.add(value.trim());
    }
  }
  return [...codes].sort((left, right) => left.localeCompare(right));
}

/**
 * Never consult another municipality: entries are filtered by the document slug
 * before the sole served collection for that slug is parsed.
 */
async function materializeMunicipalZoneGazetteer(
  slug: string,
  registry: readonly ZoneRegistryEntry[],
): Promise<MunicipalZoneGazetteer | undefined> {
  const fields = new Set(registry.filter((entry) => entry.citySlug === slug).map((entry) => entry.zoneCodeField));
  if (fields.size === 0) return undefined;
  const s3 = s3Client();
  let bytes: Buffer | null = null;
  for (const key of servedZoneKeys(slug)) {
    try {
      bytes = await getBytes(s3, key);
      break;
    } catch {
      // The canonical collection has two supported layouts. Neither fallback
      // widens the municipality scope.
    }
  }
  if (bytes === null) return undefined;
  const codes = codesFromServedCollection(JSON.parse(bytes.toString("utf8")) as unknown, fields);
  return { municipality_slug: slug, codes };
}

async function runGraphify(inputDirectory: string, semanticPath: string, outputDirectory: string): Promise<GraphifyRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(GRAPHIFY_BIN, [
      "extract",
      "--semantic", semanticPath,
      "--out", outputDirectory,
      "--no-cluster",
      "--no-label",
      "--no-description",
      inputDirectory,
    ], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const count = /—\s+(\d+) nodes,\s+(\d+) edges/u.exec(stdout);
    return {
      exit_code: 0,
      stdout: stdout.slice(-4000),
      stderr: stderr.slice(-4000),
      nodes: count ? Number(count[1]) : null,
      edges: count ? Number(count[2]) : null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { exit_code: 1, stdout: "", stderr: message.slice(-4000), nodes: null, edges: null };
  }
}

function reportEntities(extraction: GraphifySemanticExtraction): ControlDocumentReport["entities"] {
  const byType: Record<string, Array<{
    label: string;
    legal_quality?: string;
    citation: { source_file: string; source_location: string; quote: string };
  }>> = {};
  for (const entity of extraction.nodes) {
    const first = entity.citations[0];
    if (!first) continue;
    const bucket = byType[entity.node_type] ?? [];
    bucket.push({
      label: entity.label,
      ...(entity.legal_quality ? { legal_quality: entity.legal_quality } : {}),
      citation: {
        source_file: first.source_file,
        source_location: first.source_location,
        quote: first.quote,
      },
    });
    byType[entity.node_type] = bucket;
  }
  return byType;
}

function reportCounts(extraction: GraphifySemanticExtraction): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entity of extraction.nodes) counts[entity.node_type] = (counts[entity.node_type] ?? 0) + 1;
  return counts;
}

async function processDocument(
  document: ClassificationLine,
  municipalities: readonly MunicipalityGazetteerEntry[],
  registry: readonly ZoneRegistryEntry[],
  workspace: string,
): Promise<ControlDocumentReport> {
  const documentDirectory = resolve(workspace, document.slug, document.storage_key.slice(-16));
  const inputDirectory = resolve(documentDirectory, "input");
  mkdirSync(inputDirectory, { recursive: true });
  const pdfPath = resolve(inputDirectory, "captured.pdf");
  const textPath = resolve(inputDirectory, "document.txt");
  writeFileSync(pdfPath, await getBytes(s3Client(), document.storage_key));
  const text = await textFromCapturedPdf(pdfPath);
  writeFileSync(textPath, text, "utf8");
  const zoneGazetteer = await materializeMunicipalZoneGazetteer(document.slug, registry);
  const semantic = extractPvSemantic({
    source_file: "document.txt",
    source_id: document.storage_key,
    source_url: document.url,
    municipality_slug: document.slug,
    text,
  }, municipalities, zoneGazetteer);
  const semanticPath = resolve(documentDirectory, "semantic.json");
  writeAtomic(semanticPath, semantic);
  const graphify = await runGraphify(inputDirectory, semanticPath, documentDirectory);
  return {
    slug: document.slug,
    municipality_name: document.municipality_name,
    url: document.url,
    storage_key: document.storage_key,
    source_file: "document.txt",
    entity_counts: reportCounts(semantic),
    entities: reportEntities(semantic),
    graphify,
    manual_verification: "UNVERIFIED",
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const paths = args.classifications.length > 0 ? args.classifications : DEFAULT_CLASSIFICATIONS;
  const eligible = uniqueEligible(paths.flatMap(readClassificationLines));
  const selected = args.all ? eligible : selectControl(eligible, args.control!);
  assertS3RunEnvironment();

  const municipalities = readMunicipalities(MUNICIPALITIES_PATH);
  const registry = readZoneRegistry(ZONE_REGISTRY_PATH);
  const workspace = resolve(ROOT, "work", "graphify", `pv-semantic-${new Date().toISOString().replace(/[-:]/gu, "").replace(/\..+/u, "Z")}`);
  const documents: ControlDocumentReport[] = [];
  for (const document of selected) documents.push(await processDocument(document, municipalities, registry, workspace));

  const entityCounts: Record<string, number> = {};
  let graphNodes = 0;
  let graphEdges = 0;
  let graphifyFailures = 0;
  for (const document of documents) {
    for (const [type, count] of Object.entries(document.entity_counts)) entityCounts[type] = (entityCounts[type] ?? 0) + count;
    graphNodes += document.graphify.nodes ?? 0;
    graphEdges += document.graphify.edges ?? 0;
    if (document.graphify.exit_code !== 0) graphifyFailures++;
  }
  const report = {
    contract: "pv-graphify-semantic-control/v1",
    generated_at: new Date().toISOString(),
    mode: args.all ? "all-eligible" : "distinct-municipality-control",
    classification_reports: paths.map((path) => path.slice(ROOT.length + 1)),
    eligible_documents: eligible.length,
    eligible_municipalities: new Set(eligible.map((document) => document.slug)).size,
    selected_documents: documents.length,
    entity_counts: entityCounts,
    graphify: { nodes: graphNodes, edges: graphEdges, failures: graphifyFailures },
    manual_verification: "UNVERIFIED",
    workspace,
    documents,
  };
  writeAtomic(args.output, report);
  console.log(JSON.stringify({
    report: args.output.slice(ROOT.length + 1),
    selected_documents: report.selected_documents,
    entity_counts: report.entity_counts,
    graphify: report.graphify,
    manual_verification: report.manual_verification,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
