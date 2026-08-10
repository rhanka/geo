/**
 * Read-only precision analysis for the closed extra partition emitted by the
 * qc-zoning-events recall gate. This deliberately does not alter the recall
 * gate: it consumes its artifact as evidence and may be re-run post-crosswalk.
 *
 * npx tsx acquisition/src/zoning-events-precision-analysis.ts \
 *   --gate work/coverage/zoning-events-recall-gate-pv10-20260802.json \
 *   --immo /path/to/jointures-designation-events.ndjson \
 *   --out work/coverage/zoning-events-precision-YYYYMMDDTHHMMSSZ.json
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseImmoDesignationEvents,
  type NaturalKey,
  type NaturalKeyEvent,
} from "./zoning-events-recall-gate.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const SAMPLE_LIMIT = 5;

export const EXTRA_CATEGORIES = [
  "residual_taxonomy",
  "shared_doc_immo_undercount",
  "geo_only_doc",
] as const;

export type ExtraCategory = (typeof EXTRA_CATEGORIES)[number];

export interface PrecisionSample {
  readonly city: string;
  readonly natural_key: NaturalKey;
  /** Verbatim only when it survived in the recall-gate artifact. */
  readonly extrait_brut: string | null;
  /** No document comparison was possible because geo had no complete document key. */
  readonly document_identity_state: "complete" | "incomplete";
}

export interface PrecisionBreakdown {
  readonly residual_taxonomy: number;
  readonly shared_doc_immo_undercount: number;
  readonly geo_only_doc: number;
}

type MutablePrecisionBreakdown = {
  -readonly [key in keyof PrecisionBreakdown]: PrecisionBreakdown[key];
};

export interface CityPrecision {
  readonly slug: string;
  readonly matched: number;
  readonly extra: number;
  readonly precision_naive: number | null;
  readonly precision_state: "measured" | "no_geo_events";
  readonly extras: PrecisionBreakdown;
}

export interface PrecisionAnalysisReport {
  readonly contract: "qc-zoning-events-precision-analysis/v1";
  readonly generated_at: string;
  readonly read_only_aggregation: true;
  readonly input: {
    readonly recall_gate_path: string;
    readonly immo_events_path: string;
    readonly recall_gate_contract: "qc-zoning-events-recall-gate/v1";
  };
  readonly definition: {
    readonly precision_naive: "matched / (matched + extra)";
    readonly interpretation: string;
    readonly extra_partition: Record<ExtraCategory, string>;
    readonly document_identity_incomplete: string;
  };
  readonly cities: readonly CityPrecision[];
  readonly aggregate: CityPrecision & { readonly slug: "aggregate" };
  readonly samples: Readonly<Record<ExtraCategory, readonly PrecisionSample[]>>;
}

export interface RunPrecisionAnalysisOptions {
  readonly gatePath: string;
  readonly immoEventsPath: string;
  readonly outPath: string;
  readonly generatedAt?: string;
}

export interface RunPrecisionAnalysisResult {
  readonly report: PrecisionAnalysisReport;
  readonly output: string;
  readonly markdownOutput: string;
}

interface GateExtra {
  readonly city: string;
  readonly naturalKey: NaturalKey;
  readonly extraitBrut: string | null;
}

interface GateCity {
  readonly slug: string;
  readonly matched: number;
  readonly extra: number;
  readonly extras: readonly GateExtra[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: objet requis`);
  return value;
}

function nullableString(value: unknown, where: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${where}: chaîne ou null requis`);
  return value;
}

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${where}: chaîne non vide requise`);
  return value;
}

function count(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${where}: entier positif requis`);
  }
  return value;
}

