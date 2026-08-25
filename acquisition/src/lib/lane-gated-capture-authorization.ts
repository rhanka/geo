import {
  assertClaimedArtefact,
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  type ObjectStoreCampaignOwnerGo,
  type Sha256Ref,
} from "./object-store-campaign-gate.js";

/** Le manifeste soumis fixe lui aussi GEO_CAPTURE_EXECUTION="cluster" (CA-G2). */
export const SUBMITTED_JOB_EXECUTION: "cluster" = "cluster";

/**
 * L'artefact owner-go COMPLET que le lane exécutant (k8s) a lu+vérifié depuis SON
 * inbox h2a authentifié, puis copié verbatim dans un fichier. `h2a_envelope_id` /
 * `h2a_session_id` sont REQUIS (hook de provenance : ils lient l'artefact au message
 * inbox réel — k8s cross-check `h2a_envelope_id == le message qu'il a copié` à son
 * runbook et l'enregistre comme preuve C3). C'est le MÊME type que le firewall plein :
 * le field-check est RÉUTILISÉ (`assertClaimedArtefact`) — single-source, drift-proof
 * (il reçoit tout durcissement futur du gate, p.ex. Q-CRYPTO).
 */
export type LaneGatedCaptureOwnerGoArtifact = ObjectStoreCampaignOwnerGo;

/**
 * CA-G8 — autorisation PROCÉDURALE, strictement réservée à la capture ADDITIVE.
 *
 * ⚠ L'ancre anti-forge de ce mode est PROCÉDURALE, PAS cryptographique : le runner
 * FIELD-CHECK l'artefact (intégrité-de-PLAN) mais NE RELIT PAS le store h2a. La
 * non-forgeabilité repose sur (1) le lane exécutant (k8s) qui lit+VÉRIFIE l'owner-go
 * depuis SON inbox h2a authentifié puis le copie verbatim (runbook, GATÉ sur mesh-UP,
 * évidencé + enveloppe enregistrée), et (2) la frontière RBAC de lancement (le
 * kubeconfig OVH est k8s-SEUL ; `assertDeclaredCluster` borne le OÙ). Le `design_sha256`
 * self-référentiel bloque la SUBSTITUTION-DE-PLAN, PAS la forge : quiconque peut écrire
 * `--owner-go-artifact` + connaît method/targets/git-sha peut forger un artefact passant.
 * Cette forge est BORNÉE par : la frontière RBAC (forge ≡ launch-k8s ≡ déjà-TCB-cluster,
 * pas d'élargissement) + l'egress-belt C2 (SSRF : deny interne + 169.254 métadonnée,
 * ENFORCÉ par le CNI = hard-gate) + le caractère additif/create-once/réversible.
 *
 * Décision contract (geo-archi, ≥2-peer) : procédural ACCEPTÉ pour capture
 * additive/réversible SEULEMENT. Les scopes d'ÉCRITURE (write-rekey/write-legacy-merge)
 * ne sont JAMAIS lane-gated — ils gardent le firewall PLEIN (relecture-store) + Q-CRYPTO.
 * Voir SPEC_OBJECT_STORE_CAMPAIGN_OWNER_GO_GATE.md §CA-G8.
 */
export function assertLaneGatedCaptureAuthorized(input: {
  execution: "local" | "cluster";
  runnerGitSha: string;
  method: Record<string, unknown>;
  targets: readonly unknown[];
  // Contenu de fichier NON-FIABLE — validé au runtime par assertClaimedArtefact.
  ownerGoArtifact: unknown;
}): { designSha256: Sha256Ref } {
  if (input.execution !== SUBMITTED_JOB_EXECUTION) {
    throw new Error(
      `lane-gated capture refusé: execution="${input.execution}" — CA-G2 exige "cluster" (jamais local)`,
    );
  }
  // CA-G8 (refus DUR, AVANT le field-check) : ce mode ne débloque QUE scope="capture".
  // Un artefact de scope write (write-rekey/write-legacy-merge) est refusé ici — les
  // writes ne sont JAMAIS lane-gated (ils gardent le firewall PLEIN + Q-CRYPTO). (Belt
  // explicite : `assertClaimedArtefact` re-vérifie scope===capture juste après.)
  const claimedScope =
    typeof input.ownerGoArtifact === "object" && input.ownerGoArtifact !== null
      ? (input.ownerGoArtifact as { scope?: unknown }).scope
      : undefined;
  if (claimedScope !== "capture") {
    throw new Error(
      `lane-gated capture REFUS DUR (CA-G8 capture-only): artefact scope="${String(claimedScope)}" — ` +
        `un scope write (write-rekey/write-legacy-merge) n'est JAMAIS lane-gated`,
    );
  }
  // Plan résolu réel (scope="capture" HARDCODÉ) → design_sha256 recalculé (CA-G6).
  const plan = buildCampaignExecutionPlan({
    scope: "capture",
    runnerGitSha: input.runnerGitSha,
    method: input.method,
    targets: input.targets,
  });
  const designSha256 = campaignDesignSha256(plan);
  // RÉUTILISE les field-checks du firewall (single-source, drift-proof) : les MÊMES
  // vérifs que le chemin plein — contract, actor.role=OWNER, via+owner_go_direct,
  // design_sha256===recalculé, scope===capture (CA-G8 : un artefact de scope write
  // → throw "scope divergent"), bucket, owner/geo_cond_instance, h2a_envelope_id/
  // session_id NON-VIDES (hook provenance), actor.instance. On SKIP UNIQUEMENT
  // `crossVerifyOwnerGoInStore` (la relecture-store qui exige le NHI) — remplacée par
  // la vérif-inbox PROCÉDURALE de k8s (voir docstring CA-G8 ci-dessus).
  assertClaimedArtefact(input.ownerGoArtifact as ObjectStoreCampaignOwnerGo, {
    designSha256,
    scope: "capture",
  });
  return { designSha256 };
}
