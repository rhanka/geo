/**
 * Read-only adversarial audit of the PV semantic graph reports.
 *
 * It deliberately consumes only the compact coverage reports plus the local
 * materialized `document.txt` inputs already produced by graphification.  It
 * never fetches, indexes, or writes captured/normalized data.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyRegulationLegalQuality } from "./lib/pv-graphify-semantic.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const DATE = "20260728";
const SUMMARY_PATH = resolve(COVERAGE, `pv-graphify-semantic-all-${DATE}-summary.json`);
const MAX_READ_BYTES = 5_000_000;
const SAMPLE_SEED = "pv-graphe-audit-adversarial/v1";

interface Citation {
  readonly source_file?: string;
  readonly source_location?: string;
  readonly quote?: string;
}

interface ReportEntity {
  readonly label: string;
  readonly legal_quality?: string;
  readonly citation: Citation;
}

interface GraphifyResult {
  readonly nodes: number | null;
  readonly edges: number | null;
  readonly exit_code: number;
}

interface DocumentReport {
  readonly slug: string;
  readonly municipality_name: string;
  readonly storage_key: string;
  readonly source_file: string;
  readonly entity_counts: Readonly<Record<string, number>>;
  readonly entities: Readonly<Record<string, readonly ReportEntity[]>>;
  readonly graphify: GraphifyResult;
}

interface BatchReport {
  readonly workspace: string;
  readonly documents: readonly DocumentReport[];
  readonly supersedes_storage_keys?: readonly string[];
}

interface Summary {
  readonly source_reports: readonly string[];
  readonly entity_counts: Readonly<Record<string, number>>;
  readonly zero_node_pvs: number;
}

interface MatchDetail {
  readonly municipality_slug: string;
  readonly storage_key: string;
  readonly entity_type: "Zone" | "LotCadastre";
  readonly value: string;
  readonly source_file: string;
  readonly source_location: string;
  readonly quote: string;
}

interface GazetteerZoneEntry {
  readonly municipality_slug: string;
  readonly codes: readonly string[];
}

interface GazetteerLotEntry {
  readonly municipality_slug: string;
  readonly lot_numbers: readonly string[];
}

interface GazetteerFile<T> {
  readonly municipalities: {
    readonly entries: readonly T[];
  };
}

interface MatchDetailFile {
  readonly details: readonly MatchDetail[];
}

interface LoadedDocument {
  readonly report_path: string;
  readonly workspace: string;
  readonly document: DocumentReport;
}

interface EntityRow {
  readonly document: LoadedDocument;
  readonly entity_type: string;
  readonly entity_index: number;
  readonly entity: ReportEntity;
}

interface CitationVerification {
  readonly source_path: string;
  readonly source_bytes: number;
  readonly source_location: string | null;
  readonly line_number: number | null;
  readonly citation_complete: boolean;
  readonly quote_matches_source_line: boolean;
  readonly reason: string | null;
}

interface OwnershipSample {
  readonly entity_type: "Zone" | "LotCadastre";
  readonly storage_key: string;
  readonly municipality_slug: string;
  readonly printed_municipality: string | null;
  readonly printed_municipality_quote: string | null;
  readonly value: string;
  readonly own_gazetteer_membership: boolean;
  readonly citation: CitationVerification;
}

interface EntitySample {
  readonly entity_type: string;
  readonly storage_key: string;
  readonly municipality_slug: string;
  readonly label: string;
  readonly citation: CitationVerification;
}

interface MeetingDateSample extends EntitySample {
  readonly label_is_verbatim_in_quote: boolean;
}

interface ZeroNodeFinding {
  readonly municipality_slug: string;
  readonly municipality_name: string;
  readonly storage_key: string;
  readonly source_path: string;
  readonly source_bytes: number;
  readonly source_lines: number;
  readonly nonempty_source_lines: number;
  readonly reason: "OWNER_CONTEXT_SPLIT_ACROSS_LINES" | "UNSUPPORTED_CITE_PREFIX" | "MUNICIPALITY_NAME_ABSENT_FROM_TEXT" | "OWNER_PATTERN_NOT_RECOGNIZED";
  readonly header_evidence: readonly { readonly line: number; readonly text: string }[];
}

function assertSmallFile(path: string): number {
  const bytes = statSync(path).size;
  if (bytes > MAX_READ_BYTES) {
    throw new Error(`refus de lire ${path}: ${bytes} octets > limite ${MAX_READ_BYTES}`);
  }
  return bytes;
}

function readJson<T>(path: string): T {
  assertSmallFile(path);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function stableSample<T>(rows: readonly T[], count: number, key: (value: T) => string): T[] {
  return [...rows]
    .sort((left, right) => {
      const leftHash = createHash("sha256").update(`${SAMPLE_SEED}\u0000${key(left)}`).digest("hex");
      const rightHash = createHash("sha256").update(`${SAMPLE_SEED}\u0000${key(right)}`).digest("hex");
      return leftHash.localeCompare(rightHash) || key(left).localeCompare(key(right));
    })
    .slice(0, Math.min(count, rows.length));
}

function sourcePathFor(document: LoadedDocument, sourceFile: string): string {
  if (!sourceFile || sourceFile.startsWith("/") || sourceFile.split(/[\\/]/u).includes("..")) {
    throw new Error(`source_file invalide: ${sourceFile}`);
  }
  return resolve(
    document.workspace,
    document.document.slug,
    document.document.storage_key.slice(-16),
    "input",
    sourceFile,
  );
}

const textCache = new Map<string, { readonly bytes: number; readonly lines: readonly string[] }>();

function sourceText(path: string): { readonly bytes: number; readonly lines: readonly string[] } {
  const cached = textCache.get(path);
  if (cached) return cached;
  const bytes = assertSmallFile(path);
  const loaded = { bytes, lines: readFileSync(path, "utf8").split(/\r?\n/gu) };
  textCache.set(path, loaded);
  return loaded;
}

function sourceLineNumber(sourceFile: string | undefined, location: string | undefined): number | null {
  if (!sourceFile || !location) return null;
  const prefix = `${sourceFile}:line:`;
  if (!location.startsWith(prefix)) return null;
  const value = location.slice(prefix.length);
  return /^\d+$/u.test(value) ? Number(value) : null;
}

function verifyCitation(document: LoadedDocument, citation: Citation): CitationVerification {
  const complete = Boolean(citation.source_file && citation.source_location && citation.quote !== undefined);
  if (!complete || !citation.source_file) {
    return {
      source_path: "",
      source_bytes: 0,
      source_location: citation.source_location ?? null,
      line_number: null,
      citation_complete: false,
      quote_matches_source_line: false,
      reason: "citation manquante",
    };
  }
  const path = sourcePathFor(document, citation.source_file);
  const source = sourceText(path);
  const lineNumber = sourceLineNumber(citation.source_file, citation.source_location);
  if (lineNumber === null || lineNumber < 1 || lineNumber > source.lines.length) {
    return {
      source_path: path,
      source_bytes: source.bytes,
      source_location: citation.source_location ?? null,
      line_number: lineNumber,
      citation_complete: true,
      quote_matches_source_line: false,
      reason: "localisation de ligne invalide",
    };
  }
  const quoteMatches = source.lines[lineNumber - 1] === citation.quote;
  return {
    source_path: path,
    source_bytes: source.bytes,
    source_location: citation.source_location ?? null,
    line_number: lineNumber,
    citation_complete: true,
    quote_matches_source_line: quoteMatches,
    reason: quoteMatches ? null : "citation différente de la ligne source",
  };
}

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("fr-CA")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function normalizedZoneCode(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleUpperCase("fr-CA")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s*([./-])\s*/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizedLotNumber(value: string): string {
  return value.replace(/\D/gu, "");
}