function rootRelativePath(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`) && absolute !== ROOT) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function readOnlyInputPath(path: string): string {
  return isAbsolute(path) ? resolve(path) : rootRelativePath(path);
}

function displayPath(path: string): string {
  const fromRoot = relative(ROOT, path);
  return !fromRoot.startsWith("..") && !isAbsolute(fromRoot) ? fromRoot : path;
}

function readText(path: string): string {
  const absolute = readOnlyInputPath(path);
  const size = statSync(absolute).size;
  if (size > MAX_INPUT_BYTES) throw new Error(`${displayPath(absolute)}: ${size} octets > plafond de ${MAX_INPUT_BYTES}`);
  return readFileSync(absolute, "utf8");
}

function readJson(path: string): unknown {
  const absolute = readOnlyInputPath(path);
  try {
    return JSON.parse(readText(path)) as unknown;
  } catch (error) {
    throw new Error(`${displayPath(absolute)}: JSON invalide: ${errorText(error)}`);
  }
}

function readImmoEvents(path: string): unknown[] {
  const absolute = readOnlyInputPath(path);
  const text = readText(path);
  const parseNdjson = (): unknown[] => text.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`${displayPath(absolute)}: NDJSON ligne ${index + 1} invalide: ${errorText(error)}`);
      }
    });
  if (absolute.toLowerCase().endsWith(".ndjson")) return parseNdjson();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error("tableau JSON requis");
    return parsed;
  } catch (error) {
    const nonEmptyLineCount = text.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
    if (nonEmptyLineCount > 1) return parseNdjson();
    throw new Error(`${displayPath(absolute)}: JSON invalide: ${errorText(error)}`);
  }
}

function naturalKey(value: unknown, where: string): NaturalKey {
  const source = record(value, where);
  return {
    muni: nullableString(source.muni, `${where}.muni`),
    source_url_norm: nullableString(source.source_url_norm, `${where}.source_url_norm`),
    date_iso: nullableString(source.date_iso, `${where}.date_iso`),
    type: nullableString(source.type, `${where}.type`),
  };
}

function optionalExcerpt(geo: Record<string, unknown>): string | null {
  const sourceFields = isRecord(geo.source_fields) ? geo.source_fields : null;
  const candidate = sourceFields?.extrait_brut ?? geo.extrait_brut;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function parseGate(path: string): GateCity[] {
  const gate = record(readJson(path), "recall gate");
  if (gate.contract !== "qc-zoning-events-recall-gate/v1") {
    throw new Error("recall gate: contract qc-zoning-events-recall-gate/v1 requis");
  }
  if (!Array.isArray(gate.cities)) throw new Error("recall gate.cities: tableau requis");
  return gate.cities.map((value, cityIndex) => {
    const city = record(value, `recall gate.cities[${cityIndex}]`);
    const slug = nonEmptyString(city.slug, `recall gate.cities[${cityIndex}].slug`);
    const matched = count(city.matched, `recall gate.cities[${cityIndex}].matched`);
    const extra = count(city.extra, `recall gate.cities[${cityIndex}].extra`);
    const partition = record(city.partition, `recall gate.cities[${cityIndex}].partition`);
    if (!Array.isArray(partition.extra)) throw new Error(`recall gate.cities[${cityIndex}].partition.extra: tableau requis`);
    if (partition.extra.length !== extra) {
      throw new Error(`recall gate.cities[${cityIndex}]: extra ne correspond pas à la partition fermée`);
    }
    const extras = partition.extra.map((entry, extraIndex) => {
      const item = record(entry, `recall gate.cities[${cityIndex}].partition.extra[${extraIndex}]`);
      const geo = record(item.geo, `recall gate.cities[${cityIndex}].partition.extra[${extraIndex}].geo`);
      return {
        city: slug,
        naturalKey: naturalKey(geo.natural_key, `recall gate.cities[${cityIndex}].partition.extra[${extraIndex}].geo.natural_key`),
        extraitBrut: optionalExcerpt(geo),
      };
    });
    return { slug, matched, extra, extras };
  });
}

function documentToken(key: NaturalKey): string | null {
  if (key.muni === null || key.source_url_norm === null) return null;
  return JSON.stringify([key.muni, key.source_url_norm]);
}

function documentDateToken(key: NaturalKey): string | null {
  const document = documentToken(key);
  return document === null || key.date_iso === null ? null : JSON.stringify([document, key.date_iso]);
}

function categoryFor(
  extra: GateExtra,
  immoByDocument: ReadonlyMap<string, readonly NaturalKeyEvent[]>,
  immoByDocumentDate: ReadonlyMap<string, readonly NaturalKeyEvent[]>,
): ExtraCategory {
  const document = documentToken(extra.naturalKey);
  if (document === null) return "geo_only_doc";
  const documentEvents = immoByDocument.get(document);
  if (documentEvents === undefined) return "geo_only_doc";
  const documentDate = documentDateToken(extra.naturalKey);
  const sameDateEvents = documentDate === null ? [] : immoByDocumentDate.get(documentDate) ?? [];
  if (sameDateEvents.some((event) => event.natural_key.type !== extra.naturalKey.type)) {
    return "residual_taxonomy";
  }
  return "shared_doc_immo_undercount";
}

function emptyBreakdown(): PrecisionBreakdown {
  return { residual_taxonomy: 0, shared_doc_immo_undercount: 0, geo_only_doc: 0 };
}

function precision(matched: number, extra: number): Pick<CityPrecision, "precision_naive" | "precision_state"> {
  const denominator = matched + extra;
  return denominator === 0
    ? { precision_naive: null, precision_state: "no_geo_events" }
    : { precision_naive: matched / denominator, precision_state: "measured" };
}

function sample(extra: GateExtra): PrecisionSample {
  return {
    city: extra.city,
    natural_key: extra.naturalKey,
    extrait_brut: extra.extraitBrut,
    document_identity_state: documentToken(extra.naturalKey) === null ? "incomplete" : "complete",
  };
}

function outputPaths(path: string): { output: string; markdownOutput: string } {
  if (!path.endsWith(".json")) throw new Error(`--out doit finir par .json: ${path}`);
  const output = isAbsolute(path) ? resolve(path) : rootRelativePath(path);
  const markdownOutput = `${output.slice(0, -".json".length)}.md`;
  if (existsSync(output)) throw new Error(`refus d'écraser l'artefact: ${displayPath(output)}`);
  if (existsSync(markdownOutput)) throw new Error(`refus d'écraser l'artefact: ${displayPath(markdownOutput)}`);
  return { output, markdownOutput };
}

function writeArtifact(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
}

function formatPrecision(value: number | null): string {
  return value === null ? "unknown (no_geo_events)" : value.toFixed(4);
}

function markdown(report: PrecisionAnalysisReport): string {
  const cityRows = report.cities.map((city) => `| ${city.slug} | ${city.matched} | ${city.extra} | ${formatPrecision(city.precision_naive)} | ${city.extras.residual_taxonomy} | ${city.extras.shared_doc_immo_undercount} | ${city.extras.geo_only_doc} | ${city.precision_state} |`);
  const samples = EXTRA_CATEGORIES.flatMap((category) => [
    `### ${category}`,
    "",
    ...(report.samples[category].length === 0
      ? ["Aucun extra dans cette catégorie."]
      : report.samples[category].map((entry) => `- ${JSON.stringify(entry)}`)),
    "",
  ]);
  return [
    "# Analyse de précision qc-zoning-events vs DesignationEvents immo",
    "",
    "Mesure read-only dérivée de la partition fermée matched/missed/extra du recall gate. Elle ne modifie ni le gate de rappel ni la spine.",
    "",
    `Précision naïve agrégée : ${formatPrecision(report.aggregate.precision_naive)} (${report.aggregate.matched} matched / ${report.aggregate.matched + report.aggregate.extra} events geo). C’est une borne basse descriptive : les extras sont ventilés ci-dessous, sans les déclarer faux positifs.`,
    "",
    "| Ville | Matched | Extra | Précision naïve | residual_taxonomy | shared_doc_immo_undercount | geo_only_doc | État |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    `| aggregate | ${report.aggregate.matched} | ${report.aggregate.extra} | ${formatPrecision(report.aggregate.precision_naive)} | ${report.aggregate.extras.residual_taxonomy} | ${report.aggregate.extras.shared_doc_immo_undercount} | ${report.aggregate.extras.geo_only_doc} | ${report.aggregate.precision_state} |`,
    ...cityRows,
    "",
    "## Ventilation fermée des extras geo-only",
    "",
    `- residual_taxonomy : ${report.definition.extra_partition.residual_taxonomy}`,
    `- shared_doc_immo_undercount : ${report.definition.extra_partition.shared_doc_immo_undercount}`,
    `- geo_only_doc : ${report.definition.extra_partition.geo_only_doc}`,
    "",
    "Un `document_identity_state: incomplete` ne conclut pas qu’immo n’a jamais eu le document : il signale seulement qu’aucune comparaison de document normalisé n’était possible.",
    "",
    "## Échantillon auditable (maximum 5 extras par catégorie)",
    "",
    ...samples,
  ].join("\n");
}

