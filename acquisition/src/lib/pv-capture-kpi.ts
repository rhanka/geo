/**
 * Pure rules for the procès-verbal capture KPI.
 *
 * The runner owns S3 I/O.  This module deliberately joins only literal URL
 * strings: an URL has durable bytes only when a manifest line for that same
 * URL points at an extant CAS object.  A 404 remains a failed attempt, never
 * an inferred absence of a PV.
 */

export const PV_CAPTURE_CITY_STATES = [
  "sans_index",
  "index_sans_octets",
  "octets_conserves",
] as const;
export type PvCaptureCityState = (typeof PV_CAPTURE_CITY_STATES)[number];

export const PV_CAPTURE_DOCUMENT_STATES = ["sans_octets", "octets_conserves"] as const;
export type PvCaptureDocumentState = (typeof PV_CAPTURE_DOCUMENT_STATES)[number];

export interface AttachablePvCapture {
  url: string;
  sha256: `sha256:${string}`;
  retrieved_at: string;
  storage_key: string;
  manifest_key: string;
  line_index: number;
  source: string;
}

export interface FailedPvCaptureAttempt {
  url: string;
  requested_at: string;
  retrieved_at: string | null;
  http_status: number | null;
  error: string | null;
  manifest_key: string;
  line_index: number;
}

export interface PvDocumentCaptureKpi {
  url: string;
  state: PvCaptureDocumentState;
  captures: AttachablePvCapture[];
  failed_attempts: FailedPvCaptureAttempt[];
}

export interface PvCityCaptureKpi {
  state: PvCaptureCityState;
  documents: PvDocumentCaptureKpi[];
  documents_total: number;
  documents_with_octets: number;
  documents_without_octets: number;
  failed_attempts_total: number;
}

export interface PvCaptureEvidence {
  attachable: readonly AttachablePvCapture[];
  failed: readonly FailedPvCaptureAttempt[];
}

/**
 * Une mesure S3 ne publie que si les identités (clé, ETag, date) relues sont
 * celles qui ont borné les lectures. Une clé nouvelle ou un manifeste réécrit
 * est donc un échec de mesure, jamais un document implicitement absent.
 */
export function sameS3Snapshot(
  before: readonly (readonly [string, string | null, string | null])[],
  after: readonly (readonly [string, string | null, string | null])[],
): boolean {
  return before.length === after.length && before.every((entry, index) =>
    entry[0] === after[index]?.[0] && entry[1] === after[index]?.[1] && entry[2] === after[index]?.[2]);
}

function compareCapture(left: AttachablePvCapture, right: AttachablePvCapture): number {
  return left.retrieved_at.localeCompare(right.retrieved_at)
    || left.manifest_key.localeCompare(right.manifest_key)
    || left.line_index - right.line_index;
}

function compareFailedAttempt(left: FailedPvCaptureAttempt, right: FailedPvCaptureAttempt): number {
  return left.requested_at.localeCompare(right.requested_at)
    || left.manifest_key.localeCompare(right.manifest_key)
    || left.line_index - right.line_index;
}

/** Classify one literal PV document URL.  Failed fetches remain observable. */
export function classifyPvDocumentCapture(url: string, evidence: PvCaptureEvidence): PvDocumentCaptureKpi {
  const captures = evidence.attachable.filter((capture) => capture.url === url).sort(compareCapture);
  const failedAttempts = evidence.failed.filter((attempt) => attempt.url === url).sort(compareFailedAttempt);
  return {
    url,
    state: captures.length > 0 ? "octets_conserves" : "sans_octets",
    captures,
    failed_attempts: failedAttempts,
  };
}

/**
 * City states are intentionally coarse because they are the owner-requested
 * three-way portfolio KPI.  Partial capture is never hidden: the exact number
 * of documents still without bytes is carried on the same city row.
 */
export function classifyPvCityCapture(
  indexPresent: boolean,
  urls: readonly string[],
  evidence: PvCaptureEvidence,
): PvCityCaptureKpi {
  if (!indexPresent) {
    return {
      state: "sans_index",
      documents: [],
      documents_total: 0,
      documents_with_octets: 0,
      documents_without_octets: 0,
      failed_attempts_total: 0,
    };
  }

  const documents = [...new Set(urls)].sort().map((url) => classifyPvDocumentCapture(url, evidence));
  const documentsWithOctets = documents.filter((document) => document.captures.length > 0).length;
  return {
    state: documentsWithOctets > 0 ? "octets_conserves" : "index_sans_octets",
    documents,
    documents_total: documents.length,
    documents_with_octets: documentsWithOctets,
    documents_without_octets: documents.length - documentsWithOctets,
    failed_attempts_total: documents.reduce((total, document) => total + document.failed_attempts.length, 0),
  };
}