function zeroNodeReason(municipalityName: string, lines: readonly string[]): ZeroNodeFinding["reason"] {
  const owner = normalized(municipalityName);
  const normalizedLines = lines.map(normalized);
  if (normalizedLines.some((line) => line.includes(`cite de ${owner}`))) return "UNSUPPORTED_CITE_PREFIX";
  const headerPairs = normalizedLines.slice(0, 80).flatMap((line, index) => index === 0 ? [] : [`${normalizedLines[index - 1]} ${line}`]);
  if (headerPairs.some((line) => line.includes(owner) && /\b(?:municipalite|municipality|ville|conseil)\b/u.test(line))) {
    return "OWNER_CONTEXT_SPLIT_ACROSS_LINES";
  }
  const whole = normalized(lines.join(" "));
  if (!whole.includes(owner)) return "MUNICIPALITY_NAME_ABSENT_FROM_TEXT";
  if (!normalizedLines.some((line) => line.includes(owner))) return "OWNER_CONTEXT_SPLIT_ACROSS_LINES";
  return "OWNER_PATTERN_NOT_RECOGNIZED";
}

function headerEvidence(lines: readonly string[]): Array<{ readonly line: number; readonly text: string }> {
  return lines
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text, line }) => line <= 100 && text.trim().length > 0)
    .filter(({ text }) => /(municipalit|ville|cité|cite|conseil|council|town|city|mairie|mrc)/iu.test(text))
    .slice(0, 4);
}

