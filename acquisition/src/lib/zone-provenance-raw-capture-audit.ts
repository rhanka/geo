/**
 * Pure classification for the read-only raw-capture audit.
 *
 * This deliberately does not weaken the v2 join.  It only explains why a
 * served proof did not join a capture receipt, retaining the exact values read
 * from both authorities for a human audit.
 */
import type { CaptureManifestLine } from "../../../packages/qc-sources/src/capture/index.js";

import type { CaptureReceipt } from "./zone-provenance-quality.js";

export interface RawCaptureAuditProof {
  url: string;
  retrieved_at: string;
  sha256: `sha256:${string}`;
}

export interface RawCaptureAuditBaseline {
  city_slug: string;
  collection_key: string | null;
  proof: RawCaptureAuditProof;
}

export interface RawCaptureAuditManifestLine {
  manifest_key: string;
  line_index: number;
  line: CaptureManifestLine;
  receipt: CaptureReceipt | null;
}

export interface RawCaptureAuditDifference {
  field: "url" | "retrieved_at" | "sha256";
  served: string;
  manifest: string | null;
}

export interface RawCaptureAuditManifestCandidate {
  manifest_key: string;
  line_index: number;
  proof: {
    url: string;
    retrieved_at: string | null;
    sha256: string | null;
  };
}

export type RawCaptureAuditDisposition =
  | {
    cause: "a";
    reason: "no-manifest-line-for-city-slug";
    manifest_lines_for_city: 0;
  }
  | {
    cause: "b";
    reason: "manifest-line-shares-two-proof-fields";
    manifest_lines_for_city: number;
    candidate: RawCaptureAuditManifestCandidate;
    fields_differ: RawCaptureAuditDifference[];
  }
  | {
    cause: "d";
    reason: "manifest-lines-for-city-do-not-identify-the-served-fetch";
    manifest_lines_for_city: number;
    candidates: RawCaptureAuditManifestCandidate[];
  }
  | {
    cause: "d";
    reason: "matching-manifest-line-is-not-a-valid-capture-receipt";
    manifest_lines_for_city: number;
    candidate: RawCaptureAuditManifestCandidate;
  }
  | {
    cause: "d";
    reason: "matching-manifest-receipt-awaits-cas-verification";
    manifest_lines_for_city: number;
    receipt: CaptureReceipt;
  };

function candidate(value: RawCaptureAuditManifestLine): RawCaptureAuditManifestCandidate {
  return {
    manifest_key: value.manifest_key,
    line_index: value.line_index,
    proof: {
      url: value.line.url,
      retrieved_at: value.line.retrieved_at,
      sha256: value.line.sha256,
    },
  };
}

function differences(
  baseline: RawCaptureAuditProof,
  line: CaptureManifestLine,
): RawCaptureAuditDifference[] {
  const fields: Array<keyof RawCaptureAuditProof> = ["url", "retrieved_at", "sha256"];
  return fields.flatMap((field) => baseline[field] === line[field]
    ? []
    : [{ field, served: baseline[field], manifest: line[field] }]);
}

/**
 * Classify a missing exact join without treating URL normalization, timestamp
 * rounding, or content identity as interchangeable.  A (b) result requires
 * two verbatim tuple fields; a same-city line with fewer shared fields remains
 * explicitly inconclusive (d), rather than being promoted by plausibility.
 */
export function classifyRawCaptureAuditBaseline(
  baseline: RawCaptureAuditBaseline,
  scanned: readonly RawCaptureAuditManifestLine[],
): RawCaptureAuditDisposition {
  const cityLines = scanned.filter((entry) => entry.line.slugs.includes(baseline.city_slug));
  if (cityLines.length === 0) {
    return { cause: "a", reason: "no-manifest-line-for-city-slug", manifest_lines_for_city: 0 };
  }

  const exact = cityLines.find((entry) => differences(baseline.proof, entry.line).length === 0);
  if (exact) {
    if (exact.receipt === null) {
      return {
        cause: "d",
        reason: "matching-manifest-line-is-not-a-valid-capture-receipt",
        manifest_lines_for_city: cityLines.length,
        candidate: candidate(exact),
      };
    }
    return {
      cause: "d",
      reason: "matching-manifest-receipt-awaits-cas-verification",
      manifest_lines_for_city: cityLines.length,
      receipt: exact.receipt,
    };
  }

  const compared = cityLines
    .map((entry) => ({ entry, fields_differ: differences(baseline.proof, entry.line) }))
    .sort((left, right) => left.fields_differ.length - right.fields_differ.length
      || left.entry.manifest_key.localeCompare(right.entry.manifest_key)
      || left.entry.line_index - right.entry.line_index);
  const closest = compared[0]!;
  if (closest.fields_differ.length === 1) {
    return {
      cause: "b",
      reason: "manifest-line-shares-two-proof-fields",
      manifest_lines_for_city: cityLines.length,
      candidate: candidate(closest.entry),
      fields_differ: closest.fields_differ,
    };
  }
  return {
    cause: "d",
    reason: "manifest-lines-for-city-do-not-identify-the-served-fetch",
    manifest_lines_for_city: cityLines.length,
    candidates: compared.map(({ entry }) => candidate(entry)),
  };
}
