/**
 * FIREWALL — gate owner-go de la campagne object-store (`sentropic-geo`).
 *
 * Ce module est le pare-feu qui EMPÊCHE une capture/écriture cluster non
 * autorisée d'atteindre le stockage objet `sentropic-geo`. Il MIRROR le pattern
 * Model-A L4 (`assertOwnerGoInH2a`, cf. `zoning-event-remediation.ts`) mais reste
 * un module NEUF et ISOLÉ — il ne refacto ni n'importe le gate #258. Les deux
 * gates doivent rester indépendants (isolement campagne ↔ Model A).
 *
 * Principe (SPEC_OBJECT_STORE_CAMPAIGN_OWNER_GO_GATE.md v2) : l'EXÉCUTANT (le
 * runner) vérifie l'artefact owner-go LUI-MÊME, PAR CONSTRUCTION, et REFUSE
 * d'écrire/capter sans. Un relais conducteur (« l'owner a dit go ») ne satisfait
 * JAMAIS le gate : l'artefact et la session sont RELUS depuis le store h2a via
 * les lecteurs INJECTÉS, jamais crus depuis un message de l'appelant.
 *
 * Le binding ne vaut QUE par sa préimage canonique : `design_sha256` est le
 * sha256 du PLAN D'EXÉCUTION RÉSOLU canonique (cibles EXACTES + code réellement
 * exécuté). Le runner RECALCULE ce sha sur son plan réel avant d'écrire et exige
 * l'égalité avec l'artefact. L'owner autorise le plan RÉELLEMENT exécuté (code +
 * méthode + cibles), pas un blanc-seing.
 *
 * Pur, sans réseau : les lecteurs h2a sont injectés (comme `H2aRecordReader` en
 * L4). L'énum `scope` EXCLUT par construction tout périmètre destructif.
 */
import { createHash } from "node:crypto";

export const OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT =
  "object-store-campaign-owner-go/v1" as const;
export const CAMPAIGN_EXECUTION_PLAN_CONTRACT =
  "campaign-execution-plan/v1" as const;
/** `body.kind` porté par l'enveloppe h2a owner-go dans le store. */
export const OBJECT_STORE_CAMPAIGN_OWNER_GO_KIND =
  "object-store-campaign-owner-go" as const;

/** Le SEUL bucket que cette campagne autorise. Littéral, jamais paramétrable. */
export const CAMPAIGN_BUCKET = "sentropic-geo" as const;

/**
 * Périmètres autorisés — TOUS non destructifs. `write-rekey` = copy-only,
 * `write-legacy-merge` = additif-taggé. Aucune valeur destructive (drop,
 * suppression d'ancienne clé, éradication) n'existe dans l'énum : la frontière
 * destructive reste owner-gated SÉPARÉMENT, jamais sous cette campagne.
 */
export const CAMPAIGN_SCOPES = ["capture", "write-rekey", "write-legacy-merge"] as const;
export type CampaignScope = (typeof CAMPAIGN_SCOPES)[number];

export type Sha256Ref = `sha256:${string}`;

/** Lecteur h2a injecté (mirror L4 `H2aRecordReader`) : renvoie l'enregistrement brut. */
export type H2aRecordReader = (id: string) => Promise<unknown>;

/**
 * Plan d'exécution résolu canonique — la PRÉIMAGE de `design_sha256` (§1.1).
 * `targets` = les CIBLES EXACTES (triées) que le runner va effectivement écrire.
 */
export interface CampaignExecutionPlan {
  contract: typeof CAMPAIGN_EXECUTION_PLAN_CONTRACT;
  scope: CampaignScope;
  bucket: typeof CAMPAIGN_BUCKET;
  /** SHA git 40-hex du CODE réellement exécuté (l'exécutant, pas un manifeste). */
  runner_git_sha: string;
  /** Paramètres de méthode (tag legacy-merge ; mapping re-key ; params capture). */
  method: Record<string, unknown>;
  /** Les cibles exactes, TRIÉES de façon déterministe. */
  targets: unknown[];
}

/**
 * Artefact owner-go — enveloppe h2a émise DIRECTEMENT par l'owner (session
 * geo-cond), liée au design revu. `actor.role` = OWNER (signé owner, PAS
 * geo-cond) ; `via` = geo-cond (convoyé, pas autorisé, par geo-cond).
 */
export interface ObjectStoreCampaignOwnerGo {
  contract: typeof OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT;
  actor: { role: "OWNER"; instance: string };
  via: "geo-cond";
  owner_go_direct: true;
  design_sha256: Sha256Ref;
  scope: CampaignScope;
  bucket: typeof CAMPAIGN_BUCKET;
  owner_instance: string;
  geo_cond_instance: string;
  h2a_envelope_id: string;
  h2a_session_id: string;
}

/** Ce que le runner exige : le sha qu'il a RECALCULÉ + l'action qu'il exécute. */
export interface CampaignOwnerGoExpectation {
  designSha256: Sha256Ref;
  scope: CampaignScope;
}

const SESSION_STATES_OK = ["live", "closed", "draining"] as const;

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

