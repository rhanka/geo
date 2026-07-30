/**
 * Reconcile one territorial PV capture campaign into explicit verdicts.
 *
 * This report is deliberately local and read-only with respect to S3: it only
 * consumes committed classification, Graphify and HTML-audit reports. Every
 * durable CAS key receives one terminal verdict, while failed captures remain
 * documented as absences.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const CAMPAIGN = resolve(COVERAGE, "pv-territorial-20260729t231834z");
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const WAVE2_CLASSIFICATION = /^pv-capture-octets-classification-20260729t231834z-lot-\d{4}\.json$/u;
const WAVE1_CLASSIFICATION = /^pv-capture-octets-classification-20260729t222149z-lot-\d{4}\.json$/u;
const REAL_BATCH_REPORT = /^pv-graphify-semantic-real-universe-\d{8}-batch-\d{2}(?:-part-\d+)?\.json$/u;
const CAMPAIGN_REPORT = /^pv-graphify-semantic-real-universe-20260729-batch-01-part-\d+\.json$/u;

type JsonRecord = Record<string, unknown>;

interface CaptureLine extends JsonRecord {
  readonly classification: string;
  readonly storage_key?: string | null;
  readonly slug?: string;
  readonly municipality_name?: string;
}

interface TerminalVerdict {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string;
  readonly capture_classification: string;
  readonly indexed: boolean;
  readonly verdict: string;
  readonly reason: string;
  readonly graphify_report?: string;
  readonly printed_owner_slugs?: readonly string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSmallJson(path: string): unknown {
  const size = statSync(path).size;
  if (size > MAX_REPORT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture ${MAX_REPORT_BYTES}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${where}: chaîne non vide attendue`);
  return value.trim();
}

function listFiles(pattern: RegExp, directory = COVERAGE): string[] {
  return readdirSync(directory).filter((name) => pattern.test(name)).sort((left, right) => left.localeCompare(right));
}

function readCaptureLines(paths: readonly string[]): CaptureLine[] {
  const lines: CaptureLine[] = [];
  for (const path of paths) {
    const raw = readSmallJson(path);
    if (!isRecord(raw) || !Array.isArray(raw.lines)) throw new Error(`classification invalide: ${path}`);
    for (const [index, value] of raw.lines.entries()) {
      if (!isRecord(value)) throw new Error(`${path}.lines[${index}] invalide`);
      lines.push(value as CaptureLine);
    }
  }
  return lines;
}

function durableCasLines(lines: readonly CaptureLine[], label: string): CaptureLine[] {
  const durable = lines.filter((line) => typeof line.storage_key === "string" && line.storage_key.length > 0);
  const seen = new Set<string>();
  for (const line of durable) {
    const key = requiredString(line.storage_key, `${label}.storage_key`);
    if (seen.has(key)) throw new Error(`${label}: CAS dupliquée ${key}`);
    seen.add(key);
  }
  return durable;
}

function readSnapshotKeys(path: string): Set<string> {
  const raw = readSmallJson(path);
  if (!isRecord(raw) || raw.contract !== "pv-graphify-semantic-real-universe/v1") throw new Error(`snapshot invalide: ${path}`);
  const indexed = isRecord(raw.indexed_graph) ? raw.indexed_graph.storage_keys : null;
  if (!Array.isArray(indexed)) throw new Error(`snapshot sans indexed_graph.storage_keys: ${path}`);
  return new Set(indexed.map((value, index) => requiredString(value, `${path}.indexed_graph.storage_keys[${index}]`)));
}

function readIndexedHistoricalReports(paths: readonly string[]): { readonly keys: Set<string>; readonly slugs: Set<string> } {
  const keys = new Set<string>();
  const slugs = new Set<string>();
  for (const path of paths) {
    const raw = readSmallJson(path);
    if (!isRecord(raw) || raw.contract !== "pv-graphify-semantic-control/v1" || !Array.isArray(raw.documents)) {
      throw new Error(`rapport Graphify réel invalide: ${path}`);
    }
    for (const [index, value] of raw.documents.entries()) {
      if (!isRecord(value) || value.outcome !== "INDEXED") continue;
      keys.add(requiredString(value.storage_key, `${path}.documents[${index}].storage_key`));
      slugs.add(requiredString(value.slug, `${path}.documents[${index}].slug`));
    }
  }
  return { keys, slugs };
}

function readZeroPvSelection(): { readonly path: string; readonly rows: readonly JsonRecord[]; readonly slugs: Set<string> } {
  const path = resolve(COVERAGE, "pv-capture-20260729t231834z-territorial-selection.json");
  const raw = readSmallJson(path);
  if (!Array.isArray(raw)) throw new Error(`sélection territoriale invalide: ${path}`);
  const slugs = new Set<string>();
  const rows: JsonRecord[] = [];
  for (const [index, value] of raw.entries()) {
    if (!isRecord(value)) throw new Error(`${path}[${index}] invalide`);
    const slug = requiredString(value.slug, `${path}[${index}].slug`);
    if (slugs.has(slug)) throw new Error(`sélection territoriale dupliquée: ${slug}`);
    slugs.add(slug);
    rows.push(value);
  }
  return { path, rows, slugs };
}

function readCampaignGraphifyReports(): { readonly documents: Map<string, JsonRecord>; readonly paths: readonly string[] } {
  const names = listFiles(CAMPAIGN_REPORT, CAMPAIGN);
  if (names.length === 0) throw new Error("aucun rapport Graphify de campagne");
  const documents = new Map<string, JsonRecord>();
  for (const name of names) {
    const path = resolve(CAMPAIGN, name);
    const raw = readSmallJson(path);
    if (!isRecord(raw) || raw.contract !== "pv-graphify-semantic-control/v1" || !Array.isArray(raw.documents)) {
      throw new Error(`rapport Graphify campagne invalide: ${path}`);
    }
    for (const [index, value] of raw.documents.entries()) {
      if (!isRecord(value)) throw new Error(`${path}.documents[${index}] invalide`);
      const key = requiredString(value.storage_key, `${path}.documents[${index}].storage_key`);
      if (documents.has(key)) throw new Error(`CAS Graphify campagne dupliquée: ${key}`);
      documents.set(key, { ...value, __report: `work/coverage/pv-territorial-20260729t231834z/${name}` });
    }
  }
  return { documents, paths: names.map((name) => `work/coverage/pv-territorial-20260729t231834z/${name}`) };
}

function captureVerdict(line: CaptureLine, graphify: JsonRecord, reportPath: string): TerminalVerdict {
  const storageKey = requiredString(line.storage_key, "capture.storage_key");
  const slug = requiredString(line.slug, `${storageKey}.slug`);
  const municipalityName = requiredString(line.municipality_name, `${storageKey}.municipality_name`);
  const classification = requiredString(line.classification, `${storageKey}.classification`);
  const outcome = requiredString(graphify.outcome, `${storageKey}.outcome`);
  const ownerScope = isRecord(graphify.owner_scope) ? graphify.owner_scope : {};
  const printed = Array.isArray(ownerScope.printed_owner_slugs)
    ? ownerScope.printed_owner_slugs.filter((value): value is string => typeof value === "string")
    : [];
  return {
    storage_key: storageKey,
    slug,
    municipality_name: municipalityName,
    capture_classification: classification,
    indexed: outcome === "INDEXED",
    verdict: outcome,
    reason: outcome === "INDEXED"
      ? "Graphify indexé après garde de propriétaire imprimé et résolutions exactes."
      : requiredString(graphify.failure_reason ?? `Verdict Graphify: ${outcome}`, `${storageKey}.reason`),
    graphify_report: reportPath,
    printed_owner_slugs: printed,
  };
}

function nonGraphifyVerdict(line: CaptureLine, verdict: string, reason: string, html?: JsonRecord): TerminalVerdict {
  const storageKey = requiredString(line.storage_key, "capture.storage_key");
  const htmlPrinted = html?.printed_owner_slugs;
  return {
    storage_key: storageKey,
    slug: requiredString(line.slug, `${storageKey}.slug`),
    municipality_name: requiredString(line.municipality_name, `${storageKey}.municipality_name`),
    capture_classification: requiredString(line.classification, `${storageKey}.classification`),
    indexed: false,
    verdict,
    reason,
    ...(Array.isArray(htmlPrinted) ? { printed_owner_slugs: htmlPrinted.filter((value): value is string => typeof value === "string") } : {}),
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function main(): void {
  const wave2Paths = listFiles(WAVE2_CLASSIFICATION).map((name) => resolve(COVERAGE, name));
  const wave1Paths = listFiles(WAVE1_CLASSIFICATION).map((name) => resolve(COVERAGE, name));
  if (wave2Paths.length !== 6 || wave1Paths.length !== 6) throw new Error(`classifications incomplètes: vague 2=${wave2Paths.length}, vague 1=${wave1Paths.length}`);
  const wave2Lines = readCaptureLines(wave2Paths);
  const wave1Lines = readCaptureLines(wave1Paths);
  const wave2Durable = durableCasLines(wave2Lines, "vague 2");
  const wave1Durable = durableCasLines(wave1Lines, "vague 1");
  const graphify = readCampaignGraphifyReports();
  const htmlRaw = readSmallJson(resolve(COVERAGE, "pv-html-resource-audit-20260729t231834z.json"));
  if (!isRecord(htmlRaw) || !Array.isArray(htmlRaw.documents)) throw new Error("audit HTML invalide");
  const htmlByKey = new Map<string, JsonRecord>();
  for (const value of htmlRaw.documents) {
    if (!isRecord(value)) throw new Error("document audit HTML invalide");
    htmlByKey.set(requiredString(value.storage_key, "audit HTML.storage_key"), value);
  }

  const verdicts: TerminalVerdict[] = [];
  for (const line of wave2Durable) {
    const key = requiredString(line.storage_key, "vague 2.storage_key");
    const classification = requiredString(line.classification, `${key}.classification`);
    if (classification === "PV_LISIBLE_PROPRIETAIRE_CONFIRME") {
      const graphifyDocument = graphify.documents.get(key);
      if (graphifyDocument === undefined) throw new Error(`PV confirmé sans rapport Graphify: ${key}`);
      verdicts.push(captureVerdict(line, graphifyDocument, requiredString(graphifyDocument.__report, `${key}.__report`)));
      continue;
    }
    if (classification === "PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME") {
      verdicts.push(nonGraphifyVerdict(line, "OWNER_NOT_CONFIRMED", "Propriétaire imprimé non confirmé par le document; non indexé."));
      continue;
    }
    if (classification === "PDF_SANS_COUCHE_TEXTE") {
      verdicts.push(nonGraphifyVerdict(line, "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED", "Scan sans couche texte; réservé à la lane de lecture visuelle, sans OCR dans cette lane."));
      continue;
    }
    if (classification === "PAGE_HTML") {
      const html = htmlByKey.get(key);
      if (html === undefined) throw new Error(`HTML sans audit d’octets: ${key}`);
      const htmlVerdict = requiredString(html.verdict, `${key}.html_verdict`);
      verdicts.push(nonGraphifyVerdict(line, htmlVerdict, requiredString(html.reason, `${key}.html_reason`), html));
      continue;
    }
    if (classification === "DOCUMENT_LISIBLE_NON_PV") {
      verdicts.push(nonGraphifyVerdict(line, "DOCUMENT_LISIBLE_NON_PV", "Document lisible mais non-PV; non indexé."));
      continue;
    }
    if (classification === "AUTRE") {
      verdicts.push(nonGraphifyVerdict(line, "AUTRE_NON_INDEXE", "Classe AUTRE capturée; aucune assertion PV autorisée, non indexé."));
      continue;
    }
    throw new Error(`classification durable inattendue: ${classification}`);
  }
  if (verdicts.length !== 273 || new Set(verdicts.map((value) => value.storage_key)).size !== 273) {
    throw new Error(`verdicts durables inattendus: ${verdicts.length}`);
  }
  if (graphify.documents.size !== 213) throw new Error(`rapports Graphify inattendus: ${graphify.documents.size}/213`);

  const snapshotKeys = readSnapshotKeys(resolve(COVERAGE, "pv-graphify-semantic-real-universe-20260729-snapshot-01.json"));
  const historicalReports = readIndexedHistoricalReports(listFiles(REAL_BATCH_REPORT).map((name) => resolve(COVERAGE, name)));
  const wave1Keys = new Set(wave1Durable.map((line) => requiredString(line.storage_key, "vague 1.storage_key")));
  const wave2Keys = new Set(wave2Durable.map((line) => requiredString(line.storage_key, "vague 2.storage_key")));
  const dedupeSourceKeys = new Set([...snapshotKeys, ...historicalReports.keys, ...wave1Keys]);
  const collisionsWithWave1 = [...wave2Keys].filter((key) => wave1Keys.has(key)).sort();
  const collisionsWithAllSources = [...wave2Keys].filter((key) => dedupeSourceKeys.has(key)).sort();
  if (collisionsWithWave1.length !== 0 || collisionsWithAllSources.length !== 0) {
    throw new Error(`collision de dédoublage inattendue: vague 1=${collisionsWithWave1.length}, sources=${collisionsWithAllSources.length}`);
  }

  const zeroPvSelection = readZeroPvSelection();
  const newIndexedSlugs = new Set(verdicts.filter((value) => value.indexed).map((value) => value.slug));
  const zeroToOne = [...newIndexedSlugs].filter((slug) => zeroPvSelection.slugs.has(slug)).sort((left, right) => left.localeCompare(right));
  const absences = wave2Lines
    .filter((line) => typeof line.storage_key !== "string" || line.storage_key.length === 0)
    .map((line) => ({
      classification: requiredString(line.classification, "absence.classification"),
      slug: requiredString(line.slug, "absence.slug"),
      municipality_name: requiredString(line.municipality_name, "absence.municipality_name"),
      verdict: "NO_DURABLE_CAS_CAPTURED",
    }));
  const contaminations = verdicts.filter((value) => value.verdict === "CONTAMINATION_OWNER_MISMATCH");
  const scans = verdicts.filter((value) => value.capture_classification === "PDF_SANS_COUCHE_TEXTE").map((value) => value.storage_key).sort();

  const output = {
    contract: "pv-territorial-campaign-conversion/v1",
    campaign: "pv-territorial-20260729t231834z",
    generated_at: new Date().toISOString(),
    source_classifications: wave2Paths.map((path) => path.slice(ROOT.length + 1)),
    wave1_classifications: wave1Paths.map((path) => path.slice(ROOT.length + 1)),
    capture_attempts: {
      wave2_lines: wave2Lines.length,
      durable_cas_documents: wave2Durable.length,
      absent_attempts: absences.length,
      classification_counts: countBy(wave2Durable.map((line) => requiredString(line.classification, "vague 2.classification"))),
      absence_counts: countBy(absences.map((value) => value.classification)),
    },
    graphify: {
      reports: graphify.paths,
      documents_reported: graphify.documents.size,
      outcome_counts: countBy(verdicts.map((value) => value.verdict)),
      indexed_documents: verdicts.filter((value) => value.indexed).length,
      contaminations,
    },
    html_audit: {
      report: "work/coverage/pv-html-resource-audit-20260729t231834z.json",
      verdict_counts: isRecord(htmlRaw.verdict_counts) ? htmlRaw.verdict_counts : {},
      indexed_html_pv_documents: htmlByKey.size === 0 ? 0 : [...htmlByKey.values()].filter((value) => value.verdict === "HTML_PV_BODY").length,
    },
    deduplication: {
      snapshot_indexed_keys: snapshotKeys.size,
      historical_real_report_indexed_keys: historicalReports.keys.size,
      wave1_unique_cas_keys: wave1Keys.size,
      complete_source_union_keys: dedupeSourceKeys.size,
      wave2_unique_cas_keys: wave2Keys.size,
      collisions_avoided_with_wave1: collisionsWithWave1.length,
      collisions_with_complete_source_union: collisionsWithAllSources.length,
    },
    municipal_coverage: {
      zero_pv_selection: zeroPvSelection.path.slice(ROOT.length + 1),
      zero_pv_selection_rows: zeroPvSelection.rows.length,
      zero_pv_selection_unique_municipality_slugs: zeroPvSelection.slugs.size,
      newly_indexed_municipality_slugs: newIndexedSlugs.size,
      zero_to_at_least_one_pv: zeroToOne.length,
      zero_to_at_least_one_pv_slugs: zeroToOne,
    },
    scans_without_text_layer_cas_keys: scans,
    absences,
    document_verdicts: verdicts.sort((left, right) => left.storage_key.localeCompare(right.storage_key)),
  };
  const outputPath = resolve(CAMPAIGN, "pv-territorial-campaign-conversion-summary.json");
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    report: outputPath.slice(ROOT.length + 1),
    durable_cas_documents: wave2Durable.length,
    indexed_documents: output.graphify.indexed_documents,
    zero_to_at_least_one_pv: output.municipal_coverage.zero_to_at_least_one_pv,
    collisions_avoided_with_wave1: output.deduplication.collisions_avoided_with_wave1,
    scans: scans.length,
    contaminations: contaminations.length,
  }));
}

main();
