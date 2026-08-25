import {
  assertCampaignScope,
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  CAMPAIGN_BUCKET,
  OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
  type ObjectStoreCampaignOwnerGo,
  type Sha256Ref,
} from "./object-store-campaign-gate.js";

/** Le manifeste soumis fixe lui aussi GEO_CAPTURE_EXECUTION="cluster" (CA-G2). */
export const SUBMITTED_JOB_EXECUTION: "cluster" = "cluster";

export type LaneGatedCaptureOwnerGoArtifact = Omit<
  ObjectStoreCampaignOwnerGo,
  "h2a_envelope_id" | "h2a_session_id"
> &
  Partial<Pick<ObjectStoreCampaignOwnerGo, "h2a_envelope_id" | "h2a_session_id">>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertSha(value: unknown, label: string): asserts value is Sha256Ref {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label}: SHA-256 invalide (attendu sha256:<64hex>)`);
  }
}

/**
 * CA-G8 — autorisation proportionnée, strictement réservée à la capture
 * additive : parole DIRECTE de l'owner vérifiée par la lane exécutante k8s
 * depuis SON inbox h2a + frontière de lancement RBAC (le kubeconfig OVH n'est
 * détenu que par k8s) + binding design_sha256 + CA-G2 + dépôt create-once.
 *
 * La relecture du store h2a est SAUTÉE proportionnellement au caractère
 * additif/réversible de proof-v2. Cette autorisation n'est JAMAIS valide pour
 * un scope d'écriture, notamment write-rekey ou write-legacy-merge.
 */
export function assertLaneGatedCaptureAuthorized(input: {
  execution: "local" | "cluster";
  runnerGitSha: string;
  method: Record<string, unknown>;
  targets: readonly unknown[];
  ownerGoArtifact: unknown;
}): { designSha256: Sha256Ref } {
  if (input.execution !== SUBMITTED_JOB_EXECUTION) {
    throw new Error(
      `lane-gated capture refusé: execution="${input.execution}" — CA-G2 exige "cluster" (jamais local)`,
    );
  }

  const plan = buildCampaignExecutionPlan({
    scope: "capture",
    runnerGitSha: input.runnerGitSha,
    method: input.method,
    targets: input.targets,
  });
  const designSha256 = campaignDesignSha256(plan);
  const artefact = input.ownerGoArtifact;

  if (!isRecord(artefact)) {
    throw new Error("lane-gated capture refusé: artefact owner-go complet requis");
  }
  if (artefact.contract !== OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT) {
    throw new Error("lane-gated capture refusé: contract object-store-campaign-owner-go/v1 requis");
  }
  if (!isRecord(artefact.actor) || artefact.actor.role !== "OWNER") {
    throw new Error("lane-gated capture refusé: actor.role=OWNER requis (relais geo-cond insuffisant)");
  }
  if (artefact.via !== "geo-cond" || artefact.owner_go_direct !== true) {
    throw new Error("lane-gated capture refusé: go owner DIRECT via geo-cond requis");
  }

  assertCampaignScope(artefact.scope);
  if (artefact.scope !== "capture") {
    throw new Error(
      `lane-gated capture refusé: CA-G8 capture-only interdit le scope ${artefact.scope}; ` +
        "write-rekey/write-legacy-merge gardent le firewall complet",
    );
  }
  if (artefact.bucket !== CAMPAIGN_BUCKET) {
    throw new Error(`lane-gated capture refusé: bucket doit être ${CAMPAIGN_BUCKET}`);
  }
  if (!nonEmpty(artefact.actor.instance)) {
    throw new Error("lane-gated capture refusé: actor.instance non vide requis");
  }
  if (!nonEmpty(artefact.owner_instance)) {
    throw new Error("lane-gated capture refusé: owner_instance non vide requis");
  }
  if (!nonEmpty(artefact.geo_cond_instance)) {
    throw new Error("lane-gated capture refusé: geo_cond_instance non vide requis");
  }
  if (artefact.h2a_envelope_id !== undefined && !nonEmpty(artefact.h2a_envelope_id)) {
    throw new Error("lane-gated capture refusé: h2a_envelope_id doit être non vide lorsqu'il est présent");
  }
  if (artefact.h2a_session_id !== undefined && !nonEmpty(artefact.h2a_session_id)) {
    throw new Error("lane-gated capture refusé: h2a_session_id doit être non vide lorsqu'il est présent");
  }

  assertSha(artefact.design_sha256, "lane-gated capture owner-go design_sha256");
  if (artefact.design_sha256 !== designSha256) {
    throw new Error(
      "lane-gated capture refusé: design_sha256 ne vise pas le plan résolu réel du runner (binding rompu)",
    );
  }
  return { designSha256 };
}