export function assertCampaignScope(value: unknown): asserts value is CampaignScope {
  if (!(CAMPAIGN_SCOPES as readonly unknown[]).includes(value)) {
    throw new Error(
      `campaign scope invalide: ${String(value)} (attendu ${CAMPAIGN_SCOPES.join(" | ")})`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Préimage canonique de design_sha256 (§1.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sérialisation canonique : clés triées récursivement, ordre des tableaux
 * préservé (les `targets` sont déjà triées en amont). Déterministe et
 * indépendante de l'ordre d'insertion des clés.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** `canonicalJSON(plan)` : clés triées, déterministe, aucun espace superflu (§1.1). */
export function canonicalPlanJson(plan: CampaignExecutionPlan): string {
  assertCampaignExecutionPlan(plan);
  return canonicalString(plan);
}

/** `design_sha256 = sha256(canonicalJSON(plan))` → `sha256:<hex>` (§1.1). */
export function campaignDesignSha256(plan: CampaignExecutionPlan): Sha256Ref {
  return `sha256:${createHash("sha256").update(canonicalPlanJson(plan)).digest("hex")}`;
}

/**
 * Tri déterministe des cibles par leur forme canonique — le hash du plan ne
 * dépend donc jamais de l'ordre dans lequel les cibles ont été résolues.
 */
export function sortCampaignTargets(targets: readonly unknown[]): unknown[] {
  return [...targets]
    .map((target) => ({ target, key: canonicalString(target) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.target);
}

export function assertCampaignExecutionPlan(
  plan: CampaignExecutionPlan,
): void {
  if (!isRecord(plan)) throw new Error("campaign plan: objet requis");
  if (plan.contract !== CAMPAIGN_EXECUTION_PLAN_CONTRACT) {
    throw new Error("campaign plan: contract campaign-execution-plan/v1 requis");
  }
  assertCampaignScope(plan.scope);
  if (plan.bucket !== CAMPAIGN_BUCKET) {
    throw new Error(`campaign plan: bucket doit être ${CAMPAIGN_BUCKET}`);
  }
  if (typeof plan.runner_git_sha !== "string" || !/^[0-9a-f]{40}$/.test(plan.runner_git_sha)) {
    throw new Error("campaign plan: runner_git_sha doit être un SHA git complet (40 hex)");
  }
  if (!isRecord(plan.method)) throw new Error("campaign plan: method doit être un objet");
  if (!Array.isArray(plan.targets)) throw new Error("campaign plan: targets doit être un tableau");
}

/**
 * Construit un plan d'exécution résolu canonique : cibles TRIÉES, champs
 * validés. C'est ce plan que le runner hashe et fait autoriser par l'owner.
 */
export function buildCampaignExecutionPlan(input: {
  scope: CampaignScope;
  runnerGitSha: string;
  method: Record<string, unknown>;
  targets: readonly unknown[];
}): CampaignExecutionPlan {
  assertCampaignScope(input.scope);
  if (!/^[0-9a-f]{40}$/.test(input.runnerGitSha)) {
    throw new Error("campaign plan: runner_git_sha doit être un SHA git complet (40 hex)");
  }
  if (!isRecord(input.method)) throw new Error("campaign plan: method doit être un objet");
  if (!Array.isArray(input.targets)) throw new Error("campaign plan: targets doit être un tableau");
  const plan: CampaignExecutionPlan = {
    contract: CAMPAIGN_EXECUTION_PLAN_CONTRACT,
    scope: input.scope,
    bucket: CAMPAIGN_BUCKET,
    runner_git_sha: input.runnerGitSha,
    method: input.method,
    targets: sortCampaignTargets(input.targets),
  };
  assertCampaignExecutionPlan(plan);
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Le GATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valide les champs de l'artefact TEL QUE RÉCLAMÉ par l'appelant (première
 * ligne). Ces champs sont ensuite CONTRE-VÉRIFIÉS contre l'enveloppe relue du
 * store h2a — c'est cette relecture qui fait foi, pas la réclamation.
 */
function assertClaimedArtefact(
  artefact: ObjectStoreCampaignOwnerGo,
  expected: CampaignOwnerGoExpectation,
): void {
  if (!isRecord(artefact)) {
    throw new Error("campaign owner-go: artefact absent (refus par construction)");
  }
  // (1) contrat
  if (artefact.contract !== OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT) {
    throw new Error("campaign owner-go: contract object-store-campaign-owner-go/v1 requis");
  }
  // (2) actor.role === OWNER (relais geo-cond insuffisant ; un message-relais
  //     sans rôle OWNER est refusé ici)
  if (!isRecord(artefact.actor) || artefact.actor.role !== "OWNER") {
    throw new Error("campaign owner-go: actor.role=OWNER requis (relais geo-cond insuffisant)");
  }
  // (3) via geo-cond ∧ owner_go_direct
  if (artefact.via !== "geo-cond" || artefact.owner_go_direct !== true) {
    throw new Error("campaign owner-go: go owner DIRECT via geo-cond requis");
  }
  // (4) design_sha256 === expected (le sha recalculé par le runner sur SON plan réel)
  assertSha(artefact.design_sha256, "campaign owner-go design_sha256");
  if (artefact.design_sha256 !== expected.designSha256) {
    throw new Error(
      "campaign owner-go: design_sha256 ne vise pas le plan résolu réel du runner (binding rompu)",
    );
  }
  // (5) scope === expected (scope mismatch → throw ; un go capture n'autorise pas un write)
  assertCampaignScope(artefact.scope);
  if (artefact.scope !== expected.scope) {
    throw new Error(
      `campaign owner-go: scope divergent (artefact=${artefact.scope}, action=${expected.scope}) — un go ne vaut que pour SON périmètre`,
    );
  }
  // (6) bucket
  if (artefact.bucket !== CAMPAIGN_BUCKET) {
    throw new Error(`campaign owner-go: bucket doit être ${CAMPAIGN_BUCKET}`);
  }
  if (!nonEmpty(artefact.owner_instance)) {
    throw new Error("campaign owner-go: owner_instance non vide requis");
  }
  if (!nonEmpty(artefact.geo_cond_instance)) {
    throw new Error("campaign owner-go: geo_cond_instance non vide requis");
  }
  if (!nonEmpty(artefact.h2a_envelope_id)) {
    throw new Error("campaign owner-go: h2a_envelope_id non vide requis");
  }
  if (!nonEmpty(artefact.h2a_session_id)) {
    throw new Error("campaign owner-go: h2a_session_id non vide requis");
  }
  if (!nonEmpty(artefact.actor.instance)) {
    throw new Error("campaign owner-go: actor.instance non vide requis");
  }
}

/**
 * (8) RELECTURE FIRE-WALL : l'artefact et la session sont relus depuis le store
 * h2a via les lecteurs INJECTÉS, jamais crus depuis un message conducteur. Le
 * store est la source de vérité : un relais conducteur (qui ne peut pas déposer
 * une enveloppe signée OWNER dans le store) ne peut pas satisfaire ce point.
 */
async function assertOwnerGoInH2a(
  artefact: ObjectStoreCampaignOwnerGo,
  readEnvelope: H2aRecordReader,
  readSession: H2aRecordReader,
): Promise<void> {
  const envelope = await readEnvelope(artefact.h2a_envelope_id);
  if (!isRecord(envelope) || !isRecord(envelope["actor"]) || !isRecord(envelope["body"])) {
    throw new Error("campaign owner-go: enveloppe h2a introuvable/invalide (relais ≠ artefact)");
  }
  const actor = envelope["actor"];
  const body = envelope["body"];
  if (
    envelope["protocol"] !== "sentropic.h2a" ||
    envelope["version"] !== "0.1" ||
    envelope["id"] !== artefact.h2a_envelope_id ||
    envelope["type"] !== "event" ||
    actor["instance"] !== artefact.owner_instance ||
    actor["role"] !== "OWNER" ||
    body["kind"] !== OBJECT_STORE_CAMPAIGN_OWNER_GO_KIND ||
    body["via"] !== "geo-cond" ||
    body["owner_go_direct"] !== true ||
    body["design_sha256"] !== artefact.design_sha256 ||
    body["scope"] !== artefact.scope ||
    body["bucket"] !== CAMPAIGN_BUCKET ||
    body["owner_instance"] !== artefact.owner_instance ||
    body["geo_cond_instance"] !== artefact.geo_cond_instance ||
    body["h2a_session_id"] !== artefact.h2a_session_id
  ) {
    throw new Error("campaign owner-go: enveloppe h2a owner DIRECT divergente (store ≠ réclamation)");
  }
  // (7) session vivante/close/draining, tenue par l'instance geo-cond
  const session = await readSession(artefact.h2a_session_id);
  if (
    !isRecord(session) ||
    session["sessionId"] !== artefact.h2a_session_id ||
    session["instance"] !== artefact.geo_cond_instance ||
    !(SESSION_STATES_OK as readonly unknown[]).includes(session["state"])
  ) {
    throw new Error("campaign owner-go: session h2a geo-cond divergente ou morte");
  }
}

/**
 * LE GATE. Le runner l'appelle AVANT toute capture/écriture ; il THROW (refus)
 * si un seul point échoue (§2, points 1-8). Refuse-by-construction : sans
 * artefact valide RELU du store, rien ne fire.
 *
 * @param artefact  l'artefact owner-go réclamé (un pointeur ; contre-vérifié)
 * @param expected  ce que le runner exige (sha recalculé sur SON plan réel + scope)
 * @param readEnvelope  lecteur h2a INJECTÉ (store) — jamais un message conducteur
 * @param readSession   lecteur de session h2a INJECTÉ (store)
 */
export async function assertObjectStoreCampaignOwnerGo(
  artefact: ObjectStoreCampaignOwnerGo,
  expected: CampaignOwnerGoExpectation,
  readEnvelope: H2aRecordReader,
  readSession: H2aRecordReader,
): Promise<void> {
  assertCampaignScope(expected.scope);
  assertSha(expected.designSha256, "campaign owner-go expected.designSha256");
  assertClaimedArtefact(artefact, expected);
  await assertOwnerGoInH2a(artefact, readEnvelope, readSession);
}
