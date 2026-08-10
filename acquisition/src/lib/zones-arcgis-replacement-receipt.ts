/**
 * Verification gate between the CAPTURE and DEPOSIT jobs for an ArcGIS
 * replacement.  It deliberately has no network code: the caller supplies an
 * S3 reader, and no served object can be built until this function has tied the
 * run header, canonical worklist, manifest row, CAS payload and sidecar
 * together.
 */
import { createHash } from "node:crypto";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
  type CaptureManifestLine,
  type CaptureRunHeader,
} from "../../../packages/qc-sources/src/capture/index.js";
import {
  captureProofIndexSnapshotKey,
  hasCaptureProofRecord,
  parseCaptureProofIndex,
} from "./capture-proof-index.js";
import { verifyRawCapturePayload } from "./zone-provenance-raw-capture.js";
import { captureReceiptFromManifest, type CaptureReceipt } from "./zone-provenance-quality.js";
import { proofFromCaptureEntry, type GeometrySourceProof } from "./zonage-proof.js";
import {
  captureUrlForReplacementTarget,
  parseZonesArcgisReplacementWorklist,
  serializeZonesArcgisReplacementWorklist,
  type ZonesArcgisReplacementTarget,
  type ZonesArcgisReplacementWorklist,
} from "./zones-arcgis-replacement-worklist.js";

const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;

/** Read-only surface used by both the future in-cluster deposit worker and unit tests. */
export interface ReplacementReceiptReader {
  getBytes(key: string): Promise<Buffer>;
}

/**
 * The submitter obtains this fact from the Kubernetes API with the supplied
 * kubeconfig before it schedules DEPOSIT.  `run.json.execution=cluster` alone
 * is deliberately insufficient: it is a statement written by the pod.
 */
export interface CompletedCaptureJob {
  runId: string;
  succeeded: number;
  failed: number;
  completionTime: string;
}

export interface VerifyReplacementReceiptInput {
  runId: string;
  worklistKey: string;
  worklistSha256: `sha256:${string}`;
  /** Content-addressed immutable capture-proof index pinned by the deposit job. */
  proofIndexKey: string;
  captureGitSha: string;
  completedJob: CompletedCaptureJob;
}

export interface VerifiedReplacementReceipt {
  worklist: ZonesArcgisReplacementWorklist;
  target: ZonesArcgisReplacementTarget;
  header: CaptureRunHeader;
  capture: CaptureReceipt;
  proof: GeometrySourceProof;
  bytes: Buffer;
  geojson: { type: "FeatureCollection"; features: unknown[] };
  runKeys: ReturnType<typeof captureRunKeys>;
  proofIndexKey: string;
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertCompletedCaptureJob(job: CompletedCaptureJob, runId: string): void {
  if (
    job.runId !== runId ||
    job.succeeded !== 1 ||
    job.failed !== 0 ||
    Number.isNaN(Date.parse(job.completionTime))
  ) {
    throw new Error("deposit refused: Kubernetes capture Job is not a single successful completed run");
  }
}

function parseCanonicalWorklist(bytes: Buffer, expectedSha256: string): ZonesArcgisReplacementWorklist {
  if (!SHA256_RE.test(expectedSha256)) throw new Error("deposit refused: WORKLIST_SHA256 is invalid");
  const actual = digest(bytes);
  if (actual !== expectedSha256) {
    throw new Error(`deposit refused: immutable worklist digest differs (${actual} != ${expectedSha256})`);
  }
  const body = bytes.toString("utf8");
  const worklist = parseZonesArcgisReplacementWorklist(JSON.parse(body) as unknown);
  if (body !== serializeZonesArcgisReplacementWorklist(worklist)) {
    throw new Error("deposit refused: worklist bytes are not canonical");
  }
  return worklist;
}

function exactTargetLine(
  lines: readonly CaptureManifestLine[],
  target: ZonesArcgisReplacementTarget,
  expectedUrl: string,
): { line: CaptureManifestLine; index: number } {
  const attempts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.source === "zones-arcgis" && line.slugs.includes(target.slug));
  if (attempts.length !== 1) {
    throw new Error(`deposit refused: expected exactly one captured ArcGIS attempt for ${target.slug}, got ${attempts.length}`);
  }
  const attempt = attempts[0]!;
  if (
    attempt.line.run_id === "" ||
    attempt.line.method !== "GET" ||
    attempt.line.url !== expectedUrl ||
    attempt.line.http_status === null ||
    attempt.line.http_status < 200 ||
    attempt.line.http_status >= 300 ||
    attempt.line.robots !== "allowed" ||
    attempt.line.error !== null ||
    attempt.line.redacted ||
    attempt.line.slugs.length !== 1 ||
    attempt.line.slugs[0] !== target.slug
  ) {
    throw new Error("deposit refused: target capture row is not the exact successful, robots-allowed ArcGIS request");
  }
  return attempt;
}

