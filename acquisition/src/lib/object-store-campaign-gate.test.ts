/**
 * Preuve locale du FIREWALL owner-go de la campagne object-store, sans réseau.
 * Couvre CA-G1 (gate par construction), CA-G6 (binding design_sha), le
 * déterminisme de la préimage canonique, et le gating d'état de session h2a.
 */
import { describe, expect, it } from "vitest";

import {
  assertObjectStoreCampaignOwnerGo,
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  canonicalPlanJson,
  CAMPAIGN_BUCKET,
  CAMPAIGN_EXECUTION_PLAN_CONTRACT,
  OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
  OBJECT_STORE_CAMPAIGN_OWNER_GO_KIND,
  type CampaignExecutionPlan,
  type CampaignScope,
  type H2aRecordReader,
  type ObjectStoreCampaignOwnerGo,
  type Sha256Ref,
} from "./object-store-campaign-gate.js";

const RUNNER_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

const captureTargets = [
  { slug: "sainte-julie", source: "pv", urls: ["https://ville.example/pv/2026-05.pdf"] },
  { slug: "beloeil", source: "pv", urls: ["https://ville.example/pv/2026-04.pdf"] },
];

function capturePlan(): CampaignExecutionPlan {
  return buildCampaignExecutionPlan({
    scope: "capture",
    runnerGitSha: RUNNER_SHA,
    method: { lane: "pv", egress: "direct", image: "geo-capture:test", max_bytes: 104_857_600 },
    targets: captureTargets,
  });
}

const OWNER_INSTANCE = "owner:direct";
const GEO_COND_INSTANCE = "claude:geo-cond";
const ENVELOPE_ID = "env:campaign-go";
const SESSION_ID = "sess:geo-cond";

function ownerGo(
  designSha256: Sha256Ref,
  scope: CampaignScope = "capture",
): ObjectStoreCampaignOwnerGo {
  return {
    contract: OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
    actor: { role: "OWNER", instance: OWNER_INSTANCE },
    via: "geo-cond",
    owner_go_direct: true,
    design_sha256: designSha256,
    scope,
    bucket: CAMPAIGN_BUCKET,
    owner_instance: OWNER_INSTANCE,
    geo_cond_instance: GEO_COND_INSTANCE,
    h2a_envelope_id: ENVELOPE_ID,
    h2a_session_id: SESSION_ID,
  };
}

function storeEnvelope(artefact: ObjectStoreCampaignOwnerGo): Record<string, unknown> {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: artefact.h2a_envelope_id,
    type: "event",
    actor: { instance: artefact.owner_instance, role: "OWNER", scope: "scope:default" },
    body: {
      kind: OBJECT_STORE_CAMPAIGN_OWNER_GO_KIND,
      via: "geo-cond",
      owner_go_direct: true,
      design_sha256: artefact.design_sha256,
      scope: artefact.scope,
      bucket: artefact.bucket,
      owner_instance: artefact.owner_instance,
      geo_cond_instance: artefact.geo_cond_instance,
      h2a_session_id: artefact.h2a_session_id,
    },
  };
}

function storeSession(state: string): Record<string, unknown> {
  return { sessionId: SESSION_ID, instance: GEO_COND_INSTANCE, state };
}

/** Store h2a en mémoire — c'est LUI qui fait foi, jamais le message appelant. */
function readers(
  envelope: unknown,
  session: unknown,
): { readEnvelope: H2aRecordReader; readSession: H2aRecordReader } {
  return {
    readEnvelope: async () => envelope,
    readSession: async () => session,
  };
}

