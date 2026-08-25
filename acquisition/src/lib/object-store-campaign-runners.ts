/**
 * Write-runners de la campagne object-store tout-geo (bucket `sentropic-geo`).
 *
 * DEUX écritures NON destructives, chacune bâtie AUTOUR de la gate PARTAGÉE :
 *   - re-key       = COPY-ONLY   (copyObject src→dest ; JAMAIS deleteObject/écrase l'ancienne clé)
 *   - legacy-merge = ADDITIF-TAGGÉ (putBytesIfAbsentOrEqual ; JAMAIS drop/écrase un existant)
 *
 * La gate n'est PAS ré-implémentée ici : `assertObjectStoreCampaignOwnerGo`,
 * `buildCampaignExecutionPlan` et `campaignDesignSha256` sont IMPORTÉS depuis le
 * module canonique `./object-store-campaign-gate.ts` (bâti par pv, PR #267). Un
 * firewall dupliqué qui diverge serait le pire des défauts — capture-runner ET
 * write-runners partagent CETTE unique gate.
 *
 * Par construction : chaque runner RECALCULE `design_sha256` sur SON plan résolu
 * RÉEL (code + méthode + cibles), appelle la gate AVANT toute écriture, et
 * REFUSE sans artefact owner-go valide relu du store h2a injecté. Pur, sans
 * réseau : `s3` et les lecteurs h2a sont injectés (aucun client réel par défaut).
 */
import { createHash } from "node:crypto";

import type { S3Client } from "@aws-sdk/client-s3";

import { copyObject, putBytesIfAbsentOrEqual } from "./s3.js";
import {
  assertObjectStoreCampaignOwnerGo,
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  CAMPAIGN_BUCKET,
  type CampaignExecutionPlan,
  type H2aRecordReader,
  type ObjectStoreCampaignOwnerGo,
  type Sha256Ref,
} from "./object-store-campaign-gate.js";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function bytesOf(body: Buffer | Uint8Array | string): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-key runner — COPY-ONLY
// ─────────────────────────────────────────────────────────────────────────────

export interface RekeyTarget {
  /** Clé existante à copier DEPUIS — jamais modifiée ni supprimée. */
  src_key: string;
  /** Nouvelle clé à copier VERS. */
  dest_key: string;
}