function reportSibling(reportPath: string, suffix: string): string {
  return reportPath.replace(/\.json$/u, suffix);
}

function markdown(report: Record<string, unknown>): string {
  const ownership = report.ownership_audit as { readonly zones: { readonly passed: number; readonly sample_size: number }; readonly lots: { readonly passed: number; readonly sample_size: number }; readonly outside_municipality: readonly unknown[] };
  const citations = report.citation_relocalization as { readonly passed: number; readonly sample_size: number; readonly failures: readonly unknown[] };
  const dates = report.meeting_date_verbatim as { readonly passed: number; readonly sample_size: number; readonly failures: readonly unknown[] };
  const regulations = report.regulation_legal_quality as { readonly total: number; readonly with_legal_quality: number; readonly silent: number; readonly rejected_pdf_anchors: readonly unknown[]; readonly unsafe_non_adopted_as_adopted: readonly { readonly municipality_slug: string; readonly label: string; readonly quote: string; readonly citation: CitationVerification }[]; readonly stale_reported_non_adopted_as_adopted: readonly unknown[]; readonly quality_distribution: Readonly<Record<string, number>>; readonly replay_partition: Readonly<Record<string, number>> };
  const zero = report.zero_node_documents as { readonly total: number; readonly findings: readonly ZeroNodeFinding[] };
  const zeroLines = zero.findings.map((finding) => `- \`${finding.municipality_slug}\` · \`${finding.storage_key}\` — ${finding.reason}`).join("\n");
  const zeroSummary = zero.total === 0 ? "aucun texte muet" : `textes présents et non vides dans les ${zero.total} cas`;
  const regulationLines = regulations.unsafe_non_adopted_as_adopted.length === 0
    ? "Aucun."
    : regulations.unsafe_non_adopted_as_adopted.map((finding) => `- \`${finding.municipality_slug}\` · ${finding.label} · ${finding.citation.source_location}: « ${finding.quote} »`).join("\n");
  return `# Audit adversarial du graphe PV\n\n`
    + `Généré en UTC: ${report.generated_at}\n\n`
    + `- Appariements municipaux: Zones ${ownership.zones.passed}/${ownership.zones.sample_size}; lots ${ownership.lots.passed}/${ownership.lots.sample_size}; hors municipalité: ${ownership.outside_municipality.length}.\n`
    + `- Citations relocalisables: ${citations.passed}/${citations.sample_size}; échecs: ${citations.failures.length}. Dates verbatim: ${dates.passed}/${dates.sample_size}; échecs: ${dates.failures.length}.\n`
    + `- Regulations: qualité juridique ${regulations.with_legal_quality}/${regulations.total}; muettes: ${regulations.silent}; partition de replay: ${Object.entries(regulations.replay_partition).map(([key, value]) => `${key}=${value}`).join(", ")}; non-adopté marqué ADOPTE au replay: ${regulations.unsafe_non_adopted_as_adopted.length}; étiquettes historiques à régénérer: ${regulations.stale_reported_non_adopted_as_adopted.length}.\n`
    + `- Documents muets: ${zero.total}; ${zeroSummary}.\n\n`
    + `## Documents muets\n\n${zeroLines}\n`
    + `\n## Signaux réglementaires à corriger\n\n${regulationLines}\n`;
}

