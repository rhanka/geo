/**
 * Pure rules for the règlement capture KPI.
 *
 * The runner owns S3 I/O.  This module deliberately does not canonicalise URL
 * strings: a change is observable only between two captures of the *exact same
 * served URL.  Similar-looking URLs are never merged into an invented event.
 */

export const REGLEMENT_CAPTURE_CITY_STATES = [
  "unknown",
  "jamais_capture",
  "capture_inchange",
  "change",
] as const;
export type ReglementCaptureCityState = (typeof REGLEMENT_CAPTURE_CITY_STATES)[number];

export const REGLEMENT_CAPTURE_URL_STATES = [
  "jamais_capture",
  "capture_inchange",
  "change",
] as const;
export type ReglementCaptureUrlState = (typeof REGLEMENT_CAPTURE_URL_STATES)[number];

export interface AttachableCapture {
  url: string;
  sha256: `sha256:${string}`;
  retrieved_at: string;
  storage_key: string;
  manifest_key: string;
  line_index: number;
  source: string;
}

export interface FailedCaptureAttempt {
  url: string;
  requested_at: string;
  retrieved_at: string | null;
  http_status: number | null;
  error: string | null;
  manifest_key: string;
  line_index: number;
}

export interface CaptureChange {
  previous: Pick<AttachableCapture, "sha256" | "retrieved_at" | "storage_key" | "manifest_key" | "line_index">;
  current: Pick<AttachableCapture, "sha256" | "retrieved_at" | "storage_key" | "manifest_key" | "line_index">;
}

export interface UrlCaptureKpi {
  url: string;
  state: ReglementCaptureUrlState;
  captures: AttachableCapture[];
  failed_attempts: FailedCaptureAttempt[];
  change: CaptureChange | null;
}

export interface CityCaptureKpi {
  state: ReglementCaptureCityState;
  urls: UrlCaptureKpi[];
  urls_total: number;
  urls_captured: number;
  urls_missing_capture: number;
  changes: Array<{ url: string; change: CaptureChange }>;
}

export interface ReglementUrlObservation {
  urls: string[];
  feature_count: number;
  features_with_reglement_url: number;
  features_with_http_reglement_url: number;
  features_with_invalid_reglement_url: number;
}

export interface CaptureEvidence {
  attachable: readonly AttachableCapture[];
  failed: readonly FailedCaptureAttempt[];
}

export function exactHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function compareCapture(left: AttachableCapture, right: AttachableCapture): number {
  return left.retrieved_at.localeCompare(right.retrieved_at)
    || left.manifest_key.localeCompare(right.manifest_key)
    || left.line_index - right.line_index;
}

function compareFailedAttempt(left: FailedCaptureAttempt, right: FailedCaptureAttempt): number {
  return left.requested_at.localeCompare(right.requested_at)
    || left.manifest_key.localeCompare(right.manifest_key)
    || left.line_index - right.line_index;
}

/** Extract only literal, HTTP(S) `reglement_url` values from a served collection. */
export function observeReglementUrls(collection: unknown): ReglementUrlObservation {
  const features = collection && typeof collection === "object" && Array.isArray((collection as { features?: unknown }).features)
    ? (collection as { features: unknown[] }).features
    : [];
  const urls = new Set<string>();
  let featuresWithUrl = 0;
  let featuresWithHttpUrl = 0;
  let featuresWithInvalidUrl = 0;
  for (const feature of features) {
    const properties = feature && typeof feature === "object"
      ? (feature as { properties?: unknown }).properties
      : null;
    const value = properties && typeof properties === "object" && !Array.isArray(properties)
      ? (properties as Record<string, unknown>)["reglement_url"]
      : undefined;
    if (typeof value !== "string" || value.length === 0) continue;
    featuresWithUrl++;
    if (!exactHttpUrl(value)) {
      featuresWithInvalidUrl++;
      continue;
    }
    featuresWithHttpUrl++;
    urls.add(value);
  }
  return {
    urls: [...urls].sort(),
    feature_count: features.length,
    features_with_reglement_url: featuresWithUrl,
    features_with_http_reglement_url: featuresWithHttpUrl,
    features_with_invalid_reglement_url: featuresWithInvalidUrl,
  };
}

/** Classify one exact served URL.  A 404 remains in `failed_attempts`, never CAS evidence. */
export function classifyReglementUrlCapture(url: string, evidence: CaptureEvidence): UrlCaptureKpi {
  const captures = evidence.attachable.filter((capture) => capture.url === url).sort(compareCapture);
  const failedAttempts = evidence.failed.filter((attempt) => attempt.url === url).sort(compareFailedAttempt);
  const distinctSha = new Set(captures.map((capture) => capture.sha256));
  if (captures.length === 0) {
    return { url, state: "jamais_capture", captures, failed_attempts: failedAttempts, change: null };
  }
  if (distinctSha.size === 1) {
    return { url, state: "capture_inchange", captures, failed_attempts: failedAttempts, change: null };
  }

  const current = captures[captures.length - 1]!;
  const previous = [...captures].reverse().find((capture) => capture.sha256 !== current.sha256);
  // `distinctSha.size > 1` makes this impossible only if the input is corrupted.
  if (!previous) throw new Error(`captures incohérentes pour ${url}: deux sha distincts sans prédécesseur`);
  return {
    url,
    state: "change",
    captures,
    failed_attempts: failedAttempts,
    change: {
      previous: {
        sha256: previous.sha256,
        retrieved_at: previous.retrieved_at,
        storage_key: previous.storage_key,
        manifest_key: previous.manifest_key,
        line_index: previous.line_index,
      },
      current: {
        sha256: current.sha256,
        retrieved_at: current.retrieved_at,
        storage_key: current.storage_key,
        manifest_key: current.manifest_key,
        line_index: current.line_index,
      },
    },
  };
}

/**
 * City state is an event state: one observed changed URL makes the city
 * `change`; otherwise an attachable capture makes it `capture_inchange`.
 * `urls_missing_capture` retains partial coverage explicitly instead of
 * pretending that a captured URL covered a second URL in the same city.
 */
export function classifyReglementCityCapture(urls: readonly string[], evidence: CaptureEvidence): CityCaptureKpi {
  if (urls.length === 0) {
    return { state: "unknown", urls: [], urls_total: 0, urls_captured: 0, urls_missing_capture: 0, changes: [] };
  }
  const states = [...new Set(urls)].sort().map((url) => classifyReglementUrlCapture(url, evidence));
  const changes = states.flatMap((entry) => entry.change ? [{ url: entry.url, change: entry.change }] : []);
  const captured = states.filter((entry) => entry.captures.length > 0).length;
  return {
    state: changes.length > 0 ? "change" : captured > 0 ? "capture_inchange" : "jamais_capture",
    urls: states,
    urls_total: states.length,
    urls_captured: captured,
    urls_missing_capture: states.length - captured,
    changes,
  };
}
