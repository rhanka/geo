/**
 * Pure audit rules for source links on served qc-zoning-events documents.
 *
 * S3 and filesystem I/O deliberately live in the runner. Missing or malformed
 * documents must therefore be handled as `unknown` by that runner; this module
 * only classifies events that were actually read.
 */
import { exactHttpUrl } from "./reglement-capture-kpi.js";
import type { ZoningEvent } from "../zoning-events-emit.js";

export const DEFAULT_ZONING_EVENT_SOURCE_FIELDS = [
  "url_pdf",
  "provenance.source_url",
] as const;

export type ZoningEventSourceState = "has-source" | "invalid-source" | "no-source";

export interface ZoningEventSourceClassification {
  source_state: ZoningEventSourceState;
  source_url: string | null;
  source_field: string | null;
}

export interface ZoningEventSourceAuditEntry extends ZoningEventSourceClassification {
  event_id: string;
  muni: string;
  bylaw_numero: string | null;
  type: ZoningEvent["type"];
  date_iso: string;
  state: ZoningEvent["state"];
  is_living_phantom: boolean;
}

export interface ZoningEventSourceAuditCounts {
  events_total: number;
  living_events: number;
  retracted_events: number;
  has_source: number;
  invalid_source: number;
  no_source: number;
  living_phantoms: number;
  living_invalid_source: number;
  living_no_source: number;
}