describe("assertObjectStoreCampaignOwnerGo — CA-G1 gate par construction", () => {
  it("accepte un artefact owner-go DIRECT relu du store pour le design/scope exact", async () => {
    const plan = capturePlan();
    const designSha256 = campaignDesignSha256(plan);
    const artefact = ownerGo(designSha256);
    const { readEnvelope, readSession } = readers(storeEnvelope(artefact), storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(artefact, { designSha256, scope: "capture" }, readEnvelope, readSession),
    ).resolves.toBeUndefined();
  });

  it("refuse un artefact manquant dans le store h2a (readEnvelope → null)", async () => {
    const designSha256 = campaignDesignSha256(capturePlan());
    const artefact = ownerGo(designSha256);
    const { readEnvelope, readSession } = readers(null, storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(artefact, { designSha256, scope: "capture" }, readEnvelope, readSession),
    ).rejects.toThrow(/introuvable\/invalide/);
  });

  it("refuse un design_sha256 faux (binding rompu)", async () => {
    const designSha256 = campaignDesignSha256(capturePlan());
    const artefact = ownerGo(`sha256:${"c".repeat(64)}` as Sha256Ref);
    const { readEnvelope, readSession } = readers(storeEnvelope(artefact), storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(artefact, { designSha256, scope: "capture" }, readEnvelope, readSession),
    ).rejects.toThrow(/design_sha256 ne vise pas/);
  });

  it("refuse actor.role ≠ OWNER (relais geo-cond insuffisant)", async () => {
    const designSha256 = campaignDesignSha256(capturePlan());
    const artefact = { ...ownerGo(designSha256), actor: { role: "GEO-COND", instance: GEO_COND_INSTANCE } };
    const { readEnvelope, readSession } = readers(storeEnvelope(ownerGo(designSha256)), storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(
        artefact as unknown as ObjectStoreCampaignOwnerGo,
        { designSha256, scope: "capture" },
        readEnvelope,
        readSession,
      ),
    ).rejects.toThrow(/actor\.role=OWNER requis/);
  });

  it("refuse un scope mismatch : go write-rekey sur une action capture", async () => {
    const designSha256 = campaignDesignSha256(capturePlan());
    const artefact = ownerGo(designSha256, "write-rekey");
    const { readEnvelope, readSession } = readers(storeEnvelope(artefact), storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(artefact, { designSha256, scope: "capture" }, readEnvelope, readSession),
    ).rejects.toThrow(/scope divergent/);
  });

  it("refuse un scope mismatch symétrique : go capture sur une action write-legacy-merge", async () => {
    const designSha256 = campaignDesignSha256(capturePlan());
    const artefact = ownerGo(designSha256, "capture");
    const { readEnvelope, readSession } = readers(storeEnvelope(artefact), storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(
        artefact,
        { designSha256, scope: "write-legacy-merge" },
        readEnvelope,
        readSession,
      ),
    ).rejects.toThrow(/scope divergent/);
  });

  it("refuse un simple message-relais (pas de rôle OWNER) — relais ≠ artefact", async () => {
    const designSha256 = campaignDesignSha256(capturePlan());
    // Ce qu'un conducteur pourrait relayer : « l'owner a dit go », sans actor OWNER.
    const relay = {
      contract: OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
      via: "geo-cond",
      owner_go_direct: true,
      design_sha256: designSha256,
      scope: "capture",
      bucket: CAMPAIGN_BUCKET,
      owner_instance: OWNER_INSTANCE,
      geo_cond_instance: GEO_COND_INSTANCE,
      h2a_envelope_id: ENVELOPE_ID,
      h2a_session_id: SESSION_ID,
    };
    const { readEnvelope, readSession } = readers(storeEnvelope(ownerGo(designSha256)), storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(
        relay as unknown as ObjectStoreCampaignOwnerGo,
        { designSha256, scope: "capture" },
        readEnvelope,
        readSession,
      ),
    ).rejects.toThrow(/actor\.role=OWNER requis/);
  });

  it("refuse une réclamation OWNER non adossée au store (enveloppe store forgée geo-cond)", async () => {
    // L'artefact réclamé est parfait, mais le store ne porte PAS d'enveloppe OWNER :
    // un conducteur ne peut pas déposer une enveloppe signée OWNER → refus.
    const designSha256 = campaignDesignSha256(capturePlan());
    const artefact = ownerGo(designSha256);
    const forged = storeEnvelope(artefact);
    (forged["actor"] as Record<string, unknown>)["role"] = "GEO-COND";
    const { readEnvelope, readSession } = readers(forged, storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(artefact, { designSha256, scope: "capture" }, readEnvelope, readSession),
    ).rejects.toThrow(/owner DIRECT divergente/);
  });

  it("refuse une enveloppe store dont le design_sha256 ne matche pas la réclamation", async () => {
    const designSha256 = campaignDesignSha256(capturePlan());
    const artefact = ownerGo(designSha256);
    const forged = storeEnvelope(artefact);
    (forged["body"] as Record<string, unknown>)["design_sha256"] = `sha256:${"d".repeat(64)}`;
    const { readEnvelope, readSession } = readers(forged, storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(artefact, { designSha256, scope: "capture" }, readEnvelope, readSession),
    ).rejects.toThrow(/owner DIRECT divergente/);
  });
});

