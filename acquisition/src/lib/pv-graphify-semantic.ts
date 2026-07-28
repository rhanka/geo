import { createHash } from "node:crypto";

/**
 * Deterministic, source-grounded semantic fragment for a municipal council
 * minute.  This is deliberately a small subset of Graphify's public
 * Extraction JSON: it contains only assertions we can point back to a
 * verbatim source line for.
 */

export type GraphifyConfidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export interface GraphifyCitation {
  readonly source_file: string;
  readonly source_url?: string;
  readonly source_location: string;
  readonly quote: string;
  readonly confidence: "EXTRACTED";
}

export interface GraphifySemanticNode {
  readonly id: string;
  readonly label: string;
  readonly file_type: "document";
  readonly source_file: string;
  readonly source_location: string;
  readonly confidence: "EXTRACTED";
  readonly node_type: string;
  readonly citations: readonly GraphifyCitation[];
  readonly registry_id?: string;
  readonly aliases?: readonly string[];
  readonly resolution_number?: string;
  readonly regulation_number?: string;
  readonly zone_code?: string;
  readonly lot_number?: string;
  readonly legal_quality?: RegulationLegalQuality;
}

export interface GraphifySemanticEdge {
  readonly source: string;
  readonly target: string;
  readonly relation: string;
  readonly confidence: GraphifyConfidence;
  readonly source_file: string;
  readonly source_location: string;
  readonly citations: readonly GraphifyCitation[];
}

/** Exact JSON shape accepted by `graphify extract --semantic`. */
export interface GraphifySemanticExtraction {
  readonly nodes: readonly GraphifySemanticNode[];
  readonly edges: readonly GraphifySemanticEdge[];
  readonly hyperedges: readonly [];
  readonly input_tokens: 0;
  readonly output_tokens: 0;
}

export interface MunicipalityGazetteerEntry {
  readonly slug: string;
  readonly name: string;
}

/** Zone codes are intentionally scoped to one served municipality. */
export interface MunicipalZoneGazetteer {
  readonly municipality_slug: string;
  readonly codes: readonly string[];
}

/** Lots are opt-in: no cadastral number is emitted without this closed set. */
export interface MunicipalLotGazetteer {
  readonly municipality_slug: string;
  readonly lot_numbers: readonly string[];
}

export interface PvSemanticDocument {
  /** Relative text file path as seen by the Graphify input directory. */
  readonly source_file: string;
  /** Stable source identity, usually the immutable captured-object key. */
  readonly source_id?: string;
  readonly source_url?: string;
  readonly municipality_slug: string;
  readonly text: string;
}

export type RegulationLegalQuality =
  | "ADOPTE"
  | "PROJET"
  | "PREMIER_PROJET"
  | "SECOND_PROJET"
  | "AVIS_APPROBATION_REFERENDAIRE"
  | "VERSION_ADMINISTRATIVE"
  | "CODIFICATION"
  | "INCONNUE";

interface SourceLine {
  readonly number: number;
  readonly text: string;
}

interface DateEvidence {
  readonly line: SourceLine;
  readonly verbatim: string;
}

interface ResolutionEvidence {
  readonly line: SourceLine;
  readonly verbatim: string;
}

interface RegulationEvidence {
  readonly line: SourceLine;
  readonly verbatim: string;
  readonly quality: RegulationLegalQuality;
}

