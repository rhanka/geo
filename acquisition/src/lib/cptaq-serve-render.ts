// §9 stage-2 — PURE render of the CPTAQ serve Job manifest (no S3/fs). Lives in the
// lib (CI-typechecked + tested) so the "the rendered manifest is deployable" contract is
// ENFORCED pre-merge, not discovered at `kubectl apply` (REX: merged ≠ deployable — a
// >63-char Job name shipped a >63-char pod label and the server rejected the apply).
// The deploy apply-script (deploy/constraints/render-cptaq-serve.ts) reads S3 then calls this.
import { createHash } from "node:crypto";

export interface CptaqServeRenderParams {
  /** Full capture run stamp, e.g. "constraints-20260901T131718Z-0-<uuid>". */
  runStamp: string;
  /** Proof-bound raw CAS key, e.g. "raw/cptaq/cas/<64hex>.bin". */
  rawCasKey: string;
  /** Full capture manifest key, e.g. "capture/_runs/<runStamp>/manifest.jsonl". */
  captureManifestKey: string;
}

/**
 * k8s hard limit for a LABEL VALUE (RFC 1123). A Job's pod template gets an
 * auto-injected `batch.kubernetes.io/job-name` label equal to `metadata.name`, so the
 * Job name is ALSO bound by this limit — a >63-char name fails `apply` server-side.
 */
export const K8S_LABEL_VALUE_MAX = 63;

/**
 * Deterministic, bounded run slug: 12 hex of sha256(runStamp). Used for the Job name
 * (`cptaq-serve-<slug>`) and the `geo.run` label. The FULL run identity is preserved in
 * the `geo.sentropic/run-id` annotation (annotations have no length cap), so nothing is
 * lost by shortening the name.
 */
export function cptaqServeRunSlug(runStamp: string): string {
  return createHash("sha256").update(runStamp).digest("hex").slice(0, 12);
}

/** The Job's metadata.name for a run — `cptaq-serve-<slug>`, ≤ K8S_LABEL_VALUE_MAX by construction. */
export function cptaqServeJobName(runStamp: string): string {
  return `cptaq-serve-${cptaqServeRunSlug(runStamp)}`;
}

/**
 * Render the committed cptaq-serve Job template for a run. PURE: template text +
 * proof-bound keys → manifest YAML. Substitutes every `REPLACE_*` placeholder and throws
 * if any remains (a missed placeholder would ship a literal `REPLACE_*` to the cluster).
 */
export function renderCptaqServeJob(tmpl: string, params: CptaqServeRenderParams): string {
  const { runStamp, rawCasKey, captureManifestKey } = params;
  const rendered = tmpl
    .replaceAll("REPLACE_JOB_SLUG", cptaqServeRunSlug(runStamp))
    .replaceAll("REPLACE_RUN_ID", runStamp)
    .replaceAll("REPLACE_RAW_KEY", rawCasKey)
    .replaceAll("REPLACE_MANIFEST_KEY", captureManifestKey);
  const leftover = rendered.match(/REPLACE_[A-Z_]+/);
  if (leftover) throw new Error(`cptaq-serve render: unsubstituted placeholder ${leftover[0]}`);
  return rendered;
}
