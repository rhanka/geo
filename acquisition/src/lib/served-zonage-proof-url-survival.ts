import type { CaptureWorklistTarget } from "../../../packages/qc-sources/src/capture/index.js";
import { arcgisLayerEndpointFromCaptureUrl } from "./served-zonage-immo-proof-url-capture-worklist.js";

export type SurvivalClass = "GEOMETRIE" | "PAGE HTML" | "404" | "AUTRE";

export interface ProbeAttemptForSurvival {
  url: string;
  http_status: number | null;
  classification: "GEOMETRIE" | "PAGE HTML" | "AUTRE";
  detail: string;
}

export interface ProbeForSurvival {
  endpoint: string;
  selected_url: string | null;
  attempts: ProbeAttemptForSurvival[];
}

export interface SurvivalObservation {
  candidate_url: string;
  served_url: string;
  classification: SurvivalClass;
  detail: string;
  lot: string;
  evidence: string;
}

export interface SurvivalRow extends SurvivalObservation {
  candidate_identity: string;
  slug: string;
}

export interface SurvivalReport {
  contract: "served-zonage-proof-url-survival/v1";
  complete: boolean;
  candidates: {
    targets: number;
    unique_urls: number;
    unique_identities: number;
  };
  measurements: {
    observed: number;
    duplicate_observations: number;
    missing: number;
  };
  partition: {
    GEOMETRIE: number;
    "PAGE HTML": number;
    "404": number;
    AUTRE: number;
    total: number;
    closed: boolean;
  };
  survival_rate: number;
  lots: Array<{
    lot: string;
    GEOMETRIE: number;
    "PAGE HTML": number;
    "404": number;
    AUTRE: number;
    total: number;
  }>;
  missing: Array<{ candidate_identity: string; candidate_url: string; slug: string }>;
  rows: SurvivalRow[];
}

export function proofUrlCandidateIdentity(url: string): string {
  const endpoint = arcgisLayerEndpointFromCaptureUrl(url);
  if (endpoint !== null) return endpoint;
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

export function observationFromProbe(probe: ProbeForSurvival, lot: string, evidence: string): SurvivalObservation {
  if (probe.selected_url !== null) {
    const selected = probe.attempts.find((attempt) => attempt.url === probe.selected_url);
    if (selected === undefined || selected.classification !== "GEOMETRIE") {
      throw new Error(`selected probe URL lacks geometric octet evidence: ${probe.endpoint}`);
    }
    return {
      candidate_url: probe.endpoint,
      served_url: probe.selected_url,
      classification: "GEOMETRIE",
      detail: selected.detail,
      lot,
      evidence,
    };
  }
  if (probe.attempts.length > 0 && probe.attempts.every((attempt) => attempt.http_status === 404)) {
    return {
      candidate_url: probe.endpoint,
      served_url: probe.attempts[0]!.url,
      classification: "404",
      detail: "all-probed-representations-http-404",
      lot,
      evidence,
    };
  }
  const html = probe.attempts.find((attempt) => attempt.http_status === 200 && attempt.classification === "PAGE HTML");
  if (html !== undefined) {
    return {
      candidate_url: probe.endpoint,
      served_url: html.url,
      classification: "PAGE HTML",
      detail: html.detail,
      lot,
      evidence,
    };
  }
  const first = probe.attempts[0];
  return {
    candidate_url: probe.endpoint,
    served_url: first?.url ?? probe.endpoint,
    classification: "AUTRE",
    detail: first?.detail ?? "probe-without-response",
    lot,
    evidence,
  };
}

function sameOutcome(left: SurvivalObservation, right: SurvivalObservation): boolean {
  return left.classification === right.classification && left.served_url === right.served_url;
}

export function buildProofUrlSurvivalReport(
  candidates: readonly CaptureWorklistTarget[],
  observations: readonly SurvivalObservation[],
): SurvivalReport {
  const expected = new Map<string, { candidateUrl: string; slug: string }>();
  const candidateUrls = new Set<string>();
  for (const target of candidates) {
    for (const url of target.urls) {
      candidateUrls.add(url);
      const identity = proofUrlCandidateIdentity(url);
      const prior = expected.get(identity);
      if (prior !== undefined && prior.candidateUrl !== url) {
        throw new Error(`candidate identity has multiple URL representations: ${identity}`);
      }
      if (prior === undefined) expected.set(identity, { candidateUrl: url, slug: target.slug });
    }
  }

  const measured = new Map<string, SurvivalObservation>();
  let duplicates = 0;
  for (const observation of observations) {
    const identity = proofUrlCandidateIdentity(observation.candidate_url);
    if (!expected.has(identity)) continue;
    const prior = measured.get(identity);
    if (prior !== undefined) {
      duplicates++;
      if (!sameOutcome(prior, observation)) {
        throw new Error(`candidate has conflicting survival observations: ${identity}`);
      }
      continue;
    }
    measured.set(identity, observation);
  }

  const rows: SurvivalRow[] = [];
  const missing: SurvivalReport["missing"] = [];
  for (const [identity, candidate] of expected) {
    const observation = measured.get(identity);
    if (observation === undefined) {
      missing.push({ candidate_identity: identity, candidate_url: candidate.candidateUrl, slug: candidate.slug });
      continue;
    }
    rows.push({
      candidate_identity: identity,
      candidate_url: candidate.candidateUrl,
      slug: candidate.slug,
      served_url: observation.served_url,
      classification: observation.classification,
      detail: observation.detail,
      lot: observation.lot,
      evidence: observation.evidence,
    });
  }
  rows.sort((left, right) => left.candidate_identity.localeCompare(right.candidate_identity));
  missing.sort((left, right) => left.candidate_identity.localeCompare(right.candidate_identity));

  const partition = {
    GEOMETRIE: 0,
    "PAGE HTML": 0,
    "404": 0,
    AUTRE: 0,
    total: rows.length,
    closed: rows.length === expected.size,
  };
  const byLot = new Map<string, Omit<SurvivalReport["lots"][number], "lot">>();
  for (const row of rows) {
    partition[row.classification]++;
    const lot = byLot.get(row.lot) ?? { GEOMETRIE: 0, "PAGE HTML": 0, "404": 0, AUTRE: 0, total: 0 };
    lot[row.classification]++;
    lot.total++;
    byLot.set(row.lot, lot);
  }

  return {
    contract: "served-zonage-proof-url-survival/v1",
    complete: partition.closed,
    candidates: {
      targets: candidates.length,
      unique_urls: candidateUrls.size,
      unique_identities: expected.size,
    },
    measurements: {
      observed: rows.length,
      duplicate_observations: duplicates,
      missing: missing.length,
    },
    partition,
    survival_rate: partition.total === 0 ? 0 : partition.GEOMETRIE / partition.total,
    lots: [...byLot.entries()]
      .map(([lot, counts]) => ({ lot, ...counts }))
      .sort((left, right) => left.lot.localeCompare(right.lot)),
    missing,
    rows,
  };
}
