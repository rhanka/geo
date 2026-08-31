import {
  assertClaimedArtefact,
  assertDirectSessionChatOwnerGo,
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  type CampaignBucket,
  type DirectSessionChatCampaignOwnerGo,
  type ObjectStoreCampaignOwnerGo,
  type Sha256Ref,
} from "./object-store-campaign-gate.js";

/** Le manifeste soumis fixe lui aussi GEO_CAPTURE_EXECUTION="cluster" (CA-G2). */
export const SUBMITTED_JOB_EXECUTION: "cluster" = "cluster";

/**
 * L'artefact owner-go que le lane exécutant (k8s) a lu + copié verbatim dans un
 * fichier, dans l'un des DEUX modes de provenance (dispatch sur `via`) :
 *  - `via=geo-cond` (lane-B) : dépôt h2a-inbox — `h2a_envelope_id`/`h2a_session_id`
 *    REQUIS (l'inbox est host-writable/non-signé = (B) audit-trace, PAS anti-forge ;
 *    SPEC §7.1) ;
 *  - `via=direct-session-chat` (lane-A) : go owner comme tour-user DANS la session
 *    exécutante (k8s) — `executor_session`/`received_at`/`owner_go_text` REQUIS, et
 *    `owner_go_text` RÉFÉRENCE le design_sha S (cond-1). Provenance ≥ (B) + zéro mesh.
 * Les checks PARTAGÉS (contract/role/design_sha/scope/bucket/instances) sont
 * single-source (`assertSharedCampaignOwnerGoFields`) — drift-proof (Q-CRYPTO). Seule
 * la provenance est PAR MODE, avec ses champs REQUIS (jamais optionnels-pour-tous : F2).
 */
export type LaneGatedCaptureOwnerGoArtifact =
  | ObjectStoreCampaignOwnerGo
  | DirectSessionChatCampaignOwnerGo;

/**
 * CA-G8 — autorisation PROCÉDURALE, strictement réservée à la capture ADDITIVE.
 *
 * ⚠ L'ancre anti-forge de ce mode est PROCÉDURALE, PAS cryptographique : le runner
 * FIELD-CHECK l'artefact (intégrité-de-PLAN) mais NE RELIT PAS le store h2a. Le
 * `design_sha256` self-référentiel bloque la SUBSTITUTION-DE-PLAN, PAS la forge :
 * quiconque peut écrire `--owner-go-artifact` + connaît method/targets/git-sha peut
 * forger un artefact passant. La non-forgeabilité EFFECTIVE repose sur DEUX contrôles
 * DURS : (1) la frontière RBAC de lancement (kubeconfig OVH k8s-SEUL ;
 * `assertDeclaredCluster` borne le OÙ ; forge ≡ launch-k8s ≡ déjà-TCB-cluster, pas
 * d'élargissement), et (2) l'egress-belt C2 (deny RFC1918 + 169.254 métadonnée, MESURÉ
 * enforcé par le CNI Calico) qui borne une forge à « capture externe additive » + le
 * caractère additif/create-once/réversible. Le cross-check inbox de k8s (`h2a_envelope_id`)
 * est de l'AUDIT-TRACE (inbox host-writable, JSON non signé = (B), PAS anti-forge), pas un
 * contrôle de non-forgeabilité. Voir SPEC §7.1.
 *
 * Décision contract (geo-archi, ≥2-peer) : procédural ACCEPTÉ pour capture
 * additive/réversible SEULEMENT. Les scopes d'ÉCRITURE (write-rekey/write-legacy-merge)
 * ne sont JAMAIS lane-gated — ils gardent le firewall PLEIN (relecture-store) + Q-CRYPTO.
 * Voir SPEC_OBJECT_STORE_CAMPAIGN_OWNER_GO_GATE.md §CA-G8.
 */
export function assertLaneGatedCaptureAuthorized(input: {
  execution: "local" | "cluster";
  runnerGitSha: string;
  /** Bucket RÉEL config-driven (= `s3Target().bucket`, lu UNE fois par le runner appelant, ∈ allowlist). */
  bucket: CampaignBucket;
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
    bucket: input.bucket,
    runnerGitSha: input.runnerGitSha,
    method: input.method,
    targets: input.targets,
  });
  const designSha256 = campaignDesignSha256(plan);
  // Dispatch PAR MODE de provenance sur `via` (énum FERMÉ, fail-closed — cond-3).
  // Les DEUX modes appliquent les MÊMES checks PARTAGÉS single-source (contract,
  // role=OWNER, design_sha256===recalculé [CA-G6], scope===capture [CA-G8, déjà refusé
  // ci-dessus + re-checké], bucket, instances) ; ils DIFFÈRENT SEULEMENT sur la
  // provenance, chaque mode avec ses champs REQUIS (jamais optionnels-pour-tous : F2) :
  //   geo-cond → h2a_envelope_id/h2a_session_id REQUIS ;
  //   direct-session-chat → executor_session/received_at/owner_go_text REQUIS (+ cond-1).
  // On SKIP UNIQUEMENT `crossVerifyOwnerGoInStore` (la relecture-store) — remplacée par
  // la vérif PROCÉDURALE de k8s (vérif-inbox lane-B / discipline executor lane-A ; §7).
  const claimedVia =
    typeof input.ownerGoArtifact === "object" && input.ownerGoArtifact !== null
      ? (input.ownerGoArtifact as { via?: unknown }).via
      : undefined;
  if (claimedVia === "geo-cond") {
    assertClaimedArtefact(input.ownerGoArtifact as ObjectStoreCampaignOwnerGo, {
      designSha256,
      scope: "capture",
      bucket: input.bucket,
    });
  } else if (claimedVia === "direct-session-chat") {
    assertDirectSessionChatOwnerGo(input.ownerGoArtifact, {
      designSha256,
      scope: "capture",
      bucket: input.bucket,
    });
  } else {
    throw new Error(
      `lane-gated capture REFUS (via inconnu="${String(claimedVia)}"): ` +
        `via ∈ {geo-cond, direct-session-chat} requis (fail-closed, cond-3)`,
    );
  }
  return { designSha256 };
}
