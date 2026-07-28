/** Deterministic selection of legacy zoning proof URLs for cluster recapture. */
import type { CaptureWorklistTarget } from "../../../packages/qc-sources/src/capture/index.js";

export interface ProofUrlCase {
  envelope_public_urls: Array<{ url: string }>;
}

export interface ProofUrlAuditRow {
  slug: string;
  s3_cases: ProofUrlCase[];
  query_cases?: Array<{ url: string }>;
}

function isSimpleHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0 && parsed.search.length === 0 && parsed.hash.length === 0;
  } catch {
    return false;
  }
}

function isArcgisQueryUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.search.length > 0 && /arcgis/i.test(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return false;
  }
}

/**
 * Selects only v1/S3-proof collections whose served envelope still exposes a
 * public, replayable HTTPS origin.  It deliberately does not manufacture the
 * ArcGIS query parameters needed by a separate capture lane.
 */
export function selectProofUrlRecaptureWorklist(
  rows: readonly ProofUrlAuditRow[],
  excludedSlugs: ReadonlySet<string>,
  offset: number,
  limit: number,
): CaptureWorklistTarget[] {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");

  const candidates = rows
    .filter((row) => row.s3_cases.length > 0)
    .filter((row) => !excludedSlugs.has(row.slug))
    .filter((row) => !(row.query_cases ?? []).some((entry) => isArcgisQueryUrl(entry.url)))
    .map((row) => ({
      slug: row.slug,
      urls: [...new Set(row.s3_cases.flatMap((item) => item.envelope_public_urls.map((entry) => entry.url)))]
        .filter(isSimpleHttpsUrl)
        .sort(),
    }))
    .filter((row) => row.urls.length > 0)
    .sort((left, right) => left.slug.localeCompare(right.slug));

  return candidates.slice(offset, offset + limit).map((row) => ({
    slug: row.slug,
    // This is an attestation capture of a v1 proof URL, not a claim that every
    // source shares one vendor protocol.  The generic source remains an honest
    // CAS namespace until the later proof-restamping pass classifies it.
    source: "zones-v1-proof-url",
    urls: row.urls,
  }));
}
