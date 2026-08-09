export interface JsonReportInput {
  readonly path: string;
  readonly value: unknown;
}

export interface PvGraphifySemanticSummary {
  readonly contract: "pv-graphify-semantic-all-summary/v1";
  readonly source_reports: readonly string[];
  readonly classification_reports: readonly string[];
  readonly eligible_records: number;
  readonly unique_captured_pvs: number;
  readonly duplicate_eligible_records: number;
  readonly processed_pvs: number;
  readonly indexed_pvs: number;
  readonly unindexed_pvs: number;
  readonly graphify_failures: number;
  readonly zero_node_pvs: number;
  readonly graph: Readonly<{ nodes: number; edges: number }>;
  readonly entity_counts: Readonly<Record<string, number>>;
}

interface GraphifyDocument {
  readonly storageKey: string;
  /**
   * Legacy reports predate an explicit outcome.  Their inputs were the
   * already-confirmed control population, so retain them; a modern report
   * must explicitly say INDEXED before it contributes to the graph.
   */
  readonly outcome: string | null;
  readonly exitCode: number;
  readonly nodes: number;
  readonly edges: number;
  readonly entityCounts: Readonly<Record<string, number>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}.${key} doit être une chaîne non vide`);
  return value;
}

function requiredNonNegativeInteger(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${where}.${key} doit être un entier positif ou nul`);
  return value;
}

function requiredArray(record: Record<string, unknown>, key: string, where: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${where}.${key} doit être un tableau`);
  return value;
}

function sortedPaths(reports: readonly JsonReportInput[]): string[] {
  const paths = reports.map((report) => report.path).sort((left, right) => left.localeCompare(right));
  if (new Set(paths).size !== paths.length) throw new Error("un même rapport ne peut être agrégé deux fois");
  return paths;
}

function graphifyDocument(value: unknown, where: string): GraphifyDocument {
  if (!isRecord(value)) throw new Error(`${where} doit être un objet`);
  const graphify = value.graphify;
  if (!isRecord(graphify)) throw new Error(`${where}.graphify doit être un objet`);
  const entityCounts = value.entity_counts;
  if (!isRecord(entityCounts)) throw new Error(`${where}.entity_counts doit être un objet`);
  const counts: Record<string, number> = {};
  for (const [type, count] of Object.entries(entityCounts)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) throw new Error(`${where}.entity_counts.${type} doit être un entier positif ou nul`);
    counts[type] = count;
  }
  return {
    storageKey: requiredString(value, "storage_key", where),
    outcome: value.outcome === undefined ? null : requiredString(value, "outcome", where),
    exitCode: requiredNonNegativeInteger(graphify, "exit_code", `${where}.graphify`),
    nodes: requiredNonNegativeInteger(graphify, "nodes", `${where}.graphify`),
    edges: requiredNonNegativeInteger(graphify, "edges", `${where}.graphify`),
    entityCounts: counts,
  };
}

function supersededStorageKeys(value: Record<string, unknown>, where: string): ReadonlySet<string> {
  const raw = value.supersedes_storage_keys;
  if (raw === undefined) return new Set();
  const keys = requiredArray(value, "supersedes_storage_keys", where)
    .map((key, index) => requiredString({ key }, "key", `${where}.supersedes_storage_keys[${index}]`));
  if (new Set(keys).size !== keys.length) throw new Error(`${where}.supersedes_storage_keys contient une clé dupliquée`);
  return new Set(keys);
}

/**
 * Rebuild the PV semantic aggregate from its short classification and Graphify
 * reports. Every input is reconciled by immutable CAS storage key so a repeated
 * capture report cannot inflate the production index indicator.
 */
export function summarizePvGraphifySemantic(
  classificationReports: readonly JsonReportInput[],
  graphifyReports: readonly JsonReportInput[],
): PvGraphifySemanticSummary {
  const classificationPaths = sortedPaths(classificationReports);
  const graphifyPaths = sortedPaths(graphifyReports);
  const eligible = new Set<string>();
  let eligibleRecords = 0;

  for (const report of classificationReports) {
    if (!isRecord(report.value)) throw new Error(`${report.path} doit être un objet`);
    for (const [index, line] of requiredArray(report.value, "lines", report.path).entries()) {
      if (!isRecord(line) || line.classification !== "PV_LISIBLE_PROPRIETAIRE_CONFIRME") continue;
      eligibleRecords += 1;
      eligible.add(requiredString(line, "storage_key", `${report.path}.lines[${index}]`));
    }
  }

  const documents = new Map<string, GraphifyDocument>();
  for (const report of [...graphifyReports].sort((left, right) => left.path.localeCompare(right.path))) {
    if (!isRecord(report.value)) throw new Error(`${report.path} doit être un objet`);
    const supersedes = supersededStorageKeys(report.value, report.path);
    const reportDocumentKeys = new Set<string>();
    for (const [index, value] of requiredArray(report.value, "documents", report.path).entries()) {
      const document = graphifyDocument(value, `${report.path}.documents[${index}]`);
      reportDocumentKeys.add(document.storageKey);
      if (documents.has(document.storageKey) && !supersedes.has(document.storageKey)) {
        throw new Error(`PV indexé deux fois dans les rapports Graphify: ${document.storageKey}`);
      }
      if (!eligible.has(document.storageKey)) {
        throw new Error(`PV Graphify absent de l'univers de classification: ${document.storageKey}`);
      }
      documents.set(document.storageKey, document);
    }
    for (const storageKey of supersedes) {
      if (!reportDocumentKeys.has(storageKey)) {
        throw new Error(`${report.path}.supersedes_storage_keys référence un document absent du rapport: ${storageKey}`);
      }
    }
  }

  let graphifyFailures = 0;
  let indexedPvs = 0;
  let zeroNodePvs = 0;
  let nodes = 0;
  let edges = 0;
  const entityCounts: Record<string, number> = {};
  for (const document of documents.values()) {
    if (document.outcome !== null && document.outcome !== "INDEXED") continue;
    if (document.exitCode !== 0) {
      graphifyFailures += 1;
      continue;
    }
    if (document.nodes === 0) {
      zeroNodePvs += 1;
      continue;
    }
    indexedPvs += 1;
    nodes += document.nodes;
    edges += document.edges;
    for (const [type, count] of Object.entries(document.entityCounts)) {
      entityCounts[type] = (entityCounts[type] ?? 0) + count;
    }
  }

  return {
    contract: "pv-graphify-semantic-all-summary/v1",
    source_reports: graphifyPaths,
    classification_reports: classificationPaths,
    eligible_records: eligibleRecords,
    unique_captured_pvs: eligible.size,
    duplicate_eligible_records: eligibleRecords - eligible.size,
    processed_pvs: documents.size,
    indexed_pvs: indexedPvs,
    unindexed_pvs: eligible.size - indexedPvs,
    graphify_failures: graphifyFailures,
    zero_node_pvs: zeroNodePvs,
    graph: { nodes, edges },
    entity_counts: Object.fromEntries(Object.entries(entityCounts).sort(([left], [right]) => left.localeCompare(right))),
  };
}
