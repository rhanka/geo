/**
 * FIREWALL de la campagne object-store tout-geo (writes `sentropic-geo` :
 * re-key COPY-ONLY + legacy-merge ADDITIF-TAGGÉ).
 *
 * Principe (SPEC_OBJECT_STORE_CAMPAIGN_OWNER_GO_GATE.md v2) : l'EXÉCUTANT (le
 * runner) vérifie l'artefact owner-go LUI-MÊME, PAR CONSTRUCTION, et REFUSE
 * d'écrire sans. Un relais conducteur (« l'owner a dit go ») n'est PAS un
 * artefact — le gate lit l'enveloppe/session h2a depuis un store INJECTÉ, jamais
 * depuis un message.
 *
 * Gate NEUF (contrat `object-store-campaign-owner-go/v1`) : mirroir du pattern
 * Model A L4 (`assertOwnerGoInH2a`) SANS refacto du module #258 partagé
 * (isolement campagne ↔ Model A / Q-CRYPTO-HARDEN).
 *
 * Pur / réseau-free : `s3`, `readEnvelope`, `readSession` sont INJECTÉS ; aucun
 * client réel par défaut dans le chemin pur. Le binding `design_sha256` porte
 * sur le PLAN D'EXÉCUTION RÉSOLU canonique (code + méthode + CIBLES), recalculé
 * par le runner sur son plan réel — pas un manifeste découplé.
 */
import { createHash } from "node:crypto";

import type { S3Client } from "@aws-sdk/client-s3";

import { canonicalJson } from "./geo-served-contract.js";
import { copyObject, putBytesIfAbsentOrEqual } from "./s3.js";

export const OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT =
  "object-store-campaign-owner-go/v1" as const;
export const CAMPAIGN_EXECUTION_PLAN_CONTRACT = "campaign-execution-plan/v1" as const;
/** L'énum `scope` EXCLUT tout scope destructif par construction (§5). */
export const CAMPAIGN_BUCKET = "sentropic-geo" as const;
/** Le `kind` porté par l'enveloppe h2a lue depuis le store. */
export const CAMPAIGN_OWNER_GO_ENVELOPE_KIND = "object-store-campaign-owner-go" as const;

export type Sha256Ref = `sha256:${string}`;

/** Scopes NON destructifs uniquement (§5). Un go d'un scope n'autorise pas un autre. */
export type CampaignWriteScope = "write-rekey" | "write-legacy-merge";
export type CampaignScope = "capture" | CampaignWriteScope;

/** Lecture h2a INJECTÉE depuis le store ; jamais un message conducteur (§2.8). */
export type H2aRecordReader = (id: string) => Promise<unknown>;

/**
 * Artefact owner-go émis DIRECTEMENT par l'owner (session geo-cond), lié au
 * design revu. Field-bound (pas crypto-signé) — cf Q-CRYPTO-HARDEN, lot distinct.
 */