export function runPrecisionAnalysis(options: RunPrecisionAnalysisOptions): RunPrecisionAnalysisResult {
  const output = outputPaths(options.outPath);
  const gateCities = parseGate(options.gatePath);
  const immoRaw = readImmoEvents(options.immoEventsPath);
  const designationRaw = immoRaw.filter((value, index) => {
    const item = record(value, `immo events[${index}]`);
    return item.node_type === "DesignationEvent";
  });
  const immoEvents = parseImmoDesignationEvents(designationRaw);
  const immoByDocument = new Map<string, NaturalKeyEvent[]>();
  const immoByDocumentDate = new Map<string, NaturalKeyEvent[]>();
  for (const event of immoEvents) {
    const document = documentToken(event.natural_key);
    if (document !== null) {
      const list = immoByDocument.get(document) ?? [];
      list.push(event);
      immoByDocument.set(document, list);
    }
    const documentDate = documentDateToken(event.natural_key);
    if (documentDate !== null) {
      const list = immoByDocumentDate.get(documentDate) ?? [];
      list.push(event);
      immoByDocumentDate.set(documentDate, list);
    }
  }

  const samples: Record<ExtraCategory, PrecisionSample[]> = {
    residual_taxonomy: [],
    shared_doc_immo_undercount: [],
    geo_only_doc: [],
  };
  const cities: CityPrecision[] = gateCities.map((city) => {
    const extras: MutablePrecisionBreakdown = emptyBreakdown();
    for (const extra of city.extras) {
      const category = categoryFor(extra, immoByDocument, immoByDocumentDate);
      extras[category] += 1;
      if (samples[category].length < SAMPLE_LIMIT) samples[category].push(sample(extra));
    }
    const classified = extras.residual_taxonomy + extras.shared_doc_immo_undercount + extras.geo_only_doc;
    if (classified !== city.extra) throw new Error(`${city.slug}: partition extra non fermée`);
    return { slug: city.slug, matched: city.matched, extra: city.extra, ...precision(city.matched, city.extra), extras };
  });
  const aggregateExtras = cities.reduce<PrecisionBreakdown>((total, city) => ({
    residual_taxonomy: total.residual_taxonomy + city.extras.residual_taxonomy,
    shared_doc_immo_undercount: total.shared_doc_immo_undercount + city.extras.shared_doc_immo_undercount,
    geo_only_doc: total.geo_only_doc + city.extras.geo_only_doc,
  }), emptyBreakdown());
  const aggregateMatched = cities.reduce((total, city) => total + city.matched, 0);
  const aggregateExtra = cities.reduce((total, city) => total + city.extra, 0);
  const report: PrecisionAnalysisReport = {
    contract: "qc-zoning-events-precision-analysis/v1",
    generated_at: options.generatedAt ?? new Date().toISOString(),
    read_only_aggregation: true,
    input: {
      recall_gate_path: displayPath(readOnlyInputPath(options.gatePath)),
      immo_events_path: displayPath(readOnlyInputPath(options.immoEventsPath)),
      recall_gate_contract: "qc-zoning-events-recall-gate/v1",
    },
    definition: {
      precision_naive: "matched / (matched + extra)",
      interpretation: "Borne basse descriptive: les extras ne sont pas déclarés faux positifs; la ventilation distingue un résidu de taxonomie, un document partagé avec écart de granularité possible, et un document non observé côté immo.",
      extra_partition: {
        residual_taxonomy: "Même (muni, source_url_norm, date_iso) qu’un DesignationEvent immo, mais type différent: résidu de crosswalk à vérifier.",
        shared_doc_immo_undercount: "Même (muni, source_url_norm) qu’au moins un DesignationEvent immo, sans le signal de type divergent ci-dessus: sous-comptage immo ou sur-split geo à qualifier.",
        geo_only_doc: "Aucun (muni, source_url_norm) normalisé observé parmi les DesignationEvents immo: document geo-only réel ou bruit à qualifier.",
      },
      document_identity_incomplete: "Une identité de document geo incomplète est classée geo_only_doc pour préserver la partition, mais est marquée inconclusive dans l’échantillon; aucune absence immo n’est alors affirmée.",
    },
    cities,
    aggregate: {
      slug: "aggregate",
      matched: aggregateMatched,
      extra: aggregateExtra,
      ...precision(aggregateMatched, aggregateExtra),
      extras: aggregateExtras,
    },
    samples,
  };
  const categorizedAggregate = aggregateExtras.residual_taxonomy + aggregateExtras.shared_doc_immo_undercount + aggregateExtras.geo_only_doc;
  if (categorizedAggregate !== aggregateExtra) throw new Error("aggregate: partition extra non fermée");
  writeArtifact(output.output, `${JSON.stringify(report, null, 2)}\n`);
  writeArtifact(output.markdownOutput, markdown(report));
  return { report, ...output };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function main(): void {
  const gatePath = argumentValue("--gate");
  const immoEventsPath = argumentValue("--immo");
  if (!gatePath) throw new Error("--gate <path> est requis");
  if (!immoEventsPath) throw new Error("--immo <path> est requis");
  const stamp = timestampForFilename(new Date());
  const result = runPrecisionAnalysis({
    gatePath,
    immoEventsPath,
    outPath: argumentValue("--out") ?? `work/coverage/zoning-events-precision-${stamp}.json`,
  });
  process.stdout.write(`${JSON.stringify({
    json: displayPath(result.output),
    markdown: displayPath(result.markdownOutput),
    precision_naive: result.report.aggregate.precision_naive,
    matched: result.report.aggregate.matched,
    extra: result.report.aggregate.extra,
    extras: result.report.aggregate.extras,
    cities: result.report.cities.map((city) => ({
      slug: city.slug,
      precision_naive: city.precision_naive,
      matched: city.matched,
      extra: city.extra,
      extras: city.extras,
    })),
  })}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 2;
  }
}
