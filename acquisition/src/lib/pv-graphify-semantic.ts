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
  /**
   * Zone matching mode used for this municipality.
   * - `normalized`: case, separators and spaces normalization are enabled.
   * - `exact`: only exact literal matching (case + punctuation normalization).
   * When omitted, exact+safe-normalized is computed from codes.
   */
  readonly zone_code_matching?: "normalized" | "exact";
}

export interface ZoneGazetteerMatchPolicy {
  readonly mode: "normalized" | "exact";
  readonly collisions: readonly string[];
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
  | "AVIS_DE_MOTION"
  | "ADOPTION_MENTIONNEE"
  | "AVIS_APPROBATION_REFERENDAIRE"
  | "DEPOT_CERTIFICAT"
  | "CERTIFICAT_CONFORMITE"
  | "ENTREE_EN_VIGUEUR"
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
  /** The line containing the status marker when it is adjacent to the code. */
  readonly statusLine: SourceLine;
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

function normalizeCodeExact(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleUpperCase("fr-CA")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

export function analyzeZoneGazetteerMatchMode(codes: readonly string[]): ZoneGazetteerMatchPolicy {
  const byNormalized = new Map<string, Set<string>>();
  for (const value of codes) {
    const normalized = normalizeCode(value);
    if (!normalized) continue;
    const exact = normalizeCodeExact(value);
    const current = byNormalized.get(normalized);
    if (current === undefined) {
      byNormalized.set(normalized, new Set([exact]));
      continue;
    }
    current.add(exact);
  }
  const collisions = uniqueSorted(
    [...byNormalized.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([normalized, values]) => `${normalized}: ${uniqueSorted([...values]).join("|")}`),
  );
  return {
    mode: collisions.length === 0 ? "normalized" : "exact",
    collisions,
  };
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
  const name = escapeRegex(canonicalName.trim()).replace(/\s+/gu, "\\s+");
  const ownerPrefix = "(?:municipalite(?:\\s+de\\s+paroisse)?|municipality|ville|cite|city|village|township|canton|paroisse|parish)";
  const ownerConnectors = "(?:\\s+(?:de|d|du|des|of|the|la|le|township|canton))*";
  const municipalityBeforeName = new RegExp(`\\b${ownerPrefix}\\b${ownerConnectors}\\s+${name}\\b`, "u");
  const councilBeforeName = new RegExp(
    `\\b(?:conseil|council)\\s+(?:municipal\\s+)?(?:de|d|of)${ownerConnectors}\\s+${name}\\b`,
    "u",
  );
  return municipalityBeforeName.test(canonicalLine) || councilBeforeName.test(canonicalLine);
}

function firstMunicipalityEvidence(lines: readonly SourceLine[], officialName: string): SourceLine | null {
  for (const [index, line] of lines.entries()) {
    if (isPrintedMunicipalityOwner(line, officialName)) return line;
    const continuation = lines[index + 1];
    if (!continuation) continue;

    // `pdftotext -layout` can place the municipal name on the next physical
    // line. Rejoin that exact adjacent source text before matching, but retain
    // the first original line as evidence so the citation stays relocalizable.
    const joined = { number: line.number, text: `${line.text} ${continuation.text}` };
    if (isPrintedMunicipalityOwner(joined, officialName)) return line;
  }
  return null;
}

/**
 * Resolve only municipality owners explicitly printed in the document.  This
 * is intentionally the same strict, prefix-qualified test used for semantic
 * extraction: capture metadata and a directory name are never an owner.
 *
 * A caller may use the result to report a capture whose manifest scope does
 * not match the document.  It must not use it for approximate resolution.
 */
export function printedMunicipalityOwners(
  text: string,
  municipalities: readonly MunicipalityGazetteerEntry[],
): MunicipalityGazetteerEntry[] {
  const lines = sourceLines(text);
  return municipalities.filter((municipality) => firstMunicipalityEvidence(lines, municipality.name) !== null);
}

const MONTH = "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre";
const FRENCH_DATE = new RegExp(`\\b(?:le|du|en date du)\\s+(\\d{1,2}(?:er|e|ème)?\\s*(?:${MONTH})\\s+\\d{4})\\b`, "iu");
const ISO_DATE = /\b(\d{4}[/-]\d{2}[/-]\d{2})\b/u;
const NUMERIC_DATE = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/u;
const SESSION_HEADER_MAX_LINE = 80;

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
    && /(?:\bconseil\b|\bmunicipalit[ée](?![\p{L}\p{N}_]))/iu.test(line.text);
}

function sessionEvidence(lines: readonly SourceLine[]): { marker: SourceLine; date: DateEvidence } | null {
  // A later reference to an earlier meeting is not this PV's session. Only the
  // document header is authoritative; missing a late-formatted header is safer
  // than indexing a prior session as the document's own meeting.
  const header = lines.filter((line) => line.number <= SESSION_HEADER_MAX_LINE);
  const markers = header.filter(isCouncilSessionMarker);
  const candidates = dates(header);
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

const REGULATION_REFERENCE = /\br[èe]glement\b\s*(?:n(?:um[ée]ro)?[°o]?\s*)?((?:[A-Z]{1,5}\s*(?:[./-]\s*)?\d{1,6}|\d{1,6})(?:\s*[./-]\s*\d{1,6}){0,3})/giu;
const REGULATION_DATE_CONTINUATION = new RegExp(`^\\s+(?:${MONTH})\\b`, "iu");
const REGULATION_CODE_PREFIXES = new Set(["R", "RV", "SQ", "PU"]);

function isAcceptedRegulationCode(value: string): boolean {
  const prefix = /^([A-Za-z]+)\s*(?:[./-]\s*)?\d/u.exec(value)?.[1];
  if (prefix === undefined) return true;
  // PDF text can turn prose such as `de 19` into a fake code.  The closed
  // prefix set preserves the established `R`, `RV`, `SQ`, and `PU` forms
  // while refusing words (even when a heading happens to be uppercase).
  return REGULATION_CODE_PREFIXES.has(prefix.toLocaleUpperCase("fr-CA"));
}

function hasRegulationReference(line: string): boolean {
  return line.matchAll(REGULATION_REFERENCE).next().done === false;
}

function regulationQuality(line: string, regulationOffset: number, contextAfter = 80): RegulationLegalQuality {
  const before = normalizeWords(line.slice(Math.max(0, regulationOffset - 100), regulationOffset));
  const after = normalizeWords(line.slice(regulationOffset, regulationOffset + contextAfter));
  // A legal-status clause attached to the regulation controls the result. Its
  // nearby "adopté" can only record adoption of that draft, never turn the
  // draft itself into a legally effective regulation.
  if (/\b(?:premier|1er|1e|1eme) projet (?:de|du|d) $/u.test(before) || /\b(?:premier|1er|1e|1eme) projet\b/u.test(after)) {
    return "PREMIER_PROJET";
  }
  if (/\b(?:second|deuxieme|2e|2eme) projet (?:de|du|d) $/u.test(before) || /\b(?:second|deuxieme|2e|2eme) projet\b/u.test(after)) {
    return "SECOND_PROJET";
  }
  if (/\bprojet (?:de|du|d) $/u.test(before)) return "PROJET";
  if (/\bavis d approbation referendaire (?:de|du|d) $/u.test(before)) return "AVIS_APPROBATION_REFERENDAIRE";
  if (/\bavis de motion\b/u.test(before) || /\bavis de motion\b/u.test(after)) return "AVIS_DE_MOTION";
  if (/\bcertificat de conformite\b/u.test(before) || /\bcertificat de conformite\b/u.test(after)) return "CERTIFICAT_CONFORMITE";
  if (/\bdepot (?:d un |du |d )?certificat\b/u.test(before) || /\bdepot (?:d un |du |d )?certificat\b/u.test(after)) {
    return "DEPOT_CERTIFICAT";
  }
  if (/\b(?:entree en vigueur|en vigueur)\b/u.test(before) || /\b(?:entree en vigueur|en vigueur)\b/u.test(after)) {
    return "ENTREE_EN_VIGUEUR";
  }
  if (/\bversion administrative (?:de|du|d) $/u.test(before)) return "VERSION_ADMINISTRATIVE";
  if (/\bcodification (?:de|du|d) $/u.test(before)) return "CODIFICATION";
  // A heading or proposed wording that merely mentions adoption is kept
  // distinct from the established affirmative adoption clauses below.
  if (/\badoption(?: (?:de|d|le|la|les|un|une))? $/u.test(before) || /\b(?:adopter|adopte) (?:de|du|d|le|la|les|un|une) $/u.test(before)) {
    return "ADOPTION_MENTIONNEE";
  }
  if (/\badoption du $/u.test(before)) return "ADOPTE";
  if (/\bsera? adopte\b/u.test(after) || /\bseront adoptes\b/u.test(after)) return "INCONNUE";
  if (/\badopte(?:e|es|er)?\b/u.test(after)) return "ADOPTE";
  return "INCONNUE";
}

function qualityFromAdjacentLines(
  lines: readonly SourceLine[],
  lineIndex: number,
  regulationOffset: number,
): { readonly quality: RegulationLegalQuality; readonly statusLine: SourceLine } {
  const current = lines[lineIndex]!;
  const direct = regulationQuality(current.text, regulationOffset);
  if (direct !== "INCONNUE") return { quality: direct, statusLine: current };

  const previous = lines[lineIndex - 1];
  if (previous && !hasRegulationReference(previous.text)) {
    const joined = `${previous.text}\n${current.text}`;
    const quality = regulationQuality(joined, previous.text.length + 1 + regulationOffset);
    if (quality !== "INCONNUE" && quality !== "ADOPTE") return { quality, statusLine: previous };
  }

  const next = lines[lineIndex + 1];
  if (next && !hasRegulationReference(next.text)) {
    const joined = `${current.text}\n${next.text}`;
    // This wider range is limited to the immediately adjacent physical line;
    // it lets a PDF-wrapped status finish after a long regulation title.
    const quality = regulationQuality(joined, regulationOffset, 400);
    if (quality !== "INCONNUE" && quality !== "ADOPTE") return { quality, statusLine: next };
  }
  return { quality: "INCONNUE", statusLine: current };
}

function rawRegulationEvidence(lines: readonly SourceLine[]): RegulationEvidence[] {
  const found: RegulationEvidence[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    for (const match of line.text.matchAll(REGULATION_REFERENCE)) {
      const verbatim = match[1]?.trim();
      const offset = match.index ?? -1;
      const afterReference = offset < 0 ? "" : line.text.slice(offset + match[0].length);
      // `pdftotext` can split a code immediately after its operator.  Do not
      // rejoin physical lines and never emit the left fragment as a code.
      const hasDanglingCodeOperator = /^\s*[-‐‑‒–—―]\s*$/u.test(afterReference);
      const isDayOfMonth = REGULATION_DATE_CONTINUATION.test(afterReference);
      if (verbatim && offset >= 0 && isAcceptedRegulationCode(verbatim) && !hasDanglingCodeOperator && !isDayOfMonth) {
        const classified = qualityFromAdjacentLines(lines, lineIndex, offset);
        found.push({ line, statusLine: classified.statusLine, verbatim, quality: classified.quality });
      }
    }
  }
  return found;
}

/**
 * A document may mention one exact regulation before its agenda item later
 * names the same regulation's procedural status.  A bare initial occurrence
 * can inherit only a later non-adoption status for that exact normalized code:
 * distant adoption wording is not evidence that the bare mention was adopted.
 * This is never a prefix, neighbour, or hyphen-fragment resolution.
 */
function regulationEvidence(lines: readonly SourceLine[]): RegulationEvidence[] {
  const grouped = new Map<string, RegulationEvidence[]>();
  for (const evidence of rawRegulationEvidence(lines)) {
    const code = normalizeCode(evidence.verbatim);
    const values = grouped.get(code) ?? [];
    values.push(evidence);
    grouped.set(code, values);
  }
  return [...grouped.values()].map((evidences) => {
    const first = evidences[0]!;
    if (first.quality !== "INCONNUE") return first;
    return [...evidences].reverse().find((evidence) => evidence.quality !== "INCONNUE" && evidence.quality !== "ADOPTE") ?? first;
  });
}

/**
 * Replays the legal status of one already-cited regulation from its verbatim
 * source clause. It deliberately requires one exact regulation-code match;
 * callers cannot substitute a fuzzy or neighbouring regulation.
 */
export function classifyRegulationLegalQuality(sourceClause: string, regulationNumber: string): RegulationLegalQuality {
  const expectedCode = normalizeCode(regulationNumber);
  const matches = regulationEvidence(sourceLines(sourceClause))
    .filter((evidence) => normalizeCode(evidence.verbatim) === expectedCode);
  if (matches.length !== 1) {
    throw new Error(`qualification réglementaire ambiguë ou absente pour ${regulationNumber}: ${matches.length} ancre(s) exacte(s)`);
  }
  return matches[0]!.quality;
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

function zonePatternExact(code: string): RegExp {
  return new RegExp(`(?<![A-Z0-9])${escapeRegex(normalizeCodeExact(code))}(?![A-Z0-9])`, "giu");
}

interface ZoneMatcher {
  readonly code: string;
  readonly pattern: RegExp;
}

function zoneMatchers(codes: readonly string[], mode: "normalized" | "exact"): ZoneMatcher[] {
  const normalizedCodes = new Set<string>();
  for (const code of codes) {
    if (mode === "normalized") {
      const normalized = normalizeCode(code);
      if (normalized) normalizedCodes.add(normalized);
      continue;
    }
    const normalized = normalizeCodeExact(code);
    if (normalized) normalizedCodes.add(normalized);
  }
  return uniqueSorted([...normalizedCodes]).map((code) => ({
    code,
    pattern: mode === "exact" ? zonePatternExact(code) : zonePattern(code),
  }));
}

function zoneEvidence(lines: readonly SourceLine[], gazetteer: MunicipalZoneGazetteer): Array<{ line: SourceLine; code: string }> {
  const mode: "normalized" | "exact" = gazetteer.zone_code_matching ?? analyzeZoneGazetteerMatchMode(gazetteer.codes).mode;
  const matchers = zoneMatchers(gazetteer.codes, mode);
  const found: Array<{ line: SourceLine; code: string }> = [];
  for (const line of lines) {
    if (!/\bzones?\b/iu.test(line.text)) continue;
    for (const { code, pattern } of matchers) {
      if (pattern.test(line.text)) {
        found.push({ line, code });
      }
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

  // The capture manifest is only an acquisition hint. Without the owner being
  // printed in the document, even a correctly formatted resolution cannot be
  // assigned to this municipality.
  if (!owner) {
    return {
      nodes,
      edges,
      hyperedges: [],
      input_tokens: 0,
      output_tokens: 0,
    };
  }

  const municipalityId = `municipality:qc:${municipality.slug}`;
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

  let sessionId: string | null = null;
  if (session) {
    sessionId = stableId("council-session", `${sourceIdentity}\u0000${session.date.verbatim}`);
    const dateId = stableId("meeting-date", `${sourceIdentity}\u0000${session.date.verbatim}`);
    const sessionLabel = `Séance du conseil — ${session.date.verbatim}`;
    nodes.push(node(sessionId, sessionLabel, "CouncilSession", document, session.marker));
    nodes.push(node(dateId, session.date.verbatim, "MeetingDate", document, session.date.line));
    edges.push(edge(documentId, sessionId, "document_describes_council_session", document, session.marker));
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
    const regulationNode = node(
      id,
      regulation.verbatim,
      "Regulation",
      document,
      regulation.line,
      { regulation_number: regulation.verbatim, legal_quality: regulation.quality },
    );
    nodes.push(regulation.statusLine.number === regulation.line.number
      ? regulationNode
      : { ...regulationNode, citations: [citation(document, regulation.line), citation(document, regulation.statusLine)] });
    for (const resolutionId of resolutionIdsByLine.get(regulation.line.number) ?? []) {
      edges.push(edge(resolutionId, id, "resolution_mentions_regulation", document, regulation.line));
    }
  }

  if (zoneGazetteer) {
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

/**
 * Contrôle d'intégrité d'une extraction sémantique avant qu'elle ne serve de
 * fragment Graphify : chaque nœud et chaque arête doit porter au moins une
 * citation ancrée (fichier, localisation et verbatim non vides), les
 * identifiants de nœud doivent être uniques et chaque arête doit relier deux
 * nœuds présents dans l'extraction. Retourne la liste des manquements ; un
 * tableau vide signifie que l'extraction est source-ancrée et cohérente.
 */
export function validateExtraction(extraction: GraphifySemanticExtraction): string[] {
  const problems: string[] = [];
  const nodeIds = new Set<string>();

  const grounded = (citations: readonly GraphifyCitation[]): boolean =>
    citations.length > 0 &&
    citations.every((c) => c.source_file.length > 0 && c.source_location.length > 0 && c.quote.length > 0);

  for (const entity of extraction.nodes) {
    if (nodeIds.has(entity.id)) problems.push(`nœud dupliqué: ${entity.id}`);
    nodeIds.add(entity.id);
    if (!grounded(entity.citations)) problems.push(`nœud sans citation ancrée: ${entity.id}`);
  }

  for (const link of extraction.edges) {
    if (!nodeIds.has(link.source)) problems.push(`arête vers une source absente: ${link.source}`);
    if (!nodeIds.has(link.target)) problems.push(`arête vers une cible absente: ${link.target}`);
    if (!grounded(link.citations)) problems.push(`arête sans citation ancrée: ${link.source}→${link.target}`);
  }

  return problems;
}