export interface ZoningEventSourceDocumentObservation {
  as_of: string;
  complete: boolean;
  muni: string;
  source_fields: string[];
  counts: ZoningEventSourceAuditCounts;
  events: ZoningEventSourceAuditEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fieldValue(value: unknown, path: string): unknown {
  if (!path || path.split(".").some((part) => part.length === 0)) {
    throw new Error(`zoning-event source field invalide: '${path}'`);
  }
  let current = value;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function sourceFields(fields: readonly string[]): string[] {
  const normalized = [...fields];
  if (normalized.length === 0) {
    throw new Error("zoning-event source audit: au moins un champ source est requis");
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("zoning-event source audit: champs source dupliqués");
  }
  // Validate every path even when an empty document is observed.
  for (const field of normalized) fieldValue({}, field);
  return normalized;
}

/**
 * Classify one event using literal field paths. A valid HTTP(S) value wins;
 * otherwise a present-but-invalid value is distinct from an absent value.
 */
export function classifyZoningEventSource(
  event: ZoningEvent,
  fields: readonly string[] = DEFAULT_ZONING_EVENT_SOURCE_FIELDS,
): ZoningEventSourceClassification {
  const configured = sourceFields(fields);
  let firstInvalid: { field: string; value: unknown } | null = null;

  for (const field of configured) {
    const value = fieldValue(event, field);
    if (exactHttpUrl(value)) {
      return { source_state: "has-source", source_url: value, source_field: field };
    }
    // Null, undefined and the literal empty string mean no captured source.
    // Whitespace and non-string values are present but invalid, never absent.
    if (value !== null && value !== undefined && value !== "" && firstInvalid === null) {
      firstInvalid = { field, value };
    }
  }

  if (firstInvalid !== null) {
    return {
      source_state: "invalid-source",
      source_url: typeof firstInvalid.value === "string" ? firstInvalid.value : null,
      source_field: firstInvalid.field,
    };
  }
  return { source_state: "no-source", source_url: null, source_field: null };
}

function assertAuditEvent(value: unknown, index: number): asserts value is ZoningEvent {
  if (!isRecord(value)) throw new Error(`zoning-events: event[${index}] non-objet`);
  if (typeof value["event_id"] !== "string" || value["event_id"].length === 0) {
    throw new Error(`zoning-events: event[${index}].event_id invalide`);
  }
  if (typeof value["muni"] !== "string" || value["muni"].length === 0) {
    throw new Error(`zoning-events: event[${index}].muni invalide`);
  }
  if (!(["active", "corrected", "retracted"] as unknown[]).includes(value["state"])) {
    throw new Error(`zoning-events: event[${index}].state invalide`);
  }
  if (value["bylaw_numero"] !== null && typeof value["bylaw_numero"] !== "string") {
    throw new Error(`zoning-events: event[${index}].bylaw_numero invalide`);
  }
  if (typeof value["type"] !== "string" || typeof value["date_iso"] !== "string") {
    throw new Error(`zoning-events: event[${index}].type/date_iso invalide`);
  }
}

function documentEvents(document: Record<string, unknown>): ZoningEvent[] {
  const flat = document["events"];
  const features = document["features"];
  const featureEvents = Array.isArray(features)
    ? features.map((feature, index) => {
        if (!isRecord(feature) || !isRecord(feature["properties"])) {
          throw new Error(`zoning-events: feature[${index}].properties invalide`);
        }
        return feature["properties"];
      })
    : null;

  if (!Array.isArray(flat) || featureEvents === null) {
    throw new Error("zoning-events: contrat servi exige events[] ET features[]");
  }
  if (flat.length !== featureEvents.length) {
    throw new Error("zoning-events: miroir events[]/features[] divergent (taille)");
  }
  for (let index = 0; index < flat.length; index++) {
    if (JSON.stringify(flat[index]) !== JSON.stringify(featureEvents[index])) {
      throw new Error(`zoning-events: miroir events[]/features[] divergent à l'index ${index}`);
    }
  }

  // geo-api serves feature.properties; use it when available after proving the
  // convenience events[] mirror is identical.
  return featureEvents.map((event, index) => {
    assertAuditEvent(event, index);
    return event;
  });
}

function emptyCounts(): ZoningEventSourceAuditCounts {
  return {
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

/** Observe one complete served document, with deterministic per-event ordering. */
export function observeZoningEventSources(
  value: unknown,
  fields: readonly string[] = DEFAULT_ZONING_EVENT_SOURCE_FIELDS,
): ZoningEventSourceDocumentObservation {
  if (!isRecord(value) || value["type"] !== "FeatureCollection") {
    throw new Error("zoning-events: document FeatureCollection invalide");
  }
  if (typeof value["as_of"] !== "string" || typeof value["complete"] !== "boolean") {
    throw new Error("zoning-events: métadonnées as_of/complete invalides");
  }
  if (typeof value["muni"] !== "string" || value["muni"].length === 0) {
    throw new Error("zoning-events: muni document invalide");
  }
  const configured = sourceFields(fields);
  const events = documentEvents(value);
  const seen = new Set<string>();
  const entries = events.map((event): ZoningEventSourceAuditEntry => {
    if (seen.has(event.event_id)) throw new Error(`zoning-events: event_id dupliqué ${event.event_id}`);
    seen.add(event.event_id);
    if (event.muni !== value["muni"]) {
      throw new Error(`zoning-events: muni event ${event.muni} != document ${value["muni"]}`);
    }
    const source = classifyZoningEventSource(event, configured);
    return {
      event_id: event.event_id,
      muni: event.muni,
      bylaw_numero: event.bylaw_numero,
      type: event.type,
      date_iso: event.date_iso,
      state: event.state,
      ...source,
      is_living_phantom: event.state !== "retracted" && source.source_state !== "has-source",
    };
  }).sort((left, right) => left.event_id.localeCompare(right.event_id));

  const counts = emptyCounts();
  for (const entry of entries) {
    counts.events_total++;
    if (entry.state === "retracted") counts.retracted_events++;
    else counts.living_events++;
    if (entry.source_state === "has-source") counts.has_source++;
    else if (entry.source_state === "invalid-source") counts.invalid_source++;
    else counts.no_source++;
    if (entry.is_living_phantom) {
      counts.living_phantoms++;
      if (entry.source_state === "invalid-source") counts.living_invalid_source++;
      else counts.living_no_source++;
    }
  }

  return {
    as_of: value["as_of"],
    complete: value["complete"],
    muni: value["muni"],
    source_fields: configured,
    counts,
    events: entries,
  };
}
