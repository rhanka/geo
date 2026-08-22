/**
 * NHI identity derivation — per-LANE STABLE ServiceAccount (DEFINITIVE / mesh
 * verdict, dossier D2 `8fff840a`). Final target:
 *   stable per-lane SA → lane in the verified `sub` (EXACT gateway registration)
 *   → audience = the gateway id (pure).
 *
 * Two carriers, DELIBERATELY different roles:
 *
 *  - ServiceAccount NAME `s3dag-<lane>-sa` — ONE STABLE SA per real lane, reused
 *    across ALL runs of that lane (NOT per-run, NOT per-lot). The reconciler
 *    self-ships the lanes' SAs + RBAC so a Job may bind ONLY its own lane's SA;
 *    the pod never chooses its SA, so the api-server-signed `sub` is non-spoofable.
 *    The gateway maps the EXACT `sub` → workspaceId via an EXACT registration (no
 *    prefix/pattern match — mesh's non-negotiable clause; hence no name parsing and
 *    no hyphen concern). The RUN lives in labels / the run-id, never in the SA name.
 *
 *  - Projected-token AUDIENCE — PURELY the gateway id (the token's recipient). It
 *    is NOT the lane carrier (the `sub` is). A node with no gateway audience mounts
 *    no projected token.
 *
 * Target (b) token-exchange (conditioned on `@sentropic/cluster-mesh` ownership)
 * would change only the MINTING, never this DAG/identity shape.
 */

import { createHash } from "node:crypto";

import type { JobIdentity } from "./ports.js";

const DNS1123_LABEL_MAX = 63;
const DNS1123_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const sanitizeLabel = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

/**
 * The STABLE per-lane ServiceAccount name `s3dag-<lane>-sa`, DNS-1123 label-safe
 * (≤63 chars) and identical across every run of the lane. Hyphenated lanes
 * (`usage-dominant`, …) are preserved verbatim; only a pathological over-long lane
 * collapses to a deterministic hash. The gateway registers this exact name — never
 * a prefix — so the value must be stable and exact.
 */
export function laneServiceAccountName(lane: string): string {
  const laneS = sanitizeLabel(lane) || "lane";
  const naive = `s3dag-${laneS}-sa`;
  if (naive.length <= DNS1123_LABEL_MAX && DNS1123_LABEL_RE.test(naive)) return naive;
  return `s3dag-${shortHash(lane)}-sa`;
}

/**
 * Build the {@link JobIdentity} for a node in a lane: the STABLE per-lane SA (the
 * lane carrier, via its verified `sub`) plus the node's gateway audiences verbatim
 * (the audience is purely the gateway id, NOT lane-scoped). A node that declares no
 * audiences mounts no projected token.
 */
export function laneIdentity(input: { lane: string; baseAudiences: readonly string[] }): JobIdentity {
  return {
    serviceAccountName: laneServiceAccountName(input.lane),
    tokenAudiences: [...input.baseAudiences],
  };
}