function main(): void {
  const summary = readJson<Summary>(SUMMARY_PATH);
  const loadedDocumentsByStorage = new Map<string, LoadedDocument>();
  const zoneGazetteers = new Map<string, Set<string>>();
  const lotGazetteers = new Map<string, Set<string>>();
  const details: MatchDetail[] = [];

  for (const reportPath of summary.source_reports) {
    const batch = readJson<BatchReport>(resolve(ROOT, reportPath));
    const supersedes = new Set(batch.supersedes_storage_keys ?? []);
    const documentKeys = new Set<string>();
    for (const document of batch.documents) {
      documentKeys.add(document.storage_key);
      if (loadedDocumentsByStorage.has(document.storage_key) && !supersedes.has(document.storage_key)) {
        throw new Error(`PV indexé deux fois dans les rapports Graphify: ${document.storage_key}`);
      }
      loadedDocumentsByStorage.set(document.storage_key, { report_path: reportPath, workspace: batch.workspace, document });
    }
    for (const storageKey of supersedes) {
      if (!documentKeys.has(storageKey)) throw new Error(`${reportPath}.supersedes_storage_keys référence un document absent du rapport: ${storageKey}`);
    }
    const hasZoneOrLot = batch.documents.some((document) => (document.entity_counts.Zone ?? 0) > 0 || (document.entity_counts.LotCadastre ?? 0) > 0);
    if (!hasZoneOrLot) continue;
    const zonePath = reportSibling(resolve(ROOT, reportPath), "-gazetteer-zones.json");
    const lotPath = reportSibling(resolve(ROOT, reportPath), "-gazetteer-lots.json");
    const detailPath = reportSibling(resolve(ROOT, reportPath), "-match-details.json");
    if (!existsSync(zonePath) || !existsSync(lotPath) || !existsSync(detailPath)) {
      throw new Error(`preuves d'appariement absentes pour ${reportPath}`);
    }
    const zoneFile = readJson<GazetteerFile<GazetteerZoneEntry>>(zonePath);
    const lotFile = readJson<GazetteerFile<GazetteerLotEntry>>(lotPath);
    const detailFile = readJson<MatchDetailFile>(detailPath);
    for (const entry of zoneFile.municipalities.entries) {
      zoneGazetteers.set(entry.municipality_slug, new Set(entry.codes.map(normalizedZoneCode)));
    }
    for (const entry of lotFile.municipalities.entries) {
      lotGazetteers.set(entry.municipality_slug, new Set(entry.lot_numbers.map(normalizedLotNumber)));
    }
    details.push(...detailFile.details);
  }

  const loadedDocuments = [...loadedDocumentsByStorage.values()];
  const documentByStorage = new Map(loadedDocuments.map((document) => [document.document.storage_key, document]));
  const auditOwnership = (entityType: "Zone" | "LotCadastre", sampleSize: number): { readonly sample: OwnershipSample[]; readonly outside: OwnershipSample[] } => {
    const candidates = details.filter((detail) => detail.entity_type === entityType);
    const sample = stableSample(candidates, sampleSize, (detail) => `${detail.storage_key}\u0000${detail.value}\u0000${detail.source_location}`)
      .map((detail): OwnershipSample => {
        const document = documentByStorage.get(detail.storage_key);
        if (!document) throw new Error(`document absent pour ${detail.storage_key}`);
        const printed = document.document.entities.Municipality?.[0];
        const citation = verifyCitation(document, {
          source_file: detail.source_file,
          source_location: detail.source_location,
          quote: detail.quote,
        });
        if (!printed) throw new Error(`municipalité imprimée absente pour ${detail.storage_key}`);
        const printedCitation = verifyCitation(document, printed.citation);
        if (!printedCitation.quote_matches_source_line) throw new Error(`municipalité non relocalisable pour ${detail.storage_key}`);
        const gazetteer = entityType === "Zone" ? zoneGazetteers.get(detail.municipality_slug) : lotGazetteers.get(detail.municipality_slug);
        return {
          entity_type: entityType,
          storage_key: detail.storage_key,
          municipality_slug: detail.municipality_slug,
          printed_municipality: printed.label,
          printed_municipality_quote: printed.citation.quote ?? null,
          value: detail.value,
          own_gazetteer_membership: gazetteer?.has(entityType === "Zone" ? normalizedZoneCode(detail.value) : normalizedLotNumber(detail.value)) ?? false,
          citation,
        };
      });
    return { sample, outside: sample.filter((entry) => !entry.own_gazetteer_membership) };
  };

  const zones = auditOwnership("Zone", 30);
  const lots = auditOwnership("LotCadastre", 20);
  const generatedAt = new Date().toISOString();
  const utc = generatedAt.replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
  const outputJson = resolve(COVERAGE, `pv-graphe-audit-adversarial-${utc}.json`);
  const outputMarkdown = outputJson.replace(/\.json$/u, ".md");

  if (zones.outside.length > 0 || lots.outside.length > 0) {
    const critical = {
      contract: "pv-graphe-audit-adversarial/v1",
      generated_at: generatedAt,
      stopped_after_critical_ownership_failure: true,
      ownership_audit: {
        zones: { population: details.filter((detail) => detail.entity_type === "Zone").length, sample_size: zones.sample.length, passed: zones.sample.length - zones.outside.length, sample: zones.sample },
        lots: { population: details.filter((detail) => detail.entity_type === "LotCadastre").length, sample_size: lots.sample.length, passed: lots.sample.length - lots.outside.length, sample: lots.sample },
        outside_municipality: [...zones.outside, ...lots.outside],
      },
    };
    writeAtomic(outputJson, critical);
    writeFileSync(outputMarkdown, "# Audit adversarial du graphe PV\n\nARRÊT: appariement Zone/Lot hors municipalité détecté. Voir le JSON.\n", "utf8");
    process.exitCode = 2;
    return;
  }

  const entities: EntityRow[] = [];
  const reportedCounts: Record<string, number> = {};
  for (const document of loadedDocuments) {
    for (const [entityType, values] of Object.entries(document.document.entities)) {
      values.forEach((entity, entityIndex) => {
        entities.push({ document, entity_type: entityType, entity_index: entityIndex, entity });
        reportedCounts[entityType] = (reportedCounts[entityType] ?? 0) + 1;
      });
    }
  }
  const entitySample = stableSample(entities, 30, (row) => `${row.document.document.storage_key}\u0000${row.entity_type}\u0000${row.entity_index}`)
    .map((row): EntitySample => ({
      entity_type: row.entity_type,
      storage_key: row.document.document.storage_key,
      municipality_slug: row.document.document.slug,
      label: row.entity.label,
      citation: verifyCitation(row.document, row.entity.citation),
    }));
  const citationFailures = entitySample.filter((entry) => !entry.citation.citation_complete || !entry.citation.quote_matches_source_line);

  const dates = entities.filter((row) => row.entity_type === "MeetingDate");
  const dateSample = stableSample(dates, 20, (row) => `${row.document.document.storage_key}\u0000${row.entity.label}`)
    .map((row): MeetingDateSample => ({
      entity_type: row.entity_type,
      storage_key: row.document.document.storage_key,
      municipality_slug: row.document.document.slug,
      label: row.entity.label,
      label_is_verbatim_in_quote: Boolean(row.entity.citation.quote?.includes(row.entity.label)),
      citation: verifyCitation(row.document, row.entity.citation),
    }));
  const dateFailures = dateSample.filter((entry) => !entry.label_is_verbatim_in_quote || !entry.citation.quote_matches_source_line);

  const regulations = entities.filter((row) => row.entity_type === "Regulation");
  const validQualities = new Set(["ADOPTE", "PROJET", "PREMIER_PROJET", "SECOND_PROJET", "AVIS_DE_MOTION", "ADOPTION_MENTIONNEE", "AVIS_APPROBATION_REFERENDAIRE", "DEPOT_CERTIFICAT", "CERTIFICAT_CONFORMITE", "ENTREE_EN_VIGUEUR", "VERSION_ADMINISTRATIVE", "CODIFICATION", "INCONNUE"]);
  const qualityDistribution: Record<string, number> = {};
  const silentRegulations: EntityRow[] = [];
  const invalidRegulationQualities: EntityRow[] = [];
  const rejectedPdfAnchors: Array<{ readonly storage_key: string; readonly municipality_slug: string; readonly label: string; readonly quote: string; readonly reason: string }> = [];
  const requalifiedRegulations: Array<{ readonly storage_key: string; readonly municipality_slug: string; readonly label: string; readonly reported_legal_quality: string | null; readonly replayed_legal_quality: string }> = [];
  const unsafeRegulations: Array<{ readonly storage_key: string; readonly municipality_slug: string; readonly label: string; readonly legal_quality: string; readonly quote: string; readonly citation: CitationVerification }> = [];
  const staleReportedUnsafeRegulations: Array<{ readonly storage_key: string; readonly municipality_slug: string; readonly label: string; readonly legal_quality: string; readonly quote: string; readonly citation: CitationVerification }> = [];
  for (const regulation of regulations) {
    const reportedQuality = regulation.entity.legal_quality ?? null;
    const source = sourceText(sourcePathFor(regulation.document, regulation.document.document.source_file));
    let quality: string;
    try {
      quality = classifyRegulationLegalQuality(source.lines.join("\n"), regulation.entity.label);
    } catch (error: unknown) {
      rejectedPdfAnchors.push({
        storage_key: regulation.document.document.storage_key,
        municipality_slug: regulation.document.document.slug,
        label: regulation.entity.label,
        quote: regulation.entity.citation.quote ?? "",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!reportedQuality) silentRegulations.push(regulation);
    qualityDistribution[quality] = (qualityDistribution[quality] ?? 0) + 1;
    if (!validQualities.has(quality)) invalidRegulationQualities.push(regulation);
    if (reportedQuality !== quality) {
      requalifiedRegulations.push({
        storage_key: regulation.document.document.storage_key,
        municipality_slug: regulation.document.document.slug,
        label: regulation.entity.label,
        reported_legal_quality: reportedQuality,
        replayed_legal_quality: quality,
      });
    }
    const clause = regulation.entity.citation.quote ?? "";
    const quote = normalized(clause);
    const nonAdoptedContext = /\b(?:premier|1er|1e|1eme|second|deuxieme|2e|2eme) projet\b|\bprojet de\b|\bavis (?:d approbation referendaire|de motion)\b|\b(?:version administrative|codification|depot (?:d un |du |d )?certificat|certificat de conformite|entree en vigueur|en vigueur)\b/u.test(quote);
    const clauseQuality = classifyRegulationLegalQuality(clause, regulation.entity.label);
    if (clauseQuality === "ADOPTE" && nonAdoptedContext) {
      unsafeRegulations.push({
        storage_key: regulation.document.document.storage_key,
        municipality_slug: regulation.document.document.slug,
        label: regulation.entity.label,
        legal_quality: clauseQuality,
        quote: regulation.entity.citation.quote ?? "",
        citation: verifyCitation(regulation.document, regulation.entity.citation),
      });
    }
    if (reportedQuality === "ADOPTE" && nonAdoptedContext) {
      staleReportedUnsafeRegulations.push({
        storage_key: regulation.document.document.storage_key,
        municipality_slug: regulation.document.document.slug,
        label: regulation.entity.label,
        legal_quality: reportedQuality,
        quote: regulation.entity.citation.quote ?? "",
        citation: verifyCitation(regulation.document, regulation.entity.citation),
      });
    }
  }

  const replayPartition = {
    ...qualityDistribution,
    ANCRE_PDF_REJETEE: rejectedPdfAnchors.length,
  };
  const replayPartitionTotal = Object.values(replayPartition).reduce((total, count) => total + count, 0);
  if (replayPartitionTotal !== regulations.length) {
    throw new Error(`partition de replay réglementaire incomplète: ${replayPartitionTotal}/${regulations.length}`);
  }

  const zeroNodeDocuments = loadedDocuments.filter((document) => (document.document.graphify.nodes ?? 0) === 0)
    .map((document): ZeroNodeFinding => {
      const sourcePath = sourcePathFor(document, document.document.source_file);
      const source = sourceText(sourcePath);
      return {
        municipality_slug: document.document.slug,
        municipality_name: document.document.municipality_name,
        storage_key: document.document.storage_key,
        source_path: sourcePath,
        source_bytes: source.bytes,
        source_lines: source.lines.length,
        nonempty_source_lines: source.lines.filter((line) => line.trim().length > 0).length,
        reason: zeroNodeReason(document.document.municipality_name, source.lines),
        header_evidence: headerEvidence(source.lines),
      };
    });

  const structuralCitationGap = Object.entries(summary.entity_counts)
    .filter(([entityType, count]) => (reportedCounts[entityType] ?? 0) !== count)
    .map(([entityType, count]) => ({ entity_type: entityType, summary_count: count, report_entity_count: reportedCounts[entityType] ?? 0 }));
  const missingCitationMetadata = entities.filter((row) => !row.entity.citation.source_file || !row.entity.citation.source_location || row.entity.citation.quote === undefined).length;
  const report = {
    contract: "pv-graphe-audit-adversarial/v1",
    generated_at: generatedAt,
    mode: "read-only",
    input: {
      summary: `work/coverage/pv-graphify-semantic-all-${DATE}-summary.json`,
      source_reports: summary.source_reports,
      maximum_read_bytes: MAX_READ_BYTES,
      deterministic_sampling: `sha256(${SAMPLE_SEED} + stable entity key)`,
    },
    population: {
      documents: loadedDocuments.length,
      entity_counts: summary.entity_counts,
      zero_node_documents: summary.zero_node_pvs,
    },
    ownership_audit: {
      zones: { population: details.filter((detail) => detail.entity_type === "Zone").length, sample_size: zones.sample.length, passed: zones.sample.length, sample: zones.sample },
      lots: { population: details.filter((detail) => detail.entity_type === "LotCadastre").length, sample_size: lots.sample.length, passed: lots.sample.length, sample: lots.sample },
      outside_municipality: [],
    },
    citation_relocalization: {
      population: entities.length,
      sample_size: entitySample.length,
      passed: entitySample.length - citationFailures.length,
      failures: citationFailures,
      structural_count_gap: structuralCitationGap,
      missing_citation_metadata: missingCitationMetadata,
      sample: entitySample,
    },
    meeting_date_verbatim: {
      population: dates.length,
      sample_size: dateSample.length,
      passed: dateSample.length - dateFailures.length,
      failures: dateFailures,
      sample: dateSample,
    },
    regulation_legal_quality: {
      total: regulations.length,
      with_legal_quality: regulations.length - silentRegulations.length - rejectedPdfAnchors.length,
      silent: silentRegulations.length,
      rejected_pdf_anchors: rejectedPdfAnchors,
      invalid_quality_values: invalidRegulationQualities.map((row) => ({ storage_key: row.document.document.storage_key, municipality_slug: row.document.document.slug, label: row.entity.label, legal_quality: row.entity.legal_quality ?? null })),
      quality_distribution: qualityDistribution,
      replay_partition: replayPartition,
      requalified_from_report: requalifiedRegulations,
      unsafe_non_adopted_as_adopted: unsafeRegulations,
      stale_reported_non_adopted_as_adopted: staleReportedUnsafeRegulations,
    },
    zero_node_documents: {
      total: zeroNodeDocuments.length,
      findings: zeroNodeDocuments,
    },
    stopped_after_critical_ownership_failure: false,
  };
  writeAtomic(outputJson, report);
  writeFileSync(outputMarkdown, markdown(report), "utf8");
  console.log(JSON.stringify({ json: outputJson.slice(ROOT.length + 1), markdown: outputMarkdown.slice(ROOT.length + 1) }));
}

main();