function parseFeatureCollection(bytes: Buffer): { type: "FeatureCollection"; features: unknown[] } {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("deposit refused: captured CAS payload is not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("deposit refused: captured CAS payload is not a GeoJSON FeatureCollection");
  }
  const fc = value as { type?: unknown; features?: unknown };
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features) || fc.features.length === 0) {
    throw new Error("deposit refused: captured CAS payload is empty or not a GeoJSON FeatureCollection");
  }
  return { type: "FeatureCollection", features: fc.features };
}

/**
 * Re-read every durable receipt object and derive the proof tuple solely from
 * the matching manifest entry.  No source URL, retrieval time or hash is an
 * argument to this function, so the DEPOSIT path has no place to invent one.
 */
export async function verifyZonesArcgisReplacementReceipt(
  reader: ReplacementReceiptReader,
  input: VerifyReplacementReceiptInput,
): Promise<VerifiedReplacementReceipt> {
  if (!GIT_SHA_RE.test(input.captureGitSha)) throw new Error("deposit refused: CAPTURE_GIT_SHA must be a full git SHA");
  assertCompletedCaptureJob(input.completedJob, input.runId);

  const runKeys = captureRunKeys(input.runId);
  const [worklistBytes, headerBytes, manifestBytes, logBytes] = await Promise.all([
    reader.getBytes(input.worklistKey),
    reader.getBytes(runKeys.header),
    reader.getBytes(runKeys.manifest),
    reader.getBytes(runKeys.log),
  ]);
  if (logBytes.length === 0) throw new Error("deposit refused: run.log is absent or empty");

  const worklist = parseCanonicalWorklist(worklistBytes, input.worklistSha256);
  const header = CaptureRunHeaderSchema.parse(JSON.parse(headerBytes.toString("utf8")));
  if (
    header.run_id !== input.runId ||
    header.lane !== "zones" ||
    header.execution !== "cluster" ||
    header.git_sha !== input.captureGitSha ||
    header.worklist !== input.worklistKey ||
    header.finished_at === null ||
    header.exit_code !== 0
  ) {
    throw new Error("deposit refused: run.json does not attest the expected finished cluster capture");
  }

  const lines = parseManifestJsonl(manifestBytes.toString("utf8"));
  const target = worklist.targets[0];
  const expectedUrl = captureUrlForReplacementTarget(target);
  const { line, index } = exactTargetLine(lines, target, expectedUrl);
  if (line.run_id !== input.runId) throw new Error("deposit refused: target manifest row belongs to another run");
  const capture = captureReceiptFromManifest(line, runKeys.manifest, index);
  if (capture === null) throw new Error("deposit refused: target manifest row has no complete CAS receipt");

  const [bytes, sidecarBytes] = await Promise.all([
    reader.getBytes(capture.storage_key),
    reader.getBytes(`${capture.storage_key}.meta.json`),
  ]);
  let sidecar: unknown;
  try {
    sidecar = JSON.parse(sidecarBytes.toString("utf8"));
  } catch {
    throw new Error("deposit refused: raw CAS sidecar is not JSON");
  }
  const raw = verifyRawCapturePayload(capture, bytes, sidecar);
  if (!raw.verified) throw new Error(`deposit refused: raw CAS receipt failed verification (${raw.reason ?? "unknown"})`);

  const proof = proofFromCaptureEntry(line, { type: "arcgis", method: "natif", reliability: "directe" });
  const proofIndexBytes = await reader.getBytes(input.proofIndexKey);
  if (captureProofIndexSnapshotKey(proofIndexBytes) !== input.proofIndexKey) {
    throw new Error("deposit refused: proof index key does not match its content digest");
  }
  const proofIndex = parseCaptureProofIndex(proofIndexBytes);
  if (!hasCaptureProofRecord(proofIndex, {
    url: proof.url,
    retrieved_at: proof.retrieved_at,
    sha256: proof.sha256,
    run_id: input.runId,
    manifest_key: capture.manifest_key,
    manifest_line: capture.line_index,
    storage_key: capture.storage_key,
  })) {
    throw new Error("deposit refused: pinned proof index does not attest the exact capture receipt");
  }
  return {
    worklist, target, header, capture, proof, bytes, geojson: parseFeatureCollection(bytes), runKeys,
    proofIndexKey: input.proofIndexKey,
  };
}