export interface ObjectStoreCampaignOwnerGo {
  contract: typeof OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT;
  /** Signé OWNER, PAS geo-cond (relais insuffisant). */
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

/** Ce que le runner recalcule sur SON plan résolu réel et exige de l'artefact. */
export interface CampaignExpected {
  designSha256: Sha256Ref;
  scope: CampaignScope;
}

/**
 * Plan d'exécution RÉSOLU canonique — la préimage de `design_sha256` (§1.1).
 * L'owner autorise CE plan exact (code + méthode + CIBLES triées), pas un
 * manifeste découplé.
 */
export interface CampaignExecutionPlan {
  contract: typeof CAMPAIGN_EXECUTION_PLAN_CONTRACT;
  scope: CampaignScope;
  bucket: typeof CAMPAIGN_BUCKET;
  /** Le CODE réellement exécuté. */
  runner_git_sha: string;
  method: Record<string, unknown>;
  /** Les CIBLES EXACTES, TRIÉES. */
  targets: readonly unknown[];
}

// --------------------------------------------------------------------------
// Préimage canonique — le binding ne vaut QUE par sa préimage (§1.1)
// --------------------------------------------------------------------------

/**
 * `design_sha256 = sha256(canonicalJSON(plan))`. `canonicalJson` (clés triées,
 * ordre de tableau préservé, sans espace superflu) — PAS `JSON.stringify(...,2)`
 * (ordre d'insertion, non déterministe). Le runner RECALCULE ce sha sur son
 * plan réel avant d'écrire.
 */
export function campaignExecutionPlanSha256(plan: CampaignExecutionPlan): Sha256Ref {
  const digest = createHash("sha256").update(canonicalJson(plan), "utf8").digest("hex");
  return `sha256:${digest}`;
}

// --------------------------------------------------------------------------
// Le gate (§2) — appelé par le runner AVANT toute écriture ; throw sur tout échec
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const SHA256_REF = /^sha256:[0-9a-f]{64}$/;
const RUNNER_GIT_SHA = /^[0-9a-f]{40}$/;
const SESSION_STATES: readonly unknown[] = ["live", "closed", "draining"];

/**
 * Vérifie l'artefact owner-go PAR CONSTRUCTION. `envelope` est l'artefact remis
 * au runner ; l'enveloppe/session h2a réelles sont relues DEPUIS LE STORE via
 * `readEnvelope`/`readSession` — un objet nu (message-relais) ne satisfait donc
 * jamais le gate. Throw (refus) si un seul point échoue.
 */
export async function assertObjectStoreCampaignOwnerGo(
  envelope: unknown,
  expected: CampaignExpected,
  readEnvelope: H2aRecordReader,
  readSession: H2aRecordReader,
): Promise<void> {
  // 0. Structure minimale : un message-relais n'est pas un artefact.
  if (!isRecord(envelope) || !isRecord(envelope["actor"])) {
    throw new Error("object-store-campaign gate: artefact owner-go absent ou malformé");
  }
  const actor = envelope["actor"];
  // §2.1 contrat
  if (envelope["contract"] !== OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT) {
    throw new Error("object-store-campaign gate: contrat owner-go invalide");
  }
  // §2.2 actor.role top-level === OWNER (relais geo-cond insuffisant)
  if (actor["role"] !== "OWNER") {
    throw new Error("object-store-campaign gate: go owner DIRECT (actor.role=OWNER) requis");
  }
  // §2.3 via geo-cond ∧ owner_go_direct
  if (envelope["via"] !== "geo-cond" || envelope["owner_go_direct"] !== true) {
    throw new Error("object-store-campaign gate: owner_go_direct via geo-cond requis");
  }
  // §2.6 bucket
  if (envelope["bucket"] !== CAMPAIGN_BUCKET) {
    throw new Error("object-store-campaign gate: bucket sentropic-geo requis");
  }
  const designSha = envelope["design_sha256"];
  if (typeof designSha !== "string" || !SHA256_REF.test(designSha)) {
    throw new Error("object-store-campaign gate: design_sha256 sha256:<64hex> requis");
  }
  // §2.4 design binding — l'owner autorise CE plan résolu exact (cibles incluses)
  if (designSha !== expected.designSha256) {
    throw new Error(
      "object-store-campaign gate: design_sha256 ≠ plan résolu recalculé (binding rompu)",
    );
  }
  // §2.5 scope match — scope mismatch → throw
  if (envelope["scope"] !== expected.scope) {
    throw new Error(
      `object-store-campaign gate: scope ${String(envelope["scope"])} ≠ action ${expected.scope}`,
    );
  }
  const ownerInstance = envelope["owner_instance"];
  const geoCondInstance = envelope["geo_cond_instance"];
  const envelopeId = envelope["h2a_envelope_id"];
  const sessionId = envelope["h2a_session_id"];
  if (
    !nonEmpty(ownerInstance) ||
    !nonEmpty(geoCondInstance) ||
    !nonEmpty(envelopeId) ||
    !nonEmpty(sessionId)
  ) {
    throw new Error("object-store-campaign gate: identités owner/geo-cond + refs h2a requises");
  }
  if (!nonEmpty(actor["instance"]) || actor["instance"] !== ownerInstance) {
    throw new Error("object-store-campaign gate: actor.instance ≠ owner_instance");
  }

  // §2.8 field-bound sur l'ENVELOPPE h2a lue DEPUIS LE STORE (jamais un message).
  const h2aEnvelope = await readEnvelope(envelopeId);
  if (!isRecord(h2aEnvelope) || !isRecord(h2aEnvelope["actor"]) || !isRecord(h2aEnvelope["body"])) {
    throw new Error("object-store-campaign gate: enveloppe h2a introuvable/invalide dans le store");
  }
  const hActor = h2aEnvelope["actor"];
  const hBody = h2aEnvelope["body"];
  if (
    h2aEnvelope["protocol"] !== "sentropic.h2a" ||
    h2aEnvelope["version"] !== "0.1" ||
    h2aEnvelope["id"] !== envelopeId ||
    h2aEnvelope["type"] !== "event" ||
    hActor["instance"] !== ownerInstance ||
    hActor["role"] !== "OWNER" ||
    hBody["kind"] !== CAMPAIGN_OWNER_GO_ENVELOPE_KIND ||
    hBody["via"] !== "geo-cond" ||
    hBody["owner_go_direct"] !== true ||
    hBody["owner_instance"] !== ownerInstance ||
    hBody["geo_cond_instance"] !== geoCondInstance ||
    hBody["design_sha256"] !== designSha ||
    hBody["scope"] !== envelope["scope"] ||
    hBody["bucket"] !== CAMPAIGN_BUCKET ||
    hBody["h2a_session_id"] !== sessionId
  ) {
    throw new Error("object-store-campaign gate: enveloppe h2a owner DIRECT divergente");
  }
  // §2.7 session ∈ {live, closed, draining}
  const session = await readSession(sessionId);
  if (
    !isRecord(session) ||
    session["sessionId"] !== sessionId ||
    session["instance"] !== geoCondInstance ||
    !SESSION_STATES.includes(session["state"])
  ) {
    throw new Error("object-store-campaign gate: session h2a geo-cond divergente");
  }
}

// --------------------------------------------------------------------------
// Plan builders (recomputés par le runner sur son plan réel)
// --------------------------------------------------------------------------

function assertRunnerGitSha(sha: string): void {
  if (!RUNNER_GIT_SHA.test(sha)) {
    throw new Error("campaign plan: runner_git_sha 40-hex requis");
  }
}

function bytesOf(body: Buffer | Uint8Array | string): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- Re-key (COPY-ONLY) ---------------------------------------------------

export interface RekeyTarget {
  /** Clé existante à copier DEPUIS (jamais modifiée ni supprimée). */
  src_key: string;
  /** Nouvelle clé à copier VERS. */
  dest_key: string;
}

export interface RekeyCampaignInput {
  s3: S3Client;
  /** L'artefact owner-go remis au runner (vérifié PAR CONSTRUCTION). */
  ownerGo: unknown;
  readEnvelope: H2aRecordReader;
  readSession: H2aRecordReader;
  runnerGitSha: string;
  targets: readonly RekeyTarget[];
}

export interface RekeyCampaignResult {
  scope: "write-rekey";
  design_sha256: Sha256Ref;
  copied: RekeyTarget[];
}

function sortedRekeyTargets(targets: readonly RekeyTarget[]): RekeyTarget[] {
  const dests = new Set<string>();
  const normalized = targets.map((t) => {
    if (!nonEmpty(t.src_key) || !nonEmpty(t.dest_key)) {
      throw new Error("campaign rekey: src_key/dest_key requis");
    }
    if (t.src_key === t.dest_key) {
      throw new Error("campaign rekey: src_key === dest_key (no-op interdit)");
    }
    if (dests.has(t.dest_key)) {
      throw new Error(`campaign rekey: dest_key dupliqué (${t.dest_key})`);
    }
    dests.add(t.dest_key);
    return { src_key: t.src_key, dest_key: t.dest_key };
  });
  return normalized.sort(
    (a, b) => compareStrings(a.dest_key, b.dest_key) || compareStrings(a.src_key, b.src_key),
  );
}

/** Plan résolu re-key : la préimage exacte de `design_sha256`. */
export function buildRekeyPlan(
  runnerGitSha: string,
  targets: readonly RekeyTarget[],
): CampaignExecutionPlan {
  assertRunnerGitSha(runnerGitSha);
  return {
    contract: CAMPAIGN_EXECUTION_PLAN_CONTRACT,
    scope: "write-rekey",
    bucket: CAMPAIGN_BUCKET,
    runner_git_sha: runnerGitSha,
    method: { kind: "rekey" },
    targets: sortedRekeyTargets(targets),
  };
}

/**
 * Re-key runner — COPY-ONLY. Recalcule `design_sha256` sur son plan réel, passe
 * le gate AVANT toute écriture, puis `copyObject(src→dest)` UNIQUEMENT : NE
 * SUPPRIME NI n'écrase jamais l'ancienne clé (la suppression = étape DESTRUCTIVE
 * hors campagne, owner-gated séparément, jamais sous `write-rekey`).
 */
export async function runRekeyCampaign(input: RekeyCampaignInput): Promise<RekeyCampaignResult> {
  const plan = buildRekeyPlan(input.runnerGitSha, input.targets);
  const designSha256 = campaignExecutionPlanSha256(plan);
  // GATE PAR CONSTRUCTION, AVANT TOUTE ÉCRITURE.
  await assertObjectStoreCampaignOwnerGo(
    input.ownerGo,
    { designSha256, scope: "write-rekey" },
    input.readEnvelope,
    input.readSession,
  );
  const copied: RekeyTarget[] = [];
  for (const target of plan.targets as readonly RekeyTarget[]) {
    // COPY-ONLY. Aucun deleteObject, aucune écriture de l'ancienne clé.
    await copyObject(input.s3, target.src_key, target.dest_key, CAMPAIGN_BUCKET);
    copied.push(target);
  }
  return { scope: "write-rekey", design_sha256: designSha256, copied };
}

// --- Legacy-merge (ADDITIF-TAGGÉ) -----------------------------------------

export interface LegacyMergeTarget {
  /** Nouvelle clé taggée à ajouter. N'écrase/ne drop JAMAIS un objet existant. */
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}

export interface LegacyMergeCampaignInput {
  s3: S3Client;
  ownerGo: unknown;
  readEnvelope: H2aRecordReader;
  readSession: H2aRecordReader;
  runnerGitSha: string;
  /** Tag méthode legacy-merge (porté dans la préimage du design). */
  tag: string;
  targets: readonly LegacyMergeTarget[];
}

export interface LegacyMergeCampaignResult {
  scope: "write-legacy-merge";
  design_sha256: Sha256Ref;
  written: Array<{ key: string; outcome: "created" | "existing-equal" }>;
}

/** Cible de plan legacy-merge : clé + sha du contenu (binding octet-exact). */
interface LegacyMergePlanTarget {
  key: string;
  sha256: Sha256Ref;
  content_type: string | null;
}

function sortedLegacyTargets(targets: readonly LegacyMergeTarget[]): LegacyMergePlanTarget[] {
  const seen = new Set<string>();
  const normalized = targets.map((t): LegacyMergePlanTarget => {
    if (!nonEmpty(t.key)) throw new Error("campaign legacy-merge: key requis");
    if (seen.has(t.key)) throw new Error(`campaign legacy-merge: key dupliqué (${t.key})`);
    seen.add(t.key);
    const digest = createHash("sha256").update(bytesOf(t.body)).digest("hex");
    return { key: t.key, sha256: `sha256:${digest}`, content_type: t.contentType ?? null };
  });
  return normalized.sort((a, b) => compareStrings(a.key, b.key));
}

/** Plan résolu legacy-merge : la préimage exacte de `design_sha256`. */
export function buildLegacyMergePlan(
  runnerGitSha: string,
  tag: string,
  targets: readonly LegacyMergeTarget[],
): CampaignExecutionPlan {
  assertRunnerGitSha(runnerGitSha);
  if (!nonEmpty(tag)) throw new Error("campaign legacy-merge: tag méthode requis");
  return {
    contract: CAMPAIGN_EXECUTION_PLAN_CONTRACT,
    scope: "write-legacy-merge",
    bucket: CAMPAIGN_BUCKET,
    runner_git_sha: runnerGitSha,
    method: { kind: "legacy-merge", tag },
    targets: sortedLegacyTargets(targets),
  };
}

/**
 * Legacy-merge runner — ADDITIF-TAGGÉ. Recalcule `design_sha256` sur son plan
 * réel, passe le gate AVANT toute écriture, puis crée de NOUVEAUX objets taggés
 * via `putBytesIfAbsentOrEqual` : create-once, ou accepte un objet déjà présent
 * SEULEMENT s'il est octet-pour-octet identique (re-run idempotent). N'écrase/ne
 * drop JAMAIS un objet existant — une collision d'octets différents throw.
 */
export async function runLegacyMergeCampaign(
  input: LegacyMergeCampaignInput,
): Promise<LegacyMergeCampaignResult> {
  const plan = buildLegacyMergePlan(input.runnerGitSha, input.tag, input.targets);
  const designSha256 = campaignExecutionPlanSha256(plan);
  // GATE PAR CONSTRUCTION, AVANT TOUTE ÉCRITURE.
  await assertObjectStoreCampaignOwnerGo(
    input.ownerGo,
    { designSha256, scope: "write-legacy-merge" },
    input.readEnvelope,
    input.readSession,
  );
  const bodyByKey = new Map(input.targets.map((t) => [t.key, t.body] as const));
  const written: Array<{ key: string; outcome: "created" | "existing-equal" }> = [];
  for (const target of plan.targets as readonly LegacyMergePlanTarget[]) {
    const body = bodyByKey.get(target.key);
    if (body === undefined) throw new Error(`campaign legacy-merge: corps absent (${target.key})`);
    const outcome = await putBytesIfAbsentOrEqual(
      input.s3,
      target.key,
      body,
      target.content_type ?? undefined,
      CAMPAIGN_BUCKET,
    );
    written.push({ key: target.key, outcome });
  }
  return { scope: "write-legacy-merge", design_sha256: designSha256, written };
}