export interface RekeyCampaignInput {
  s3: S3Client;
  /** Artefact owner-go remis au runner (contre-vérifié par la gate). */
  ownerGo: ObjectStoreCampaignOwnerGo;
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

function assertRekeyTargets(targets: readonly RekeyTarget[]): void {
  if (targets.length === 0) throw new Error("campaign rekey: au moins une cible requise");
  const dests = new Set<string>();
  for (const t of targets) {
    if (!nonEmpty(t.src_key) || !nonEmpty(t.dest_key)) {
      throw new Error("campaign rekey: src_key/dest_key non vides requis");
    }
    if (t.src_key === t.dest_key) {
      throw new Error(`campaign rekey: src_key === dest_key interdit (${t.src_key})`);
    }
    if (dests.has(t.dest_key)) {
      throw new Error(`campaign rekey: dest_key dupliqué (${t.dest_key})`);
    }
    dests.add(t.dest_key);
  }
}

/** Plan résolu re-key : la préimage exacte de `design_sha256` (cibles triées par la gate). */
export function buildRekeyPlan(
  runnerGitSha: string,
  targets: readonly RekeyTarget[],
): CampaignExecutionPlan {
  assertRekeyTargets(targets);
  return buildCampaignExecutionPlan({
    scope: "write-rekey",
    runnerGitSha,
    method: { kind: "rekey" },
    targets: targets.map((t) => ({ src_key: t.src_key, dest_key: t.dest_key })),
  });
}

/**
 * Re-key — COPY-ONLY. Recalcule `design_sha256`, passe la gate AVANT toute
 * écriture (scope `write-rekey`), puis `copyObject(src→dest)` UNIQUEMENT. Ne
 * supprime ni n'écrase jamais l'ancienne clé (la suppression = étape DESTRUCTIVE
 * hors campagne, owner-gated séparément, jamais sous `write-rekey`).
 */
export async function runRekeyCampaign(input: RekeyCampaignInput): Promise<RekeyCampaignResult> {
  const plan = buildRekeyPlan(input.runnerGitSha, input.targets);
  const designSha256 = campaignDesignSha256(plan);
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

// ─────────────────────────────────────────────────────────────────────────────
// Legacy-merge runner — ADDITIF-TAGGÉ
// ─────────────────────────────────────────────────────────────────────────────

export interface LegacyMergeTarget {
  /** Nouvelle clé taggée à ajouter — n'écrase/ne drop JAMAIS un objet existant. */
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}

export interface LegacyMergeCampaignInput {
  s3: S3Client;
  ownerGo: ObjectStoreCampaignOwnerGo;
  readEnvelope: H2aRecordReader;
  readSession: H2aRecordReader;
  runnerGitSha: string;
  /** Tag méthode legacy-merge — porté dans la préimage du design. */
  tag: string;
  targets: readonly LegacyMergeTarget[];
}

export interface LegacyMergeCampaignResult {
  scope: "write-legacy-merge";
  design_sha256: Sha256Ref;
  written: Array<{ key: string; outcome: "created" | "existing-equal" }>;
}

/** Cible de plan legacy-merge : clé + sha du contenu (binding octet-exact du design). */
interface LegacyMergePlanTarget {
  key: string;
  sha256: Sha256Ref;
  content_type: string | null;
}

function toLegacyPlanTargets(targets: readonly LegacyMergeTarget[]): LegacyMergePlanTarget[] {
  if (targets.length === 0) throw new Error("campaign legacy-merge: au moins une cible requise");
  const seen = new Set<string>();
  return targets.map((t): LegacyMergePlanTarget => {
    if (!nonEmpty(t.key)) throw new Error("campaign legacy-merge: key non vide requise");
    if (seen.has(t.key)) throw new Error(`campaign legacy-merge: key dupliquée (${t.key})`);
    seen.add(t.key);
    const digest = createHash("sha256").update(bytesOf(t.body)).digest("hex");
    return { key: t.key, sha256: `sha256:${digest}`, content_type: t.contentType ?? null };
  });
}

/** Plan résolu legacy-merge : la préimage exacte de `design_sha256`. */
export function buildLegacyMergePlan(
  runnerGitSha: string,
  tag: string,
  targets: readonly LegacyMergeTarget[],
): CampaignExecutionPlan {
  if (!nonEmpty(tag)) throw new Error("campaign legacy-merge: tag méthode requis");
  return buildCampaignExecutionPlan({
    scope: "write-legacy-merge",
    runnerGitSha,
    method: { kind: "legacy-merge", tag },
    targets: toLegacyPlanTargets(targets),
  });
}

/**
 * Legacy-merge — ADDITIF-TAGGÉ. Recalcule `design_sha256`, passe la gate AVANT
 * toute écriture (scope `write-legacy-merge`), puis crée de NOUVEAUX objets
 * taggés via `putBytesIfAbsentOrEqual` : create-once, ou accepte un objet déjà
 * présent SEULEMENT s'il est octet-pour-octet identique (re-run idempotent).
 * N'écrase/ne drop JAMAIS un objet existant — une collision d'octets différents
 * throw (le helper `putBytesIfAbsentOrEqual` : IfNoneMatch:"*" + relecture exacte).
 */
export async function runLegacyMergeCampaign(
  input: LegacyMergeCampaignInput,
): Promise<LegacyMergeCampaignResult> {
  const plan = buildLegacyMergePlan(input.runnerGitSha, input.tag, input.targets);
  const designSha256 = campaignDesignSha256(plan);
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
