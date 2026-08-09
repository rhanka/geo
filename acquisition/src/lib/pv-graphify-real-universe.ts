/**
 * Read the durable, measured PV Graphify universe.
 *
 * The snapshot's `batch` is only the initial balanced control sample.  Batch
 * runners must instead traverse the complete set of source-scoped documents,
 * preserving the snapshot's stable CAS order.
 */

export interface ReadyPvRealUniverseDocument {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}.${key} doit être une chaîne non vide`);
  return value.trim();
}

/**
 * Returns only documents with an explicit terminal-manifest municipal scope.
 * Missing scope cannot be repaired from a filename or a directory name.
 */
export function readReadyPvRealUniverse(value: unknown, where: string): ReadyPvRealUniverseDocument[] {
  if (!isRecord(value) || value.contract !== "pv-graphify-semantic-real-universe/v1") {
    throw new Error(`univers PV réel invalide: ${where}`);
  }
  const realUniverse = value.real_universe;
  if (!isRecord(realUniverse) || !Array.isArray(realUniverse.documents)) {
    throw new Error(`univers PV réel sans documents: ${where}`);
  }

  const selected: ReadyPvRealUniverseDocument[] = [];
  const storageKeys = new Set<string>();
  for (const [index, value] of realUniverse.documents.entries()) {
    if (!isRecord(value)) throw new Error(`${where}.real_universe.documents[${index}] invalide`);
    const sourceStatus = requiredString(value, "source_status", `${where}.real_universe.documents[${index}]`);
    if (sourceStatus !== "READY") continue;
    const document = {
      storage_key: requiredString(value, "storage_key", `${where}.real_universe.documents[${index}]`),
      slug: requiredString(value, "slug", `${where}.real_universe.documents[${index}]`),
      municipality_name: requiredString(value, "municipality_name", `${where}.real_universe.documents[${index}]`),
      url: requiredString(value, "url", `${where}.real_universe.documents[${index}]`),
    };
    if (storageKeys.has(document.storage_key)) {
      throw new Error(`${where}.real_universe.documents: clé CAS READY dupliquée: ${document.storage_key}`);
    }
    storageKeys.add(document.storage_key);
    selected.push(document);
  }
  if (selected.length === 0) throw new Error(`univers PV réel sans document READY: ${where}`);
  return selected;
}