describe("CA-G6 — binding design_sha : cibles/méthode/code liés", () => {
  it("un changement de cibles change design_sha256 → l'ancien go ne matche plus → throw", async () => {
    const oldSha = campaignDesignSha256(capturePlan());
    // Le runner résout un plan RÉEL différent (une cible ajoutée).
    const newPlan = buildCampaignExecutionPlan({
      scope: "capture",
      runnerGitSha: RUNNER_SHA,
      method: { lane: "pv", egress: "direct", image: "geo-capture:test", max_bytes: 104_857_600 },
      targets: [...captureTargets, { slug: "carignan", source: "pv", urls: ["https://ville.example/pv/x.pdf"] }],
    });
    const newSha = campaignDesignSha256(newPlan);
    expect(newSha).not.toBe(oldSha);
    // L'artefact owner est resté lié à l'ancien design ; le runner recalcule le nouveau.
    const artefact = ownerGo(oldSha);
    const { readEnvelope, readSession } = readers(storeEnvelope(artefact), storeSession("live"));
    await expect(
      assertObjectStoreCampaignOwnerGo(artefact, { designSha256: newSha, scope: "capture" }, readEnvelope, readSession),
    ).rejects.toThrow(/design_sha256 ne vise pas/);
  });

  it("un changement de méthode ou de runner_git_sha change design_sha256", () => {
    const base = campaignDesignSha256(capturePlan());
    const methodChanged = campaignDesignSha256(
      buildCampaignExecutionPlan({
        scope: "capture",
        runnerGitSha: RUNNER_SHA,
        method: { lane: "pv", egress: "tor:pv", image: "geo-capture:test", max_bytes: 104_857_600 },
        targets: captureTargets,
      }),
    );
    const shaChanged = campaignDesignSha256(
      buildCampaignExecutionPlan({
        scope: "capture",
        runnerGitSha: OTHER_SHA,
        method: { lane: "pv", egress: "direct", image: "geo-capture:test", max_bytes: 104_857_600 },
        targets: captureTargets,
      }),
    );
    const scopeChanged = campaignDesignSha256(
      buildCampaignExecutionPlan({
        scope: "write-rekey",
        runnerGitSha: RUNNER_SHA,
        method: { lane: "pv", egress: "direct", image: "geo-capture:test", max_bytes: 104_857_600 },
        targets: captureTargets,
      }),
    );
    expect(new Set([base, methodChanged, shaChanged, scopeChanged]).size).toBe(4);
  });
});

describe("préimage canonique — déterministe et indépendante de l'ordre des clés", () => {
  it("canonicalPlanJson trie les clés : ordre d'insertion indifférent", () => {
    const planA: CampaignExecutionPlan = {
      contract: CAMPAIGN_EXECUTION_PLAN_CONTRACT,
      scope: "capture",
      bucket: CAMPAIGN_BUCKET,
      runner_git_sha: RUNNER_SHA,
      method: { lane: "pv", egress: "direct" },
      targets: [{ slug: "a", source: "pv", urls: ["https://x/1"] }],
    };
    // Mêmes valeurs, clés insérées dans un ordre différent (plan + method).
    const planB = {
      targets: [{ urls: ["https://x/1"], source: "pv", slug: "a" }],
      method: { egress: "direct", lane: "pv" },
      runner_git_sha: RUNNER_SHA,
      bucket: CAMPAIGN_BUCKET,
      scope: "capture",
      contract: CAMPAIGN_EXECUTION_PLAN_CONTRACT,
    } as CampaignExecutionPlan;
    expect(canonicalPlanJson(planA)).toBe(canonicalPlanJson(planB));
    expect(campaignDesignSha256(planA)).toBe(campaignDesignSha256(planB));
    // Aucune espace superflue dans la sérialisation canonique.
    expect(canonicalPlanJson(planA)).not.toMatch(/: |, |\n/);
  });

  it("buildCampaignExecutionPlan trie les cibles → hash indépendant de l'ordre d'entrée", () => {
    const forward = campaignDesignSha256(
      buildCampaignExecutionPlan({
        scope: "capture",
        runnerGitSha: RUNNER_SHA,
        method: { lane: "pv" },
        targets: captureTargets,
      }),
    );
    const reversed = campaignDesignSha256(
      buildCampaignExecutionPlan({
        scope: "capture",
        runnerGitSha: RUNNER_SHA,
        method: { lane: "pv" },
        targets: [...captureTargets].reverse(),
      }),
    );
    expect(forward).toBe(reversed);
  });
});

describe("gating d'état de session h2a", () => {
  it.each(["live", "closed", "draining"])("accepte l'état de session %s", async (state) => {
    const designSha256 = campaignDesignSha256(capturePlan());
    const artefact = ownerGo(designSha256);
    const { readEnvelope, readSession } = readers(storeEnvelope(artefact), storeSession(state));
    await expect(
      assertObjectStoreCampaignOwnerGo(artefact, { designSha256, scope: "capture" }, readEnvelope, readSession),
    ).resolves.toBeUndefined();
  });

  it.each(["dead", "terminated", "expired", "aborted"])(
    "refuse une session morte (%s)",
    async (state) => {
      const designSha256 = campaignDesignSha256(capturePlan());
      const artefact = ownerGo(designSha256);
      const { readEnvelope, readSession } = readers(storeEnvelope(artefact), storeSession(state));
      await expect(
        assertObjectStoreCampaignOwnerGo(artefact, { designSha256, scope: "capture" }, readEnvelope, readSession),
      ).rejects.toThrow(/session h2a geo-cond divergente ou morte/);
    },
  );

  it("refuse une session tenue par une autre instance que geo-cond", async () => {
    const designSha256 = campaignDesignSha256(capturePlan());
    const artefact = ownerGo(designSha256);
    const session = { sessionId: SESSION_ID, instance: "someone:else", state: "live" };
    const { readEnvelope, readSession } = readers(storeEnvelope(artefact), session);
    await expect(
      assertObjectStoreCampaignOwnerGo(artefact, { designSha256, scope: "capture" }, readEnvelope, readSession),
    ).rejects.toThrow(/session h2a geo-cond divergente/);
  });
});
