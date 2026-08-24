import {
  DEFAULT_ZONING_EVENT_SOURCE_FIELDS,
  observeZoningEventSources,
  type ZoningEventSourceAuditCounts,
  type ZoningEventSourceAuditEntry,
} from "./zoning-event-source-audit.js";
import { zoningEventsKeys } from "../zoning-events-emit.js";

export const ZONING_EVENT_AUDIT_CONTRACT = "zoning-event-source-audit/v1" as const;

export interface ZoningEventAuditCohort {
  source: string;
  sha256: `sha256:${string}`;
  expected_count: number;
  slugs: string[];
}

export interface ZoningEventAuditCity {
  slug: string;
  collection_key: string;
  collection_sha256: `sha256:${string}` | null;
  audit_state: "audited" | "unknown";
  document_as_of: string | null;
  complete: boolean | null;
  read_error: string | null;
  counts: ZoningEventSourceAuditCounts | null;
  events: ZoningEventSourceAuditEntry[];
}

export interface ZoningEventAuditTotals extends ZoningEventSourceAuditCounts {
  cities_total: number;
  cities_audited: number;
  cities_unknown: number;
}

export interface ZoningEventSourceAuditReport {
  contract: typeof ZONING_EVENT_AUDIT_CONTRACT;
  cohort: ZoningEventAuditCohort;
  selected_layout: "nested";
  source_fields: string[];
  totals: ZoningEventAuditTotals;
  cities: ZoningEventAuditCity[];
}

export interface ZoningEventDocumentRead {
  document: unknown;
  sha256: `sha256:${string}`;
}

export type ZoningEventDocumentReader = (
  slug: string,
  key: string,
) => Promise<ZoningEventDocumentRead>;

function errorText(error: unknown): string {
  const value = error as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const status = value?.$metadata?.httpStatusCode;
  return `${String(value?.name ?? "Error")}: ${String(value?.message ?? error)}${status ? ` (HTTP ${status})` : ""}`;
}

export function parseZoningEventCohortTsv(value: string): string[] {
  const rows = value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("\t").map((cell) => cell.trim()));
  if (rows.length === 0) throw new Error("cohorte zoning-events vide");

  const header = rows[0]!.map((cell) => cell.toLowerCase());
  const slugColumn = header.findIndex((cell) => ["slug", "muni_slug", "ville_slug"].includes(cell));
  const data = slugColumn >= 0 ? rows.slice(1) : rows;
  const column = slugColumn >= 0 ? slugColumn : 0;
  const slugs = data.map((row, index) => {
    const slug = row[column];
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`cohorte zoning-events: slug invalide ligne ${index + (slugColumn >= 0 ? 2 : 1)}`);
    }
    return slug;
  });
  if (new Set(slugs).size !== slugs.length) throw new Error("cohorte zoning-events: slug dupliqué");
  return [...slugs].sort();
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

function zeroTotals(citiesTotal: number): ZoningEventAuditTotals {
  return {
    cities_total: citiesTotal,
    cities_audited: 0,
    cities_unknown: 0,
    events_total: 0,
    living_events: 0,
    retracted_events: 0,
    has_source: 0,
    invalid_source: 0,
    no_source: 0,
    living_phantoms: 0,
    living_invalid_source: 0,
    living_no_source: 0,
  };
}

export async function auditZoningEventSourceCohort(
  cohort: ZoningEventAuditCohort,
  readDocument: ZoningEventDocumentReader,
  options: { concurrency?: number; sourceFields?: readonly string[] } = {},
): Promise<ZoningEventSourceAuditReport> {
  if (cohort.slugs.length !== cohort.expected_count) {
    throw new Error(`cohorte zoning-events: ${cohort.slugs.length} slugs != attendu ${cohort.expected_count}`);
  }
  if (new Set(cohort.slugs).size !== cohort.slugs.length) {
    throw new Error("cohorte zoning-events: slugs dupliqués");
  }
  const slugs = [...cohort.slugs].sort();
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("zoning-event audit: concurrency doit être 1..16");
  }
  const fields = [...(options.sourceFields ?? DEFAULT_ZONING_EVENT_SOURCE_FIELDS)];
  const cities = await mapConcurrent(slugs, concurrency, async (slug): Promise<ZoningEventAuditCity> => {
    const key = zoningEventsKeys(slug)[1]!;
    try {
      const read = await readDocument(slug, key);
      const observation = observeZoningEventSources(read.document, fields);
      if (observation.muni !== slug) {
        throw new Error(`zoning-events: muni document ${observation.muni} != cohorte ${slug}`);
      }
      return {
        slug,
        collection_key: key,
        collection_sha256: read.sha256,
        audit_state: "audited",
        document_as_of: observation.as_of,
        complete: observation.complete,
        read_error: null,
        counts: observation.counts,
        events: observation.events,
      };
    } catch (error) {
      // Missing/unreadable/corrupt means unknown. It must never be folded into
      // a source absence, which would authorize an invented retraction.
      return {
        slug,
        collection_key: key,
        collection_sha256: null,
        audit_state: "unknown",
        document_as_of: null,
        complete: null,
        read_error: errorText(error),
        counts: null,
        events: [],
      };
    }
  });

  const totals = zeroTotals(cities.length);
  for (const city of cities) {
    if (city.audit_state === "unknown") {
      totals.cities_unknown++;
      continue;
    }
    totals.cities_audited++;
    const counts = city.counts!;
    totals.events_total += counts.events_total;
    totals.living_events += counts.living_events;
    totals.retracted_events += counts.retracted_events;
    totals.has_source += counts.has_source;
    totals.invalid_source += counts.invalid_source;
    totals.no_source += counts.no_source;
    totals.living_phantoms += counts.living_phantoms;
    totals.living_invalid_source += counts.living_invalid_source;
    totals.living_no_source += counts.living_no_source;
  }

  return {
    contract: ZONING_EVENT_AUDIT_CONTRACT,
    cohort: { ...cohort, slugs },
    selected_layout: "nested",
    source_fields: fields,
    totals,
    cities,
  };
}