function stableId(kind: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${kind}:${digest}`;
}

function normalizeWords(value: string): string {
  return ` ${value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("fr-CA")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()} `;
}

function normalizeCode(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleUpperCase("fr-CA")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s*([./-])\s*/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sourceLines(text: string): SourceLine[] {
  return text.split(/\r?\n/gu).map((line, index) => ({ number: index + 1, text: line }));
}

function citation(document: PvSemanticDocument, line: SourceLine): GraphifyCitation {
  return {
    source_file: document.source_file,
    ...(document.source_url ? { source_url: document.source_url } : {}),
    source_location: `${document.source_file}:line:${line.number}`,
    quote: line.text,
    confidence: "EXTRACTED",
  };
}

function node(
  id: string,
  label: string,
  nodeType: string,
  document: PvSemanticDocument,
  line: SourceLine,
  extra: Omit<GraphifySemanticNode, "id" | "label" | "file_type" | "source_file" | "source_location" | "confidence" | "node_type" | "citations"> = {},
): GraphifySemanticNode {
  return {
    id,
    label,
    file_type: "document",
    source_file: document.source_file,
    source_location: `${document.source_file}:line:${line.number}`,
    confidence: "EXTRACTED",
    node_type: nodeType,
    citations: [citation(document, line)],
    ...extra,
  };
}

function edge(
  source: string,
  target: string,
  relation: string,
  document: PvSemanticDocument,
  line: SourceLine,
): GraphifySemanticEdge {
  return {
    source,
    target,
    relation,
    confidence: "EXTRACTED",
    source_file: document.source_file,
    source_location: `${document.source_file}:line:${line.number}`,
    citations: [citation(document, line)],
  };
}

function assertRelativeSourceFile(sourceFile: string): void {
  if (!sourceFile || sourceFile.startsWith("/") || sourceFile.split(/[\\/]/u).includes("..")) {
    throw new Error(`source_file doit être relatif et relocalisable: ${sourceFile}`);
  }
}

function scopedMunicipality(
  entries: readonly MunicipalityGazetteerEntry[],
  slug: string,
): MunicipalityGazetteerEntry {
  const matches = entries.filter((entry) => entry.slug === slug);
  if (matches.length !== 1) {
    throw new Error(`gazetteer municipal fermé invalide pour ${slug}: ${matches.length} entrée(s)`);
  }
  return matches[0]!;
}

function isPrintedMunicipalityOwner(line: SourceLine, officialName: string): boolean {
  const canonicalName = normalizeWords(officialName);
  if (canonicalName === "  ") return false;
  const canonicalLine = normalizeWords(line.text);
  if (!canonicalLine.includes(canonicalName)) return false;
  return / (?:municipalite|ville|village|canton|paroisse|conseil\s+(?:municipal|de)) /u.test(canonicalLine);
}

function firstMunicipalityEvidence(lines: readonly SourceLine[], officialName: string): SourceLine | null {
  return lines.find((line) => isPrintedMunicipalityOwner(line, officialName)) ?? null;
}

const MONTH = "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre";
const FRENCH_DATE = new RegExp(`\\b(?:le|du|en date du)\\s+(\\d{1,2}(?:er|e|ème)?\\s+(?:${MONTH})\\s+\\d{4})\\b`, "iu");
const ISO_DATE = /\b(\d{4}[/-]\d{2}[/-]\d{2})\b/u;
const NUMERIC_DATE = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/u;

function dates(lines: readonly SourceLine[]): DateEvidence[] {
  const found: DateEvidence[] = [];
  for (const line of lines) {
    const match = FRENCH_DATE.exec(line.text) ?? ISO_DATE.exec(line.text) ?? NUMERIC_DATE.exec(line.text);
    if (match?.[1]) found.push({ line, verbatim: match[1] });
  }
  return found;
}

function isCouncilSessionMarker(line: SourceLine): boolean {
  return /\b(?:proc[eè]s[\s-]*verbal|s[ée]ance|session)\b/iu.test(line.text)
    && /\bconseil\b/iu.test(line.text);
}

function sessionEvidence(lines: readonly SourceLine[]): { marker: SourceLine; date: DateEvidence } | null {
  const markers = lines.filter(isCouncilSessionMarker);
  const candidates = dates(lines);
  let selected: { marker: SourceLine; date: DateEvidence; distance: number } | null = null;
  for (const marker of markers) {
    for (const date of candidates) {
      const distance = Math.abs(marker.number - date.line.number);
      if (distance > 3) continue;
      if (selected === null || distance < selected.distance || (distance === selected.distance && date.line.number < selected.date.line.number)) {
        selected = { marker, date, distance };
      }
    }
  }
  return selected ? { marker: selected.marker, date: selected.date } : null;
}

const RESOLUTION_REFERENCE = /\br[ée]solutions?\s*(?:num[ée]ros?|n[°o])?\s*([A-Z]{0,5}\s*\d{1,6}(?:\s*[./-]\s*\d{1,6}){1,3})/giu;

function resolutionEvidence(lines: readonly SourceLine[]): ResolutionEvidence[] {
  const found: ResolutionEvidence[] = [];
  for (const line of lines) {
    for (const match of line.text.matchAll(RESOLUTION_REFERENCE)) {
      const verbatim = match[1]?.trim();
      if (verbatim) found.push({ line, verbatim });
    }
  }
  return found;
}

const REGULATION_REFERENCE = /\br[èe]glement\s*(?:n(?:um[ée]ro)?[°o]?\s*)?([A-Z]{0,5}\s*\d{1,6}(?:\s*[./-]\s*\d{1,6}){0,3})/giu;

function regulationQuality(line: string, regulationOffset: number): RegulationLegalQuality {
  const before = normalizeWords(line.slice(Math.max(0, regulationOffset - 100), regulationOffset));
  if (/\badoption du $/u.test(before)) return "ADOPTE";
  if (/\bpremier projet de $/u.test(before)) return "PREMIER_PROJET";
  if (/\bsecond projet de $/u.test(before)) return "SECOND_PROJET";
  if (/\bprojet de $/u.test(before)) return "PROJET";
  if (/\bavis d approbation referendaire (?:du )?$/u.test(before)) return "AVIS_APPROBATION_REFERENDAIRE";
  if (/\bversion administrative du $/u.test(before)) return "VERSION_ADMINISTRATIVE";
  if (/\bcodification du $/u.test(before)) return "CODIFICATION";
  return "INCONNUE";
}

function regulationEvidence(lines: readonly SourceLine[]): RegulationEvidence[] {
  const found: RegulationEvidence[] = [];
  for (const line of lines) {
    for (const match of line.text.matchAll(REGULATION_REFERENCE)) {
      const verbatim = match[1]?.trim();
      const offset = match.index ?? -1;
      if (verbatim && offset >= 0) {
        found.push({ line, verbatim, quality: regulationQuality(line.text, offset) });
      }
    }
  }
  return found;
}

function zonePattern(code: string): RegExp {
  const parts = normalizeCode(code)
    .split(/([./-])/u)
    .map((part) => {
      if (part === "-") return "\\s*[-‐‑‒–—―]\\s*";
      if (part === "." || part === "/") return `\\s*${escapeRegex(part)}\\s*`;
      return escapeRegex(part).replace(/\s+/gu, "\\s+");
    });
  return new RegExp(`(?<![A-Z0-9])${parts.join("")}(?![A-Z0-9])`, "giu");
}

function zoneEvidence(lines: readonly SourceLine[], gazetteer: MunicipalZoneGazetteer): Array<{ line: SourceLine; code: string }> {
  const found: Array<{ line: SourceLine; code: string }> = [];
  const codes = [...new Set(gazetteer.codes.map(normalizeCode).filter(Boolean))].sort((left, right) => right.length - left.length || left.localeCompare(right));
  for (const line of lines) {
    if (!/\bzones?\b/iu.test(line.text)) continue;
    for (const code of codes) {
      if (zonePattern(code).test(line.text)) found.push({ line, code });
    }
  }
  return found;
}

function lotEvidence(lines: readonly SourceLine[], gazetteer: MunicipalLotGazetteer): Array<{ line: SourceLine; lot: string }> {
  const found: Array<{ line: SourceLine; lot: string }> = [];
  const lots = new Map(
    gazetteer.lot_numbers.map((lot) => [lot.replace(/\D/gu, ""), lot]),
  );
  for (const line of lines) {
    if (!/\blots?\b/iu.test(line.text)) continue;
    for (const match of line.text.matchAll(/\b(?:lot|lots)\s+(?:n[°o]\s*)?((?:\d[ .-]?){6,9}\d)\b/giu)) {
      const verbatim = match[1]?.trim();
      if (!verbatim) continue;
      const lot = lots.get(verbatim.replace(/\D/gu, ""));
      if (lot) found.push({ line, lot });
    }
  }
  return found;
}

function dedupeNodes(nodes: readonly GraphifySemanticNode[]): GraphifySemanticNode[] {
  const byId = new Map<string, GraphifySemanticNode>();
  for (const current of nodes) {
    const previous = byId.get(current.id);
    if (!previous) {
      byId.set(current.id, current);
      continue;
    }
    const citations = [...previous.citations, ...current.citations];
    byId.set(current.id, { ...previous, citations });
  }
  return [...byId.values()];
}

function dedupeEdges(edges: readonly GraphifySemanticEdge[]): GraphifySemanticEdge[] {
  const byKey = new Map<string, GraphifySemanticEdge>();
  for (const current of edges) {
    const key = `${current.source}\u0000${current.target}\u0000${current.relation}\u0000${current.source_location}`;
    byKey.set(key, current);
  }
  return [...byKey.values()];
}

/**
 * Produces a Graphify extraction fragment without probabilistic matching.
 * Municipality, zones and lots are accepted only through the closed registry
 * passed for this document; none of the lookups consult another municipality.
 */
export function extractPvSemantic(
  document: PvSemanticDocument,
  municipalities: readonly MunicipalityGazetteerEntry[],
  zoneGazetteer?: MunicipalZoneGazetteer,
  lotGazetteer?: MunicipalLotGazetteer,
): GraphifySemanticExtraction {
  assertRelativeSourceFile(document.source_file);
  if (zoneGazetteer && zoneGazetteer.municipality_slug !== document.municipality_slug) {
    throw new Error(`gazetteer de zones hors scope: ${zoneGazetteer.municipality_slug} pour ${document.municipality_slug}`);
  }
  if (lotGazetteer && lotGazetteer.municipality_slug !== document.municipality_slug) {
    throw new Error(`gazetteer cadastral hors scope: ${lotGazetteer.municipality_slug} pour ${document.municipality_slug}`);
  }

  const municipality = scopedMunicipality(municipalities, document.municipality_slug);
  const lines = sourceLines(document.text);
  const owner = firstMunicipalityEvidence(lines, municipality.name);
  const session = sessionEvidence(lines);
  const sourceIdentity = document.source_id ?? document.source_file;
  const documentId = stableId("document", sourceIdentity);
  const nodes: GraphifySemanticNode[] = [];
  const edges: GraphifySemanticEdge[] = [];

  let municipalityId: string | null = null;
  if (owner) {
    municipalityId = `municipality:qc:${municipality.slug}`;
    nodes.push(node(
      municipalityId,
      municipality.name,
      "Municipality",
      document,
      owner,
      { registry_id: municipalityId, aliases: [owner.text] },
    ));
    nodes.push(node(documentId, document.source_file, "Document", document, owner));
    edges.push(edge(documentId, municipalityId, "document_refers_municipality", document, owner));
  }

  let sessionId: string | null = null;
  if (session) {
    sessionId = stableId("council-session", `${sourceIdentity}\u0000${session.date.verbatim}`);
    const dateId = stableId("meeting-date", `${sourceIdentity}\u0000${session.date.verbatim}`);
    const sessionLabel = `Séance du conseil — ${session.date.verbatim}`;
    nodes.push(node(sessionId, sessionLabel, "CouncilSession", document, session.marker));
    nodes.push(node(dateId, session.date.verbatim, "MeetingDate", document, session.date.line));
    if (owner) {
      edges.push(edge(documentId, sessionId, "document_describes_council_session", document, session.marker));
    }
    edges.push(edge(sessionId, dateId, "session_held_on", document, session.date.line));
  }

  const resolutionIdsByLine = new Map<number, string[]>();
  for (const resolution of resolutionEvidence(lines)) {
    const code = normalizeCode(resolution.verbatim);
    const id = `resolution:qc:${municipality.slug}:${stableId("value", code).slice("value:".length)}`;
    nodes.push(node(id, resolution.verbatim, "Resolution", document, resolution.line, { resolution_number: resolution.verbatim }));
    const lineIds = resolutionIdsByLine.get(resolution.line.number) ?? [];
    lineIds.push(id);
    resolutionIdsByLine.set(resolution.line.number, lineIds);
    if (sessionId && /\b(?:adopt(?:e|é|ée|ées|és|er)|r[ée]solu(?:e)?|propos[ée])\b/iu.test(resolution.line.text)) {
      edges.push(edge(sessionId, id, "session_adopts_resolution", document, resolution.line));
    }
  }

  for (const regulation of regulationEvidence(lines)) {
    const code = normalizeCode(regulation.verbatim);
    const id = `regulation:qc:${municipality.slug}:${stableId("value", code).slice("value:".length)}`;
    nodes.push(node(
      id,
      regulation.verbatim,
      "Regulation",
      document,
      regulation.line,
      { regulation_number: regulation.verbatim, legal_quality: regulation.quality },
    ));
    for (const resolutionId of resolutionIdsByLine.get(regulation.line.number) ?? []) {
      edges.push(edge(resolutionId, id, "resolution_mentions_regulation", document, regulation.line));
    }
  }

  if (zoneGazetteer && owner) {
    for (const zone of zoneEvidence(lines, zoneGazetteer)) {
      const id = `zone:qc:${municipality.slug}:${stableId("value", zone.code).slice("value:".length)}`;
      nodes.push(node(id, zone.code, "Zone", document, zone.line, { zone_code: zone.code }));
      edges.push(edge(documentId, id, "document_refers_zone", document, zone.line));
    }
  }

  if (lotGazetteer) {
    for (const lot of lotEvidence(lines, lotGazetteer)) {
      const id = `lot-cadastre:qc:${municipality.slug}:${lot.lot.replace(/\D/gu, "")}`;
      nodes.push(node(id, lot.lot, "LotCadastre", document, lot.line, { lot_number: lot.lot }));
    }
  }

  return {
    nodes: dedupeNodes(nodes),
    edges: dedupeEdges(edges),
    hyperedges: [],
    input_tokens: 0,
    output_tokens: 0,
  };
}
